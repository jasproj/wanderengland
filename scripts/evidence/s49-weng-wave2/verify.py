import json,hashlib,subprocess
EV='scripts/evidence/s49-weng-wave2'
esc=lambda s: s.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;').replace('"','&quot;').replace("'",'&#39;')
summ=json.load(open(f'{EV}/apply-summary.json')); rb=json.load(open(f'{EV}/render-before.json')); ra=json.load(open(f'{EV}/render-after.json'))
rows=json.load(open('tours-data.json'))['tours']; byPk={r['pk']:r for r in rows}
before=json.loads(subprocess.run(['git','show','origin/main:tours-data.json'],capture_output=True).stdout)['tours']; bmap={r['pk']:r for r in before}
rel={r['pk']:r for r in summ['releases']}; newheld={h['pk'] for h in summ['holds']}; pop=set(rel)|newheld
priorheld={h['pk'] for h in json.load(open('scripts/evidence/s49-weng-release/apply-summary.json'))['holds']}
bad=[pk for pk,r in rel.items() if not (ra[str(pk)]['priceText']==f"From £{r['price']:g}" and f"<small>{esc(r['unit'])}</small>" in ra[str(pk)]['html'] and ra[str(pk)]['schema'].get('offers',{}).get('priceCurrency')=='GBP' and str(ra[str(pk)]['schema']['offers']['price'])==str(r['price']) and byPk[pk]['priceConfidence']=='high' and byPk[pk]['priceSource']=='s49-weng-wave2' and byPk[pk]['_unknownFields']['priceUnit']==r['unit'])]
allheld=newheld|priorheld
badh=[pk for pk in allheld if not (ra[str(pk)]['priceText']=='Price on request' and 'offers' not in ra[str(pk)]['schema'] and '<small' not in ra[str(pk)]['html'] and byPk[pk]['priceConfidence']=='low')]
badnew=[pk for pk in newheld if byPk[pk]['priceSource']!='s49-weng-wave2' or '2026-08-25' not in byPk[pk]['priceBasis']]
outside=[r['pk'] for r in rows if r['pk'] not in pop and json.dumps(r,sort_keys=True)!=json.dumps(bmap[r['pk']],sort_keys=True)]
outside_render=[k for k in rb if int(k) not in pop and (rb[k]['html']!=ra[k]['html'] or rb[k]['schema']!=ra[k]['schema'])]
PRICE_FIELDS=['price','priceLabel','priceTiers','priceBreakdown','currency']
ovr={614027,614000,301527,303752,421749,262403,621590,621614,621605,543098}
pricediff=[pk for pk in rel if pk not in ovr and any(byPk[pk].get(f)!=bmap[pk].get(f) for f in PRICE_FIELDS)]
pricediff_all=[pk for pk in pop if any(byPk[pk].get(f)!=bmap[pk].get(f) for f in PRICE_FIELDS)]
sb=json.load(open(f'{EV}/render-before.summary.json')); sa=json.load(open(f'{EV}/render-after.summary.json'))
v={'sha_before':json.load(open(f'{EV}/sha-before.json')),'sha_after':{'tours-data.json':hashlib.sha256(open('tours-data.json','rb').read()).hexdigest()},
 'population':len(pop),'released':len(rel),'held_new':len(newheld),'held_prior':len(priorheld),'held_total':len(allheld),
 'released_render_violations':bad,'held_render_violations':badh,'new_hold_stamp_violations':badnew,
 'rowsOutsidePopulationChanged':len(outside),'nonPopulationRenderDiff':len(outside_render),
 'priceFieldDiffs_ruleDecided268':pricediff,'priceFieldDiffs_all283':pricediff_all,
 'before':sb,'after':sa,'visible_offers_before':[sb['visiblePrice'],sb['jsonLdOffers']],'visible_offers_after':[sa['visiblePrice'],sa['jsonLdOffers']],
 'small_tags_after':sum('<small' in x['html'] for x in ra.values()),'unit_rows_after':sum(1 for r in rows if isinstance((r.get('_unknownFields') or {}).get('priceUnit'),str)),'byRule':summ['byRule']}
v['PASS']=(not bad and not badh and not badnew and not outside and not outside_render and not pricediff and not pricediff_all and sb['visiblePrice']==sb['jsonLdOffers']==850 and sa['visiblePrice']==sa['jsonLdOffers']==1128 and len(rel)==278 and len(allheld)==13 and v['small_tags_after']==v['unit_rows_after']==147+278)
json.dump(v,open(f'{EV}/verify.json','w'),indent=1); print(json.dumps({k:v[k] for k in v if k not in('sha_before','sha_after','before','after','byRule')}))
