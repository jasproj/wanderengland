import re,json,hashlib,subprocess,os
from html.parser import HTMLParser
from urllib.parse import urljoin,urlparse
EV='scripts/evidence/s49-weng-design'; PAGES=['london.html','cambridge.html','liverpool.html','oxford.html','tours.html']; CITIES=PAGES[:4]
tracked=set(subprocess.run(['git','ls-files'],capture_output=True,text=True).stdout.split('\n'))
class P(HTMLParser):
    def __init__(s): super().__init__(); s.refs=[]; s.err=None; s.tags=[]
    def handle_starttag(s,t,a):
        s.tags.append(t); a=dict(a)
        for k in ('src','srcset','href'):
            if k in a and a[k]:
                for part in (a[k].split(',') if k=='srcset' else [a[k]]): s.refs.append((t,k,part.strip().split(' ')[0]))
v={'pages':{},'PASS':True}
def fail(page,msg): v['PASS']=False; v['pages'][page].setdefault('failures',[]).append(msg)
before={p:subprocess.run(['git','show',f'origin/main:{p}'],capture_output=True,text=True).stdout for p in PAGES}
for p in PAGES:
    s=open(p,encoding='utf-8').read(); pr=P(); pr.feed(s); v['pages'][p]={'parsed':True,'tags':len(pr.tags)}
    # every local image/css/js ref + css url() resolves to a tracked file
    refs=[r for _,k,r in pr.refs if k in('src','srcset')]+re.findall(r"url\('?\"?([^'\")]+)'?\"?\)",s)
    local=[r for r in refs if not r.startswith(('http','data:','//','#','mailto:'))]
    unresolved=[]
    for r in local:
        path=urlparse(urljoin('/'+p,r)).path.lstrip('/')
        if path not in tracked: unresolved.append(r)
    v['pages'][p]['localRefs']=len(local); v['pages'][p]['unresolvedRefs']=unresolved
    if unresolved: fail(p,f'unresolved refs {unresolved}')
    if '</body>' not in s or s.count('<header')!=1 or s.count('</header>')!=1: fail(p,'structure')
# header byte-identity across the 4 city pages
hdr=lambda s: re.search(r'<header>.*?</header>',s,re.S).group(0)
hs={p:hashlib.sha256(hdr(open(p,encoding='utf-8').read()).encode()).hexdigest() for p in CITIES}
v['cityHeaderSha']=hs; v['cityHeaderIdentical']=len(set(hs.values()))==1
if not v['cityHeaderIdentical']: v['PASS']=False
v['cityHeaderHasLogoPicture']=all('<picture>' in hdr(open(p,encoding='utf-8').read()) and 'logo-480.webp' in hdr(open(p,encoding='utf-8').read()) for p in CITIES)
v['cityHeaderCssWhiteBand']=all('header { background: #fff;' in open(p,encoding='utf-8').read() and '#a0173a; color: white; padding: 16px' not in open(p,encoding='utf-8').read() for p in CITIES)
if not (v['cityHeaderHasLogoPicture'] and v['cityHeaderCssWhiteBand']): v['PASS']=False
# hero rules: labelled static cascade — the rule text that applies to the hero selector must carry url(
def rule(s,sel): m=re.search(re.escape(sel)+r'\s*\{([^}]*)\}',s); return m.group(1) if m else ''
v['hero']={}
for p,sel,img in [('london.html','.page-hero','about-mission.jpg'),('tours.html','.tours-browse-hero','hero-photo-1.jpg')]:
    r=rule(open(p,encoding='utf-8').read(),sel); ok='url(' in r and img in r and 'linear-gradient' in r
    v['hero'][p]={'selector':sel,'urlInRule':'url(' in r,'image':img,'ok':ok,'method':'static cascade (page-local <style>), Chrome dark'}
    if not ok: fail(p,'hero rule')
for p in ['cambridge.html','liverpool.html','oxford.html']:
    r=rule(open(p,encoding='utf-8').read(),'.page-hero'); v['hero'][p]={'selector':'.page-hero','urlInRule':'url(' in r,'skipped':'no local photo in repo — flagged for sourcing','unchangedFromMain':rule(before[p],'.page-hero')==r}
    if 'url(' in r or not v['hero'][p]['unchangedFromMain']: fail(p,'skipped hero changed')
# weather block: bytes identical (modulo the placement-note line) and now at the bottom
v['weather']={}
for p in CITIES:
    c=p[:-5]; pat=r'<!-- @include partials/weather-'+c+r'\.html -->\n.*?<!-- WEATHER WIDGET END -->'
    b=re.search(pat,before[p],re.S).group(0); a=re.search(pat,open(p,encoding='utf-8').read(),re.S)
    a=a.group(0) if a else ''
    norm=lambda x: re.sub(r'\n  (Inject between </section> close of hero and <section class="intro">|Placed at the bottom of the page \(network rule, s49-weng-design\))\.','',x)
    s=open(p,encoding='utf-8').read(); pos=s.find('<!-- WEATHER WIDGET START -->'); ok=(norm(a)==norm(b) and pos>s.find('<section class="related">') and pos<s.find('<footer class="footer">') and pos>s.find('<section class="tours">'))
    v['weather'][p]={'bytesIdenticalModuloNote':norm(a)==norm(b),'afterRelatedBeforeFooter':ok}
    if not ok: fail(p,'weather placement')
# copy: heading + perk + banned words on the deals section
t=open('tours.html',encoding='utf-8').read(); deals=re.search(r'<section class="deals-section">.*?</section>',t,re.S).group(0)
BANNED=["once-in-a-lifetime","world-class","hidden gem","must-see","breathtaking","unforgettable","stunning","awaits","paradise"]
v['copy']={'heading':'The England Trip Guide: Deals, Dates and Local Tips' in deals and 'Exclusive Deals' not in t,'perk':'(bank-holiday weekends, summer specials)' in deals and 'whale season' not in deals,'bannedHits':[w for w in BANNED if w in deals.lower()]}
if not (v['copy']['heading'] and v['copy']['perk'] and not v['copy']['bannedHits']): v['PASS']=False
# price/offer surface untouched
shas={f:hashlib.sha256(open(f,'rb').read()).hexdigest() for f in ['tours-data.json','app.js','styles.css']}
v['dataAndRendererSha']=shas; v['dataAndRendererUnchanged']=shas==({k:x for k,x in json.load(open(f'{EV}/sha-before.json')).items() if k in shas})
if not v['dataAndRendererUnchanged']: v['PASS']=False
# JSON-LD on the 5 pages byte-identical (price/offer surface in static pages)
for p in PAGES:
    ld=lambda s: re.findall(r'<script type="application/ld\+json">.*?</script>',s,re.S)
    same=ld(before[p])==ld(open(p,encoding='utf-8').read()); v['pages'][p]['jsonLdIdentical']=same
    if not same: fail(p,'json-ld changed')
v['sha_after']={p:hashlib.sha256(open(p,'rb').read()).hexdigest() for p in PAGES}
json.dump(v,open(f'{EV}/verify.json','w'),indent=1); print(json.dumps({k:v[k] for k in v if k not in('sha_after','dataAndRendererSha','cityHeaderSha')},indent=1))
