// s45-weng-charter-2: adjudicate the 2 unswept `priceLabel:"charter"` rows on WENG
// (pk 374939, 553130 — extract-price-v5.js:141 Math.max fingerprint). Both are class (b)
// max-tier defects under D-600: stored == Four Hour ceiling, product names neither tier,
// durationText empty. Repriced to the live floor (D-597) from the tracked evidence in
// scripts/evidence/s45-weng-charter-2-probe.json. "Up to 11 people" is a party-size unit,
// not a vessel assertion — priceLabel/unit untouched (D-596). Live currency GBP (D-620 n/a).
import fs from 'fs';
const FILE = 'tours-data.json';
const EVIDENCE = 'scripts/evidence/s45-weng-charter-2-probe.json';
const SOURCE = 's45-weng-charter-2';
const ev = JSON.parse(fs.readFileSync(EVIDENCE, 'utf8'));
if (ev.details.currency !== 'GBP') { console.error('ABORT: live currency != GBP'); process.exit(2); }
const raw = fs.readFileSync(FILE, 'utf8');
const doc = JSON.parse(raw);
if (JSON.stringify(doc, null, 2) + '\n' !== raw) { console.error('ABORT: no byte round-trip'); process.exit(2); }
const before = doc.tours.map(t => JSON.stringify(t));
let written = 0;
for (const pk of ev.pks) {
  const p = ev.perPk[pk];
  // date-valid readings + D-606 re-anchor (fallback echo with an identical ladder)
  const readings = p.probes.filter(r => !r.error && !r.absent && !r.zeroOnly);
  const valid = readings.filter(r => r.dateValid);
  const ladderKey = r => JSON.stringify(r.tiers.filter(t => t.priceCents > 0).map(t => [t.singular, t.priceCents]));
  const keys = new Set(readings.map(ladderKey));
  if (keys.size !== 1) { console.error(`ABORT pk ${pk}: ladder unstable`); process.exit(3); }
  const counted = readings.length; // valid + re-anchored, all identical
  if (valid.length < 3) { console.error(`ABORT pk ${pk}: only ${valid.length} date-valid`); process.exit(3); }
  const tiers = readings[0].tiers.filter(t => t.priceCents > 0).map(t => ({ name: t.singular, note: t.note, price: t.priceCents / 100, minPartySize: t.min }));
  const floor = Math.min(...tiers.map(t => t.price));
  const ceiling = Math.max(...tiers.map(t => t.price));
  const t = doc.tours.find(x => x.pk === pk);
  if (t.priceLabel !== 'charter') { console.error(`ABORT pk ${pk}: not charter`); process.exit(3); }
  if (t.price === floor && t.priceSource === SOURCE) { console.log(`pk ${pk}: already written by ${SOURCE}`); continue; }
  if (t.price !== ceiling) { console.error(`ABORT pk ${pk}: stored ${t.price} != ceiling ${ceiling}; not a Math.max pick`); process.exit(3); }
  const names = (t.name + ' ' + (t.durationText || '')).toLowerCase();
  const top = tiers.find(x => x.price === ceiling);
  if (names.includes(top.name.toLowerCase().replace(' private charter', ''))) { console.error(`ABORT pk ${pk}: product names the ceiling tier — class (a)/(d), not (b)`); process.exit(3); }
  const old = t.price;
  t.price = floor;
  t.priceConfidence = 'high';
  t.priceSource = SOURCE;
  t.priceBasis = `D-597 live floor of the ladder (${tiers.find(x => x.price === floor).name}); the Math.max ceiling (£${ceiling}) was rejected under D-600 — product names neither tier; ${valid.length} date-valid + ${counted - valid.length} re-anchored (D-606) readings`;
  t.tiers = tiers;
  written++;
  console.log(`pk ${pk}: £${old} -> £${floor} (${tiers.map(x => `${x.name} £${x.price}`).join(' / ')})`);
}
const after = doc.tours.map(t => JSON.stringify(t));
const changed = after.map((s, i) => s !== before[i] ? doc.tours[i].pk : null).filter(Boolean);
if (changed.some(pk => !ev.pks.includes(pk)) || doc.tours.length !== before.length) { console.error('ABORT: unintended rows differ'); process.exit(4); }
fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');
console.log(`written ${written}, changed rows: ${changed.join(',')}`);
