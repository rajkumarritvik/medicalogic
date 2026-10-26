// Unanswered-claims database (Jiayi's feedback loop):
// every claim the system could not answer ("Insufficient") is saved here, counted,
// and listed most-asked first, so the research team knows what to add next.
//
// Stored as a simple JSON file (server/data/unanswered_claims.json) - no database
// program to install. GET /api/unanswered returns the list.

import fs from 'node:fs';
import path from 'node:path';
import { keywords } from './text.js';

let file = '';
let db = { claims: {} };

export function initUnanswered(serverDir) {
  file = process.env.UNANSWERED_DB || path.join(serverDir, 'data', 'unanswered_claims.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { db = { claims: {} }; }
  if (!db.claims) db.claims = {};
}

/** Same claim worded slightly differently -> same key (sorted keywords). */
function keyFor(query) {
  const kw = keywords(query).sort();
  return kw.length ? kw.join(' ') : query.toLowerCase().trim();
}

let saving = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(db, null, 2);
  saving = saving.then(() => fs.promises.writeFile(file, snapshot, 'utf8')).catch(err => console.error('Could not save unanswered claims:', err.message));
}

export function recordUnanswered(query, lang, reason, english = '') {
  if (!file) return;
  const key = keyFor(english || query); // Arabic claims are grouped by their English translation

  const now = new Date().toISOString();
  const entry = db.claims[key] || { key, examples: [], count: 0, first_seen: now, langs: [], reasons: {}, status: 'new' };
  entry.count += 1;
  entry.last_seen = now;
  if (!entry.examples.includes(query) && entry.examples.length < 5) entry.examples.push(query);
  if (!entry.langs.includes(lang)) entry.langs.push(lang);
  if (english && !entry.english) entry.english = english;
  entry.reasons[reason] = (entry.reasons[reason] || 0) + 1;
  db.claims[key] = entry;
  save();
}

/** Most-asked first. */
export function listUnanswered(limit = 100) {
  return Object.values(db.claims)
    .sort((a, b) => b.count - a.count || (b.last_seen || '').localeCompare(a.last_seen || ''))
    .slice(0, limit);
}
