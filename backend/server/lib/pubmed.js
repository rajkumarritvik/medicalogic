// Live PubMed search through NCBI E-utilities (free, no key needed).
// Docs: https://www.ncbi.nlm.nih.gov/books/NBK25499/
//
// Strategy: look for systematic reviews first, then other strong study types,
// then loosen the search. Every PMID we return came from PubMed itself,
// so the AI can never cite a paper that doesn't exist.

import { fetchWithRetry, makeThrottle, UpstreamError } from './http.js';
import { cleanText, truncateChars } from './text.js';

const BASE = () => process.env.PUBMED_BASE || 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const throttle = makeThrottle(process.env.NCBI_API_KEY ? 110 : 350);

function commonParams() {
  const p = new URLSearchParams({ db: 'pubmed', tool: 'medicalogic' });
  if (process.env.NCBI_EMAIL) p.set('email', process.env.NCBI_EMAIL);
  if (process.env.NCBI_API_KEY) p.set('api_key', process.env.NCBI_API_KEY);
  return p;
}

async function getJSON(path, params) {
  const url = `${BASE()}/${path}?${params}`;
  const res = await throttle(() => fetchWithRetry('PubMed', url));
  if (!res.ok) throw new UpstreamError('PubMed', `HTTP ${res.status}`, res.status);
  return res.json();
}

async function getText(path, params) {
  const url = `${BASE()}/${path}?${params}`;
  const res = await throttle(() => fetchWithRetry('PubMed', url));
  if (!res.ok) throw new UpstreamError('PubMed', `HTTP ${res.status}`, res.status);
  return res.text();
}

async function esearch(term, retmax, sort) {
  const p = commonParams();
  p.set('term', term);
  p.set('retmode', 'json');
  p.set('retmax', String(retmax));
  p.set('sort', sort || process.env.PUBMED_SORT || 'relevance'); // 'pub_date' = newest first
  const data = await getJSON('esearch.fcgi', p);
  return data?.esearchresult?.idlist || [];
}

function studyTypeFrom(pubtypes = []) {
  const t = pubtypes.join('|').toLowerCase();
  if (t.includes('systematic review')) return 'Systematic Review';
  if (t.includes('meta-analysis')) return 'Meta-Analysis';
  if (t.includes('randomized controlled trial')) return 'RCT';
  if (t.includes('guideline')) return 'Guideline';
  if (t.includes('case reports')) return 'Case Report';
  if (t.includes('review')) return 'Review';
  return 'Other';
}

/** Title, journal, year and study type for a list of PMIDs. Unknown PMIDs are left out. */
export async function summaries(pmids) {
  if (!pmids.length) return [];
  const p = commonParams();
  p.set('id', pmids.join(','));
  p.set('retmode', 'json');
  const data = await getJSON('esummary.fcgi', p);
  const result = data?.result || {};
  return pmids
    .map(id => result[id])
    .filter(r => r && !r.error && r.title)
    .map(r => ({
      pmid: String(r.uid),
      title: cleanText(r.title).replace(/\.$/, ''),
      journal: r.source || r.fulljournalname || '',
      year: parseInt(String(r.pubdate || '').slice(0, 4), 10) || null,
      study_type: studyTypeFrom(r.pubtype),
      authors: (r.authors || []).slice(0, 3).map(a => a.name),
      url: `https://pubmed.ncbi.nlm.nih.gov/${r.uid}/`,
    }));
}

/** Abstract text for each PMID, as { pmid: abstract }. */
export async function abstracts(pmids) {
  if (!pmids.length) return {};
  const p = commonParams();
  p.set('id', pmids.join(','));
  p.set('retmode', 'xml');
  p.set('rettype', 'abstract');
  const xml = await getText('efetch.fcgi', p);
  const out = {};
  for (const block of xml.split(/<PubmedArticle>/).slice(1)) {
    const pmid = block.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1];
    if (!pmid) continue;
    const parts = [...block.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g)].map(m => {
      const label = m[1].match(/Label="([^"]+)"/)?.[1];
      const text = cleanText(m[2]);
      return label ? `${label}: ${text}` : text;
    });
    out[pmid] = truncateChars(parts.join(' '), Number(process.env.ABSTRACT_MAX_CHARS || 1000));
  }
  return out;
}

