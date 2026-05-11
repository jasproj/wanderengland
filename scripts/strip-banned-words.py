#!/usr/bin/env python3
"""
Strip banned tourism cliches from tours-data.json descriptions.

Mirrors floridasandbartours PR #31 approach:
- Delete modifier (no synonym swap)
- Proper-noun preservation for "Paradise" (capitalized brand/place names)
- Bidirectional a/an grammar fix
- Conjunction-aware removal ("X and Y" / "Y and X")
- Whitespace + punctuation cleanup

Scope: tours-data.json `description` field only.
Off-limits: name, title, meta tags. JSON-LD scan handled separately.

Usage:
    python3 scripts/strip-banned-words.py [tours-data.json]
"""

import json
import re
import sys
from pathlib import Path

BANNED = [
    "once-in-a-lifetime",
    "world-class",
    "hidden gem",
    "must-see",
    "breathtaking",
    "unforgettable",
    "stunning",
    "awaits",
    "paradise",
]

PREPOSITIONS = {
    "in", "of", "at", "to", "the", "a", "an", "on",
    "for", "with", "by", "from", "this", "that", "our",
}


def is_proper_paradise(text: str, start: int, end: int) -> bool:
    """Heuristic: capital 'Paradise' is a proper noun if adjacent words are capitalized,
    within the same sentence."""
    after = text[end:end + 50]
    m = re.match(r"[ \t]+([A-Z][\w'’-]*)", after)
    if m:
        return True
    before = text[max(0, start - 120):start]
    last_break = max(
        before.rfind("."), before.rfind("!"), before.rfind("?"), before.rfind(";"),
    )
    if last_break >= 0:
        before = before[last_break + 1:]
    tokens = re.findall(r"[A-Za-z][\w'’-]*", before)
    for tok in reversed(tokens):
        if tok.lower() in PREPOSITIONS:
            continue
        return tok[0].isupper()
    return False


def strip_paradise(desc: str) -> tuple[str, int, int]:
    """Strip lowercase 'paradise' always. Strip capitalized only when not a proper noun.
    Returns (new_desc, hits_stripped, preserved)."""
    hits = 0
    preserved = 0
    out_parts = []
    i = 0
    for m in re.finditer(r"\b[Pp]aradise\b", desc):
        out_parts.append(desc[i:m.start()])
        word = m.group(0)
        if word[0].islower():
            hits += 1
        else:
            if is_proper_paradise(desc, m.start(), m.end()):
                out_parts.append(word)
                preserved += 1
            else:
                hits += 1
        i = m.end()
    out_parts.append(desc[i:])
    return "".join(out_parts), hits, preserved


def strip_with_conjunction(desc: str, word: str) -> tuple[str, int]:
    """Strip `word X` or `X word` with the joining 'and', else plain strip."""
    flags = re.IGNORECASE
    escaped = re.escape(word)
    initial_count = len(re.findall(r"\b" + escaped + r"\b", desc, flags))
    # "<word> and <other>" -> "<other>"
    desc = re.sub(
        r"\b" + escaped + r"\s+and\s+(\w[\w'’-]*)",
        lambda m: m.group(1),
        desc, flags=flags,
    )
    # "<other> and <word>" -> "<other>"
    desc = re.sub(
        r"(\w[\w'’-]*)\s+and\s+" + escaped + r"\b",
        lambda m: m.group(1),
        desc, flags=flags,
    )
    # ", <word>" or "<word>, " plain
    desc = re.sub(r",\s*\b" + escaped + r"\b", "", desc, flags=flags)
    desc = re.sub(r"\b" + escaped + r"\b\s*,", "", desc, flags=flags)
    # plain
    desc = re.sub(r"\b" + escaped + r"\b", "", desc, flags=flags)
    final_count = len(re.findall(r"\b" + escaped + r"\b", desc, flags))
    return desc, initial_count - final_count


