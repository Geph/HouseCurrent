import {test} from 'node:test'
import assert from 'node:assert/strict'
import {sortByLocationGridCost,seedState,updateRoom} from '../dist/energy.js'

test('inventory orders aggregated location grid costs descending, ignoring solar savings and mixed values',()=>{
 const entry=(id,room,source,low,high=low)=>({d:{id,room,source},kwh:1,low,high})
 const items=[entry('a1','Office','grid',3),entry('solar','Workshop','solar',200),entry('k','Kitchen','grid',7),entry('a2',' office ','grid',6),entry('mix','Workshop','mixed',400),entry('range','Attic','grid',5,11),entry('tie','Bedroom','grid',7),entry('none','','grid',0)]
 const sorted=sortByLocationGridCost(items)
 assert.deepEqual(sorted.map(x=>x.d.id),['a1','a2','range','tie','k','none','solar','mix'])
 assert.deepEqual(items.map(x=>x.d.id),['a1','solar','k','a2','mix','range','tie','none'])
 assert.deepEqual(sortByLocationGridCost([]),[])
})

test('unassigned location label is reserved to avoid ambiguous inventory groups',()=>{assert.throws(()=>updateRoom(seedState(),'reserved','Unassigned location','#123456'),/unique location name/)})
