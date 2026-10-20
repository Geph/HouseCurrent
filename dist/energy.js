export const DAY = 86400000
export const DEFAULT_RATES = { summerPeak: .21277, summerOff: .07884, winterPeak: .18331, winterOff: .06792, summerFlat: .10380, winterFlat: .08570 }
export function dateMs(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) throw new Error('Enter a valid date.')
  const n = Date.parse(value + 'T00:00:00Z')
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value) throw new Error('Enter a valid date.')
  return n
}
export function iso(n) { return new Date(n).toISOString().slice(0, 10) }
export function dates(start, end) {
  const a = dateMs(start), b = dateMs(end)
  if (b <= a || b - a > DAY * 3660) throw new Error('The ending read date must be after the starting date (up to 10 years).')
  return Array.from({length: (b-a)/DAY}, (_, i) => a + i*DAY)
}
export function season(ms) { const m = new Date(ms).getUTCMonth(); return m >= 5 && m <= 8 ? 'summer' : 'winter' }
export function isPeak(ms) { const d = new Date(ms); return d.getUTCDay() > 0 && d.getUTCDay() < 6 && d.getUTCHours() >= 17 && d.getUTCHours() < 21 }
export function rateAt(ms, rates, flat = false) { return rates[season(ms) + (flat ? 'Flat' : isPeak(ms) ? 'Peak' : 'Off')] }
export function num(n, label, min = 0, max = 1e9) { const v = Number(n); if (n === '' || n == null || !Number.isFinite(v) || v < min || v > max) throw new Error(`${label} must be between ${min} and ${max}.`); return v }
export function rateBounds(start, end, rates, bucket) {
  const values = dates(start, end).flatMap((ms) => {
    const s = season(ms), weekday = new Date(ms).getUTCDay()
    if (bucket === 'off') return [rates[s+'Off']]
    if (bucket === 'peak') return weekday > 0 && weekday < 6 ? [rates[s+'Peak']] : []
    return weekday > 0 && weekday < 6 ? [rates[s+'Off'], rates[s+'Peak']] : [rates[s+'Off']]
  })
  if (!values.length) throw new Error('There are no on-peak hours in this interval.')
  return { min: Math.min(...values), max: Math.max(...values) }
}
/** Unknown timing is a range, never an invented hourly solar profile. */
export function energyValue(kwh, start, end, rates, peakKwh = null) {
  const energy = num(kwh, 'Energy')
  if (peakKwh == null) { const r = rateBounds(start, end, rates); return { low: energy*r.min, high: energy*r.max } }
  const p = num(peakKwh, 'On-peak energy', 0, energy), off = rateBounds(start, end, rates, 'off')
  const peak = p ? rateBounds(start, end, rates, 'peak') : {min:0,max:0}
  return { low: p*peak.min+(energy-p)*off.min, high: p*peak.max+(energy-p)*off.max }
}
/** User-selected average avoided energy prices for solar loads recorded as kWh. */
export const SOLAR_AVERAGE_RATES = {winter:.08,summer:.10}
export function solarAverageValue(kwh,start,end) {
  const energy=num(kwh,'Solar energy'),prices=dates(start,end).map(day=>SOLAR_AVERAGE_RATES[season(day)])
  return {low:energy*Math.min(...prices),high:energy*Math.max(...prices)}
}
/** One-time use: delivered kWh / efficiency = energy drawn from the supply. */
export function validateEvent(d) {
  dates(d.start,d.end)
  if(d.inputMode!=null&&!['kwh','continuous'].includes(d.inputMode))throw new Error('Choose total kWh or continuous watts.')
  if(d.inputMode==='continuous'){
    if(typeof d.watts!=='number')throw new Error('Continuous watts must be a number.')
    num(d.watts,'Continuous watts',0,1000000)
    d.kwh=d.watts/1000*dates(d.start,d.end).length*24
  }
  if(typeof d.kwh!=='number'||typeof d.efficiency!=='number') throw new Error('Event energy and efficiency must be numbers.')
  num(d.kwh,'Event kWh'); num(d.efficiency,'Delivered share',.1,100)
  if(!['wall','delivered'].includes(d.basis)||!['unknown','off','peak'].includes(d.timing)) throw new Error('Choose a valid energy measurement and timing.')
  eventValue(d,DEFAULT_RATES)
  return d
}
export function eventValue(d,rates) {
  if(d.inputMode==='continuous')return continuousEventEnergy(d,d.start,d.end,rates)
  const kwh=d.basis==='delivered'?d.kwh/(d.efficiency/100):d.kwh
  const peak=d.timing==='peak'?kwh:d.timing==='off'?0:null
  return {kwh,peak,...energyValue(kwh,d.start,d.end,rates,peak)}
}
export function validateDevice(d) {
  if (!String(d.name ?? '').trim()) throw new Error('Give the device a name.')
  if (!['schedule','measured','event'].includes(d.mode) || !['grid','solar','mixed'].includes(d.source)) throw new Error('Choose a valid measurement method and energy source.')
  if(d.mode!=='schedule'&&d.watts!=null){if(typeof d.watts!=='number')throw new Error('Watts must be a number.');num(d.watts,'Watts',0,1000000)}
  if (d.mode === 'event') { validateEvent(d); return d }
  if (d.mode === 'schedule') {
    num(d.watts,'Watts',0,1000000); num(d.hours,'Hours per run',.01,24)
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.startTime ?? '')) throw new Error('Enter a valid start time.')
    if(d.nightTime!=null&&typeof d.nightTime!=='boolean')throw new Error('Nighttime setting must be a checkbox value.')
    if(d.idleWatts!=null){if(typeof d.idleWatts!=='number')throw new Error('Idle watts must be a number.');num(d.idleWatts,'Idle watts',0,d.watts)}
    // Legacy backups: fold the old duty fraction into average watts once.
    if(d.duty!==undefined){
      if(typeof d.duty!=='number')throw new Error('Legacy duty cycle must be a number.')
      const fraction=num(d.duty,'Legacy duty cycle',.1,100)/100,idle=d.idleWatts??0
      d.watts=idle+(d.watts-idle)*fraction
      delete d.duty
    }
    if(d.summerStartTime!=null||d.summerHours!=null){
      if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.summerStartTime??''))throw new Error('Enter a valid summer start time.')
      if(typeof d.summerHours!=='number')throw new Error('Summer hours must be a number.')
      num(d.summerHours,'Summer hours',.01,24)
    }
    if (!Array.isArray(d.days) || !d.days.length || d.days.some(x=>!Number.isInteger(x)||x<0||x>6)) throw new Error('Select at least one valid day.')
  } else {
    const logs = d.logs ?? [d]
    if(!Array.isArray(logs)||logs.length>10000) throw new Error('Invalid device readings.')
    for(const log of logs){dates(log.start,log.end);num(log.kwh,'Measured kWh');if(log.peakKwh!=null)num(log.peakKwh,'Peak kWh',0,log.kwh)}
    const ordered=[...logs].sort((a,b)=>a.start.localeCompare(b.start))
    for(let i=1;i<ordered.length;i++) if(ordered[i].start<ordered[i-1].end) throw new Error('Device reading intervals cannot overlap.')
  }
  return d
}
/** Calendar timestamps encode household wall time, unaffected by the browser timezone. */
export function deviceEnergy(d, start, end, rates,nightHours=DEFAULT_NIGHT_HOURS) {
  const days = dates(start,end), a = dateMs(start), b = dateMs(end)
  if (d.mode === 'event') {
    if(d.inputMode==='continuous')return continuousEventEnergy(d,start,end,rates)
    const included=d.start>=start&&d.end<=end
    const raw=eventValue(d,rates)
    const v=d.source==='solar'?{...raw,...solarAverageValue(raw.kwh,d.start,d.end)}:raw
    const flats=[...new Set(dates(d.start,d.end).map(t=>rates[season(t)+'Flat']))]
    return {kwh:included?v.kwh:0,peak:included?v.peak:0,low:included?v.low:0,high:included?v.high:0,flat:included?(flats.length===1?v.kwh*flats[0]:null):0,measured:false,excluded:!included&&d.start<end&&d.end>start}
  }
  if (d.mode === 'measured') {
    let result={kwh:0,peak:0,low:0,high:0,flat:0,excluded:false,measured:true}
    for(const log of d.logs ?? [d]) {
      const s=dateMs(log.start),e=dateMs(log.end)
      if(s<a||e>b){if(e>a&&s<b)result.excluded=true;continue}
      const value=d.source==='solar'?solarAverageValue(log.kwh,log.start,log.end):energyValue(log.kwh,log.start,log.end,rates,log.peakKwh)
      const flats=[...new Set(dates(log.start,log.end).map(t=>rates[season(t)+'Flat']))]
      result.kwh+=+log.kwh;result.peak=result.peak==null||log.peakKwh==null?null:result.peak+log.peakKwh
      result.low+=value.low;result.high+=value.high
      result.flat=result.flat==null||flats.length!==1?null:result.flat+log.kwh*flats[0]
    }
    return result
  }
  let kwh=0, peak=0, cost=0, flat=0
  const idle=d.idleWatts??0
  // Standby runs all day, including days without an active run. Active use adds only the difference.
  if(idle) for(const day of days) for(let hour=0;hour<24;hour++){
    const at=day+hour*3600000,energy=idle/1000
    kwh+=energy;if(isPeak(at))peak+=energy
    cost+=energy*rateAt(at,rates);flat+=energy*rateAt(at,rates,true)
  }
  // Include yesterday's overnight run, then price each interval on its actual day.
  for (const day of [a-DAY,...days]) {
    if (!d.days.includes(new Date(day).getUTCDay())) continue
    const summer=season(day)==='summer'&&d.summerStartTime!=null
    const night=d.nightTime?nightSchedule(nightHours,season(day)):null
    const [h,m]=(night?night.startTime:summer?d.summerStartTime:d.startTime).split(':').map(Number)
    const hours=night?night.hours:summer?d.summerHours:d.hours
    const begin = day+(h*60+m)*60000, finish=begin+hours*3600000
    let at = Math.max(a,begin), until=Math.min(b,finish)
    while(at < until) {
      const next = Math.min(until,(Math.floor(at/3600000)+1)*3600000)
      const energy=(d.watts-idle)/1000*(next-at)/3600000
      kwh+=energy; if(isPeak(at)) peak+=energy
      cost+=energy*rateAt(at,rates); flat+=energy*rateAt(at,rates,true); at=next
    }
  }
  return {kwh,peak,low:cost,high:cost,flat,measured:false,excluded:false}
}
export function solarIntervals(readings) {
  const sorted = [...readings].sort((a,b)=>a.date.localeCompare(b.date))
  const intervals=[]
  sorted.forEach((r,i)=>{
    dateMs(r.date); num(r.kwh,'Meter kWh')
    if(i && sorted[i-1].date===r.date) throw new Error('Use one cumulative reading per date. Edit the existing reading instead.')
    if(i && !r.reset && r.kwh<sorted[i-1].kwh) throw new Error('Cumulative readings cannot decrease. If the meter was reset, mark this reading as a new baseline.')
    if(i && !r.reset) intervals.push({start:sorted[i-1].date,end:r.date,kwh:r.kwh-sorted[i-1].kwh})
  })
  return intervals
}
export function solarSummary(state,start,end) {
  dates(start,end)
  const intervals=solarIntervals(state.solarReadings), included=intervals.filter(r=>r.start>=start&&r.end<=end)
  const partial=intervals.filter(r=>r.start<end&&r.end>start&&!included.includes(r)).length
  const measured=included.reduce((s,r)=>s+r.kwh,0)
  const factor=state.solar.kind==='ac'?1:state.solar.efficiency==null?null:state.solar.efficiency/100
  let low=0,high=0
  if(factor!=null) for (const r of included) {const v=energyValue(r.kwh*factor,r.start,r.end,state.rates);low+=v.low;high+=v.high}
  return { measured,delivered:factor==null?null:measured*factor,low,high,partial,intervals:included,totalIntervals:intervals.length }
}
export function validateState(s) {
  if (s?.version!==1 || !s.rates || !Array.isArray(s.devices) || !Array.isArray(s.bills) || !Array.isArray(s.solarReadings) || !s.solar) throw new Error('Choose a Housecurrent backup (version 1).')
  ensureNightHours(s)
  const numeric=(v,label,min=0,max=1e9)=>{if(typeof v!=='number')throw new Error(label+' must be a number.');return num(v,label,min,max)}
  const text=(v,label,limit=500)=>{if(typeof v!=='string'||v.length>limit)throw new Error(label+' must be valid text.');return v}
  for (const key of Object.keys(DEFAULT_RATES)) numeric(s.rates[key],'Energy rate',0,10)
  if(s.devices.length>1000 || s.bills.length>1000 || s.solarReadings.length>10000) throw new Error('This backup is too large.')
  for(const d of s.devices) {
    text(d.name,'Device name',100);if(d.room!=null)text(d.room,'Room',80);if(d.note!=null)text(d.note,'Device note')
    validateDevice(d)
    if(d.mode==='schedule'){numeric(d.watts,'Watts');numeric(d.hours,'Hours',.01,24)}
    else if(d.mode==='measured') for(const log of d.logs??[d]){numeric(log.kwh,'Device kWh');if(log.peakKwh!=null)numeric(log.peakKwh,'Peak kWh',0,log.kwh)}
  }
  for(const b of s.bills){
    dates(b.start,b.end);numeric(b.kwh,'Bill kWh');numeric(b.peakKwh,'Bill peak kWh',0,b.kwh);numeric(b.total,'Electric bill');if(b.energy!=null)numeric(b.energy,'Base energy charges',0,b.total)
    if(b.statement)dateMs(b.statement);if(b.provider!=null)text(b.provider,'Utility',100);if(b.note!=null)text(b.note,'Bill note')
    if(b.segments!=null){if(!Array.isArray(b.segments)||b.segments.length>50)throw new Error('Invalid bill segments.');for(const seg of b.segments){text(seg.label,'Segment label',100);numeric(seg.kwh,'Segment kWh');numeric(seg.rate,'Segment rate',0,10);numeric(seg.charge,'Segment charge')}if(Math.abs(b.segments.reduce((n,x)=>n+x.kwh,0)-b.kwh)>.05||b.energy==null||Math.abs(b.segments.reduce((n,x)=>n+x.charge,0)-b.energy)>.05)throw new Error('Bill line items must match the totals.')}
  }
  if(!['ac','dc','unknown'].includes(s.solar.kind)) throw new Error('Choose a valid solar meter location.')
  text(s.solar.name,'Solar meter name',100)
  if(s.solar.efficiency!=null)numeric(s.solar.efficiency,'Delivered share',.1,100)
  for(const r of s.solarReadings){numeric(r.kwh,'Solar counter');if(r.note!=null)text(r.note,'Solar note')}
  solarIntervals(s.solarReadings)
  for(const list of [s.devices,s.bills,s.solarReadings]) { const ids=new Set();for(const r of list){if(typeof r.id!=='string'||ids.has(r.id))throw new Error('Records need unique IDs.');ids.add(r.id)} }
  return ensureRooms(s)
}
export function seedState() { return {
  version:1, rates:{...DEFAULT_RATES},devices:[],solarReadings:[],rooms:defaultRooms(),nightHours:{...DEFAULT_NIGHT_HOURS},
  solar:{name:'Off-grid AC output meter',kind:'ac',efficiency:null},
  bills:[{id:'bill-2026-10',start:'2026-09-15',end:'2026-10-14',kwh:771,peakKwh:126,total:150.27,energy:72.47,statement:'2026-10-16',provider:'Xcel Energy',note:'Entered from your October 16 bill. Electricity only; gas excluded. Reading interval: 29 days.',segments:[{label:'Summer on-peak',kwh:65.17,rate:.21277,charge:13.87},{label:'Winter on-peak',kwh:60.83,rate:.18331,charge:11.15},{label:'Summer off-peak',kwh:333.62,rate:.07884,charge:26.30},{label:'Winter off-peak',kwh:311.38,rate:.06792,charge:21.15}]}]
} }

