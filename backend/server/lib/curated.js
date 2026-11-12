// Tier 1: the team's curated myth database (myths.json).
// If a question matches a curated myth, we answer from the team's checked sources.
// Claims listed in holdout.json are hidden from the server so they can be used
// as an untouched test set (the server never "sees" them).

import fs from 'node:fs';
import path from 'node:path';
import { matchTerms } from './text.js';

// ---------- Arabic matching ----------
// Arabic claims are compared straight against the team's Arabic wording (claim_text_ar) first,
// so a literal translation can't make them miss. Light normalisation: no diacritics, one form of
// alef/ya/ta marbuta, and common prefixes/suffixes removed ("والحبوب" -> "حبوب").
const AR_STOP = new Set('في من على عن الى إلى الي مع او أو و ثم هذا هذه ذلك التي الذي ان أن إن كل قد لا لن لم ما هو هي يا عند بعد قبل جدا جداً يوم كل_يوم'.split(/\s+/));
function arNorm(w) {
  w = w.replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
  w = w.replace(/^(وال|بال|كال|فال|لل|ال)(?=[\u0621-\u064A]{2,})/, '');   // "والحبوب" -> "حبوب", "الفم" -> "فم"
  w = w.replace(/^ب(?=[\u0621-\u064A]{4,})/, '');                          // "بشريط" -> "شريط"
  w = w.replace(/^و(?=[\u0621-\u064A]{4,})/, '');                          // "ويطرد" -> "يطرد"
  w = w.replace(/^[يت](?=[\u0621-\u064A]{3,})/, '');                       // "يسبب"/"تسبب" -> "سبب"
  if (w.length > 4) w = w.replace(/(ات|ون|ها|هم|ه)$/, '');                  // plurals / attached pronouns
  if (w.length > 4) w = w.replace(/ي$/, '');                                  // "سرطاني" -> "سرطان"
  return w;
}
// Everyday words -> the words used in the team's Arabic text
const AR_SYN = { 'الوفيرا': ['صبار'], 'لوفيرا': ['صبار'], 'الوفيره': ['صبار'], 'الو': [], 'فيرا': ['صبار'],
  'حبوب': ['حب', 'شباب'], 'بثور': ['حب', 'شباب'], 'زكام': ['برد'], 'رشح': ['برد'], 'ديتوكس': ['ديتوكس'],
  'سي': [], 'مزيل': ['مضاد'], 'مزيلات': ['مضاد'], 'جيوب': ['احتقان'], 'زحم': ['احتقان'],
  'لصق': ['شريط', 'لاصق'], 'لزق': ['شريط', 'لاصق'], 'حدد': ['محددا'], 'تحديد': ['محددا'], 'شيا': ['شيا'],
  'وجه': ['بشره'], 'وجهك': ['بشره'], 'وجهي': ['بشره'], 'توهج': ['متوهج'], 'يتوهج': ['متوهج'], 'تتوهج': ['متوهج'] };
const AR_STOP_N = new Set([...AR_STOP].map(w => arNorm(w)));
export function arabicTerms(text = '') {
  text = String(text).replace(/فيتامين\s*\(?\s*(سي|ج|c|C)(?![\u0621-\u064A])\s*\)?/g, 'فيتامينج ').replace(/فيتامين\s*\(?\s*(دي|د|d|D)(?![\u0621-\u064A])\s*\)?/g, 'فيتاميند ');
  const words = String(text).split(/[^\u0621-\u064A\u064B-\u0652]+/).filter(Boolean);
  const out = new Set();
  for (const w of words.map(arNorm)) {
    if (w.length < 2 || AR_STOP.has(w) || AR_STOP_N.has(w)) continue;
    for (const t of (AR_SYN[w] || [w])) out.add(t);
  }
  return out;
}

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
    .map(m => ({ ...m, _terms: matchTerms(prepEn(m.claim_text)), _termsAr: arabicTerms(m.claim_text_ar || '') }));
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
// "vitamin C" and "vitamin D" are different things: keep the letter attached
const EN_SYN = [[/\bfaces?\b/gi, 'skin'], [/\b(pimples?|zits?|breakouts?)\b/gi, 'acne'], [/\balo\b/gi, 'aloe'],
  [/\bdeodorants?\b/gi, 'antiperspirant'], [/\b(glow|glowy|radiant)\b/gi, 'glowing'],
  [/\b(stuffy|blocked|runny)\s+nose\b/gi, 'nose congestion'], [/\b(tanning|sun)\s*beds?\b/gi, 'tanning lamps'],
  [/\btap(e|ed|es)\b/gi, 'taping'],
  [/\bkids?\b/gi, 'children'], [/\bhyper\b/gi, 'hyperactivity'], [/\bACV\b/g, 'apple cider vinegar'], [/\btoothaches\b/gi, 'toothache']];
const prepEn = t => EN_SYN.reduce((x, [re, to]) => x.replace(re, to), String(t)).replace(/vitamin\s+([a-z][0-9]{0,2})\b/gi, 'vitamin$1');

