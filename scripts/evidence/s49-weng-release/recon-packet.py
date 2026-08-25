import json,re,collections,sys
SP=sys.argv[1]
rows=json.load(open('tours-data.json'))['tours']
probe=json.load(open(f'{SP}/probe.json'))
# ---- verbatim port of scripts/s48-weng-refresh-a.mjs classifyTier, with reason tracking ----
NEVER=re.compile(r"\b(child|childs|child's|children|childrens|children's|kid|kids|kid's|infant|infants|baby|babies|toddler|junior|juniors|youth|youths|teen|teenager|teens|adolescent|adolescents|young adult|student|students|senior|seniors|oap|concession|concessions|pensioner|disabled|wheelchair|carer|companion|blue light|nhs|discount|under\s*\d+s?|\d+\s*(and|&)\s*under|family|families|bundle|package|add[- ]?on|extra|extras|additional|supplement|upgrade|gratuity|tip|tips|donation|deposit|voucher|gift card|redemption|per additional|spectator|non[- ]?participant|dog|dogs|pet|pets|kit|merchandise|parking|niño|niños|niña|niñas|bebé|bebe|infante|enfant|enfants|bébé|kind|kinder|bambino|bambini|neonato|neonati|ragazzo|ragazzi|ragazza|ragazze|儿童|孩子|学生|老年|优惠)\b|儿童|孩子|学生|老年|优惠",re.I)
AGE_RANGE=re.compile(r"\b\d{1,2}\s*(-|–|to)\s*\d{1,2}\s*(yrs|rys|years|year olds|yr olds|y/o|y/old|yo|años|ans|anni)\b",re.I)
WORDNUM=r"(two|three|four|five|six|seven|eight|nine|ten|twelve|\d+)"
GROUP_SRC=r"\b(per group|group|groups|party|parties|private|exclusive|charter|boat|vessel|vehicle|car|van|minibus|coach|table|room|cabin|pod|lane|court|couple|couples|for two|for 2|whole|hire|rental|raft|canoe|kayak|seater|privado|privada|vehículo|vehiculo|grupo|nights?|berth|capacity|hasta \d+|"+WORDNUM+r"\s*(people|persons|ppl|pax|guests|players|riders|passengers|adults|students|pasajeros|personas)|up to \d+)\b"
GROUP=re.compile(GROUP_SRC,re.I)
BASE_WORDS="adult|adults|person|per person|standard|general|guest|guests|visitor|participant|passenger|rider|player|ticket|seat|single|individual|one person|1 person|per seat"
BASE=re.compile(r"\b("+BASE_WORDS+r")\b",re.I); BASE_HEAD=re.compile(r"^("+BASE_WORDS+r")\b",re.I)
PER_PERSON=re.compile(r"\b(per (person|player|participant|head|adult|guest|rider|passenger|student|pp))\b|\beach person\b|\bpp\b|\b(1|one) (person|student|player)\b(?!\s*(or|to|-|–))",re.I)
NOTE_NEVER=re.compile(r"^\s*extras?\b|\ban (optional )?extra\b|\bprice per item\b|\badd[- ]on\b",re.I)
VOLUME=re.compile(r"^("+WORDNUM+r"\s*(people|persons|adults|guests|players|passengers|students)|groups? of|([2-9]|\d{2,})\s*(-|–|to|\+)\s*\d*\s*(people|persons|adults|guests|players|passengers|students))\b",re.I)
NAME_GROUP=re.compile(r"\b(hire|rental|charter|private|boat|narrowboat|cruiser|vessel)\b",re.I)
HIRE=re.compile(r"\b(hire|rental)\b",re.I)
BOAT=re.compile(r"\b(boat|vessel|charter|narrowboat|cruiser|canoe|kayak|raft|berth)\b",re.I)
def classify(name,note,product):
    sing=(name or '').strip(); note=note or ''
    if NEVER.search(sing) or AGE_RANGE.search(sing): return 'never','NAME_NEVER'
    if NOTE_NEVER.search(note): return 'never','NOTE_NEVER'
    if VOLUME.search(sing): return 'group','VOLUME'
    if BASE_HEAD.search(sing): return 'base','BASE_HEAD'
    if BASE.search(sing) and not GROUP.search(sing): return 'base','BASE'
    if PER_PERSON.search(note): return 'base','NOTE_PER_PERSON'
    m=GROUP.search(sing) or GROUP.search(note)
    if m: return 'group','GROUP:'+m.group(1).lower()
    m=NAME_GROUP.search(product or '')
    if m: return 'group','NAME_GROUP:'+m.group(1).lower()
    return 'base','DEFAULT_BASE'
