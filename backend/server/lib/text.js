// Small text helpers shared by the whole backend.

const STOPWORDS = new Set(`a an the and or but of to in on for with at by from as is are was were be been being
it its this that these those your you my me we our they them their he she his her i do does did doing can could
will would should may might must shall not no nor so than then too very just only also about into over under
again further once here there when where why how what which who whom all any both each few more most other some
such own same up down out off if because until while during before after above below between through against
really actually literally truly every everyone anyone someone thing things way get gets got make makes made
true false real fact facts claim claims say says said heard hear told tell believe people know knows let lets
please help question cause causes`.split(/\s+/));

// Words that mean the same thing in health claims, so "kills cancer" matches "destroys cancer".
const SYNONYMS = {
  destroy: 'treat', kill: 'treat', eliminate: 'treat', cure: 'treat', heal: 'treat', fight: 'treat',
  remove: 'treat', dissolve: 'treat', break: 'treat', fix: 'treat', reverse: 'treat',
  drink: 'drink', drinking: 'drink', ingest: 'drink', consume: 'drink',
  virus: 'virus', viral: 'virus', germ: 'bacteria', microbe: 'bacteria',
  tumor: 'cancer', tumour: 'cancer', carcinoma: 'cancer',
  slim: 'weight', fat: 'weight', obesity: 'weight',
  tea: 'drink', juice: 'drink', beverage: 'drink', kernel: 'seed', pit: 'seed',
  cleanse: 'clean', purify: 'clean', detoxify: 'detox',
};

export function decodeEntities(s = '') {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export function stripTags(s = '') {
  return String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Turn XML/HTML-escaped text into clean plain text. */
export function cleanText(s = '') {
  return stripTags(decodeEntities(decodeEntities(s)));
}

/** Important words from a claim, in order, without filler words. */
export function keywords(text = '') {
  const words = String(text).toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w) || /^\d+g$/.test(w)); // keep "5g"
  return [...new Set(words)];
}

function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.length > 4 && w.endsWith('es') && !w.endsWith('ses')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  return SYNONYMS[w] || w;
}

/** Keyword set used for matching a question to a curated myth. */
export function matchTerms(text = '') {
  return new Set(keywords(text).map(stem));
}

export function wordCount(s = '') {
  return String(s).trim().split(/\s+/).filter(Boolean).length;
}

export function truncateWords(s = '', max = 150) {
  const words = String(s).trim().split(/\s+/).filter(Boolean);
  return words.length <= max ? words.join(' ') : words.slice(0, max).join(' ') + '…';
}

export function truncateChars(s = '', max = 1500) {
  s = String(s);
  return s.length <= max ? s : s.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

// Claim "action" words help match myths but hurt PubMed searches
// (papers rarely say "destroys" or "miracle"), so they are dropped from search terms.
const ACTION_WORDS = new Set(`destroy destroys destroyed kill kills killing cure cures curing cured heal heals healing
eliminate eliminates treat treats treating fight fights fighting boost boosts improve improves remove removes
dissolve dissolves break breaks flush flushes cleanse cleanses block blocks stop stops work works help helps
instantly naturally miracle magic daily rapid quick fast immediately best good bad
using use apply applying putting put rub rubbing
dry warm hot cold home body cell cells whole everyday night minutes`.split(/\s+/));

/** Keywords for searching PubMed / MedlinePlus (topic words only). */
export function searchTerms(text = '') {
  return keywords(text).filter(w => !ACTION_WORDS.has(w));
}
