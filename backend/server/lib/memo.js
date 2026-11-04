// Verdict memory: once a NEW (live-search) claim has been answered, its verdict is remembered for 7 days,
// so the same claim asked again, in English or Arabic, gets the same verdict.
// Saved in the Upstash Redis database on Vercel (same one as the unanswered claims), or in memory locally.

import { keywords } from './text.js';

const URL_ = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const TTL_SEC = 7 * 24 * 3600;
const local = new Map();

async function redis(...command) {
  const res = await fetch(URL_(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `Redis HTTP ${res.status}`);
  return data.result;
}

/** Same claim worded a little differently -> same key (sorted keywords of the English claim). */
export function memoKey(englishClaim) {
  const kw = keywords(englishClaim).sort();
  return 'medicalogic:verdict:' + (kw.length ? kw.join(' ') : englishClaim.toLowerCase().trim());
}

export async function getVerdict(key) {
  try {
    if (URL_() && TOKEN()) return (await redis('GET', key)) || '';
    const hit = local.get(key);
    return hit && hit.until > Date.now() ? hit.verdict : '';
  } catch { return ''; }
}

export async function saveVerdict(key, verdict) {
  try {
    if (URL_() && TOKEN()) await redis('SET', key, verdict, 'EX', TTL_SEC);
    else local.set(key, { verdict, until: Date.now() + TTL_SEC * 1000 });
  } catch (err) { console.error('Could not save verdict memory:', err.message); }
}
