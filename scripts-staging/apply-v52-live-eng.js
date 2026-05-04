#!/usr/bin/env node
/**
 * wanderengland v5.2 live applicator.
 *
 * Reads scripts-staging/v52-eng-dryrun-raw.json (the validated 154-tour
 * dry-run from the most recent run) and applies promotions to
 * tours-data.json IN PLACE.
 *
 * Promotion = any tour where the dry-run produced priceConfidence in
 *             {'high', 'medium'}. For each such tour we write back:
 *               price, priceConfidence, priceLabel
 *             plus priceSource: 'v52-dominant-gate' for gate-driven
 *             medium promotions.
 *
 * Tours with priceConfidence='low' and no-price are left untouched.
 *
 * Flag: --confirm  (required; without it, prints what would change and
 *                   exits 0 without writing)
 *
 * Backup: writes the pre-mutation file to /tmp/tours-data-eng.<ISO>.bak
 *         before overwriting.
 */

const fs = require('fs');

const TOURS_FILE = 'tours-data.json';
const RAW_FILE = 'scripts-staging/v52-eng-dryrun-raw.json';
const CONFIRM = process.argv.includes('--confirm');

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

(function main() {
  if (!fs.existsSync(RAW_FILE)) {
    console.error(`Missing ${RAW_FILE}.`);
    process.exit(2);
  }

  const records = loadJson(RAW_FILE);
  const promotions = records.filter(r =>
    r.priceConfidence === 'high' || r.priceConfidence === 'medium'
  );
  const gateMediums = promotions.filter(r => r.priceSource === 'v52-dominant-gate');
  const v54Mediums = promotions.filter(r =>
    r.priceConfidence === 'medium' && r.priceSource !== 'v52-dominant-gate'
  );
  const highs = promotions.filter(r => r.priceConfidence === 'high');

  console.log(`Loaded ${records.length} dry-run records.`);
  console.log(`Would promote ${promotions.length} tour${promotions.length === 1 ? '' : 's'}`);
  console.log(`  high (v5.4 native):   ${highs.length}`);
  console.log(`  medium (v5.4 native): ${v54Mediums.length}`);
  console.log(`  medium (v5.2 gate):   ${gateMediums.length}`);

  const dataRaw = fs.readFileSync(TOURS_FILE, 'utf8');
  const data = JSON.parse(dataRaw);
  const tours = data.tours || data;

  const beforeByConf = countByConf(tours);
  console.log('\nBefore:', beforeByConf);

  const promoMap = new Map(promotions.map(p => [String(p.id), p]));
  let modified = 0;
  let skipped = 0;
  let notFound = 0;
  const applied = [];

  for (const t of tours) {
    const promo = promoMap.get(String(t.id));
    if (!promo) continue;
    if (t.price) {
      console.warn(`  skipping ${t.id}: already has price=${t.price} (would not overwrite)`);
      skipped++;
      continue;
    }
    t.price = promo.extractedPrice;
    t.priceConfidence = promo.priceConfidence;
    t.priceLabel = promo.priceLabel;
    if (promo.priceSource) t.priceSource = promo.priceSource;
    modified++;
    applied.push({ id: t.id, name: t.name, price: t.price, conf: t.priceConfidence, src: promo.priceSource || 'v5.4' });
  }

  for (const id of promoMap.keys()) {
    if (!tours.find(t => String(t.id) === id)) notFound++;
  }

  const afterByConf = countByConf(tours);
  console.log('After:  ', afterByConf);
  console.log(`\nMutations: ${modified} promoted, ${skipped} skipped (already priced), ${notFound} not in file.`);

  // Card-flip count using ENG app.js:154-158 formatPrice logic
  const beforeChecks = countCheckAvailability(JSON.parse(dataRaw).tours || JSON.parse(dataRaw));
  const afterChecks = countCheckAvailability(tours);
  const flipCount = beforeChecks - afterChecks;
  console.log(`\n"Check availability" tours: before=${beforeChecks}, after=${afterChecks}, flipped to "From £X": ${flipCount}`);

  if (!CONFIRM) {
    console.log('\n[DRY] No --confirm flag. tours-data.json was NOT written.');
    console.log('Re-run with --confirm to apply.');
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `/tmp/tours-data-eng.${ts}.bak`;
  fs.writeFileSync(backupPath, dataRaw);
  console.log(`\nBackup: ${backupPath}`);

  const out = data.tours ? { ...data, tours } : tours;
  const json = JSON.stringify(out, null, 2);
  fs.writeFileSync(TOURS_FILE, json + '\n');
  console.log(`✓ Wrote ${TOURS_FILE} (${modified} tour${modified === 1 ? '' : 's'} promoted).`);

  console.log('\nApplied:');
  for (const a of applied) {
    console.log(`  ${a.id}  £${a.price}  ${a.conf}  ${a.src}  "${a.name.slice(0, 60)}"`);
  }
})();

function countByConf(tours) {
  const c = { high: 0, medium: 0, low: 0, null: 0 };
  for (const t of tours) {
    const k = t.priceConfidence == null ? 'null' : t.priceConfidence;
    c[k] = (c[k] || 0) + 1;
  }
  return c;
}

function countCheckAvailability(tours) {
  // ENG app.js:154-158 formatPrice:
  //   !Number.isFinite(price) || price <= 0 → "Check availability"
  //   confidence === 'low'                  → "Check availability"
  //   else                                   → "From £X"
  let n = 0;
  for (const t of tours) {
    const validPrice = Number.isFinite(t.price) && t.price > 0;
    if (!validPrice) { n++; continue; }
    if (t.priceConfidence === 'low') { n++; continue; }
  }
  return n;
}
