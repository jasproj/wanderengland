#!/usr/bin/env node
// s54-weng-reprice-29: live reprice for the 29 hardcoded-linked-but-priceConfidence:low
//   pks found by the s54 link-concentration census (scripts/evidence/s53-weng-schema-gate/
//   was the schema-gate census; this is the follow-up link census, not committed as a
//   script — the pk list came from that census's output). Fixed, explicit population
//   (not derived from a query at run time) — see POP below.
//
//   Liveness check + classifyTier/anchor logic are a verbatim port of
//   scripts/s51-weng-tiers-backfill.mjs (itself ported from s48-weng-refresh-a.mjs,
//   D-613/D-624/D-625/D-620/D-621 lineage). One addition: a v1 item-detail liveness
//   check (is_archived / is_unlisted / HTTP 404) runs BEFORE the price-preview probe,
//   because "every tier reads £0 on the dates I sampled" is not the same claim as "this
//   listing is gone" — off-season products legitimately show £0 for dates with no
//   configured availability, and marking those bookingDead would remove a live, bookable
//   tour from the site on a false signal. bookingDead is reserved for the structural
//   FareHarbor signal (archived/unlisted/removed), not for a zero/absent price reading.
//   usage: node scripts/s54-weng-reprice-29.mjs probe|apply [--dry-run]
import fs from 'node:fs';
const FILE = 'tours-data.json';
const EV = 'scripts/evidence/s54-weng-reprice-29';
const SOURCE = 's54-weng-reprice-29';
const STAMP_DAY = '2026-08-28';
const DATES = ['2026-09-04', '2026-09-18', '2026-10-02', '2026-10-23'];
const BATCH = 20, RATE_MS = 1000, TIMEOUT_MS = 25000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const mode = process.argv[2]; const DRY = process.argv.includes('--dry-run');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const u = c => Number((c / 100).toFixed(2));

// Fixed population: the 29 pks the s54 link census found hardcoded into static HTML
// pages with priceConfidence:low in tours-data.json.
const POP_PKS = [
  67508, 67510, 83691, 83692, 214981, 252106, 252118, 283390, 295340, 315741,
  346084, 351641, 351692, 351721, 352851, 354861, 363641, 455065, 488756,
  526850, 527007, 531733, 609776, 609778, 609779, 609788, 609789, 609804, 660913
];

function parseFhUrl(bookingUrl) {   // identical to v7 / s48-weng-refresh-a / s51
  if (!bookingUrl || !bookingUrl.includes('fareharbor.com')) return null;
  const m = bookingUrl.match(/fareharbor\.com\/(?:embeds\/book\/)?([^/]+)\/items\/(\d+)/);
  if (!m) return null; const [, shortname, pk] = m;
  if (shortname === 'embeds' || shortname === 'items') return null;
  return { shortname, pk: Number(pk) };
}
const raw = fs.readFileSync(FILE, 'utf8'); const doc = JSON.parse(raw);
if (JSON.stringify(doc, null, 2) + '\n' !== raw) { console.error('ABORT: no byte round-trip (D-599)'); process.exit(2); }

const popSet = new Set(POP_PKS);
const pop = doc.tours.filter(t => popSet.has(t.pk));
if (pop.length !== POP_PKS.length) { console.error(`ABORT: population mismatch, found ${pop.length}/${POP_PKS.length} pks in tours-data.json`); process.exit(2); }
for (const t of pop) {
  if (t.priceConfidence !== 'low') { console.error(`ABORT: pk ${t.pk} is not priceConfidence:low (population drifted since the s54 census)`); process.exit(2); }
  const p = parseFhUrl(t.bookingUrl); if (!p || p.pk !== t.pk) { console.error('ABORT: bookingUrl pk mismatch', t.pk); process.exit(2); }
}
console.error(`population (fixed s54 list) = ${pop.length}`);

async function get(url, ms) {
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ac.signal });
    return { status: r.status, j: r.status === 200 ? await r.json() : null }; }
  catch (e) { return { err: String(e.name === 'AbortError' ? 'timeout' : e.message) }; } finally { clearTimeout(tm); }
}
const itemUrl = (sn, pk) => `https://fareharbor.com/api/v1/companies/${sn}/items/${pk}/`;
const batchUrl = (sn, pks, date) => `https://fareharbor.com/api/embed/${sn}/price-preview/per-item/v2/?item_pks=${pks.join(',')}&include_breakdown=yes&date=${date}`;

