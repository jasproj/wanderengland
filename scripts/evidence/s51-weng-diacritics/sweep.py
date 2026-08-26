import json, re, unicodedata, hashlib, sys

DATA_PATH = sys.argv[1] if len(sys.argv) > 1 else 'tours-data.json'

# Same "published/visible" predicate as scripts/evidence/s47-weng-wholeparty/recon/classify.py
def vis(r):
    return (r.get('status') != 'inactive' and not r.get('bookingDead')
            and isinstance(r.get('price'), (int, float)) and r['price'] > 0
            and r.get('priceConfidence') != 'low'
            and r.get('currency') in ('GBP', 'EUR', 'USD'))

# The exact ASCII never-anchor/concession regex already live in this repo's classifier
CONC_ASCII = re.compile(
    r'\b(child|children|kid|kids|senior|concession|student|infant|youth|teen|oap|junior|'
    r'under \d+|toddler|baby|carer|disabled|nhs|veteran|military|local|resident|member|'
    r'\d+\s*-\s*\d+\s*(yrs|years)|\d+\s*(yrs|years))', re.I)

ADDON_DEPOSIT = re.compile(r'\b(add.?on|addon|deposit)\b', re.I)

# Multilingual never-anchor/concession tokens, folded to plain ASCII, to catch words that ARE
# native-language never-anchor vocabulary (not just accented spellings of English words) -
# same class of bug as the WHAW Kama'aina incident (network MEMORY.md, s50: "the never-anchor
# test must be unicode-normalised everywhere (NFC, okina/macron folds)").
FOLDED_NEVER_TOKENS = [
    'nino', 'ninos', 'nina', 'ninas',       # es: child/children
    'joven', 'jovenes',                      # es: youth
    'anciano', 'anciana', 'mayor', 'mayores',# es: senior/elder
    'enfant', 'enfants',                     # fr: child
    'jeune', 'jeunes',                       # fr: youth
    'aine', 'ainee',                         # fr: elder/senior
    'kind', 'kinderen', 'kinder',            # nl/de: child(ren)
    'bambino', 'bambini', 'bambina', 'bambine',  # it: child
    'crianca', 'criancas',                   # pt: child
    'kamaaina',                              # haw: resident (WHAW D-654-lineage incident)
    'plaatselijk', 'inwoner', 'inwoners',    # nl: local/resident
    'residente', 'residentes',               # es/pt/it: resident
    'anwohner', 'einheimisch',               # de: resident/local
]
FOLDED_NEVER_RE = re.compile(r'\b(' + '|'.join(FOLDED_NEVER_TOKENS) + r')\b', re.I)

def fold(s):
    if not s:
        return ''
    nfc = unicodedata.normalize('NFC', s)
    nfkd = unicodedata.normalize('NFKD', nfc)
    # drop combining marks (accents) and the Hawaiian okina (U+02BB) / similar modifier letters
    stripped = ''.join(c for c in nfkd if not unicodedata.combining(c))
    stripped = re.sub(r"[ʹ-ʿ‘’']", '', stripped)  # okina/apostrophe variants
    return unicodedata.normalize('NFC', stripped)

def find_anchor_tier(row):
    label = row.get('priceLabel')
    tiers = row.get('priceTiers') or []
    if label is not None:
        for t in tiers:
            if t.get('name') == label:
                return t
    # fallback: unique tier matching the stored price
    matches = [t for t in tiers if t.get('price') == row.get('price')]
    if len(matches) == 1:
        return matches[0]
    return None

def classify_folded(name):
    f = fold(name).lower()
    hits = []
    if CONC_ASCII.search(f):
        hits.append('concession-ascii')
    if ADDON_DEPOSIT.search(f):
        hits.append('addon-deposit')
    if FOLDED_NEVER_RE.search(f):
        hits.append('multilingual-never')
    return hits, f

def run_sweep(tours):
    findings = []
    scanned = 0
    no_anchor = 0
    for r in tours:
        if not vis(r):
            continue
        scanned += 1
        anchor = find_anchor_tier(r)
        if anchor is None:
            no_anchor += 1
            continue
        raw_name = anchor.get('name', '')
        raw_hits_now = bool(CONC_ASCII.search(raw_name) or ADDON_DEPOSIT.search(raw_name))
        folded_hits, folded_name = classify_folded(raw_name)
        if folded_hits and not raw_hits_now:
            findings.append({
                'pk': r.get('pk'),
                'name': r.get('name'),
                'anchorTierName': raw_name,
                'anchorTierFolded': folded_name,
                'anchorPrice': r.get('price'),
                'currency': r.get('currency'),
                'matchedAs': folded_hits,
                'priceBasis': r.get('priceBasis'),
            })
    return {'scanned': scanned, 'no_anchor_tier': no_anchor, 'findings': findings}

def sha256_of(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()

if __name__ == '__main__':
    data = json.load(open(DATA_PATH, encoding='utf-8'))
    tours = data['tours']
    result = run_sweep(tours)
    result['dataSha256'] = sha256_of(DATA_PATH)
    result['totalRowsInFile'] = len(tours)
    print(json.dumps({k: v for k in ('scanned','no_anchor_tier','totalRowsInFile','dataSha256') for v in [result[k]]}, indent=1))
    print('FINDINGS:', len(result['findings']))
    for f in result['findings']:
        print(json.dumps(f, indent=1, ensure_ascii=False))
    json.dump(result, open('/tmp/diacritics_sweep_result.json', 'w'), indent=1, ensure_ascii=False)
