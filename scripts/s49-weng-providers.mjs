#!/usr/bin/env node
// s49-weng-providers: write the provider display name (`company` — the field app.js reads for the
//   JSON-LD provider.name and the search filter) for rows whose company is absent or a bare
//   shortname, from the FareHarbor companies endpoint (/api/v1/companies/{sn}/ → company.name,
//   canonical instrument; scripts/evidence/s49-weng-providers/companies.json, resolver resolve.py).
//   Only RESOLVED shortnames are written; UNRESOLVED (404) rows are untouched. Shortname parsed
//   positionally from bookingUrl (underscores allowed, never digit-grep). Stamp: providerSource
//   s49-weng-companies-endpoint + providerResolvedAt. Rows outside the population byte-identical.
//   usage: node scripts/s49-weng-providers.mjs [--dry-run]
import fs from 'node:fs';
const FILE = 'tours-data.json', EV = 'scripts/evidence/s49-weng-providers', DAY = '2026-08-25';
const DRY = process.argv.includes('--dry-run');
const raw = fs.readFileSync(FILE, 'utf8'); const doc = JSON.parse(raw);
if (JSON.stringify(doc, null, 2) + '\n' !== raw) { console.error('ABORT: no byte round-trip (D-599)'); process.exit(2); }
const companies = JSON.parse(fs.readFileSync(`${EV}/companies.json`, 'utf8'));
const parse = u => { const m = /^https?:\/\/(?:www\.)?fareharbor\.com\/(?:embeds\/book\/)?([^/?#]+)\/items\/(\d+)/.exec(u || ''); return m ? m[1] : null; };
const pop = doc.tours.filter(t => parse(t.bookingUrl) && (!t.company || t.company.trim().toLowerCase() === parse(t.bookingUrl).toLowerCase()));
const sns = new Set(pop.map(t => parse(t.bookingUrl)));
if (pop.length !== companies.populationRows || sns.size !== companies.attempted) { console.error('ABORT: population drift', pop.length, sns.size); process.exit(5); }
for (const sn of sns) if (!companies.perShortname[sn]) { console.error('ABORT: shortname not in resolver output', sn); process.exit(5); }
const before = doc.tours.map(t => JSON.stringify(t)); const popSet = new Set(pop.map(t => t.pk));
let written = 0, untouched = [], sameValue = 0;
for (const t of pop) {
  const sn = parse(t.bookingUrl); const c = companies.perShortname[sn];
  if (!c.resolved) { untouched.push({ pk: t.pk, sn, status: c.status }); continue; }
  if (t.company && t.company === c.name) sameValue++;
  t.company = c.name; t.providerSource = 's49-weng-companies-endpoint'; t.providerResolvedAt = DAY; written++;
}
const after = doc.tours.map(t => JSON.stringify(t));
const changed = after.map((s, i) => s !== before[i] ? i : -1).filter(i => i >= 0);
const outside = changed.filter(i => !popSet.has(doc.tours[i].pk)); if (outside.length || doc.tours.length !== before.length) { console.error('ABORT: rows outside population changed', outside.length); process.exit(4); }
const result = { stampedAt: DAY, population: pop.length, shortnames: sns.size, resolvedShortnames: companies.reconcile.resolved, written, sameValueRewrites: sameValue, untouched, rowsChanged: changed.length };
if (!DRY) { fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n'); fs.writeFileSync(`${EV}/apply-summary.json`, JSON.stringify(result, null, 1) + '\n'); }
console.log(JSON.stringify({ dry: DRY, ...result }));
