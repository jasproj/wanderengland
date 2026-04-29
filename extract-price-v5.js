/**
 * Patched price extractor v5.2 — currency-parameterized
 *
 * v5.1: Method 1 fix (price/label order)
 * v5.2: currency parameter (USD default; supports EUR, GBP, NZD)
 *
 * Usage: extract_price(pageText)         // USD default
 *        extract_price(pageText, 'EUR')  // €
 *        extract_price(pageText, 'GBP')  // £
 *        extract_price(pageText, 'NZD')  // NZ$
 */

const CURRENCY_CONFIG = {
  USD: { regex: '\\$', display: '$' },
  EUR: { regex: '(?:€|EUR\\s?)', display: '€' },
  GBP: { regex: '(?:£|GBP\\s?)', display: '£' },
  NZD: { regex: '(?:NZ\\$|NZD\\s?)', display: 'NZ$' },
};

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

  // ─── METHOD 1: Adult tier (HIGHEST CONFIDENCE) ──────────────────
  // 1a: price-first format ({CUR}N Adults)
  const adultPriceFirst = text.match(
    new RegExp(`${C}(\\d{2,4})(?:\\.\\d{2})?\\s+Adults?\\b(?!\\s+Only)`, 'i')
  );
  if (adultPriceFirst) {
    const val = parseInt(adultPriceFirst[1], 10);
    if (val >= 15 && val <= 9999) {
      result.price = val;
      result.priceConfidence = 'high';
      result.priceLabel = 'per adult';
      return result;
    }
  }

  // 1b: label-first format (Adult {CUR}N)
  const adultLabelFirst = text.match(
    new RegExp(`\\bAdults?\\b(?:\\s*\\([^)]*\\))?\\s*${C}(\\d{2,4})(?:\\.\\d{2})?\\b`, 'i')
  );
  if (adultLabelFirst) {
    const val = parseInt(adultLabelFirst[1], 10);
    if (val >= 15 && val <= 9999) {
      result.price = val;
      result.priceConfidence = 'high';
      result.priceLabel = 'per adult';
      return result;
    }
  }

  // ─── METHOD 2: Per-person context (HIGH CONFIDENCE) ─────────────
  const perPerson = text.match(
    new RegExp(`${C}(\\d{2,4})(?:\\.\\d{2})?\\s*(?:per\\s+(?:person|guest|adult|pax)|\\/\\s*(?:person|guest|adult|pax))`, 'i')
  );
  if (perPerson) {
    const val = parseInt(perPerson[1], 10);
    if (val >= 15 && val <= 9999) {
      result.price = val;
      result.priceConfidence = 'high';
      result.priceLabel = 'per person';
      return result;
    }
  }

  // ─── METHOD 3: "Starting at" / "From {CUR}X" (MEDIUM) ───────────
  const startingAt = text.match(
    new RegExp(`(?:Starting\\s+(?:at|from)|From|Prices?\\s+from)\\s+${C}(\\d{2,5})(?:\\.\\d{2})?\\b`, 'i')
  );
  if (startingAt) {
    const val = parseInt(startingAt[1], 10);
    if (val >= 15 && val <= 99999) {
      result.price = val;
      result.priceConfidence = 'medium';
      result.priceLabel = 'starting at';
      return result;
    }
  }

  // ─── METHOD 4: Charter floor (MEDIUM) ───────────────────────────
  const isCharter = /\b(private\s+charter|full\s+day\s+charter|half\s+day\s+charter)\b/i.test(text);
  if (isCharter) {
    const allPrices = [...text.matchAll(new RegExp(`${C}(\\d{3,5})(?:\\.\\d{2})?\\b`, 'g'))]
      .map(m => parseInt(m[1], 10))
      .filter(v => v >= 300 && v <= 50000);
    if (allPrices.length > 0) {
      result.price = Math.max(...allPrices);
      result.priceConfidence = 'medium';
      result.priceLabel = 'charter';
      return result;
    }
  }

  // ─── METHOD 5: Fallback in Pricing section (LOW) ────────────────
  const pricingSection = extractPricingSection(text);
  if (pricingSection) {
    const candidates = [...pricingSection.matchAll(new RegExp(`${C}(\\d{2,4})(?:\\.\\d{2})?\\b`, 'g'))];
    for (const m of candidates) {
      const val = parseInt(m[1], 10);
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

  // ─── METHOD 6: Calendar-cell repeated price (MEDIUM) ────────────
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
  const priceMatches = [...pageText.matchAll(new RegExp(`${C}(\\d+)(?:\\.\\d{2})?`, 'g'))];
  if (priceMatches.length < 3) return null;

  const priceCounts = {};
  priceMatches.forEach(m => {
    const p = parseInt(m[1], 10);
    if (p < 10 || p > 5000) return;
    priceCounts[p] = (priceCounts[p] || 0) + 1;
  });

  const repeated = Object.entries(priceCounts)
    .filter(([_, count]) => count >= 3)
    .map(([price]) => parseInt(price, 10));
  if (repeated.length === 0) return null;

  const validCandidates = repeated.filter(price => {
    const after = new RegExp(`${C}${price}(?:\\.\\d{2})?\\s{1,5}(\\d{1,2})\\b`, 'g');
    const before = new RegExp(`\\b(\\d{1,2})\\b\\s{1,5}${C}${price}(?:\\.\\d{2})?\\b`, 'g');
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

module.exports = { extract_price, CURRENCY_CONFIG };