async function probe() {
  const out = { startedAt: new Date().toISOString(), dates: DATES, population: pop.length, requests: 0, retries: [], perPk: {} };

  // Step 1: liveness — v1 item detail, one request per pk. This is the ONLY signal
  // this script trusts for bookingDead (see file header).
  for (const t of pop) {
    const { shortname } = parseFhUrl(t.bookingUrl);
    out.requests++;
    const x = await get(itemUrl(shortname, t.pk), TIMEOUT_MS); await sleep(RATE_MS);
    out.perPk[t.pk] = {
      shortname,
      liveness: x.err ? { err: x.err } : { status: x.status, isArchived: x.j?.item?.is_archived ?? null, isUnlisted: x.j?.item?.is_unlisted ?? null, name: x.j?.item?.name ?? null },
      probes: []
    };
    fs.writeFileSync(`${EV}/probe.json`, JSON.stringify(out));
  }

  // Step 2: price-preview, batched by shortname, same as s51.
  const bySn = new Map();
  for (const t of pop) { const { shortname } = parseFhUrl(t.bookingUrl); if (!bySn.has(shortname)) bySn.set(shortname, []); bySn.get(shortname).push(t.pk); }
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
      const it = items.get(pk); const p = { date, error: x.status && x.status !== 200 ? 'HTTP ' + x.status : (x.err || null) };
      if (!p.error) { p.absent = !it; p.liveCurrency = x.j.details?.currency ?? null; p.includeFees = x.j.details?.prices_include_booking_fees ?? null; p.includeTaxes = x.j.details?.prices_include_taxes ?? null; }
      if (it) { const sa = it.availability?.start_at || null; p.start_at = sa; p.dateValid = !!sa && sa.slice(0, 10) === date;
        const cts = Array.isArray(it.price?.breakdown?.customer_types) ? it.price.breakdown.customer_types : [];
        p.tiers = cts.map(c => ({ id: c.id, singular: c.singular, plural: c.plural, note: c.note, priceCents: c.price, min: c.min_party_size }));
        p.low = it.price?.low ?? null; p.zeroOnly = !cts.some(c => c.price > 0); }
      out.perPk[pk].probes.push(p);
    }
  }
  for (const [sn, pks] of bySn) {
    for (let i = 0; i < pks.length; i += BATCH) for (const date of DATES) await run(sn, pks.slice(i, i + BATCH), date, 0);
    fs.writeFileSync(`${EV}/probe.json`, JSON.stringify(out));
  }
  out.finishedAt = new Date().toISOString();
  const bad = Object.entries(out.perPk).filter(([, v]) => v.probes.length !== DATES.length);
  out.reconcile = { population: pop.length, pksWithFullProbeSet: pop.length - bad.length, incomplete: bad.map(([k]) => k) };
  fs.writeFileSync(`${EV}/probe.json`, JSON.stringify(out));
  console.log(JSON.stringify({ requests: out.requests, retries: out.retries.length, reconcile: out.reconcile }));
}

