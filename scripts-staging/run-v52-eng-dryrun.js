#!/usr/bin/env node
/**
 * wanderengland v5.2 dry-run price extraction.
 *
 * Pulls every tour with `price === null` from tours-data.json (~154),
 * fetches its FareHarbor page via Playwright, runs the v5.4 extractor
 * + v5.2 dominant-price gate, and records what would happen — without
 * writing anything to tours-data.json.
 *
 * Output:
 *   - scripts-staging/v52-eng-dryrun-raw.json (per-tour records)
 *   - scripts-staging/v52-eng-dryrun.md (human-readable report)
 *
 * Flag: --dry-run-only  (required; refuses to run otherwise)
 *
 * Usage:
 *   node scripts-staging/run-v52-eng-dryrun.js --dry-run-only
 *   node scripts-staging/run-v52-eng-dryrun.js --dry-run-only --limit 20  # quick smoke
 */

const fs = require('fs');
const { extract_price_v52 } = require('./extract-price-v5.2');

const CURRENCY = 'GBP';

const TOURS_FILE = 'tours-data.json';
const RAW_FILE = 'scripts-staging/v52-eng-dryrun-raw.json';
const REPORT_FILE = 'scripts-staging/v52-eng-dryrun.md';

function ensureFlag() {
  if (!process.argv.includes('--dry-run-only')) {
    console.error('Refusing to run without --dry-run-only flag.');
    console.error('This script never writes to tours-data.json. The flag forces explicit intent.');
    process.exit(2);
  }
}

function loadNullPriceTours() {
  const data = JSON.parse(fs.readFileSync(TOURS_FILE, 'utf8'));
  const tours = data.tours || data;
  return tours.filter(t => !t.price && t.bookingLink);
}

async function fetchPageText(ctx, url) {
  const page = await ctx.newPage();
  try {
    await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    return await page.evaluate(() => document.body.innerText);
  } finally {
    await page.close();
  }
}

