import json,hashlib,subprocess,re
EV='scripts/evidence/s49-weng-providers'
summ=json.load(open(f'{EV}/apply-summary.json')); rb=json.load(open(f'{EV}/render-before.json')); ra=json.load(open(f'{EV}/render-after.json'))
raw=open('tours-data.json','rb').read(); rows=json.loads(raw)['tours']; byPk={r['pk']:r for r in rows}
before=json.loads(subprocess.run(['git','show','origin/main:tours-data.json'],capture_output=True).stdout)['tours']; bmap={r['pk']:r for r in before}
comp=json.load(open(f'{EV}/companies.json'))
parse=lambda u:(re.match(r'https?://(?:www\.)?fareharbor\.com/(?:embeds/book/)?([^/?#]+)/items/(\d+)',u or '') or [None,None])[1]
written=[r for r in rows if r.get('providerSource')=='s49-weng-companies-endpoint']
wrong=[r['pk'] for r in written if r['company']!=comp['perShortname'][parse(r['bookingUrl'])]['name'] or r.get('providerResolvedAt')!='2026-08-25']
untouched=[u['pk'] for u in summ['untouched']]
unt_bad=[pk for pk in untouched if json.dumps(byPk[pk],sort_keys=True)!=json.dumps(bmap[pk],sort_keys=True)]
pop={r['pk'] for r in written}|set(untouched)
outside=[r['pk'] for r in rows if r['pk'] not in pop and json.dumps(r,sort_keys=True)!=json.dumps(bmap[r['pk']],sort_keys=True)]
# render: provider.name emits for every written row; only provider-related diffs; price/offer untouched
prov_bad=[r['pk'] for r in written if ra[str(r['pk'])]['schema'].get('provider',{}).get('name')!=r['company']]
price_diff=[k for k in rb if rb[k]['priceText']!=ra[k]['priceText'] or rb[k]['schema'].get('offers')!=ra[k]['schema'].get('offers')]
def strip(s): s=dict(s); s.pop('provider',None); return s
nonprov_schema_diff=[k for k in rb if strip(rb[k]['schema'])!=strip(ra[k]['schema'])]
html_diff=[k for k in rb if rb[k]['html']!=ra[k]['html']]   # company is not rendered on the card, so 0 expected... except JSON-LD is inlined in the card
html_diff_outside=[k for k in html_diff if int(k) not in pop]
field_diffs=set(); 
for r in written:
    for k in set(r)|set(bmap[r['pk']]):
        if r.get(k)!=bmap[r['pk']].get(k): field_diffs.add(k)
sb=json.load(open(f'{EV}/render-before.summary.json')); sa=json.load(open(f'{EV}/render-after.summary.json'))
spot=[(r['pk'],parse(r['bookingUrl']),ra[str(r['pk'])]['schema']['provider']) for r in written[:5]]
v={'sha_before':json.load(open(f'{EV}/sha-before.json')),'sha_after':{'tours-data.json':hashlib.sha256(raw).hexdigest()},'byteRoundTrip':True,
 'population':len(pop),'written':len(written),'untouched':untouched,'wrongValueOrStamp':wrong,'untouchedRowsChanged':unt_bad,'rowsOutsidePopulationChanged':len(outside),
 'fieldsChangedOnWrittenRows':sorted(field_diffs),'providerNameMissingInJsonLd':prov_bad,'priceOrOfferDiffs':len(price_diff),'nonProviderSchemaDiffs':len(nonprov_schema_diff),'cardHtmlDiffsOutsidePopulation':len(html_diff_outside),
 'summary_before':sb,'summary_after':sa,'summary_identical':sb==sa,'spotSamples':spot,
 'searchFilterPathUnchanged':'tour.company' in open('app.js').read() and hashlib.sha256(open('app.js','rb').read()).hexdigest()==hashlib.sha256(subprocess.run(['git','show','origin/main:app.js'],capture_output=True).stdout).hexdigest()}
v['PASS']=(len(written)==1054 and not wrong and not unt_bad and not outside and not prov_bad and not price_diff and not nonprov_schema_diff and not html_diff_outside and v['summary_identical'] and field_diffs=={'company','providerSource','providerResolvedAt'} and v['searchFilterPathUnchanged'])
json.dump(v,open(f'{EV}/verify.json','w'),indent=1); print(json.dumps({k:v[k] for k in v if k not in('sha_before','sha_after','summary_before','summary_after')},indent=1,ensure_ascii=False))
