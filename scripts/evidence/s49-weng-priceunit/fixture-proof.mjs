// s49-weng-priceunit: node vm proof — a fixture row WITH _unknownFields.priceUnit renders
// the <small> unit; one WITHOUT renders byte-identical to the pre-port renderer.
import fs from 'fs'; import vm from 'vm'; import { execSync } from 'child_process';
const load = src => { const noop=()=>{}; const el={addEventListener:noop,querySelector:()=>null,querySelectorAll:()=>[],classList:{add:noop,remove:noop},getElementById:()=>null,style:{}};
  const ctx={console,document:{...el,body:el},window:{addEventListener:noop,scrollY:0,gtag:noop},sessionStorage:{getItem:()=>null,setItem:noop},localStorage:{getItem:()=>null,setItem:noop},fetch:()=>new Promise(()=>{}),gtag:noop,setTimeout,URL,Number,JSON,Math,String,Array,Object};
  vm.createContext(ctx); vm.runInContext(src+'\n;globalThis.__x={createTourCard,formatPrice,priceUnit:typeof priceUnit==="function"?priceUnit:null};',ctx); return ctx.__x; };
const after = load(fs.readFileSync('app.js','utf8'));
const before = load(execSync('git show origin/main:app.js').toString());
const base = { pk:'fx-1', id:'fx-1', name:'Fixture <Tour>', description:'d', location:'London', island:'england', price:120, currency:'GBP', priceConfidence:'high', bookingUrl:'https://x/', tags:[] };
const withUnit = { ...base, _unknownFields:{ priceUnit:'  per boat · up to 6 people  ' } };
const noUnit = { ...base, _unknownFields:{ priceLabel:'per group' } };
const priceDiv = h => h.match(/<div class="tour-price">(.*?)<\/div>/)[1];
const r = { withUnit_after: priceDiv(after.createTourCard(withUnit)), withUnit_before: priceDiv(before.createTourCard(withUnit)),
  noUnit_after: priceDiv(after.createTourCard(noUnit)), noUnit_before: priceDiv(before.createTourCard(noUnit)),
  noUnit_fullcard_identical: after.createTourCard(noUnit) === before.createTourCard(noUnit),
  withUnit_escaped: priceDiv(after.createTourCard({...base,_unknownFields:{priceUnit:'<b>x</b>'}})),
  nonstring_unit: after.priceUnit({_unknownFields:{priceUnit:42}}), blank_unit: after.priceUnit({_unknownFields:{priceUnit:'   '}}), no_uf: after.priceUnit({}),
  formatPrice_src_identical: after.formatPrice.toString() === before.formatPrice.toString(),
  formatPrice_samples: [[120,'high','GBP'],[120,'high','EUR'],[120,'high','XXX'],[120,'low','GBP'],[0,'high','GBP']].map(a => [a, after.formatPrice(...a), before.formatPrice(...a)]) };
const ok = r.withUnit_after === 'From £120<small>per boat · up to 6 people</small>' && r.withUnit_before === 'From £120'
  && r.noUnit_after === 'From £120' && r.noUnit_fullcard_identical && r.withUnit_escaped === 'From £120<small>&lt;b&gt;x&lt;/b&gt;</small>'
  && r.nonstring_unit === '' && r.blank_unit === '' && r.no_uf === '' && r.formatPrice_src_identical
  && r.formatPrice_samples.every(([,a,b]) => a === b);
r.PASS = ok; console.log(JSON.stringify(r, null, 1)); process.exit(ok ? 0 : 1);
