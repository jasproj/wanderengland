#!/usr/bin/env node
// s49-weng-release: release wave for the four held classes under Jason's 2026-08-25 rulings.
//   Inputs: tours-data.json (at squash 760646f), scripts/evidence/s49-weng-release/recon-packet.json
//   (class membership + classifier view of each stored ladder, re-derived from stamps), and
//   probe-s47.json (fresh 4-date probe of the 11 s47 rows stamped 2026-05-28 — their ladders
//   come from the 2026-08-25 majority reading, never from the stale stamp).
//   Rules: D-624 smallest bookable unit (add-on tiers never anchor); D-614 party-size / party-total
//   ladder floor with tier label verbatim as unit; D-621 whole-boat; s48-R1 per-head rate ladders
//   only; NEW (delta) hire/rental: item priced per duration, floor tier anchors with label verbatim,
//   accessory tiers never anchor unless the product IS the accessory, floor label must carry a
//   duration/unit and must not be a skill grade; NEW (delta) child-audience products anchor on
//   their child tier. Unsampled is never released.
//   Stamp: priceSource s49-weng-release / priceBasis / priceTiers / priceConfidence (+ currency GBP,
//   _unknownFields.priceUnit on releases; priceEnrichmentAt + priceBreakdown refreshed ONLY on the
//   11 re-probed rows). Rows outside A–D byte-identical (round-trip assert).
//   usage: node scripts/s49-weng-release.mjs [--dry-run]
import fs from 'node:fs';
const FILE = 'tours-data.json', EV = 'scripts/evidence/s49-weng-release', SOURCE = 's49-weng-release', DAY = '2026-08-25';
const DRY = process.argv.includes('--dry-run');
const raw = fs.readFileSync(FILE, 'utf8'); const doc = JSON.parse(raw);
if (JSON.stringify(doc, null, 2) + '\n' !== raw) { console.error('ABORT: no byte round-trip (D-599)'); process.exit(2); }
const packet = JSON.parse(fs.readFileSync(`${EV}/recon-packet.json`, 'utf8'));
const probe = JSON.parse(fs.readFileSync(`${EV}/probe-s47.json`, 'utf8'));
const byPk = new Map(doc.tours.map(t => [t.pk, t]));
const u = c => Number((c / 100).toFixed(2));
const ADDON = /per additional|\badditional\b|\bextra\b|\badd[- ]?on\b|\bsupplement\b|\bper item\b/i;
const DURATION = /\b(\d+(\.\d+)?|one|two|three|four|five|six|half|full|all)[\s-]*(hour|hours|hr|hrs|day|days|minute|minutes|min|mins|night|nights|week|weeks)\b|\bhalf[\s-]?(day|hour)\b|\ball[\s-]?day\b|\bovernight\b|\bday (hire|rental)\b/i;
const SKILL = /\b(beginner|beginners|intermediate|advanced|novice|expert|improver)\b/i;
const ACCESSORY = /\b(boots?|gloves?|hoods?|extra[- ]person|extra participants?)\b/i;