/** Full article objects (metadata + abstract) for given PMIDs, keeping their order. */
export async function articlesFor(pmids) {
  const meta = await summaries(pmids);
  const abs = await abstracts(meta.map(m => m.pmid));
  return meta.map(m => ({ ...m, abstract: abs[m.pmid] || '' }));
}

/** How many of the search words appear in a paper's title + abstract (prefix match, so "seed" finds "seeds"). */
function coverage(article, words) {
  const text = `${article.title} ${article.abstract}`.toLowerCase();
  return words.filter(w => text.includes(w.length > 5 ? w.slice(0, w.length - 2) : w)).length;
}

const STRONG_TYPES = '(systematic[sb] OR meta-analysis[pt] OR randomized controlled trial[pt] OR review[pt])';

/**
 * Search PubMed for evidence about a claim.
 *  1. Strict: papers containing ALL the main words (systematic reviews first).
 *  2. Looser: fewer words.
 *  3. Last resort: papers containing ANY of the words, ranked by PubMed's "Best Match",
 *     then we keep only papers whose title/abstract mention at least a third of the words (min 2).
 *     This finds evidence even when the claim has filler words ("dry", "warm", "bitter").
 * @param {string[]} kw  keywords from the claim, most important first
 * @returns article objects, strongest study types first
 */
export async function searchEvidence(kw, max = Number(process.env.PUBMED_MAX_RESULTS || 4), queries = []) {
  const core = kw.slice(0, 6);
  if (!core.length && !queries.length) return [];
  const rank = { 'Systematic Review': 0, 'Meta-Analysis': 0, RCT: 1, Guideline: 1, Review: 2, 'Case Report': 3, Other: 4 };
  const byStrength = list => list.sort((a, b) => (rank[a.study_type] ?? 4) - (rank[b.study_type] ?? 4) || (b.year || 0) - (a.year || 0));

  // 0. AI-suggested medical search terms (e.g. "amygdalin cancer"), strongest study types first.
  const qIds = [];
  for (const q of queries) {
    const words = q.split(/\s+/).filter(Boolean);
    for (const term of [`(${words.join(' AND ')}) AND systematic[sb]`, `(${words.join(' AND ')}) AND ${STRONG_TYPES}`]) {
      for (const id of await esearch(term, 2)) if (!qIds.includes(id)) qIds.push(id);
      if (qIds.length >= max) break;
    }
    if (qIds.length >= max) break;
  }
  const fromQueries = qIds.length ? await articlesFor(qIds.slice(0, max)) : [];
  if (fromQueries.length >= max || !core.length) return byStrength(fromQueries).slice(0, max);
  const rest = await keywordSearch(core, max - fromQueries.length, new Set(fromQueries.map(a => a.pmid)));
  return byStrength(fromQueries.concat(rest));
}

/** Plain keyword search (used when the AI-suggested terms find fewer than `max` papers). */
async function keywordSearch(core, max, skip = new Set()) {
  const and = words => words.join(' AND ');
  const attempts = [
    `(${and(core.slice(0, 5))}) AND systematic[sb]`,
    `(${and(core.slice(0, 5))}) AND ${STRONG_TYPES}`,
    `(${and(core.slice(0, 3))}) AND ${STRONG_TYPES}`,
  ];
  const ids = [];
  for (const term of attempts) {
    for (const id of await esearch(term, max)) if (!ids.includes(id) && !skip.has(id)) ids.push(id);
    if (ids.length >= max) break;
  }
  let arts = ids.length ? await articlesFor(ids.slice(0, max)) : [];

  if (arts.length < max && core.length >= 2) {
    const need = Math.max(2, Math.round(core.length / 3));
    const orIds = (await esearch(`(${core.join(' OR ')}) AND ${STRONG_TYPES}`, 20, 'relevance'))
      .filter(id => !ids.includes(id) && !skip.has(id));
    if (orIds.length) {
      const extra = (await articlesFor(orIds))
        .map(a => ({ a, c: coverage(a, core) }))
        .filter(x => x.c >= need)
        .sort((x, y) => y.c - x.c)
        .map(x => x.a);
      arts = arts.concat(extra.slice(0, max - arts.length));
    }
  }

  return arts;
}
