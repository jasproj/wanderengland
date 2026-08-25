import json,re,collections,sys
SP=sys.argv[1]
# reuse the classifier port + helpers from the s49 recon packet (verbatim s48 regexes)
src=open('scripts/evidence/s49-weng-release/recon-packet.py').read().split('# ---- ladder source ----')[0]
src=src.replace("probe=json.load(open(f'{SP}/probe.json'))","probe=None")
exec(src)
ADDON=re.compile(r"per additional|\badditional\b|\bextra\b|\badd[- ]?on\b|\bsupplement\b|\bper item\b",re.I)
DURATION=re.compile(r"\b(\d+(\.\d+)?|one|two|three|four|five|six|half|full|all)[\s-]*(hour|hours|hr|hrs|day|days|minute|minutes|min|mins|night|nights|week|weeks)\b|\bhalf[\s-]?(day|hour)\b|\ball[\s-]?day\b|\bovernight\b|\bday (hire|rental)\b",re.I)
SKILL=re.compile(r"\b(beginner|beginners|intermediate|advanced|novice|expert|improver)\b",re.I)
ACCESSORY=re.compile(r"\b(boots?|gloves?|hoods?|extra[- ]person|extra participants?)\b",re.I)
CHILD=re.compile(r"\b(child|childs|child's|children|childrens|children's|kid|kids|kid's|infant|toddler|junior|juniors|youth|youths|teen|teenager|teens|under\s*\d+s?|\d+\s*(and|&)\s*under)\b",re.I)
WORDS={'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,'eight':8,'nine':9,'ten':10,'twelve':12}
def band(label):
    ns=[int(x) for x in re.findall(r"\d+",label)]+[WORDS[w.lower()] for w in re.findall(r"\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve)\b",label,re.I)]
    return max(ns) if ns else None
rows=json.load(open('tours-data.json'))['tours']
pop=[r for r in rows if r.get('priceSource')=='s48-weng-refresh' and 'HELD' in (r.get('priceBasis') or '')]
def decide(r):
    L=[dict(name=t.get('name'),note=t.get('note') or '',price=t.get('price') or 0,min=t.get('minPartySize')) for t in r.get('priceTiers') or []]
    cl=[dict(t,cls=c,why=w) for t in L for c,w in [classify(t['name'],t['note'],r['name'])]]
    nz=[t for t in cl if t['price']>0]; base=[t for t in nz if t['cls']=='base']; grp=[t for t in nz if t['cls']=='group']; nev=[t for t in nz if t['cls']=='never']
    out=dict(pk=r['pk'],name=r['name'],stored=r.get('price'),stamp=r.get('priceEnrichmentAt','')[:10],ladder=[(t['name'],t['price'],t['why']) for t in cl])
    def fin(rule,tier,unit,bucket,blocker=None):
        out.update(rule=rule,anchor=tier['price'] if tier else None,anchorLabel=tier['name'] if tier else None,unit=unit,bucket=bucket,blocker=blocker)
        if tier and ADDON.search(tier['name']+' '+tier['note']): out.update(bucket='NEEDS-RULING',blocker='add-on-shaped anchor tier (abort)')
        return out
    whys=[t['why'] for t in grp]
    if base: return fin('D-624 adult/base',min(base,key=lambda t:t['price']),None,'DECIDED')
    if not grp and nev:
        allchild=all(CHILD.search(t['name']) for t in nev) or CHILD.search(r['name'])
        if allchild: x=min(nev,key=lambda t:t['price']); return fin('child-audience (s49)',x,x['name'],'DECIDED')
        return fin('none',None,'NOT-DERIVABLE','NEEDS-RULING','never-only ladder, not a child-audience product ('+', '.join(sorted(set(t['name'] for t in nev)))[:80]+')')
    if not grp: return fin('none',None,'NOT-DERIVABLE','NEEDS-RULING','no priced tiers')
    only_hire=all(('hire' in w or 'rental' in w) for w in whys)
    if only_hire:
        cand=[t for t in grp if ACCESSORY.search(r['name']) or not ACCESSORY.search(t['name'])]
        if not cand: return fin('hire/rental (s49)',None,'NOT-DERIVABLE','NEEDS-RULING','hire: only accessory tiers')
        x=min(cand,key=lambda t:t['price'])
        if SKILL.search(x['name']): return fin('hire/rental (s49)',x,x['name'],'NEEDS-RULING','hire: floor label is a skill grade')
        if not DURATION.search(x['name']): return fin('hire/rental (s49)',x,x['name'],'NEEDS-RULING','hire: floor label carries no duration/unit')
        return fin('hire/rental (s49)',x,x['name'],'DECIDED')
    sized=sorted([(band(t['name']),t) for t in grp if t['why']=='VOLUME' or band(t['name'])],key=lambda x:x[0] or 0)
    vol=[t for t in grp if t['why']=='VOLUME']
    if len(vol)>=2 and len(vol)==len(grp) or (vol and len(sized)==len(grp) and len(grp)>=2):
        prices=[t['price'] for _,t in sized]
        if all(a>=b for a,b in zip(prices,prices[1:])) and prices[0]>prices[-1]: n,x=sized[-1]; return fin('s48-R1 per-head rate ladder',x,x['name'],'DECIDED')
        if all(a<=b for a,b in zip(prices,prices[1:])) and prices[0]<prices[-1]: x=min(grp,key=lambda t:t['price']); return fin('D-614 party-total floor (s49)',x,x['name'],'DECIDED')
        x=min(grp,key=lambda t:t['price']); return fin('volume ladder',x,x['name'],'NEEDS-RULING','volume ladder not monotone in band size')
    fl=min(grp,key=lambda t:t['price'])
    unit=next((s.strip() for s in (fl['name'],fl['note']) if s and (GROUP.search(s) or VOLUME.search(s) or HIRE.search(s))),None)
    boat=any(BOAT.search(t['name']+' '+t['note']) for t in grp) or (NAME_GROUP.search(r['name'] or '') and BOAT.search(r['name']))
    rule='D-621 whole-boat' if boat else 'D-614 party-size ladder floor'
    if not unit: return fin(rule,fl,'NOT-DERIVABLE','NEEDS-RULING',('boat' if boat else 'party-size')+': floor label/note carries no unit wording ('+fl['name'][:40]+')')
    return fin(rule,fl,unit,'DECIDED')
res=[decide(r) for r in pop]
json.dump(res,open(f'{SP}/s49-wave2/wave2.json','w'),indent=1,ensure_ascii=False)
print('population',len(res),'| stamps',dict(collections.Counter(e['stamp'] for e in res)),'| pre-2026-08-24:',sum(1 for e in res if e['stamp']<'2026-08-24'))
print('buckets',dict(collections.Counter(e['bucket'] for e in res)))
print('\nDECIDED by rule:');
for k,v in collections.Counter(e['rule'] for e in res if e['bucket']=='DECIDED').most_common(): print(f'  {v:4d}  {k}')
print('\nNEEDS-RULING by blocker:')
for k,v in collections.Counter(re.sub(r' \(.*','',e['blocker'] or '') for e in res if e['bucket']=='NEEDS-RULING').most_common(): print(f'  {v:4d}  {k}')
print('\nsamples (decided, per rule):')
seen=set()
for e in res:
    if e['bucket']=='DECIDED' and e['rule'] not in seen: seen.add(e['rule']); print(' ',e['pk'],e['name'][:38],'| £',e['anchor'],'«',e['anchorLabel'],'» unit:',e['unit'],'|',e['ladder'][:3])
print('\nadd-on sweep hits:',[ (e['pk'],e['anchorLabel']) for e in res if (e['blocker'] or '').startswith('add-on')])
print('\nNEEDS-RULING full:')
for e in sorted([e for e in res if e['bucket']=='NEEDS-RULING'],key=lambda e:e['blocker']): print(' ',e['pk'],'|',e['name'][:44],'| stored £',e['stored'],'|',e['blocker'],'|',' / '.join(f"{n} £{p} [{w}]" for n,p,w in e['ladder'])[:170])