A_VOWEL_LETTER_CONSONANT_SOUND = {
    "unique", "unicorn", "union", "united", "unit", "unite", "unify", "unified",
    "uniform", "universal", "universe", "university", "user", "useful", "use",
    "usage", "used", "useless", "usable", "usually", "usual", "ukulele",
    "ubiquitous", "utility", "utopia", "utopian", "utensil",
    "eulogy", "euphoria", "euphemism", "european", "europe", "euro", "euros",
    "eureka", "eucalyptus",
    "one", "once", "one-time", "one-of-a-kind",
}

AN_CONSONANT_LETTER_VOWEL_SOUND = {
    "hour", "hours", "honor", "honors", "honour", "honours",
    "honest", "honestly", "honesty", "heir", "heirloom",
    "honorary", "honorable", "honourable",
}


def fix_a_an(text: str) -> str:
    """Fix a/an, preserving consonant-sound vowel-letter and vowel-sound consonant-letter
    exceptions (unique, hour, etc.)."""
    def flip_a(m):
        word = m.group(3)
        if word.lower() in A_VOWEL_LETTER_CONSONANT_SOUND:
            return m.group(0)
        art = "An" if m.group(1) == "A" else "an"
        return art + m.group(2) + word

    def flip_an(m):
        word = m.group(3)
        if word.lower() in AN_CONSONANT_LETTER_VOWEL_SOUND:
            return m.group(0)
        art = "A" if m.group(1) == "An" else "a"
        return art + m.group(2) + word

    text = re.sub(
        r"\b(A|a)(\s+)([aeiouAEIOU][\w'’-]*)", flip_a, text,
    )
    text = re.sub(
        r"\b(An|an)(\s+)([bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ][\w'’-]*)",
        flip_an, text,
    )
    return text


def cleanup(text: str) -> str:
    """Whitespace + dangling-punctuation cleanup."""
    for _ in range(3):
        text = re.sub(r",\s*,", ",", text)
        text = re.sub(r"\s*,\s*([.!?;:])", r"\1", text)
        text = re.sub(r"\(\s*,\s*", "(", text)
        text = re.sub(r"\s*,\s*\)", ")", text)
        text = re.sub(r"([.!?])\s*,", r"\1", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" +([,.;:!?])", r"\1", text)
    text = re.sub(r"\(\s+", "(", text)
    text = re.sub(r"\s+\)", ")", text)
    text = re.sub(r" +\n", "\n", text)
    text = re.sub(r"\n +", "\n", text)
    return text.strip()


def process(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)

    counts = {w: 0 for w in BANNED}
    tours_touched = 0
    preserved_paradise = 0
    short_descs = []

    for tour in data:
        desc = tour.get("description")
        if not isinstance(desc, str):
            continue
        orig = desc
        for word in BANNED:
            if word == "paradise":
                desc, hits, preserved = strip_paradise(desc)
                counts[word] += hits
                preserved_paradise += preserved
            else:
                desc, hits = strip_with_conjunction(desc, word)
                counts[word] += hits
        desc = cleanup(desc)
        desc = fix_a_an(desc)
        desc = cleanup(desc)
        if desc != orig:
            tour["description"] = desc
            tours_touched += 1
            if len(desc) < 40:
                short_descs.append((tour.get("id", "?"), len(desc), desc))

    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return {
        "counts": counts,
        "total_hits": sum(counts.values()),
        "tours_touched": tours_touched,
        "preserved_paradise": preserved_paradise,
        "short_descs": short_descs,
    }


def main():
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "tours-data.json")
    if not target.exists():
        print(f"ERROR: {target} not found", file=sys.stderr)
        sys.exit(1)
    r = process(target)
    print(f"File: {target}")
    print(f"Tours touched: {r['tours_touched']}")
    print(f"Total hits removed: {r['total_hits']}")
    print("Breakdown:")
    for w, c in r["counts"].items():
        if c > 0:
            print(f"  {w}: {c}")
    print(f"Preserved 'Paradise' (proper-noun): {r['preserved_paradise']}")
    if r["short_descs"]:
        print(f"WARN: {len(r['short_descs'])} descriptions are <40 chars after strip:")
        for sd in r["short_descs"]:
            print(f"  id={sd[0]} len={sd[1]}: {sd[2]!r}")


if __name__ == "__main__":
    main()
