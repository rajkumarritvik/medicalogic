// Live MedlinePlus health-topic search (U.S. National Library of Medicine).
// Docs: https://medlineplus.gov/about/developers/webservices/
// Gives plain-language, trusted consumer health pages to show next to the research.
// Rate limit: 85 requests per minute per IP, so calls are spaced 750 ms apart.

import { fetchWithRetry, makeThrottle, UpstreamError } from './http.js';
import { cleanText, truncateChars, matchTerms } from './text.js';

// Words that say nothing about the topic, so they can't make a page count as relevant.
const SKIP = matchTerms('good bad health healthy body cause causes help helps cure cures treat treats treatment eat eating drink drinking make makes use using daily every day improve improves prevent prevents boost boosts reduce reduces stop stops people really actually true natural');

const BASE = () => process.env.MEDLINEPLUS_BASE || 'https://wsearch.nlm.nih.gov/ws/query';
const throttle = makeThrottle(750);

/**
 * Plain-language MedlinePlus pages, but only ones that are actually about the claim.
 * MedlinePlus matches words anywhere on a page, so "alcohol gut" can return "Sexual Assault" (the page mentions
 * alcohol). We look at a bigger pool and keep a page only if its title names something from the claim and the
 * page covers the claim's other key words too.
 * @returns [{ title, url, snippet, source: 'MedlinePlus' }]
 */
export async function searchHealthTopics(kw, max = 2, claimText = '') {
  const term = kw.slice(0, 3).join(' ');
  if (!term) return [];
  const want = [...matchTerms(`${claimText} ${kw.join(' ')}`)].filter(t => !SKIP.has(t));
  if (!want.length) return [];
  const p = new URLSearchParams({ db: 'healthTopics', term, retmax: '15' });
  const res = await throttle(() => fetchWithRetry('MedlinePlus', `${BASE()}?${p}`));
  if (!res.ok) throw new UpstreamError('MedlinePlus', `HTTP ${res.status}`, res.status);
  const xml = await res.text();
  const pool = [];
  for (const m of xml.matchAll(/<document[^>]*\burl="([^"]+)"[^>]*>([\s\S]*?)<\/document>/g)) {
    const body = m[2];
    const field = name => body.match(new RegExp(`<content name="${name}">([\\s\\S]*?)</content>`))?.[1] || '';
    const title = cleanText(field('title'));
    if (!title) continue;
    const summary = cleanText(field('FullSummary') || field('snippet'));
    const inTitle = matchTerms(title), inPage = matchTerms(`${title} ${summary}`);
    const titleHits = want.filter(t => inTitle.has(t)).length;
    const pageHits = want.filter(t => inPage.has(t)).length;
    // Title must name the claim's topic; with 2+ key words, the page must cover at least 2 of them.
    if (titleHits < 1 || pageHits < Math.min(2, want.length)) continue;
    pool.push({ titleHits, pageHits, item: {
      title,
      url: m[1].replace(/&amp;/g, '&'),
      snippet: truncateChars(summary, 600),
      source: 'MedlinePlus',
    } });
  }
  pool.sort((a, b) => b.titleHits - a.titleHits || b.pageHits - a.pageHits);
  return pool.slice(0, max).map(x => x.item);
}
