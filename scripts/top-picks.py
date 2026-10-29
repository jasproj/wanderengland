#!/usr/bin/env python3
"""Top-picks strip for Wander hub pages (WHAW / WPR template variants).

Inserts a 3-card "Top picks" strip directly under the hero, built from cards
already on the page. Pick order: the page's editorial pins
(#activity-pinned-pks) first, then qualityScore desc, reviewCount desc.
Gear/rental rows are never picked (D-757).

D-760 gate: a card goes in the strip only if, at build time,
  1. the v1 item API returns 200 and the item is not archived/private,
  2. price-preview returns a next availability (an open slot), and
  3. the number printed on the card equals a price-preview tier.
Candidates failing any check are skipped and logged; a page with fewer than
3 passing candidates is left untouched.

Idempotent: marker id="top-picks-css". Re-running replaces nothing.

Usage: top-picks.py <repo-root> [--dry] [--evidence out.tsv] file.html[=topic-regex] ...
(no regex = island-hub default: the core tour categories)
"""
import html, json, pathlib, re, sys, time, urllib.request

MIN_CARDS = 6
OFFTOPIC = re.compile(r'\b(photo ?shoot|photography|paint|sip|private event|massage|transfer|shuttle|wedding|yoga|class)\b', re.I)
ISLAND_TOPIC = r'snorkel|manta|whale|helicopter|cruise|catamaran|luau|kayak|dive|diving|boat|raft|bio ?bay|zipline|hike|tour'
RENTAL = re.compile(r'\b(rental|rentals|gear|equipment|snorkel set|fins|dry snorkel|flotation devices)\b', re.I)
FH_URL = re.compile(r'fareharbor\.com/embeds/book/([a-z0-9-]+)/items/(\d+)')
PRICE = re.compile(r'class="tour-price[^"]*"[^>]*>\s*(?:From\s*)?(?:US\$|NZ\$|\$|£|€)\s*([\d,]+(?:\.\d{1,2})?)')
HERO_OPEN = re.compile(r'<section\b[^>]*class="(?:[^"]*\s)?(hero|activity-hero|island-hero|hero-section|page-hero|page-banner)(?:\s[^"]*)?"[^>]*>')
CARD_OPEN = re.compile(r'<(article|div)\b[^>]*class="tour-card(?:\s[^"]*)?"[^>]*>')

CSS = '''<style id="top-picks-css">
.top-picks{padding:22px 0 10px;background:#fff}
.top-picks .tp-wrap{max-width:1200px;margin:0 auto;padding:0 20px}
.top-picks h2{font-size:1.25rem;margin:0 0 12px;color:var(--ocean-deep,#0A4D68)}
.top-picks-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.top-picks-grid>*{min-width:0;margin:0}
.top-picks-more{display:inline-block;margin:14px 0 6px;font-weight:600;color:var(--ocean-mid,#088395)}
@media (max-width:760px){
  .top-picks .tp-wrap{padding:0 16px}
  .top-picks-grid{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:12px;padding-bottom:6px;-webkit-overflow-scrolling:touch}
  .top-picks-grid>*{flex:0 0 84%;scroll-snap-align:start}
}
</style>
'''


def match_close(s, start, tag):
    """End index of the element whose open tag starts at `start` (nesting-aware)."""
    rx = re.compile(r'<(/?)%s\b[^>]*>' % tag)
    depth = 0
    for m in rx.finditer(s, start):
        depth += -1 if m.group(1) else 1
        if depth == 0:
            return m.end()
    raise ValueError('unclosed <%s> at %d' % (tag, start))


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 wander-top-picks'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, ''
    except Exception as e:
        return 0, str(e)


_cache = {}


def live_check(sn, pk, printed):
    key = (sn, pk)
    if key not in _cache:
        st, body = get(f'https://fareharbor.com/api/v1/companies/{sn}/items/{pk}/')
        if st != 200:
            _cache[key] = (False, f'item-api {st}', None)
        else:
            it = json.loads(body).get('item', {})
            if it.get('is_archived') or it.get('is_private'):
                _cache[key] = (False, 'archived/private', None)
            else:
                st2, b2 = get(f'https://fareharbor.com/api/embed/{sn}/price-preview/per-item/v2/?item_pks={pk}&include_breakdown=yes')
                items = (json.loads(b2).get('items') if st2 == 200 and b2 else None) or []
                if not items or not items[0].get('availability'):
                    _cache[key] = (False, f'no open slot (preview {st2})', None)
                else:
                    p = items[0].get('price') or {}
                    tiers = {p.get('low'), p.get('high')}
                    for ct in (p.get('breakdown') or {}).get('customer_types', []):
                        tiers.add(ct.get('price'))
                    tiers.discard(None)
                    _cache[key] = (True, items[0]['availability']['start_at'], tiers)
        time.sleep(0.3)
    ok, why, tiers = _cache[key]
    if not ok:
        return False, why
    if printed is None:
        return True, f'next slot {why}; card shows no price (nothing to contradict)'
    if round(printed * 100) not in tiers:
        return False, f'printed ${printed:g} not in preview tiers {sorted(t/100 for t in tiers)}'
    return True, f'next slot {why}; ${printed:g} matches preview'


def extract_cards(s):
    out, pos = [], 0
    while True:
        m = CARD_OPEN.search(s, pos)
        if not m:
            return out
        end = match_close(s, m.start(), m.group(1))
        out.append((m.start(), end, s[m.start():end]))
        pos = end


