// s46-weng-currency: release the D-620-held rows from priceConfidence:low.
// #88 (5fc903a) live-verified 27 rows as non-GBP (EUR 19 / USD 8) and suppressed them
// ONLY because app.js hardcoded "£"/"GBP". app.js now renders a row in its own currency,
// so the sole suppression reason is gone. Rows that are low for any other reason
// (unsampled_currency_unverified, zero_price, no price) are NOT touched.
// Selection is the stamp #88 wrote, not the currency field alone:
//   priceEnrichmentStatus === `non_gbp_currency:${currency}` && priceEnrichmentSource === 'extract-prices-v7-api'
import fs from 'fs';
const FILE = 'tours-data.json';
const SOURCE = 's46-weng-currency';
const EXPECTED = { EUR: 19, USD: 8 };
const raw = fs.readFileSync(FILE, 'utf8');
const doc = JSON.parse(raw);
if (JSON.stringify(doc, null, 2) + '\n' !== raw) { console.error('ABORT: no byte round-trip'); process.exit(2); }
const before = doc.tours.map(t => JSON.stringify(t));
const held = t => t.priceConfidence === 'low'
  && t.priceEnrichmentSource === 'extract-prices-v7-api'
  && typeof t.currency === 'string' && t.currency !== 'GBP'
  && t.priceEnrichmentStatus === `non_gbp_currency:${t.currency}`
  && Number.isFinite(t.price) && t.price > 0;
const targets = doc.tours.map((t, i) => ({ t, i })).filter(x => held(x.t));
const byCur = {};
for (const { t } of targets) byCur[t.currency] = (byCur[t.currency] || 0) + 1;
if (JSON.stringify(byCur) !== JSON.stringify(EXPECTED)) { console.error(`ABORT: population ${JSON.stringify(byCur)} != expected ${JSON.stringify(EXPECTED)}`); process.exit(3); }
for (const { t } of targets) {
  if (!Object.prototype.hasOwnProperty.call(t, 'priceConfidence')) { console.error(`ABORT pk ${t.pk}: no priceConfidence key`); process.exit(3); }
  t.priceConfidence = 'high';           // in place — key order preserved
  t.priceConfidenceSource = SOURCE;     // provenance: this pass released the gate
}
const idx = new Set(targets.map(x => x.i));
let outside = 0;
doc.tours.forEach((t, i) => { if (!idx.has(i) && JSON.stringify(t) !== before[i]) outside++; });
if (outside) { console.error(`ABORT: ${outside} rows outside the population changed`); process.exit(3); }
if (doc.tours.length !== before.length) { console.error('ABORT: row count changed'); process.exit(3); }
// price is untouched; assert numerically identical (int/float discipline)
for (const { t, i } of targets) { if (JSON.parse(before[i]).price !== t.price) { console.error(`ABORT pk ${t.pk}: price changed`); process.exit(3); } }
fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');
const still = doc.tours.filter(t => t.priceConfidence === 'low' && t.currency && t.currency !== 'GBP');
const stillBy = {};
for (const t of still) { const k = `${t.currency}|${t.priceEnrichmentStatus}`; stillBy[k] = (stillBy[k] || 0) + 1; }
console.log(JSON.stringify({ released: targets.length, byCurrency: byCur, pks: targets.map(x => x.t.pk), stillLowNonGbp: stillBy }));
