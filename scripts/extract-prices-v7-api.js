#!/usr/bin/env node
/**
 * extract-prices-v7-api.js
 *
 * Backfill `price`, `currency`, `priceLabel`, `priceBreakdown` on Hermes
 * thin-extract tours using FareHarbor's public price-preview JSON API — the
 * same endpoint the FH widget itself calls. No Playwright, no browser, no LLM.
 *
 *   GET https://fareharbor.com/api/embed/{shortname}/price-preview/per-item/v2/
 *       ?item_pks={pk[,pk...]}&include_breakdown=yes
 *
 * Supersedes the abandoned DOM-scraping extract-prices-v6.js. The API is
 * zero-FP by construction: dead listings and no-current-availability items
 * are simply absent from the returned items[] array, so "no item → leave
 * price null" falls out naturally.
 *
 * Usage:
 *   node extract-prices-v7-api.js <path-to-tours-data.json> [--limit N] [--dry-run] [--batch N]
 *
 * Targets: tours where price == null AND bookingUrl contains fareharbor.com.
 *
 * Writes back in place. Checkpoint: <input>.price-v7-checkpoint.json (distinct
 * from v6's and from the image script's checkpoint).
 */

const fs = require('fs');

const args = process.argv.slice(2);
const INPUT_FILE = args.find(a => !a.startsWith('--'));
if (!INPUT_FILE) {
  console.error('Usage: node extract-prices-v7-api.js <path-to-tours-data.json> [--limit N] [--dry-run] [--batch N]');
  process.exit(1);
}
const LIMIT = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : Infinity;
const DRY_RUN = args.includes('--dry-run');
const BATCH_SIZE = args.includes('--batch') ? parseInt(args[args.indexOf('--batch') + 1], 10) : 20;
const CHECKPOINT_FILE = INPUT_FILE + '.price-v7-checkpoint.json';

// Politeness: ~5 requests/sec. Each request now covers up to BATCH_SIZE tours.
const RATE_LIMIT_MS = 200;
const JITTER_MIN_MS = 50;
const JITTER_MAX_MS = 200;
const REQUEST_TIMEOUT_MS = 15000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = () => JITTER_MIN_MS + Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS);

// Parse FH bookingUrl → { shortname, pk } | null. Same logic as v6/images.
function parseFhUrl(bookingUrl) {
  if (!bookingUrl || !bookingUrl.includes('fareharbor.com')) return null;
  const m = bookingUrl.match(/fareharbor\.com\/(?:embeds\/book\/)?([^/]+)\/items\/(\d+)/);
  if (!m) return null;
  const [, shortname, pk] = m;
  if (shortname === 'embeds' || shortname === 'items') return null;
  return { shortname, pk };
}

function batchUrl(shortname, pks) {
  return `https://fareharbor.com/api/embed/${shortname}/price-preview/per-item/v2/`
    + `?item_pks=${pks.join(',')}&include_breakdown=yes`;
}

function loadCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_FILE)) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
    return new Set(data.processedPks || []);
  } catch (e) {
    console.warn(`  ⚠ checkpoint unreadable, ignoring: ${e.message}`);
    return new Set();
  }
}

function saveCheckpoint(processedPks) {
  if (DRY_RUN) return;
  fs.writeFileSync(
    CHECKPOINT_FILE,
    JSON.stringify({ processedPks: [...processedPks], updatedAt: new Date().toISOString() }, null, 2)
  );
}

function writeBack(tours, originalShape) {
  if (DRY_RUN) return;
  const out = originalShape.isArray ? tours : { ...originalShape.wrapper, tours };
  fs.writeFileSync(INPUT_FILE, JSON.stringify(out, null, 2));
}

function centsToDollars(cents) {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return null;
  return Number((cents / 100).toFixed(2));
}

