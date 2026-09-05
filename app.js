// WanderEngland Tours App
// Load tours from JSON and render with descriptions

// Fallback for tour records with no image. Applied at render time, not just via
// onerror: `src="undefined"` costs a real 404 before onerror can rescue it.
// Local + Pexels-licensed; images/ATTRIBUTION.md records source slug
// "white-cliffs-of-dover-under-overcast-sky-36100295",
// which verifies the region from the source URL, not from our own caption.
const FALLBACK_IMAGE = '/images/hero-photo-1.jpg';

let toursData = [];

// Wire the homepage "Verified Tours" stat to the live (non-dead) catalog
// size, replacing the hardcoded value. No-op on pages without the element.
function updateVerifiedToursCount(n) {
    const el = document.getElementById('verified-tours-count');
    if (el) el.textContent = Number(n).toLocaleString();
}

// ===== BOOKING PERFORMANCE OPTIMIZATIONS =====

// 1. URL Caching - Pre-cache FareHarbor URLs for instant clicks
const bookingUrlCache = {};

function cacheBookingUrl(tourId, url) {
    bookingUrlCache[tourId] = {
        url: url,
        cached_at: Date.now()
    };
    try {
        localStorage.setItem('fh_cache_' + tourId, JSON.stringify(bookingUrlCache[tourId]));
    } catch (e) {
        // localStorage full - continue without persistence
    }
}

function getBookingUrl(tourId, fallbackUrl) {
    const cached = bookingUrlCache[tourId];
    if (cached && Date.now() - cached.cached_at < 3600000) {
        return cached.url;
    }
    return fallbackUrl;
}

function preCacheBookingUrls(tours) {
    tours.forEach(tour => {
        if (tour.bookingUrl) {
            cacheBookingUrl(tour.id || tour.name, tour.bookingUrl);
        }
    });
}

// Stable attribution key. 1,052 of 1,424 rows (the pk-only schema) carry no
// `id`; every row carries a unique integer `pk`, and where `id` exists it is
// always String(pk). Without this, data-id rendered "undefined", data-tour-id
// rendered "", and tracking.js's delegated booking_click fell back to the full
// booking URL as tour_id. Legacy id rows are unchanged by construction.
function tourKey(tour) {
    if (tour.id != null && tour.id !== '') return String(tour.id);
    if (Number.isInteger(tour.pk)) return `pk:${tour.pk}`;
    return '';
}

// 2. GA4 Tracking Functions
// NOTE: Renamed from trackBookingClick to avoid shadowing the canonical
// 3-string global (defined in index.html <head> and /tracking.js). This
// enriched form fires on tour-grid clicks where company/price are known.
function trackTourBooking(tour) {
    gtag('event', 'booking_click', {
        tour_id: tourKey(tour),
        tour_name: tour.name,
        island: tour.island,
        price: tour.price || 'unknown',
        company: tour.company,
        event_category: 'conversion'
    });
}

function trackFilterChange(filterType, value) {
    gtag('event', 'filter_used', {
        filter_type: filterType,
        value: value,
        event_category: 'engagement'
    });
}

function trackSearchUsed(searchTerm) {
    gtag('event', 'search_used', {
        query: searchTerm,
        event_category: 'engagement'
    });
}

function trackLoadMoreClick() {
    gtag('event', 'load_more_clicked', {
        event_category: 'engagement'
    });
}

// 3. Loading indicator with optimization
function openBookingWithLoader(url, tour) {
    event && event.preventDefault && event.preventDefault();
    
    // Track the booking click
    if (tour) {
        trackTourBooking(tour);
    }
    
    const loader = document.createElement('div');
    loader.id = 'booking-loader';
    loader.className = 'booking-loader';
    loader.innerHTML = `
        <div class="booking-loader-content">
            <div class="spinner"></div>
            <p>Opening booking...</p>
        </div>
    `;
    document.body.appendChild(loader);
    
    setTimeout(() => loader.style.opacity = '1', 10);
    window.open(url, '_blank', 'noopener,noreferrer');
    
    setTimeout(() => {
        loader.style.opacity = '0';
        setTimeout(() => loader.remove(), 300);
    }, 2500);
}
let filteredTours = [];
let displayedCount = 0;
const TOURS_PER_PAGE = 24;

