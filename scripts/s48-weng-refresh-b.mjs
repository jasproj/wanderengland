#!/usr/bin/env node
// s48-weng-refresh-b: 88-day price-stamp refresh, batch B — the strictly unstamped legacy rows.
//   Population: rows carrying NONE of priceEnrichmentAt / priceEnrichmentSource / priceEnrichmentStatus /
//   priceSource / priceBasis / priceConfidenceSource (the 2 s45-weng-charter-2 rows 374939/553130 carry
//   priceSource and are therefore excluded). Re-derived in-branch at run time. Same rules as batch A.
//   Endpoint/batching/join-by-id per the vendored scripts/extract-prices-v7-api.js (D-613
//   lineage): price-preview/per-item/v2, include_breakdown=yes, ≤20 pks per request,
//   1 req/s, dated requests (date-validity instrument, D-606).
//   Anchor rule (D-624): cheapest ADULT/BASE per-person tier anchors "From". Child/infant/
//   concession/family-bundle/add-on/gratuity tiers never anchor. Same-customer-type ladders
//   split by departure logistics are one product (D-625) — the cheapest base tier wins.
//   Whole-party-only ladders → HELD low with basis (D-621; no priceUnit render path yet).
//   Absent on every date → UNSAMPLED, low, reason stamped. All-zero ladder → zero_price, low.
//   Non-GBP live currency → D-620 hold, true currency + amount stamped, low.
//   usage: node scripts/s48-weng-refresh-b.mjs probe|apply [--dry-run]
import fs from 'node:fs';
const FILE = 'tours-data.json';
const EV = 'scripts/evidence/s48-weng-refresh-b';
const SOURCE = 's48-weng-refresh-b';
const STAMP_DAY = '2026-08-25';
const DATES = ['2026-08-31', '2026-09-14', '2026-09-28', '2026-10-19'];
const BATCH = 20, RATE_MS = 1000, TIMEOUT_MS = 25000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const mode = process.argv[2]; const DRY = process.argv.includes('--dry-run');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const u = c => Number((c / 100).toFixed(2));

function parseFhUrl(bookingUrl) {   // identical to v7
  if (!bookingUrl || !bookingUrl.includes('fareharbor.com')) return null;
  const m = bookingUrl.match(/fareharbor\.com\/(?:embeds\/book\/)?([^/]+)\/items\/(\d+)/);
  if (!m) return null; const [, shortname, pk] = m;
  if (shortname === 'embeds' || shortname === 'items') return null;
  return { shortname, pk: Number(pk) };
}
const raw = fs.readFileSync(FILE, 'utf8'); const doc = JSON.parse(raw);
if (JSON.stringify(doc, null, 2) + '\n' !== raw) { console.error('ABORT: no byte round-trip (D-599)'); process.exit(2); }
const STAMPS = ['priceEnrichmentAt', 'priceEnrichmentSource', 'priceEnrichmentStatus', 'priceSource', 'priceBasis', 'priceConfidenceSource'];
const EXCLUDE = new Set([374939, 553130]);   // s45-weng-charter-2 rows — carry priceSource, ruled separately
const inB = t => !STAMPS.some(k => k in t);
const pop = doc.tours.filter(t => inB(t) && !EXCLUDE.has(t.pk));
console.error(`population B_strict=${doc.tours.filter(inB).length} (excluded present in strict set: ${doc.tours.filter(t => inB(t) && EXCLUDE.has(t.pk)).length}) -> ${pop.length}`);
for (const t of pop) { const p = parseFhUrl(t.bookingUrl); if (!p || p.pk !== t.pk) { console.error('ABORT: bookingUrl pk mismatch', t.pk); process.exit(2); } }

async function get(url, ms) {
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ac.signal });
    if (r.status !== 200) return { err: 'HTTP ' + r.status }; return { j: await r.json() }; }
  catch (e) { return { err: String(e.name === 'AbortError' ? 'timeout' : e.message) }; } finally { clearTimeout(tm); }
}
const batchUrl = (sn, pks, date) => `https://fareharbor.com/api/embed/${sn}/price-preview/per-item/v2/?item_pks=${pks.join(',')}&include_breakdown=yes&date=${date}`;