// One batched GET → { itemsById: Map<pk(number), itemObj>, currency, feeFlags } | throws
async function fetchBatch(shortname, pks) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(batchUrl(shortname, pks), {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      signal: ac.signal,
    });
    if (resp.status !== 200) {
      const e = new Error(`HTTP ${resp.status}`);
      e.httpStatus = resp.status;
      throw e;
    }
    const j = await resp.json();
    const itemsById = new Map();
    for (const it of (j.items || [])) itemsById.set(Number(it.id), it);
    const details = j.details || {};
    return {
      itemsById,
      currency: details.currency || null,
      includeFees: details.prices_include_booking_fees,
      includeTaxes: details.prices_include_taxes,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Apply an API item to a tour per the v7 write rules.
// Returns 'high' (price written) or 'zero_price' (item is a private-charter /
// vehicle-rental model whose preview price is $0 until party size is chosen —
// no displayable price, so we leave price null per the zero-Cat-E rule).
function applyItem(tour, item, currency, includeFees, includeTaxes, ts) {
  const cts = item.price && item.price.breakdown && item.price.breakdown.customer_types;
  const list = Array.isArray(cts) ? cts : [];

  // Canonical price = first (primary/adult) customer type with a positive
  // price. FH orders the primary type first; skipping $0 types avoids
  // "select your vessel/vehicle" placeholder rows (price 0) that would
  // otherwise be written as a misleading $0. Fall back to price.low if the
  // breakdown is absent but price.low is positive.
  const primary = list.find(c => typeof c.price === 'number' && c.price > 0) || null;
  let cents = primary ? primary.price : null;
  if (cents == null && item.price && item.price.low > 0) cents = item.price.low;

  // Always record provenance + breakdown + fee flags (useful even at $0).
  if (list.length) {
    tour.priceBreakdown = list.map(c => ({
      id: c.id,
      singular: c.singular,
      plural: c.plural,
      note: c.note,
      priceCents: c.price,
      price: centsToDollars(c.price),
      minPartySize: c.min_party_size,
    }));
  }
  tour.priceIncludesBookingFees = includeFees;
  tour.priceIncludesTaxes = includeTaxes;
  if (currency) tour.currency = currency;
  tour.priceEnrichmentSource = 'extract-prices-v7-api';
  tour.priceEnrichmentAt = ts;

  if (cents == null || cents <= 0) {
    tour.priceEnrichmentStatus = 'zero_price';
    // leave price: null
    return 'zero_price';
  }

  tour.price = centsToDollars(cents);
  tour.priceConfidence = 'high';
  if (primary && primary.singular) tour.priceLabel = primary.singular;
  tour.priceEnrichmentStatus = 'high';
  return 'high';
}

function markNone(tour, ts) {
  tour.priceEnrichmentSource = 'extract-prices-v7-api';
  tour.priceEnrichmentAt = ts;
  tour.priceEnrichmentStatus = 'none';
  // leave price: null
}

function markError(tour, ts, msg) {
  tour.priceEnrichmentSource = 'extract-prices-v7-api';
  tour.priceEnrichmentAt = ts;
  tour.priceEnrichmentStatus = 'error';
  if (msg) tour.priceEnrichmentError = String(msg).slice(0, 200);
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`Input file not found: ${INPUT_FILE}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  const isArray = Array.isArray(raw);
  const tours = isArray ? raw : (raw.tours || []);
  const originalShape = { isArray, wrapper: isArray ? null : raw };

  // Candidate selection mirrors v6 (price==null + parseable FH url), preserving
  // array order so --limit N hits the same N tours as the v6 smoke test.
  const candidates = [];
  for (const t of tours) {
    if (t.price != null) continue;
    const parsed = parseFhUrl(t.bookingUrl);
    if (!parsed) continue;
    candidates.push({ tour: t, shortname: parsed.shortname, pk: Number(parsed.pk) });
  }

  const processed = loadCheckpoint();
  const targets = candidates
    .filter(c => !processed.has(c.pk))
    .slice(0, LIMIT);

  // Group the (limited) targets by shortname, then batch within each group.
  const byShort = new Map();
  for (const c of targets) {
    if (!byShort.has(c.shortname)) byShort.set(c.shortname, []);
    byShort.get(c.shortname).push(c);
  }
  const batches = [];
  for (const [shortname, group] of byShort) {
    for (const part of chunk(group, BATCH_SIZE)) batches.push({ shortname, part });
  }

  console.log(`Input: ${INPUT_FILE}`);
  console.log(`Total tours: ${tours.length}`);
  console.log(`Candidates (price==null + FH bookingUrl): ${candidates.length}`);
  console.log(`Already processed (from checkpoint): ${processed.size}`);
  console.log(`To process this run: ${targets.length}${DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log(`Operators (shortnames): ${byShort.size} | batches: ${batches.length} | batch size: ${BATCH_SIZE}`);
  if (LIMIT !== Infinity) console.log(`Limit: ${LIMIT}`);
  console.log('');

  if (targets.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const stats = { processed: 0, high: 0, zero_price: 0, none: 0, error: 0, requests: 0 };
  const writtenSamples = [];
  const startedAt = Date.now();

  for (let b = 0; b < batches.length; b++) {
    const { shortname, part } = batches[b];
    const pks = part.map(c => c.pk);
    const ts = new Date().toISOString();

    let result = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      try {
        stats.requests++;
        result = await fetchBatch(shortname, pks);
      } catch (err) {
        lastErr = err;
        if (attempt === 0) await sleep(600); // brief backoff then one retry
      }
    }

    for (const c of part) {
      const tour = c.tour;
      if (!result) {
        markError(tour, ts, lastErr && lastErr.message);
        stats.error++;
      } else {
        const item = result.itemsById.get(c.pk);
        if (item) {
          const outcome = applyItem(tour, item, result.currency, result.includeFees, result.includeTaxes, ts);
          if (outcome === 'high') {
            stats.high++;
            if (writtenSamples.length < 20) {
              writtenSamples.push({ pk: c.pk, price: tour.price, currency: tour.currency, label: tour.priceLabel, name: tour.name });
            }
          } else {
            stats.zero_price++;
          }
        } else {
          markNone(tour, ts);
          stats.none++;
        }
      }
      stats.processed++;
      processed.add(c.pk);

      if (DRY_RUN) {
        const st = tour.priceEnrichmentStatus;
        const priceStr = tour.price != null ? `${tour.currency || ''}${tour.price}` : '—';
        console.log(`  [${stats.processed}/${targets.length}] ${shortname}/${c.pk} ${st} price=${priceStr} label=${tour.priceLabel || '—'}`);
      }
    }

    if (!DRY_RUN) {
      console.log(`  batch ${b + 1}/${batches.length} ${shortname} (${pks.length} pks) -> hi:${stats.high} none:${stats.none} err:${stats.error}`);
      writeBack(tours, originalShape);
      saveCheckpoint(processed);
    }

    if (b < batches.length - 1) await sleep(RATE_LIMIT_MS + jitter());
  }

  if (!DRY_RUN) {
    writeBack(tours, originalShape);
    saveCheckpoint(processed);
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('');
  console.log('✓ Price enrichment (v7-api) complete');
  console.log(`  processed:  ${stats.processed}`);
  console.log(`  high:       ${stats.high}  (price written)`);
  console.log(`  zero_price: ${stats.zero_price}  (charter/vehicle model, preview $0 — price left null, correct)`);
  console.log(`  none:       ${stats.none}  (dead / no current availability — price left null, correct)`);
  console.log(`  error:      ${stats.error}`);
  console.log(`  requests:   ${stats.requests}  (batched ≤${BATCH_SIZE} pks each)`);
  console.log(`  elapsed:    ${elapsedSec}s`);
  if (DRY_RUN) console.log('  (dry run — no file writes performed)');

  if (writtenSamples.length) {
    console.log('');
    console.log('Sample of written prices (spot-check candidates):');
    for (const s of writtenSamples) console.log(`  pk=${s.pk}  ${s.currency}${s.price}  [${s.label}]  ${s.name}`);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