// ---------- Deciding whether two claims are "the same claim" ----------
// Shared words alone aren't enough ("Garlic cures cancer" shares "garlic" and "cures" with
// "Raw garlic cures severe toothaches"). A match also needs:
//   - at least one shared TOPIC word (the thing the claim is about: garlic, aloe vera, antiperspirant...), and
//   - no clash of CONDITIONS (cancer vs toothache, colds vs acne). If both claims name a condition, one must be shared.
// Everyday verbs and filler ("cures", "drinking", "water", "body") are GENERIC and don't count as a topic.
const GENERIC_EN = matchTerms(`drink drinking drinks water cure cures cured treat treats treatment heal heals kill kills killing
  prevent prevents prevention cause causes caused help helps stop stops reduce reduces boost boosts improve improves
  good bad health healthy body daily day every morning eat eating take taking use using get gets rid lose losing make makes
  work works natural quick rapid rapidly fast instantly safe really actually true real best way
  warm hot cold dry empty stomach morning night bedtime glass cup cell cells destroy destroys destroying whiten whitens whitening`);
const COND_EN = matchTerms(`cancer cancers tumor cold colds flu influenza acne pimples liver kidney kidneys stone stones burn burns
  tooth teeth toothache toothaches hair baldness skin wrinkles weight fat obesity cataract cataracts vision eye eyes
  autoimmune disease diseases infection infections bacteria viruses virus congestion sinus hyperactivity energy jawline
  inflammation diabetes blood pressure heart`);
const GENERIC_AR = arabicTerms('سبب يسبب تسبب علاج يعالج تعالج شفاء يشفي تشفي قتل يقتل منع يمنع يقي تقي يقلل تقلل يزيد يساعد ماء شرب يشرب يوم كل مفيد صحه جسم الجسم يخلي يعطي طبيعي سريع بسرعه امن آمن دافئ دافي ساخن بارد صباح صباحا الصبح الريق ريق كوب خلايا خليه الخلايا يدمر تدمر تدمير');
const COND_AR = arabicTerms('سرطان برد انفلونزا زكام حب الشباب كبد كلي كلى حصي حصى حصوات حروق حرق اسنان سن شعر صلع بشره جلد وزن دهون عين بصر الساد مناعه عدوي بكتيريا فيروسات احتقان التهاب سكري ضغط قلب طاقه فك نشاط');

function judge(q, t, generic, cond) {
  let shared = 0, topic = 0, condShared = 0, qCond = 0, tCond = 0;
  for (const w of q) {
    if (cond.has(w)) qCond++;
    if (!t.has(w)) continue;
    shared++;
    if (cond.has(w)) condShared++;
    else if (!generic.has(w)) topic++;
  }
  for (const w of t) if (cond.has(w)) tCond++;
  const clash = qCond > 0 && tCond > 0 && condShared === 0;
  // Similarity counts only meaningful words, so filler ("make", "use", "every day") doesn't water down a match.
  const meaningful = set => { let n = 0; for (const w of set) if (!generic.has(w)) n++; return n; };
  const sharedMeaningful = topic + condShared;
  let score = (2 * sharedMeaningful) / (meaningful(q) + meaningful(t) || 1);
  // Short claims ("celery juice detox") vs the team's long wording: if most of what the user typed is in the
  // team's claim, that's the same claim even though the team's sentence has extra detail.
  const cover = sharedMeaningful / (meaningful(q) || 1);
  if (sharedMeaningful >= 2 && cover >= 0.66) score = Math.max(score, 0.45 + 0.3 * cover);
  return { score, ok: shared >= 2 && topic >= 1 && !clash };
}

function best(q, field, min, generic, cond) {
  let top = null;
  for (const m of myths) {
    const t = m[field];
    if (!t || !t.size) continue;
    const j = judge(q, t, generic, cond);
    if (j.ok && j.score >= min && (!top || j.score > top.score)) top = { myth: m, score: j.score };
  }
  return top;
}

/** The curated myth that is the same claim as the question (English). */
export function matchMyth(query) {
  return best(matchTerms(prepEn(query)), '_terms', Number(process.env.CURATED_MATCH_THRESHOLD || 0.5), GENERIC_EN, COND_EN);
}

/**
 * A claim that isn't close enough to count as the same claim, but is clearly about the same thing
 * (e.g. "Alkaline water prevents cancer" vs the team's "Drinking alkaline water destroys cancer cells").
 * Used to put the team's checked sources and advice link at the top of a live answer.
 */
export function findRelated(query) {
  return best(matchTerms(prepEn(query)), '_terms', Number(process.env.RELATED_MATCH_THRESHOLD || 0.4), GENERIC_EN, COND_EN);
}

/** Arabic claim -> the curated myth with the same meaning, compared with the team's Arabic wording. */
export function matchMythArabic(query) {
  const q = arabicTerms(query);
  if (q.size < 2) return null;
  return best(q, '_termsAr', Number(process.env.CURATED_MATCH_THRESHOLD || 0.5), GENERIC_AR, COND_AR);
}