async function probe() {
  const bySn = new Map();
  for (const t of pop) { const { shortname } = parseFhUrl(t.bookingUrl); if (!bySn.has(shortname)) bySn.set(shortname, []); bySn.get(shortname).push(t.pk); }
  const out = { startedAt: new Date().toISOString(), dates: DATES, population: pop.length, shortnames: bySn.size, requests: 0, retries: [], perPk: {} };
  for (const t of pop) out.perPk[t.pk] = { probes: [] };
  // one request per (shortname, chunk, date); on timeout/5xx split the chunk in half and retry once per half (bounded)
  async function run(sn, pks, date, depth) {
    out.requests++;
    const x = await get(batchUrl(sn, pks, date), TIMEOUT_MS); await sleep(RATE_MS);
    if (x.err && /timeout|HTTP 5/.test(x.err) && pks.length > 1 && depth < 2) {
      out.retries.push({ sn, date, size: pks.length, err: x.err, split: true });
      const h = Math.ceil(pks.length / 2); await sleep(2000);
      await run(sn, pks.slice(0, h), date, depth + 1); await run(sn, pks.slice(h), date, depth + 1); return;
    }
    const items = new Map(((x.j && x.j.items) || []).map(it => [Number(it.id), it]));
    for (const pk of pks) {
      const it = items.get(pk); const p = { date, error: x.err || null };
      if (!x.err) { p.absent = !it; p.liveCurrency = x.j.details?.currency ?? null; p.includeFees = x.j.details?.prices_include_booking_fees ?? null; p.includeTaxes = x.j.details?.prices_include_taxes ?? null; }
      if (it) { const sa = it.availability?.start_at || null; p.start_at = sa; p.dateValid = !!sa && sa.slice(0, 10) === date;
        const cts = Array.isArray(it.price?.breakdown?.customer_types) ? it.price.breakdown.customer_types : [];
        p.tiers = cts.map(c => ({ id: c.id, singular: c.singular, plural: c.plural, note: c.note, priceCents: c.price, min: c.min_party_size }));
        p.low = it.price?.low ?? null; p.zeroOnly = !cts.some(c => c.price > 0); }
      out.perPk[pk].probes.push(p);
    }
  }
  let n = 0;
  for (const [sn, pks] of bySn) {
    for (let i = 0; i < pks.length; i += BATCH) for (const date of DATES) await run(sn, pks.slice(i, i + BATCH), date, 0);
    n++; if (n % 10 === 0) process.stderr.write(`${n}/${bySn.size} operators, ${out.requests} req\n`);
    fs.writeFileSync(`${EV}/probe.json`, JSON.stringify(out));
  }
  out.finishedAt = new Date().toISOString();
  // reconcile: every population pk must have exactly DATES.length probe entries
  const bad = Object.entries(out.perPk).filter(([, v]) => v.probes.length !== DATES.length);
  out.reconcile = { population: pop.length, pksWithFullProbeSet: pop.length - bad.length, incomplete: bad.map(([k]) => k) };
  fs.writeFileSync(`${EV}/probe.json`, JSON.stringify(out));
  console.log(JSON.stringify({ requests: out.requests, retries: out.retries.length, reconcile: out.reconcile }));
}

