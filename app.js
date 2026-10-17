/* Multi-Asset Liquidity Radar v1.1.1 — multi-row watchlist dashboard.
 * Uses original source's existing Pionex, CoinGlass, BTC-model algorithms.
 * No K-line charts, no frozen snapshots, no overnight settlements.
 */
(()=>{'use strict';
 const $=id=>document.getElementById(id);
 const MS=900000,H=3600000,DAY=86400000;
 const WORKER='https://white-meadow-16bc.youjianchonglangshou.workers.dev';
 const SCANNER='https://scanner.tradingview.com/crypto/scan';
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 const priceEnough=p=>Number.isFinite(p)&&p>0;
 const livePrice=r=>r.priceAt&&Date.now()-r.priceAt<90000&&priceEnough(r.price)?r.price:null;
 const MONEY=n=>{if(!priceEnough(n))return '--';const abs=Math.abs(n),digits=abs>=100?2:abs>=1?4:abs>=.01?6:abs>=.0001?8:Math.min(16,Math.max(11,Math.ceil(-Math.log10(Math.max(abs,1e-16)))+5));return '$'+n.toLocaleString('en-US',{maximumFractionDigits:digits,minimumFractionDigits:abs>=100?2:0});};
 const pct=n=>Number.isFinite(n)?n.toFixed(2)+'%':'--';
 const tpe=t=>new Date(t).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
 const json=async(url,opts={},timeout=11000)=>{const ctrl=new AbortController(),tm=setTimeout(()=>ctrl.abort(),timeout);try{const r=await fetch(url,{...opts,signal:ctrl.signal,cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);const j=await r.json();if(j?.ok===false||j?.result===false)throw Error(String(j.error||j.message||'API失敗'));return j;}finally{clearTimeout(tm);}};
 const providerOverrides=Object.freeze({WTI:{tv:'PIONEX:CLUSDT.P',pionex:'WTI_USDT_PERP',cg:['CL']},CL:{tv:'PIONEX:CLUSDT.P',pionex:'WTI_USDT_PERP',cg:['CL']}});
 function canonical(s){const over=providerOverrides[String(s.id).toUpperCase()];return over?{...s,...over,cg:[...new Set([...over.cg,...(s.cg||[])])]}:{...s};}
 const entries=Array.isArray(window.LIQ_SYMBOLS)?window.LIQ_SYMBOLS.map(canonical):[];
 const records=entries.map((s,index)=>({s,index,id:s.id,price:null,priceAt:0,priceFeed:'',bars15:[],daily:[],barsAt:0,dailyAt:0,ha:null,model:null,up:null,down:null,source:'none',cgId:'',cgFactor:1,upAmount:null,downAmount:null,zones:{upper:[],lower:[]},issue:'',errors:{},lastAttempt:{},dom:null}));
 const state={cgRecords:new Map(),cgAt:0,cgVersion:'',cgError:'尚未取得',cgBusy:null,group:'all',search:'',sort:'watchlist',sortDir:1,diagDirty:false,priceAt:0,priceBusy:null,loadingJobs:0,queue:[],jobSet:new Set(),networkLog:[],renderAt:0};
 const currentRows=()=>records.filter(r=>(state.group==='all'||r.s.group===state.group)&&(!state.search||r.id.toUpperCase().includes(state.search)||r.s.cg.some(x=>x.toUpperCase().includes(state.search))));
 const sourceName=r=>r.source==='coinglass'?'CoinGlass 24H':r.source==='proxy'?'15M 代理估算':'等待上下界';
 // Ring-style bounded diagnostics: at most 32 entries. Avoid writing large text nodes
 // every 10 seconds when the panel is closed; entries are never persisted to storage.
 const LOG_CAP=32;
 function log(msg){
   const stamp=new Date().toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
   state.networkLog.push(`[${stamp}] ${String(msg).slice(0,230)}`);
   if(state.networkLog.length>LOG_CAP)state.networkLog.splice(0,state.networkLog.length-LOG_CAP);
   state.diagDirty=true;
   const count=$('diagCount');if(count)count.textContent=state.networkLog.length;
   if($('diagPanel')?.open)renderDiag();
 }
 function renderDiag(){
   if(!$('diagnostics')||!state.diagDirty)return;
   $('diagnostics').textContent=state.networkLog.join('\n')||'無診斷訊息';
   state.diagDirty=false;
 }
  const FR='~m~';const textBytes=x=>new TextEncoder().encode(String(x)).length;
  function frame(value){const p=typeof value==='string'?value:JSON.stringify(value);return FR+textBytes(p)+FR+p;}
  function pkt(method,params){return frame(JSON.stringify({m:method,p:params}));}
  function unpack(source){const out=[];let start=0;while(start<source.length){const at=source.indexOf(FR,start);if(at<0)break;const sep=source.indexOf(FR,at+FR.length);if(sep<0)break;const byteLen=Number(source.slice(at+FR.length,sep));if(!Number.isSafeInteger(byteLen)||byteLen<0||byteLen>10000000)break;let k=sep+FR.length,n=0;while(k<source.length&&n<byteLen){const cp=source.codePointAt(k),ch=String.fromCodePoint(cp);n+=textBytes(ch);k+=ch.length;}if(n!==byteLen)break;out.push(source.slice(sep+FR.length,k));start=k;}return out;}
  function tvRow(row){const a=Array.isArray(row)?row:row?.v;if(!Array.isArray(a)||a.length<6)return null;const shift=a.length>=7?1:0;let t=+a[shift];if(t>0&&t<1e12)t*=1000;const o=+a[shift+1],h=+a[shift+2],l=+a[shift+3],c=+a[shift+4],v=+a[shift+5]||0;if(![t,o,h,l,c].every(Number.isFinite)||o<=0||h<l||l<=0||c<=0||h<o||h<c)return null;return {t,o,h,l,c,v};}
  function normalize(rows){const m=new Map();for(const r of rows){if(r&&r.t>0&&Number.isFinite(r.c)&&r.c>0)m.set(r.t,r);}return [...m.values()].sort((a,b)=>a.t-b.t);}
  // Reusable version of BTC_iquidation Pionex WS chart reader, parameterized by symbol and resolution.
  function tvBars(symbol,resolution,count=530,timeout=17000){return new Promise((resolve,reject)=>{
    const url=new URL(WORKER);url.protocol='wss:';url.pathname='/api/monitor/tv-chart-ws';url.search='';
    let ws;try{ws=new WebSocket(url.toString());}catch(e){reject(e);return;}
    const sess='cs_'+Math.random().toString(36).slice(2),sym='symbol_1',series='series_1',received=new Map();let ended=false;
    const timer=setTimeout(()=>fail(new Error('TradingView K 線逾時')),timeout);
    const done=()=>{if(ended)return;ended=true;clearTimeout(timer);try{ws.close();}catch{};const bars=normalize([...received.values()]).slice(-count);if(bars.length<2){reject(Error('TradingView 無足夠K線'));return;}resolve({bars,feed:symbol+' · TV圖表'});};
    const fail=e=>{if(ended)return;ended=true;clearTimeout(timer);try{ws.close();}catch{}reject(e);};
    ws.addEventListener('open',()=>{try{ws.send(pkt('set_auth_token',['unauthorized_user_token']));ws.send(pkt('chart_create_session',[sess,'']));ws.send(pkt('switch_timezone',[sess,'Etc/UTC']));ws.send(pkt('resolve_symbol',[sess,sym,'='+JSON.stringify({symbol,adjustment:'splits',session:'regular'})]));ws.send(pkt('create_series',[sess,series,'s1',sym,resolution,count,'']));}catch(e){fail(e);}});
    ws.addEventListener('message',async e=>{try{const data=typeof e.data==='string'?e.data:e.data instanceof Blob?await e.data.text():new TextDecoder().decode(e.data);for(const p of unpack(String(data))){if(p.startsWith('~h~')){ws.send(frame(p));continue;}let d;try{d=JSON.parse(p);}catch{continue;}if(['protocol_error','critical_error','symbol_error','series_error'].includes(d.m)){fail(Error('TV圖表錯誤 '+d.m));return;}const items=d.p||[];if(d.m==='timescale_update'&&items[0]===sess){for(const raw of items?.[1]?.[series]?.s||[]){const c=tvRow(raw);if(c)received.set(c.t,c);}}if(d.m==='series_completed'&&items[0]===sess&&items[1]===series){done();return;}}}catch(ex){fail(ex);}});
    ws.addEventListener('error',()=>fail(Error('TradingView WebSocket 連線失敗')));ws.addEventListener('close',()=>{if(!ended)fail(Error('TradingView 連線提前關閉'));});
  });}
  function parseRest(data){const arr=data?.data?.klines||data?.klines||[];if(!Array.isArray(arr))return [];return normalize(arr.map(r=>{let t=Number(Array.isArray(r)?r[0]:r.time??r.ts??r.t);if(t>0&&t<1e12)t*=1000;const a=Array.isArray(r)?r.slice(1):[r.open,r.high,r.low,r.close,r.volume];return {t,o:+a[0],h:+a[1],l:+a[2],c:+a[3],v:+(a[4]||0)};}).filter(r=>[r.t,r.o,r.h,r.l,r.c].every(Number.isFinite)&&r.o>0&&r.c>0&&r.h>=r.l));}
  async function restBars(s,interval,count){const u=new URL('/api/monitor/klines',WORKER);u.searchParams.set('symbol',s.pionex);u.searchParams.set('interval',interval);u.searchParams.set('limit',String(Math.min(count,300)));
    let r;try{r=await json(u.toString(),{},11000);}catch(e){throw Error('SState Worker '+interval+'：'+(e?.message||e));}
    const bars=parseRest(r);if(bars.length<2)throw Error('SState Worker '+interval+'：K線無效');return {bars,feed:'Pionex Worker / '+interval+(r.source?' · '+r.source:''),warning:r.refresh_error||null};}
  // SStateMarketTerminal's Python analysis calls this same Pionex public K-line REST endpoint.
  // It does NOT need a TradingView ticker to exist, e.g. WTI_USDT_PERP may be valid on Pionex
  // while PIONEX:WTIUSDT.P gets symbol_error from TradingView. Browser CORS may still block direct
  // requests; in that case we fall back to the SState Worker and do not pretend the feed worked.
  async function pionexDirectBars(s,interval,count){
    const u=new URL('https://api.pionex.com/api/v1/market/klines');
    u.searchParams.set('symbol',s.pionex);u.searchParams.set('interval',interval);
    u.searchParams.set('limit',String(Math.min(count,500)));
    let r;try{r=await json(u.toString(),{headers:{Accept:'application/json'}},10500);}catch(e){throw Error('Pionex REST '+interval+'（瀏覽器可能受 CORS 限制）：'+(e?.message||e));}
    const bars=parseRest(r);if(bars.length<2)throw Error('Pionex REST '+interval+'：K線不足');
    return {bars,feed:'Pionex 官方 REST '+interval};
  }
  async function binanceBars(s,interval,count){const symbol=s.id+'USDT',tf=interval==='15M'?'15m':interval==='4H'?'4h':'1d';let last='';for(const base of ['https://fapi.binance.com/fapi/v1/klines','https://data-api.binance.vision/api/v3/klines']){
    try{const u=new URL(base);u.searchParams.set('symbol',symbol);u.searchParams.set('interval',tf);u.searchParams.set('limit',String(Math.min(800,count)));const arr=await json(u.toString(),{},9000);const bars=normalize(arr.map(r=>({t:+r[0],o:+r[1],h:+r[2],l:+r[3],c:+r[4],v:+r[5]})));if(bars.length<35)throw Error('根數不足');return {bars,feed:base.includes('fapi')?'Binance PERP 歷史備援':'Binance SPOT 歷史備援'};}catch(e){last=e.message;}}
    throw Error(last||'Binance K線失敗');}
  async function loadHistory(s,interval,count){
    const issues=[];
    const byTv=()=>tvBars(s.tv,interval==='15M'?'15':interval==='4H'?'240':'1D',count);
    // WTI/CL has a VERIFIED TradingView ticker PIONEX:CLUSDT.P. Read it first.
    // Other tokenized assets retain official Pionex REST first until verified TV aliases exist.
    // Crypto keeps its existing TV-first behavior.
    const isOilAlias=s.group==='stock'&&(s.id==='WTI'||s.id==='CL');
    const sources=isOilAlias
      ? [['TradingView',byTv],['Pionex 官方',()=>pionexDirectBars(s,interval,count)],['SState Worker',()=>restBars(s,interval,count)]]
      : s.group==='stock'
        ? [['Pionex 官方',()=>pionexDirectBars(s,interval,count)],['SState Worker',()=>restBars(s,interval,count)],['TradingView',byTv]]
        : [['TradingView',byTv],['SState Worker',()=>restBars(s,interval,count)],['Pionex 官方',()=>pionexDirectBars(s,interval,count)]];
    for(const [name,fn] of sources){try{return await fn();}catch(e){issues.push(name+': '+(e?.message||e));}}
    if(s.group==='crypto')try{return await binanceBars(s,interval,count);}catch(e){issues.push('Binance: '+(e?.message||e));}
    throw Error(interval+' 無法取得：'+issues.join(' / '));
  }
  function extractCG(data){const records=new Map(),seen=new WeakSet();const keys=['symbol','coin','currency','baseCoin','baseAsset'];
    function walk(obj,d){if(!obj||typeof obj!=='object'||d>9||seen.has(obj))return;seen.add(obj);
      if(!Array.isArray(obj)){
        const symbol=String(keys.map(k=>obj[k]).find(x=>typeof x==='string'&&x.trim())||'').toUpperCase().replace(/[\s/_-]/g,'');
        const read=n=>{if(typeof n==='string')n=n.replaceAll(',','').replaceAll('$','');const v=Number(n);return Number.isFinite(v)&&v>0?v:null;};
        const upper=read(obj.maxLongLiquidationPrice??obj.short_max_pain_liq_price??obj.shortMaxPainLiqPrice),lower=read(obj.maxShortLiquidationPrice??obj.long_max_pain_liq_price??obj.longMaxPainLiqPrice);
        if(symbol&&upper&&lower&&upper>lower){records.set(symbol,{upper,lower,upAmount:read(obj.maxLongLiquidationLevel??obj.short_max_pain_liq_level??obj.shortMaxPainLiqLevel),downAmount:read(obj.maxShortLiquidationLevel??obj.long_max_pain_liq_level??obj.longMaxPainLiqLevel),ref:read(obj.price),coinGlassId:symbol});}
      }
      for(const v of Object.values(obj))if(v&&typeof v==='object')walk(v,d+1);
    }walk(data,0);return records;}
  function resolveCG(s,records){
    if(!s||!(records instanceof Map))return null;
    const aliases=[...new Set([...(s.cg||[]).map(x=>String(x).toUpperCase()),
      ...(s.group==='crypto'?['1000'+s.id]:[])])];
    for(const id of aliases){
      const row=records.get(id);
      if(!row)continue;
      let factor=1;
      const lot=id.match(/^(\d+)([A-Z].*)$/);
      if(s.group==='crypto'&&lot&&lot[2]===s.id&&+lot[1]>1)factor=+lot[1];
      // Explicit per-symbol scale may be supplied in symbols.js later, but not required for PEPE.
      if(Number.isFinite(Number(s.cgPriceUnit))&&Number(s.cgPriceUnit)>0)factor=Number(s.cgPriceUnit);
      return {...row,upper:row.upper/factor,lower:row.lower/factor,
        ref:row.ref?row.ref/factor:null,sourceId:id,unitFactor:factor};
    }
    return null;
  }
  function candidateZones(bars,price){const result={upper:[],lower:[]};if(!priceEnough(price)||!bars.length)return result;
    const buckets={upper:new Map(),lower:new Map()},minStep=price*.0018;
    const last=bars.at(-1).t,validV=bars.filter(b=>Number.isFinite(b.v)&&b.v>0).map(b=>b.v).sort((a,b)=>a-b),med=validV.length>bars.length*.55?validV[Math.floor(validV.length/2)]:0;
    const levs=[[25,.28],[50,.34],[75,.24],[100,.14]];
    for(const b of bars.slice(-288)){
      const age=(last-b.t)/H,timeWeight=Math.exp(-age/48),volWeight=med?clamp((b.v||0)/med,.25,3):1,entry=(b.h+b.l+b.c)/3;
      if(!(entry>0))continue;
      for(const [lev,w] of levs){const base=timeWeight*volWeight*w;
        for(const [dir,target] of [['upper',entry*(1+1/lev-.004)],['lower',entry*(1-1/lev+.004)]]){
          const gap=Math.abs(target/price-1);if((dir==='upper'&&target<=price)||(dir==='lower'&&target>=price)||gap<.001||gap>.06)continue;
          const k=Math.round(target/minStep),map=buckets[dir];map.set(k,(map.get(k)||0)+base);
        }
      }
    }
    for(const dir of ['upper','lower']){
      const m=buckets[dir],arr=[];for(const [i,v] of m){const total=v+.20*(m.get(i-1)||0)+.20*(m.get(i+1)||0),p=i*minStep;const dist=Math.abs(p/price-1);if(dist>.001&&total>.001)arr.push({price:p,strength:total,distance:dist,score:total/(.5+Math.sqrt(dist*100)),width:minStep});}
      arr.sort((a,b)=>b.score-a.score);const used=[];for(const item of arr){if(used.every(z=>Math.abs(z.price-item.price)>minStep*2.5)){used.push(item);if(used.length===3)break;}}
      const max=Math.max(1e-9,...used.map(z=>z.strength));result[dir]=used.map((x,i)=>({...x,power:Math.round(100*x.strength/max),tier:i+1}));
    }
    return result;
  }

 function dailyHA(r){const days=r.daily.slice().sort((a,b)=>a.t-b.t);if(days.length<26)return null;
   const now=Date.now();const currentStart=Math.floor(now/DAY)*DAY;const last=days.at(-1);
   if(priceEnough(livePrice(r))&&last&&last.t>=currentStart-DAY && last.t<=now){last.c=livePrice(r);last.h=Math.max(last.h,livePrice(r));last.l=Math.min(last.l,livePrice(r));}
   let po=null,pc=null,before=null,cur=null;
   for(const b of days){const ho=po===null?(b.o+b.c)/2:(po+pc)/2,hc=(b.o+b.h+b.l+b.c)/4;before=cur;cur={color:hc>=ho?'黃':'紫',ho,hc,t:b.t};po=ho;pc=hc;}
   return cur?{...cur,priorColor:before?.color||'--'}:null;
 }
 function updateDerived(r){r.ha=dailyHA(r);
   r.zones=candidateZones(r.bars15,livePrice(r)||r.bars15.at(-1)?.c);
   const p=livePrice(r)||r.bars15.at(-1)?.c;
   const fresh=state.cgAt>0&&Date.now()-state.cgAt<180000;
   const cg=fresh?resolveCG(r.s,state.cgRecords):null;
   r.cgId=cg?.sourceId||'';r.cgFactor=cg?.unitFactor||1;r.upAmount=cg?.upAmount||null;r.downAmount=cg?.downAmount||null;
   if(cg&&(!priceEnough(p)||(cg.upper>p&&cg.lower<p))){r.up=cg.upper;r.down=cg.lower;r.source='coinglass';r.errors.cg='';}
   else if(r.zones.upper.length&&r.zones.lower.length){r.up=r.zones.upper[0].price;r.down=r.zones.lower[0].price;r.source='proxy';r.errors.cg=!fresh?(state.cgError||'CoinGlass 更新失敗'):!cg?'CoinGlass 無此標的':'CoinGlass 價格不包住現價';}
   else{r.up=null;r.down=null;r.source='none';r.errors.cg=!fresh?(state.cgError||'CoinGlass 尚未取得'):cg?'CoinGlass 上下界不適用當前價格':'CoinGlass 無此標的／代理資料不足';}
   calcModel(r);
 }
 function calcModel(r){r.model=null;const engine=window.BTCLiqEngine,weights=window.BTCLiqModel;if(!engine?.features||!weights?.probabilities){r.errors.model='BTC 模型尚未載入';return;}
   const now=Date.now(),closed=r.bars15.filter(x=>x.t+MS<=now);if(closed.length<340){r.errors.model=`15M 歷史不足 340 根 (${closed.length})`;return;}
   const recent=closed.slice(-520);if(recent.slice(1).some((x,i)=>x.t-recent[i].t!==MS)){r.errors.model='15M K 線不連續';return;}
   const anchor=Date.parse('2032-03-08T12:00:00Z');const shifted=recent.map((x,i)=>({...x,t:anchor-(recent.length-i+1)*MS}));const when=anchor-MS+(now%MS);
   try{const f=engine.features(shifted,when,r.price||recent.at(-1).c);if(!f)throw Error('BTC 39 特徵無法組成滾動資料');const pred=weights.probabilities(f.features);const delta=r.ha?(r.ha.color==='黃'?.045:-.045):0;
     const up=clamp(pred.up+delta,0,1);r.model={up,down:1-up,rawUp:pred.up,delta,time:now};r.errors.model='';
   }catch(e){r.errors.model=String(e?.message||e);}
 }
 const setText=(element,text)=>{element.textContent=text;return element;};
 function el(tag,cls='',txt=''){const node=document.createElement(tag);if(cls)node.className=cls;if(txt)node.textContent=txt;return node;}
 function makeRow(r){const tr=el('tr');const tIndex=el('td','row-index','--');const tSymbol=el('td');const name=el('div','sym-name',r.id);const px=el('div','sym-price','--');const sf=el('div','sym-feed',r.s.group==='stock'?'Pionex 美股／商品':'Pionex 加密合約');tSymbol.append(name,px,sf);
   const tRadar=el('td');const plot=el('div','radar-area');const micro=el('div','radar-micro');const l=el('span'),rr=el('span');micro.append(l,rr);tRadar.append(plot,micro);
   const tHa=el('td');const hw=el('div','ha-wrap');const ha=el('span','ha-color unknown','--');const hn=el('div','ha-sub','等待日線');hw.append(ha,hn);tHa.append(hw);
   const tProb=el('td');const pp=el('div','prob-layout');const upBox=el('div','prob-side');const upK=el('div','prob-kicker','先上掃');const upNum=el('div','prob-num up','--');upBox.append(upK,upNum);const downBox=el('div','prob-side right');const downK=el('div','prob-kicker','先下掃');const downNum=el('div','prob-num down','--');downBox.append(downK,downNum);pp.append(upBox,downBox);const pBars=el('div','prob-bars');const pFill=el('div','prob-upbar');pBars.append(pFill);const pLabel=el('div','prob-label','BTC 模型等待中');tProb.append(pp,pBars,pLabel);
   tr.append(tIndex,tSymbol,tRadar,tHa,tProb);r.dom={tr,tIndex,name,px,sf,plot,l,rr,ha,hn,upNum,downNum,pFill,pLabel};return tr;}
 function plotRadar(r){const {plot,l,rr}=r.dom;plot.replaceChildren();const price=livePrice(r);
   if(!(priceEnough(r.up)&&priceEnough(r.down)&&priceEnough(price))){plot.append(el('div','radar-empty',!priceEnough(price)?'等待即時現價…':'等待有效上下清算界…'));l.textContent=sourceName(r);rr.textContent='';return;}
   const high=Math.max(r.up,price,r.down),low=Math.min(r.up,price,r.down),span=Math.max(high-low,price*.0005);
   // Dynamic vertical positions reflect price's distance from each boundary.
   const y=v=>clamp(14+(high-v)/span*72,14,86);
   for(const [type,val,tag] of [['up',r.up,'上'],['now',price,'NOW'],['down',r.down,'下']]){
     const line=el('div','radar-line '+type);line.style.top=y(val)+'%';line.title=tag+' '+MONEY(val);
     const label=el('div','radar-price-label '+type,tag+' '+MONEY(val));label.style.top=y(val)+'%';label.title=tag+' '+MONEY(val);
     plot.append(line,label);
   }
   const du=(r.up/price-1)*100,dd=(price/r.down-1)*100;
   l.textContent=(r.source==='coinglass'?'● CoinGlass':'● 15M代理')+' · 上 '+(Number.isFinite(du)?'+'+pct(du):'--');l.className='up';
   rr.textContent='下 -'+pct(dd)+' · '+(du<dd?'靠近上界':du>dd?'靠近下界':'等距');rr.className='down';
 }
 function renderRow(r){if(!r.dom)return;const d=r.dom;d.px.textContent=priceEnough(livePrice(r))?MONEY(r.price):(r.priceAt?'現價過期 --':'現價 --');d.sf.textContent=r.source==='coinglass'?`CoinGlass ${r.cgId} · ${r.s.tv}`:r.source==='proxy'?'15M 價格代理 · '+r.s.tv:r.s.tv;
   plotRadar(r);
   d.ha.textContent=r.ha?.color||'--';d.ha.className='ha-color '+(r.ha?.color==='黃'?'yellow':r.ha?.color==='紫'?'purple':'unknown');d.hn.textContent=r.ha?'前日 '+r.ha.priorColor+' → '+r.ha.color:(r.errors.day?'日線取得失敗':'等待日線');d.hn.className='ha-sub '+(r.ha?.color==='黃'?'yellow':r.ha?.color==='紫'?'purple':'');
   const m=r.model,valid=m&&priceEnough(r.up)&&priceEnough(r.down)&&priceEnough(livePrice(r));d.upNum.textContent=valid?pct(m.up*100):'--';d.downNum.textContent=valid?pct(m.down*100):'--';
   d.upNum.className='prob-num up '+(valid?(m.up>m.down?'winner':m.up<m.down?'loser':''):'');d.downNum.className='prob-num down '+(valid?(m.down>m.up?'winner':m.down<m.up?'loser':''):'');d.pFill.style.width=valid?(m.up*100).toFixed(2)+'%':'0%';d.pLabel.textContent=valid?'BTC 跨標的參考 · '+(r.source==='proxy'?'代理上下界':'CoinGlass 界'):(r.errors.model||'資料不足，不顯示機率');d.tr.title=Object.entries(r.errors).filter(([,value])=>value).map(([key,value])=>`${key}: ${value}`).join(' | ')||'';
 }
 // A header click chooses its column and a subsequent click reverses direction.
 // Unknown values always go to the bottom; ties fall back to original watchlist order.
 function sortValue(r,key){
   if(key==='watchlist')return r.index;
   if(key==='symbol')return r.id.toUpperCase();
   if(key==='ha')return r.ha?(r.ha.color==='黃'?1:r.ha.color==='紫'?0:-1):null;
   const price=livePrice(r);
   if(key==='near')return priceEnough(price)&&priceEnough(r.up)&&priceEnough(r.down)
     ?Math.min(Math.abs(r.up/price-1),Math.abs(1-r.down/price))*100:null;
   const model=r.model&&priceEnough(price)&&priceEnough(r.up)&&priceEnough(r.down)?r.model:null;
   if(!model)return null;
   if(key==='upper')return model.up;
   if(key==='lower')return model.down;
   if(key==='edge')return Math.abs(model.up-model.down);
   return null;
 }
 function compareValues(a,b){
   if(typeof a==='string'||typeof b==='string')return String(a).localeCompare(String(b),'en',{numeric:true,sensitivity:'base'});
   return a===b?0:a<b?-1:1;
 }
 function reorder(){
   const rows=currentRows();
   rows.sort((a,b)=>{
     const va=sortValue(a,state.sort),vb=sortValue(b,state.sort);
     if(va===null&&vb===null)return a.index-b.index;
     if(va===null)return 1;
     if(vb===null)return -1;
     return compareValues(va,vb)*state.sortDir||a.index-b.index;
   });
   const body=$('radarBody'),frag=document.createDocumentFragment();
   rows.forEach((r,i)=>{r.dom.tIndex.textContent=String(i+1);frag.append(r.dom.tr);});
   body.replaceChildren(frag);
   if(!rows.length){const tr=el('tr'),td=el('td','empty','沒有符合的標的；請檢查 symbols.js 或篩選條件');td.colSpan=5;tr.append(td);body.append(tr);}
   document.querySelectorAll('.radar-table thead th[data-sort]').forEach(th=>{
     const active=th.dataset.sort===state.sort;
     th.setAttribute('aria-sort',active?(state.sortDir===1?'ascending':'descending'):'none');
     th.classList.toggle('sorted',active);
     const indicator=th.querySelector('.sort-indicator');if(indicator)indicator.textContent=active?(state.sortDir===1?'▲':'▼'):'';
   });
 }
 function chooseSort(key,headerClick){
   const defaults={watchlist:1,symbol:1,near:1,ha:-1,upper:-1,lower:-1,edge:-1};
   if(headerClick&&state.sort===key)state.sortDir*=-1;
   else{state.sort=key;state.sortDir=defaults[key]||1;}
   if($('sortBy'))$('sortBy').value=key;
   reorder();renderOverview();
 }
 function renderOverview(){const coverage=records.filter(r=>r.source==='coinglass').length,proxy=records.filter(r=>r.source==='proxy').length,model=records.filter(r=>r.model).length,ha=records.filter(r=>r.ha).length,price=records.filter(r=>priceEnough(livePrice(r))).length;
   $('coverage').textContent=`${records.length} 標的｜現價 ${price}｜CoinGlass ${coverage}｜代理 ${proxy}｜平均K ${ha}｜機率 ${model}`;
   $('loadedCount').textContent=`已顯示 ${currentRows().length}／${records.length} 個 · 更新 ${state.priceAt?new Date(state.priceAt).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei'}):'等待中'}`;
   const s=$('liveStatus');s.className='status-pill '+(price===0?'waiting':'');s.textContent=price?'即時監控 · '+price+'/'+records.length:'等待行情';
 }
 function renderAll(){records.forEach(renderRow);reorder();renderOverview();}
 async function fetchCG(force=false){if(state.cgBusy)return state.cgBusy;if(!force&&state.cgAt&&Date.now()-state.cgAt<50000)return;const task=(async()=>{
   try{if(!window.CoinGlassReader?.fetchCoinGlass)throw Error('CoinGlass 解碼器尚未載入');const raw=await window.CoinGlassReader.fetchCoinGlass('24h');const decoded=extractCG(raw.data);if(!decoded.size)throw Error('已解密但沒有可辨識上下界');state.cgRecords=decoded;state.cgAt=Date.now();state.cgVersion=String(raw.version||'?');state.cgError='';log(`CoinGlass V${state.cgVersion} 成功 ${decoded.size} 個標的`);}
   catch(e){state.cgError=String(e?.message||e);log('CoinGlass: '+state.cgError);if(Date.now()-state.cgAt>180000){state.cgAt=0;state.cgRecords=new Map();}}
   finally{records.forEach(updateDerived);renderAll();state.cgBusy=null;}
 })();state.cgBusy=task;return task;
 }
 async function fetchPrices(){if(state.priceBusy)return state.priceBusy;const task=(async()=>{
   const found=new Set();const chunks=[];for(let i=0;i<records.length;i+=70)chunks.push(records.slice(i,i+70));
   for(const group of chunks){try{const tickers=[...new Set(group.map(r=>r.s.tv.toUpperCase()))];const payload={filter:[],options:{lang:'en'},symbols:{query:{types:[]},tickers},columns:['close'],range:[0,Math.max(80,tickers.length+10)]};const j=await json(SCANNER,{method:'POST',mode:'cors',headers:{Accept:'application/json','Content-Type':'text/plain'},body:JSON.stringify(payload)},11000);const byTv=new Map((j.data||[]).map(x=>[String(x.s).toUpperCase(),Number(x.d?.[0])]));for(const r of group){const p=byTv.get(r.s.tv.toUpperCase());if(priceEnough(p)){r.price=p;r.priceAt=Date.now();r.priceFeed='TradingView Scanner';found.add(r.id);}}}catch(e){log('TV Scanner: '+e.message);}}
   if(found.size<records.length){try{const j=await json(WORKER+'/api/monitor/tickers?type=PERP',{},11000);const byP=new Map((j.tickers||[]).map(x=>[String(x.symbol).toUpperCase(),Number(x.price)]));for(const r of records){if(found.has(r.id))continue;const p=byP.get(r.s.pionex.toUpperCase());if(priceEnough(p)){r.price=p;r.priceAt=Date.now();r.priceFeed='Pionex Worker';found.add(r.id);}}}catch(e){log('Pionex Worker ticker: '+e.message);}}
   // Do not label old quotes as current; bar last-close is used only for proxies, not as live price.
   records.forEach(updateDerived);state.priceAt=Date.now();renderAll();log('現價成功 '+found.size+'/'+records.length);
 })();state.priceBusy=task;try{return await task;}finally{state.priceBusy=null;}
 }
 const MAX_WORKERS=3,TTLS={bar:4*60_000,day:12*60_000};
 function enqueue(r,kind,force=false){const key=r.id+':'+kind,attempt=r.lastAttempt[kind]||0,have=kind==='bar'?r.bars15.length:r.daily.length,ttl=TTLS[kind];if(state.jobSet.has(key)||(!force&&have>=2&&Date.now()-attempt<ttl)||(!force&&Date.now()-attempt<ttl&&attempt>0))return;
   state.jobSet.add(key);state.queue.push({r,kind,key});pump();}
 async function pump(){while(state.loadingJobs<MAX_WORKERS&&state.queue.length){const job=state.queue.shift();state.loadingJobs++;job.r.lastAttempt[job.kind]=Date.now();void(async()=>{try{
     const {r,kind}=job;const interval=kind==='bar'?'15M':'1D';const count=kind==='bar'?530:95;const received=await loadHistory(r.s,interval,count);
     if(kind==='bar'){r.bars15=received.bars;r.barsAt=Date.now();r.errors.bar='';}else{r.daily=received.bars;r.dailyAt=Date.now();r.errors.day='';}
     if(received.warning)log(`${r.id} ${interval}: ${received.warning}`);updateDerived(r);renderRow(r);if(state.sort!=='watchlist')reorder();renderOverview();
   }catch(e){job.r.errors[job.kind]=String(e?.message||e);log(`${job.r.id} ${job.kind==='bar'?'15M':'1D'}: ${e?.message||e}`);renderRow(job.r);}finally{state.loadingJobs--;state.jobSet.delete(job.key);pump();}})();}}
 function queueAll(force=false){for(const r of records)enqueue(r,'bar',force);for(const r of records)enqueue(r,'day',force);}
 function updateClock(){$('clock').textContent='台灣時間 '+tpe(Date.now());}
 function setup(){const counts={crypto:records.filter(r=>r.s.group==='crypto').length,stock:records.filter(r=>r.s.group==='stock').length};$('cryptoCount').textContent=counts.crypto;$('stockCount').textContent=counts.stock;$('allCount').textContent=records.length;
   for(const r of records)r.dom={};for(const r of records)r.dom=null;
   for(const r of records)makeRow(r);
   document.querySelectorAll('#groupFilters button').forEach(btn=>btn.addEventListener('click',()=>{state.group=btn.dataset.group;document.querySelectorAll('#groupFilters button').forEach(x=>x.classList.toggle('active',x===btn));reorder();renderOverview();}));
   $('searchInput').addEventListener('input',e=>{state.search=String(e.target.value||'').trim().toUpperCase();reorder();renderOverview();});
   $('sortBy').addEventListener('change',e=>chooseSort(e.target.value,false));
   document.querySelectorAll('.radar-table thead button[data-sort]').forEach(btn=>btn.addEventListener('click',()=>chooseSort(btn.dataset.sort,true)));
   $('diagPanel')?.addEventListener('toggle',()=>{if($('diagPanel').open)renderDiag();});
   $('refreshBtn').addEventListener('click',()=>{fetchPrices();fetchCG(true);queueAll(true);});
   renderAll();updateClock();
   // Fast, shared data first. Background 15M / 1D histories fill in progressively.
   if(records.length){fetchCG();fetchPrices();queueAll();}
   else log('自選清單為空，請編輯 symbols.js');
   setInterval(updateClock,1000);
   setInterval(()=>{if(!document.hidden)fetchPrices();},10000);
   setInterval(()=>{if(!document.hidden)fetchCG();},60000);
   setInterval(()=>{if(!document.hidden)queueAll();},60000);
   document.addEventListener('visibilitychange',()=>{if(!document.hidden){fetchPrices();fetchCG();queueAll();}});
   window.LIQ_TEST={version:'1.1.1',records,state,extractCG,resolveCG,candidateZones,updateDerived,calcModel,enqueue,log,renderDiag,reorder,chooseSort};
 }
 setup();
})();