// ---- evidence ladders ----
function probeLadder(pk) {
  const ps = (probe.perPk[String(pk)]?.probes || []).filter(p => !p.error && !p.absent);
  if (!ps.length) return null;
  const shapes = new Map();
  for (const p of ps) { const k = JSON.stringify(p.tiers.map(t => [t.singular, t.note, t.priceCents])); shapes.set(k, (shapes.get(k) || 0) + 1); }
  const majK = [...shapes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const maj = ps.find(p => JSON.stringify(p.tiers.map(t => [t.singular, t.note, t.priceCents])) === majK);
  return { tiers: maj.tiers, sampled: ps.length, dateValid: ps.filter(p => p.dateValid).length, shapes: shapes.size, currency: maj.liveCurrency, includeFees: maj.includeFees, includeTaxes: maj.includeTaxes };
}
const fmt = L => L.map(x => `${x.name} £${x.price}`).join(' / ');
function ladderFor(t) {
  const pl = String(t.pk) in probe.perPk ? probeLadder(t.pk) : undefined;
  if (pl === undefined) return { L: t.priceTiers, evid: `stored ladder (stamp ${String(t.priceEnrichmentAt).slice(0, 10)})`, fresh: null };
  if (pl === null) return { L: t.priceTiers, evid: `absent from price-preview items[] on 4/4 dated probes ${DAY} (${probe.dates.join(', ')})`, fresh: null, absent: true };
  const L = pl.tiers.map(c => ({ name: c.singular, note: c.note || '', price: u(c.priceCents), minPartySize: c.min }));
  const caveat = pl.dateValid === 0 ? `evidence from next-departure echo, 0 date-valid on probe dates` : `${pl.dateValid} date-valid`;
  return { L, evid: `${pl.sampled}/4 dated probes ${DAY}, ${caveat}, ${pl.shapes} ladder shape(s), live ${pl.currency}`, fresh: pl };
}
const tierByLabel = (L, label, price) => L.filter(x => x.name === label && (price === undefined || x.price === price)).sort((a, b) => a.price - b.price)[0];
const cheapest = xs => xs.reduce((a, b) => b.price < a.price ? b : a);
const nz = L => L.filter(x => x.price > 0);

// ---- per-class decisions → {pk, action:'release'|'hold', price, label, unit, rule, note} ----
const decisions = [];
const rec = (cls, pk, d) => decisions.push({ cls, pk, ...d });
const pkt = k => packet[k].map(e => e.pk);
const viewOf = pk => { for (const k of ['A', 'B', 'C', 'D']) { const e = packet[k].find(e => e.pk === pk); if (e) return e; } };
const groupTiers = (pk, L) => { const v = viewOf(pk); const g = new Set(v.ladder.filter(t => t.cls === 'group' || t.cls === 'base').map(t => `${t.label}|${t.price}`)); return nz(L).filter(x => g.has(`${x.name}|${x.price}`)); };

// CLASS A
const A_FIX = { 722804: 424, 722381: 318 };
for (const pk of pkt('A')) {
  const t = byPk.get(pk); const { L, evid, absent } = ladderFor(t);
  if (pk === 685635 || pk === 706588) { rec('A', pk, { action: 'hold', rule: 'UNSAMPLED', note: `HELD (UNSAMPLED): ${evid}; stored ${t.priceLabel ? `£${t.price} (${t.priceLabel})` : t.price} retained unpublished — unsampled is never released; re-stamped ${DAY}` }); continue; }
  if (pk === 684706) { rec('A', pk, { action: 'hold', rule: 'package-tier', note: `HELD (package-tier unit unresolvable): live ladder ${fmt(nz(L))} — the hire floor is a dry-hire package whose unit cannot be stated honestly; ${evid}; re-stamped ${DAY}` }); continue; }
  if (A_FIX[pk]) { const x = tierByLabel(L, '2 Adults'); if (!x || x.price !== A_FIX[pk]) throw new Error(`A ${pk}: expected 2 Adults £${A_FIX[pk]}`);
    rec('A', pk, { action: 'release', price: x.price, label: x.name, unit: 'for two adults', rule: 'D-624 smallest bookable unit (Yellow-Bike lineage)', note: `D-624 smallest bookable unit "2 Adults" £${x.price} anchors (Yellow-Bike lineage); "Person · Per additional person" £${tierByLabel(L, 'Person')?.price} is an add-on tier and never anchors; unit "for two adults"; ${evid}` }); continue; }
  if (pk === 568016) { const x = tierByLabel(L, 'Softplay Session'); rec('A', pk, { action: 'release', price: x.price, label: x.name, unit: 'one adult and one child', rule: 'D-624 (tier-note unit, sanctioned)', note: `D-624 base tier "Softplay Session" £${x.price} anchors; unit "one adult and one child" from the tier note "${x.note}" (sanctioned ${DAY}); "Additional Supervising Adult" £3.18 is an add-on tier and never anchors; ${evid}` }); continue; }
  const v = viewOf(pk); const x = tierByLabel(L, v.anchorLabel); if (!x || x.price !== v.anchor) throw new Error(`A ${pk}: anchor drift ${v.anchorLabel} ${v.anchor} vs ${x?.price}`);
  const rule = v.cls === 'whole-boat' ? 'D-621 whole-boat' : 'D-614 party-size ladder floor';
  rec('A', pk, { action: 'release', price: x.price, label: x.name, unit: x.name, rule, note: `${rule}: floor tier "${x.name}" £${x.price} anchors with the tier label verbatim as unit; ladder ${fmt(nz(L))}; ${evid}` });
}
// CLASS B (45 + D's 643718 + 614786)
const B_PKS = [...pkt('B'), 643718, 614786];
for (const pk of B_PKS) {
  const t = byPk.get(pk); const { L, evid } = ladderFor(t); const cls = pkt('B').includes(pk) ? 'B' : 'D';
  if (pk === 412789) { rec(cls, pk, { action: 'hold', rule: 'hire/rental (delta)', note: `HELD (hire/rental rule): mixed lessons + rental ladder ${fmt(nz(L))} with an accessory floor — no honest anchor; re-stamped ${DAY}` }); continue; }
  let cand = groupTiers(pk, L);
  const productIsAccessory = ACCESSORY.test(t.name);
  if (!productIsAccessory) cand = cand.filter(x => !ACCESSORY.test(x.name));
  if (pk === 447100) cand = cand.filter(x => x.name === 'Wetsuit Rental');
  if (!cand.length) { rec(cls, pk, { action: 'hold', rule: 'hire/rental (delta)', note: `HELD (hire/rental rule): no non-accessory hire tier in ladder ${fmt(nz(L))}; re-stamped ${DAY}` }); continue; }
  const x = cheapest(cand);
  if (SKILL.test(x.name)) { rec(cls, pk, { action: 'hold', rule: 'hire/rental (delta)', note: `HELD (hire/rental rule): floor label "${x.name}" is a skill grade, not a duration/unit; ladder ${fmt(nz(L))}; re-stamped ${DAY}` }); continue; }
  // 447100: ruled explicitly — Wetsuit Rental £15.75 anchors regardless of the duration test
  if (!DURATION.test(x.name) && pk !== 447100) { rec(cls, pk, { action: 'hold', rule: 'hire/rental (delta)', note: `HELD (hire/rental rule): floor label "${x.name}" carries no duration/unit${x.note ? ` (note "${x.note}")` : ''}; ladder ${fmt(nz(L))}; re-stamped ${DAY}` }); continue; }
  rec(cls, pk, { action: 'release', price: x.price, label: x.name, unit: x.name, rule: 'hire/rental (delta)', note: `hire/rental rule (delta ${DAY}): the item is priced per duration — floor tier "${x.name}" £${x.price}${x.note ? ` (${x.note})` : ''} anchors with the tier label verbatim as unit${pk === 447100 ? '; boots/gloves/hood tiers are accessories inside the product and never anchor' : pk === 284278 ? '; the product IS the accessory, so its own tier anchors' : ''}; ladder ${fmt(nz(L))}; ${evid}` });
}
// CLASS C (19 party-total + 707528) and D's 4 VR rows
const C_PKS = [...pkt('C'), ...packet.D.filter(e => e.cls === 'volume-wordnum').map(e => e.pk)];
for (const pk of C_PKS) {
  const t = byPk.get(pk); const { L, evid } = ladderFor(t); const v = viewOf(pk); const cls = pkt('C').includes(pk) ? 'C' : 'D';
  if (pk === 707528) { const x = tierByLabel(L, 'Five Adults'); rec(cls, pk, { action: 'release', price: x.price, label: x.name, unit: x.name, rule: 's48-R1 per-head rate ladder', note: `s48-R1 (per-head rate ladder, price falls as band grows): largest band "${x.name}" £${x.price} per person anchors with the tier label verbatim as unit; ladder ${fmt(nz(L))}; ${evid}` }); continue; }
  if (!String(v.ladderDirection).startsWith('party')) throw new Error(`C ${pk}: not a party-total ladder (${v.ladderDirection})`);
  const x = cheapest(groupTiers(pk, L));
  rec(cls, pk, { action: 'release', price: x.price, label: x.name, unit: x.name, rule: 'D-614 party-total ladder floor (delta)', note: `D-614 party-total ladder (delta ${DAY}: price rises with band, so s48-R1 does not apply and a total is never divided by headcount): floor tier "${x.name}" £${x.price} anchors with the tier label verbatim as unit; ladder ${fmt(nz(L))}; ${evid}` });
}
// CLASS D: 62 rule-decided + 8 child-audience
for (const e of packet.D) {
  if (e.cls === 'volume-wordnum' || e.cls === 'hire-rental') continue;
  const t = byPk.get(e.pk); const { L, evid } = ladderFor(t);
  if (e.cls === 'never-only') { const x = cheapest(nz(L)); rec('D', e.pk, { action: 'release', price: x.price, label: x.name, unit: x.name, rule: 'child-audience product (delta)', note: `child-audience rule (delta ${DAY}: never-anchor covers concession variants of an ADULT product; a product whose entire audience is children anchors on its child tier): base tier "${x.name}" £${x.price} anchors, tier label verbatim as unit${x.note ? `; tier note "${x.note}"` : ''}${x.minPartySize > 1 ? `; minimum party size ${x.minPartySize}` : ''}; ladder ${fmt(nz(L))}; ${evid}` }); continue; }
  const x = tierByLabel(L, e.anchorLabel); if (!x || x.price !== e.anchor) throw new Error(`D ${e.pk}: anchor drift`);
  const rule = e.cls === 'whole-boat' ? 'D-621 whole-boat' : 'D-614 party-size ladder floor';
  rec('D', e.pk, { action: 'release', price: x.price, label: x.name, unit: x.name, rule, note: `${rule}: floor tier "${x.name}" £${x.price} anchors with the tier label verbatim as unit; ladder ${fmt(nz(L))}; ${evid}` });
}

// ---- final add-on sweep over every anchor tier (label + note) ----
const sweep = decisions.filter(d => d.action === 'release').map(d => { const t = byPk.get(d.pk); const { L } = ladderFor(t); const x = tierByLabel(L, d.label, d.price); return { pk: d.pk, label: d.label, note: x?.note || '', hit: ADDON.test(d.label + ' ' + (x?.note || '')) }; }).filter(s => s.hit);
if (sweep.length) { console.error('ABORT: add-on-shaped anchor tier(s)', JSON.stringify(sweep)); process.exit(3); }
const seen = new Set(); for (const d of decisions) { if (seen.has(d.pk)) throw new Error(`dup ${d.pk}`); seen.add(d.pk); }
const popPks = new Set(['A', 'B', 'C', 'D'].flatMap(pkt)); if (seen.size !== popPks.size || [...seen].some(pk => !popPks.has(pk))) throw new Error(`population mismatch ${seen.size} vs ${popPks.size}`);

// ---- apply ----
const before = doc.tours.map(t => JSON.stringify(t)); const ts = `${DAY}T${new Date().toISOString().slice(11)}`;
for (const d of decisions) {
  const t = byPk.get(d.pk); const { L, fresh } = ladderFor(t);
  t.priceSource = SOURCE; t.priceTiers = L;
  if (fresh) { t.priceEnrichmentAt = ts; t.priceBreakdown = fresh.tiers.map(c => ({ id: c.id, singular: c.singular, plural: c.plural, note: c.note, priceCents: c.priceCents, price: u(c.priceCents), minPartySize: c.min })); t.priceIncludesBookingFees = fresh.includeFees; t.priceIncludesTaxes = fresh.includeTaxes; }
  if (d.action === 'release') { t.currency = 'GBP'; t.price = d.price; t.priceLabel = d.label; t.priceConfidence = 'high'; t.priceBasis = d.note; t._unknownFields = { ...(t._unknownFields || {}), priceUnit: d.unit }; }
  else { t.priceConfidence = 'low'; t.priceBasis = d.note; if (t._unknownFields) delete t._unknownFields.priceUnit; }
}
const after = doc.tours.map(t => JSON.stringify(t));
const changed = after.map((s, i) => s !== before[i] ? i : -1).filter(i => i >= 0);
const outside = changed.filter(i => !popPks.has(doc.tours[i].pk)); if (outside.length || doc.tours.length !== before.length) { console.error('ABORT: rows outside A–D changed', outside.length); process.exit(4); }
const tally = {}; for (const d of decisions) { tally[d.cls] ??= { released: 0, held: 0 }; tally[d.cls][d.action === 'release' ? 'released' : 'held']++; }
const result = { stampedAt: ts, population: popPks.size, rowsChanged: changed.length, tally, holds: decisions.filter(d => d.action === 'hold').map(d => ({ cls: d.cls, pk: d.pk, name: byPk.get(d.pk).name, reason: d.note })), releases: decisions.filter(d => d.action === 'release').map(d => ({ cls: d.cls, pk: d.pk, name: byPk.get(d.pk).name, price: d.price, label: d.label, unit: d.unit, rule: d.rule })) };
if (!DRY) { fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n'); fs.writeFileSync(`${EV}/apply-summary.json`, JSON.stringify(result, null, 1) + '\n'); }
console.log(JSON.stringify({ dry: DRY, population: popPks.size, rowsChanged: changed.length, tally, holds: result.holds.map(h => `${h.cls} ${h.pk} ${h.name.slice(0, 40)} — ${h.reason.slice(0, 90)}`) }, null, 1));
