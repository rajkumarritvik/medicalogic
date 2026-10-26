// Checks what comes IN (the request) and what comes OUT of the AI before the
// website ever sees it. The key safety rule: any PMID the AI cites must be one
// we actually retrieved from PubMed / the curated database. Anything else is dropped.

import { truncateWords, wordCount } from './text.js';

export const VERDICTS = ['Supported', 'Refuted', 'Divergent', 'Insufficient'];

export class RequestError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function validateRequest(body) {
  if (!body || typeof body !== 'object') throw new RequestError('BAD_JSON', 'Send a JSON body like {"query": "..."}.');
  const query = typeof body.query === 'string' ? body.query.trim().replace(/\s+/g, ' ') : '';
  if (query.length < 3) throw new RequestError('QUERY_TOO_SHORT', 'Type a health claim (at least 3 characters).');
  if (query.length > 2000) throw new RequestError('QUERY_TOO_LONG', 'Keep the claim or caption under 2000 characters.');
  const lang = body.lang === undefined ? 'en' : body.lang;
  if (!['en', 'ar'].includes(lang)) throw new RequestError('BAD_LANG', 'lang must be "en" or "ar".');
  const provider = body.provider === undefined ? 'groq' : body.provider;
  if (!['groq', 'openai'].includes(provider)) throw new RequestError('BAD_PROVIDER', 'provider must be "groq" or "openai".');
  return { query, lang, provider };
}

/** Reads JSON from the model even if it wrapped it in text or ```json fences. */
export function parseModelJSON(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
  }
  return null;
}

const str = (v, maxWords) => truncateWords(typeof v === 'string' ? v.trim() : '', maxWords);

/**
 * Cleans the model's answer.
 * @param raw       parsed JSON from the model (or null)
 * @param allowed   Map of pmid -> article we gave the model
 * @returns {{ answer, warnings }}
 */
export function normalizeAnswer(raw, allowed) {
  const warnings = [];
  if (!raw || typeof raw !== 'object') {
    return { answer: null, warnings: ['model did not return valid JSON'] };
  }
  let verdict = VERDICTS.find(v => v.toLowerCase() === String(raw.verdict || '').trim().toLowerCase());
  if (!verdict) { warnings.push(`unknown verdict "${raw.verdict}" -> Insufficient`); verdict = 'Insufficient'; }

  const seen = new Set();
  const sources = [];
  for (const s of Array.isArray(raw.sources) ? raw.sources : []) {
    const pmid = String(s?.pmid ?? '').replace(/\D/g, '');
    if (!pmid || seen.has(pmid)) continue;
    if (!allowed.has(pmid)) { warnings.push(`dropped PMID ${pmid}: not in retrieved sources (possible fabrication)`); continue; }
    seen.add(pmid);
    const a = allowed.get(pmid);
    sources.push({
      pmid,
      title: a.title,
      journal: a.journal || '',
      year: a.year || null,
      study_type: a.study_type || 'Other',
      url: a.url || `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      relevance: s.relevance === 'direct' ? 'direct' : 'indirect',
      note: str(s.note, 40),
    });
  }

  if (verdict !== 'Insufficient' && sources.length === 0) {
    warnings.push(`verdict "${verdict}" had no valid sources -> Insufficient`);
    verdict = 'Insufficient';
  }

  let summary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
  if (wordCount(summary) > 150) { warnings.push('summary over 150 words - trimmed'); summary = truncateWords(summary, 150); }

  return {
    answer: {
      verdict,
      summary,
      true_part: str(raw.true_part, 60),
      overstated_part: str(raw.overstated_part, 60),
      sources,
    },
    warnings,
  };
}
