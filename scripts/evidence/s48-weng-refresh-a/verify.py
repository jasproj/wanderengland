# s48-weng-refresh-a verify: sha256 in Python only; render before/after; byte round-trip on unchanged rows.
import json,hashlib,subprocess,sys
EV='scripts/evidence/s48-weng-refresh-a'
sha=lambda p:hashlib.sha256(open(p,'rb').read()).hexdigest()
base=subprocess.run(['git','show','origin/main:tours-data.json'],capture_output=True).stdout
before=json.loads(base)['tours']; after=json.load(open('tours-data.json'))['tours']
summ=json.load(open(EV+'/apply-summary.json')); pop={r['pk'] for r in summ['summary']}
assert len(before)==len(after)
out_of_pop_diff=[a['pk'] for b,a in zip(before,after) if a['pk'] not in pop and json.dumps(b,sort_keys=True)!=json.dumps(a,sort_keys=True)]
raw=open('tours-data.json').read(); rt=json.dumps(json.load(open('tours-data.json')),indent=2,ensure_ascii=False)+'\n'
subprocess.run(['node',EV+'/render-harness.mjs','app.js','tours-data.json',EV+'/render-after.json'],check=True,capture_output=True)
rb=json.load(open(EV+'/render-before.json')); ra=json.load(open(EV+'/render-after.json'))
vis=lambda r:(r['priceText'] or '').startswith('From ')
va=[k for k,r in ra.items() if vis(r)]; oa=[k for k,r in ra.items() if r['schema'].get('offers')]
supp=[k for k,r in ra.items() if int(k) in pop and r['confidence']=='low']
bad_supp=[k for k in supp if ra[k]['priceText']!='Price on request' or ra[k]['schema'].get('offers')]
nonpop_render_diff=[k for k in ra if int(k) not in pop and (ra[k]['html']!=rb[k]['html'] or ra[k]['schema']!=rb[k]['schema'])]
res={'sha256_before_originmain':hashlib.sha256(base).hexdigest(),'sha256_after':sha('tours-data.json'),
 'rows':len(after),'population':len(pop),'outOfPopulationRowsChanged':len(out_of_pop_diff),
 'byteRoundTrip':(rt==raw) or (json.dumps(json.load(open('tours-data.json')),indent=2)+'\n'==raw),
 'before':{'visible':sum(1 for r in rb.values() if vis(r)),'offers':sum(1 for r in rb.values() if r['schema'].get('offers'))},
 'after':{'visible':len(va),'offers':len(oa),'visibleEqualsOffers':len(va)==len(oa),'mismatchPks':[k for k in ra if vis(ra[k])!=bool(ra[k]['schema'].get('offers'))]},
 'popSuppressed':len(supp),'suppressedRenderViolations':bad_supp,'nonPopulationRenderDiff':len(nonpop_render_diff),
 'popVisibleBefore':sum(1 for k in rb if int(k) in pop and vis(rb[k])),'popVisibleAfter':sum(1 for k in ra if int(k) in pop and vis(ra[k])),
 'disposition':summ['disposition'],'stampedAt':summ['stampedAt'],'appliedAt':summ.get('appliedAt')}
json.dump(res,open(EV+'/verify.json','w'),indent=1); print(json.dumps(res,indent=1))
ok=res['outOfPopulationRowsChanged']==0 and res['byteRoundTrip'] and res['after']['visibleEqualsOffers'] and not bad_supp and res['nonPopulationRenderDiff']==0
print('VERIFY',('PASS' if ok else 'FAIL')); sys.exit(0 if ok else 1)
