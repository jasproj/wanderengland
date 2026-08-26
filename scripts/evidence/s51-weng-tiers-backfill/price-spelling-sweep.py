#!/usr/bin/env python3
"""Price-spelling sweep for the s51-weng-tiers-backfill population.

For every pk touched by scripts/s51-weng-tiers-backfill.mjs (per apply-summary.json), checks
the written figures are clean: price/tier prices are real numbers (no NaN, no bool, no
currency-symbol strings), round to 2dp with no floating-point residue, a non-null price always
carries a non-empty priceLabel, tier names carry no embedded currency symbol, and currency is
one of the site's known codes.
"""
import json, math, re, sys

summary = json.load(open('scripts/evidence/s51-weng-tiers-backfill/apply-summary.json'))
pks = {r['pk'] for r in summary['summary']}
doc = json.load(open('tours-data.json', encoding='utf-8'))
by_pk = {t['pk']: t for t in doc['tours']}

bad = []
for pk in pks:
    t = by_pk.get(pk)
    if t is None:
        bad.append({'pk': pk, 'issue': 'MISSING_ROW'}); continue
    p = t.get('price')
    if p is not None:
        if not isinstance(p, (int, float)) or isinstance(p, bool) or math.isnan(p):
            bad.append({'pk': pk, 'issue': 'bad_price_type', 'value': p})
        elif round(p, 2) != p:
            bad.append({'pk': pk, 'issue': 'non_clean_decimal', 'value': p})
        if not t.get('priceLabel'):
            bad.append({'pk': pk, 'issue': 'price_set_no_label'})
    for tier in t.get('priceTiers') or []:
        tp = tier.get('price')
        if not isinstance(tp, (int, float)) or isinstance(tp, bool) or math.isnan(tp):
            bad.append({'pk': pk, 'issue': 'tier_bad_price', 'tier': tier})
        elif round(tp, 2) != tp:
            bad.append({'pk': pk, 'issue': 'tier_non_clean_decimal', 'tier': tier})
        if re.search(r'[£$€]', tier.get('name') or ''):
            bad.append({'pk': pk, 'issue': 'currency_symbol_in_tier_name', 'tier': tier})
    if t.get('currency') not in ('GBP', 'EUR', 'USD', None):
        bad.append({'pk': pk, 'issue': 'unexpected_currency', 'value': t.get('currency')})

result = {'population': len(pks), 'issues': bad, 'PASS': len(bad) == 0}
print(json.dumps(result, indent=1))
json.dump(result, open('scripts/evidence/s51-weng-tiers-backfill/price-spelling-sweep-result.json', 'w'), indent=1)
sys.exit(0 if result['PASS'] else 1)
