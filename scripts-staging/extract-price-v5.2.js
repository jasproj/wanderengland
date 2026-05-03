/**
 * Price extractor v5.2 — Cat-D Dominant-Price Gate on top of v5.4.
 *
 * v5.2 is a NEW promotion path layered on the existing v5.4 extractor.
 * It does NOT relax any existing rule. After v5.4 returns a result, if
 * confidence === 'low' the gate is evaluated. If the gate passes, the
 * result is promoted from low → medium and tagged with
 * priceSource: 'v52-dominant-gate'. Otherwise the result is returned
 * unchanged.
 *
 * Gate criteria (ALL must pass):
 *   1. v5.4 captured a price (price !== null)
 *   2. Distinct $-values present in the page text ≤ 2
 *   3. Captured price is one of those distinct values (literal match,
 *      not derived/computed)
 *   4. No disqualifier token within ±40 chars of the matched $-token
 *
 * Zero-FP intent: the gate only graduates pages that look like a
 * single dominant price line. It cannot weaken v5.4.
 *
 * Existing v5.4 logic below is unchanged from extract-price-v5.js
 * (currency-symbol whitespace tolerance, comma-thousands prices, etc).
 */

const CURRENCY_CONFIG = {
  USD: { regex: '\\$', display: '$' },
  EUR: { regex: '(?:€|EUR\\s?)', display: '€' },
  GBP: { regex: '(?:£|GBP\\s?)', display: '£' },
  NZD: { regex: '(?:NZ\\$|NZD\\s?)', display: 'NZ$' },
};

const D = '\\d+(?:,\\d{3})*';
const WS = '\\s*';

const toInt = s => parseInt(String(s).replace(/,/g, ''), 10);

function pricePattern(n) {
  const s = String(n);
  if (s.length <= 3) return s;
  const firstLen = ((s.length - 1) % 3) + 1;
  let out = s.slice(0, firstLen);
  for (let i = firstLen; i < s.length; i += 3) {
    out += ',?' + s.slice(i, i + 3);
  }
  return out;
}

