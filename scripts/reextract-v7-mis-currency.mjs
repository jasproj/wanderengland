#!/usr/bin/env node
/**
 * reextract-v7-mis-currency.mjs — scoped v7 re-extract of the mis-currency rows.
 *
 * Population: rows whose stored `currency` is USD or EUR (nothing else moves).
 * For each, re-query FareHarbor's price-preview API live (the same endpoint,
 * batching, join-by-id, and $0 rule as wanderpuertorico/extract-prices-v7-api.js)
 * and take the currency from the API `details.currency`, never from assumption.
 *
 *   live currency == GBP  → row is re-published: price/label/breakdown/currency
 *                           from the live quote, priceConfidence "high".
 *   live currency != GBP  → row is set aside: live amount + TRUE currency stamped,
 *                           priceConfidence "low" so app.js's gate (which hardcodes
 *                           "£") renders "Price on request" instead of a wrong £.
 *   absent from items[]   → UNSAMPLED (dead / no availability): currency cannot be
 *                           verified, so priceConfidence "low" as well.
 *
 * Date-validity instrument (from _tools/scripts/fareharbor/verify_prices.py,
 * trap 1): every parameter except `date` is silently ignored by this endpoint, so
 * one extra dated request per batch is issued and the run asserts that at least
 * one availability.start_at MOVED. If nothing moves the run exits 6 and writes
 * nothing.
 *
 * Batch trap: completions are counted against the expected population size; any
 * mismatch exits 5 and writes nothing.
 *
 * Byte round-trip (D-599): the file is re-emitted as
 * JSON.stringify(parsed, null, 2) + "\n", which reproduces the current bytes
 * exactly; rows outside the population are asserted byte-identical.
 *
 * Usage: node scripts/reextract-v7-mis-currency.mjs [--dry-run] [--evidence path]
 */
import fs from 'node:fs';

const FILE = 'tours-data.json';
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const EVIDENCE = args.includes('--evidence') ? args[args.indexOf('--evidence') + 1]
  : 'scripts/evidence/reextract-v7-mis-currency.json';
