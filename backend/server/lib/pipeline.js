// The verification pipeline: question in -> evidence-backed answer out.
//
//  Tier 1  "curated"  question matches a myth in myths.json -> use the team's checked PMIDs
//                     (re-fetched live from PubMed so titles/abstracts are real).
//  Tier 2  "live"     no match -> search PubMed (systematic reviews first) + MedlinePlus.
//  Fallback "fallback" nothing relevant found, or the AI says "Insufficient" ->
//                     honest "not enough verified evidence" answer, and the claim is
//                     logged to data/unmapped_claims.jsonl for the team to research.

import fs from 'node:fs';
import path from 'node:path';
import { matchMyth } from './curated.js';
import { articlesFor, searchEvidence } from './pubmed.js';
import { searchHealthTopics } from './medlineplus.js';
import { complete } from './llm.js';
import { systemPrompt, userMessage, DISCLAIMER, FALLBACK_SUMMARY, PROMPT_VERSION, SEARCH_TERMS_PROMPT, TRANSLATE_PROMPT } from './prompts.js';
import { normalizeAnswer, parseModelJSON, RequestError } from './validate.js';
import { searchTerms } from './text.js';
import { createLimiter, createCache } from './ratelimit.js';
import { UpstreamError } from './http.js';
import { analyzeManipulation } from './manipulation.js';
import { recordUnanswered } from './unanswered.js';

const liveLimiter = createLimiter({ windowMs: 60_000, max: Number(process.env.LIVE_LIMIT_PER_MIN || 8) });
const cache = createCache({ ttlMs: Number(process.env.CACHE_TTL_MINUTES || 360) * 60_000 });
let unmappedLog = '';

export function setDataDir(serverDir) {
  // On Vercel the project folder is read-only, so the log goes to the temporary /tmp folder there.
  const dir = process.env.VERCEL ? '/tmp/medicalogic' : path.join(serverDir, 'data');
  unmappedLog = process.env.UNMAPPED_LOG || path.join(dir, 'unmapped_claims.jsonl');
  try { fs.mkdirSync(path.dirname(unmappedLog), { recursive: true }); } catch { unmappedLog = ''; }
}