function extract_price(pageText, currency = 'USD') {
  const result = { price: null, priceConfidence: null, priceLabel: null };

  if (!pageText) return result;

  const cfg = CURRENCY_CONFIG[currency];
  if (!cfg) {
    console.warn(`Unknown currency '${currency}', falling back to USD`);
    return extract_price(pageText, 'USD');
  }
  const C = cfg.regex;

  const text = pageText.replace(/\s+/g, ' ');

  const adultPriceFirst = text.match(
    new RegExp(`${C}${WS}(${D})(?:[\\.,]\\d{2})?\\s+Adults?\\b(?!\\s+Only)`, 'i')
  );
  if (adultPriceFirst) {
    const val = toInt(adultPriceFirst[1]);
    if (val >= 15 && val <= 9999) {
      result.price = val;
      result.priceConfidence = 'high';
      result.priceLabel = 'per adult';
      return result;
    }
  }

  const adultLabelFirst = text.match(
    new RegExp(`\\bAdults?\\b(?:\\s*\\([^)]*\\))?\\s*${C}${WS}(${D})(?:[\\.,]\\d{2})?\\b`, 'i')
  );
  if (adultLabelFirst) {
    const val = toInt(adultLabelFirst[1]);
    if (val >= 15 && val <= 9999) {
      result.price = val;
      result.priceConfidence = 'high';
      result.priceLabel = 'per adult';
      return result;
    }
  }

  const perPerson = text.match(
    new RegExp(`${C}${WS}(${D})(?:[\\.,]\\d{2})?\\s*(?:per\\s+(?:person|guest|adult|pax)|\\/\\s*(?:person|guest|adult|pax))`, 'i')
  );
  if (perPerson) {
    const val = toInt(perPerson[1]);
    if (val >= 15 && val <= 9999) {
      result.price = val;
      result.priceConfidence = 'high';
      result.priceLabel = 'per person';
      return result;
    }
  }

  const startingAt = text.match(
    new RegExp(`(?:Starting\\s+(?:at|from)|From|Prices?\\s+from)\\s+${C}${WS}(${D})(?:[\\.,]\\d{2})?\\b`, 'i')
  );
  if (startingAt) {
    const val = toInt(startingAt[1]);
    if (val >= 15 && val <= 99999) {
      result.price = val;
      result.priceConfidence = 'medium';
      result.priceLabel = 'starting at';
      return result;
    }
  }

  const isCharter = /\b(private\s+charter|full\s+day\s+charter|half\s+day\s+charter)\b/i.test(text);
  if (isCharter) {
    const allPrices = [...text.matchAll(new RegExp(`${C}${WS}(${D})(?:[\\.,]\\d{2})?\\b`, 'g'))]
      .map(m => toInt(m[1]))
      .filter(v => v >= 300 && v <= 50000);
    if (allPrices.length > 0) {
      result.price = Math.max(...allPrices);
      result.priceConfidence = 'medium';
      result.priceLabel = 'charter';
      return result;
    }
  }

  const pricingSection = extractPricingSection(text);
  if (pricingSection) {
    const candidates = [...pricingSection.matchAll(new RegExp(`${C}${WS}(${D})(?:[\\.,]\\d{2})?\\b`, 'g'))];
    for (const m of candidates) {
      const val = toInt(m[1]);
      if (val < 15 || val > 9999) continue;

      const start = Math.max(0, m.index - 40);
      const context = pricingSection.slice(start, m.index).toLowerCase();
      if (/\b(deposit|fee|age|ages|years?\s+old|child|kid|toddler|infant|under)\b/.test(context)) {
        continue;
      }
      const after = pricingSection.slice(m.index, m.index + 30).toLowerCase();
      if (/\b(child|kids?|toddler|infant|deposit|fee)\b/.test(after)) {
        continue;
      }

      result.price = val;
      result.priceConfidence = 'low';
      result.priceLabel = 'unknown';
      return result;
    }
  }

  const calendar = extractPriceMethod6_calendar(pageText, C);
  if (calendar) {
    result.price = calendar.price;
    result.priceConfidence = calendar.priceConfidence;
    result.priceLabel = calendar.priceLabel;
    return result;
  }

  return result;
}

function extractPriceMethod6_calendar(pageText, currencyRegex) {
  const C = currencyRegex || '\\$';
  const priceMatches = [...pageText.matchAll(new RegExp(`${C}${WS}(${D})(?:[\\.,]\\d{2})?`, 'g'))];
  if (priceMatches.length < 3) return null;

  const priceCounts = {};
  priceMatches.forEach(m => {
    const p = toInt(m[1]);
    if (p < 10 || p > 5000) return;
    priceCounts[p] = (priceCounts[p] || 0) + 1;
  });

  const repeated = Object.entries(priceCounts)
    .filter(([_, count]) => count >= 3)
    .map(([price]) => parseInt(price, 10));
  if (repeated.length === 0) return null;

  const validCandidates = repeated.filter(price => {
    const pp = pricePattern(price);
    const after = new RegExp(`${C}${WS}${pp}(?:[\\.,]\\d{2})?\\s{1,5}(\\d{1,2})\\b`, 'g');
    const before = new RegExp(`\\b(\\d{1,2})\\b\\s{1,5}${C}${WS}${pp}(?:[\\.,]\\d{2})?\\b`, 'g');
    const adjacencyMatches = [...pageText.matchAll(after), ...pageText.matchAll(before)];
    const validDays = adjacencyMatches.filter(m => {
      const day = parseInt(m[1], 10);
      return day >= 1 && day <= 31;
    });
    return validDays.length >= 3;
  });

  if (validCandidates.length === 0) return null;

  const price = Math.min(...validCandidates);
  return {
    price,
    priceConfidence: 'medium',
    priceLabel: 'from',
    priceMethod: 6
  };
}

