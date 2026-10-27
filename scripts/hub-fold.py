#!/usr/bin/env python3
"""Hub-page fold fix for the Wander hub template.

Adds: hero CTA ("See tours ↓") + chips, a 3-card "Top picks" strip right after
the hero, moves long prose sections from above the tour grid to below it,
caps H1 length/size on mobile. Idempotent (marker id="hub-fold-css").

Usage: hubfold.py <repo-root> <region-label> [--dry] file1.html file2.html ...
"""
import json, re, sys, html, pathlib

BANNED = re.compile(r"\b(unforgettable|breathtaking|stunning|must-see|hidden gem|paradise|awaits|world-class)\b", re.I)
KEEP_CLASSES = ("region-links", "weather", "choice", "hub-", "top-picks", "trust", "breadcrumb")
HERO_RE = re.compile(r'<section class="(hero|activity-hero|page-hero|page-banner)[^"]*"[^>]*>')
SEC_OPEN = re.compile(r'<section\b[^>]*>')
CARD_RE = re.compile(r'<article class="tour-card"[\s\S]*?</article>')

CSS = '''<style id="hub-fold-css">
.hub-fold{margin-top:18px;display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.hub-cta{display:inline-block;background:var(--coral,#FF6B6B);color:#fff!important;font-weight:700;padding:13px 24px;border-radius:999px;text-decoration:none;font-size:1rem;box-shadow:0 4px 14px rgba(0,0,0,.18)}
.hub-cta:hover{background:#e85c5c}
.hub-chips{display:flex;gap:8px;flex-wrap:wrap}
.hub-chip{font-size:.78rem;font-weight:600;padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.16);color:#fff;border:1px solid rgba(255,255,255,.4);white-space:nowrap}
.top-picks{padding:22px 0 10px;background:#fff}
.top-picks .container{max-width:1200px;margin:0 auto;padding:0 20px}
.top-picks h2{font-size:1.25rem;margin:0 0 12px;color:var(--ocean-deep,#0A4D68)}
.top-picks-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.top-picks-more{display:inline-block;margin:14px 0 6px;font-weight:600;color:var(--ocean-mid,#088395)}
@media (max-width:760px){
  .top-picks-grid{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:12px;padding-bottom:6px;-webkit-overflow-scrolling:touch}
  .top-picks-grid>*{flex:0 0 84%;scroll-snap-align:start}
  .hero h1,.activity-hero h1,.page-hero h1,.page-banner h1{font-size:clamp(1.55rem,7vw,2rem)!important;line-height:1.15!important}
  .hero,.activity-hero,.page-hero,.page-banner{padding-top:34px!important;padding-bottom:30px!important}
  .hub-cta{width:100%;text-align:center}
  .activity-hero p,.hero p,.page-hero p,.page-banner p{font-size:1rem!important;line-height:1.45!important;margin-bottom:14px!important}
  .hero-stats{gap:6px 22px!important;margin-bottom:0!important}
  .hero-stat-number{font-size:1.25rem!important}
  .hero-stat-label{font-size:.72rem!important}
  .hub-fold{margin-top:14px}
}
</style>
'''

H1_SHORTEN = [
    (re.compile(r'\s*\((2026|2026/27|2027)\)\s*$'), ''),
]
H1_MAP = {
    "BVI Day Trips from St. Thomas: The Baths, Jost Van Dyke or Norman Island": "BVI Day Trips from St. Thomas",
    "Milford Sound tours & cruises — and when to book Doubtful instead": "Milford Sound Tours & Cruises",
    "Oxford Tours: Walking Tours, Colleges & Day Trips from London": "Oxford Tours & Day Trips from London",
    "Liverpool Guided Tours: Beatles, Football & City Walks": "Liverpool Guided Tours",
    "USVI Snorkeling: Best Spots & Tours on St. Thomas, St. John & St. Croix": "USVI Snorkeling: Best Spots & Tours",
    "St. Croix, USVI: Travel Guide, Things to Do & Tours": "St. Croix Travel Guide & Tours",
    "Kayaking in New Zealand: Guided Kayak Tours & Sea Kayaking": "Kayaking in New Zealand: Guided Tours",
    "Jet Ski Hire & Jet Ski Tours in New Zealand": "Jet Ski Hire & Tours in New Zealand",
    "New Zealand Bike Tours: Guided & Self-Guided Cycling": "New Zealand Bike Tours",
    "Kayaking in the US Virgin Islands: Tours & Rentals": "USVI Kayaking: Tours & Rentals",
}