# ---- ladder source ----
def stored_ladder(r): return [dict(name=t.get('name'),note=t.get('note') or '',price=t.get('price'),min=t.get('minPartySize')) for t in r.get('priceTiers') or []]
def probe_ladder(pk):
    ps=[p for p in probe['perPk'][str(pk)]['probes'] if not p.get('error') and not p.get('absent')]
    if not ps: return None,{'sampled':0,'absent':True}
    shapes=collections.Counter(json.dumps([(t['singular'],t['note'],t['priceCents']) for t in p['tiers']]) for p in ps)
    maj=json.loads(shapes.most_common(1)[0][0])
    return [dict(name=n,note=no or '',price=round(c/100,2),min=None) for n,no,c in maj],{'sampled':len(ps),'dateValid':sum(1 for p in ps if p.get('dateValid')),'shapes':len(shapes),'currency':ps[0].get('liveCurrency')}
WORDS={'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,'eight':8,'nine':9,'ten':10,'twelve':12}
def wordnum_n(label):
    """band size = largest integer/word-number in the label ("Group of 21- 30 People" -> 30, "Five Adults" -> 5, "12+ riders" -> 12)"""
    ns=[int(x) for x in re.findall(r"\d+",label)]+[WORDS[w.lower()] for w in re.findall(r"\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve)\b",label,re.I)]
    return max(ns) if ns else None
def unit_from(tier):
    """verbatim unit string: the tier label if it carries a group/party marker, else the note if it does"""
    for s in (tier['name'],tier['note']):
        if s and (GROUP.search(s) or VOLUME.search(s) or HIRE.search(s)): return s.strip()
    return None
def propose(r,ladder):
    cl=[dict(t,cls=c,why=w) for t in ladder for c,w in [classify(t['name'],t['note'],r['name'])]]
    nz=[t for t in cl if (t['price'] or 0)>0]
    base=[t for t in nz if t['cls']=='base']; grp=[t for t in nz if t['cls']=='group']
    gb=grp+base
    whys=[t['why'] for t in grp]
    only_hire = bool(grp) and all(('GROUP:hire' in w or 'GROUP:rental' in w or w in('NAME_GROUP:hire','NAME_GROUP:rental')) for w in whys)
    all_volume = bool(grp) and all(w=='VOLUME' for w in whys)
    boatish = any(BOAT.search(t['name']+' '+t['note']) for t in grp) or (grp and NAME_GROUP.search(r['name'] or '') and BOAT.search(r['name']))
    out=dict(ladder=[dict(label=t['name'],note=t['note'],price=t['price'],cls=t['cls'],why=t['why']) for t in cl])
    if base:
        a=min(base,key=lambda t:t['price']); out.update(rule='D-624 adult/base',anchor=a['price'],anchorLabel=a['name'],unit=None,bucket='RULE-DECIDED',cls='base-present')
    elif not gb:
        out.update(rule='none (never-only ladder)',anchor=None,unit='NOT-DERIVABLE',bucket='NEEDS-CALL',cls='never-only')
    elif all_volume and len(grp)>1:
        sized=sorted([(wordnum_n(t['name']),t) for t in grp if wordnum_n(t['name'])],key=lambda x:x[0])
        n,big=sized[-1] if sized else (None,max(grp,key=lambda t:t['price']))
        prices=[t['price'] for _,t in sized]
        direction='per-head (price falls with band)' if all(a>=b for a,b in zip(prices,prices[1:])) and prices[0]>prices[-1] else 'party-total (price rises with band)' if all(a<=b for a,b in zip(prices,prices[1:])) and prices[0]<prices[-1] else 'flat/non-monotone'
        pp=(big['price'] if direction.startswith('per-head') else round(big['price']/n,2) if (n and direction.startswith('party')) else None)
        out.update(rule='s48-R1 largest-band per-person + verbatim unit',anchorLabel=big['name'],bandPrice=big['price'],bandSize=n,ladderDirection=direction,perPerson=pp,unit=big['name'].strip(),cls='volume-wordnum',
                   bucket='RULE-DECIDED' if (n and pp is not None) else 'NEEDS-CALL')
        if direction=='flat/non-monotone': out['flag']='ladder not monotone in band size — per-head vs total undecidable'
        if direction.startswith('party'):
            fl=min(grp,key=lambda t:t['price']); out['bucket']='NEEDS-CALL'
            out['altRule']='D-614 party-size ladder floor'; out['altAnchor']=fl['price']; out['altUnit']=fl['name'].strip()
            out['flag']='party-total ladder: s48-R1 (largest band ÷ N) and D-614 (floor tier) disagree'
        out['anchor']=pp
    else:
        fl=min(gb,key=lambda t:t['price']); u=unit_from(fl)
        if only_hire: out.update(rule='(hire/rental over-hold — no standing rule; D-624 if single-user kit, D-614 floor if per-boat/per-vehicle)',cls='hire-rental',bucket='NEEDS-CALL')
        elif boatish: out.update(rule='D-621 whole-boat /boat',cls='whole-boat',bucket='RULE-DECIDED' if u else 'NEEDS-CALL')
        else: out.update(rule='D-614 party-size ladder floor',cls='party-size',bucket='RULE-DECIDED' if u else 'NEEDS-CALL')
        out.update(anchor=fl['price'],anchorLabel=fl['name'],unit=u or 'NOT-DERIVABLE')
        if len(set(whys))>1 and not only_hire and any(w=='VOLUME' for w in whys): out['bucket']='NEEDS-CALL'; out['flag']='mixed volume + party-size tiers'
    return out
held=lambda r: 'HELD' in (r.get('priceBasis') or '')
packet={}
A=[r for r in rows if r.get('priceSource')=='s47-weng-wholeparty' and held(r)]
S48A=[r for r in rows if r.get('priceSource')=='s48-weng-refresh' and held(r)]
D=[r for r in rows if r.get('priceSource')=='s48-weng-refresh-b' and held(r)]
def entry(r,ladder,extra=None):
    e=dict(pk=r['pk'],name=r['name'],stored=r.get('price'),storedLabel=r.get('priceLabel'),stampedAt=r.get('priceEnrichmentAt'),basisHead=(r.get('priceBasis') or '')[:60]); e.update(propose(r,ladder)); 
    if extra: e.update(extra)
    return e
# A: fresh probe for the 11 stale rows, stored ladder for the 3 dated 2026-08-24
packet['A']=[]
for r in A:
    if str(r['pk']) in probe['perPk']:
        lad,meta=probe_ladder(r['pk'])
        if lad is None: e=entry(r,stored_ladder(r),{'probe':meta,'flag':'still UNSAMPLED on 4/4 dated probes (2026-08-25); stored ladder shown'}); e['bucket']='NEEDS-CALL'
        else:
            e=entry(r,lad,{'probe':meta})
            if [t['name'] for t in lad]!=[t['name'] for t in stored_ladder(r)] or [t['price'] for t in lad]!=[t['price'] for t in stored_ladder(r)]: e['flag']=(e.get('flag','')+'; ' if e.get('flag') else '')+'live ladder differs from stored (stamp 2026-05-28) — restamp required before release'
            if meta.get('currency')!='GBP': e['bucket']='NEEDS-CALL'; e['flag']='live currency '+str(meta.get('currency'))
    else: e=entry(r,stored_ladder(r),{'probe':'stamp 2026-08-24, stored ladder used'})
    if 'AMBIG' in (r.get('priceBasis') or ''): e['bucket']='NEEDS-CALL'; e['flag']=(e.get('flag','')+'; ' if e.get('flag') else '')+'s47 HOLD-AMBIG'
    packet['A'].append(e)
# s48-A held → classes
ents=[entry(r,stored_ladder(r)) for r in S48A]
packet['B']=[e for e in ents if e['cls']=='hire-rental']
packet['C']=[e for e in ents if e['cls']=='volume-wordnum']
packet['s48A_other_held']=[e for e in ents if e['cls'] not in('hire-rental','volume-wordnum')]
packet['D']=[entry(r,stored_ladder(r)) for r in D]
json.dump(packet,open(f'{SP}/packet.json','w'),indent=1,ensure_ascii=False)
for k in ['A','B','C','D','s48A_other_held']:
    L=packet[k]; print(k,len(L),dict(collections.Counter(e['bucket'] for e in L)),dict(collections.Counter(e['cls'] for e in L)), 'NOT-DERIVABLE',sum(1 for e in L if e.get('unit')=='NOT-DERIVABLE'))
