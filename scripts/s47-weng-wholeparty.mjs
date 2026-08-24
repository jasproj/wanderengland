// s47-weng-wholeparty: apply the s47 ruling on the 266-row price==max(ladder)!=min population.
//   236 (ADULT-FIRST 217 + VOLUME-LADDER 19) closed, no action — byte-identical, asserted.
//   8 MAX-TIER      -> per-person floor of the live ladder (D-597/D-600), priceLabel = floor tier.
//   10 re-anchors   -> the real per-person tier (WHAW 391875 pattern). Two of the ten (685635, 706588)
//                      were UNSAMPLED on 17/17 dates -> no live figure -> held low instead (flagged).
//   11 holds+568016 -> priceConfidence low, price unchanged, true live amount stamped in priceBasis.
// Evidence: scripts/evidence/s47-weng-wholeparty/probe-30.json (17 dates, include_breakdown, GBP).
import fs from 'fs';
const FILE = 'tours-data.json';
const SOURCE = 's47-weng-wholeparty';
const ev = JSON.parse(fs.readFileSync('scripts/evidence/s47-weng-wholeparty/probe-30.json', 'utf8'));
const plan = JSON.parse(fs.readFileSync('scripts/evidence/s47-weng-wholeparty/plan.json', 'utf8'));
const raw = fs.readFileSync(FILE, 'utf8');
const doc = JSON.parse(raw);
if (JSON.stringify(doc, null, 2) + '\n' !== raw) { console.error('ABORT: no byte round-trip'); process.exit(2); }
const before = doc.tours.map(t => JSON.stringify(t));
const u = c => Number((c / 100).toFixed(2));
const summary = [];
function readings(pk) {
  const p = ev.perPk[pk];
  const rs = p.probes.filter(r => !r.error && !r.absent && !r.zeroOnly);
  if (rs.some(r => r.liveCurrency && r.liveCurrency !== 'GBP')) { console.error(`ABORT pk ${pk}: non-GBP live currency -> D-620`); process.exit(5); }
  const key = r => JSON.stringify(r.tiers.filter(t => t.priceCents > 0).map(t => [t.singular, t.priceCents]));
  const counts = new Map(); for (const r of rs) counts.set(key(r), (counts.get(key(r)) || 0) + 1);
  const majKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const maj = rs.find(r => key(r) === majKey) || null;
  return { rs, valid: rs.filter(r => r.dateValid), maj, ladders: counts.size };
}
const ladder = r => r.tiers.map(t => ({ name: t.singular, note: t.note || '', price: u(t.priceCents), minPartySize: t.min ?? null }));
for (const [cls, pks] of Object.entries(plan)) for (const pk of pks) {
  const t = doc.tours.find(x => x.pk === pk); if (!t) { console.error(`ABORT: pk ${pk} missing`); process.exit(3); }
  const { rs, valid, maj, ladders } = readings(pk);
  const old = t.price;
  if (rs.length === 0) {   // UNSAMPLED -> hold low, no figure written
    t.priceConfidence = 'low'; t.priceSource = SOURCE;
    t.priceBasis = `HELD (${cls}): UNSAMPLED on 17/17 probe dates (absent from price-preview items[]); stored ceiling £${old} (${t.priceLabel}) retained unpublished, re-anchor deferred until a live reading exists`;
    t.priceTiers = (t.priceBreakdown || []).map(x => ({ name: x.singular, note: x.note || '', price: x.price, minPartySize: x.minPartySize ?? null }));
    summary.push({ pk, cls, action: 'HOLD-UNSAMPLED', old, new: old }); continue;
  }
  const L = ladder(maj); const nz = L.filter(x => x.price > 0);
  const CONC = /\b(child|children|kid|infant|youth|junior|senior|concession|student|toddler|baby)\b/i;   // MAX-TIER floor is the adult per-person floor, never a concession tier
  const ceiling = Math.max(...nz.map(x => x.price)); const floorT = nz.filter(x => !CONC.test(x.name)).reduce((a, b) => b.price < a.price ? b : a);
  const ev_ = `${valid.length} date-valid + ${rs.length - valid.length} re-anchored (D-606) readings, ${ladders} ladder shape(s), live GBP`;
  if (cls === 'MAX-TIER') {
    if (t.price !== ceiling && !(pk === 608210 && t.price === 74.2)) { console.error(`ABORT pk ${pk}: stored ${t.price} != live ceiling ${ceiling}`); process.exit(3); }
    // floor must be present in every reading
    if (!rs.every(r => r.tiers.some(x => x.singular === floorT.name && u(x.priceCents) === floorT.price))) { console.error(`ABORT pk ${pk}: floor tier not stable`); process.exit(3); }
    t.price = floorT.price; t.priceLabel = floorT.name; t.priceConfidence = 'high'; t.priceSource = SOURCE;
    t.priceBasis = `D-597 live floor of a same-unit per-person ladder (${floorT.name} £${floorT.price}); the Math.max ceiling (£${old}) rejected under D-600 — product names neither tier; ${ev_}`;
    t.priceTiers = L; summary.push({ pk, cls, action: 'FLOOR', old, new: t.price, label: floorT.name });
  } else if (cls === 'REANCHOR') {
    // per-person tier = lowest non-zero non-ceiling tier that is non-zero on >=3 date-valid readings
    const cands = new Map();
    for (const r of valid) for (const x of r.tiers) if (x.priceCents > 0 && u(x.priceCents) < t.price) cands.set(x.singular + '|' + x.priceCents, (cands.get(x.singular + '|' + x.priceCents) || 0) + 1);
    const ok = [...cands.entries()].filter(([, n]) => n >= 3).map(([k]) => ({ name: k.split('|')[0], price: u(Number(k.split('|')[1])), n: cands.get(k) }));
    if (!ok.length) { console.error(`ABORT pk ${pk}: no per-person tier with >=3 date-valid readings`); process.exit(3); }
    const pp = ok.reduce((a, b) => b.price < a.price ? b : a);
    t.price = pp.price; t.priceLabel = pp.name; t.priceConfidence = 'high'; t.priceSource = SOURCE;
    t.priceBasis = `Re-anchored (WHAW 391875 pattern) from the whole-party ceiling £${old} to the per-person tier ${pp.name} £${pp.price} (non-zero on ${pp.n} date-valid readings); ${ev_}`;
    t.priceTiers = L; summary.push({ pk, cls, action: 'REANCHOR', old, new: t.price, label: pp.name });
  } else { // HOLD / HOLD-AMBIG
    t.priceConfidence = 'low'; t.priceSource = SOURCE;
    const live = nz.map(x => `${x.name} £${x.price}`).join(' / ');
    const minority = ladders > 1 ? `; minority reading(s) differ (${[...new Set(rs.map(r => r.tiers.filter(x => x.priceCents > 0).map(x => `${x.singular} £${u(x.priceCents)}`).join(' / ')))].filter(s => s !== live).join(' | ')})` : '';
    t.priceBasis = `HELD (${cls}): stored £${old} (${t.priceLabel}) is a whole-party/bundle unit with no standalone per-person tier; live majority ladder ${live}${minority}; unpublished pending priceUnit port; ${ev_}`;
    t.priceTiers = L; summary.push({ pk, cls, action: 'HOLD', old, new: old, liveMajorityCeiling: ceiling });
  }
}
const after = doc.tours.map(t => JSON.stringify(t));
const changed = after.map((s, i) => s !== before[i] ? doc.tours[i].pk : null).filter(Boolean);
const planned = Object.values(plan).flat();
if (changed.length !== planned.length || changed.some(pk => !planned.includes(pk)) || doc.tours.length !== before.length) { console.error('ABORT: unintended rows differ', changed.length); process.exit(4); }
fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');
fs.writeFileSync('scripts/evidence/s47-weng-wholeparty/apply-summary.json', JSON.stringify(summary, null, 1) + '\n');
for (const s of summary) console.log(`${s.cls.padEnd(10)} pk ${s.pk} ${s.action.padEnd(14)} £${s.old} -> £${s.new} ${s.label || ''}`);
console.log(`changed rows: ${changed.length}`);