(async () => {
  ensureFlag();
  const limitArg = process.argv.find((a, i) => process.argv[i-1] === '--limit');
  const LIMIT = limitArg ? parseInt(limitArg, 10) : Infinity;

  const targets = loadNullPriceTours().slice(0, LIMIT);
  console.log(`wanderengland null-price tours (GBP) to evaluate: ${targets.length}`);

  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });

  const records = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const rec = {
      id: String(t.id),
      name: t.name,
      company: t.company,
      bookingLink: t.bookingLink,
      tags: t.tags,
    };
    try {
      const pageText = await fetchPageText(ctx, t.bookingLink);
      const result = extract_price_v52(pageText, CURRENCY);
      rec.extractedPrice = result.price;
      rec.priceConfidence = result.priceConfidence;
      rec.priceLabel = result.priceLabel;
      rec.priceSource = result.priceSource || null;
      rec.gate = result.gateResult || null;

      // Capture pricing-section excerpt for samples
      const compact = pageText.replace(/\s+/g, ' ');
      const m = compact.match(/Pricing[\s\S]{0,1500}?(?=Cancellation|Description|What's Included|$)/i);
      rec.pricingExcerpt = (m ? m[0] : compact.slice(0, 800)).slice(0, 600);

      const dollars = [...compact.matchAll(new RegExp('(?:£|GBP\\\\s?)\\\\s*\\\\d+(?:,\\\\d{3})*(?:[.,]\\\\d{2})?', 'g'))].map(x => x[0]).slice(0, 12);
      rec.dollarHits = dollars;
    } catch (err) {
      rec.error = err.message.slice(0, 200);
    }
    records.push(rec);
    if ((i + 1) % 25 === 0) {
      const so_far = records.reduce((a, r) => {
        const k = r.error ? 'err' : (r.priceConfidence ?? 'null');
        a[k] = (a[k] || 0) + 1;
        return a;
      }, {});
      console.log(`  [${i + 1}/${targets.length}]`, JSON.stringify(so_far));
    }
  }

  await ctx.close();
  await browser.close();

  fs.writeFileSync(RAW_FILE, JSON.stringify(records, null, 2));
  console.log(`✓ Raw records → ${RAW_FILE}`);

  // Bucket the results
  const buckets = { high: [], medium: [], low: [], 'no-price': [], error: [] };
  for (const r of records) {
    if (r.error) buckets.error.push(r);
    else if (r.priceConfidence === 'high') buckets.high.push(r);
    else if (r.priceConfidence === 'medium') buckets.medium.push(r);
    else if (r.priceConfidence === 'low') buckets.low.push(r);
    else buckets['no-price'].push(r);
  }

  // Distinguish v5.2 gate medium from v5.4 native medium
  const gateMedium = buckets.medium.filter(r => r.priceSource === 'v52-dominant-gate');
  const nativeMedium = buckets.medium.filter(r => r.priceSource !== 'v52-dominant-gate');

  console.log('\nResult counts:');
  console.log(`  high (v5.4 native):       ${buckets.high.length}`);
  console.log(`  medium (v5.4 native):     ${nativeMedium.length}`);
  console.log(`  medium (v5.2 gate):       ${gateMedium.length}`);
  console.log(`  low:                      ${buckets.low.length}`);
  console.log(`  no-price:                 ${buckets['no-price'].length}`);
  console.log(`  errors:                   ${buckets.error.length}`);

  // Cat-E candidate detection: any "low" tour where surrounding ±60 chars
  // of any dollar match contains an add-on idiom that the gate doesn't
  // currently catch (or check passing tours for any "+$" / "additional"
  // / "Nitrox" pattern that slipped through somehow — should be 0 if
  // the v5.2 gate is intact).
  const ADDON_HINTS = /\b(additional|extra|option|optional|rental|nitrox|upgrade|supplement|add-on|addon|surcharge)\b|\+\$/i;
  const catEPassed = gateMedium.filter(r => {
    if (!r.gate || !r.gate.contextWindow) return false;
    return ADDON_HINTS.test(r.gate.contextWindow);
  });

  // Build the markdown report
  const lines = [];
  lines.push('# wanderengland v5.2 Dry-Run Report (GBP) — null-price tour re-extraction');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Branch:** \`feat/eng-v52-price-extraction\``);
  lines.push(`**Mode:** \`--dry-run-only\` (no writes to tours-data.json)`);
  lines.push('');
  lines.push('## 1. Inputs');
  lines.push('');
  lines.push(`- wanderengland total tours: 372`);
  lines.push(`- Tours with \`price: null\` evaluated: **${targets.length}**`);
  lines.push(`- Extractor: v5.4 baseline + v5.2 dominant-price gate (ported verbatim from wanderusvi)`);
  lines.push(`- Currency: **GBP**`);
  lines.push(`- Page fetch: Playwright (chromium headless), 1.5 s settle wait`);
  lines.push('');
  lines.push('## 2. Result distribution');
  lines.push('');
  lines.push('| Outcome | Count | Disposition |');
  lines.push('|---|---:|---|');
  lines.push(`| **high** (v5.4 Method 1/2 — adult/per-person anchor) | ${buckets.high.length} | "From $X" if applied |`);
  lines.push(`| **medium** (v5.4 native — Method 3/4/6) | ${nativeMedium.length} | "From $X" if applied |`);
  lines.push(`| **medium** (v5.2 dominant-price gate) | ${gateMedium.length} | "From $X" if applied |`);
  lines.push(`| **low** (Method 5 unanchored, gate FAILed) | ${buckets.low.length} | stays "Check availability" |`);
  lines.push(`| **no-price** (extractor returned null) | ${buckets['no-price'].length} | stays "Check availability" |`);
  lines.push(`| **error** (fetch/parse) | ${buckets.error.length} | stays "Check availability" |`);
  lines.push(`| **Total** | ${records.length} | |`);
  lines.push('');
  const promoTotal = buckets.high.length + nativeMedium.length + gateMedium.length;
  const stayTotal = buckets.low.length + buckets['no-price'].length + buckets.error.length;
  lines.push(`**Net effect if applied --live:** ${promoTotal} tours flip from "Check availability" → "From $X" (${(promoTotal/targets.length*100).toFixed(1)}% of the 154). ${stayTotal} stay hidden.`);
  lines.push('');

  // Cat-E candidate sanity check
  lines.push('## 3. Cat-E candidate sanity check');
  lines.push('');
  if (catEPassed.length === 0) {
    lines.push('**0 Cat-E candidates** detected among gate PASSes. Disqualifier blocklist (`additional, extra, option, optional, rental, nitrox, upgrade, supplement, add-on, addon, surcharge` + `+$` literal) appears to be holding.');
  } else {
    lines.push(`**⚠ ${catEPassed.length} Cat-E candidate(s)** detected — these tours passed the gate but their context window contains an add-on idiom. Review before --live:`);
    lines.push('');
    for (const r of catEPassed.slice(0, 10)) {
      lines.push(`- **${r.id}** (${r.name}) — captured \$${r.extractedPrice}, window: \`${(r.gate.contextWindow||'').slice(0,140).replace(/\|/g,'\\|')}\``);
    }
  }
  lines.push('');

  // 10 sample promoted tours (preferring gate-medium for evidence value)
  lines.push('## 4. Sample 10 promoted tours');
  lines.push('');
  const promoSample = [...gateMedium, ...nativeMedium, ...buckets.high].slice(0, 10);
  for (const r of promoSample) {
    lines.push(`### ${r.id} — ${r.name}`);
    lines.push('');
    lines.push(`- company: ${r.company || '(unknown)'}`);
    lines.push(`- extracted price: **$${r.extractedPrice}** (${r.priceConfidence}, ${r.priceLabel || '—'})`);
    lines.push(`- priceSource: \`${r.priceSource || 'v5.4 native'}\``);
    if (r.gate) {
      lines.push(`- gate distinct $-values: ${JSON.stringify(r.gate.distinctDollarValues)}`);
      lines.push(`- gate matched token: \`${r.gate.capturedMatchToken}\``);
      lines.push(`- gate ±40 char window:`);
      lines.push('');
      lines.push('  ```');
      lines.push('  ' + (r.gate.contextWindow || '').slice(0, 200));
      lines.push('  ```');
    }
    if (r.dollarHits && r.dollarHits.length) {
      lines.push(`- all $-hits in page: ${JSON.stringify(r.dollarHits)}`);
    }
    lines.push('');
  }

  // 5 sample low / no-price / error
  lines.push('## 5. Sample 5 stays-hidden tours');
  lines.push('');
  const stayHidden = [...buckets.low, ...buckets['no-price'], ...buckets.error].slice(0, 5);
  for (const r of stayHidden) {
    lines.push(`### ${r.id} — ${r.name}`);
    lines.push('');
    lines.push(`- outcome: ${r.error ? 'fetch/parse error' : (r.priceConfidence ?? 'no-price')}`);
    if (r.error) lines.push(`- error: \`${r.error}\``);
    if (r.gate) {
      lines.push(`- gate criterion failed: ${r.gate.criterionFailed}`);
      if (r.gate.disqualifierToken) lines.push(`- disqualifier hit: \`${r.gate.disqualifierToken}\``);
      if (r.gate.distinctDollarValues) lines.push(`- distinct $-values: ${JSON.stringify(r.gate.distinctDollarValues)}`);
      if (r.gate.contextWindow) {
        lines.push(`- window:`);
        lines.push('');
        lines.push('  ```');
        lines.push('  ' + r.gate.contextWindow.slice(0, 200));
        lines.push('  ```');
      }
    }
    if (r.dollarHits && r.dollarHits.length) {
      lines.push(`- all $-hits: ${JSON.stringify(r.dollarHits)}`);
    }
    lines.push('');
  }

  lines.push('## 6. Out of scope for this run');
  lines.push('');
  lines.push('- No edits to `tours-data.json`.');
  lines.push('- No commits, no push, no deploy.');
  lines.push('- `--live` mode not implemented yet — adopt USVI\'s `apply-v52-live.js` pattern when ready.');
  lines.push('');

  fs.writeFileSync(REPORT_FILE, lines.join('\n'));
  console.log(`✓ Report → ${REPORT_FILE}`);
  console.log(`\nDry-run complete. Awaiting --live approval.`);
})().catch(e => { console.error(e); process.exit(1); });
