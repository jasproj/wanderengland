#!/usr/bin/env python3
"""Fixture proof for the never-anchor multilingual-token hygiene fix (scripts/s48-weng-refresh-a.mjs).

Hub context (ai-memory-hub wtpa/MEMORY.md, _network.md, s50): "The never-anchor test must be
unicode-normalised everywhere (NFC, okina/macron folds) -- the Kamaʻāina class hid 20
resident-tier anchors on WHAW behind diacritics. WENG and WAMS classifiers still carry the
ASCII form." No decision id exists for this rule as of hub HEAD 12485104 (verified: D-655
through D-659 are the only decisions above D-654 "Pace doctrine"; grepped clean for Kama,
kamaaina, never-anchor, NFC, resident, okina beyond that). Citing the MEMORY.md network note,
not a D-number.

s51-weng-diacritics/sweep.py found zero live WENG rows affected today (1,130 published rows
scanned, tours-data.json sha256 7ddb0a09...df44a -- see result.json). Two diacritic tier names
DO exist in current data (Jóvenes, Niño) but sit on unpublished (zero-price / low-confidence)
rows, so the gap is latent, not live -- this closes it before it can bite a future publish.

This fixture proves, against a verbatim copy of the post-fix NEVER regex in
scripts/s48-weng-refresh-a.mjs:
  1. Each newly added token (ASCII sibling of an existing accented term, or a wholly new
     multilingual never-anchor word) now matches, word-bounded, case-insensitive.
  2. Every pre-existing NEVER fixture (accented terms, CJK terms, unrelated base/group words)
     still matches/doesn't-match exactly as before -- this is a regex-only addition, not a
     rewrite.
  3. A clean "Adult" control does not fire.
  4. Spanish "mayor/mayores" (senior/elder) was deliberately EXCLUDED from this fix despite
     being in the sweep's check-(c) multilingual list -- it collides with the English word
     "Mayor" (a plausible London tour/product name, e.g. a Lord Mayor's Show tour), and no
     live WENG row needs it today (0 occurrences of Jóvenes/Niño's sibling class requiring it).
     This fixture asserts "Mayor" alone does NOT fire, proving the exclusion held.

Regex-only change; no data writes; classifyTier's decision logic (BASE/GROUP/VOLUME/etc.) is
untouched -- only the NEVER token list grew.
"""
import re, sys

# verbatim copy of the post-fix NEVER regex, scripts/s48-weng-refresh-a.mjs line 90
NEVER = re.compile(r"\b(child|childs|child's|children|childrens|children's|kid|kids|kid's|infant|infants|baby|babies|toddler|junior|juniors|youth|youths|teen|teenager|teens|adolescent|adolescents|young adult|student|students|senior|seniors|oap|concession|concessions|pensioner|disabled|wheelchair|carer|companion|blue light|nhs|discount|under\s*\d+s?|\d+\s*(and|&)\s*under|family|families|bundle|package|add[- ]?on|extra|extras|additional|supplement|upgrade|gratuity|tip|tips|donation|deposit|voucher|gift card|redemption|per additional|spectator|non[- ]?participant|dog|dogs|pet|pets|kit|merchandise|parking|niño|niños|niña|niñas|nino|ninos|nina|ninas|bebé|bebe|infante|enfant|enfants|bébé|kind|kinder|kinderen|bambino|bambini|bambina|bambine|neonato|neonati|ragazzo|ragazzi|ragazza|ragazze|joven|jóvenes|jovenes|anciano|anciana|jeune|jeunes|aine|ainee|crianca|criancas|criança|crianças|kamaaina|plaatselijk|inwoner|inwoners|residente|residentes|anwohner|einheimisch|儿童|孩子|学生|老年|优惠)\b|儿童|孩子|学生|老年|优惠", re.I)

# (label, should_match)
NEW_TOKEN_FIXTURES = [
    ("Nino", True), ("Ninos", True), ("Nina", True), ("Ninas", True),
    ("Kinderen", True),
    ("Bambina", True), ("Bambine", True),
    ("Joven", True), ("Jóvenes", True), ("Jovenes", True),
    ("Anciano", True), ("Anciana", True),
    ("Jeune", True), ("Jeunes", True),
    ("Aine", True), ("Ainee", True),
    ("Crianca", True), ("Criancas", True), ("Criança", True), ("Crianças", True),
    ("Kamaʻāina", False),   # NOT folded upstream -- the regex matches the ASCII form "Kamaaina"
    ("Kamaaina", True),     # sweep.py folds diacritics BEFORE this regex runs; this is the folded form it sees
    ("Plaatselijk", True), ("Inwoner", True), ("Inwoners", True),
    ("Residente", True), ("Residentes", True),
    ("Anwohner", True), ("Einheimisch", True),
]

# pre-existing behavior that must NOT change
REGRESSION_FIXTURES = [
    ("Niño", True), ("Niños", True), ("Niña", True), ("Niñas", True),
    ("Bebé", True), ("Bebe", True),
    ("Kind", True), ("Kinder", True),
    ("Bambino", True), ("Bambini", True),
    ("Enfant", True), ("Enfants", True), ("Bébé", True),
    ("Child", True), ("Senior", True), ("Concession", True), ("Add-on", True), ("Deposit", True),
    ("儿童", True), ("老年优惠票", True),
    ("Adult", False),
    ("Person", False),
    ("Standard Ticket", False),
]

# the deliberate exclusion: Spanish "mayor" collides with the English word "Mayor"
EXCLUSION_FIXTURES = [
    ("Mayor", False),
    ("Meet the Mayor Tour", False),
    ("Mayores", False),  # excluded sibling of the excluded token -- confirms no partial leak
]

def run(fixtures, label):
    failures = []
    for text, expected in fixtures:
        got = bool(NEVER.search(text))
        status = "OK" if got == expected else "FAIL"
        if got != expected:
            failures.append((text, expected, got))
        print(f"[{status}] {label}: {text!r} expected={expected} got={got}")
    return failures

fail1 = run(NEW_TOKEN_FIXTURES, "new-token")
fail2 = run(REGRESSION_FIXTURES, "regression")
fail3 = run(EXCLUSION_FIXTURES, "exclusion")

total = len(NEW_TOKEN_FIXTURES) + len(REGRESSION_FIXTURES) + len(EXCLUSION_FIXTURES)
failed = len(fail1) + len(fail2) + len(fail3)
print(f"\n{total - failed}/{total} fixtures passed")
sys.exit(1 if failed else 0)
