# s49-weng-priceunit: port WAMS #91 priceUnit reader + <small> emission + css rule.
# Exact-match, single-occurrence anchored replacements; aborts if any anchor is not unique.
import sys
def patch(path, old, new):
    s = open(path, encoding='utf-8').read()
    n = s.count(old)
    if n != 1: sys.exit(f'{path}: anchor count {n} != 1 for {old[:60]!r}')
    open(path, 'w', encoding='utf-8').write(s.replace(old, new))

READER = '''// Pricing unit for the card badge — "per group", "whole boat · up to 4 people".
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

// s46-weng-currency (D-620)'''
patch('app.js', "// s46-weng-currency (D-620)", READER)
patch('app.js',
      "    const priceDisplay = formatPrice(tour.price, tour.priceConfidence, tour.currency);\n",
      "    const priceDisplay = formatPrice(tour.price, tour.priceConfidence, tour.currency);\n"
      "    const unit = priceUnit(tour);\n"
      "    const unitHtml = unit ? `<small>${escapeHtml(unit)}</small>` : '';\n")
patch('app.js',
      '<div class="tour-price">${priceDisplay}</div>',
      '<div class="tour-price">${priceDisplay}${unitHtml}</div>')
patch('styles.css',
      "/* Tour card price display */\n.tour-price {",
      "/* Tour card price display */\n"
      "/* Unit qualifier inside the JS-rendered price badge. Emitted only when the row\n"
      "   carries _unknownFields.priceUnit (ported from wanderamsterdam/styles.css, WAMS #91,\n"
      "   via keywestsandbartours / wandernewzealand #108). 0 elements match `.tour-price small`\n"
      "   in the tracked HTML before this rule existed, so it cannot restyle anything already shipped. */\n"
      ".tour-price small {\n"
      "    display: block;\n"
      "    font-size: 0.62rem;\n"
      "    font-weight: 600;\n"
      "    line-height: 1.15;\n"
      "    letter-spacing: 0.3px;\n"
      "    text-transform: uppercase;\n"
      "}\n\n"
      ".tour-price {")
print('ok')
