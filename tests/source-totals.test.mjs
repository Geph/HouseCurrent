import {test} from 'node:test'
import assert from 'node:assert/strict'
import {usageSummary,seedState,DEFAULT_RATES as r} from '../dist/energy.js'
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`)
const event=(id,source,extra={})=>({id,name:id,source,mode:'event',start:'2026-10-16',end:'2026-10-17',basis:'delivered',kwh:45,efficiency:90,timing:'unknown',...extra})
test('source totals include charging losses, separate mixed use and do not double count solar journal',()=>{const s=seedState();s.devices=[event('grid','grid'),event('solar','solar'),event('mixed','mixed')];s.solarReadings=[{id:'a',date:'2026-10-16',kwh:100},{id:'b',date:'2026-10-17',kwh:150}];const x=usageSummary(s,'2026-10-16','2026-10-17');near(x.kwh,50);near(x.solarKwh,50);near(x.mixedKwh,50);near(x.solarLow,50*.08);near(x.solarHigh,50*.08);assert.equal(s.bills[0].kwh,771);const outside=usageSummary(s,'2026-10-17','2026-10-18');near(outside.solarKwh,0);near(outside.solarHigh,0)})
test('solar schedules and measured intervals join one-time totals with seasonal rates and partial exclusion',()=>{const s=seedState();s.devices=[event('ev','solar',{timing:'off'}),{id:'fan',name:'Fan',source:'solar',mode:'schedule',watts:100,hours:24,startTime:'00:00',days:[0,1,2,3,4,5,6]},{id:'meter',name:'Metered load',source:'solar',mode:'measured',logs:[{id:'l',start:'2026-10-16',end:'2026-10-18',kwh:10,peakKwh:null}]}];const x=usageSummary(s,'2026-10-16','2026-10-17');near(x.solarKwh,52.4);near(x.kwh,0);near(x.solarLow,50*.08+.4*r.winterPeak+2*r.winterOff);near(x.solarHigh,x.solarLow);assert.equal(x.solar.find(x=>x.d.id==='meter').excluded,true)})

test('solar kWh savings use seasonal averages while grid pricing and solar journal keep TOU bounds',()=>{
  const s=seedState();s.devices=[event('heater','solar',{basis:'wall',kwh:15.4})]
  let x=usageSummary(s,'2026-10-16','2026-10-17');near(x.solarLow,1.232);near(x.solarHigh,1.232)
  s.devices=[event('summer','solar',{start:'2026-06-01',end:'2026-06-02',basis:'wall',kwh:15.4})]
  x=usageSummary(s,'2026-06-01','2026-06-02');near(x.solarLow,1.54);near(x.solarHigh,1.54)
  s.devices=[event('cross','solar',{start:'2026-09-30',end:'2026-10-02',basis:'wall',kwh:10})]
  x=usageSummary(s,'2026-09-30','2026-10-02');near(x.solarLow,.8);near(x.solarHigh,1)
  s.devices=[event('meter','solar',{mode:'measured',logs:[{start:'2026-09-30',end:'2026-10-01',kwh:10},{start:'2026-10-01',end:'2026-10-02',kwh:20}]})]
  x=usageSummary(s,'2026-09-30','2026-10-02');near(x.solarLow,2.6);near(x.solarHigh,2.6)
  s.devices=[event('grid','grid',{basis:'wall',kwh:15.4})];x=usageSummary(s,'2026-10-16','2026-10-17');near(x.low,15.4*r.winterOff);near(x.high,15.4*r.winterPeak)
})