// ---- tier classification: verbatim port of scripts/s48-weng-refresh-a.mjs / s51-weng-tiers-backfill.mjs classifyTier (D-624/D-625/D-621) ----
const NEVER = /\b(child|childs|child's|children|childrens|children's|kid|kids|kid's|infant|infants|baby|babies|toddler|junior|juniors|youth|youths|teen|teenager|teens|adolescent|adolescents|young adult|student|students|senior|seniors|oap|concession|concessions|pensioner|disabled|wheelchair|carer|companion|blue light|nhs|discount|under\s*\d+s?|\d+\s*(and|&)\s*under|family|families|bundle|package|add[- ]?on|extra|extras|additional|supplement|upgrade|gratuity|tip|tips|donation|deposit|voucher|gift card|redemption|per additional|spectator|non[- ]?participant|dog|dogs|pet|pets|kit|merchandise|parking|niño|niños|niña|niñas|nino|ninos|nina|ninas|bebé|bebe|infante|enfant|enfants|bébé|kind|kinder|kinderen|bambino|bambini|bambina|bambine|neonato|neonati|ragazzo|ragazzi|ragazza|ragazze|joven|jóvenes|jovenes|anciano|anciana|jeune|jeunes|aine|ainee|crianca|criancas|criança|crianças|kamaaina|plaatselijk|inwoner|inwoners|residente|residentes|anwohner|einheimisch|儿童|孩子|学生|老年|优惠)\b|儿童|孩子|学生|老年|优惠/i;
const AGE_RANGE = /\b\d{1,2}\s*(-|–|to)\s*\d{1,2}\s*(yrs|rys|years|year olds|yr olds|y\/o|y\/old|yo|años|ans|anni)\b/i;
const WORDNUM = '(two|three|four|five|six|seven|eight|nine|ten|twelve|\\d+)';
const GROUP = new RegExp('\\b(per group|group|groups|party|parties|private|exclusive|charter|boat|vessel|vehicle|car|van|minibus|coach|table|room|cabin|pod|lane|court|couple|couples|for two|for 2|whole|hire|rental|raft|canoe|kayak|seater|privado|privada|vehículo|vehiculo|grupo|nights?|berth|capacity|hasta \\d+|' + WORDNUM + '\\s*(people|persons|ppl|pax|guests|players|riders|passengers|adults|students|pasajeros|personas)|up to \\d+)\\b', 'i');
const BASE_WORDS = 'adult|adults|person|per person|standard|general|guest|guests|visitor|participant|passenger|rider|player|ticket|seat|single|individual|one person|1 person|per seat';
const BASE = new RegExp('\\b(' + BASE_WORDS + ')\\b', 'i');
const BASE_HEAD = new RegExp('^(' + BASE_WORDS + ')\\b', 'i');
const PER_PERSON = /\b(per (person|player|participant|head|adult|guest|rider|passenger|student|pp))\b|\beach person\b|\bpp\b|\b(1|one) (person|student|player)\b(?!\s*(or|to|-|–))/i;
const NOTE_NEVER = /^\s*extras?\b|\ban (optional )?extra\b|\bprice per item\b|\badd[- ]on\b/i;
const NAME_ADDON = /^add\s+\w/i;
const VOLUME = new RegExp('^(' + WORDNUM + '\\s*(people|persons|adults|guests|players|passengers|students)|groups? of|([2-9]|\\d{2,})\\s*(-|–|to|\\+)\\s*\\d*\\s*(people|persons|adults|guests|players|passengers|students))\\b', 'i');
const NAME_GROUP = /\b(hire|rental|charter|private|boat|narrowboat|cruiser|vessel)\b/i;
function classifyTier(t, productName) {
  const sing = (t.singular || '').trim(); const note = t.note || '';
  if (!(t.priceCents > 0)) return 'zero';
  if (NEVER.test(sing) || AGE_RANGE.test(sing) || NAME_ADDON.test(sing)) return 'never';
  if (NOTE_NEVER.test(note)) return 'never';
  if (VOLUME.test(sing)) return 'group';
  if (BASE_HEAD.test(sing)) return 'base';
  if (BASE.test(sing) && !GROUP.test(sing)) return 'base';
  if (PER_PERSON.test(note)) return 'base';
  if (GROUP.test(sing) || GROUP.test(note)) return 'group';
  if (NAME_GROUP.test(productName || '')) return 'group';
  return 'base';
}

function apply() {
  const ev = JSON.parse(fs.readFileSync(`${EV}/probe.json`, 'utf8'));
  if (ev.reconcile.incomplete.length) { console.error('ABORT: probe incomplete'); process.exit(5); }
  if (ev.population !== pop.length) { console.error('ABORT: population drift since probe'); process.exit(5); }
  const moved = Object.values(ev.perPk).some(v => new Set(v.probes.filter(p => p.start_at).map(p => p.start_at)).size > 1);
  if (!moved) { console.error('ABORT: date parameter ignored (no start_at moved)'); process.exit(6); }
  const appliedAt = new Date().toISOString();
  const ts = `${STAMP_DAY}T${appliedAt.slice(11)}`;
  const before = doc.tours.map(t => JSON.stringify(t));
  const summary = []; const disp = {};
  const bump = k => { disp[k] = (disp[k] || 0) + 1; };

  for (const t of pop) {
    const v = ev.perPk[t.pk];
    const old = { price: t.price, label: t.priceLabel, conf: t.priceConfidence, currency: t.currency };
    const rec = { pk: t.pk, name: t.name, old: old.price, oldCurrency: old.currency, oldLabel: old.label };

    // Dead check FIRST: only the v1 structural signal decides bookingDead (see header).
    const dead = v.liveness.status === 404 || v.liveness.isArchived === true || v.liveness.isUnlisted === true;
    if (dead) {
      t.bookingDead = true;
      t.priceEnrichmentAt = ts; t.priceSource = SOURCE; t.priceEnrichmentStatus = 'dead';
      t.priceBasis = `s54-weng-reprice-29: bookingDead — v1 item detail ${v.liveness.status === 404 ? 'HTTP 404' : v.liveness.isArchived ? 'is_archived=true' : 'is_unlisted=true'} at ${itemUrl(v.shortname, t.pk)}; stored £${old.price ?? 'null'}${old.label ? ` (${old.label})` : ''} retained for record, not published (bookingDead)`;
      Object.assign(rec, { disposition: 'DEAD', new: 'dead' }); bump('DEAD'); summary.push(rec); continue;
    }

    const ok = v.probes.filter(p => !p.error); const sampled = ok.filter(p => !p.absent);
    const tiersOf = p => p.tiers.map(x => ({ name: x.singular, note: x.note || '', price: u(x.priceCents), minPartySize: x.min ?? null }));
    if (sampled.length === 0) {
      t.priceConfidence = 'low'; t.priceSource = SOURCE; t.priceEnrichmentAt = ts; t.priceEnrichmentStatus = ok.length ? 'unsampled' : 'probe_error';
      t.priceBasis = `s54-weng-reprice-29: UNSAMPLED (not DEAD — v1 item detail is live, not archived/unlisted): absent from price-preview items[] on ${ok.length}/${DATES.length} dated probes (${DATES.join(', ')})${ok.length < DATES.length ? `, ${DATES.length - ok.length} probe error(s)` : ''}; stored ${old.price == null ? 'null' : '£' + old.price}${old.label ? ` (${old.label})` : ''} retained unpublished pending a live reading`;
      Object.assign(rec, { disposition: ok.length ? 'UNSAMPLED' : 'PROBE_ERROR', new: t.price, probeErrors: v.probes.filter(p => p.error).map(p => p.error) }); bump(ok.length ? 'UNSAMPLED' : 'PROBE_ERROR'); summary.push(rec); continue;
    }
    const key = p => JSON.stringify(p.tiers.map(x => [x.singular, x.priceCents]));
    const counts = new Map(); for (const p of sampled) counts.set(key(p), (counts.get(key(p)) || 0) + 1);
    const majKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]; const maj = sampled.find(p => key(p) === majKey);
    const valid = sampled.filter(p => p.dateValid).length;
    const evid = `${sampled.length}/${DATES.length} dated readings (${valid} date-valid), ${counts.size} ladder shape(s)`;
    const cur = maj.liveCurrency; const L = tiersOf(maj);
    t.priceBreakdown = maj.tiers.map(c => ({ id: c.id, singular: c.singular, plural: c.plural, note: c.note, priceCents: c.priceCents, price: u(c.priceCents), minPartySize: c.min }));
    t.priceIncludesBookingFees = maj.includeFees; t.priceIncludesTaxes = maj.includeTaxes;
    t.priceEnrichmentAt = ts; t.priceSource = SOURCE; t.priceTiers = L;
    const classes = maj.tiers.map(x => ({ x, cls: classifyTier(x, t.name) }));
    rec.tiers = classes.map(c => ({ singular: c.x.singular, note: c.x.note || '', price: u(c.x.priceCents), min: c.x.min, cls: c.cls }));
    const base = classes.filter(c => c.cls === 'base').map(c => c.x); const group = classes.filter(c => c.cls === 'group').map(c => c.x);
    const anyNz = maj.tiers.some(x => x.priceCents > 0);
    if (!anyNz) {
      t.price = null; t.priceLabel = null; t.priceConfidence = 'low'; t.priceEnrichmentStatus = 'zero_price';
      t.priceBasis = `s54-weng-reprice-29: zero_price (not DEAD — v1 item detail is live): every live tier is £0 on the majority reading (${L.map(x => x.name).join(' / ')}); ${evid}; live ${cur}`;
      Object.assign(rec, { disposition: 'zero_price', new: null }); bump('zero_price');
    } else if (cur !== 'GBP') {
      const anchor = (base.length ? base : maj.tiers.filter(x => x.priceCents > 0)).reduce((a, b) => b.priceCents < a.priceCents ? b : a);
      t.currency = cur; t.price = u(anchor.priceCents); t.priceLabel = anchor.singular; t.priceConfidence = 'low'; t.priceEnrichmentStatus = `non_gbp_currency:${cur}`;
      t.priceBasis = `s54-weng-reprice-29: HELD (D-620): live details.currency ${cur} ≠ site GBP; true amount ${cur} ${t.price} (${anchor.singular}) stamped, unpublished; ${evid}`;
      Object.assign(rec, { disposition: 'D-620', new: t.price, label: anchor.singular, currency: cur }); bump('D-620');
    } else if (base.length) {
      const anchor = base.reduce((a, b) => b.priceCents < a.priceCents ? b : a);
      t.currency = 'GBP'; t.price = u(anchor.priceCents); t.priceLabel = anchor.singular; t.priceConfidence = 'high'; t.priceEnrichmentStatus = 'high';
      const skipped = classes.filter(c => c.cls !== 'base' && c.x.priceCents > 0).map(c => `${c.x.singular} £${u(c.x.priceCents)} [${c.cls}]`);
      t.priceBasis = `s54-weng-reprice-29: D-624 cheapest adult/base per-person tier ${anchor.singular} £${t.price}${base.length > 1 ? ` of ${base.length} base tiers (D-625)` : ''}${skipped.length ? `; not anchoring: ${skipped.join(', ')}` : ''}; ${evid}; live GBP`;
      const changed = old.price !== t.price;
      Object.assign(rec, { disposition: changed ? 'repriced' : 'unchanged-high', new: t.price, label: anchor.singular }); bump(changed ? 'repriced' : 'unchanged-high');
    } else {
      const nz = maj.tiers.filter(x => x.priceCents > 0);
      const gb = classes.filter(c => (c.cls === 'group' || c.cls === 'base') && c.x.priceCents > 0).map(c => c.x);
      const floor = (gb.length ? gb : nz).reduce((a, b) => b.priceCents < a.priceCents ? b : a);
      t.currency = 'GBP'; t.priceConfidence = 'low'; t.priceEnrichmentStatus = 'high';
      t.price = u(floor.priceCents); t.priceLabel = floor.singular;
      t.priceBasis = `s54-weng-reprice-29: HELD (${group.length ? 'D-621 whole-party' : 'no adult/base tier'}): live ladder ${nz.map(x => `${x.singular} £${u(x.priceCents)}`).join(' / ')} has no standalone adult/base per-person tier; floor £${t.price} (${floor.singular}) stamped unpublished; ${evid}; live GBP`;
      Object.assign(rec, { disposition: 'HELD', new: t.price, label: floor.singular }); bump('HELD');
    }
    summary.push(rec);
  }

  const after = doc.tours.map(t => JSON.stringify(t));
  const changedIdx = after.map((s, i) => s !== before[i] ? i : -1).filter(i => i >= 0);
  const outside = changedIdx.filter(i => !popSet.has(doc.tours[i].pk));
  if (outside.length || doc.tours.length !== before.length) { console.error('ABORT: rows outside population changed', outside.length); process.exit(4); }
  const result = { stampedAt: ts, appliedAt, population: pop.length, rowsChanged: changedIdx.length, disposition: disp, summary };
  if (!DRY) { fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n'); fs.writeFileSync(`${EV}/apply-summary.json`, JSON.stringify(result, null, 1) + '\n'); }
  else if (process.env.DRY_OUT) fs.writeFileSync(process.env.DRY_OUT, JSON.stringify(result, null, 1) + '\n');
  console.log(JSON.stringify({ stampedAt: ts, population: pop.length, rowsChanged: changedIdx.length, disposition: disp, dry: DRY }));
}
if (mode === 'probe') probe(); else if (mode === 'apply') apply(); else { console.error('usage: probe|apply'); process.exit(1); }
