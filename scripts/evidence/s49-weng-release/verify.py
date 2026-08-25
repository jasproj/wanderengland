import json,hashlib,subprocess
# mirror app.js escapeHtml exactly (&#39; for apostrophe, not html.escape's &#x27;)
esc=lambda s: s.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;').replace('"','&quot;').replace("'",'&#39;')
EV='scripts/evidence/s49-weng-release'
summ=json.load(open(f'{EV}/apply-summary.json')); rb=json.load(open(f'{EV}/render-before.json')); ra=json.load(open(f'{EV}/render-after.json'))
rows=json.load(open('tours-data.json'))['tours']; byPk={r['pk']:r for r in rows}
rel={r['pk']:r for r in summ['releases']}; held={h['pk']:h for h in summ['holds']}; pop=set(rel)|set(held)
bad=[]
for pk,r in rel.items():
    o=ra[str(pk)]; row=byPk[pk]; exp_small=f"<small>{esc(r['unit'])}</small>"
    ok=(o['priceText']==f"From £{r['price']:g}" and exp_small in o['html'] and o['schema'].get('offers',{}).get('priceCurrency')=='GBP' and str(o['schema']['offers'].get('price'))==str(r['price']) and row['priceConfidence']=='high' and row['priceSource']=='s49-weng-release' and row['_unknownFields']['priceUnit']==r['unit'])
    if not ok: bad.append((pk,'released',o['priceText'],exp_small in o['html'],o['schema'].get('offers')))
for pk in held:
    o=ra[str(pk)]; row=byPk[pk]
    if not (o['priceText']=='Price on request' and 'offers' not in o['schema'] and row['priceConfidence']=='low' and row['priceSource']=='s49-weng-release' and '<small' not in o['html'] and 'priceUnit' not in (row.get('_unknownFields') or {})): bad.append((pk,'held',o['priceText']))
outside_diff=[k for k in rb if int(k) not in pop and (rb[k]['html']!=ra[k]['html'] or rb[k]['schema']!=ra[k]['schema'])]
before_doc=json.loads(subprocess.run(['git','show','origin/main:tours-data.json'],capture_output=True).stdout)
bmap={r['pk']:json.dumps(r,sort_keys=True) for r in before_doc['tours']}
outside_changed=[r['pk'] for r in rows if r['pk'] not in pop and json.dumps(r,sort_keys=True)!=bmap[r['pk']]]
sb=json.load(open(f'{EV}/render-before.summary.json')); sa=json.load(open(f'{EV}/render-after.summary.json'))
raw=open('tours-data.json','rb').read()
v={'sha_before':json.load(open(f'{EV}/sha-before.json')),'sha_after':{'tours-data.json':hashlib.sha256(raw).hexdigest()},
   'byteRoundTrip':json.dumps(json.loads(raw),indent=2,ensure_ascii=False)!=None,
   'population':len(pop),'released':len(rel),'held':len(held),'tally':summ['tally'],
   'released_render_violations':[b for b in bad if b[1]=='released'],'held_render_violations':[b for b in bad if b[1]=='held'],
   'nonPopulationRenderDiff':len(outside_diff),'rowsOutsidePopulationChanged':len(outside_changed),
   'before':sb,'after':sa,'visible_eq_offers_before':sb['visiblePrice']==sb['jsonLdOffers'],'visible_eq_offers_after':sa['visiblePrice']==sa['jsonLdOffers'],
   'small_tags_after':sum('<small' in x['html'] for x in ra.values()),'unit_rows_after':sum(1 for r in rows if isinstance((r.get('_unknownFields') or {}).get('priceUnit'),str)),
   'visible_delta_expected':len(rel),'visible_delta_actual':sa['visiblePrice']-sb['visiblePrice']}
v['PASS']=not bad and not outside_diff and not outside_changed and v['visible_eq_offers_after'] and v['small_tags_after']==len(rel)==v['unit_rows_after'] and v['visible_delta_actual']==len(rel)
json.dump(v,open(f'{EV}/verify.json','w'),indent=1); print(json.dumps({k:v[k] for k in v if k not in('sha_before','sha_after','before','after')},indent=1)); print('before',sb); print('after',sa)
