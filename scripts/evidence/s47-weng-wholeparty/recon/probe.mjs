import fs from 'fs';
const S='/private/tmp/claude-501/-Users-jasondudney-repos-wanderengland/b40bc00b-a7f7-4f60-b0fa-070083299fbb/scratchpad';
const L=JSON.parse(fs.readFileSync(S+'/classified.json','utf8'));
const sample=JSON.parse(fs.readFileSync(S+'/probe-sample.json','utf8'));
const pks=new Set(Object.values(sample).flat());
const rows=L.filter(x=>pks.has(x.pk));
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const dates=[];{const d=new Date('2026-08-24T00:00:00Z');for(let i=0;i<17;i++){dates.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+7);}}
const bySn=new Map();
for(const r of rows){const m=r.bookingUrl.match(/fareharbor\.com\/(?:embeds\/book\/)?([^/]+)\/items\/(\d+)/);if(!m||Number(m[2])!==r.pk){console.error('bad url',r.pk);process.exit(2);}if(!bySn.has(m[1]))bySn.set(m[1],[]);bySn.get(m[1]).push(r);}
const out={probedAt:new Date().toISOString(),dates,perPk:{}};
for(const r of rows)out.perPk[r.pk]={cls:r.cls,name:r.name,stored:r.tiers,storedPrice:r.price,storedCurrency:r.currency,probes:[]};
let n=0;
for(const [sn,rs] of bySn){
  const ids=rs.map(r=>r.pk).join(',');
  for(const date of dates){
    const url=`https://fareharbor.com/api/embed/${sn}/price-preview/per-item/v2/?item_pks=${ids}&include_breakdown=yes&date=${date}`;
    let j=null,err=null;
    try{const ac=new AbortController();const t=setTimeout(()=>ac.abort(),25000);const resp=await fetch(url,{headers:{'User-Agent':UA,Accept:'application/json'},signal:ac.signal});clearTimeout(t);if(resp.status!==200)err='HTTP '+resp.status;else j=await resp.json();}catch(e){err=String(e.message);}
    n++;
    const items=new Map((j?.items||[]).map(it=>[Number(it.id),it]));
    for(const r of rs){
      const it=items.get(r.pk);
      const p={requested:date,error:err,absent:!err&&!it,liveCurrency:j?.details?.currency??null};
      if(it){const sa=it.availability?.start_at||null;p.start_at=sa;p.dateValid=!!sa&&sa.slice(0,10)===date;
        const cts=Array.isArray(it.price?.breakdown?.customer_types)?it.price.breakdown.customer_types:[];
        p.tiers=cts.map(c=>({singular:c.singular,note:c.note,priceCents:c.price,min:c.min_party_size}));p.zeroOnly=!cts.some(c=>c.price>0);p.low=it.price?.low??null;}
      out.perPk[r.pk].probes.push(p);
    }
    await sleep(1000);
  }
  process.stderr.write(`${sn} done (${n} req)\n`);
}
fs.writeFileSync(S+'/probe-results.json',JSON.stringify(out,null,1));
console.log('DONE requests',n);
