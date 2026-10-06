// Banned words for player and team names in the live quiz.
//
// ANY   — banned wherever it appears inside a word (strong roots: "хуй" also catches "нахуй").
// START — banned only at the start of a word, so "лох" doesn't catch "плохо".
// WORD  — banned only as a whole word, so "гей" doesn't catch "гейзер".
//
// Write entries in lower case. Letters repeated in a row are squeezed to one before matching
// ("хууууй" -> "хуй"), and entries are squeezed the same way, so write them normally.
const ANY = [
  // Russian
  'хуй', 'хуе', 'хуя', 'хуи', 'пизд', 'пезд', 'ебат', 'ебан', 'ебал', 'ебло', 'еблан', 'ебну', 'ебуч', 'ебырь',
  'заеб', 'выеб', 'уеб', 'въеб', 'наеб', 'доеб', 'поеб', 'разъеб', 'отъеб', 'съеб', 'долбоеб',
  'пидар', 'пидор', 'пидр', 'педрил', 'педераст', 'гандон', 'гондон', 'мудак', 'мудил', 'мудозвон',
  'шлюх', 'залуп', 'дроч', 'сучк', 'сучар', 'сучон', 'бляд', 'блят', 'сосал', 'отсос',
  'черножоп', 'ниггер', 'нигер', 'мандавош',
  // Transliterated Russian
  'pizd', 'pezd', 'ebat', 'eban', 'ebal', 'pidar', 'pidor', 'pidr', 'blyat', 'blyad', 'suchk', 'mudak', 'zaeb',
  // English
  'fuck', 'fuk', 'shit', 'bitch', 'cunt', 'pussy', 'whore', 'asshole', 'cocksuck', 'nigger', 'nigga',
  'faggot', 'retard', 'hitler', 'porn', 'dickhead',
  // German
  'scheis', 'hurensohn', 'fotze', 'wichser', 'arschloch', 'schwuchtel', 'misgeburt',
];
const START = [
  'лох', 'лошар', 'член', 'бля', 'сука', 'суки', 'сукин', 'херн', 'шалав', 'чурк', 'дебил', 'дегенерат', 'пендос',
  'педик', 'нацик', 'нацист', 'гитлер',
  'slut', 'fick', 'arsch', 'spast', 'nazi',
];
const WORD = [
  'хер', 'гей', 'геи', 'геев', 'гею', 'джей', 'чмо', 'жид', 'жиды', 'жидов', 'хохол', 'хохлы', 'сук', 'суку', 'сукой', 'манда', 'соси', 'хач', 'хачи', 'даун',
  'hui', 'huy', 'hue', 'suka', 'dick', 'dicks', 'cock', 'cocks', 'fag', 'fags', 'gay', 'hure', 'fck', 'wtf', 'sex', 'секс',
];

// Normal words that start like a banned one — never flagged
const ALLOW = ['лохмат', 'лохан', 'лохн', 'членств', 'членик', 'членкор', 'сукно', 'сукон', 'страху', 'застрах'];

// Latin and digit look-alikes read as Cyrillic, and Cyrillic look-alikes read as Latin,
// so "xуй" (Latin x) or "fu©k" style tricks still match.
const TO_CYR = { a: 'а', o: 'о', e: 'е', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в', u: 'и', '0': 'о', '3': 'з', '6': 'б', '@': 'а', '4': 'ч' };
const TO_LAT = { а: 'a', о: 'o', е: 'e', р: 'p', с: 'c', х: 'x', у: 'y', к: 'k', м: 'm', т: 't', н: 'h', в: 'b', и: 'u', '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '@': 'a', '$': 's', '!': 'i', '|': 'i', '©': 'c' };

const squeeze = (s) => s.replace(/(.)\1+/gu, '$1');

const base = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-̂̄-̅̇̊-ͯ]/g, '') // accents, keep ё/й (U+0308, U+0306)
    .normalize('NFC')
    .replace(/ё/g, 'е')
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u');

// Words of one script: split on anything that isn't a letter, then glue runs of single letters
// back together, so "х у й" or "f.u.c.k" become one word again.
function words(text, map, letters) {
  const mapped = [...text].map((ch) => map[ch] ?? ch).join('');
  const raw = mapped.split(new RegExp(`[^${letters}]+`, 'u')).filter(Boolean);
  const out = [];
  let run = '';
  for (const w of raw) {
    if (w.length === 1) { run += w; continue; }
    if (run) { out.push(run); run = ''; }
    out.push(w);
  }
  if (run) out.push(run);
  return out.map(squeeze);
}

const isCyr = (w) => /[а-я]/.test(w);
const lists = [ANY, START, WORD].map((l) => l.map(squeeze));
const allow = ALLOW.map(squeeze);

// Returns true if the text contains a banned word
export function hasBannedWord(text) {
  const t = base(text);
  const variants = [words(t, TO_CYR, 'а-яй'), words(t, TO_LAT, 'a-z')];
  return variants.some((ws, vi) => ws.some((w) => {
    if (allow.some((a) => w.startsWith(a))) return false;
    const want = (entry) => isCyr(entry) === (vi === 0);
    return lists[0].some((e) => want(e) && w.includes(e))
      || lists[1].some((e) => want(e) && w.startsWith(e))
      || lists[2].some((e) => want(e) && w === e);
  }));
}
