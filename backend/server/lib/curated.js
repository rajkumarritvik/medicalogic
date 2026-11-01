// Tier 1: the team's curated myth database (myths.json).
// If a question matches a curated myth, we answer from the team's checked sources.
// Claims listed in holdout.json are hidden from the server so they can be used
// as an untouched test set (the server never "sees" them).

import fs from 'node:fs';
import path from 'node:path';
import { matchTerms } from './text.js';

let myths = [];
let loadedFrom = '';

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function loadMyths(serverDir) {
  const mythsPath = process.env.MYTHS_PATH || path.join(serverDir, '..', 'myths.json');
  const holdoutPath = process.env.HOLDOUT_PATH || path.join(serverDir, '..', 'holdout.json');
  const all = readJSON(mythsPath, []);
  // Normally every claim is used, so any claim from the team's spreadsheet gets the team's answer and links.
  // For the holdout test (evaluate.py --set holdout), start the server with HIDE_HOLDOUT=on
  // so the 5 holdout claims are hidden and the live search is tested fairly.
  const hide = process.env.HIDE_HOLDOUT === 'on';
  const holdout = new Set(hide ? (readJSON(holdoutPath, { holdout_ids: [] }).holdout_ids || []) : []);
  myths = all
    .filter(m => !holdout.has(m.id))
    .map(m => ({ ...m, _terms: matchTerms(m.claim_text) }));
  loadedFrom = mythsPath;
  hiddenCount = all.length - myths.length;
  return { loaded: myths.length, hidden: all.length - myths.length, path: mythsPath };
}

export function mythCount() { return myths.length; }
let hiddenCount = 0;
export function holdoutHidden() { return hiddenCount > 0; }
export function mythsPath() { return loadedFrom; }

/**
 * Find the curated myth that best matches a question.
 * Score = Dice overlap of key terms (0..1). Needs >= 2 shared terms and score >= threshold.
 */
export function matchMyth(query) {
  const q = matchTerms(query);
  const threshold = Number(process.env.CURATED_MATCH_THRESHOLD || 0.5);
  let best = null;
  for (const m of myths) {
    let shared = 0;
    for (const t of q) if (m._terms.has(t)) shared++;
    const score = (2 * shared) / (q.size + m._terms.size || 1);
    if (shared >= 2 && score >= threshold && (!best || score > best.score)) best = { myth: m, score };
  }
  return best;
}

/**
 * A claim that isn't close enough to count as the same claim, but is clearly about the same thing
 * (e.g. "Alkaline water prevents cancer" vs the team's "Drinking alkaline water destroys cancer cells").
 * Used to put the team's checked sources and advice link at the top of a live answer.
 */
export function findRelated(query) {
  const q = matchTerms(query);
  const min = Number(process.env.RELATED_MATCH_THRESHOLD || 0.4);
  let best = null;
  for (const m of myths) {
    let shared = 0;
    for (const t of q) if (m._terms.has(t)) shared++;
    const score = (2 * shared) / (q.size + m._terms.size || 1);
    if (shared >= 2 && score >= min && (!best || score > best.score)) best = { myth: m, score };
  }
  return best;
}
