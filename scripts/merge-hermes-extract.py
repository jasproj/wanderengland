#!/usr/bin/env python3
"""
Merge FareHarbor extraction into tours-data.json for WanderEngland.
Filters to United Kingdom tours only.
"""
import json
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
TOURS_FILE = REPO_ROOT / "tours-data.json"
HERMES_EXTRACT = Path("/tmp/fh_uk.json")
AFFILIATE_CODE = "walktheplankadventures"

def normalize_location(loc_dict):
    """Map FH location to our city."""
    return loc_dict.get("city", "") or loc_dict.get("state", "") or "England"

def build_booking_url(item):
    """Build affiliate booking URL."""
    company_sn = item.get("company", {}).get("shortname", "")
    item_pk = item.get("pk") or item.get("id")
    if company_sn and item_pk:
        return f"https://fareharbor.com/{company_sn}/items/{item_pk}/book/?full-items=yes&flow=no&ref={AFFILIATE_CODE}"
    return None

def transform_hermes_item(item):
    """Transform FH API item to our schema."""
    loc = item.get("location", {})
    
    # Skip non-UK tours
    if loc.get("country") != "United Kingdom":
        return None
    
    images = item.get("images", [])
    gallery = [img.get("image_cdn_url") for img in images if img.get("image_cdn_url")]
    
    return {
        "pk": item.get("pk") or item.get("id"),
        "name": item.get("name", ""),
        "description": item.get("summary", ""),
        "location": normalize_location(loc),
        "price": None,
        "bookingUrl": build_booking_url(item),
        "gallery": gallery[:5],
        "tags": [],
        "needsEnrichment": True,
        "source": "fareharbor-hermes-extract",
    }

def main():
    raw = json.load(open(TOURS_FILE))
    if isinstance(raw, dict) and "tours" in raw:
        existing = raw["tours"]
        wrapper = raw
    else:
        existing = raw
        wrapper = None
    
    existing_by_pk = {t.get("pk"): t for t in existing if t.get("pk")}
    existing_by_name = {t.get("name", "").lower(): t for t in existing}
    
    print(f"Existing tours: {len(existing)}")
    
    hermes_items = json.load(open(HERMES_EXTRACT))
    print(f"Hermes extract items: {len(hermes_items)}")
    
    added = 0
    updated = 0
    skipped = 0
    
    for item in hermes_items:
        transformed = transform_hermes_item(item)
        if not transformed:
            skipped += 1
            continue
        
        pk = transformed["pk"]
        name_lower = transformed["name"].lower()
        
        if pk in existing_by_pk:
            ex = existing_by_pk[pk]
            if not ex.get("gallery"):
                ex["gallery"] = transformed["gallery"]
            if not ex.get("pk"):
                ex["pk"] = pk
            if not ex.get("bookingUrl"):
                ex["bookingUrl"] = transformed["bookingUrl"]
            updated += 1
        elif name_lower in existing_by_name:
            ex = existing_by_name[name_lower]
            if not ex.get("pk"):
                ex["pk"] = pk
            if not ex.get("gallery"):
                ex["gallery"] = transformed["gallery"]
            if not ex.get("bookingUrl"):
                ex["bookingUrl"] = transformed["bookingUrl"]
            updated += 1
        else:
            existing.append(transformed)
            existing_by_pk[pk] = transformed
            existing_by_name[name_lower] = transformed
            added += 1
    
    print(f"Added: {added}, Updated: {updated}, Skipped (non-UK): {skipped}")
    print(f"Final total: {len(existing)}")
    
    null_prices = sum(1 for t in existing if t.get("price") is None)
    print(f"Null prices: {null_prices} ({100*null_prices/len(existing):.1f}%)")
    
    if wrapper:
        wrapper["tours"] = existing
        wrapper["lastNormalized"] = "2026-05-27T00:00:00Z"
        with open(TOURS_FILE, "w") as f:
            json.dump(wrapper, f, indent=2)
    else:
        with open(TOURS_FILE, "w") as f:
            json.dump(existing, f, indent=2)
    print(f"Written to {TOURS_FILE}")

if __name__ == "__main__":
    main()
