# s49-weng-design: apply Jason's approved design fixes. Anchored single-occurrence replacements; aborts on any anchor count != 1.
import sys,re
def patch(path,old,new,count=1):
    s=open(path,encoding='utf-8').read(); n=s.count(old)
    if n!=count: sys.exit(f'{path}: anchor count {n} != {count} for {old[:70]!r}')
    open(path,'w',encoding='utf-8').write(s.replace(old,new))
CITIES=['london','cambridge','liverpool','oxford']
LOGO='''<header>
  <div class="nav-wrap">
    <a href="/" class="logo" aria-label="WanderEngland home">
      <picture>
        <source type="image/webp" srcset="/images/logo-160.webp 160w, /images/logo-320.webp 320w, /images/logo-480.webp 480w" sizes="(max-width: 768px) 150px, 200px">
        <img src="/images/logo.png" alt="WanderEngland" class="logo-img" loading="eager" decoding="async" width="200" height="80">
      </picture>
    </a>
    <nav>
      <a href="/">Home</a>
      <a href="/faq.html">FAQ</a>
      <a href="/blog/">Blog</a>
    </nav>
  </div>
</header>'''
OLD_HEADER='''<header>
  <div class="nav-wrap">
    <a href="/" class="logo">WanderEngland</a>
    <nav>
      <a href="/">Home</a>
      <a href="/faq.html">FAQ</a>
      <a href="/blog/">Blog</a>
    </nav>
  </div>
</header>'''
OLD_CSS='''  header { background: #a0173a; color: white; padding: 16px 20px; }
  header .nav-wrap { max-width: 1200px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; }
  header a { color: white; text-decoration: none; }
  header .logo { font-weight: 700; font-size: 1.2rem; }
  header nav a { margin-left: 18px; opacity: 0.9; }
  header nav a:hover { opacity: 1; text-decoration: underline; }'''
NEW_CSS='''  /* s49-weng-design: header carries the site logo on a white band (network rule); the navy
     logo art clashes with the former crimson band, so the band matches the site header. */
  header { background: #fff; color: #1c3055; padding: 12px 20px; border-bottom: 1px solid #e5e7eb; }
  header .nav-wrap { max-width: 1200px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; }
  header a { color: #1c3055; text-decoration: none; }
  header .logo { display: inline-flex; align-items: center; }
  header .logo-img { height: 80px; width: auto; vertical-align: middle; }
  header nav a { margin-left: 18px; font-weight: 600; opacity: 0.9; }
  header nav a:hover { opacity: 1; text-decoration: underline; }'''
for c in CITIES:
    p=f'{c}.html'
    patch(p,OLD_HEADER,LOGO); patch(p,OLD_CSS,NEW_CSS)
    patch(p,"    header nav a { display: none; }","    header .logo-img { height: 60px; }\n    header nav a { display: none; }")
    # weather block → bottom (after .related, before footer)
    s=open(p,encoding='utf-8').read()
    m=re.search(r'\n<!-- @include partials/weather-'+c+r'\.html -->\n.*?<!-- WEATHER WIDGET END -->\n',s,re.S)
    if not m: sys.exit(f'{p}: weather block not found')
    block=m.group(0)
    if s.count(block)!=1: sys.exit(f'{p}: weather block ambiguous')
    s=s.replace(block,'\n',1)
    # strip the stale placement note inside the block (cambridge/liverpool/oxford carry it)
    block=re.sub(r'\n  Inject between </section> close of hero and <section class="intro">\.','\n  Placed at the bottom of the page (network rule, s49-weng-design).',block)
    anchor='\n<footer class="footer">'
    if s.count(anchor)!=1: sys.exit(f'{p}: footer anchor')
    s=s.replace(anchor,block.rstrip('\n')+'\n'+anchor,1)
    s=s.replace('</section>\n\n\n<section class="intro">','</section>\n\n<section class="intro">')
    open(p,'w',encoding='utf-8').write(s)
# london hero → image-backed
patch('london.html',
 "  .page-hero { background: linear-gradient(135deg, #a0173a 0%, #1c3055 100%); color: white; padding: 80px 20px; text-align: center; }",
 "  /* s49-weng-design: image-backed hero from a repo asset (about-mission.jpg — the City of London skyline from the Thames), translucent original gradient layered for contrast */\n  .page-hero { background: linear-gradient(135deg, rgba(160, 23, 58, 0.72) 0%, rgba(28, 48, 85, 0.72) 100%), url('/images/about-mission.jpg') center/cover no-repeat; color: white; padding: 80px 20px; text-align: center; }")
# tours hero → image-backed; heading; perk text
patch('tours.html',
 "            background: linear-gradient(135deg, var(--ocean-deep), var(--ocean-mid));\n            color: var(--white);\n            text-align: center;",
 "            /* s49-weng-design: image-backed hero from a repo asset (hero-photo-1.jpg — the white cliffs, the brand's own signature image), translucent original gradient layered for contrast */\n            background: linear-gradient(135deg, rgba(10, 77, 104, 0.72), rgba(8, 131, 149, 0.72)), url('images/hero-photo-1.jpg') center/cover no-repeat;\n            color: var(--white);\n            text-align: center;")
patch('tours.html',"<h2>🎁 Exclusive Deals & Local Secrets</h2>","<h2>The England Trip Guide: Deals, Dates and Local Tips</h2>")
patch('tours.html',"Seasonal tour discounts (whale season, summer specials)","Seasonal tour discounts (bank-holiday weekends, summer specials)")
print('applied')
