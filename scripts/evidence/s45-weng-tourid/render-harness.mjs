// Evaluate app.js's renderer in node (served-bytes substitution — Chrome disconnected).
import fs from 'fs'; import vm from 'vm';
const [,, appPath, dataPath, outPath] = process.argv;
const src = fs.readFileSync(appPath,'utf8');
const d = JSON.parse(fs.readFileSync(dataPath,'utf8'));
const noop=()=>{}; const el={addEventListener:noop,querySelector:()=>null,querySelectorAll:()=>[],classList:{add:noop,remove:noop},getElementById:()=>null,style:{}};
const gtagCalls=[];
const ctx={console,document:{...el,addEventListener:noop,querySelector:()=>null,getElementById:()=>null,body:el},window:{addEventListener:noop,scrollY:0},sessionStorage:{getItem:()=>null,setItem:noop},localStorage:{getItem:()=>null,setItem:noop},fetch:()=>new Promise(()=>{}),gtag:(...a)=>gtagCalls.push(a),setTimeout,URL,Number,JSON,Math,String,Array,Object};
ctx.window.gtag=ctx.gtag;
vm.createContext(ctx);
vm.runInContext(src+'\n;globalThis.__x={createTourCard,generateTourSchema,trackTourBooking};', ctx);
const {createTourCard,generateTourSchema,trackTourBooking}=ctx.__x;
// tracking.js readContext, mirrored: id = link.dataset.tourId || href || 'unknown'
const attr=(html,n)=>{const m=html.match(new RegExp(n+'="([^"]*)"'));return m?m[1]:null;};
const out={};
for(const t of d.tours){
  const html=createTourCard(t);
  const dataId=attr(html,'data-id'), dtid=attr(html,'data-tour-id'), href=attr(html,'href');
  const schema=generateTourSchema(t);
  gtagCalls.length=0; trackTourBooking(t); const payload=gtagCalls[0]?.[2];
  out[t.pk]={legacy:!!t.id, html, dataId, dataTourId:dtid, liveTourId: dtid||href||'unknown', schema, deadPathTourId: payload?.tour_id};
}
fs.writeFileSync(outPath, JSON.stringify(out));
const rows=Object.values(out);
const sum={rows:rows.length, legacy:rows.filter(r=>r.legacy).length,
 dataId_undefined:rows.filter(r=>r.dataId==='undefined').length,
 dataTourId_empty:rows.filter(r=>r.dataTourId==='').length,
 liveTourId_isHref:rows.filter(r=>r.liveTourId===attr(r.html,'href')).length,
 liveTourId_pkPrefixed:rows.filter(r=>/^pk:\d+$/.test(r.liveTourId)).length,
 deadPath_tourId_undefined:rows.filter(r=>r.deadPathTourId===undefined).length,
 provider_nameless:rows.filter(r=>r.schema.provider && !r.schema.provider.name).length,
 provider_absent:rows.filter(r=>!r.schema.provider).length,
 provider_named:rows.filter(r=>r.schema.provider?.name).length};
console.log(JSON.stringify(sum));
