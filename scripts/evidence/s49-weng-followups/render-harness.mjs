// s46-weng-currency: evaluate app.js's card renderer + JSON-LD in node against a
// tours-data.json (served-bytes substitution — Chrome disconnected; served sha == disk
// asserted in the PR). Emits per-pk {html, schema, priceText, currency} so a pre/post
// diff can assert GBP rows byte-identical and the release set exact.
// usage: node render-harness.mjs <app.js> <tours-data.json> <out.json>
import fs from 'fs'; import vm from 'vm';
const [,, appPath, dataPath, outPath] = process.argv;
const src = fs.readFileSync(appPath, 'utf8');
const d = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const noop = () => {};
const el = { addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], classList: { add: noop, remove: noop }, getElementById: () => null, style: {} };
const ctx = { console, document: { ...el, body: el }, window: { addEventListener: noop, scrollY: 0, gtag: noop }, sessionStorage: { getItem: () => null, setItem: noop }, localStorage: { getItem: () => null, setItem: noop }, fetch: () => new Promise(() => {}), gtag: noop, setTimeout, URL, Number, JSON, Math, String, Array, Object };
vm.createContext(ctx);
vm.runInContext(src + '\n;globalThis.__x={createTourCard,generateTourSchema};', ctx);
const { createTourCard, generateTourSchema } = ctx.__x;
// same loader predicate as app.js:145
const loaded = d.tours.filter(t => t.status !== 'inactive' && !t.bookingDead);
const out = {};
for (const t of loaded) {
  const html = createTourCard(t);
  const m = html.match(/class="tour-price"[^>]*>([^<]*)</);
  out[t.pk] = { currency: t.currency ?? null, confidence: t.priceConfidence ?? null, price: t.price ?? null,
    priceText: m ? m[1] : null, html, schema: generateTourSchema(t) };
}
fs.writeFileSync(outPath, JSON.stringify(out));
const rows = Object.values(out);
const visible = rows.filter(r => r.priceText && r.priceText.startsWith('From '));
const sym = s => s ? (s.match(/^From (\D+)/) || [])[1] : null;
const sum = { loaded: rows.length, visiblePrice: visible.length, jsonLdOffers: rows.filter(r => r.schema.offers).length,
  visibleByCurrency: Object.fromEntries([...new Set(visible.map(r => String(r.currency)))].sort().map(c => [c, visible.filter(r => String(r.currency) === c).length])),
  visibleBySymbol: Object.fromEntries([...new Set(visible.map(r => sym(r.priceText)))].sort().map(c => [c, visible.filter(r => sym(r.priceText) === c).length])),
  offersByPriceCurrency: Object.fromEntries([...new Set(rows.filter(r => r.schema.offers).map(r => r.schema.offers.priceCurrency))].sort().map(c => [c, rows.filter(r => r.schema.offers?.priceCurrency === c).length])),
  visibleNonGbp: visible.filter(r => r.currency !== 'GBP').length,
  priceTextButNoOffer: rows.filter(r => (r.priceText||'').startsWith('From ') !== !!r.schema.offers).length };
console.log(JSON.stringify(sum));