function logUnmapped(query, lang, reason, english = '') {
  const saved = recordUnanswered(query, lang, reason, english); // waited for below, so Vercel doesn't cut it off
  if (unmappedLog) {
    const line = JSON.stringify({ time: new Date().toISOString(), query, lang, reason, ...(english ? { english } : {}) }) + '\n';
    fs.appendFile(unmappedLog, line, () => {});
  }
  return saved;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Curated myth -> article list the model may cite (live PubMed data when reachable). */
async function curatedArticles(myth, warnings) {
  const pmids = myth.evidence.map(e => String(e.pmid));
  let live = null;
  try {
    live = await articlesFor(pmids);
  } catch (err) {
    warnings.push(`PubMed unreachable, using curated titles only (${err.message})`);
  }
  const byId = new Map((live || []).map(a => [a.pmid, a]));
  const out = [];
  for (const e of myth.evidence) {
    const pmid = String(e.pmid);
    const fromPubMed = byId.get(pmid);
    if (live && !fromPubMed) {
      warnings.push(`curated PMID ${pmid} was not found on PubMed - left out`);
      continue;
    }
    out.push({
      pmid,
      title: fromPubMed?.title || e.title,
      journal: fromPubMed?.journal || e.journal,
      year: fromPubMed?.year || e.year,
      study_type: e.study_type || fromPubMed?.study_type || 'Other',
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      abstract: fromPubMed?.abstract || '',
      team_note: e.note,
      team_relevance: e.relevance,
    });
  }
  return out;
}

function fallbackAnswer(lang) {
  return { verdict: 'Insufficient', summary: FALLBACK_SUMMARY[lang], true_part: '', overstated_part: '', sources: [] };
}

/** Ask the AI for 2-3 proper medical search queries. Returns [] if anything goes wrong. */
async function suggestQueries(claim, provider, warnings) {
  if (process.env.SEARCH_TERM_SUGGESTIONS === 'off') return [];
  try {
    const out = await complete({ system: SEARCH_TERMS_PROMPT, user: `Claim: "${claim}"`, provider, maxTokens: 400 });
    const list = parseModelJSON(out.text)?.queries;
    return (Array.isArray(list) ? list : [])
      .map(q => String(q).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(q => q.split(' ').length >= 1 && q.split(' ').length <= 5)
      .slice(0, 3);
  } catch (err) {
    warnings.push(`search-term suggestion failed (${err.message}) - used keywords only`);
    return [];
  }
}

const hasArabic = text => /[\u0600-\u06FF]/.test(text);

/** Arabic claim -> English, used only for matching and searching. Returns '' if it fails. */
async function toEnglish(claim, provider, warnings) {
  try {
    const out = await complete({ system: TRANSLATE_PROMPT, user: claim, provider, maxTokens: 300 });
    const en = String(parseModelJSON(out.text)?.english || '').trim();
    if (en && !hasArabic(en)) return en.slice(0, 500);
    warnings.push('translation came back empty - searched with the original text');
  } catch (err) {
    warnings.push(`translation failed (${err.message}) - searched with the original text`);
  }
  return '';
}

export async function verifyClaim({ query, lang = 'en', provider = 'groq', ip = 'local' }) {
  const t0 = Date.now();
  const cacheKey = `${lang}|${provider}|${query.toLowerCase()}`;
  const hit = cache.get(cacheKey);
  if (hit) return { ...hit, meta: { ...hit.meta, cached: true, latency_ms: Date.now() - t0 } };

  const warnings = [];
  // Our database and PubMed are English, so Arabic claims are searched in English.
  const english = hasArabic(query) ? await toEnglish(query, provider, warnings) : '';
  const searchText = english || query;
  const match = matchMyth(searchText);
  let tier, articles, kw, teamNotes = null, searchQueries = [];

  if (match) {
    const m = match.myth;
    tier = 'curated';
    kw = searchTerms(m.claim_text);
    articles = await curatedArticles(m, warnings);
    teamNotes = { mechanism: m.mechanism || '', risk: m.risk_rationale || '', true_part: m.true_part || '', overstated_part: m.overstated_part || '' };
  } else {
    const allowed = liveLimiter.check(ip);
    if (!allowed.ok) {
      const e = new RequestError('RATE_LIMITED', `Too many new-claim searches. Try again in ${allowed.retryAfterSec}s.`, 429);
      e.retryAfterSec = allowed.retryAfterSec;
      throw e;
    }
    tier = 'live';
    kw = searchTerms(searchText);
    searchQueries = await suggestQueries(searchText, provider, warnings);
    try {
      articles = (kw.length || searchQueries.length) ? await searchEvidence(kw, undefined, searchQueries) : [];
    } catch (err) {
      if (err instanceof UpstreamError) throw new RequestError('SOURCES_UNAVAILABLE', 'PubMed is not responding right now. Please try again in a minute.', 503);
      throw err;
    }
  }

  let consumer = [];
  try {
    consumer = await searchHealthTopics(kw);
  } catch (err) {
    warnings.push(`MedlinePlus unavailable (${err.message})`);
  }

  let answer, usage = null, model = null;
  if (!articles.length) {
    answer = fallbackAnswer(lang);
    warnings.push('no research articles found');
  } else {
    const allowed = new Map(articles.map(a => [a.pmid, a]));
    const system = systemPrompt(lang);
    const user = userMessage({ claim: english ? `${query}\n(English: ${english})` : query, articles, consumer, teamNotes });
    let result;
    for (let attempt = 0; attempt < 2 && !result?.answer; attempt++) {
      const out = await complete({ system, user, provider });
      usage = out.usage; model = out.model;
      result = normalizeAnswer(parseModelJSON(out.text), allowed);
      if (!result.answer && attempt === 0) warnings.push('model reply was not valid JSON - retried once');
    }
    if (!result.answer) throw new RequestError('BAD_MODEL_OUTPUT', 'The AI returned an unreadable answer. Please try again.', 502);
    warnings.push(...result.warnings);
    answer = result.answer;
    if (!answer.summary) answer.summary = answer.verdict === 'Insufficient' ? FALLBACK_SUMMARY[lang] : '';
  }

  if (answer.verdict === 'Insufficient') {
    if (tier === 'live') tier = 'fallback';
    await logUnmapped(query, lang, articles.length ? 'insufficient_evidence' : 'no_pubmed_results', english);
  }

  const m = match?.myth;
  const response = {
    success: true,
    query,
    lang,
    tier,
    ...answer,
    consumer_info: consumer,
    curated: m ? {
      myth_id: m.id,
      match_score: Number(match.score.toFixed(2)),
      claim_text: m.claim_text,
      risk_level: m.risk_classification,
      risk_rationale: m.risk_rationale,
      recommended_action: m.recommended_action,
      advice_source: m.advice_source || '',
      manipulation_markers: m.manipulation_markers,
      platform_origin: m.platform_origin,
    } : null,
    manipulation: analyzeManipulation(query, lang),
    evidence_last_checked: m?.evidence_last_checked || today(),
    disclaimer: DISCLAIMER[lang],
    meta: {
      prompt_version: PROMPT_VERSION,
      provider,
      model,
      latency_ms: Date.now() - t0,
      usage,
      cached: false,
      retrieved: { pubmed: articles.length, medlineplus: consumer.length },
      search_text_en: english || null,
      search_queries: searchQueries,
      retrieved_articles: articles.map(a => ({ pmid: a.pmid, title: a.title, study_type: a.study_type })),
      warnings,
    },
  };
  cache.set(cacheKey, response);
  return response;
}
