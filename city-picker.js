/* city-picker.js — shared by the Wander sites (s61).

   The location <select> on these sites offered a handful of hand-written
   options (four islands, four cities, a few Amsterdam "areas"), so a visitor
   could not ask for the town they are actually staying in. This rebuilds that
   select from the catalogue itself: every place with at least MIN_COUNT live
   tours, with its count, grouped under an island/region where the site has
   one. A city option's value is "city:<key>". Any other value is handed to
   the site's own legacy matcher, so existing ?island= links keep working.

   Each site passes a small config; nothing here knows about any one site:

     CityPicker.create({
       cityOf(tour)    -> display name of the town, or '' when unknown
       groupOf(tour)   -> { key, label } or null   (omit for a flat list)
       groupOrder      -> [key, ...]  order of groups (others follow, A-Z)
       legacyMatch(tour, value) -> bool   how the old option values matched
       minCount        -> smallest town listed (default 2)
       allLabel        -> text of the first option (default: keep the page's)
     })
*/
(function (g) {
  'use strict';

  function keyOf(name) {
    return String(name || '').trim().toLowerCase();
  }

  function create(cfg) {
    var minCount = cfg.minCount || 2;

    /* In a grouped list the same town name can sit under two groups (Waimea is
       on both the Big Island and Kauai), so a grouped city value carries its
       group: "city:big island/waimea". A flat list uses "city:<town>". */
    function cityKey(tour) {
      var k = keyOf(cfg.cityOf(tour));
      if (!k || !cfg.groupOf) return k;
      var gr = cfg.groupOf(tour);
      return gr ? gr.key + '/' + k : '';
    }

    function matches(tour, value) {
      if (!value) return true;
      var v = String(value).trim();
      if (v.toLowerCase().indexOf('city:') === 0) return cityKey(tour) === keyOf(v.slice(5));
      if (cfg.groupOf) {
        // a group option's value is the group key itself (the old island
        // value), so ?island=oahu still lands on "All of Oahu"
        var gr = cfg.groupOf(tour);
        if (gr && gr.key === v.toLowerCase()) return true;
      }
      return cfg.legacyMatch ? cfg.legacyMatch(tour, v.toLowerCase()) : false;
    }

    function fill(select, tours) {
      if (!select || select.getAttribute('data-cities') === '1') return;
      var groups = {}, groupLabel = {}, groupCount = {}, flat = !cfg.groupOf;
      (tours || []).forEach(function (t) {
        var gr = flat ? { key: '', label: '' } : cfg.groupOf(t);
        if (!gr) return;
        groupLabel[gr.key] = gr.label;
        groupCount[gr.key] = (groupCount[gr.key] || 0) + 1;
        var name = cfg.cityOf(t), k = keyOf(name);
        if (!k) return;
        if (!flat) k = gr.key + '/' + k;
        groups[gr.key] = groups[gr.key] || {};
        var slot = groups[gr.key][k] = groups[gr.key][k] || { name: name, n: 0 };
        slot.n++;
      });
      var keep = select.value;
      var first = select.options[0];
      while (select.lastChild) select.removeChild(select.lastChild);
      if (first) {
        first.value = '';
        if (cfg.allLabel) first.textContent = cfg.allLabel;
        select.appendChild(first);
      }
      var order = (cfg.groupOrder || []).filter(function (k) { return groupCount[k]; });
      Object.keys(groupCount).sort().forEach(function (k) { if (order.indexOf(k) === -1) order.push(k); });
      order.forEach(function (gk) {
        var parent = select;
        if (!flat) {
          parent = document.createElement('optgroup');
          parent.label = groupLabel[gk];
          var all = document.createElement('option');
          all.value = gk;
          all.textContent = 'All of ' + groupLabel[gk] + ' (' + groupCount[gk] + ')';
          parent.appendChild(all);
        }
        var towns = groups[gk] || {};
        Object.keys(towns).sort(function (a, b) { return a.localeCompare(b); }).forEach(function (k) {
          if (towns[k].n < minCount) return;
          var o = document.createElement('option');
          o.value = 'city:' + k;
          o.textContent = towns[k].name + ' (' + towns[k].n + ')';
          parent.appendChild(o);
        });
        if (!flat) select.appendChild(parent);
      });
      if (keep) {
        select.value = keep;
        if (select.value !== keep) {
          // an old ?island= value: keep it selectable so the filter still shows it
          var o = document.createElement('option');
          o.value = keep; o.textContent = keep; select.appendChild(o); select.value = keep;
        }
      }
      select.setAttribute('data-cities', '1');
    }

    return { cityKey: cityKey, matches: matches, fill: fill };
  }

  /* Shared town-name cleanup: last path segment, no ", New Zealand"-style
     country suffix, trimmed. Sites add their own alias maps on top. */
  function lastSegment(loc) {
    var parts = String(loc || '').split('/');
    return parts[parts.length - 1].replace(/,\s*(New Zealand|Netherlands|United Kingdom|England|Puerto Rico|USA?|Hawaii)\s*$/i, '').trim();
  }

  g.CityPicker = { create: create, lastSegment: lastSegment };
})(typeof window !== 'undefined' ? window : this);
