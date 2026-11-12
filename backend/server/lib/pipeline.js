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
import { matchMyth, matchMythArabic, findRelated } from './curated.js';
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
import { memoKey, getVerdict, saveVerdict } from './memo.js';

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
      team_note_ar: e.note_ar || '',
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
  if (process.env.SEARCH_TERM_SUGGESTIONS === 'off') return { claim: '', queries: [] };
  try {
    const out = await complete({ system: SEARCH_TERMS_PROMPT, user: `Claim: "${claim}"`, provider, maxTokens: 500 });
    const json = parseModelJSON(out.text) || {};
    const list = json.queries;
    const queries = (Array.isArray(list) ? list : [])
      .map(q => String(q).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(q => q.split(' ').length >= 1 && q.split(' ').length <= 5)
      .slice(0, 3);
    const tidy = typeof json.claim === 'string' && !hasArabic(json.claim) ? json.claim.trim().slice(0, 500) : '';
    return { claim: tidy, queries };
  } catch (err) {
    warnings.push(`search-term suggestion failed (${err.message}) - used keywords only`);
    return { claim: '', queries: [] };
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

/** A team field in the page's language: myths.json has claim_text_ar, recommended_action_ar, etc. for the Arabic page. */
const tr = (m, field, lang) => (lang === 'ar' && m[field + '_ar']) || m[field] || '';

// Words that limit a claim to "this thing on its own" (English + Arabic).
const ONLY_RE = /\b(alone|only|by itself|on its own|without|instead of|replaces?|rely(ing)? on|relies on|depend(ing)? on)\b|وحده|وحدها|لوحده|بمفرده|فقط|بدون|بدلاً من|بدلا من|دون|الاعتماد على|الاعتماد علي|يعتمد على|اعتمد على/i;
/** True when the team's claim is "X alone/without ..." and the user's claim isn't. */
function isSofterClaim(userText, myth) {
  const team = `${myth.claim_text} ${myth.claim_text_ar || ''}`;
  return ONLY_RE.test(team) && !ONLY_RE.test(userText);
}

const VERDICT_SET = new Set(['Supported', 'Refuted', 'Divergent', 'Insufficient']);

/**
 * Curated claims: the answer card shows the research team's own verdict, "what's true / overstated"
 * and sources, so the website matches the team's data exactly. The AI only writes the summary
 * (and, on the Arabic page, the Arabic wording of the team's text and notes).
 */
const teamSource = (a, note) => ({
  pmid: a.pmid, title: a.title, journal: a.journal || '', year: a.year || null, study_type: a.study_type || 'Other',
  url: a.url || `https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`, relevance: a.team_relevance === 'indirect' ? 'indirect' : 'direct',
  note: note || '', team: true,
});

/** Live answer about a related team claim: the team's papers go first, then the other papers the AI cited. */
function teamSourcesFirst(answer, articles, lang) {
  const aiNotes = new Map((answer.sources || []).map(s => [s.pmid, s.note]));
  const team = articles.filter(a => 'team_relevance' in a).map(a =>
    teamSource(a, lang === 'en' ? (a.team_note || aiNotes.get(a.pmid)) : (a.team_note_ar || aiNotes.get(a.pmid) || a.team_note)));
  const teamIds = new Set(team.map(t => t.pmid));
  answer.sources = [...team, ...(answer.sources || []).filter(s => !teamIds.has(s.pmid))];
}

function useTeamData(answer, m, articles, lang) {
  const aiNotes = new Map((answer.sources || []).map(s => [s.pmid, s.note]));
  if (VERDICT_SET.has(m.verdict)) answer.verdict = m.verdict;
  const t = tr(m, 'true_part', lang), o = tr(m, 'overstated_part', lang);
  // English page: always the team's text. Arabic page: the team's Arabic translation (if there isn't one, the AI's Arabic wording stays).
  if (t && (lang === 'en' || m.true_part_ar)) answer.true_part = t;
  if (o && (lang === 'en' || m.overstated_part_ar)) answer.overstated_part = o;
  answer.sources = articles.map(a => ({
    pmid: a.pmid,
    title: a.title,
    journal: a.journal || '',
    year: a.year || null,
    study_type: a.study_type || 'Other',
    url: a.url || `https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`,
    relevance: a.team_relevance === 'indirect' ? 'indirect' : 'direct',
    note: lang === 'en' ? (a.team_note || aiNotes.get(a.pmid) || '') : (a.team_note_ar || aiNotes.get(a.pmid) || a.team_note || ''),
    team: true,
  }));
  answer.team_reviewed = true;
}

export async function verifyClaim({ query, lang = 'en', provider = 'groq', ip = 'local' }) {
  const t0 = Date.now();
  const cacheKey = `${lang}|${provider}|${query.toLowerCase()}`;
  const hit = cache.get(cacheKey);
  if (hit) return { ...hit, meta: { ...hit.meta, cached: true, latency_ms: Date.now() - t0 } };

  const warnings = [];
  // Arabic claims are first compared with the team's own Arabic wording, so a literal translation can't make them miss.
  // Otherwise they are translated to English (our database and PubMed are English) for matching and searching.
  const arMatch = hasArabic(query) ? matchMythArabic(query) : null;
  let english = hasArabic(query) && !arMatch ? await toEnglish(query, provider, warnings) : '';
  let searchText = english || query;
  let match = arMatch || matchMyth(searchText);
  let tier, articles, kw, teamNotes = null, searchQueries = [], related = null, tidyClaim = '';

  // The team's claim says "X ALONE / WITHOUT anything else does Y" but the user's claim is the softer
  // "X helps with Y": that's a different (weaker) claim, so the team's verdict doesn't apply as-is.
  // We still show the team's sources and advice link on top, but the AI judges the softer claim.
  let softer = null;
  if (match && isSofterClaim(query + ' ' + english, match.myth)) {
    softer = match;
    match = null;
    if (hasArabic(query) && !english) { english = await toEnglish(query, provider, warnings); searchText = english || query; }
  }

  if (!match) {
    const allowed = liveLimiter.check(ip);
    if (!allowed.ok) {
      const e = new RequestError('RATE_LIMITED', `Too many new-claim searches. Try again in ${allowed.retryAfterSec}s.`, 429);
      e.retryAfterSec = allowed.retryAfterSec;
      throw e;
    }
    // The AI tidies the claim (spelling, standard medical words) and suggests PubMed searches.
    // Then we check the team's database again, so "alo vera gets rid of pimples" still finds the aloe vera claim.
    const s = await suggestQueries(searchText, provider, warnings);
    searchQueries = s.queries;
    tidyClaim = s.claim;
    if (tidyClaim && !softer) {
      match = matchMyth(tidyClaim);
      if (match && isSofterClaim(query + ' ' + tidyClaim, match.myth)) { softer = match; match = null; }
    }
  }

  if (match) {
    const m = match.myth;
    tier = 'curated';
    kw = searchTerms(m.claim_text);
    articles = await curatedArticles(m, warnings);
    teamNotes = { verdict: m.verdict || '', mechanism: m.mechanism || '', risk: m.risk_rationale || '', true_part: m.true_part || '', overstated_part: m.overstated_part || '' };
  } else {
    tier = 'live';
    kw = searchTerms(tidyClaim || searchText);
    try {
      articles = (kw.length || searchQueries.length) ? await searchEvidence(kw, undefined, searchQueries) : [];
    } catch (err) {
      if (err instanceof UpstreamError) throw new RequestError('SOURCES_UNAVAILABLE', 'PubMed is not responding right now. Please try again in a minute.', 503);
      throw err;
    }
    // A related claim in the team's database? Put its checked papers first, then the live results.
    related = softer || findRelated(tidyClaim || searchText) || (tidyClaim ? findRelated(searchText) : null);
    if (related) {
      const team = await curatedArticles(related.myth, warnings);
      const ids = new Set(team.map(t => t.pmid));
      articles = [...team, ...articles.filter(x => !ids.has(x.pmid))];
    }
  }

  // Team claims show only what's in our database (the team's papers + advice link), no extra outside links.
  let consumer = [];
  if (tier !== 'curated') {
    try {
      consumer = await searchHealthTopics(kw);
    } catch (err) {
      warnings.push(`MedlinePlus unavailable (${err.message})`);
    }
  }

  let answer, usage = null, model = null;
  if (!articles.length) {
    answer = fallbackAnswer(lang);
    warnings.push('no research articles found');
  } else {
    const allowed = new Map(articles.map(a => [a.pmid, a]));
    const system = systemPrompt(lang);
    // New claims: reuse the verdict this claim got before (e.g. in the other language), so answers stay consistent.
    const vKey = tier === 'live' ? memoKey(tidyClaim || searchText) : '';
    const priorVerdict = vKey ? await getVerdict(vKey) : '';
    const user = userMessage({ claim: english ? `${query}\n(English: ${english})` : query, articles, consumer, teamNotes, priorVerdict });
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
    if (tier === 'curated') useTeamData(answer, match.myth, articles, lang);
    else if (related) teamSourcesFirst(answer, articles, lang);
    if (vKey) {
      const keepPrior = VERDICT_SET.has(priorVerdict) && priorVerdict !== 'Insufficient' && answer.sources.length > 0;
      if (keepPrior) answer.verdict = priorVerdict;
      else if (answer.verdict !== 'Insufficient' || !priorVerdict) await saveVerdict(vKey, answer.verdict);
    }
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
      claim_text: tr(m, 'claim_text', lang),
      risk_level: m.risk_rationale ? m.risk_classification : null, // only shown once the team has filled in the reason
      risk_rationale: tr(m, 'risk_rationale', lang),
      recommended_action: tr(m, 'recommended_action', lang),
      advice_source: m.advice_source || '',
      manipulation_markers: m.manipulation_markers,
      platform_origin: m.platform_origin,
    } : null,
    related: (!m && related) ? {
      myth_id: related.myth.id,
      match_score: Number(related.score.toFixed(2)),
      claim_text: tr(related.myth, 'claim_text', lang),
      recommended_action: tr(related.myth, 'recommended_action', lang),
      advice_source: related.myth.advice_source || '',
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
      matched_arabic: Boolean(arMatch),
      tidy_claim: tidyClaim || null,
      search_queries: searchQueries,
      retrieved_articles: articles.map(a => ({ pmid: a.pmid, title: a.title, study_type: a.study_type })),
      warnings,
    },
  };
  cache.set(cacheKey, response);
  return response;
}
