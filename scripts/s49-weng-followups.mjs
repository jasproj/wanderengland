#!/usr/bin/env node
// s49-weng-followups: Jason's 2026-08-25 rulings on the two queued follow-ups.
//   335708: hold re-stamped with the fresh 4-date probe (ladder unchanged, still inconsistent).
//   343526 / 343730: released under the NEW sanction (delta): the FareHarbor item API's structured
//   headline may anchor ONLY when arithmetically corroborated by the ladder (add-on rate × included
//   capacity == headline). 343738 stays HELD: £60 × 10 = £600 ≠ £550 headline.
//   Stamp: priceSource s49-weng-followups / priceBasis / priceTiers / priceConfidence; priceUnit on
//   the two releases. All other rows byte-identical (assert).
import fs from 'node:fs';
const FILE = 'tours-data.json', EV = 'scripts/evidence/s49-weng-followups', SOURCE = 's49-weng-followups', DAY = '2026-08-25';
const raw = fs.readFileSync(FILE, 'utf8'); const doc = JSON.parse(raw);
if (JSON.stringify(doc, null, 2) + '\n' !== raw) { console.error('ABORT: no byte round-trip (D-599)'); process.exit(2); }
const byPk = new Map(doc.tours.map(t => [t.pk, t]));
const probe = JSON.parse(fs.readFileSync(`${EV}/probe-335708.json`, 'utf8'));
const item = pk => JSON.parse(fs.readFileSync(`${EV}/item-${pk}.json`, 'utf8'));
const before = doc.tours.map(t => JSON.stringify(t)); const POP = new Set([335708, 343526, 343730, 343738]);
const fmt = L => L.map(x => `${x.name} £${x.price}`).join(' / ');
// 335708 — hold re-stamp from the fresh probe
{ const t = byPk.get(335708); const ps = probe.probes.filter(p => !p.error && !p.absent);
  const L = ps[0].tiers.map(([name, note, price, min]) => ({ name, note: note || '', price, minPartySize: min }));
  if (ps.length !== 4 || !ps.every(p => p.dateValid) || JSON.stringify(L) !== JSON.stringify(t.priceTiers)) { console.error('ABORT: 335708 probe expectation drift'); process.exit(5); }
  t.priceSource = SOURCE; t.priceTiers = L; t.priceConfidence = 'low';
  t.priceBasis = `HELD (inconsistent ladder, re-probed ${DAY}): 4/4 date-valid readings (${probe.probes.map(p => p.date).join(', ')}), ladder unchanged — Child 0-7 £37.1 > Youth 8-15 £16.96, duplicate £0 Child tier, no adult tier (Family £106 is a bundle); operator-side data defect, no honest anchor; live ladder ${fmt(L)}; live GBP`; }
// headline sanction
const REL = { 343526: { headline: 450, cap: 10, addon: 45, unit: 'private group up to 10' }, 343730: { headline: 600, cap: 8, addon: 75, unit: 'private group up to 8 people' } };
for (const [pkS, r] of Object.entries(REL)) { const pk = Number(pkS); const t = byPk.get(pk); const it = item(pk);
  const m = /From £(\d+)/.exec(it.headline); const add = t.priceTiers.find(x => /^Additional person/.test(x.name)); const base = t.priceTiers.find(x => /^Person in a Private Group/.test(x.name));
  if (!m || Number(m[1]) !== r.headline || add.price !== r.addon || base.price !== 0 || r.addon * r.cap !== r.headline) { console.error('ABORT: corroboration failed', pk); process.exit(6); }
  t.priceSource = SOURCE; t.currency = 'GBP'; t.price = r.headline; t.priceLabel = base.name; t.priceConfidence = 'high';
  t.priceBasis = `D-614 party-size floor via the item-API headline sanction (delta ${DAY}: a structured headline anchors ONLY when arithmetically corroborated by the ladder): headline "${it.headline}" — corroborated by add-on rate £${r.addon} × included capacity ${r.cap} = £${r.headline}; the £0 "${base.name}" tier is FareHarbor headcount bookkeeping (note "${base.note}") and the group price is charged outside the price-preview ladder; ladder ${fmt(t.priceTiers)}; unit "${r.unit}"; item record ${DAY}, stored ladder (stamp ${DAY})`;
  t._unknownFields = { ...(t._unknownFields || {}), priceUnit: r.unit }; }
// 343738 — hold with the arithmetic
{ const t = byPk.get(343738); const it = item(343738); t.priceSource = SOURCE; t.priceConfidence = 'low'; if (t._unknownFields) delete t._unknownFields.priceUnit;
  t.priceBasis = `HELD (headline sanction not corroborated, ${DAY}): headline "${it.headline}" vs ladder add-on "Additional person (Off-Peak)" £60 × included capacity 10 = £600 ≠ £550 — the off-peak surcharge is unproven, so neither the headline nor the ladder states the first-head price; ladder ${fmt(t.priceTiers)}; stored ladder (stamp ${DAY})`; }
const after = doc.tours.map(t => JSON.stringify(t)); const changed = after.map((s, i) => s !== before[i] ? i : -1).filter(i => i >= 0);
if (changed.length !== 4 || changed.some(i => !POP.has(doc.tours[i].pk))) { console.error('ABORT: unexpected change set', changed.length); process.exit(4); }
fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');
fs.writeFileSync(`${EV}/apply-summary.json`, JSON.stringify({ stampedAt: DAY, released: [343526, 343730], held: [335708, 343738], rows: [...POP].map(pk => ({ pk, price: byPk.get(pk).price, label: byPk.get(pk).priceLabel, conf: byPk.get(pk).priceConfidence, unit: byPk.get(pk)._unknownFields?.priceUnit ?? null, basis: byPk.get(pk).priceBasis })) }, null, 1) + '\n');
console.log('applied 4 rows');
