require('../scripts/register-ts.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { percentChange, alignedReturns, datedCorrelation } = require('../src/lib/time-series.ts');
const { assessEconomy, ECONOMIC_INDICATORS } = require('../src/lib/economy.ts');
const { portfolioRisk, factorSensitivity, stressPortfolio, lookThrough, parseResearchInputs, researchChanges } = require('../src/lib/portfolio-risk.ts');
const { computeYoYChange, getFredSeries } = require('../src/lib/fred.ts');
const { validateRegimes } = require('../src/lib/regime-validation.ts');

const monthly = (n, fn) => Array.from({length:n}, (_,i) => ({date:new Date(Date.UTC(2024,i,1)).toISOString().slice(0,10), value:fn(i)}));
const prices = (n, fn) => Array.from({length:n}, (_,i) => ({date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10), close:fn(i)}));
const position = (symbol, weight, category = 'Broad Market') => ({symbol, weight, marketValue:weight*10, qty:1, currentPrice:weight*10, category});
const almost = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);

test('YoY uses exactly the prior year month, including leap years', () => {
  const data=monthly(25,i=>100+i);
  almost(percentChange(data).at(-1).value, (124/112-1)*100);
  assert.equal(computeYoYChange(data).at(-1).value,10.71);
});
test('Missing prior month is not substituted; nulls and zeros do not invent growth', () => {
  const data=monthly(25,i=>100+i).filter(p=>p.date!=='2025-01-01');
  assert.ok(!percentChange(data).some(p=>p.date==='2026-01-01'));
  assert.equal(percentChange([{date:'2025-01-01',value:0},{date:'2026-01-01',value:5}]).length,0);
});
test('Annualized quarterly growth compounds, not multiplies', () => {
  almost(percentChange([{date:'2025-01-01',value:100},{date:'2025-04-01',value:110}],3,true)[0].value,46.41);
});
test('Price levels align before returns with missing dates and crypto weekends', () => {
  const a=[{date:'2026-01-02',close:100},{date:'2026-01-05',close:110},{date:'2026-01-06',close:121}];
  const b=[{date:'2026-01-02',close:200},{date:'2026-01-03',close:205},{date:'2026-01-05',close:220},{date:'2026-01-06',close:242}];
  const result=alignedReturns([a,b]); assert.deepEqual(result.dates,['2026-01-05','2026-01-06']);
  result.returns.flat().forEach(r=>almost(r,.1));
});
test('No history is unavailable, not zero correlation; constant series is unavailable', () => {
  assert.equal(datedCorrelation([],[]).value,null);
  assert.equal(datedCorrelation(prices(90,()=>100),prices(90,i=>100+i)).value,null);
});
test('Perfect matched returns correlate even with gaps and unordered input', () => {
  const a=prices(90,i=>100+i+Math.sin(i));
  const b=a.filter((_,i)=>i%4!==0).map(p=>({...p,close:p.close*2})).reverse();
  almost(datedCorrelation(a,b).value,1);
});
function economicData() {
  return Object.fromEntries(ECONOMIC_INDICATORS.map(s=>[s.key,monthly(32,i=>s.transform==='level'? s.center+.1 : s.direction<0?100*(.998**i):100*(1.003**i))]));
}
test('Empty or stale inputs abstain and expose coverage', () => {
  const empty=assessEconomy({},'2026-08-31'); assert.equal(empty.regime,'unknown'); assert.equal(empty.axes.growth.coverage,0); assert.equal(empty.latestInflation,null);
  const stale=assessEconomy(economicData(),'2030-08-31'); assert.equal(stale.regime,'unknown'); assert.equal(stale.axes.growth.score,null);
});
test('Economic narrative and trend agree; inflation level does not determine momentum', () => {
  const data=economicData();
  data.cpi=monthly(32,i=>100*Math.exp(.001*i+.00005*i*i));
  data.coreCpi=data.cpi; data.corePce=data.cpi; data.pce=data.cpi;
  const a=assessEconomy(data,'2026-08-31'); assert.equal(a.inflationTrend,'rising'); assert.match(a.description,/inflation pressure is rising/); assert.ok(!a.description.includes('cooling'));
});
test('Future observations cannot influence an as-of assessment', () => {
  const data=economicData(), base=assessEconomy(data,'2026-08-31');
  for(const key of Object.keys(data)) data[key].push({date:'2027-01-01',value:100000});
  assert.deepEqual(assessEconomy(data,'2026-08-31').axes,base.axes);
});
test('Short position history withholds full portfolio risk instead of renormalizing', () => {
  const result=portfolioRisk([position('A',80),position('B',20)],{A:prices(90,i=>100+i+Math.sin(i)),B:prices(10,i=>100+i)});
  assert.equal(result.annualizedVolatility,null); assert.equal(result.coveredWeight,80); assert.deepEqual(result.excluded,['B']);
});
test('Risk contributions sum to 100 and include conviction / crypto positions', () => {
  const a=prices(120,i=>100+i+3*Math.sin(i));
  const result=portfolioRisk([position('BTC',50,'Crypto'),position('SPCX',50,'Conviction Core')],{BTC:a,SPCX:a});
  almost(result.contributions.reduce((s,p)=>s+p.varianceShare,0),100); almost(result.contributions[0].varianceShare,50); assert.ok(result.annualizedVolatility>0);
});
test('Factor regression recovers known return beta', () => {
  let a=100,b=100;
  const x=[],y=[];
  for(let i=0;i<100;i++){const r=Math.sin(i)*.01; a*=1+r;b*=1+2*r;const date=prices(100,()=>0)[i].date;x.push({date,value:a});y.push({date,close:b});}
  const result=factorSensitivity(y,x,'return');almost(result.beta,2);almost(result.rSquared,1);
});
test('Stress uses actual capital weights and cannot omit conviction losses', () => {
  const result=stressPortfolio([position('VTI',90),position('SPCX',10,'Conviction Core')],{VTI:-20,SPCX:-100});
  almost(result.percent,-28);almost(result.dollars,-280);
  assert.throws(()=>stressPortfolio([position('A',100)],{}));
});
test('Look-through combines direct and indirect exposures, reports uncovered weight', () => {
  const result=lookThrough([position('MSFT',10),position('VTI',90)],[{fund:'VTI',symbol:'MSFT',weight:5,asOf:'2026-08-01',source:'https://example.com'}],'2026-09-01');
  almost(result.exposures[0].total,14.5);almost(result.uncovered[0].portfolioWeight,85.5);
});
test('Stale constituents stay uncovered', () => {
  const result=lookThrough([position('VTI',100)],[{fund:'VTI',symbol:'MSFT',weight:100,asOf:'2025-01-01',source:'https://example.com'}],'2026-09-01');
  assert.equal(result.exposures.length,0);assert.equal(result.uncovered[0].portfolioWeight,100);
});
test('Research rejects impossible weights, duplicate rows, mixed dates and unsafe URLs', () => {
  const row={fund:'VTI',symbol:'MSFT',weight:60,asOf:'2025-01-01',source:'https://example.com'};
  assert.throws(()=>parseResearchInputs({constituents:[row,{...row,symbol:'A'}],observations:[]}));
  assert.throws(()=>parseResearchInputs({constituents:[row,row],observations:[]}));
  assert.throws(()=>parseResearchInputs({constituents:[{...row,source:'javascript:alert(1)'}],observations:[]}));
  assert.throws(()=>parseResearchInputs({constituents:[row,{...row,weight:5,symbol:'A',asOf:'2025-02-01'}],observations:[]}));
});
test('Estimate revisions only compare the same fiscal period and units', () => {
  const row={symbol:'MSFT',metric:'EPS',kind:'estimate',period:'FY2027',units:'USD',value:10,asOf:'2025-01-01',source:'https://example.com'};
  const result=researchChanges([row,{...row,asOf:'2025-02-01',value:12},{...row,period:'FY2028',value:20}]);
  assert.equal(result.find(r=>r.period==='FY2027').change,2);assert.equal(result.find(r=>r.period==='FY2028').change,null);
});
test('Validation excludes unknown calls and incomplete forward labels', () => {
  const base=assessEconomy({},'2025-01-31');
  const report=validateRegimes([{asOf:base.asOf,assessment:base}],monthly(20,()=>0));
  assert.equal(report.evaluated,0);assert.equal(report.abstentions,1);assert.equal(report.precision,null);
});
test('FRED vintage requests use real-time dates, not only observation cutoffs', async () => {
  const {config}=require('../src/lib/config.ts');config.fred.apiKey='test-only';
  const original=global.fetch;let url;
  global.fetch=async u=>{url=new URL(u);return {ok:true,json:async()=>({observations:[{date:'2024-01-01',value:'1'}]})};};
  try{await getFredSeries('TEST','2024-01-01','2024-03-31',undefined,'2024-03-31');assert.equal(url.searchParams.get('realtime_start'),'2024-03-31');assert.equal(url.searchParams.get('realtime_end'),'2024-03-31');}
  finally{global.fetch=original;config.fred.apiKey='';}
});
test('Portfolio rejects zero or stale quotes without emitting false allocation weights', async () => {
  const {validQuote}=require('../src/lib/holdings.ts');
  assert.equal(validQuote(0,100,new Date().toISOString()),false);
  assert.equal(validQuote(100,100,'2000-01-01'),false);
  assert.equal(validQuote(100,100,null),false);
  assert.equal(validQuote(100,100,new Date().toISOString()),true);
});