// ---- tier classification (D-624 / D-625 / D-621) ----
const NEVER = /\b(child|childs|child's|children|childrens|children's|kid|kids|kid's|infant|infants|baby|babies|toddler|junior|juniors|youth|youths|teen|teenager|teens|adolescent|adolescents|young adult|student|students|senior|seniors|oap|concession|concessions|pensioner|disabled|wheelchair|carer|companion|blue light|nhs|discount|under\s*\d+s?|\d+\s*(and|&)\s*under|family|families|bundle|package|add[- ]?on|extra|extras|additional|supplement|upgrade|gratuity|tip|tips|donation|deposit|voucher|gift card|redemption|per additional|spectator|non[- ]?participant|dog|dogs|pet|pets|kit|merchandise|parking|niño|niños|niña|niñas|bebé|bebe|infante|enfant|enfants|bébé|kind|kinder|bambino|bambini|neonato|neonati|ragazzo|ragazzi|ragazza|ragazze|儿童|孩子|学生|老年|优惠)\b|儿童|孩子|学生|老年|优惠/i;
// an age band needs an age marker — a bare numeric range ("Private Group 1-4", "Groups of 2 - 4") is a party size, not an age
const AGE_RANGE = /\b\d{1,2}\s*(-|–|to)\s*\d{1,2}\s*(yrs|rys|years|year olds|yr olds|y\/o|y\/old|yo|años|ans|anni)\b/i;
// word-number party tiers ("Two Adults", "Three People") are group-size variants — the single-person tier anchors (s47 VOLUME-LADDER closure)
const WORDNUM = '(two|three|four|five|six|seven|eight|nine|ten|twelve|\\d+)';
const GROUP = new RegExp('\\b(per group|group|groups|party|parties|private|exclusive|charter|boat|vessel|vehicle|car|van|minibus|coach|table|room|cabin|pod|lane|court|couple|couples|for two|for 2|whole|hire|rental|raft|canoe|kayak|seater|privado|privada|vehículo|vehiculo|grupo|nights?|berth|capacity|hasta \\d+|' + WORDNUM + '\\s*(people|persons|ppl|pax|guests|players|riders|passengers|adults|students|pasajeros|personas)|up to \\d+)\\b', 'i');
const BASE_WORDS = 'adult|adults|person|per person|standard|general|guest|guests|visitor|participant|passenger|rider|player|ticket|seat|single|individual|one person|1 person|per seat';
const BASE = new RegExp('\\b(' + BASE_WORDS + ')\\b', 'i');
const BASE_HEAD = new RegExp('^(' + BASE_WORDS + ')\\b', 'i');
// explicit unit wording in the note settles the unit either way
const PER_PERSON = /\b(per (person|player|participant|head|adult|guest|rider|passenger|student|pp))\b|\beach person\b|\bpp\b|\b(1|one) (person|student|player)\b(?!\s*(or|to|-|–))/i;
const NOTE_NEVER = /^\s*extras?\b|\ban (optional )?extra\b|\bprice per item\b|\badd[- ]on\b/i;
// a leading party size of 2+ ("3-4 adults", "2 - 4 Guests Rate", "5 + Guests") is a group-size variant too; "1-2 adults" is the entry tier and stays base
const VOLUME = new RegExp('^(' + WORDNUM + '\\s*(people|persons|adults|guests|players|passengers|students)|groups? of|([2-9]|\\d{2,})\\s*(-|–|to|\\+)\\s*\\d*\\s*(people|persons|adults|guests|players|passengers|students))\\b', 'i');
const NAME_GROUP = /\b(hire|rental|charter|private|boat|narrowboat|cruiser|vessel)\b/i;
function classifyTier(t, productName) {
  const sing = (t.singular || '').trim(); const note = t.note || '';
  if (!(t.priceCents > 0)) return 'zero';
  if (NEVER.test(sing) || AGE_RANGE.test(sing)) return 'never';     // never-anchor is decided by the tier NAME — notes carry age advisories for base tiers too …
  if (NOTE_NEVER.test(note)) return 'never';                          // … except explicit add-on wording in the note ("Extra – Boots (Price Per Item)", s48-weng-floorfix)
  if (VOLUME.test(sing)) return 'group';                              // "Two Adults", "Six Adults", "Three People": group-size variants rank behind the single-person tier
  if (BASE_HEAD.test(sing)) return 'base';                            // head noun decides: "Participant (Groups of 2 - 4)" is per person
  if (BASE.test(sing) && !GROUP.test(sing)) return 'base';
  if (PER_PERSON.test(note)) return 'base';                           // "Per Player", "Price per person", "20 Shots per person"
  if (GROUP.test(sing) || GROUP.test(note)) return 'group';           // "Group of 1 Player", "Price per Boat", "Accommodates 1 - 8 passengers"
  if (NAME_GROUP.test(productName || '')) return 'group';             // unnamed tier ("Two Hours", "3 Nights") on a hire/charter/private product is priced per unit, not per person
  return 'base';   // unnamed variant ("Half Day", "Two Hour Session", "20 Shots") is a per-person base tier under D-625; minPartySize never makes a tier whole-party
}

function apply() {
  const ev = JSON.parse(fs.readFileSync(`${EV}/probe.json`, 'utf8'));
  if (ev.reconcile.incomplete.length) { console.error('ABORT: probe incomplete'); process.exit(5); }
  if (ev.population !== pop.length) { console.error('ABORT: population drift since probe'); process.exit(5); }
  // date-validity instrument: at least one start_at must move across dates for some row
  const moved = Object.values(ev.perPk).some(v => new Set(v.probes.filter(p => p.start_at).map(p => p.start_at)).size > 1);
  if (!moved) { console.error('ABORT: date parameter ignored (no start_at moved)'); process.exit(6); }
  const appliedAt = new Date().toISOString();
  // priceEnrichmentAt is locked to the ruling's stamp day (2026-08-25); the wall-clock apply time is recorded in the evidence bundle.
  const ts = `${STAMP_DAY}T${appliedAt.slice(11)}`;
  const before = doc.tours.map(t => JSON.stringify(t)); const popSet = new Set(pop.map(t => t.pk));
  const summary = []; const disp = {};
  const bump = k => { disp[k] = (disp[k] || 0) + 1; };
  for (const t of pop) {
    const v = ev.perPk[t.pk]; const ok = v.probes.filter(p => !p.error); const sampled = ok.filter(p => !p.absent);
    const old = { price: t.price, label: t.priceLabel, conf: t.priceConfidence };
    const rec = { pk: t.pk, name: t.name, old: old.price, oldLabel: old.label };
    const tiersOf = p => p.tiers.map(x => ({ name: x.singular, note: x.note || '', price: u(x.priceCents), minPartySize: x.min ?? null }));
    if (sampled.length === 0) {
      t.priceConfidence = 'low'; t.priceSource = SOURCE; t.priceEnrichmentSource = 'extract-prices-v7-api'; t.priceEnrichmentAt = ts; t.priceEnrichmentStatus = ok.length ? 'unsampled' : 'probe_error';
      t.priceBasis = `UNSAMPLED: absent from price-preview items[] on ${ok.length}/${DATES.length} dated probes (${DATES.join(', ')})${ok.length < DATES.length ? `, ${DATES.length - ok.length} probe error(s)` : ''}; stored ${old.price == null ? 'null' : '£' + old.price}${old.label ? ` (${old.label})` : ''} retained unpublished pending a live reading`;
      t.priceTiers = (t.priceBreakdown || []).map(x => ({ name: x.singular, note: x.note || '', price: x.price, minPartySize: x.minPartySize ?? null }));
      Object.assign(rec, { disposition: ok.length ? 'UNSAMPLED' : 'PROBE_ERROR', new: t.price, probeErrors: v.probes.filter(p => p.error).map(p => p.error) }); bump(ok.length ? 'UNSAMPLED' : 'PROBE_ERROR'); summary.push(rec); continue;
    }
    // majority ladder across sampled readings (by non-zero tier name+price)
    const key = p => JSON.stringify(p.tiers.map(x => [x.singular, x.priceCents]));
    const counts = new Map(); for (const p of sampled) counts.set(key(p), (counts.get(key(p)) || 0) + 1);
    const majKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]; const maj = sampled.find(p => key(p) === majKey);
    const valid = sampled.filter(p => p.dateValid).length;
    const evid = `${sampled.length}/${DATES.length} dated readings (${valid} date-valid), ${counts.size} ladder shape(s)`;
    const cur = maj.liveCurrency; const L = tiersOf(maj);
    // refresh v7-shaped provenance from the live majority reading
    t.priceBreakdown = maj.tiers.map(c => ({ id: c.id, singular: c.singular, plural: c.plural, note: c.note, priceCents: c.priceCents, price: u(c.priceCents), minPartySize: c.min }));
    t.priceIncludesBookingFees = maj.includeFees; t.priceIncludesTaxes = maj.includeTaxes;
    t.priceEnrichmentSource = 'extract-prices-v7-api'; t.priceEnrichmentAt = ts; t.priceSource = SOURCE; t.priceTiers = L;
    const classes = maj.tiers.map(x => ({ x, cls: classifyTier(x, t.name) }));
    rec.tiers = classes.map(c => ({ singular: c.x.singular, note: c.x.note || '', price: u(c.x.priceCents), min: c.x.min, cls: c.cls }));
    const base = classes.filter(c => c.cls === 'base').map(c => c.x); const group = classes.filter(c => c.cls === 'group').map(c => c.x);
    const anyNz = maj.tiers.some(x => x.priceCents > 0);
    if (!anyNz) {
      t.price = null; t.priceLabel = null; t.priceConfidence = 'low'; t.priceEnrichmentStatus = 'zero_price';
      t.priceBasis = `zero_price: every live tier is £0 on the majority reading (${L.map(x => x.name).join(' / ')}); ${evid}; live ${cur}`;
      Object.assign(rec, { disposition: 'zero_price', new: null }); bump('zero_price');
    } else if (cur !== 'GBP') {
      const anchor = (base.length ? base : maj.tiers.filter(x => x.priceCents > 0)).reduce((a, b) => b.priceCents < a.priceCents ? b : a);
      t.currency = cur; t.price = u(anchor.priceCents); t.priceLabel = anchor.singular; t.priceConfidence = 'low'; t.priceEnrichmentStatus = `non_gbp_currency:${cur}`;
      t.priceBasis = `HELD (D-620): live details.currency ${cur} ≠ site GBP; true amount ${cur} ${t.price} (${anchor.singular}) stamped, unpublished; ${evid}`;
      Object.assign(rec, { disposition: 'D-620', new: t.price, currency: cur }); bump('D-620');
    } else if (base.length) {
      const anchor = base.reduce((a, b) => b.priceCents < a.priceCents ? b : a);
      t.currency = 'GBP'; t.price = u(anchor.priceCents); t.priceLabel = anchor.singular; t.priceConfidence = 'high'; t.priceEnrichmentStatus = 'high';
      const skipped = classes.filter(c => c.cls !== 'base' && c.x.priceCents > 0).map(c => `${c.x.singular} £${u(c.x.priceCents)} [${c.cls}]`);
      t.priceBasis = `D-624 cheapest adult/base per-person tier ${anchor.singular} £${t.price}${base.length > 1 ? ` of ${base.length} base tiers (D-625)` : ''}${skipped.length ? `; not anchoring: ${skipped.join(', ')}` : ''}; ${evid}; live GBP`;
      const changed = old.price !== t.price;
      Object.assign(rec, { disposition: changed ? 'repriced' : 'unchanged', new: t.price, label: anchor.singular }); bump(changed ? 'repriced' : 'unchanged');
    } else {
      // whole-party-only (or never-anchor-only) ladder → HELD low (D-621; no priceUnit render path)
      const nz = maj.tiers.filter(x => x.priceCents > 0);
      // stored floor never comes from an add-on/child/kit (never-branch) tier — min over group/base tiers, all non-zero only as a fallback
      const gb = classes.filter(c => (c.cls === 'group' || c.cls === 'base') && c.x.priceCents > 0).map(c => c.x);
      const floor = (gb.length ? gb : nz).reduce((a, b) => b.priceCents < a.priceCents ? b : a);
      t.currency = 'GBP'; t.priceConfidence = 'low'; t.priceEnrichmentStatus = 'high';
      t.price = u(floor.priceCents); t.priceLabel = floor.singular;
      t.priceBasis = `HELD (${group.length ? 'D-621 whole-party' : 'no adult/base tier'}): live ladder ${nz.map(x => `${x.singular} £${u(x.priceCents)}`).join(' / ')} has no standalone adult/base per-person tier; floor £${t.price} (${floor.singular}) stamped unpublished pending priceUnit port; ${evid}; live GBP`;
      Object.assign(rec, { disposition: 'HELD', new: t.price, label: floor.singular }); bump('HELD');
    }
    summary.push(rec);
  }
  const after = doc.tours.map(t => JSON.stringify(t));
  const changedIdx = after.map((s, i) => s !== before[i] ? i : -1).filter(i => i >= 0);
  const outside = changedIdx.filter(i => !popSet.has(doc.tours[i].pk));
  if (outside.length || doc.tours.length !== before.length) { console.error('ABORT: rows outside population changed', outside.length); process.exit(4); }
  const untouchedInPop = pop.length - changedIdx.length;   // every population row gets a fresh stamp, so this must be 0
  const result = { stampedAt: ts, appliedAt, population: pop.length, rowsChanged: changedIdx.length, untouchedInPop, disposition: disp, summary };
  if (!DRY) { fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n'); fs.writeFileSync(`${EV}/apply-summary.json`, JSON.stringify(result, null, 1) + '\n'); }
  else if (process.env.DRY_OUT) fs.writeFileSync(process.env.DRY_OUT, JSON.stringify(result, null, 1) + '\n');
  console.log(JSON.stringify({ stampedAt: ts, population: pop.length, rowsChanged: changedIdx.length, untouchedInPop, disposition: disp, dry: DRY }));
}
if (mode === 'probe') probe(); else if (mode === 'apply') apply(); else { console.error('usage: probe|apply'); process.exit(1); }
