// Emotional Manipulation Meter: scores how much a post's WORDING relies on pressure
// instead of evidence, from 0 (neutral) to 100 (highly manipulative).
// It looks only at the text the user pasted, not at whether the claim is true.
//
// Four parts, up to 25 points each (the 4 tags on the website's meter card):
//   Absolutism        "guaranteed", "100%", "always", "cures"...
//   Fear/Conspiracy   "doctors don't want you to know", "toxic", "big pharma"...
//   Sensationalism    "miracle", "life hack", "!!!", ALL-CAPS words...
//   Lack of hedging   makes a health claim without "may", "might", "some studies"...
// Transparent word lists (English + Arabic) so the team can explain every score.

const LEX = {
  absolutism: {
    en: ['guaranteed', 'guarantee', '100%', 'always', 'never fails', 'never', 'completely', 'totally', 'permanently',
      'instantly', 'forever', 'definitely', 'no doubt', 'proven', 'cures', 'cure', 'cured', 'heals', 'eliminates',
      'destroys', 'every time', 'all diseases', 'the only way', 'no side effects', 'works for everyone', 'in just one',
      'overnight', 'in one night', 'while you sleep', 'within days', 'in days', 'in 24 hours', 'reverses', 'melts', 'wipes out',
      'chronic', 'never get sick', 'no need for', '100% natural', 'clinically proven', 'completely safe', 'zero risk'],
    ar: ['مضمون', 'مضمونة', 'دائما', 'دائماً', 'أبدا', 'أبداً', 'تماما', 'تماماً', 'نهائيا', 'نهائياً', 'فورا', 'فوراً',
      'مؤكد', 'مثبت', 'يعالج', 'يشفي', 'علاج نهائي', 'يقضي على', 'بدون أي آثار', 'الطريقة الوحيدة', '100%',
      'في ليلة واحدة', 'بين ليلة وضحاها', 'خلال أسبوع', 'خلال أيام', 'أثناء النوم', 'يذيب', 'آمن تماماً', 'طبيعي 100%'],
  },
  fear: {
    en: ["doctors don't want", 'doctors dont want', "don't want you to know", "don't want you to", "doesn't want you to",
      'want you to find out', "they don't tell you", 'they hide', 'hidden', 'secret', 'cover up',
      'cover-up', 'big pharma', 'pharmacy', 'pharmaceutical companies', 'conspiracy', 'toxic', 'toxins', 'poison',
      'dangerous', 'deadly', 'killing you', 'dying', 'wake up', 'banned', 'they lie', 'your doctor will never tell you',
      'terrified', 'afraid', 'hiding', 'hide', 'intentionally', 'keep you sick', 'medical boards', 'hospitals are', 'doctors hate',
      'expensive prescriptions', 'profit', 'profits', 'greedy', 'censored', 'suppressed', 'silenced', 'mainstream media',
      'they want you', 'poisoning', 'chemicals', 'before they delete', 'the truth about'],
    ar: ['الأطباء لا يريدون', 'لا يريدونك أن تعرف', 'لا يريدك أن', 'لا يريدونك أن', 'شركات الأدوية', 'الصيدلية', 'سري', 'مؤامرة', 'سموم', 'سام',
      'خطير', 'قاتل', 'يخفون', 'ممنوع', 'لن يخبرك طبيبك',
      'يخفي', 'يخفونه', 'خائفون', 'المستشفيات', 'لإبقائك مريضاً', 'باهظة', 'أرباح', 'الحقيقة التي', 'قبل الحذف', 'محظور', 'مواد كيميائية'],
  },
  sensational: {
    en: ['miracle', 'magic', 'shocking', 'amazing', 'incredible', 'unbelievable', "you won't believe", 'life hack', 'hack',
      'wonder', 'game changer', 'insane', 'mind-blowing', 'thank me later', 'secret trick', 'in minutes',
      'one simple', 'this one', 'weird trick', 'simple trick', 'trick', 'life-changing', 'share before', 'share this',
      'act now', 'before it is too late', 'before it\'s too late', 'must see', 'breakthrough', 'superfood', 'root extract',
      'detox', 'cleanse', 'flush out', 'flushes out', 'saved my', 'clean your liver'],
    ar: ['معجزة', 'سحري', 'سحرية', 'مذهل', 'صادم', 'لا يصدق', 'خدعة', 'حيلة', 'رهيب', 'اشكرني لاحقا', 'في دقائق',
      'شارك قبل', 'شارك هذا', 'سر بسيط', 'وصفة بسيطة', 'اكتشاف', 'ديتوكس', 'يطرد السموم', 'أنقذ'],
  },
  hedge: {
    en: ['may', 'might', 'could', 'can help', 'some studies', 'research suggests', 'studies suggest', 'possibly', 'likely',
      'in some people', 'according to', 'evidence suggests', 'talk to your doctor', 'consult'],
    ar: ['قد', 'ربما', 'يمكن', 'بعض الدراسات', 'تشير الأبحاث', 'تشير الدراسات', 'محتمل', 'وفقا', 'استشر'],
  },
};