/** Source totals describe tracked loads; the solar meter journal is not added again. */
export function usageSummary(state,start,end) {
  const items=state.devices.map(d=>({d,...deviceEnergy(d,start,end,state.rates,state.nightHours)}))
  const grid=items.filter(x=>x.d.source==='grid'),solar=items.filter(x=>x.d.source==='solar'),mixed=items.filter(x=>x.d.source==='mixed')
  const total=(rows,key)=>rows.reduce((n,x)=>n+x[key],0)
  const totalKwh=total(items,'kwh'),averageKwhPerDay=total(grid,'kwh')/dates(start,end).length
  return {items,grid,solar,mixed,totalKwh,averageKwhPerDay,kwh:total(grid,'kwh'),low:total(grid,'low'),high:total(grid,'high'),solarKwh:total(solar,'kwh'),solarLow:total(solar,'low'),solarHigh:total(solar,'high'),mixedKwh:total(mixed,'kwh')}
}

export const ROOM_COLORS=['#6578b8','#b88049','#5b9680','#976ab0','#bf6b80','#5899ae','#9b9346','#6f8e54']
export const roomKey=name=>String(name??'').trim().replace(/\s+/g,' ').toLowerCase()
export function nextRoomColor(rooms) {
  const used=new Set(rooms.map(r=>r.color.toLowerCase()))
  for(const color of ROOM_COLORS)if(!used.has(color))return color
  for(let i=0;i<1000;i++){const color='#'+((0x426895+i*0x17a5b7)%0x1000000).toString(16).padStart(6,'0');if(!used.has(color))return color}
  throw new Error('No room colors available.')
}
export function defaultRooms(){return ['Bedroom','Office','Family room','Garage','Kitchen','Driveway'].map((name,i)=>({id:'room-'+(i+1),name,color:ROOM_COLORS[i]}))}
export function ensureRooms(s) {
  if(s.rooms===undefined){
    s.rooms=defaultRooms()
    for(const d of s.devices){const name=String(d.room??'').trim().replace(/\s+/g,' ');if(name&&!s.rooms.some(r=>roomKey(r.name)===roomKey(name)))s.rooms.push({id:'room-'+(s.rooms.length+1),name:name[0].toUpperCase()+name.slice(1),color:nextRoomColor(s.rooms)})}
  }
  validateRooms(s.rooms)
  for(const d of s.devices){if(!roomKey(d.room))continue;const room=s.rooms.find(r=>roomKey(r.name)===roomKey(d.room));if(!room)throw new Error('Choose a defined location for '+d.name+'.');d.room=room.name}
  return s
}
export function validateRooms(rooms) {
  if(!Array.isArray(rooms)||rooms.length>200)throw new Error('Invalid location list (up to 200 locations).')
  const ids=new Set(),names=new Set(),colors=new Set()
  for(const r of rooms){
    if(typeof r?.id!=='string'||!r.id||r.id.length>100||ids.has(r.id))throw new Error('Locations need unique IDs.')
    if(typeof r.name!=='string'||!roomKey(r.name)||r.name.length>80||names.has(roomKey(r.name))||['unassigned room','unassigned location'].includes(roomKey(r.name)))throw new Error('Use a unique location name (up to 80 characters).')
    if(typeof r.color!=='string'||!/^#[0-9a-f]{6}$/i.test(r.color)||colors.has(r.color.toLowerCase()))throw new Error('Each location needs a unique color.')
    ids.add(r.id);names.add(roomKey(r.name));colors.add(r.color.toLowerCase())
  }
  return rooms
}
export function updateRoom(s,id,name,color){
  name=name.trim().replace(/\s+/g,' ');const previous=s.rooms.find(r=>r.id===id)
  const room={id:id||'room-new',name,color:color.toLowerCase()}
  const rooms=previous?s.rooms.map(r=>r.id===id?room:r):[...s.rooms,room]
  validateRooms(rooms)
  if(previous)for(const d of s.devices)if(roomKey(d.room)===roomKey(previous.name))d.room=name
  s.rooms=rooms;return room
}
export function removeRoom(s,id){const room=s.rooms.find(r=>r.id===id);if(!room)throw new Error('Location not found.');for(const d of s.devices)if(roomKey(d.room)===roomKey(room.name))d.room='';s.rooms=s.rooms.filter(r=>r.id!==id)}

export function roomUsage(items){
  const totals=new Map()
  for(const x of items){const key=roomKey(x.d.room);if(!totals.has(key))totals.set(key,{kwh:0,gridLow:0,gridHigh:0,solarLow:0,solarHigh:0,mixedKwh:0,count:0})
    const r=totals.get(key);r.count++;r.kwh+=x.kwh
    if(x.d.source==='grid'){r.gridLow+=x.low;r.gridHigh+=x.high}
    else if(x.d.source==='solar'){r.solarLow+=x.low;r.solarHigh+=x.high}
    else r.mixedKwh+=x.kwh
  }
  return totals
}

/** Saved bill intervals plus the current billing cycle through today, inclusive. */
export function reportingPeriod(bills,today,selection='current') {
  const at=dateMs(today)
  const chosen=bills.find(b=>b.id===selection)
  if(chosen)return {id:chosen.id,start:chosen.start,end:chosen.end,anchored:true}
  const active=bills.filter(b=>dateMs(b.start)<=at&&dateMs(b.end)>at).sort((a,b)=>b.start.localeCompare(a.start))[0]
  const previous=bills.filter(b=>dateMs(b.end)<=at).sort((a,b)=>b.end.localeCompare(a.end))[0]
  return {id:'current',start:active?.start??previous?.end??today,end:iso(at+DAY),anchored:!!(active||previous)}
}

/** Inventory visibility follows the same whole-interval reporting boundary as totals. */
export function periodItems(items,start,end){return items.filter(x=>{
  const d=x.d
  if(d.mode==='event')return d.inputMode==='continuous'?d.start<end&&d.end>start:d.start>=start&&d.end<=end
  if(d.mode==='measured')return (d.logs??[d]).some(log=>log.start>=start&&log.end<=end)
  return x.kwh>0
})}

export const DEFAULT_NIGHT_HOURS={winterStart:'18:00',winterEnd:'00:00',summerStart:'19:30',summerEnd:'00:00'}
export function nightSchedule(config,which){
  const startTime=config[which+'Start'],endTime=config[which+'End']
  const minutes=t=>{if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(t??''))throw new Error('Enter a valid nighttime start and end.');const[h,m]=t.split(':').map(Number);return h*60+m}
  const duration=(minutes(endTime)-minutes(startTime)+1440)%1440
  if(!duration)throw new Error('Nighttime start and end must differ.')
  return {startTime,hours:duration/60}
}
export function ensureNightHours(s){
  if(s.nightHours===undefined){
    s.nightHours={...DEFAULT_NIGHT_HOURS}
    for(const d of s.devices)if(d.mode==='schedule'&&d.startTime==='18:00'&&d.hours===6&&d.summerStartTime==='19:30'&&d.summerHours===4.5)d.nightTime=true
  }
  if(!s.nightHours||typeof s.nightHours!=='object')throw new Error('Invalid nighttime settings.')
  nightSchedule(s.nightHours,'winter');nightSchedule(s.nightHours,'summer')
  return s
}
export function continuousEventEnergy(d,start,end,rates){
  const a=d.start>start?d.start:start,b=d.end<end?d.end:end
  const result={kwh:0,peak:0,low:0,high:0,flat:0,measured:false,excluded:false}
  if(a>=b)return result
  for(const day of dates(a,b))for(let h=0;h<24;h++){
    const at=day+h*3600000,kwh=d.watts/1000
    result.kwh+=kwh;if(isPeak(at))result.peak+=kwh
    result.low+=kwh*(d.source==='solar'?SOLAR_AVERAGE_RATES[season(at)]:rateAt(at,rates))
    result.flat+=kwh*rateAt(at,rates,true)
  }
  result.high=result.low
  return result
}
export function mergeIdleActive(s,idleId,activeId,name,activeIsTotal=false){
  const idle=s.devices.find(d=>d.id===idleId),active=s.devices.find(d=>d.id===activeId)
  if(!idle||!active||idle===active)throw new Error('Choose two different devices.')
  if(idle.mode!=='schedule'||active.mode!=='schedule'||roomKey(idle.room)!==roomKey(active.room)||idle.source!==active.source)throw new Error('Both entries must be scheduled devices in the same location and on the same power source.')
  if(idle.hours!==24||idle.nightTime||idle.summerStartTime||(idle.idleWatts??0)!==0||!Array.from({length:7},(_,i)=>i).every(i=>idle.days.includes(i))||(active.idleWatts??0)!==0)throw new Error('The idle entry must run continuously all week, and neither entry may already have standby.')
  const merged={...active,name:name.trim(),idleWatts:idle.watts,watts:activeIsTotal?active.watts:idle.watts+active.watts}
  validateDevice(merged)
  s.devices=s.devices.filter(d=>d.id!==idleId).map(d=>d.id===activeId?merged:d)
  return merged
}


/** Highest grid cost first; uncertain costs use their midpoint. Keep devices grouped and stable. */
export function sortByLocationGridCost(items){
  const totals=roomUsage(items)
  const cost=key=>{const t=totals.get(key);return (t.gridLow+t.gridHigh)/2}
  return [...items].sort((a,b)=>{
    const left=roomKey(a.d.room),right=roomKey(b.d.room)
    return cost(right)-cost(left)||(left||'unassigned location').localeCompare(right||'unassigned location','en')
  })
}
