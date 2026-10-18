// Live MedlinePlus health-topic search (U.S. National Library of Medicine).
// Docs: https://medlineplus.gov/about/developers/webservices/
// Gives plain-language, trusted consumer health pages to show next to the research.
// Rate limit: 85 requests per minute per IP, so calls are spaced 750 ms apart.

import { fetchWithRetry, makeThrottle, UpstreamError } from './http.js';
import { cleanText, truncateChars } from './text.js';

const BASE = () => process.env.MEDLINEPLUS_BASE || 'https://wsearch.nlm.nih.gov/ws/query';
const throttle = makeThrottle(750);

/** @returns [{ title, url, snippet, source: 'MedlinePlus' }] */
export async function searchHealthTopics(kw, max = 2) {
  const term = kw.slice(0, 3).join(' ');
  if (!term) return [];
  const p = new URLSearchParams({ db: 'healthTopics', term, retmax: String(max) });
  const res = await throttle(() => fetchWithRetry('MedlinePlus', `${BASE()}?${p}`));
  if (!res.ok) throw new UpstreamError('MedlinePlus', `HTTP ${res.status}`, res.status);
  const xml = await res.text();
  const out = [];
  for (const m of xml.matchAll(/<document[^>]*\burl="([^"]+)"[^>]*>([\s\S]*?)<\/document>/g)) {
    const body = m[2];
    const field = name => body.match(new RegExp(`<content name="${name}">([\\s\\S]*?)</content>`))?.[1] || '';
    const title = cleanText(field('title'));
    if (!title) continue;
    out.push({
      title,
      url: m[1].replace(/&amp;/g, '&'),
      snippet: truncateChars(cleanText(field('FullSummary') || field('snippet')), 600),
      source: 'MedlinePlus',
    });
    if (out.length >= max) break;
  }
  return out;
}
