// s53-weng-schema-gate: three-state census + both-directions proof.
// Runs the ORIGIN/MAIN emitter (app-main-baseline.js, byte snapshot of
// origin/main:app.js) and the branch emitter (app.js) side by side over the
// real emitting population (loadTours()'s draw-pool filter + generateTourSchema's
// own emitPrice gate), then asserts:
//   - the three states partition the pool exactly (no row in two, none in zero)
//   - every pool row emitted a bare Offer.price BEFORE (the before-picture)
//   - state 1 rows emit schema byte-identical to before
//   - state 2 rows with a card unit emit UnitPriceSpecification whose unitText
//     is the card string verbatim, and no bare Offer.price
//   - state 2 rows without a mirrorable card unit, and all state 3 rows, emit
//     no offers key at all
// Prints counts + face value per state and three named fixture firings.
// usage: node census.mjs <app.js> <app-main-baseline.js> <tours-data.json>
// (app-main-baseline.js is not committed; regenerate with
//  git show origin/main:app.js > scripts/evidence/s53-weng-schema-gate/app-main-baseline.js)
import fs from 'fs';
import vm from 'vm';

const [appPath, basePath, dataPath] = process.argv.slice(2);

function load(path, names) {
    const src = fs.readFileSync(path, 'utf8');
    const noop = () => {};
    const el = { addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], classList: { add: noop, remove: noop }, getElementById: () => null, style: {} };
    const ctx = { console, document: { ...el, body: el }, window: { addEventListener: noop, scrollY: 0, gtag: noop }, sessionStorage: { getItem: () => null, setItem: noop }, localStorage: { getItem: () => null, setItem: noop }, fetch: () => new Promise(() => {}), gtag: noop, setTimeout, URL, Number, JSON, Math, String, Array, Object };
    vm.createContext(ctx);
    vm.runInContext(src + `\n;globalThis.__x={${names.join(',')}};`, ctx);
    return ctx.__x;
}

const cur = load(appPath, ['generateTourSchema', 'priceUnit', 'unitStateFromEvidence', 'classifyUnitText', 'CURRENCY_SYMBOL']);
const base = load(basePath, ['generateTourSchema', 'CURRENCY_SYMBOL']);

const d = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const rows = Array.isArray(d) ? d : d.tours;

// The loadTours() draw-pool filter (app.js:145) + generateTourSchema's own
// emitPrice gate (app.js:221-222), verbatim. Cards -- and therefore JSON-LD --
// render a bare price only for these rows: the emitting population.
const emits = (t, sym) => t.status !== 'inactive' && !t.bookingDead
    && Number.isFinite(t.price) && t.priceConfidence !== 'low'
    && Object.prototype.hasOwnProperty.call(sym, t.currency);
const pool = rows.filter(t => emits(t, cur.CURRENCY_SYMBOL));
const basePool = rows.filter(t => emits(t, base.CURRENCY_SYMBOL));
if (pool.length !== basePool.length) throw new Error(`pool drift: ${pool.length} vs baseline ${basePool.length}`);

let fail = 0;
const err = (msg) => { fail++; console.error('ASSERT FAIL: ' + msg); };

const tallies = {
    'per-person': { n: 0, face: 0 },
    'non-per-person-spec': { n: 0, face: 0 },     // 2a: card unit mirrored
    'non-per-person-silent': { n: 0, face: 0 },   // 2b: no mirrorable card unit
    'none': { n: 0, face: 0 }
};
const fixtures = {};

for (const t of pool) {
    const state = cur.unitStateFromEvidence(t);

    // Partition proof: membership in exactly one of the three states.
    const membership = ['per-person', 'non-per-person', 'none'].filter(s => s === state).length;
    if (membership !== 1) err(`pk ${t.pk}: in ${membership} states`);

    const oldSchema = base.generateTourSchema(t);
    const newSchema = cur.generateTourSchema(t);
    const oldJson = JSON.stringify(oldSchema);
    const newJson = JSON.stringify(newSchema);

    // Before-picture: today every pool row emits a bare Offer.price.
    if (!oldSchema.offers || !('price' in oldSchema.offers)) err(`pk ${t.pk}: baseline emitted no bare price`);

    const cardUnit = cur.priceUnit(t);
    if (state === 'per-person') {
        tallies['per-person'].n++; tallies['per-person'].face += t.price;
        if (newJson !== oldJson) err(`pk ${t.pk}: state-1 schema not byte-identical`);
        if (!fixtures.perPerson) fixtures.perPerson = { t, oldSchema, newSchema, identical: newJson === oldJson };
    } else if (state === 'non-per-person') {
        const spec = newSchema.offers && newSchema.offers.priceSpecification;
        if (cardUnit && cur.classifyUnitText(cardUnit) !== 'per-person') {
            tallies['non-per-person-spec'].n++; tallies['non-per-person-spec'].face += t.price;
            if (!spec) err(`pk ${t.pk}: state-2a missing priceSpecification`);
            else {
                if (spec['@type'] !== 'UnitPriceSpecification') err(`pk ${t.pk}: wrong spec @type`);
                if (spec.unitText !== cardUnit) err(`pk ${t.pk}: unitText "${spec.unitText}" != card "${cardUnit}"`);
                if (spec.price !== t.price) err(`pk ${t.pk}: spec price mismatch`);
                if (spec.priceCurrency !== t.currency) err(`pk ${t.pk}: spec currency "${spec.priceCurrency}" != row "${t.currency}"`);
            }
            if (newSchema.offers && 'price' in newSchema.offers) err(`pk ${t.pk}: state-2a leaked bare Offer.price`);
            if (!fixtures.wholeUnit && /private|hire|rental/i.test(cardUnit)) fixtures.wholeUnit = { t, oldSchema, newSchema };
        } else {
            tallies['non-per-person-silent'].n++; tallies['non-per-person-silent'].face += t.price;
            if (newJson.includes('"offers"')) err(`pk ${t.pk}: state-2b emitted offers`);
        }
    } else {
        tallies.none.n++; tallies.none.face += t.price;
        if (newJson.includes('"offers"')) err(`pk ${t.pk}: state-3 emitted offers`);
        if (!fixtures.noEvidence) fixtures.noEvidence = { t, oldSchema, newSchema };
    }
}

