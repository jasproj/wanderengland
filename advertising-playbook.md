# Wander Sites Advertising Playbook
## Site Factory Marketing Gameplan

**Created:** December 29, 2025  
**Based on:** WanderHawaii.com launch campaign  
**Author:** Claude + Jason  

---

## Executive Summary

This playbook documents the complete advertising and analytics setup for WanderHawaii.com. Use it to replicate the process for new market sites (WanderPuertoRico, FloridaSandbarTours, KeyWestSandbarTours, etc.).

**Business Model:**
- FareHarbor affiliate (20% commission)
- Average tour: ~$150 → $30 commission per sale
- Break-even: 2.4% conversion rate at $0.72 CPC
- Primary revenue: Organic SEO (long-term) + Paid ads (learning/scale)

---

## Part 1: Pre-Launch Checklist

### 1.1 Required Accounts (per site)
Create dedicated email for each market: `[sitename]tours@gmail.com`

| Service | Account |
|---------|---------|
| Google Ads | sitename@gmail.com |
| GA4 Analytics | sitename@gmail.com |
| Google Search Console | sitename@gmail.com |
| Bing Webmaster Tools | sitename@gmail.com |

**Important:** Keep all services on the SAME email per site to ensure proper linking.

### 1.2 Files Needed Before Ads
- [ ] All HTML pages with GA4 tracking code
- [ ] sitemap.xml
- [ ] robots.txt
- [ ] Logo and favicon
- [ ] Tour data JSON loaded

---

## Part 2: GA4 Analytics Setup

### 2.1 Create GA4 Property
1. Go to analytics.google.com
2. Create new property for the site
3. Get Measurement ID (format: G-XXXXXXXXXX)

### 2.2 Install Tracking Code
Add this to `<head>` section of EVERY HTML page (index, island pages, about, etc.):

```html
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

**Place immediately after `<head>` tag, before any other content.**

### 2.3 Verify Tracking
1. Deploy site with GA4 code
2. Open site in browser
3. GA4 → Realtime overview
4. You should see yourself as active user
5. If not showing, tracking is broken

### 2.4 Enable Enhanced Measurement
1. GA4 → Admin → Data Streams
2. Click your stream
3. Enhanced measurement → ON
4. Verify "Outbound clicks" is enabled (tracks FareHarbor clicks)

---

## Part 3: Google Ads Setup

### 3.1 Campaign Creation

**Campaign Type:** Search (NOT Display, NOT Performance Max)

**Goal:** Purchases → "Set up manually using code after you create the campaign"

**Bid Strategy:** Maximize Clicks
- Set max CPC bid limit: $2.50
- Adjust up to $3.50 if not getting impressions

**Budget:** $10/day
- Allows 30 days of learning on $300
- Scale up only after proving conversions

### 3.2 Keyword Strategy

**Formula:** [Activity] + [Location]

**Pattern for any market:**
```
[activity] [location]
things to do in [location]
[location] tours
best [activity] in [location]
[specific attraction] tours
```

**Example - Hawaii:**
- things to do in Maui
- Oahu tours
- whale watching big island
- snorkeling Molokini
- Pearl Harbor tours

**Example - Puerto Rico:**
- things to do in San Juan
- Puerto Rico tours
- bioluminescent bay tour
- El Yunque rainforest tours
- Old San Juan walking tour

**Example - Key West:**
- things to do in Key West
- Key West tours
- sandbar tours Key West
- snorkeling Key West
- sunset sail Key West

### 3.3 Negative Keywords (Add Immediately)

These waste budget on wrong-intent searches:

```
packages
all inclusive
vacation packages
holiday packages
tour package
trip package
honeymoon
flights
hotels
cheap
free
from india
from south africa
```

### 3.4 Headlines (15 required, 30 char max each)

**Template - adapt per market:**
```
Explore [Location] Tours
Book [Location] Adventures
Top-Rated [Location] Tours
[Number]+ [Location] Tours
Find Your Perfect Tour
Book Today, Save Time
Compare Local Operators
Trusted [Location] Tours
Adventures Await
[Activity] Tours [Location]
Plan Your [Location] Trip
Support Local Operators
Book Direct & Save
Instant Confirmation
[Location] Tour Experts
```

### 3.5 Descriptions (4 required, 90 char max each)

**Template:**
```
Browse [number]+ tours across [location]. Book your adventure with local operators today.