const TARGET_CURRENCIES = new Set(['USD', 'EUR']);
const HOME_CURRENCY = 'GBP';
const BATCH_SIZE = 20;                 // matches v7
const RATE_LIMIT_MS = 1000;            // 1 req/s, per the operator ruling in verify_prices.py
const REQUEST_TIMEOUT_MS = 25000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SOURCE = 'extract-prices-v7-api';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseFhUrl(bookingUrl) {
  if (!bookingUrl || !bookingUrl.includes('fareharbor.com')) return null;
  const m = bookingUrl.match(/fareharbor\.com\/(?:embeds\/book\/)?([^/]+)\/items\/(\d+)/);
  if (!m) return null;
  const [, shortname, pk] = m;
  if (shortname === 'embeds' || shortname === 'items') return null;
  return { shortname, pk: Number(pk) };
}
function batchUrl(shortname, pks, date) {
  return `https://fareharbor.com/api/embed/${shortname}/price-preview/per-item/v2/`
    + `?item_pks=${pks.join(',')}&include_breakdown=yes` + (date ? `&date=${date}` : '');
}
function centsToUnits(c) {
  return (typeof c === 'number' && Number.isFinite(c)) ? Number((c / 100).toFixed(2)) : null;
}
const RETRIES = 3;                     // transient timeouts only; HTTP !=200 is not retried
async function getJson(url) {
  let last;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try { return await getJsonOnce(url); }
    catch (e) { last = e; if (/^HTTP /.test(e.message)) throw e; stats.retries++; await sleep(RATE_LIMIT_MS * 2 * attempt); }
  }
  throw last;
}
async function getJsonOnce(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ac.signal });
    if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally { clearTimeout(t); }
}
function chunk(a, n) { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

// app.js predicates (index.html grid + per-card JSON-LD), copied verbatim in intent.
const visibleGate = t => Number.isFinite(t.price) && t.price > 0 && t.priceConfidence !== 'low';
const ldGate = t => Number.isFinite(t.price) && t.priceConfidence !== 'low';
function gateCounts(tours) {
  const loaded = tours.filter(t => t.status !== 'inactive' && !t.bookingDead);
  const vis = loaded.filter(visibleGate);
  return {
    loaded: loaded.length,
    visiblePrice: vis.length,
    jsonLdOffers: loaded.filter(ldGate).length,
    visibleNonGbp: vis.filter(t => t.currency !== HOME_CURRENCY).length,
    visibleByCurrency: Object.fromEntries([...new Set(vis.map(t => String(t.currency)))].sort().map(c => [c, vis.filter(t => String(t.currency) === c).length])),
  };
}

// ---------------------------------------------------------------- main
const rawBefore = fs.readFileSync(FILE, 'utf8');
const doc = JSON.parse(rawBefore);
if (JSON.stringify(doc, null, 2) + '\n' !== rawBefore) {
  console.error('ABORT: file does not byte-round-trip through JSON.stringify(…,null,2)+"\\n"'); process.exit(2);
}
const tours = doc.tours;
const rowCountBefore = tours.length;
const beforeRows = tours.map(t => JSON.stringify(t));
const gateBefore = gateCounts(tours);

const targets = [];
for (const [i, t] of tours.entries()) {
  if (!TARGET_CURRENCIES.has(t.currency)) continue;
  const parsed = parseFhUrl(t.bookingUrl);
  if (!parsed || parsed.pk !== Number(t.pk)) { console.error(`ABORT: unparseable/mismatched bookingUrl on pk ${t.pk}`); process.exit(2); }
  targets.push({ idx: i, tour: t, ...parsed, storedCurrency: t.currency, storedPrice: t.price, storedConfidence: t.priceConfidence ?? null });
}
const EXPECTED_N = targets.length;
const byCur = {};
for (const x of targets) byCur[x.storedCurrency] = (byCur[x.storedCurrency] || 0) + 1;
console.log(`Population: ${EXPECTED_N} rows (${JSON.stringify(byCur)}) | gate before: ${JSON.stringify(gateBefore)}`);

// One dated probe per batch, spread over the next 14..60 days so start_at can move.
const probeDate = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 21); return d.toISOString().slice(0, 10); })();

const bySn = new Map();
for (const x of targets) { if (!bySn.has(x.shortname)) bySn.set(x.shortname, []); bySn.get(x.shortname).push(x); }
const batches = [];
for (const [sn, xs] of bySn) for (const part of chunk(xs, BATCH_SIZE)) batches.push({ sn, part });
console.log(`Operators: ${bySn.size} | batches: ${batches.length} (x2 for dated probe) | probe date: ${probeDate}`);

const ts = new Date().toISOString();
const results = new Map();   // pk -> outcome record
const stats = { requests: 0, failed: 0, retries: 0, failures: [] };
let startAtMoved = false;