const s2n = tallies['non-per-person-spec'].n + tallies['non-per-person-silent'].n;
const s2face = tallies['non-per-person-spec'].face + tallies['non-per-person-silent'].face;
const total = tallies['per-person'].n + s2n + tallies.none.n;
if (total !== pool.length) err(`partition sum ${total} != pool ${pool.length}`);

const money = (x) => '£' + x.toLocaleString('en-GB', { maximumFractionDigits: 2 });
console.log(`pool (emitting population): ${pool.length} of ${rows.length} rows; baseline emitted a bare Offer.price on all ${pool.length}`);
console.log('');
console.log('state 1 per-person asserted      :', tallies['per-person'].n, 'rows, face', money(tallies['per-person'].face), '-> bare Offer.price, byte-identical');
console.log('state 2 non-per-person asserted  :', s2n, 'rows, face', money(s2face));
console.log('  2a card unit mirrored          :', tallies['non-per-person-spec'].n, 'rows, face', money(tallies['non-per-person-spec'].face), '-> UnitPriceSpecification, unitText = card string verbatim');
console.log('  2b no mirrorable card unit     :', tallies['non-per-person-silent'].n, 'rows, face', money(tallies['non-per-person-silent'].face), '-> no price emitted');
console.log('state 3 no unit evidence         :', tallies.none.n, 'rows, face', money(tallies.none.face), '-> no price emitted');

// Per-state evidence-string tallies so a wrong verdict is visible by eye: for
// each row, the string that decided its state (first source returning the
// state's verdict), or the priceLabel/anchor for state-3 rows.
const deciders = { 'per-person': new Map(), 'non-per-person': new Map(), none: new Map() };
for (const t of pool) {
    const state = cur.unitStateFromEvidence(t);
    const pb = Array.isArray(t.priceBreakdown) ? t.priceBreakdown : [];
    const anchor = pb.find(p => p.price === t.price);
    const sources = [cur.priceUnit(t), (t.priceLabel || '').trim(), anchor ? (anchor.singular || '').trim() : ''];
    const key = state === 'none'
        ? (sources[1] || sources[2] || '<empty>')
        : sources.find(s => cur.classifyUnitText(s) === state);
    deciders[state].set(key, (deciders[state].get(key) || 0) + 1);
}
for (const [state, m] of Object.entries(deciders)) {
    console.log(`\n== deciding evidence strings, state ${state} (${m.size} distinct) ==`);
    [...m.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`${String(n).padStart(5)}  ${k}`));
}

for (const [name, fx] of Object.entries(fixtures)) {
    console.log(`\n=== fixture: ${name} — pk ${fx.t.pk} "${fx.t.name}" price ${fx.t.currency}${fx.t.price} ===`);
    console.log('  evidence: priceUnit=' + JSON.stringify(cur.priceUnit(fx.t)) + ' priceLabel=' + JSON.stringify(fx.t.priceLabel ?? null)
        + ' anchorSingular=' + JSON.stringify((Array.isArray(fx.t.priceBreakdown) ? fx.t.priceBreakdown : []).find(p => p.price === fx.t.price)?.singular ?? null));
    console.log('  before offers:', JSON.stringify(fx.oldSchema.offers ?? null));
    console.log('  after  offers:', JSON.stringify(fx.newSchema.offers ?? null));
    if ('identical' in fx) console.log('  full schema byte-identical to baseline:', fx.identical);
}

if (fail) { console.error(`\n${fail} assertion failure(s)`); process.exit(1); }
console.log('\nall assertions passed: partition exact, state-1 byte-identical, state-2a verbatim card unitText + no bare price, state-2b/3 no price key');