Compare top-rated local operators. [Activity 1], [Activity 2], [Activity 3] & more.

Find the perfect [location] tour in minutes. Trusted operators, easy booking.

Your [location] adventure starts here. Explore every activity. Book with confidence.
```

### 3.6 Sitelinks (4 required)

**Format:**
| Text | Description 1 | Description 2 | URL |
|------|--------------|---------------|-----|
| [Area 1] Tours | [Activities] | [Tagline] | /[area-1].html |
| [Area 2] Tours | [Activities] | [Tagline] | /[area-2].html |
| [Area 3] Tours | [Activities] | [Tagline] | /[area-3].html |
| [Area 4] Tours | [Activities] | [Tagline] | /[area-4].html |

**Critical:** Use exact URLs with .html extension for GitHub Pages sites.

### 3.7 Callouts (6 recommended)

**Template:**
```
[Number]+ [Location] Tours
Book Direct & Save
Top Local Operators
Easy Online Booking
Free to Browse
Instant Confirmation
```

---

## Part 4: Link GA4 ↔ Google Ads

**Critical step — do this BEFORE launching ads.**

1. GA4 → Admin → Product Links → Google Ads Links
2. Click "Link"
3. Choose Google Ads accounts → Select your account
4. Confirm
5. Configure settings:
   - Enable Personalized Advertising: ON
   - Enable Auto-Tagging: ON
   - Allow access to Analytics features: ON
6. Submit

**Verify:** Takes 24 hours. Then GA4 will show "google / cpc" as traffic source.

---

## Part 5: Google Search Console Setup

### 5.1 Add Property
1. Go to search.google.com/search-console
2. Add property → URL prefix
3. Enter: `https://[yoursite].com`
4. Verify (should auto-verify via GA4)

### 5.2 Submit Sitemap
1. Left sidebar → Sitemaps
2. Enter: `sitemap.xml`
3. Submit

### 5.3 Sitemap Template

Create `sitemap.xml` in root directory:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://[yoursite].com/</loc>
    <lastmod>2025-12-29</lastmod>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://[yoursite].com/[area-1].html</loc>
    <lastmod>2025-12-29</lastmod>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://[yoursite].com/[area-2].html</loc>
    <lastmod>2025-12-29</lastmod>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://[yoursite].com/[area-3].html</loc>
    <lastmod>2025-12-29</lastmod>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://[yoursite].com/about.html</loc>
    <lastmod>2025-12-29</lastmod>
    <priority>0.5</priority>
  </url>