for (const [bi, { sn, part }] of batches.entries()) {
  const pks = part.map(x => x.pk);
  let base = null, dated = null;
  try { base = await getJson(batchUrl(sn, pks)); stats.requests++; }
  catch (e) { stats.failed++; stats.failures.push({ sn, pks, date: null, error: String(e.message) }); }
  await sleep(RATE_LIMIT_MS);
  try { dated = await getJson(batchUrl(sn, pks, probeDate)); stats.requests++; }
  catch (e) { stats.failed++; stats.failures.push({ sn, pks, date: probeDate, error: String(e.message) }); }
  await sleep(RATE_LIMIT_MS);

  const baseItems = new Map((base?.items || []).map(it => [Number(it.id), it]));   // join by id, never positional
  const datedItems = new Map((dated?.items || []).map(it => [Number(it.id), it]));
  const details = base?.details || {};
  const liveCurrency = details.currency || null;

  for (const x of part) {
    const it = baseItems.get(x.pk);
    const dit = datedItems.get(x.pk);
    const baseStart = it?.availability?.start_at || null;
    const datedStart = dit?.availability?.start_at || null;
    if (baseStart && datedStart && baseStart !== datedStart) startAtMoved = true;
    const rec = {
      pk: x.pk, shortname: sn, name: x.tour.name,
      storedCurrency: x.storedCurrency, storedPrice: x.storedPrice, storedConfidence: x.storedConfidence,
      liveCurrency, baseline: null, datedProbe: null, outcome: null,
      requestFailed: !base,
    };
    if (!base) { rec.outcome = 'REQUEST_FAILED'; results.set(x.pk, rec); continue; }
    if (!it) { rec.outcome = 'UNSAMPLED'; results.set(x.pk, rec); continue; }
    const cts = it.price?.breakdown?.customer_types;
    const list = Array.isArray(cts) ? cts : [];
    const primary = list.find(c => typeof c.price === 'number' && c.price > 0) || null;   // $0 tiers discarded
    let cents = primary ? primary.price : null;
    if (cents == null && it.price?.low > 0) cents = it.price.low;
    rec.baseline = {
      startAt: baseStart, availabilityId: it.availability?.id ?? null,
      priceLow: it.price?.low ?? null, priceHigh: it.price?.high ?? null,
      tiers: list.map(c => ({ id: c.id, singular: c.singular, plural: c.plural, note: c.note, priceCents: c.price, minPartySize: c.min_party_size })),
      canonicalCents: cents, zeroTiersDiscarded: list.filter(c => !(c.price > 0)).length,
      includeFees: details.prices_include_booking_fees ?? null, includeTaxes: details.prices_include_taxes ?? null,
    };
    rec.datedProbe = { requested: probeDate, startAt: datedStart, moved: !!(baseStart && datedStart && baseStart !== datedStart) };
    rec.outcome = cents == null || cents <= 0 ? 'ZERO_PREVIEW'
      : liveCurrency === HOME_CURRENCY ? 'GBP_CONFIRMED'
      : 'NON_GBP_SUPPRESSED';
    rec.primary = primary ? { singular: primary.singular, priceCents: primary.price } : null;
    results.set(x.pk, rec);
  }
  process.stdout.write(`  batch ${bi + 1}/${batches.length} ${sn} (${pks.length} pks) currency=${liveCurrency} moved=${startAtMoved}\n`);
}

// ---------------------------------------------------------------- traps
if (results.size !== EXPECTED_N) { console.error(`ABORT (5): completions ${results.size} != expected ${EXPECTED_N}`); process.exit(5); }
if (!startAtMoved) { console.error('ABORT (6): start_at never moved in response to &date= — dated requests were silently ignored; not trusting this run.'); process.exit(6); }
if (stats.failed) { console.error(`ABORT (7): ${stats.failed} failed requests — refusing to write a partial population: ${JSON.stringify(stats.failures)}`); process.exit(7); }

// ---------------------------------------------------------------- apply
const outcomes = {};
for (const x of targets) {
  const rec = results.get(x.pk); const t = x.tour;
  outcomes[rec.outcome] = (outcomes[rec.outcome] || 0) + 1;
  t.priceEnrichmentSource = SOURCE;
  t.priceEnrichmentAt = ts;
  if (rec.outcome === 'UNSAMPLED') {
    // Cannot verify currency: stored amount stays but is suppressed by the gate.
    t.priceConfidence = 'low';
    t.priceEnrichmentStatus = 'unsampled_currency_unverified';
    continue;
  }
  const b = rec.baseline;
  if (b.tiers.length) {
    t.priceBreakdown = b.tiers.map(c => ({ id: c.id, singular: c.singular, plural: c.plural, note: c.note, priceCents: c.priceCents, price: centsToUnits(c.priceCents), minPartySize: c.minPartySize }));
  }
  t.priceIncludesBookingFees = b.includeFees;
  t.priceIncludesTaxes = b.includeTaxes;
  if (rec.liveCurrency) t.currency = rec.liveCurrency;
  if (rec.outcome === 'ZERO_PREVIEW') {
    t.priceEnrichmentStatus = 'zero_price';
    t.price = null; t.priceConfidence = 'low';
    continue;
  }
  t.price = centsToUnits(b.canonicalCents);
  if (rec.primary?.singular) t.priceLabel = rec.primary.singular;
  if (rec.outcome === 'GBP_CONFIRMED') {
    t.priceConfidence = 'high'; t.priceEnrichmentStatus = 'high';
  } else {
    t.priceConfidence = 'low'; t.priceEnrichmentStatus = `non_gbp_currency:${rec.liveCurrency}`;
  }
}

