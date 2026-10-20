import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {seedState} from './dist/energy.js'
const root=path.dirname(fileURLToPath(import.meta.url))
export function buildServer(output){
 fs.mkdirSync(output,{recursive:true})
 const read=name=>fs.readFileSync(path.join(root,name),'utf8')
 let app=read('dist/app.js')
 const replace=(before,after)=>{if(!app.includes(before))throw Error('Server adapter needs updating: '+before.slice(0,60));app=app.replace(before,after)}
 const begin=app.indexOf('const PUBLISHED_STATE=null'),end=app.indexOf("let periodChoice='current'")
 if(begin<0||end<begin)throw Error('Cannot adapt app initialization.')
 app=app.slice(0,begin)+`const SERVER_BOOT=await serverAPI('state');
let READ_ONLY=!SERVER_BOOT.editable,serverRevision=SERVER_BOOT.revision,serverCSRF=SERVER_BOOT.csrf,serverSaving=false;
let state=validateState(SERVER_BOOT.state),storageOK=true,loadWarning='';
`+app.slice(end)
 const a=app.indexOf('function save(){'),b=app.indexOf('function toast(',a)
 if(a<0||b<a)throw Error('Cannot adapt save.')
 app=app.slice(0,a)+`async function save(){if(READ_ONLY)throw Error('Sign in to edit.');validateState(state);const saved=await serverAPI('save',{state,revision:serverRevision});serverRevision=saved.revision;storageOK=true}
`+app.slice(b)
 replace("document.addEventListener('submit',e=>", "document.addEventListener('submit',async e=>")
 replace('const oldState=structuredClone(state);try{', 'if(serverSaving)return;serverSaving=true;const oldState=structuredClone(state);try{')
 replace("}catch(error){state=oldState;$('#form-error').textContent=error.message}})", "}catch(error){state=oldState;$('#form-error').textContent=error.message}finally{serverSaving=false}})")
 replace('validateState(state);save();render();roomsForm()', 'validateState(state);await save();render();roomsForm()')
 replace("validateState(state);save();$('#modal').close();render();toast(kind==='remove'?'Record removed.':'Saved to this browser.')", "validateState(state);await save();$('#modal').close();render();toast(kind==='remove'?'Record removed.':'Saved to the server.')")
 replace("form.addEventListener('submit',event=>", "form.addEventListener('submit',async event=>")
 replace("state=incoming;loadWarning='';save();selectPeriod('current');$('#modal').close();render();toast('Backup restored.')", "if(serverSaving)return;serverSaving=true;const beforeRestore=state;try{state=incoming;await save();loadWarning='';selectPeriod('current');$('#modal').close();render();toast('Backup restored to server.')}catch(error){state=beforeRestore;$('#form-error').textContent=error.message}finally{serverSaving=false}")
 replace("READ_ONLY?'Read-only snapshot':storageOK?'Saved on this device'", "READ_ONLY?'Public view':storageOK?'Saved to server'")
 replace('Published snapshot<small>Updates are made in the local app.', 'Public view<small>Sign in to edit this household.')
 replace("'<h3>Read-only snapshot.</h3><p>Records are included in this website file and load identically across browsers. Updates are made in the local editor, then exported and uploaded as a replacement snapshot. This page has no shared data-writing service.</p>'", "'<h3>Shared household data.</h3><p>Everyone can view the current server records. Sign in to add or adjust entries; changes are saved on the server. Export backups regularly.</p>'")
 replace("'<h3>Your data stays in this browser.</h3><p>Device and meter entries are saved in local browser storage; there is no cloud sync. Use Export backup and Restore backup to move data or recover it. Private browsing, clearing site data, or changing browsers can remove access to local records.</p>'", "'<h3>Shared household data.</h3><p>Edits are saved on the server and shared across devices. Export backups regularly. Restoring a backup replaces the shared records.</p>'")
 replace('This replaces the data currently saved in this browser.', 'This replaces the shared household data on the server.')
 app+=`\n${read('server/client.js')}\n`
 let html=read('dist/index.html').replace('<span id="save-state">Saved on this device</span>','<span id="save-state">Loading server data…</span>')
 html=html.replace('<div class="sidebar-bottom">', '<div class="sidebar-bottom"><button id="server-auth" class="backup-btn server-auth" type="button">Sign in to edit</button>')
 html=html.replace('Saved in this browser.<br>Export a backup to keep it safe.','Saved on the server.<br>Export a backup to keep it safe.')
 html=html.replace('<script type="module" src="app.js"></script>',`<script type="module">import('./app.js').catch(()=>{document.getElementById('content').textContent='Housecurrent could not load its server data. Check HTTPS and complete the server setup, then reload.'})</script>`)
 for(const [name,data]of Object.entries({'index.html':html,'app.js':app,'energy.js':read('dist/energy.js'),'styles.css':read('dist/styles.css'),'starter-state.json':JSON.stringify(seedState()),'api.php':read('server/api.php'),'store.php':read('server/store.php'),'setup.php':read('server/setup.php'),'.htaccess':read('server/.htaccess')}))fs.writeFileSync(path.join(output,name),data)
 console.log('Built PHP hosted app: '+output+' (no household records or credentials included).')
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))buildServer(path.resolve(process.argv[2]||path.join(root,'hosted/power')))
