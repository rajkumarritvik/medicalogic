// Unanswered-claims database (Jiayi's feedback loop):
// every claim the system could not answer ("Insufficient") is saved here, counted,
// and listed most-asked first, so the research team knows what to add next.
// GET /api/unanswered returns the list.
//
// Where it is saved:
//   - On your computer: a JSON file, server/data/unanswered_claims.json (no database to install).
//   - On Vercel: a free Upstash Redis database, if one is connected to the project
//     (Vercel adds KV_REST_API_URL + KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL + _TOKEN).
//     Without one, Vercel can only keep the list in /tmp, which is wiped often.

import fs from 'node:fs';
import path from 'node:path';
import { keywords } from './text.js';

let file = '';
let db = { claims: {} };

const REDIS_URL = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const useRedis = () => Boolean(REDIS_URL() && REDIS_TOKEN());
const INDEX = 'medicalogic:unanswered:index';   // sorted set: claim key -> times asked
const ITEM = key => `medicalogic:unanswered:item:${key}`;

/** One Redis command over Upstash's REST API, e.g. redis('GET', 'x'). */
async function redis(...command) {
  const res = await fetch(REDIS_URL(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `Redis HTTP ${res.status}`);
  return data.result;
}

export function initUnanswered(serverDir) {
  if (useRedis()) return;
  const dir = process.env.VERCEL ? '/tmp/medicalogic' : path.join(serverDir, 'data');
  file = process.env.UNANSWERED_DB || path.join(dir, 'unanswered_claims.json');
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { file = ''; return; }
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { db = { claims: {} }; }
  if (!db.claims) db.claims = {};
}

/** Same claim worded slightly differently -> same key (sorted keywords). */
function keyFor(query) {
  const kw = keywords(query).sort();
  return kw.length ? kw.join(' ') : query.toLowerCase().trim();
}

function update(entry, key, query, lang, reason, english, now) {
  entry = entry || { key, examples: [], count: 0, first_seen: now, langs: [], reasons: {}, status: 'new' };
  entry.count += 1;
  entry.last_seen = now;
  if (!entry.examples.includes(query) && entry.examples.length < 5) entry.examples.push(query);
  if (!entry.langs.includes(lang)) entry.langs.push(lang);
  if (english && !entry.english) entry.english = english;
  entry.reasons[reason] = (entry.reasons[reason] || 0) + 1;
  return entry;
}

let saving = Promise.resolve();
function save() {
  if (!file) return;
  const snapshot = JSON.stringify(db, null, 2);
  saving = saving.then(() => fs.promises.writeFile(file, snapshot, 'utf8')).catch(err => console.error('Could not save unanswered claims:', err.message));
}

/** Returns a promise; callers don't need to wait for it. Never throws. */
export function recordUnanswered(query, lang, reason, english = '') {
  const key = keyFor(english || query); // Arabic claims are grouped by their English translation
  const now = new Date().toISOString();
  if (useRedis()) {
    return (async () => {
      const old = await redis('GET', ITEM(key));
      const entry = update(old ? JSON.parse(old) : null, key, query.slice(0, 2000), lang, reason, english, now);
      await redis('SET', ITEM(key), JSON.stringify(entry));
      await redis('ZINCRBY', INDEX, 1, key);
    })().catch(err => console.error('Could not save unanswered claim to Redis:', err.message));
  }
  if (!file) return Promise.resolve();
  db.claims[key] = update(db.claims[key], key, query, lang, reason, english, now);
  save();
  return saving;
}

/** Most-asked first. */
export async function listUnanswered(limit = 100) {
  if (useRedis()) {
    const keys = await redis('ZREVRANGE', INDEX, 0, Math.max(0, limit - 1));
    if (!keys || !keys.length) return [];
    const items = await redis('MGET', ...keys.map(ITEM));
    return items.filter(Boolean).map(s => JSON.parse(s));
  }
  return Object.values(db.claims)
    .sort((a, b) => b.count - a.count || (b.last_seen || '').localeCompare(a.last_seen || ''))
    .slice(0, limit);
}