// ---------------------------------------------------------------- assertions
const targetIdx = new Set(targets.map(x => x.idx));
if (tours.length !== rowCountBefore) { console.error('ABORT: row count changed'); process.exit(3); }
let outsideChanged = 0;
for (const [i, t] of tours.entries()) if (!targetIdx.has(i) && JSON.stringify(t) !== beforeRows[i]) outsideChanged++;
if (outsideChanged) { console.error(`ABORT: ${outsideChanged} rows outside the population changed`); process.exit(3); }
const gateAfter = gateCounts(tours);
if (gateAfter.visibleNonGbp !== 0) { console.error(`ABORT: ${gateAfter.visibleNonGbp} rows still render a non-GBP amount as £`); process.exit(4); }

const perRow = [...results.values()].map(r => ({
  pk: r.pk, shortname: r.shortname, name: r.name, outcome: r.outcome,
  storedCurrency: r.storedCurrency, storedPrice: r.storedPrice, storedConfidence: r.storedConfidence,
  liveCurrency: r.liveCurrency, livePrice: r.baseline ? centsToUnits(r.baseline.canonicalCents) : null,
  liveLabel: r.primary?.singular ?? null, tiers: r.baseline?.tiers ?? null, zeroTiersDiscarded: r.baseline?.zeroTiersDiscarded ?? null,
  baselineStartAt: r.baseline?.startAt ?? null, datedProbe: r.datedProbe,
}));
const evidence = {
  script: 'scripts/reextract-v7-mis-currency.mjs', ranAt: ts, dryRun: DRY_RUN, file: FILE,
  population: { expected: EXPECTED_N, completed: results.size, byStoredCurrency: byCur },
  requests: { total: stats.requests, failed: stats.failed, retries: stats.retries, batchSize: BATCH_SIZE, rateLimitMs: RATE_LIMIT_MS, probeDate, startAtMoved },
  outcomes, rowCount: { before: rowCountBefore, after: tours.length }, rowsOutsidePopulationChanged: outsideChanged,
  gate: { before: gateBefore, after: gateAfter, delta: Object.fromEntries(Object.keys(gateBefore).filter(k => typeof gateBefore[k] === 'number').map(k => [k, gateAfter[k] - gateBefore[k]])) },
  rows: perRow,
};
console.log(`\nOutcomes: ${JSON.stringify(outcomes)}`);
console.log(`Gate before: ${JSON.stringify(gateBefore)}\nGate after:  ${JSON.stringify(gateAfter)}\nGate delta:  ${JSON.stringify(evidence.gate.delta)}`);
console.log(`Requests: ${stats.requests} (failed ${stats.failed}, retries ${stats.retries}) | start_at moved: ${startAtMoved}`);
if (DRY_RUN) { console.log('DRY RUN — nothing written.'); fs.writeFileSync(EVIDENCE.replace(/\.json$/, '.dryrun.json'), JSON.stringify(evidence, null, 2) + '\n'); process.exit(0); }

const out = JSON.stringify(doc, null, 2) + '\n';
fs.writeFileSync(FILE, out);
const reread = fs.readFileSync(FILE, 'utf8');
if (JSON.stringify(JSON.parse(reread), null, 2) + '\n' !== reread) { console.error('ABORT: written file does not round-trip'); process.exit(3); }
fs.writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
console.log(`Wrote ${FILE} (${out.length} chars) and ${EVIDENCE}`);