def clean_card(c, eager):
    c = re.sub(r'<script type="application/ld\+json">[\s\S]*?</script>\s*', '', c)
    c = re.sub(r'(<(?:article|div)\b[^>]*?)\s+id="[^"]*"', r'\1', c, count=1)
    if eager:
        c = c.replace('loading="lazy"', 'loading="eager"', 1)
    return c


def transform(s, tours, fname, ev, topic):
    if 'id="top-picks-css"' in s:
        return s, 'already'
    hm = HERO_OPEN.search(s)
    if not hm:
        return s, 'no-hero'
    hero_end = match_close(s, hm.start(), 'section')
    cards = [c for c in extract_cards(s) if c[0] > hero_end]
    # dedupe by booking item
    seen, uniq = set(), []
    for st, en, c in cards:
        m = FH_URL.search(c)
        if not m or (m.group(1), m.group(2)) in seen:
            continue
        seen.add((m.group(1), m.group(2)))
        uniq.append((st, c, m.group(1), int(m.group(2))))
    if len(uniq) < MIN_CARDS:
        return s, f'only-{len(uniq)}-cards'
    pins = []
    pm = re.search(r'id="activity-pinned-pks"[^>]*>\s*(\[[^\]]*\])', s)
    if pm:
        pins = json.loads(pm.group(1))

    trx = re.compile(r'(' + topic + r')', re.I)

    def nm(c):
        return html.unescape(re.sub(r'<[^>]+>', '', (re.search(r'<h3[^>]*>([\s\S]*?)</h3>', c) or [None, ''])[1])).strip()

    def rank(x):
        _, c, sn, pk = x
        t = tours.get(pk, {})
        pin = pins.index(pk) if pk in pins else 10**6
        return (0 if trx.search(nm(c)) else 1, pin, -(t.get('qualityScore') or 0), -(t.get('reviewCount') or 0))
    chosen = []
    for st, c, sn, pk in sorted(uniq, key=rank):
        name = re.sub(r'<[^>]+>', '', (re.search(r'<h3[^>]*>([\s\S]*?)</h3>', c) or [None, ''])[1]).strip()
        if RENTAL.search(name):
            ev.append((fname, sn, pk, 'SKIP', 'rental/gear', name)); continue
        if OFFTOPIC.search(name) or not trx.search(name):
            ev.append((fname, sn, pk, 'SKIP', 'off-topic for page', name)); continue
        pr = PRICE.search(c)
        printed = float(pr.group(1).replace(',', '')) if pr else None
        ok, why = live_check(sn, pk, printed)
        ev.append((fname, sn, pk, 'PICK' if ok else 'SKIP', why, html.unescape(name)))
        if ok:
            chosen.append(c)
        if len(chosen) == 3:
            break
    if len(chosen) < 3:
        return s, f'only-{len(chosen)}-live'
    # anchor for "All N tours"
    gm = re.search(r'id="tours-grid"', s[hero_end:])
    if gm:
        anchor = 'tours-grid'
    else:
        first = uniq[0][0]
        sec_start = s.rfind('<section', 0, first)
        tag = re.match(r'<section\b[^>]*>', s[sec_start:]).group(0)
        idm = re.search(r'\sid="([^"]+)"', tag)
        if idm:
            anchor = idm.group(1)
        else:
            anchor = 'tours'
            if 'id="tours"' in s:
                return s, 'anchor-collision'
            s = s[:sec_start] + tag[:-1] + ' id="tours">' + s[sec_start + len(tag):]
    picks = '\n'.join(clean_card(c, i == 0) for i, c in enumerate(chosen))
    strip = ('\n<section class="top-picks" aria-label="Top picks">\n  <div class="tp-wrap">\n'
             '    <h2>Top picks</h2>\n    <div class="tours-grid top-picks-grid">\n' + picks +
             f'\n    </div>\n    <a class="top-picks-more" href="#{anchor}">See all tours ↓</a>\n  </div>\n</section>\n')
    s = s[:hero_end] + strip + s[hero_end:]
    s = s.replace('</head>', CSS + '</head>', 1)
    return s, f'ok cards={len(uniq)} pins={len(pins)} anchor=#{anchor}'


def main():
    args = sys.argv[1:]
    root = pathlib.Path(args.pop(0))
    dry = '--dry' in args; args = [a for a in args if a != '--rebuild']
    evf = None
    if '--evidence' in args:
        i = args.index('--evidence'); evf = args[i + 1]; del args[i:i + 2]
    files = [a for a in args if a != '--dry']
    d = json.load(open(root / 'tours-data.json'))
    tl = d['tours'] if isinstance(d, dict) else d
    tours = {}
    for t in tl:
        try:
            tours[int(t.get('pk'))] = t
        except (TypeError, ValueError):
            pass
    ev = []
    for spec in files:
        f, _, topic = spec.partition('=')
        topic = topic or ISLAND_TOPIC
        p = root / f
        s = p.read_text()
        if '--rebuild' in sys.argv:
            s = re.sub(r'\n?<section class="top-picks"[\s\S]*?</section>\n?', '\n', s, count=1)
            s = re.sub(r'<style id="top-picks-css">[\s\S]*?</style>\n?', '', s, count=1)
        out, msg = transform(s, tours, f, ev, topic)
        fh0, fh1 = s.count('fareharbor.com/embeds'), out.count('fareharbor.com/embeds')
        print(f'{f:34s} {msg}  fh {fh0}->{fh1}')
        if not dry and out != s:
            p.write_text(out)
    if evf:
        with open(evf, 'w') as fh:
            fh.write('file\tshortname\tpk\tresult\twhy\tname\n')
            for r in ev:
                fh.write('\t'.join(map(str, r)) + '\n')


if __name__ == '__main__':
    main()
