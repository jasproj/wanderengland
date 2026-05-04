/* ============================================================
   sponsor-slot.js
   Reusable ad/sponsor slot component for the wander/tour network.
   Loaded site-wide via <script src="/sponsor-slot.js" defer></script>.

   Three fill modes, evaluated in priority order per slot:
     1. Direct sponsor   — paid placement from /sponsors.json (highest)
     2. House ad         — internal cross-promo from /house-ads.json
     3. AdSense fallback — only if data-allow-adsense="true" AND
                           data-adsense-slot is set on the slot div

   CLS-safe: every slot's reserved height is set in CSS (sponsor-slot.css)
   based on data-slot-type. Height is reserved before any JS runs so a
   slow JSON fetch never causes layout shift.

   GA4: fires `sponsor_click` events via document-level click delegation
   on any anchor with [data-sponsor-id]. Mirrors the existing
   tracking.js pattern used network-wide for booking_click.

   Slot types & dimensions:
     mobile-banner  320×50   (mobile only — hidden on >=768px)
     leaderboard    728×90   (desktop only — hidden on <768px)
     mrec           300×250  (responsive — sidebar / in-content)
     native         responsive image+headline+CTA card

   Public API:
     SponsorSlot.init()                 // auto-discover & populate
     SponsorSlot.refresh(slotId)        // re-pick + re-render one slot
     SponsorSlot.trackClick(id, sponsorId, fillMode)  // manual tracking
   ============================================================ */

