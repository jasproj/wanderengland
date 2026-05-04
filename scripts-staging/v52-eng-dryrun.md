# wanderengland v5.2 Dry-Run Report (GBP) — null-price tour re-extraction

**Generated:** 2026-05-03T21:41:43.389Z
**Branch:** `feat/eng-v52-price-extraction`
**Mode:** `--dry-run-only` (no writes to tours-data.json)

## 1. Inputs

- wanderengland total tours: 372
- Tours with `price: null` evaluated: **154**
- Extractor: v5.4 baseline + v5.2 dominant-price gate (ported verbatim from wanderusvi)
- Currency: **GBP**
- Page fetch: Playwright (chromium headless), 1.5 s settle wait

## 2. Result distribution

| Outcome | Count | Disposition |
|---|---:|---|
| **high** (v5.4 Method 1/2 — adult/per-person anchor) | 0 | "From $X" if applied |
| **medium** (v5.4 native — Method 3/4/6) | 0 | "From $X" if applied |
| **medium** (v5.2 dominant-price gate) | 1 | "From $X" if applied |
| **low** (Method 5 unanchored, gate FAILed) | 0 | stays "Check availability" |
| **no-price** (extractor returned null) | 153 | stays "Check availability" |
| **error** (fetch/parse) | 0 | stays "Check availability" |
| **Total** | 154 | |

**Net effect if applied --live:** 1 tours flip from "Check availability" → "From $X" (0.6% of the 154). 153 stay hidden.

## 3. Cat-E candidate sanity check

**0 Cat-E candidates** detected among gate PASSes. Disqualifier blocklist (`additional, extra, option, optional, rental, nitrox, upgrade, supplement, add-on, addon, surcharge` + `+$` literal) appears to be holding.

## 4. Sample 10 promoted tours

### 251796 — Best of Blackfriars

- company: London Guided Walks Private Tours
- extracted price: **$221** (medium, unknown)
- priceSource: `v52-dominant-gate`
- gate distinct $-values: [221]
- gate matched token: `£221`
- gate ±40 char window:

  ```
  0 M T W Th F S Su 27 28 29 30 1 2 3 4 5 £221 6 £221 7 £221 8 £221 9 £221 10 £221 11 
  ```

## 5. Sample 5 stays-hidden tours

### 214981 — Private • Cambridge Walking & Punting Tour & Optional King's College

- outcome: no-price

### 283390 — Private • Oxford University Walking Tour  & Optional New College

- outcome: no-price

### 351641 — Private • Oxford University Punting Tour

- outcome: no-price

### 488756 — Power, Profit & Progress Tour: Women in the City

- outcome: no-price

### 527007 — Fleet Street: a Private Tour

- outcome: no-price

## 6. Out of scope for this run

- No edits to `tours-data.json`.
- No commits, no push, no deploy.
- `--live` mode not implemented yet — adopt USVI's `apply-v52-live.js` pattern when ready.
