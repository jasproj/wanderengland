#!/usr/bin/env node
// s48-weng-floorfix: re-derive the stored floor of every s48 HELD row from its stamped ladder
// with the corrected rule — the floor is the min over group/base tiers; add-on/child/kit tiers
// (never-branch, now also matched by add-on wording in the tier note) never supply it; all
// non-zero tiers only as a fallback. Touches only rows whose floor/label moves. Offline: no requests.
//   usage: node scripts/s48-weng-floorfix.mjs [--dry-run]
import fs from 'node:fs'; import vm from 'node:vm';
const FILE = 'tours-data.json', EV = 'scripts/evidence/s48-weng-floorfix', DRY = process.argv.includes('--dry-run');
const raw = fs.readFileSync(FILE, 'utf8'); const doc = JSON.parse(raw);
if (JSON.stringify(doc, null, 2) + '\n' !== raw) { console.error('ABORT: no byte round-trip (D-599)'); process.exit(2); }
// the classifier is the one in the canonical s48 writer — load that exact source, no copy
const src = fs.readFileSync('scripts/s48-weng-refresh-a.mjs', 'utf8');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(src.slice(src.indexOf('// ---- tier classification'), src.indexOf('function apply()')) + '\n;this.classifyTier = classifyTier;', ctx);
const summ = JSON.parse(fs.readFileSync('scripts/evidence/s48-weng-refresh-a/apply-summary.json', 'utf8'));
const held = new Set(summ.summary.filter(r => r.disposition === 'HELD').map(r => r.pk));
const u = c => Number((c / 100).toFixed(2));
const before = doc.tours.map(t => JSON.stringify(t)); const changes = [];
for (const t of doc.tours) {
  if (!held.has(t.pk)) continue;
  if (t.priceSource !== 's48-weng-refresh' || t.priceConfidence !== 'low') { console.error('ABORT: held row not in expected state', t.pk); process.exit(3); }
  const tiers = t.priceBreakdown.map(b => ({ singular: b.singular, note: b.note, priceCents: b.priceCents, min: b.minPartySize }));
  const classes = tiers.map(x => ({ x, cls: ctx.classifyTier(x, t.name) }));
  const nz = tiers.filter(x => x.priceCents > 0);
  const gb = classes.filter(c => (c.cls === 'group' || c.cls === 'base') && c.x.priceCents > 0).map(c => c.x);
  if (!nz.length) continue;
  const floor = (gb.length ? gb : nz).reduce((a, b) => b.priceCents < a.priceCents ? b : a);
  const np = u(floor.priceCents);
  if (np === t.price && floor.singular === t.priceLabel) continue;
  const needle = `floor £${t.price} (${t.priceLabel})`;
  if (!t.priceBasis.includes(needle)) { console.error('ABORT: basis text mismatch', t.pk, needle); process.exit(4); }
  changes.push({ pk: t.pk, name: t.name, old: t.price, oldLabel: t.priceLabel, new: np, label: floor.singular, excluded: classes.filter(c => c.cls === 'never' && c.x.priceCents > 0).map(c => `${c.x.singular} £${u(c.x.priceCents)}`) });
  t.priceBasis = t.priceBasis.replace(needle, `floor £${np} (${floor.singular})`) + '; floor re-derived by s48-weng-floorfix (add-on/child/kit tiers excluded from the floor)';
  t.price = np; t.priceLabel = floor.singular;
  const rec = summ.summary.find(r => r.pk === t.pk); rec.new = np; rec.label = floor.singular; rec.floorfix = { old: changes.at(-1).old, oldLabel: changes.at(-1).oldLabel };
}
const after = doc.tours.map(t => JSON.stringify(t));
const changed = after.map((s, i) => s !== before[i] ? doc.tours[i].pk : null).filter(Boolean);
if (changed.length !== changes.length || changed.some(pk => !held.has(pk))) { console.error('ABORT: unintended rows differ'); process.exit(5); }
for (const c of changes) console.log(`${c.pk}: £${c.old} (${c.oldLabel}) -> £${c.new} (${c.label})   excluded: ${c.excluded.join(', ') || '—'}`);
console.log(`changed rows: ${changes.length} of ${held.size} HELD${DRY ? ' [dry-run]' : ''}`);
if (!DRY) {
  fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');
  summ.floorfix = { changedRows: changes.length, rule: 'held floor = min over group/base tiers; never-branch (name or add-on note wording) excluded; all non-zero only as fallback' };
  fs.writeFileSync('scripts/evidence/s48-weng-refresh-a/apply-summary.json', JSON.stringify(summ, null, 1) + '\n');
  fs.writeFileSync(`${EV}/changes.json`, JSON.stringify({ heldRows: held.size, changes }, null, 1) + '\n');
}
