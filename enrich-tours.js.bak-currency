#!/usr/bin/env node
/**
 * Full enrichment scraper - extracts price + description + duration + capacity + galleryImages + highlights
 *
 * Use for: sites with tours-data.json that has bookingLinks but no descriptions/prices
 * (Amsterdam, England, New Zealand, Puerto Rico initial fill)
 *
 * Usage:
 *   node enrich-tours.js                            # USD, full pass
 *   node enrich-tours.js --currency EUR --limit 50  # EUR test on first 50
 *   node enrich-tours.js --skip-existing            # skip tours that already have description+price
 */

const fs = require('fs');
const { chromium } = require('playwright');
const { extract_price } = require('./extract-price-v5');

const INPUT_FILE = 'tours-data.json';
const OUTPUT_FILE = 'tours-data-enriched.json';

const args = process.argv.slice(2);
const LIMIT = args.includes('--limit')
  ? parseInt(args[args.indexOf('--limit') + 1], 10)
  : Infinity;
const SKIP_EXISTING = args.includes('--skip-existing');

const currencyArg = args.find((a, i) => args[i-1] === '--currency');
const CURRENCY = currencyArg || 'USD';
const VALID_CURRENCIES = ['USD', 'EUR', 'GBP', 'NZD'];
if (!VALID_CURRENCIES.includes(CURRENCY)) {
  console.error(`Invalid currency: ${CURRENCY}. Must be one of: ${VALID_CURRENCIES.join(', ')}`);
  process.exit(1);
}
console.log(`Currency: ${CURRENCY}`);

async function extractTourFields(page) {
  // Run all extractions in a single browser-side evaluation for efficiency
  return await page.evaluate(() => {
    const result = {
      pageText: document.body.innerText,
      description: null,
      duration: null,
      capacity: null,
      galleryImages: [],
      highlights: []
    };

    // Description: Look for the main article/content section
    // FareHarbor structure: main > article contains the tour body
    const article = document.querySelector('main article') || document.querySelector('article') || document.querySelector('main');
    if (article) {
      // Try to find a "Description" or "About" section header, grab content after it
      const articleText = article.innerText || '';
      const descMatch = articleText.match(/(?:Description|About this (?:tour|experience|activity))\s*\n+([\s\S]{50,2000}?)(?=\n\n[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s*\n|$)/i);
      if (descMatch) {
        result.description = descMatch[1].trim();
      } else {
        // Fallback: take first 1500 chars of article text after stripping headers
        const cleaned = articleText.replace(/^\s*\S+.*\n+/g, '').trim();
        if (cleaned.length > 80) {
          result.description = cleaned.substring(0, 1500).trim();
        }
      }
    }

    // Duration: regex match in page text
    const durMatch = result.pageText.match(/Duration[:\s]+(\d+(?:\.\d+)?\s*(?:hours?|hrs?|minutes?|mins?|days?)(?:\s+(?:and|&)\s+\d+\s*(?:minutes?|mins?))?)/i);
    if (durMatch) result.duration = durMatch[1].trim();

    // Capacity: regex match
    const capMatch = result.pageText.match(/(?:Capacity|Group size|Max(?:imum)?\s+(?:guests?|people|participants?))[:\s]+(?:Up to\s+)?(\d+)/i);
    if (capMatch) result.capacity = parseInt(capMatch[1], 10);

    // Gallery images: collect <img> sources from the article, filter to FareHarbor CDN
    if (article) {
      const imgs = [...article.querySelectorAll('img')];
      result.galleryImages = imgs
        .map(img => img.src || img.getAttribute('data-src'))
        .filter(src => src && (src.includes('fareharbor.com') || src.includes('fareharborcdn.com') || src.includes('cloudfront')))
        .filter(src => !src.includes('logo') && !src.includes('icon'))
        .filter((v, i, a) => a.indexOf(v) === i) // dedupe
        .slice(0, 12);
    }

    // Highlights: look for bulleted lists in the article (li elements or "•" patterns)
    if (article) {
      const lis = [...article.querySelectorAll('li')]
        .map(li => (li.innerText || '').trim())
        .filter(t => t.length > 10 && t.length < 200)
        .slice(0, 8);
      result.highlights = lis;
    }

    return result;
  });
}

async function main() {
  const data = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  const tours = Array.isArray(data) ? data : (data.tours || []);

  const targets = tours
    .filter(t => t.url || t.fareharborUrl || t.bookingUrl || t.bookingLink)
    .filter(t => !SKIP_EXISTING || (!t.description || !t.price))
    .slice(0, LIMIT);

  console.log(`Enriching ${targets.length} tours...`);

  const browser = await chromium.launch({ headless: true });
  const browserContext = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });

  const stats = {
    high: 0, medium: 0, low: 0, none: 0, errors: 0,
    descGood: 0, descMissing: 0,
    durationFound: 0, capacityFound: 0,
    galleryFound: 0, highlightsFound: 0
  };

  for (let i = 0; i < targets.length; i++) {
    const tour = targets[i];
    const url = tour.url || tour.fareharborUrl || tour.bookingUrl || tour.bookingLink;
    try {
      const page = await browserContext.newPage();
      await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3500);
      await page.waitForSelector('text=/Adults?|Pricing|Description|About/i', { timeout: 5000 }).catch(() => {});

      const fields = await extractTourFields(page);
      await page.close();

      // Apply extracted fields to tour
      const { price, priceConfidence, priceLabel } = extract_price(fields.pageText, CURRENCY);
      tour.price = price;
      tour.priceConfidence = priceConfidence;
      tour.priceLabel = priceLabel;

      if (fields.description) {
        tour.description = fields.description;
        stats.descGood++;
      } else {
        stats.descMissing++;
      }

      if (fields.duration) { tour.duration = fields.duration; stats.durationFound++; }
      if (fields.capacity) { tour.capacity = fields.capacity; stats.capacityFound++; }
      if (fields.galleryImages.length > 0) {
        tour.galleryImages = fields.galleryImages;
        stats.galleryFound++;
      }
      if (fields.highlights.length > 0) {
        tour.highlights = fields.highlights;
        stats.highlightsFound++;
      }

      if (priceConfidence) stats[priceConfidence]++;
      else stats.none++;

      if ((i + 1) % 25 === 0) {
        console.log(`  [${i + 1}/${targets.length}] price[h:${stats.high} m:${stats.medium} l:${stats.low} ø:${stats.none}] desc:${stats.descGood} dur:${stats.durationFound} cap:${stats.capacityFound} gal:${stats.galleryFound}`);
      }
    } catch (err) {
      stats.errors++;
      tour.scrapeError = err.message.slice(0, 200);
    }
  }

  await browser.close();

  const finalOutput = Array.isArray(data) ? tours : { ...data, tours };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalOutput, null, 2));

  console.log('\n✓ Enrichment complete');
  console.log(`  Price:        high:${stats.high} med:${stats.medium} low:${stats.low} none:${stats.none}`);
  console.log(`  Description:  found ${stats.descGood}, missing ${stats.descMissing}`);
  console.log(`  Duration found:    ${stats.durationFound}`);
  console.log(`  Capacity found:    ${stats.capacityFound}`);
  console.log(`  Gallery found:     ${stats.galleryFound}`);
  console.log(`  Highlights found:  ${stats.highlightsFound}`);
  console.log(`  Errors:            ${stats.errors}`);
  console.log(`\nOutput: ${OUTPUT_FILE}`);
  console.log(`\nNext: spot-check, then mv ${OUTPUT_FILE} ${INPUT_FILE}`);
}

main().catch(e => { console.error(e); process.exit(1); });