</urlset>
```

---

## Part 6: Campaign Management

### 6.1 Daily Monitoring (First Week)
- Check Search terms report for irrelevant queries
- Add negative keywords as needed
- Watch CPC trends (should decrease over time)

### 6.2 Weekly Review
Export and analyze:
- Time series (daily spend, clicks, CPC)
- Search keywords (which are performing)
- Search queries (actual searches triggering ads)
- Devices (mobile vs desktop)
- Demographics (age, gender)

### 6.3 Key Metrics to Track

| Metric | Target | Action if Below |
|--------|--------|-----------------|
| CTR | >3% | Improve headlines, add negatives |
| CPC | <$1.50 | Lower max CPC bid |
| Conversion Rate | >2.4% | Improve landing pages |
| Bounce Rate | <60% | Check page load speed, mobile UX |

### 6.4 When to Pause Keywords
- 50+ impressions, 0 clicks → Pause
- 20+ clicks, CTR <1% → Pause
- CPC >$3 consistently → Pause or lower bid

### 6.5 When to Scale Budget
- Conversion rate >2.4%
- Positive ROI for 2+ weeks
- Then increase budget by 25% increments

---

## Part 7: Troubleshooting

### Problem: GA4 not tracking visitors
**Cause:** Tracking code missing or malformed
**Fix:** Verify code is in `<head>` of ALL pages, redeploy

### Problem: Sitelinks disapproved ("Destination not working")
**Cause:** Wrong URLs (e.g., `/maui-tours` instead of `/maui.html`)
**Fix:** Use exact URLs matching your file structure

### Problem: No impressions
**Cause:** Bid too low or keywords too narrow
**Fix:** Increase max CPC to $3.50, broaden keywords

### Problem: High CPC (>$2)
**Cause:** Competitive keywords
**Fix:** Focus on long-tail keywords, add more specific terms

### Problem: Clicks but no conversions
**Cause:** Wrong traffic or poor landing page
**Fix:** Check search queries for intent, improve page UX

---

## Part 8: Market-Specific Templates

### Puerto Rico Keywords
```
things to do in San Juan
Puerto Rico tours
bioluminescent bay tour
El Yunque rainforest tours
Old San Juan tours
Culebra island tours
Flamenco Beach tours
snorkeling Puerto Rico
kayak bio bay
Vieques tours
```

### Key West Keywords
```
things to do in Key West
Key West tours
sandbar tours Key West
snorkeling Key West
sunset sail Key West
jet ski Key West
parasailing Key West
fishing charters Key West
Key West boat tours
Dry Tortugas tour
```

### Florida/Everglades Keywords
```
Everglades tours
airboat tours Florida
Everglades airboat rides
Miami Everglades tour
alligator tours Florida
Everglades National Park tours
swamp tours Florida
wildlife tours Everglades
Everglades kayak tours
10000 Islands tours
```

---

## Part 9: Launch Checklist

Use this for each new site:

### Pre-Launch
- [ ] Create dedicated Gmail account
- [ ] Set up GA4 property
- [ ] Add GA4 code to ALL HTML pages
- [ ] Verify tracking in Realtime
- [ ] Enable Enhanced Measurement
- [ ] Create sitemap.xml
- [ ] Deploy to GitHub Pages

### Google Ads Setup
- [ ] Create Google Ads account
- [ ] Link GA4 ↔ Google Ads
- [ ] Create Search campaign
- [ ] Set bid strategy: Maximize Clicks
- [ ] Set max CPC: $2.50
- [ ] Set budget: $10/day
- [ ] Add 20-30 keywords
- [ ] Add negative keywords
- [ ] Write 15 headlines
- [ ] Write 4 descriptions
- [ ] Add 4 sitelinks (with correct URLs!)
- [ ] Add 6 callouts

### Search Console
- [ ] Add property
- [ ] Verify ownership
- [ ] Submit sitemap

### Post-Launch (24-48 hours)
- [ ] Verify ads approved
- [ ] Verify sitelinks approved
- [ ] Check GA4 showing "google / cpc" traffic
- [ ] Review search terms, add negatives

---

## Part 10: ROI Calculation

### The Math
```
Commission Rate: 20%
Average Tour Price: $150
Commission per Sale: $30

Target CPC: $0.75
Break-even Clicks per Sale: 40
Break-even Conversion Rate: 2.5%

Example:
- $10/day budget = ~13 clicks/day
- 2.5% conversion = 1 sale every 3 days
- Revenue: $30 every 3 days = $10/day
- Break-even at $10/day spend
```

### Profitability Threshold
To profit on paid ads:
- Conversion rate must exceed 2.5%, OR
- CPC must drop below $0.75, OR
- Average order value must increase

### Long-Term Strategy
- Paid ads: Learning + Scale (break-even is OK)
- Organic SEO: Profit center (free traffic)
- Premium partnerships: $200-500/month per operator

---

## Appendix: WanderHawaii Results (First 3 Days)

| Metric | Value |
|--------|-------|
| Spend | $35.39 |
| Clicks | 49 |
| Impressions | 1,316 |
| CTR | 3.7% |
| Avg CPC | $0.72 |
| Conversions | 0 (tracking was broken) |

**Top Keywords:**
1. things to do in Oahu (13 clicks, $0.76 CPC)
2. things to do in Maui (11 clicks, $0.76 CPC)
3. hawaii adventures (10 clicks, $0.78 CPC)
4. Kauai tours (3 clicks, 18.75% CTR!)

**Devices:** 88% mobile, 12% desktop

---

## Contact & Resources

- FareHarbor Affiliate Dashboard: [affiliate.fareharbor.com]
- Google Ads: ads.google.com
- GA4: analytics.google.com
- Search Console: search.google.com/search-console

---

*This playbook is a living document. Update with learnings from each market launch.*