// Load tours data
async function loadTours() {
    // advertise.html loads app.js but has no #tours-grid. It was downloading the
    // whole of tours-data.json -- megabytes -- rendering none of it, and then
    // throwing in the catch below because there was no grid to write the error
    // into. Nothing to fill, nothing to fetch.
    if (!document.getElementById('tours-grid')) return;
    try {
        console.log('🔄 Fetching tours-data.json...');
        const response = await fetch('tours-data.json');
        console.log(`📥 Response status: ${response.status}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const _raw = await response.json();
        toursData = Array.isArray(_raw) ? _raw : _raw.tours;
        toursData = toursData.filter(t => t.status !== 'inactive' && !t.bookingDead);
        updateVerifiedToursCount(toursData.length);
        console.log(`✅ Loaded ${toursData.length} tours`);
        
        // Initial shuffle for randomization (per-page-load, non-mutating)
        toursData = shuffleArray(toursData);
        filteredTours = [...toursData];
        
        // Pre-cache booking URLs for instant clicks
        preCacheBookingUrls(toursData);
        
        displayedCount = 0;
        renderTours();
        updateResultsCount();
        console.log('✅ Tours rendered successfully');
    } catch (error) {
        console.error('❌ Error loading tours:', error.message);
        const grid = document.getElementById('tours-grid');
        if (grid) grid.innerHTML = `
            <div class="error-state">
                <p>⚠️ Unable to load tours. Please refresh the page.</p>
                <p style="font-size: 12px; color: #666;">Error: ${error.message}</p>
            </div>
        `;
    }
}

// Helper functions
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Pricing unit for the card badge — "per group", "whole boat · up to 4 people".
// Ported verbatim from wanderamsterdam/app.js priceUnit() (WAMS #91, itself from
// keywestsandbartours via wandernewzealand #108): driven ONLY by the explicit
// _unknownFields.priceUnit string — no inference from priceLabel words. Empty for
// every row that does not carry one, so those cards render exactly as they did
// before this existed. formatPrice() is left alone: it answers "what is the number"
// (currency-aware, D-620), this answers "what does the number buy".
function priceUnit(tour) {
    const u = (tour._unknownFields || {}).priceUnit;
    return (typeof u === "string" && u.trim()) ? u.trim() : "";
}

// s46-weng-currency (D-620): a row renders in ITS currency or not at all. No
// conversion, no mixed symbols; a currency outside this map is not rendered.
const CURRENCY_SYMBOL = { GBP: '£', EUR: '€', USD: '$' };

function formatPrice(price, confidence, currency) {
    if (!Number.isFinite(price) || price <= 0) return 'Price on request';
    if (confidence === 'low') return 'Price on request';
    const symbol = CURRENCY_SYMBOL[currency];
    if (!symbol) return 'Price on request';
    return `From ${symbol}${price}`;
}

function cleanLocation(location = '') {
    return location
        .replace(/^United States\/England\//, '')
        .replace(/^England\//, '')
        .trim() || 'England';
}

function scoreLabel(score) {
    if (score >= 90) return 'Top Rated';
    if (score >= 75) return 'Popular';
    return '';
}

// --- s53 schema unit gate ---------------------------------------------------
// A bare Offer.price is read as per-person by the Bing/ChatGPT/Copilot
// ecosystem -- this network's primary conversion channel -- so a private-tour
// or hire/rental row emitted bare misquotes a whole-party or whole-item price
// as a per-person fare. Ruled s52 (network decision): the gate has THREE
// states, derived from the row's own evidence -- _unknownFields.priceUnit
// (the exact string the card renders), priceLabel, and the anchor tier (the
// priceBreakdown tier whose price equals the emitted price). A tier note is
// corroborating only and is never read here.
//   1. per-person affirmatively asserted     -> bare Offer.price, byte-identical
//      to what shipped before this gate existed.
//   2. non-per-person affirmatively asserted -> no bare price; a
//      UnitPriceSpecification whose unitText is the VERBATIM card string (the
//      same field the card reads) -- never a parallel wording. If the card
//      renders no unit string there is nothing to mirror, so no price at all.
//   3. no unit evidence either way -> no price at all. Absence of evidence is
//      not per-person; silence is honest, a guess is not.
// Word lists below are built from this pool's own vocabulary
// (scripts/evidence/s53-weng-schema-gate/vocab-out.txt); every string the
// lists do not reach falls to state 3 -- ambiguity resolves toward silence.

// Classify one evidence string: 'per-person', 'non-per-person', or '' (no
// verdict). Order matters twice: shared/semi-private formats sell seats on
// someone else's booking and must be read BEFORE the exclusivity words they
// contain ("Shared Charter", "Semi-Private Lesson"); and because every string
// containing shared/semi-private/non-private has already returned by then,
// the plain \bprivate\b test below cannot misfire on them.
function classifyUnitText(s) {
    if (typeof s !== 'string' || !s.trim()) return '';
    const SHARED_RE = /\b(?:shared|semi[-\s]?private|non[-\s]?private)\b/i;
    if (SHARED_RE.test(s)) return 'per-person';

    // Whole-unit evidence: exclusivity (incl. Spanish "privado/a"), per-group
    // phrasing, hire/rental duration phrasing (UK "hire" = US "rental"),
    // vessel/vehicle/equipment/craft units this pool actually hires out
    // (kayak, canoe, paddleboard/SUP, raft, boat, pedalo, quad, bike, pitch,
    // saloon/estate/MPV/minivan/minibus/coach), capacity counts ("1-6
    // People", "Up to 40 Guests", "Two-Seater"), and event/party pricing.
    const NON_PER_PERSON_RES = [
        /\bprivate\b/i,
        /\bprivad[oa]s?\b/i,
        /\bcharter(?:s|ed)?\b/i,
        /\bper[\s-]?(?:group|booking|party|boat|couple|family|vehicle|van|unit|hour)\b/i,
        /\bby the hour\b/i,
        /\bwhole\s?(?:unit|boat|vessel|group)\b/i,
        /\bgroup\s?(?:of|size|rate)\b/i,
        /^\s*group\s*$/i,
        // "Group ages 7+" is a whole-group session with an age floor, not a
        // per-participant price (confirmed: single tier, note "up to 16
        // participants"). Deliberately narrow: "Adult (Group)" at the same
        // operator (pk 527431) is a genuine per-person rate for a SHARED
        // departure (as opposed to that tour's separate "Private Group"
        // tiers), and must not match here.
        /\bgroup\s+ages?\s?\d+/i,
        /\bexclusive\b/i,
        /\brentals?\b/i,
        /\bhires?\b/i,
        /\bpax\b/i,
        /\bcouples?\b/i,
        /\b(?:yachts?|cabanas?|umbrellas?|coolers?|(?:e-?)?bikes?|suvs?|vans?|kayaks?|canoes?|paddle\s?boards?|sups?|rafts?|boats?|pedalos?|quads?|pitch(?:es)?|vehicles?|saloon|estate|mpv|minivans?|minibus(?:es)?|coaches?|limousines?|limos?)\b/i,
        /\bseaters?\b/i,
        /\bcar\s*\/\s*truck\b/i,
        /\b(?:wedding|ceremony|proposal|burial at sea|family session)\b/i,
        /\bpackages?\b/i,
        /\d\s*(?:[-–—~]|to)\s*\d+\s*(?:people|persons?|guests?|passengers?|hikers?|anglers?|surfers?)\b/i,
        /\bup\s?to\s+\d+\s*(?:people|persons?|guests?|passengers?)\b/i,
        /\b\d+\s*(?:people|guests|passengers)\b/i,
        /\b\d+\s?(?:passenger|seater)\b/i,
        /\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+to\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:people|persons?|guests?|passengers?)\b/i
    ];
    for (const re of NON_PER_PERSON_RES) {
        if (re.test(s)) return 'non-per-person';
    }

    // Per-person evidence: explicit per-X phrasing, customer-type nouns (incl.
    // this pool's "player"/"paintballer" event-participant nouns, Spanish
    // "adulto/s", and Chinese 成人), age qualifiers, and per-student formats
    // (courses, classes, lessons, camps).
    const PER_PERSON_RES = [
        /\bper[\s-]?(?:person|adult|child|guest|passenger|participant|rider|diver|snorkeler|surfer|student|swimmer|angler|hiker|traveler|golfer|player)\b/i,
        /\/\s?person\b/i,
        /成人/,
        /\b(?:adults?|adultos?|child(?:ren)?|kids?|youth|infants?|seniors?|teens?|juniors?|toddlers?|persons?|people|surfers?|riders?|passengers?|participants?|guests?|students?|hikers?|anglers?|travele?rs?|visitors?|campers?|cyclists?|paddlers?|flyers?|drivers?|swimmers?|individuals?|attendees?|golfers?|players?|paintballers?|seats?|admission|tickets?|pass(?:es)?)\b/i,
        /\bages?\s?\d+/i,
        /\b\d+\s?(?:&|and|or)\s?(?:up|under|over|younger|older)\b/i,
        /^\s*singles?\s*$/i,
        /\b(?:courses?|class(?:es)?|certifications?|camps?|lessons?)\b/i
    ];
    for (const re of PER_PERSON_RES) {
        if (re.test(s)) return 'per-person';
    }
    return '';
}

// Combine the row's three evidence sources into one state. Any whole-unit
// assertion outranks a per-person one: the harm of a wrong bare price (a
// private tour or hire/rental item read as per-person) dwarfs the harm of a
// suppressed one.
function unitStateFromEvidence(tour) {
    const pb = Array.isArray(tour.priceBreakdown) ? tour.priceBreakdown : [];
    const anchor = pb.find(p => p.price === tour.price);
    const verdicts = [
        priceUnit(tour),                        // the string the card renders
        (tour.priceLabel || '').trim(),
        anchor ? (anchor.singular || '').trim() : ''
    ].map(classifyUnitText);
    if (verdicts.includes('non-per-person')) return 'non-per-person';
    if (verdicts.includes('per-person')) return 'per-person';
    return 'none';
}

function generateTourSchema(tour) {
    // Same currency rule as formatPrice(): offers carry the row's own currency verbatim.
    const emitPrice = Number.isFinite(tour.price) && tour.priceConfidence !== 'low'
        && Object.prototype.hasOwnProperty.call(CURRENCY_SYMBOL, tour.currency);
    const state = emitPrice ? unitStateFromEvidence(tour) : 'none';
    const cardUnit = priceUnit(tour);
    return {
        "@context": "https://schema.org",
        "@type": "TouristTrip",
        "name": tour.name,
        "description": tour.description || "",
        "touristType": tour.tags ? tour.tags.join(", ") : "",
        ...(state === 'per-person' && {
            "offers": {
                "@type": "Offer",
                "price": tour.price,
                "priceCurrency": tour.currency,
                "url": tour.bookingUrl,
                "availability": "https://schema.org/InStock"
            }
        }),
        // unitText must mirror the visible card verbatim; a non-per-person row
        // whose card shows no unit string (or whose card string itself reads
        // per-person, a contradiction) has nothing honest to emit, so it emits
        // no price at all.
        ...(state === 'non-per-person' && cardUnit && classifyUnitText(cardUnit) !== 'per-person' && {
            "offers": {
                "@type": "Offer",
                "priceSpecification": {
                    "@type": "UnitPriceSpecification",
                    "price": tour.price,
                    "priceCurrency": tour.currency,
                    "unitText": cardUnit
                },
                "url": tour.bookingUrl,
                "availability": "https://schema.org/InStock"
            }
        }),
        // provider only when the row names one: pk-only rows have no `company`,
        // and JSON.stringify would otherwise emit a nameless LocalBusiness.
        // Deriving a display name from the FareHarbor shortname is deferred —
        // those are slugs, not names.
        ...(tour.company && {
            "provider": {
                "@type": "LocalBusiness",
                "name": tour.company
            }
        })
    };
}

// Fisher-Yates shuffle (non-mutating, per-page-load only — no localStorage)
function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Create tour card HTML
function createTourCard(tour) {
    const tags = tour.tags || [];
    const tagDisplay = tags.slice(0, 3).map(tag =>
        `<span class="tour-tag">${escapeHtml(tag)}</span>`
    ).join(' ');

    const description = tour.description || '';
    const safeDesc = description.replace(/\s+/g, ' ').trim();
    const truncatedDesc = safeDesc.length > 120
        ? safeDesc.substring(0, safeDesc.lastIndexOf(' ', 117)) + '…'
        : safeDesc;

    const score = tour.qualityScore || 0;
    const badge = scoreLabel(score);
    const qualityBadge = badge
        ? `<span class="quality-badge">⭐ ${badge}</span>`
        : '';

    const cleanLoc = cleanLocation(tour.location);
    const priceDisplay = formatPrice(tour.price, tour.priceConfidence, tour.currency);
    const unit = priceUnit(tour);
    const unitHtml = unit ? `<small>${escapeHtml(unit)}</small>` : '';

    const schema = generateTourSchema(tour);
    const schemaJson = JSON.stringify(schema).replace(/<\/script/gi, '<\\/script');

    let badgesHtml = '<div class="tour-badges">';
    if (tour.freeCancellation) {
        badgesHtml += '<span class="trust-badge free-cancel">Free Cancellation</span>';
    }
    badgesHtml += '</div>';

    return `
        <article class="tour-card" data-id="${escapeHtml(tourKey(tour))}">
            <script type="application/ld+json">${schemaJson}</script>
            <div class="tour-image">
                <img src="${tour.image || FALLBACK_IMAGE}" alt="${escapeHtml(tour.name)}" loading="lazy" width="400" height="300" onerror="this.src='${FALLBACK_IMAGE}'" style="width: 100%; height: auto; object-fit: cover;">
                ${qualityBadge}
            </div>
            <div class="tour-content">
                <div class="tour-meta">
                    <span class="tour-location">📍 ${escapeHtml(cleanLoc)}, ${escapeHtml(capitalizeIsland(tour.island))}</span>
                </div>
                <h3 class="tour-title">${escapeHtml(tour.name)}</h3>
                <p class="tour-description">${escapeHtml(truncatedDesc)}</p>
                <div class="tour-tags">${tagDisplay}</div>
                <div class="tour-footer">
                    <div class="tour-price">${priceDisplay}${unitHtml}</div>
                    <a href="${tour.bookingUrl}" target="_blank" rel="noopener" class="tour-book-btn book-now-btn" data-tour-id="${escapeHtml(tourKey(tour))}" data-tour-name="${escapeHtml(tour.name)}" style="text-decoration: none;">Check Availability →</a>
                </div>
            </div>
        </article>
    `;
}

function capitalizeIsland(island) {
    if (!island) return '';
    if (island.toLowerCase() === 'big island') return 'Big Island';
    return island.charAt(0).toUpperCase() + island.slice(1);
}

// Render tours to grid
function renderTours(append = false) {
    const grid = document.getElementById('tours-grid');
    const toursToShow = filteredTours.slice(
        append ? displayedCount : 0, 
        displayedCount + TOURS_PER_PAGE
    );
    
    const html = toursToShow.map(createTourCard).join('');
    
    if (append) {
        grid.insertAdjacentHTML('beforeend', html);
    } else {
        grid.innerHTML = html;
    }

    // The click delegation that used to call openBookingWithLoader was a
    // workaround for the previous <button> markup, which couldn't navigate
    // natively. Now that tour cards render as <a href target="_blank">,
    // navigation happens via the anchor's native click and tracking.js's
    // delegated handler still fires booking_click. No JS handler needed
    // here.

    displayedCount = append
        ? displayedCount + toursToShow.length
        : toursToShow.length;
    
    // Show/hide load more button
    const loadMoreBtn = document.getElementById('load-more');
    if (loadMoreBtn) {
        loadMoreBtn.style.display = displayedCount >= filteredTours.length ? 'none' : 'block';
    }
}

// Load more tours
function loadMoreTours() {
    trackLoadMoreClick();
    renderTours(true);
}

// Update results count
function updateResultsCount() {
    const countEl = document.getElementById('results-count');
    if (countEl) {
        countEl.textContent = `Showing ${Math.min(displayedCount, filteredTours.length)} of ${filteredTours.length} adventures`;
    }
}

// Filter tours
function filterTours() {
    const islandFilter = document.getElementById('island-filter')?.value?.toLowerCase() || '';
    const activityFilter = document.getElementById('activity-filter')?.value || '';
    const sortFilter = document.getElementById('sort-filter')?.value || 'quality';
    const searchInput = document.getElementById('search-input')?.value?.toLowerCase() || '';
    
    // Track filter usage
    if (islandFilter) trackFilterChange('island', islandFilter);
    if (activityFilter) trackFilterChange('activity', activityFilter);
    if (searchInput) trackSearchUsed(searchInput);
    
    filteredTours = toursData.filter(tour => {
        // Island filter
        if (islandFilter && tour.island?.toLowerCase() !== islandFilter) {
            return false;
        }
        
        // Activity filter
        if (activityFilter && !tour.tags?.includes(activityFilter)) {
            return false;
        }
        
        // Search filter
        if (searchInput) {
            const searchFields = [
                tour.name,
                tour.company,
                tour.location,
                tour.description,
                ...(tour.tags || [])
            ].join(' ').toLowerCase();
            
            if (!searchFields.includes(searchInput)) {
                return false;
            }
        }
        
        return true;
    });
    
    // Sort
    if (sortFilter === 'quality') {
        filteredTours.sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0));
    } else if (sortFilter === 'name') {
        filteredTours.sort((a, b) => a.name.localeCompare(b.name));
    }
    
    displayedCount = 0;
    renderTours();
    updateResultsCount();
}

// Shuffle visible tours
function shuffleTours() {
    filteredTours = shuffleArray(filteredTours);
    displayedCount = 0;
    renderTours();
}

// Clear all filters
function clearAllFilters() {
    const islandFilter = document.getElementById('island-filter');
    const activityFilter = document.getElementById('activity-filter');
    const sortFilter = document.getElementById('sort-filter');
    const searchInput = document.getElementById('search-input');
    
    if (islandFilter) islandFilter.value = '';
    if (activityFilter) activityFilter.value = '';
    if (sortFilter) sortFilter.value = 'quality';
    if (searchInput) searchInput.value = '';
    
    filterTours();
}

// Quick filter from tags/buttons
function quickFilter(term) {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = term;
    }
    filterTours();
    
    // Scroll to tours section
    document.getElementById('tours-section')?.scrollIntoView({ behavior: 'smooth' });
}

// Hero search
function executeHeroSearch() {
    const heroSearch = document.getElementById('hero-search');
    if (heroSearch?.value) {
        quickFilter(heroSearch.value);
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    loadTours();
    
    // Filter change listeners
    document.getElementById('island-filter')?.addEventListener('change', () => {
        const val = document.getElementById('island-filter').value;
        if (val) trackFilterChange('island', val);
        filterTours();
    });
    document.getElementById('activity-filter')?.addEventListener('change', () => {
        const val = document.getElementById('activity-filter').value;
        if (val) trackFilterChange('activity', val);
        filterTours();
    });
    document.getElementById('sort-filter')?.addEventListener('change', () => {
        const val = document.getElementById('sort-filter').value;
        if (val) trackFilterChange('sort', val);
        filterTours();
    });
    
    // Search input with debounce
    let searchTimeout;
    document.getElementById('search-input')?.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(filterTours, 300);
    });
    
    // Hero search enter key
    document.getElementById('hero-search')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            executeHeroSearch();
        }
    });
});

// Mobile menu toggle
document.querySelector('.mobile-menu-btn')?.addEventListener('click', function() {
    document.querySelector('.nav-mobile')?.classList.toggle('active');
    this.classList.toggle('active');
});

// FOMO notifications - DISABLED
// These fake notifications were removed to improve user trust
// Users should see real booking confirmations only

// Weather widget
async function loadWeather() {
    const CACHE_KEY = 'wx-cache-weng';
    const TTL_MS = 10 * 60 * 1000;
    const weatherEl = document.getElementById('header-weather');
    if (!weatherEl) return;
    try {
        const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
        if (cached && Date.now() - cached.ts < TTL_MS) {
            weatherEl.querySelector('.weather-temp').textContent = `${cached.temp}°C`;
            return;
        }
        const response = await fetch('https://api.open-meteo.com/v1/forecast?latitude=51.51&longitude=-0.13&current_weather=true&temperature_unit=celsius');
        const data = await response.json();
        const temp = Math.round(data.current_weather.temperature);
        weatherEl.querySelector('.weather-temp').textContent = `${temp}°C`;
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ temp, ts: Date.now() }));
    } catch (error) {
        // Silent fail
    }
}

loadWeather();

// Promo Banner
function closeBanner() {
    const banner = document.getElementById('promo-banner');
    if (banner) {
        banner.classList.add('hidden');
        sessionStorage.setItem('promoBannerClosed', 'true');
    }
}

// Check if banner was closed this session
if (sessionStorage.getItem('promoBannerClosed') === 'true') {
    document.addEventListener('DOMContentLoaded', () => {
        const banner = document.getElementById('promo-banner');
        if (banner) banner.classList.add('hidden');
    });
}

// ===== STICKY MOBILE CTA BAR =====
document.addEventListener('DOMContentLoaded', () => {
    const stickyBar = document.getElementById('sticky-cta-bar');
    if (!stickyBar) return;
    
    const heroSection = document.querySelector('.hero') || document.querySelector('.tours-section');
    let heroScrolled = false;
    
    window.addEventListener('scroll', () => {
        const scrolled = window.scrollY > (heroSection?.offsetHeight || 300);
        
        if (scrolled && !heroScrolled) {
            stickyBar.classList.add('visible');
            heroScrolled = true;
        } else if (!scrolled && heroScrolled) {
            stickyBar.classList.remove('visible');
            heroScrolled = false;
        }
    });
    
    const ctaButton = stickyBar.querySelector('button');
    if (ctaButton) {
        ctaButton.addEventListener('click', () => {
            const toursGrid = document.getElementById('tours-grid');
            if (toursGrid) {
                toursGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    }
});
