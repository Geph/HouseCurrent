// Copied into tests by the local update script.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DEFAULT_RATES as r, DEFAULT_NIGHT_HOURS,deviceEnergy,validateDevice,validateState,seedState,mergeIdleActive,periodItems} from '../dist/energy.js'
import {websiteHTML} from '../build-website.mjs'

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`)
const schedule=extra=>({id:'a',name:'Device',room:'Office',mode:'schedule',source:'grid',watts:100,idleWatts:0,startTime:'00:00',hours:24,days:[0,1,2,3,4,5,6],...extra})
const continuous=extra=>({id:'e',name:'Old lamp',room:'Office',mode:'event',inputMode:'continuous',source:'grid',watts:100,start:'2026-09-15',end:'2026-10-18',basis:'wall',kwh:0,efficiency:100,timing:'unknown',...extra})
test('shared nighttime settings apply both seasons, standby and overnight carry',()=>{
 const d=schedule({nightTime:true,watts:41,idleWatts:1})
 near(deviceEnergy(d,'2026-10-19','2026-10-20',r).kwh,(41*6+18)/1000)
 near(deviceEnergy(d,'2026-07-20','2026-07-21',r).kwh,(41*4.5+19.5)/1000)
 const config={...DEFAULT_NIGHT_HOURS,winterStart:'22:00',winterEnd:'02:00'}
 near(deviceEnergy(d,'2026-10-19','2026-10-20',r,config).kwh,(41*4+20)/1000)
})
test('old matching lights migrate once; longer custom schedules are preserved',()=>{
 const s=seedState();delete s.nightHours
 s.devices=[schedule({startTime:'18:00',hours:6,summerStartTime:'19:30',summerHours:4.5}),schedule({id:'b',startTime:'18:00',hours:12,summerStartTime:'19:30',summerHours:10})]
 validateState(s);assert.equal(s.devices[0].nightTime,true);assert.equal(s.devices[1].nightTime,undefined)
 const before=structuredClone(s);validateState(s);assert.deepEqual(s,before)
 s.nightHours.winterEnd='18:00';assert.throws(()=>validateState(s),/must differ/)
})
test('continuous draw calculates supply kWh and only dates inside each billing period',()=>{
 const d=continuous();validateDevice(d);near(d.kwh,79.2)
 const a=deviceEnergy(d,'2026-09-15','2026-10-14',r),b=deviceEnergy(d,'2026-10-14','2026-11-14',r)
 near(a.kwh,69.6);near(b.kwh,9.6);near(a.kwh+b.kwh,d.kwh);near(a.low,a.high)
 assert.equal(periodItems([{d,...b}],'2026-10-14','2026-11-14').length,1)
 assert.equal(periodItems([{d}],'2026-10-18','2026-11-14').length,0)
})
test('continuous solar draw values actual seasonal days at average solar rate',()=>{
 const d=continuous({source:'solar',start:'2026-09-30',end:'2026-10-02',watts:1000});validateDevice(d)
 const x=deviceEnergy(d,d.start,d.end,r);near(x.kwh,48);near(x.low,24*.1+24*.08);near(x.high,x.low)
 assert.throws(()=>validateDevice(continuous({watts:-1})))
})
test('merge preserves energy, peak and cost when existing active entry is extra watts',()=>{
 const s=seedState();s.devices=[schedule({id:'idle',watts:12}),schedule({id:'active',watts:205,hours:3,startTime:'19:00',days:[1,3,5]})]
 const before=s.devices.map(d=>deviceEnergy(d,'2026-09-29','2026-10-20',r));const merged=mergeIdleActive(s,'idle','active','Family system')
 assert.equal(merged.watts,217);assert.equal(merged.idleWatts,12);assert.equal(s.devices.length,1)
 const after=deviceEnergy(merged,'2026-09-29','2026-10-20',r)
 for(const key of ['kwh','peak','low','high'])near(after[key],before.reduce((n,x)=>n+x[key],0))
})
test('merge supports total measured active watts and rejects unrelated entries',()=>{
 const s=seedState();s.devices=[schedule({id:'idle',watts:12}),schedule({id:'active',watts:205,hours:3})]
 assert.equal(mergeIdleActive(s,'idle','active','Family',true).watts,205)
 s.devices=[schedule({id:'idle'}),schedule({id:'active',source:'solar'})];assert.throws(()=>mergeIdleActive(s,'idle','active','x'),/same location/)
 s.devices=[schedule({id:'idle',hours:6}),schedule({id:'active'})];assert.throws(()=>mergeIdleActive(s,'idle','active','x'),/continuously/)
})
test('read-only export embeds validated data safely and has no external assets',()=>{
 const s=seedState();s.devices=[schedule({name:'</script><script>alert(1)</script>'})];s.rooms=[{id:'r',name:'Office',color:'#123456'}]
 const html=websiteHTML(s);assert.ok(html.includes('const PUBLISHED_STATE={'));assert.ok(!html.includes('const PUBLISHED_STATE=null'))
 assert.ok(!html.includes('<script>alert(1)</script>'));assert.ok(!/<script[^>]+src=|<link[^>]+href="(?:styles|https?:)/.test(html))
 const js=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];new Function(js)
 assert.ok(js.includes("if(READ_ONLY)throw new Error('This is a read-only snapshot.')"))
})
