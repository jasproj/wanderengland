#!/usr/bin/env node
// s49-weng-wave2: release the 283 remaining s48-A HELD rows under the s49 rule set + Jason's
//   2026-08-25 rulings on the 15 that needed one. Decisions come from the recon
//   (scripts/evidence/s49-weng-wave2/recon-wave2.json: classifier view of each stored ladder,
//   proposed anchor + unit per rule) plus the explicit overrides below. Ladders are the stored
//   priceTiers (all stamped 2026-08-25). No price moves in the rule-decided class (asserted).
//   New rulings recorded (delta): add-on abort fires only when the anchor tier ITSELF is priced as
//   an add-on (label shape or "per additional"/"price per item" note), not when a note merely
//   advertises extras; a single-tier product anchors on its sole tier (the tier is the audience);
//   a unit may derive from the product name quoted verbatim (WAMS description-sanction extension).
//   usage: node scripts/s49-weng-wave2.mjs [--dry-run]
import fs from 'node:fs';
const FILE = 'tours-data.json', EV = 'scripts/evidence/s49-weng-wave2', SOURCE = 's49-weng-wave2', DAY = '2026-08-25';
const DRY = process.argv.includes('--dry-run');
const raw = fs.readFileSync(FILE, 'utf8'); const doc = JSON.parse(raw);
if (JSON.stringify(doc, null, 2) + '\n' !== raw) { console.error('ABORT: no byte round-trip (D-599)'); process.exit(2); }
const recon = JSON.parse(fs.readFileSync(`${EV}/recon-wave2.json`, 'utf8'));
const byPk = new Map(doc.tours.map(t => [t.pk, t]));
const pop = doc.tours.filter(t => t.priceSource === 's48-weng-refresh' && /HELD/.test(t.priceBasis || ''));
if (pop.length !== 283 || recon.length !== 283 || pop.some(t => !recon.find(e => e.pk === t.pk))) { console.error('ABORT: population drift', pop.length, recon.length); process.exit(5); }
const ADDON_SELF = /per additional|\bprice per item\b/i;   // note wording that prices the tier itself as an add-on
const ADDON_LABEL = /\badditional\b|\bextra\b|\badd[- ]?on\b|\bsupplement\b/i;
const fmt = L => L.filter(x => x.price > 0).map(x => `${x.name} £${x.price}`).join(' / ');
const tier = (t, label, price) => t.priceTiers.find(x => x.name === label && x.price === price);