(function (window, document) {
  'use strict';

  // ─── Configuration ──────────────────────────────────────────
  var ADSENSE_PUB_ID = 'ca-pub-6156669175458913';
  var SPONSORS_URL = '/sponsors.json';
  var HOUSE_ADS_URL = '/house-ads.json';
  var MOBILE_BREAKPOINT = 768;

  // Slot type → behavior. Heights live in sponsor-slot.css so CLS
  // protection is effective even before this script runs.
  var SLOT_BEHAVIOR = {
    'mobile-banner': { mobileOnly: true,  hideOnMobile: false },
    'leaderboard':   { mobileOnly: false, hideOnMobile: true  },
    'mrec':          { mobileOnly: false, hideOnMobile: false },
    'native':        { mobileOnly: false, hideOnMobile: false },
  };

  // ─── State ──────────────────────────────────────────────────
  var sponsors = null;
  var houseAds = null;
  var configPromise = null;
  var adsenseLibInjected = false;

  function isMobile() {
    return window.innerWidth < MOBILE_BREAKPOINT;
  }

  function currentPagePath() {
    var p = (window.location.pathname || '/').split('/').pop() || 'index.html';
    return p;
  }

  // ─── Config loading ─────────────────────────────────────────
  function loadConfig() {
    if (configPromise) return configPromise;
    configPromise = Promise.all([
      fetch(SPONSORS_URL, { cache: 'no-cache' }).then(function (r) {
        return r.ok ? r.json() : { sponsors: [] };
      }).catch(function () { return { sponsors: [] }; }),
      fetch(HOUSE_ADS_URL, { cache: 'no-cache' }).then(function (r) {
        return r.ok ? r.json() : { house_ads: [] };
      }).catch(function () { return { house_ads: [] }; }),
    ]).then(function (results) {
      sponsors = (results[0] && results[0].sponsors) || [];
      houseAds = (results[1] && results[1].house_ads) || [];
    });
    return configPromise;
  }

  // ─── Page / slot matching ───────────────────────────────────
  function pageMatches(creativePages, currentPage) {
    if (!creativePages || !creativePages.length) return false;
    for (var i = 0; i < creativePages.length; i++) {
      if (creativePages[i] === '*' || creativePages[i] === currentPage) return true;
    }
    return false;
  }

  function slotTypeMatches(creativeSlotTypes, slotType) {
    if (!creativeSlotTypes || !creativeSlotTypes.length) return true; // unrestricted
    for (var i = 0; i < creativeSlotTypes.length; i++) {
      if (creativeSlotTypes[i] === slotType) return true;
    }
    return false;
  }

  // Pick the highest-priority fill for a slot.
  // Returns { fillMode, sponsorId, creative } or null.
  function pickFill(slotEl) {
    var slotType = slotEl.dataset.slotType;
    var page = slotEl.dataset.slotPage || currentPagePath();
    var allowAdsense = slotEl.dataset.allowAdsense === 'true';

    // 1) Direct sponsors — first active match wins (highest tier ordering
    //    is the responsibility of /sponsors.json author).
    var sponsor = (sponsors || []).find(function (s) {
      return s.active !== false
          && pageMatches(s.pages, page)
          && slotTypeMatches(s.slot_types, slotType);
    });
    if (sponsor) {
      return { fillMode: 'direct', sponsorId: sponsor.id, creative: sponsor.creative };
    }

    // 2) House ads — weighted random pick across matching candidates.
    var houseCandidates = (houseAds || []).filter(function (h) {
      return h.active !== false
          && pageMatches(h.pages, page)
          && slotTypeMatches(h.slot_types, slotType);
    });
    if (houseCandidates.length) {
      var picked = weightedPick(houseCandidates);
      return { fillMode: 'house', sponsorId: picked.id, creative: picked.creative };
    }

    // 3) AdSense fallback — only if explicitly opted in AND a real slot ID
    //    is configured on the div. This avoids policy violations from
    //    empty `<ins>` tags.
    if (allowAdsense && slotEl.dataset.adsenseSlot) {
      return {
        fillMode: 'adsense',
        sponsorId: 'adsense',
        creative: { type: 'adsense', adsenseSlot: slotEl.dataset.adsenseSlot },
      };
    }

    return null;
  }

  function weightedPick(items) {
    var total = 0;
    for (var i = 0; i < items.length; i++) {
      total += (typeof items[i].rotation_weight === 'number' ? items[i].rotation_weight : 1);
    }
    var r = Math.random() * total;
    var acc = 0;
    for (var j = 0; j < items.length; j++) {
      acc += (typeof items[j].rotation_weight === 'number' ? items[j].rotation_weight : 1);
      if (r < acc) return items[j];
    }
    return items[items.length - 1];
  }

  // ─── Rendering ──────────────────────────────────────────────
  // Builds the inner HTML for a slot. Caller is responsible for the
  // outer .sponsor-slot div (CLS-safe, comes from page markup).
  function renderFill(slotEl, fill) {
    var slotType = slotEl.dataset.slotType;
    var slotId = slotEl.dataset.slotId;
    var slotPage = slotEl.dataset.slotPage || currentPagePath();

    // Always include the IAB transparency label.
    var label = '<span class="sponsor-slot__label">' +
                (fill.fillMode === 'adsense' ? 'Advertisement' : 'Sponsored') +
                '</span>';

    if (fill.creative.type === 'adsense') {
      injectAdsenseLibOnce();
      slotEl.innerHTML = label +
        '<ins class="adsbygoogle" style="display:block;width:100%;height:100%"' +
        ' data-ad-client="' + ADSENSE_PUB_ID + '"' +
        ' data-ad-slot="' + escAttr(fill.creative.adsenseSlot) + '"' +
        ' data-ad-format="auto" data-full-width-responsive="true"></ins>';
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
      return;
    }

    if (fill.creative.type === 'image') {
      var dataAttrs =
        ' data-slot-id="' + escAttr(slotId) + '"' +
        ' data-slot-type="' + escAttr(slotType) + '"' +
        ' data-slot-page="' + escAttr(slotPage) + '"' +
        ' data-sponsor-id="' + escAttr(fill.sponsorId) + '"' +
        ' data-fill-mode="' + escAttr(fill.fillMode) + '"';
      slotEl.innerHTML = label +
        '<a href="' + escAttr(fill.creative.url) + '" target="_blank" rel="sponsored noopener"' + dataAttrs + '>' +
        '<img src="' + escAttr(fill.creative.src) + '"' +
        ' alt="' + escAttr(fill.creative.alt || '') + '"' +
        ' loading="lazy" decoding="async">' +
        '</a>';
      return;
    }

    if (fill.creative.type === 'native') {
      var nativeAttrs =
        ' data-slot-id="' + escAttr(slotId) + '"' +
        ' data-slot-type="' + escAttr(slotType) + '"' +
        ' data-slot-page="' + escAttr(slotPage) + '"' +
        ' data-sponsor-id="' + escAttr(fill.sponsorId) + '"' +
        ' data-fill-mode="' + escAttr(fill.fillMode) + '"';
      slotEl.innerHTML = label +
        '<a class="sponsor-slot__native" href="' + escAttr(fill.creative.url) + '"' +
        ' target="_blank" rel="sponsored noopener"' + nativeAttrs + '>' +
        '<img class="sponsor-slot__native-img" src="' + escAttr(fill.creative.src) + '"' +
        ' alt="" loading="lazy" decoding="async">' +
        '<div class="sponsor-slot__native-body">' +
          '<h4 class="sponsor-slot__native-headline">' + escHtml(fill.creative.headline || '') + '</h4>' +
          '<p class="sponsor-slot__native-desc">' + escHtml(fill.creative.description || '') + '</p>' +
          '<span class="sponsor-slot__native-cta">' + escHtml(fill.creative.cta || 'Learn more') + ' →</span>' +
        '</div>' +
        '</a>';
      return;
    }

    if (fill.creative.type === 'html') {
      // Trusted custom HTML for direct sponsors that need richer creative.
      slotEl.innerHTML = label + (fill.creative.html || '');
      return;
    }

    // Unknown creative type — leave the slot empty but the CSS height
    // is still reserved, so no layout shift.
  }

  // ─── AdSense library bootstrap ──────────────────────────────
  function injectAdsenseLibOnce() {
    if (adsenseLibInjected) return;
    if (document.querySelector('script[src*="pagead2.googlesyndication.com"]')) {
      adsenseLibInjected = true;
      return;
    }
    var s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + ADSENSE_PUB_ID;
    document.head.appendChild(s);
    adsenseLibInjected = true;
  }

  // ─── Escaping helpers ───────────────────────────────────────
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function escAttr(s) { return escHtml(s); }

  // ─── Slot population ────────────────────────────────────────
  function populate(slotEl) {
    var slotType = slotEl.dataset.slotType;
    var behavior = SLOT_BEHAVIOR[slotType];
    if (!behavior) {
      console.warn('[SponsorSlot] unknown slot-type:', slotType, slotEl);
      return;
    }

    var mobile = isMobile();
    if (behavior.mobileOnly && !mobile) {
      slotEl.style.display = 'none';
      return;
    }
    if (behavior.hideOnMobile && mobile) {
      slotEl.style.display = 'none';
      return;
    }

    var fill = pickFill(slotEl);
    if (!fill) {
      // Mark as empty for QA — CSS still reserves height, no shift.
      slotEl.setAttribute('data-fill-state', 'empty');
      return;
    }
    slotEl.setAttribute('data-fill-state', 'filled');
    slotEl.setAttribute('data-fill-mode', fill.fillMode);
    renderFill(slotEl, fill);
  }

  // ─── Click delegation (sponsor_click GA4 event) ─────────────
  document.addEventListener('click', function (e) {
    var link = e.target && e.target.closest && e.target.closest('a[data-sponsor-id]');
    if (!link) return;
    if (typeof window.gtag === 'undefined') return;
    window.gtag('event', 'sponsor_click', {
      event_category: 'sponsor',
      slot_id: link.dataset.slotId || '',
      slot_type: link.dataset.slotType || '',
      slot_page: link.dataset.slotPage || currentPagePath(),
      sponsor_id: link.dataset.sponsorId || '',
      fill_mode: link.dataset.fillMode || '',
    });
  });

  // ─── Public API ─────────────────────────────────────────────
  function init() {
    var slots = document.querySelectorAll('[data-slot-id][data-slot-type]');
    if (!slots.length) return;
    loadConfig().then(function () {
      slots.forEach(populate);
    });
  }

  function refresh(slotId) {
    var slotEl = document.querySelector('[data-slot-id="' + cssEscape(slotId) + '"]');
    if (!slotEl) return;
    slotEl.innerHTML = '';
    slotEl.removeAttribute('data-fill-state');
    slotEl.removeAttribute('data-fill-mode');
    loadConfig().then(function () { populate(slotEl); });
  }

  function trackClick(slotId, sponsorId, fillMode) {
    if (typeof window.gtag === 'undefined') return;
    window.gtag('event', 'sponsor_click', {
      event_category: 'sponsor',
      slot_id: slotId || '',
      sponsor_id: sponsorId || '',
      fill_mode: fillMode || 'manual',
      slot_page: currentPagePath(),
    });
  }

  function cssEscape(s) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  window.SponsorSlot = {
    init: init,
    refresh: refresh,
    trackClick: trackClick,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window, document);
