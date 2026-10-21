import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function fn(name) {
  const start = html.indexOf(`function ${name}`);
  assert.ok(start >= 0, name);
  const open = html.indexOf('{', start); let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++;
    if (html[i] === '}' && --depth === 0) return (html.slice(Math.max(0,start-6),start)==='async ' ? 'async ' : '') + html.slice(start, i + 1);
  }
}
function constant(name) { const start = html.indexOf(`const ${name} =`); return html.slice(start, html.indexOf('\n    });', start) + 8); }
function fxHarness() {
 const els = Object.fromEntries(['profitFx','profitRateUpdate','marketCountry','currencyManualToggle','currencyManualRate','sourceCurrency','targetCurrency','updateTime','currencyInfo','rateDisplay'].map(id => [id,{value:'',dataset:{},style:{},textContent:'更新汇率'}]));
 els.marketCountry.value='US'; els.profitFx.value='7.2'; els.profitFx.dataset.marketDefault='1'; els.sourceCurrency.value='JPY'; els.targetCurrency.value='CNY';
 const pending=[];
 const context = vm.createContext({document:{getElementById:id=>els[id],querySelector:()=>({}),activeElement:null},window:{setTimeout:cb=>cb()},console,fetch:()=>new Promise(resolve=>pending.push(resolve)),updateProfitCalculator(){},calcCurrency(){},updateCurrencyTrend(){}});
 vm.runInContext(`let liveRates={}; let lastBase='CNY'; let profitFxRequestSequence=0; let profitFxEditVersion=0; let ratesRequestSequence=0; const MARKET_CONFIG={US:{currency:'USD'},JP:{currency:'JPY'}}; function currentMarket(){return MARKET_CONFIG[document.getElementById('marketCountry').value]}`,context);
 for(const name of ['marketFxDecimals','formatExchangeRate','updateProfitExchangeRate','fetchRates']) vm.runInContext(fn(name),context);
 const resolve=(i,rates)=>pending[i]({ok:true,json:async()=>({result:'success',base_code:'CNY',rates})});
 return {els,context,pending,resolve,run:s=>vm.runInContext(s,context)};
}
test('profit FX rejects A-B-A stale responses and edits made while fetching',async()=>{
 const h=fxHarness(); const a=h.run('updateProfitExchangeRate(true)');
 h.els.marketCountry.value='JP'; const b=h.run('updateProfitExchangeRate(true)');
 h.els.marketCountry.value='US'; const c=h.run('updateProfitExchangeRate(true)');
 h.resolve(2,{USD:0.125}); await c; h.resolve(0,{USD:0.2}); await a;
 assert.equal(h.els.profitFx.value,'8.00'); h.resolve(1,{JPY:20}); await b;
 const d=h.run('updateProfitExchangeRate()'); h.els.profitFx.value='9.876'; h.els.profitFx.dataset.marketDefault='0'; h.run('profitFxEditVersion++');
 h.resolve(3,{USD:0.1}); await d; assert.equal(h.els.profitFx.value,'9.876');
 assert.match(html,/oninput="markProfitFxManual\(\)/);
 assert.match(fn('updateMarketCountry'),/updateProfitExchangeRate\(true\)/);
});
test('converter refresh cannot overwrite manual profit FX or active converter rate',async()=>{
 const h=fxHarness(); h.els.profitFx.dataset.marketDefault='0'; h.els.profitFx.value='9.111';
 h.els.currencyManualToggle.checked=true; h.els.currencyManualRate.value='0.048765';
 const p=h.run('fetchRates()'); h.resolve(0,{CNY:1,USD:0.14,JPY:20}); await p;
 assert.equal(h.els.profitFx.value,'9.111'); assert.equal(h.els.currencyManualRate.value,'0.048765');
});
test('small converter rates retain precision in prefill and historical labels; profit step follows currency',async()=>{
 const h=fxHarness(); const p=h.run('fetchRates()'); h.resolve(0,{CNY:1,USD:0.14,JPY:20.5}); await p;
 assert.ok(Math.abs(Number(h.els.currencyManualRate.value)-1/20.5)<0.000001);
 assert.match(fn('updateCurrencyTrend'),/formatExchangeRate\(latest\)/);
 assert.match(fn('drawCurrencyTrend'),/formatExchangeRate\(latest.value\)/);
 assert.match(fn('updateMarketCountry'),/fx.step =/);
 const format=vm.runInNewContext(fn('formatExchangeRate')+';formatExchangeRate');
 assert.ok(Number(format(0.000006789123))>0); assert.ok(Math.abs(Number(format(0.048765432))-0.048765432)<1e-8);
});
function quickHelpers() {
 const names=['calculateJpReferralFee','getJpFbaMetrics','calculateJpFbaStorageFee','calculateQuickEstimate'];
 if(html.includes('function findJpBreakEvenPrice')) names.push('findJpBreakEvenPrice');
 return vm.runInNewContext(['JP_REFERRAL_RULES_2026','JP_FBA_FULFILLMENT_2026','JP_FBA_STORAGE_2026'].map(constant).join('\n')+'\n'+names.map(fn).join('\n')+'\n;({calculateQuickEstimate,calculateJpReferralFee,getJpFbaMetrics,findJpBreakEvenPrice})');
}
const quickValues={market:'JP',price:3000,fx:0.05,dimensionsCm:[10,10,1],weightKg:0.1,purchaseRmb:100,freightRateRmb:0,adRate:82,storageDays:0,category:'other'};
test('JP breakeven finds a root beyond the former heuristic cap and validates its predecessor',()=>{
 const h=quickHelpers(); const result=h.calculateQuickEstimate(quickValues);
 assert.ok(Number.isFinite(result.breakEvenPrice));
 const profit=p=>h.calculateQuickEstimate({...quickValues,price:p}).profit;
 assert.ok(profit(result.breakEvenPrice)>=0); assert.ok(profit(result.breakEvenPrice-1)<0);
 assert.equal(h.calculateQuickEstimate({...quickValues,adRate:99}).breakEvenPrice,Infinity);
});
test('guide return costs weight both sale price and handling by the return rate',()=>{
 assert.ok(html.includes('退货成本 =（售价 + 退货处理费）× 退货率'));
});
test('PDF filenames are literal text and existing reorder/remove controls remain',()=>{
 const source=fn('updatePdfList'); assert.ok(!source.includes('${f.name}</span>'));
 assert.match(source,/textContent = `\$\{i\+1\}\. \$\{f.name\}`/);
 for(const action of ['movePdf(${i}, -1)','movePdf(${i}, 1)','removePdf(${i})']) assert.ok(source.includes(action));
});
test('cargo dimension suffixes convert to the field unit instead of being silently discarded',()=>{
 const parse=vm.runInNewContext(fn('parseFractionNumber')+'\n'+fn('parseBoxDimensions')+';parseBoxDimensions');
 assert.deepEqual(Array.from(parse('10x10x10in')),[25.4,25.4,25.4]);
 assert.ok(Array.from(parse('25.4x25.4x25.4cm','in')).every(n=>Math.abs(n-10)<1e-12));
 assert.deepEqual(Array.from(parse('10x10x10','in')),[10,10,10]);
 assert.equal(parse('10x10x10yards'),null);
 assert.match(fn('syncCargoDimensionPair'),/parseBoxDimensions\(sourceEl.value, sourceUnit\)/);
});
test('JP unavailable storage allocation explains missing plans just like US',()=>{
 assert.match(fn('updateProfitCalculator'),/storageCost === null && usesDetailedStorageForecast/);
 assert.ok(fn('updateProfitCalculator').includes('请填写有实际售出的月度库存计划'));
});
test('automatic manual restore invalidates an older explicit A-B-A request',async()=>{
 const h=fxHarness(); h.els.profitFx.dataset.marketDefault='0'; h.els.profitFx.value='9.123';
 const old=h.run('updateProfitExchangeRate()'); h.els.marketCountry.value='JP'; await h.run('updateProfitExchangeRate(true)');
 h.els.marketCountry.value='US'; await h.run('updateProfitExchangeRate(true)'); h.resolve(0,{USD:0.125}); await old;
 assert.equal(h.els.profitFx.value,'9.123');
});
test('JP interval solver matches exhaustive first roots across category/FBA discontinuities',()=>{
 const h=quickHelpers(); const dimensions=[10,10,1];
 for(const category of ['other','beauty','clothing','shoes-bags','jewelry','media']) {
  for(const fixed of [0,230,400,660,850,1200,2600,6500]) {
   const adRate=0.25; let expected=Infinity;
   for(let p=1;p<=16000;p++) {
    if(p-fixed-h.calculateJpReferralFee(p,category,true).total-h.getJpFbaMetrics(dimensions,0.1,p).fee-p*adRate>=0) {expected=p;break;}
   }
   assert.equal(h.findJpBreakEvenPrice(fixed,adRate,category,dimensions,0.1),expected,category+':'+fixed);
  }
 }
});
test('per-market manual FX values round trip independently',()=>{
 const h=fxHarness();
 h.run("const MARKET_INPUT_STATE={}; const MARKET_MONEY_FIELDS=[];");
 h.run(fn('saveMarketInputState')+'\n'+fn('restoreMarketInputState'));
 h.els.profitFx.value='8.765'; h.els.profitFx.dataset.marketDefault='0'; h.run("saveMarketInputState('US')");
 h.els.profitFx.value='0.049876'; h.run("saveMarketInputState('JP')");
 h.run("restoreMarketInputState('US',{currency:'USD',fx:7.2})"); assert.equal(h.els.profitFx.value,'8.765'); assert.equal(h.els.profitFx.dataset.marketDefault,'0');
 h.run("restoreMarketInputState('JP',{currency:'JPY',fx:0.048})"); assert.equal(h.els.profitFx.value,'0.049876');
});
test('automatic profit FX preserves manual values; explicit update deliberately replaces them',async()=>{
 const h=fxHarness(); h.els.profitFx.dataset.marketDefault='0'; h.els.profitFx.value='8.123';
 const automatic=h.run('updateProfitExchangeRate(true)'); assert.equal(h.pending.length,0); await automatic;
 const request=h.run('updateProfitExchangeRate()'); h.resolve(0,{USD:0.125}); await request; assert.equal(h.els.profitFx.value,'8.00');
});
