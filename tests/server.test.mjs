import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import {execFileSync,spawn} from 'node:child_process'
import {buildServer} from '../build-server.mjs'

const php=process.env.HOUSECURRENT_PHP||'php'
let phpArgs=[],phpReady=false
try{
 let drivers=execFileSync(php,['-r','echo implode(",",PDO::getAvailableDrivers());'],{encoding:'utf8'})
 if(!drivers.includes('sqlite')&&process.platform==='win32'&&fs.existsSync(path.join(path.dirname(php),'ext/php_pdo_sqlite.dll'))){phpArgs=['-d','extension_dir='+path.join(path.dirname(php),'ext'),'-d','extension=pdo_sqlite'];drivers=execFileSync(php,[...phpArgs,'-r','echo implode(",",PDO::getAvailableDrivers());'],{encoding:'utf8'})}
 phpReady=drivers.includes('sqlite')
}catch{}

test('hosted build keeps server saves separate from offline storage and is valid JavaScript',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'housecurrent-build-'))
 buildServer(dir)
 const app=fs.readFileSync(path.join(dir,'app.js'),'utf8')
 const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');assert.ok(!html.includes('class="topbar"'));assert.ok(html.includes('id="server-auth"'));assert.ok(html.indexOf('id="server-auth"')<html.indexOf('</aside>'))
 assert.ok(app.includes('const SERVER_BOOT=await serverAPI'))
 assert.ok(app.includes('await save()'));assert.ok(!app.includes("localStorage.setItem('housecurrent-v1'"))
 assert.ok(!app.includes("getItem('housecurrent-v1'"));assert.ok(app.includes('stopImmediatePropagation'))
 assert.ok(app.includes('if(serverSaving)return'));assert.ok(app.includes('finally{serverSaving=false}'))
 execFileSync(process.execPath,['--check','--input-type=module'],{input:app})
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'starter-state.json'),'utf8')).devices.length,0)
})

test('PHP authentication, CSRF, persistence, rate limits, conflicts and password reset',{skip:!phpReady?'PHP with PDO SQLite is required; set HOUSECURRENT_PHP to run server tests.':false},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'housecurrent-api-')),publicDir=path.join(root,'public'),privateDir=path.join(root,'private')
 buildServer(publicDir)
 for(const name of ['api.php','store.php','setup.php'])execFileSync(php,[...phpArgs,'-l',path.join(publicDir,name)])
 const plainHTTP=execFileSync(php,[...phpArgs,'-r','putenv("HOUSECURRENT_ALLOW_LOCAL_HTTP"); require $argv[1];',path.join(publicDir,'api.php')],{encoding:'utf8'})
 assert.match(JSON.parse(plainHTTP).error,/Use HTTPS/)
 const password='QA-only-password-72845',newPassword='QA-reset-password-99183'
 const setup=(secret,reset=false)=>execFileSync(php,[...phpArgs,path.join(publicDir,'setup.php'),privateDir,...(reset?['--reset-password']:[])],{input:secret+'\n'+secret+'\n',encoding:'utf8'})
 assert.match(setup(password),/Configured/)
 const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve))
 const base=`http://127.0.0.1:${port}`
 const child=spawn(php,[...phpArgs,'-S',`127.0.0.1:${port}`,'-t',publicDir],{env:{...process.env,HOUSECURRENT_PRIVATE_DIR:privateDir,HOUSECURRENT_ALLOW_LOCAL_HTTP:'1'},stdio:'pipe'})
 let logs='';child.stderr.on('data',s=>logs+=s);child.stdout.on('data',s=>logs+=s)
 t.after(()=>child.kill())
 for(let tries=0;;tries++){try{await fetch(base+'/api.php?action=state');break}catch{if(tries>60)throw Error(logs);await new Promise(resolve=>setTimeout(resolve,50))}}
 const client=()=>({cookie:'',csrf:''})
 const viewer=client(),owner=client()
 async function api(user,action,body,extra={}){
  const response=await fetch(base+'/api.php?action='+action,{method:body===undefined?'GET':'POST',headers:{...(user.cookie?{Cookie:user.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':user.csrf}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})})
  for(const cookie of response.headers.getSetCookie())if(cookie.startsWith('hc_'))user.cookie=cookie.split(';')[0]
  const data=await response.json();if(data.csrf)user.csrf=data.csrf
  return {status:response.status,data,headers:response.headers}
 }
 const first=await api(viewer,'state');assert.equal(first.status,200);assert.equal(first.data.editable,false);assert.ok(first.headers.get('set-cookie').includes('HttpOnly'));assert.ok(first.headers.get('set-cookie').includes('SameSite=Strict'))
 assert.equal((await api(viewer,'save',{state:first.data.state,revision:1})).status,401)
 await api(owner,'state')
 assert.equal((await api(owner,'login',{password},{'X-CSRF-Token':'forged'})).status,403)
 assert.equal((await api(owner,'login',{password},{Origin:'https://evil.example'})).status,403)
 assert.equal((await api(owner,'login',{password:'wrong'})).status,401)
 assert.equal((await api(owner,'login',{password})).status,200)
 let latest=await api(owner,'state');assert.equal(latest.data.editable,true)
 assert.equal((await api(owner,'save',{state:{version:1},revision:1})).status,400)
 const invalid=structuredClone(latest.data.state);invalid.devices=[{id:'bad',name:'Bad computer',room:'',mode:'schedule',source:'grid',watts:0,idleWatts:200,hours:8,startTime:'09:00',days:[1]}]
 assert.equal((await api(owner,'save',{state:invalid,revision:1})).status,400)
 const updated=structuredClone(latest.data.state);updated.rooms[0].name='Saved from phone'
 const saved=await api(owner,'save',{state:updated,revision:latest.data.revision});assert.equal(saved.status,200);assert.equal(saved.data.revision,2)
 assert.equal((await api(owner,'save',{state:latest.data.state,revision:1})).status,409)
 const publicRead=await api(viewer,'state');assert.equal(publicRead.data.state.rooms[0].name,'Saved from phone');assert.equal(publicRead.data.editable,false)
 assert.equal(fs.existsSync(path.join(publicDir,'housecurrent.sqlite')),false)
 assert.equal(fs.existsSync(path.join(privateDir,'housecurrent.sqlite')),true)
 assert.ok(!(await (await fetch(base+'/housecurrent.sqlite')).text()).startsWith('SQLite format'))
 assert.equal((await fetch(base+'/setup.php')).status,404)
 setup(newPassword,true)
 assert.equal((await api(owner,'state')).data.editable,false)
 assert.equal((await api(owner,'save',{state:updated,revision:2})).status,401)
 await api(owner,'state');assert.equal((await api(owner,'login',{password:newPassword})).status,200)
 latest=await api(owner,'state');assert.equal(latest.data.revision,2)
 assert.equal((await api(owner,'logout',{})).status,200)
 await api(owner,'state');assert.equal((await api(owner,'save',{state:updated,revision:2})).status,401)
 for(let i=0;i<5;i++)assert.equal((await api(owner,'login',{password:'wrong'})).status,401)
 assert.equal((await api(owner,'login',{password:newPassword})).status,429)
 assert.equal((await api(viewer,'state')).status,200)
})