const TAGS = {
  absolutism: { en: 'Absolutism', ar: 'الجزم المطلق' },
  fear: { en: 'Fear/Conspiracy', ar: 'الخوف / المؤامرة' },
  sensational: { en: 'Sensationalism', ar: 'الإثارة والتهويل' },
  hedging: { en: 'Lack of hedging', ar: 'غياب التحفظ في الصياغة' },
};

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function findAll(text, words) {
  const hits = [];
  const lower = text.toLowerCase();
  for (const w of words) {
    let re;
    if (/^[a-z' -]+$/i.test(w)) {
      // English: whole words only ("may" must not match "mayonnaise").
      re = new RegExp(`(^|[^a-z])${escapeRe(w.toLowerCase())}(?=$|[^a-z])`, 'i');
    } else if (/[\u0600-\u06FF]/.test(w)) {
      // Arabic: whole words, allowing the attached prefixes و ف ب ل ال ("قد" must not match "قدم").
      re = new RegExp(`(^|[^\\u0621-\\u064A\\u064B-\\u065F\\u0660-\\u0669])(?:[وفبل]?(?:ال)?)${escapeRe(w)}(?=$|[^\\u0621-\\u064A\\u064B-\\u065F\\u0660-\\u0669])`, 'u');
    } else {
      re = new RegExp(escapeRe(w)); // symbols like "100%"
    }
    if (re.test(lower)) hits.push(w);
  }
  // Drop words contained in a longer hit ("cure" inside "cures", "never" inside "never fails").
  return hits.filter(h => !hits.some(o => o !== h && o.toLowerCase().includes(h.toLowerCase())));
}

export function analyzeManipulation(text = '', lang = 'en') {
  const both = key => [...LEX[key].en, ...LEX[key].ar];
  const found = {
    absolutism: findAll(text, both('absolutism')),
    fear: findAll(text, both('fear')),
    sensational: findAll(text, both('sensational')),
  };
  const hedges = findAll(text, both('hedge'));
  const exclaims = (text.match(/!/g) || []).length;
  const capsWords = (text.match(/\b[A-Z]{4,}\b/g) || []).filter(w => !['NYAS', 'COVID', 'HIV', 'AIDS', 'DNA', 'FDA', 'WHO'].includes(w));
  const isQuestion = /\?\s*$|^\s*(is|are|does|do|can|should|will|هل)\b/i.test(text.trim());

  const parts = {
    absolutism: Math.min(25, found.absolutism.length * 10),
    fear: Math.min(25, found.fear.length * 10),
    sensational: Math.min(25, found.sensational.length * 8 + Math.min(exclaims, 3) * 3 + Math.min(capsWords.length, 2) * 4),
    hedging: isQuestion ? 0 : Math.max(0, 25 - hedges.length * 12),
  };
  // A short neutral sentence should not score high just for lacking "may":
  // only count missing hedges fully when some other pressure signal is present.
  if (parts.absolutism + parts.fear + parts.sensational === 0) parts.hedging = Math.min(parts.hedging, 10);

  const score = Math.round(parts.absolutism + parts.fear + parts.sensational + parts.hedging);
  const level = score >= 60 ? 'high' : score >= 30 ? 'moderate' : 'low';
  const tags = Object.keys(parts)
    .filter(k => parts[k] >= (k === 'hedging' ? 20 : 8))
    .map(k => ({ key: k, label: TAGS[k][lang] || TAGS[k].en, points: parts[k] }));

  const examples = [...found.absolutism, ...found.fear, ...found.sensational].slice(0, 2);
  let explanation;
  if (lang === 'ar') {
    const lvl = { high: 'مرتفع', moderate: 'متوسط', low: 'منخفض' }[level];
    explanation = `نرى أن مستوى التلاعب في صياغة هذا النص ${lvl}.` +
      (examples.length ? ` كلمات مثل ${examples.map(e => `“${e}”`).join(' و')} تزيد الضغط بدلاً من الأدلة.` : '') +
      (parts.hedging >= 20 ? ' ولا يستخدم كلمات تحفّظ مثل “قد” أو “ربما”.' : '');
  } else {
    const lvl = { high: 'highly manipulative', moderate: 'moderately manipulative', low: 'mostly neutral' }[level];
    explanation = `We think this wording is ${lvl}.` +
      (examples.length ? ` Words like ${examples.map(e => `‘${e}’`).join(' and ')} add pressure instead of evidence.` : '') +
      (parts.hedging >= 20 ? ' It never says ‘may’ or ‘might’.' : '');
  }

  return {
    score,
    level,
    tags,
    parts,
    matches: { ...found, hedges, exclamation_marks: exclaims, all_caps_words: capsWords },
    explanation,
  };
}
