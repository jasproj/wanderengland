# s49-weng-providers recon: resolve each distinct shortname via /api/v1/companies/{sn}/ (canonical
# instrument). 1 req/s, ≤2 bounded retries on timeout/5xx, attempted vs succeeded reconciled.
# Non-resolving shortnames recorded UNRESOLVED with the structural response shape — never guessed.
import json,re,time,sys,urllib.request,urllib.error,datetime
SP=sys.argv[1]
rows=json.load(open('tours-data.json'))['tours']
def parse(u):
    m=re.match(r'https?://(?:www\.)?fareharbor\.com/(?:embeds/book/)?([^/?#]+)/items/(\d+)',u or ''); return m.group(1) if m else None
pop=[r for r in rows if parse(r['bookingUrl']) and (not r.get('company') or r['company'].strip().lower()==parse(r['bookingUrl']).lower())]
sns=sorted({parse(r['bookingUrl']) for r in pop})
out={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'endpoint':'https://fareharbor.com/api/v1/companies/{sn}/','populationRows':len(pop),'attempted':len(sns),'requests':0,'retries':[],'perShortname':{}}
def get(sn):
    req=urllib.request.Request(f'https://fareharbor.com/api/v1/companies/{sn}/',headers={'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36','Accept':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=25) as r: return r.status,r.read()
    except urllib.error.HTTPError as e: return e.code,e.read()
    except Exception as e: return None,str(e).encode()
for i,sn in enumerate(sns):
    rec={'attempts':0}
    for attempt in range(3):
        out['requests']+=1; rec['attempts']+=1
        st,body=get(sn); time.sleep(1)
        if st is None or (st and st>=500):
            out['retries'].append({'sn':sn,'attempt':attempt,'status':st}); time.sleep(2); continue
        break
    rec['status']=st
    try: j=json.loads(body)
    except Exception: j=None
    shape={'topKeys':sorted(j.keys()) if isinstance(j,dict) else type(j).__name__,'bytes':len(body)}
    c=j.get('company') if isinstance(j,dict) else None
    if st==200 and isinstance(c,dict) and isinstance(c.get('name'),str) and c['name'].strip() and c.get('shortname')==sn:
        rec.update(resolved=True,name=c['name'].strip(),companyPk=c.get('pk'),currency=c.get('processor_currency'),shape=shape)
    else:
        rec.update(resolved=False,shape=shape,companyShortnameEcho=(c or {}).get('shortname') if isinstance(c,dict) else None,bodyHead=body[:160].decode('utf-8','replace'))
    out['perShortname'][sn]=rec
    if (i+1)%40==0: print(f'{i+1}/{len(sns)}',file=sys.stderr); json.dump(out,open(f'{SP}/s49-providers/companies.json','w'),indent=1)
out['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
res=[s for s,v in out['perShortname'].items() if v['resolved']]; unres=[s for s,v in out['perShortname'].items() if not v['resolved']]
out['reconcile']={'attempted':len(sns),'succeeded':len(out['perShortname']),'resolved':len(res),'unresolved':len(unres),'unresolvedList':unres}
json.dump(out,open(f'{SP}/s49-providers/companies.json','w'),indent=1)
print(json.dumps({'requests':out['requests'],'retries':len(out['retries']),'reconcile':out['reconcile']}))