function extractPricingSection(text) {
  const match = text.match(/Pricing[\s\S]{0,2000}?(?=Cancellation|Description|What's Included|$)/i);
  return match ? match[0] : text;
}

// ─── v5.2 DOMINANT-PRICE GATE ─────────────────────────────────────────
// Disqualifier tokens checked in a ±40 char window around the matched
// $-token. Word-boundary regex on each so we don't match e.g. "feet"
// for "fee" or "tax" inside "tax-free".
const DISQUALIFIER_TOKENS = [
  'deposit', 'fee', 'surcharge', 'tax', 'tip', 'gratuity',
  'add-on', 'addon',
  'child', 'children', 'kid', 'kids',
  'junior', 'senior', 'discount',
  'additional', 'extra', 'option', 'optional', 'rental', 'nitrox',
  'upgrade', 'supplement',
];
const DISQUALIFIER_RE = new RegExp(
  '\\b(' + DISQUALIFIER_TOKENS.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
  'i'
);

function applyDominantGate(v54Result, pageText, currency = 'USD') {
  const out = {
    ...v54Result,
    gateResult: {
      passed: false,
      criterionFailed: null,
      distinctDollarValues: [],
      capturedMatchToken: null,
      contextWindow: null,
      disqualifierToken: null,
    },
  };

  // Criterion 1: v5.4 captured a price
  if (v54Result.price === null || v54Result.price === undefined) {
    out.gateResult.criterionFailed = 1;
    return out;
  }

  if (!pageText) {
    out.gateResult.criterionFailed = 1;
    return out;
  }

  const cfg = CURRENCY_CONFIG[currency] || CURRENCY_CONFIG.USD;
  const C = cfg.regex;
  const text = pageText.replace(/\s+/g, ' ');

  // Find every $N occurrence (with optional thousands commas / .NN cents).
  const matches = [...text.matchAll(
    new RegExp(`${C}${WS}(${D})(?:[\\.,]\\d{2})?`, 'g')
  )];
  const distinctValues = new Set(matches.map(m => toInt(m[1])));
  out.gateResult.distinctDollarValues = [...distinctValues].sort((a, b) => a - b);

  // Criterion 2: ≤ 2 distinct dollar values in the page
  if (distinctValues.size > 2) {
    out.gateResult.criterionFailed = 2;
    return out;
  }

  // Criterion 3: captured price is one of those literal values
  if (!distinctValues.has(v54Result.price)) {
    out.gateResult.criterionFailed = 3;
    return out;
  }

  // Locate the first $-token whose integer value matches the captured price.
  const targetMatch = matches.find(m => toInt(m[1]) === v54Result.price);
  if (!targetMatch) {
    out.gateResult.criterionFailed = 3;
    return out;
  }
  out.gateResult.capturedMatchToken = targetMatch[0];

  const idx = targetMatch.index;

  // Add-on idiom guard: if the literal char immediately before the
  // matched `$` is `+`, this is a "+$N" upsell line ("...is +$20",
  // "...option available +$271"), not a per-tour price. Reject.
  if (idx > 0 && text[idx - 1] === '+') {
    out.gateResult.criterionFailed = 4;
    out.gateResult.disqualifierToken = '+$';
    out.gateResult.contextWindow = text.slice(
      Math.max(0, idx - 40),
      Math.min(text.length, idx + targetMatch[0].length + 40)
    );
    return out;
  }

  const winStart = Math.max(0, idx - 40);
  const winEnd = Math.min(text.length, idx + targetMatch[0].length + 40);
  const window = text.slice(winStart, winEnd);
  out.gateResult.contextWindow = window;

  // Criterion 4: no disqualifier token in the ±40 char window
  const dq = window.match(DISQUALIFIER_RE);
  if (dq) {
    out.gateResult.criterionFailed = 4;
    out.gateResult.disqualifierToken = dq[1].toLowerCase();
    return out;
  }

  // Gate passes — promote.
  out.priceConfidence = 'medium';
  out.priceSource = 'v52-dominant-gate';
  out.gateResult.passed = true;
  return out;
}

function extract_price_v52(pageText, currency = 'USD') {
  const v54 = extract_price(pageText, currency);
  if (v54.priceConfidence !== 'low') return v54;
  return applyDominantGate(v54, pageText, currency);
}

module.exports = {
  extract_price,
  extract_price_v52,
  applyDominantGate,
  DISQUALIFIER_TOKENS,
  CURRENCY_CONFIG,
};
