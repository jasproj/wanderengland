import json,re,collections,random
S='/private/tmp/claude-501/-Users-jasondudney-repos-wanderengland/b40bc00b-a7f7-4f60-b0fa-070083299fbb/scratchpad'
t=json.load(open('tours-data.json'))['tours']
def vis(r): return r.get('status')!='inactive' and not r.get('bookingDead') and isinstance(r.get('price'),(int,float)) and r['price']>0 and r.get('priceConfidence')!='low' and r.get('currency') in ('GBP','EUR','USD')
GROUP=re.compile(r'\b(per group|group|party|parties|up to \d+|\d+\s*-\s*\d+\s*(people|persons|ppl|pax|guests)|\d+\s*(people|persons|ppl|pax|guests|players|riders|passengers)|private|boat|vessel|vehicle|car\b|van\b|minibus|coach|charter|table|room|cabin|kayak|bike|couple|for two|for 2|family|household|team|whole|exclusive|hire|booking fee|deposit)\b',re.I)
PERSON=re.compile(r'^(adult|adults|child|children|kid|kids|senior|seniors|concession|concessions|student|students|infant|infants|youth|teen|teenager|oap|person|per person|standard|general admission|guest|visitor|junior|under \d+|over \d+|\d+\s*-\s*\d+\s*(yrs|years)?|\d+\+|toddler|baby|disabled|carer|nhs|veteran|military|local|resident|member)\b',re.I)
ADULT=re.compile(r'^(adult|adults|person|per person|standard|general admission|guest|visitor)\b',re.I)
CONC=re.compile(r'\b(child|children|kid|kids|senior|concession|student|infant|youth|teen|oap|junior|under \d+|toddler|baby|carer|disabled|nhs|veteran|military|local|resident|member|\d+\s*-\s*\d+\s*(yrs|years)|\d+\s*(yrs|years))',re.I)
VARIANT=re.compile(r'\b(hour|hr|hrs|minute|min|mins|day|half|full|session|mile|km|short|long|extended|standard|premium|deluxe|vip|basic|classic|small|medium|large|xl|single|double|twin|solo|tandem|weekday|weekend|peak|off-peak|morning|afternoon|evening|sunset|night|early|late|\d+\s*(h|m)\b)\b',re.I)
out=[];cls=collections.defaultdict(list)
for r in t:
    b=r.get('priceBreakdown')
    if not b or not vis(r): continue
    tiers=[x for x in b if isinstance(x.get('price'),(int,float)) and x['price']>0]
    if not tiers: continue
    ps=[x['price'] for x in tiers]
    if not (r['price']==max(ps) and max(ps)!=min(ps)): continue
    top=[x for x in tiers if x['price']==max(ps)]
    txt=lambda x:(x.get('singular','')+' | '+(x.get('note') or ''))
    alltxt=' || '.join(txt(x) for x in tiers)
    toptxt=' || '.join(txt(x) for x in top)
    all_person=all(PERSON.match(x.get('singular','').strip()) for x in tiers)
    top_adult=any(ADULT.match(x.get('singular','').strip()) for x in top)
    lower=[x for x in tiers if x['price']<max(ps)]
    lower_conc=all(CONC.search(txt(x)) for x in lower)
    top_group=bool(GROUP.search(toptxt))
    any_group=bool(GROUP.search(alltxt))
    name=r['name']
    top_named=any(x['singular'].lower().strip() and x['singular'].lower().strip() in (name+' '+(r.get('durationText') or '')).lower() for x in top if x['singular'].lower().strip() not in ('adult','person','private tour'))
    if top_group or (any_group and not all_person): c='WHOLE-PARTY'
    elif top_adult and lower_conc: c='ADULT-FIRST'
    elif all_person and lower_conc: c='ADULT-FIRST'
    elif VARIANT.search(alltxt) and not any_group: c='MAX-TIER'
    else: c='AMBIGUOUS'
    rec=dict(pk=r['pk'],name=name,price=r['price'],currency=r['currency'],priceLabel=r.get('priceLabel'),cls=c,topNamedInTitle=top_named,tiers=[dict(singular=x.get('singular'),note=x.get('note'),price=x['price'],minPartySize=x.get('minPartySize')) for x in b],bookingUrl=r['bookingUrl'],src=r.get('priceEnrichmentSource'))
    out.append(rec);cls[c].append(rec)
json.dump(out,open(S+'/classified.json','w'),indent=1)
print('TOTAL',len(out));
for c in ['WHOLE-PARTY','ADULT-FIRST','MAX-TIER','AMBIGUOUS']:
    L=cls[c];print(f'\n=== {c}: {len(L)}  (ceiling tier named in title: {sum(x["topNamedInTitle"] for x in L)}; currency {collections.Counter(x["currency"] for x in L)}; priceLabel top {collections.Counter(x["priceLabel"] for x in L).most_common(4)})')
    random.seed(46)
    for x in random.sample(L,min(3,len(L))):
        print(f"  pk {x['pk']} | {x['name'][:70]} | price {x['currency']} {x['price']} | label={x['priceLabel']}")
        for tt in x['tiers']: print(f"      - {tt['singular']!r} note={tt['note']!r} price={tt['price']} min={tt['minPartySize']}")