def words(s):
    return len(re.sub(r'<[^>]+>', ' ', s).split())


def close_of(s, start):
    """index just past the </section> that closes the <section> opened at start (no nesting assumed)."""
    i = s.index('</section>', start)
    return i + len('</section>')


def rank_cards(cards, tours):
    def key(c):
        m = re.search(r'data-tour-id="(?:fh-|pr-)?(\d+)"', c)
        t = tours.get(int(m.group(1))) if m else None
        q = (t or {}).get('qualityScore') or 0
        rc = (t or {}).get('reviewCount') or 0
        return (-(q or 0), -(rc or 0))
    return sorted(cards, key=key)


def min_price(cards):
    best = None
    for c in cards:
        m = re.search(r'tour-price[^>]*>\s*(?:From\s*)?(NZ\$|US\$|\$|€|£)\s*([\d,]+(?:\.\d+)?)', c)
        if m:
            v = float(m.group(2).replace(',', ''))
            if best is None or v < best[1]:
                best = (m.group(1), v)
    if not best:
        return None
    sym, v = best
    return f"From {sym}{int(v):,}" if v == int(v) else f"From {sym}{v:,.2f}"


def transform(s, tours, region):
    if 'id="hub-fold-css"' in s:
        return s, "already"
    m = HERO_RE.search(s)
    if not m:
        return s, "no-hero"
    hero_start = m.start(); hero_end = close_of(s, m.end())
    tsec = re.search(r'<section class="tours[^"]*"[^>]*>', s[hero_end:])
    if not tsec:
        return s, "no-tours-section"
    tours_start = hero_end + tsec.start()
    tours_end = close_of(s, hero_end + tsec.end())
    tours_html = s[tours_start:tours_end]
    cards = CARD_RE.findall(tours_html)
    if len(cards) < 3:
        return s, f"only-{len(cards)}-cards"
    # ensure anchor id on tours section
    open_tag = tsec.group(0)
    if 'id=' not in open_tag:
        s = s[:tours_start] + open_tag[:-1] + ' id="tours">' + s[tours_start + len(open_tag):]
        tours_end += len(' id="tours"')
        tours_html = s[tours_start:tours_end]
    # --- H1 shorten
    h1m = re.search(r'(<h1[^>]*>)([\s\S]*?)(</h1>)', s[hero_start:hero_end])
    h1_text = html.unescape(re.sub(r'<[^>]+>', '', h1m.group(2))).strip()
    new_h1 = H1_MAP.get(h1_text, h1_text)
    for rx, rep in H1_SHORTEN:
        new_h1 = rx.sub(rep, new_h1)
    if new_h1 != h1_text:
        a = hero_start + h1m.start(2); b = hero_start + h1m.end(2)
        s = s[:a] + html.escape(new_h1, quote=False) + s[b:]
        delta = len(html.escape(new_h1, quote=False)) - (b - a)
        hero_end += delta; tours_start += delta; tours_end += delta
    # --- hero CTA + chips: insert before the container's closing </div> inside hero
    hero_html = s[hero_start:hero_end]
    has_stats = 'hero-stats' in hero_html or 'choice-cards' in hero_html
    chips = ''
    if not has_stats:
        n = len(cards)
        mp = min_price(cards)
        parts = [f"{n} tours" if n != 1 else "1 tour"]
        if mp: parts.append(mp)
        parts.append(region)
        chips = '<div class="hub-chips">' + ''.join(f'<span class="hub-chip">{html.escape(p)}</span>' for p in parts) + '</div>'
    fold = f'\n    <div class="hub-fold"><a class="hub-cta" href="#tours">See tours ↓</a>{chips}</div>\n'
    # last </div> before </section> in hero
    last_div = hero_html.rfind('</div>')
    hero_html = hero_html[:last_div] + fold + hero_html[last_div:]
    s = s[:hero_start] + hero_html + s[hero_end:]
    delta = len(fold); hero_end += delta; tours_start += delta; tours_end += delta
    # --- move long sections between hero and tours below tours
    between = s[hero_end:tours_start]
    moved = []; kept = []
    pos = 0
    for sm in SEC_OPEN.finditer(between):
        if sm.start() < pos:
            continue
        end = between.index('</section>', sm.end()) + len('</section>')
        block = between[sm.start():end]
        cls = re.search(r'class="([^"]*)"', sm.group(0))
        cls = cls.group(1) if cls else ''
        if words(block) > 60 and not any(k in cls for k in KEEP_CLASSES):
            moved.append(block)
        else:
            kept.append(block)
        pos = end
    new_between = '\n'.join(kept) + '\n'
    tours_block = s[tours_start:tours_end]
    # --- top picks strip
    top = rank_cards(cards, tours)[:3]
    top = [re.sub(r'\sloading="lazy"', ' loading="eager"', c) for c in top]
    top = [re.sub(r'\sid="[^"]*"', '', c) for c in top]
    def scrub(c):
        def fix(txt):
            t = re.sub(r'\b(an?|the|most|truly|absolutely)\s+(unforgettable|breathtaking|stunning|must-see|hidden gem|paradise|world-class)\b', r'\1', txt, flags=re.I)
            t = re.sub(r'\b(unforgettable|breathtaking|stunning|must-see|hidden gem|paradise|world-class|awaits)\b[,\s]*', '', t, flags=re.I)
            t = re.sub(r'\s{2,}', ' ', t).replace(' ,', ',').replace(' .', '.')
            return t
        c = re.sub(r'<script type="application/ld\+json">[\s\S]*?</script>\s*', '', c)  # no duplicate per-card schema in the strip
        return re.sub(r'(<p class="tour-desc(?:ription)?">)([\s\S]*?)(</p>)', lambda m: m.group(1) + fix(m.group(2)).strip() + m.group(3), c)
    top = [scrub(c) for c in top]
    strip = ('<section class="top-picks" aria-label="Top picks">\n  <div class="container">\n'
             '    <h2>Top picks</h2>\n    <div class="tours-grid top-picks-grid">\n' + '\n'.join(top) +
             f'\n    </div>\n    <a class="top-picks-more" href="#tours">All {len(cards)} tours ↓</a>\n  </div>\n</section>\n')
    s = s[:hero_end] + '\n' + strip + new_between + tours_block + '\n' + '\n'.join(moved) + '\n' + s[tours_end:]
    # --- css
    s = s.replace('</head>', CSS + '</head>', 1)
    return s, f"ok h1={'shortened' if new_h1 != h1_text else 'same'} moved={len(moved)} kept={len(kept)} cards={len(cards)}"


def main():
    root = pathlib.Path(sys.argv[1]); region = sys.argv[2]
    dry = '--dry' in sys.argv
    files = [a for a in sys.argv[3:] if a != '--dry']
    d = json.load(open(root / 'tours-data.json'))
    tl = d['tours'] if isinstance(d, dict) else d
    tours = {int(t['pk']): t for t in tl if str(t.get('pk', '')).isdigit()}
    for f in files:
        p = root / f
        s = p.read_text()
        before_fh = s.count('fareharbor.com/embeds')
        out, msg = transform(s, tours, region)
        after_fh = out.count('fareharbor.com/embeds')
        added = BANNED.findall(out[len(s):]) if False else []
        print(f"{f:36s} {msg}  fh {before_fh}->{after_fh}")
        if not dry and out != s:
            p.write_text(out)


if __name__ == '__main__':
    main()