// ---- Jason's rulings on the 15 (2026-08-25) ----
const OVR = {
  614027: { release: true, label: 'Basic Party', unit: 'for 10 people', rule: 'D-614 party-size floor; add-on-abort refinement (delta)', why: 'unit "for 10 people" from the tier note "For 10 people, select and option to add additional guests" — the note advertises extras, the tier itself is not priced as an add-on (sweep refinement, delta 2026-08-25); "Additional Person" tiers never anchor' },
  614000: { release: true, label: 'Basic Party', unit: 'for 10 people', rule: 'D-614 party-size floor; add-on-abort refinement (delta)', why: 'unit "for 10 people" from the tier note "For 10 people, select and option to add additional guests" — the note advertises extras, the tier itself is not priced as an add-on (sweep refinement, delta 2026-08-25); "Additional Person" tiers never anchor' },
  301527: { release: true, label: 'Student', unit: 'Student', rule: 'single-tier product (delta)', why: 'a single-tier product anchors on its sole tier — the tier is the entire audience (delta 2026-08-25); unit = tier label verbatim' },
  303752: { release: true, label: 'Student', unit: 'Student', rule: 'single-tier product (delta)', why: 'a single-tier product anchors on its sole tier — the tier is the entire audience (delta 2026-08-25); unit = tier label verbatim' },
  421749: { release: true, label: 'Student', unit: 'Student', rule: 'single-tier product (delta)', why: 'a single-tier product anchors on its sole tier — the tier is the entire audience (delta 2026-08-25); unit = tier label verbatim' },
  262403: { release: true, label: '1:1 Training • own bike', unitFromName: true, rule: 'D-614 party-size floor; unit from product name (delta)', why: 'unit derives from the product name quoted verbatim (delta 2026-08-25, extension of the WAMS description sanction)' },
  621590: { release: true, label: 'One Hour Lesson', unitFromName: true, rule: 'D-614 party-size floor; unit from product name (delta)', why: 'unit derives from the product name quoted verbatim (delta 2026-08-25, extension of the WAMS description sanction)' },
  621614: { release: true, label: 'One Hour Lesson', unitFromName: true, rule: 'D-614 party-size floor; unit from product name (delta)', why: 'unit derives from the product name quoted verbatim (delta 2026-08-25, extension of the WAMS description sanction)' },
  621605: { release: true, label: 'One Hour Lesson', unit: 'per boat lesson', rule: 'D-621 whole-boat; unit from product name (delta)', why: 'unit "per boat lesson" from the product name "Private Boat Kitesurfing Lessons" (delta 2026-08-25, unit-from-name)' },
  543098: { release: true, label: 'Two Hours', unit: 'per boat, two hours', rule: 'D-621 whole-boat; unit from product name (delta)', why: 'unit "per boat, two hours" from the product name "Crocodile Electric Boat" + tier label "Two Hours" (delta 2026-08-25, unit-from-name)' },
  343738: { hold: 'zero-priced base tier + per-person add-on: first-head pricing is unknowable from the ladder; queued for operator-page check' },
  343526: { hold: 'zero-priced base tier + per-person add-on: first-head pricing is unknowable from the ladder; queued for operator-page check' },
  343730: { hold: 'zero-priced base tier + per-person add-on: first-head pricing is unknowable from the ladder; queued for operator-page check' },
  335708: { hold: 'inconsistent ladder: Child 0-7 £37.1 > Youth 8-15 £16.96; queued for re-probe' },
  375972: { hold: '"People with Kayaks" — unit unresolvable' },
};
const decisions = [];
for (const e of recon) {
  const t = byPk.get(e.pk); const o = OVR[e.pk];
  if (o?.hold) { decisions.push({ pk: e.pk, action: 'hold', note: `HELD (s49 wave-2 ruling): ${o.hold}; ladder ${fmt(t.priceTiers)}; re-stamped ${DAY}` }); continue; }
  if (o) {
    const x = t.priceTiers.filter(x => x.name === o.label).sort((a, b) => a.price - b.price)[0]; if (!x) throw new Error(`${e.pk}: tier ${o.label} missing`);
    const unit = o.unitFromName ? t.name.trim() : o.unit;
    decisions.push({ pk: e.pk, action: 'release', price: x.price, label: x.name, unit, rule: o.rule, note: `${o.rule}: tier "${x.name}" £${x.price} anchors; ${o.why}; ladder ${fmt(t.priceTiers)}; stored ladder (stamp ${DAY})` }); continue;
  }
  if (e.bucket !== 'DECIDED' || !o && !e.anchorLabel) throw new Error(`${e.pk}: not decided and no ruling`);
  const x = tier(t, e.anchorLabel, e.anchor); if (!x) throw new Error(`${e.pk}: anchor tier drift`);
  if (x.price !== t.price) throw new Error(`${e.pk}: rule-decided class must not move price (${t.price} → ${x.price})`);
  const src = e.unit === x.name ? 'tier label verbatim' : e.unit === (x.note || '').trim() ? `tier note "${x.note}"` : 'tier wording';
  decisions.push({ pk: e.pk, action: 'release', price: x.price, label: x.name, unit: e.unit, rule: e.rule, note: `${e.rule}: floor tier "${x.name}" £${x.price} anchors with unit "${e.unit}" (${src}); ladder ${fmt(t.priceTiers)}; stored ladder (stamp ${DAY})` });
}
// add-on sweep (refined): anchor tier itself priced as an add-on → abort
const hits = decisions.filter(d => d.action === 'release').filter(d => { const x = byPk.get(d.pk).priceTiers.find(x => x.name === d.label && x.price === d.price); return ADDON_LABEL.test(d.label) || ADDON_SELF.test(x?.note || ''); });
if (hits.length) { console.error('ABORT: anchor tier priced as add-on', JSON.stringify(hits.map(h => [h.pk, h.label]))); process.exit(3); }
if (decisions.length !== 283) throw new Error('decision count');
const before = doc.tours.map(t => JSON.stringify(t)); const popSet = new Set(pop.map(t => t.pk));
const priceBefore = new Map(pop.map(t => [t.pk, t.price]));
for (const d of decisions) {
  const t = byPk.get(d.pk); t.priceSource = SOURCE; t.priceBasis = d.note;
  if (d.action === 'release') { t.currency = 'GBP'; t.price = d.price; t.priceLabel = d.label; t.priceConfidence = 'high'; t._unknownFields = { ...(t._unknownFields || {}), priceUnit: d.unit }; }
  else { t.priceConfidence = 'low'; if (t._unknownFields) delete t._unknownFields.priceUnit; }
}
const after = doc.tours.map(t => JSON.stringify(t));
const changed = after.map((s, i) => s !== before[i] ? i : -1).filter(i => i >= 0);
const outside = changed.filter(i => !popSet.has(doc.tours[i].pk)); if (outside.length || doc.tours.length !== before.length) { console.error('ABORT: rows outside the 283 changed', outside.length); process.exit(4); }
const priceMoves = decisions.filter(d => byPk.get(d.pk).price !== priceBefore.get(d.pk)).map(d => d.pk);
const ruleDecidedMoves = priceMoves.filter(pk => !OVR[pk]);
if (ruleDecidedMoves.length) { console.error('ABORT: price moved in rule-decided class', ruleDecidedMoves); process.exit(6); }
const rel = decisions.filter(d => d.action === 'release'), held = decisions.filter(d => d.action === 'hold');
const byRule = {}; for (const d of rel) byRule[d.rule] = (byRule[d.rule] || 0) + 1;
const result = { stampedAt: DAY, population: 283, rowsChanged: changed.length, released: rel.length, held: held.length, priceMovesAll: priceMoves, priceMovesRuleDecided: ruleDecidedMoves, byRule, holds: held.map(d => ({ pk: d.pk, name: byPk.get(d.pk).name, reason: d.note })), releases: rel.map(d => ({ pk: d.pk, name: byPk.get(d.pk).name, price: d.price, label: d.label, unit: d.unit, rule: d.rule })) };
if (!DRY) { fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n'); fs.writeFileSync(`${EV}/apply-summary.json`, JSON.stringify(result, null, 1) + '\n'); }
console.log(JSON.stringify({ dry: DRY, rowsChanged: changed.length, released: rel.length, held: held.length, priceMovesAll: priceMoves, byRule }, null, 1));
