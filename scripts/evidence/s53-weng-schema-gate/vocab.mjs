// s53-weng-schema-gate: vocabulary census over the emitting population's own
// unit-evidence fields, before any classifier word list is written. Ported
// from wanderhawaii PR #263 (s53-whaw-schema-gate/vocab.mjs) for this repo's
// pool definition.
// usage: node vocab.mjs <app.js> <tours-data.json> <out.txt>
import fs from 'fs';
import vm from 'vm';

const [appPath, dataPath, outPath] = process.argv.slice(2);
const noop = () => {};
const el = { addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], classList: { add: noop, remove: noop }, getElementById: () => null, style: {} };
const ctx = { console, document: { ...el, body: el }, window: { addEventListener: noop, scrollY: 0, gtag: noop }, sessionStorage: { getItem: () => null, setItem: noop }, localStorage: { getItem: () => null, setItem: noop }, fetch: () => new Promise(() => {}), gtag: noop, setTimeout, URL, Number, JSON, Math, String, Array, Object };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(appPath, 'utf8') + '\n;globalThis.__x={generateTourSchema,priceUnit,CURRENCY_SYMBOL};', ctx);
const { priceUnit, CURRENCY_SYMBOL } = ctx.__x;

const d = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const rows = Array.isArray(d) ? d : d.tours;

// The loadTours() draw-pool filter (app.js:145), plus generateTourSchema's own
// emitPrice gate (app.js:221-222) -- together, the emitting population: rows
// whose card and JSON-LD actually carry a price today.
const pool = rows.filter(t => t.status !== 'inactive' && !t.bookingDead
    && Number.isFinite(t.price) && t.priceConfidence !== 'low'
    && Object.prototype.hasOwnProperty.call(CURRENCY_SYMBOL, t.currency));

const lines = [];
lines.push(`pool (emitting population): ${pool.length} of ${rows.length} rows`);
lines.push('');

function tally(name, values) {
    const m = new Map();
    for (const v of values) {
        const key = v && v.trim() ? v.trim() : '<empty>';
        m.set(key, (m.get(key) || 0) + 1);
    }
    lines.push(`== ${name} (${m.size} distinct) ==`);
    [...m.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => lines.push(`${String(n).padStart(5)}  ${k}`));
    lines.push('');
}

tally('priceUnit (_unknownFields.priceUnit via priceUnit()) (N distinct)'.replace(' (N distinct)', ''), pool.map(t => priceUnit(t)));
tally('priceLabel', pool.map(t => t.priceLabel || ''));
tally('anchor tier singular (priceBreakdown tier whose price == emitted price)', pool.map(t => {
    const pb = Array.isArray(t.priceBreakdown) ? t.priceBreakdown : [];
    const anchor = pb.find(p => p.price === t.price);
    return anchor ? (anchor.singular || '') : '';
}));

fs.writeFileSync(outPath, lines.join('\n') + '\n');
console.log(lines.slice(0, 2).join('\n'));
