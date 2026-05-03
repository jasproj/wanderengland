#!/usr/bin/env node
/**
 * description-polish-v2.js
 *
 * Second-pass polish for tour descriptions cleaned by strip-metadata-preamble.js.
 * Targets two residue patterns left behind by the v1 strip:
 *
 *   Pattern A — Trailing-tail orphan section headers:
 *     Description ends with bare boilerplate labels like "Cancellations",
 *     "Additional information", etc., with no actual content following.
 *     The real content was stripped earlier; only the label remains.
 *
 *   Pattern B — TripAdvisor-style preamble:
 *     Tours that lacked the "Activity details" divider got skipped by v1
 *     and still carry leading boilerplate: review counts, rank lines
 *     ("#N of M ... in <City>"), "TripAdvisor Traveler Rating", etc.
 *
 * SAFETY:
 *   - Only modifies the `description` field; all other fields untouched.
 *   - Pattern A only fires when header appears in the LAST 30% of desc.
 *   - Pattern B aborts if the post-strip result would be <100 chars.
 *   - Dry-run by default; --live required to write.
 *   - Live mode backs up tours-data.json to tours-data.json.pre-polish-v2.
 *
 * Usage:
 *   node description-polish-v2.js               # dry-run, prints report
 *   node description-polish-v2.js --dry-run     # explicit dry-run
 *   node description-polish-v2.js --live        # write changes (backup first)
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'tours-data.json');
const BACKUP = FILE + '.pre-polish-v2';
const REPORT = path.join(__dirname, 'polish-v2-dryrun-pr.txt');

const LIVE = process.argv.includes('--live');
const MIN_LEN_AFTER_PATTERN_B = 100;

// ---------- Pattern A: trailing-tail strip ----------
// Headers that, when appearing as terminal orphans, mean "label with no content".
// We match the EARLIEST occurrence of any header in the last 30% and strip from
// there to end. Trailing whitespace/punctuation is then trimmed.
const PATTERN_A_HEADERS = [
    'Cancellations',
    'Additional information',
    'Cancellation Policy',
    'What to bring',
];

function patternAStrip(desc) {
    if (!desc || typeof desc !== 'string') return { result: desc, action: 'no-op' };
    const len = desc.length;
    const lastThirtyStart = Math.floor(len * 0.7);

    let earliestIdx = -1;
    let matchedHeader = null;

    for (const header of PATTERN_A_HEADERS) {
        // case-insensitive, must be on its own logical line (preceded by \n or
        // start, followed by \n or end). This avoids matching mid-sentence text.
        const rx = new RegExp(`(?:^|\\n)\\s*${header.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i');
        const m = desc.match(rx);
        if (!m) continue;
        const idx = m.index + m[0].indexOf(header[0] === header[0].toUpperCase() ? header[0] : header[0]);
        // Use the actual match index of the header's first char:
        const headerStart = desc.toLowerCase().indexOf(header.toLowerCase(), m.index);
        if (headerStart < 0) continue;
        if (headerStart < lastThirtyStart) continue;
        if (earliestIdx === -1 || headerStart < earliestIdx) {
            earliestIdx = headerStart;
            matchedHeader = header;
        }
    }

    if (earliestIdx === -1) return { result: desc, action: 'no-match' };

    // Strip back over the preceding newline + whitespace so the previous sentence
    // ends cleanly. Then trim trailing punctuation/whitespace.
    let cut = earliestIdx;
    while (cut > 0 && /\s/.test(desc[cut - 1])) cut--;
    let trimmed = desc.slice(0, cut).replace(/[\s ]+$/u, '');
    // Strip orphan trailing punctuation only if it's clearly an artifact (e.g. trailing colon).
    trimmed = trimmed.replace(/[:•\-]+$/u, '').trimEnd();

    return {
        result: trimmed,
        action: 'cleaned',
        matchedHeader,
        before_len: len,
        after_len: trimmed.length,
        stripped_tail: desc.slice(earliestIdx),
    };
}

// ---------- Pattern B: TripAdvisor-style preamble strip ----------
// Boilerplate signature markers that appear in the leading metadata block.
// We find the LAST occurrence of any marker within the first 800 chars; the
// preamble is considered to end at that marker's line break.
const PATTERN_B_MARKERS = [
    /Recommended by \d+% of travelers/i,
    /According to TripAdvisor travelers as of [A-Za-z]+ \d{4}/i,
    /TripAdvisor Traveler Rating/i,
    /\bTripAdvisor\b/i,
    /Based on \d+ reviews/i,
    /\d+\s*Reviewers?\b/i,
    /#\d+ of \d+ [A-Za-z][A-Za-z &]+ in [A-Z][A-Za-z]+/,
    /^Reviews\b/im,
    /★{2,}/,
    /\d\.\d\s*\/\s*5\b/,
];

const PATTERN_B_HEAD_LIMIT = 800;

function patternBStrip(desc) {
    if (!desc || typeof desc !== 'string') return { result: desc, action: 'no-op' };
    const head = desc.slice(0, PATTERN_B_HEAD_LIMIT);

    // Collect all marker hits in the head with their end indices.
    const hits = [];
    for (const rx of PATTERN_B_MARKERS) {
        // Use a global-ish scan in case multiple non-global regexes match different positions.
        const flags = rx.flags.includes('g') ? rx.flags : rx.flags + 'g';
        const grx = new RegExp(rx.source, flags);
        let m;
        while ((m = grx.exec(head)) !== null) {
            hits.push({ start: m.index, end: m.index + m[0].length, pattern: rx.source });
            if (m[0].length === 0) break; // safety
        }
    }
    if (hits.length === 0) return { result: desc, action: 'no-match' };

    // Take the FURTHEST-into-head end position; that's where the preamble ends.
    const lastEnd = hits.reduce((acc, h) => Math.max(acc, h.end), 0);

    // Walk forward from lastEnd to the next blank line OR next substantive
    // sentence (capital letter starting a real word, not a marker).
    let cut = lastEnd;
    // Skip the rest of the current line.
    while (cut < desc.length && desc[cut] !== '\n') cut++;
    // Skip any whitespace / short noise lines.
    while (cut < desc.length) {
        const nextLineEnd = desc.indexOf('\n', cut + 1);
        const lineEnd = nextLineEnd === -1 ? desc.length : nextLineEnd;
        const line = desc.slice(cut, lineEnd).trim();
        if (line.length === 0) { cut = lineEnd; continue; }
        // If this line still matches a marker pattern, eat it.
        const isMarker = PATTERN_B_MARKERS.some(rx => rx.test(line));
        if (isMarker) { cut = lineEnd; continue; }
        // If line is suspiciously short and looks like a noise label
        // (e.g. "$70", "Ages 8+", "People"), eat it.
        if (line.length < 30 && /^[\$\d★#\t]/.test(line)) { cut = lineEnd; continue; }
        if (line.length < 20 && /^(Ages?|People|Free|Instant|From|Call to Book)/i.test(line)) { cut = lineEnd; continue; }
        break;
    }

    const trimmed = desc.slice(cut).replace(/^[\s ]+/u, '');
    if (trimmed.length < MIN_LEN_AFTER_PATTERN_B) {
        return { result: desc, action: 'aborted-too-short', would_be_len: trimmed.length, before_len: desc.length };
    }
    return {
        result: trimmed,
        action: 'cleaned',
        before_len: desc.length,
        after_len: trimmed.length,
        stripped_head: desc.slice(0, cut),
    };
}

// ---------- Main ----------
function fmt(s, max = 220) {
    const oneLine = (s || '').replace(/\n/g, '\\n');
    return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine;
}

function main() {
    const tours = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const total = tours.length;

    const stats = {
        total,
        pattern_a_cleaned: 0,
        pattern_a_no_match: 0,
        pattern_b_cleaned: 0,
        pattern_b_no_match: 0,
        pattern_b_aborted_too_short: 0,
        unchanged: 0,
        changed_total: 0,
    };
    const samplesA = [];
    const samplesB = [];
    const skipsB = [];

    const out = [];
    for (const tour of tours) {
        const original = tour.description || '';

        // Pattern B first (handles leading metadata before we trim the tail).
        const bRes = patternBStrip(original);
        if (bRes.action === 'cleaned') {
            stats.pattern_b_cleaned++;
            if (samplesB.length < 5) {
                samplesB.push({
                    id: tour.id,
                    name: tour.name,
                    before_len: bRes.before_len,
                    after_len: bRes.after_len,
                    stripped_head_first_300: fmt(bRes.stripped_head, 300),
                    after_first_200: fmt(bRes.result, 200),
                });
            }
        } else if (bRes.action === 'aborted-too-short') {
            stats.pattern_b_aborted_too_short++;
            skipsB.push({ id: tour.id, name: tour.name, would_be_len: bRes.would_be_len, before_len: bRes.before_len });
        } else {
            stats.pattern_b_no_match++;
        }

        let working = bRes.result;

        const aRes = patternAStrip(working);
        if (aRes.action === 'cleaned') {
            stats.pattern_a_cleaned++;
            if (samplesA.length < 5) {
                samplesA.push({
                    id: tour.id,
                    name: tour.name,
                    matched_header: aRes.matchedHeader,
                    before_len: aRes.before_len,
                    after_len: aRes.after_len,
                    stripped_tail: fmt(aRes.stripped_tail, 200),
                    new_tail_first_200: fmt(aRes.result.slice(-200), 200),
                });
            }
            working = aRes.result;
        } else {
            stats.pattern_a_no_match++;
        }

        if (working !== original) stats.changed_total++;
        else stats.unchanged++;

        out.push({ ...tour, description: working });
    }

    const lines = [];
    lines.push('=== description-polish-v2 dry-run report ===');
    lines.push(`generated: ${new Date().toISOString()}`);
    lines.push(`mode: ${LIVE ? 'LIVE (will write)' : 'DRY-RUN (no writes)'}`);
    lines.push('');
    lines.push('--- STATS ---');
    lines.push(JSON.stringify(stats, null, 2));
    lines.push('');
    lines.push('--- PATTERN A SAMPLES (5) ---');
    lines.push(JSON.stringify(samplesA, null, 2));
    lines.push('');
    lines.push('--- PATTERN B SAMPLES (5) ---');
    lines.push(JSON.stringify(samplesB, null, 2));
    lines.push('');
    lines.push('--- PATTERN B ABORTED (would have left <100 chars) ---');
    lines.push(JSON.stringify(skipsB, null, 2));
    const report = lines.join('\n');

    // Always write the report so we can inspect dry-run results.
    fs.writeFileSync(REPORT, report);

    // Print to stdout too.
    console.log(report);
    console.log(`\nReport written: ${REPORT}`);

    if (LIVE) {
        fs.writeFileSync(BACKUP, fs.readFileSync(FILE));
        fs.writeFileSync(FILE, JSON.stringify(out, null, 2));
        console.log(`\nLIVE mode: wrote ${out.length} tours to ${FILE} (backup at ${BACKUP})`);
    } else {
        console.log('\nDry-run complete. Review scripts-staging/polish-v2-dryrun-pr.txt before running with --live.');
    }
}

main();
