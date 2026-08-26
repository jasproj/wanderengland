#!/usr/bin/env python3
"""Proves sweep.py's detector actually works, rather than trusting a vacuous zero.

Plants three synthetic rows into an in-memory copy of tours-data.json (nothing is written to
disk) and reruns sweep.run_sweep against the combined set:
  - FIXTURE-1: anchor tier "Kamaʻāina" (Hawaiian, folds to "kamaaina") -- must fire
  - FIXTURE-2: anchor tier "Séñior" (accented English, folds to "senior") -- must fire
  - FIXTURE-3-CONTROL: clean "Adult" anchor -- must NOT fire

Run: python3 scripts/evidence/s51-weng-diacritics/sweep_fixture_proof.py
"""
import json, sys, os

sys.path.insert(0, os.path.dirname(__file__))
from sweep import run_sweep

def make_row(pk, name, label, price, tiers, note):
    return {
        "id": str(pk), "pk": pk, "name": name, "company": "Fixture Co",
        "bookingUrl": f"https://example.invalid/{pk}", "category": "",
        "location": "United Kingdom/England/London", "island": "london",
        "price": price, "priceLabel": label, "priceConfidence": "high",
        "qualityScore": 100, "currency": "GBP", "duration": None, "durationText": "",
        "description": "", "descriptionRaw": "", "descriptionQuality": "",
        "highlights": [], "tags": [], "image": "", "galleryImages": [],
        "rating": None, "reviewCount": None, "ratingSource": None,
        "freeCancellation": False, "timeOfDay": "", "capacity": None,
        "enrichmentSource": "fixture", "status": "active", "statusReason": None,
        "statusFirstSeen": None, "statusConsecutiveRuns": None, "lastUpdated": "2026-08-26",
        "priceBreakdown": [], "priceIncludesBookingFees": False, "priceIncludesTaxes": False,
        "priceEnrichmentSource": "fixture", "priceEnrichmentAt": "2026-08-26",
        "priceSource": "fixture", "priceTiers": tiers,
        "priceEnrichmentStatus": "high", "priceBasis": note,
    }

planted = [
    make_row(900000001, "Fixture: okina/macron-hidden resident anchor", "Kamaʻāina", 12, [
        {"name": "Kamaʻāina", "note": "resident rate", "price": 12, "minPartySize": 1},
        {"name": "Adult", "note": "standard rate", "price": 28, "minPartySize": 1},
    ], "FIXTURE - deliberately wrong anchor"),
    make_row(900000002, "Fixture: accented-English hidden concession anchor", "Séñior", 9, [
        {"name": "Séñior", "note": "over 65s", "price": 9, "minPartySize": 1},
        {"name": "Adult", "note": "standard rate", "price": 22, "minPartySize": 1},
    ], "FIXTURE - deliberately wrong anchor"),
    make_row(900000003, "Fixture control: clean adult anchor", "Adult", 30, [
        {"name": "Adult", "note": "standard rate", "price": 30, "minPartySize": 1},
        {"name": "Child", "note": "ages 3-12", "price": 15, "minPartySize": 1},
    ], "FIXTURE - control, correct anchor"),
]

if __name__ == '__main__':
    data = json.load(open('tours-data.json', encoding='utf-8'))
    tours = data['tours'] + planted
    result = run_sweep(tours)
    found_pks = {f['pk'] for f in result['findings']}
    expect_fire = {900000001, 900000002}
    expect_clean = {900000003}
    ok = expect_fire.issubset(found_pks) and not (expect_clean & found_pks)
    print(json.dumps({
        'firedOnPlantedBug': sorted(expect_fire & found_pks),
        'silentOnControl': 900000003 not in found_pks,
        'PASS': ok,
    }, indent=1))
    sys.exit(0 if ok else 1)
