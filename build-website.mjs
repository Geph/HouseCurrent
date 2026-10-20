import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {validateState} from './dist/energy.js'

export function websiteHTML(input){
 const root=path.dirname(fileURLToPath(import.meta.url))
 const snapshot=validateState(structuredClone(input))
 const css=fs.readFileSync(path.join(root,'dist/styles.css'),'utf8')
 const energy=fs.readFileSync(path.join(root,'dist/energy.js'),'utf8').replace(/^export /gm,'')
 const literal=JSON.stringify(snapshot).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')
 const app=fs.readFileSync(path.join(root,'dist/app.js'),'utf8').replace(/^import .*\r?\n/,'').replace('const PUBLISHED_STATE=null',()=>`const PUBLISHED_STATE=${literal}`)
 let html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8')
 html=html.replace('<link rel="stylesheet" href="styles.css">',()=>`<style>${css}</style>`)
 html=html.replace('<script type="module" src="app.js"></script>','')
 return html.replace('</body>',()=>`<script type="module">${(energy+'\n'+app).replace(/<\/script/gi,'<\\/script')}</script></body>`)
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [backup,output]=process.argv.slice(2)
 if(!backup||!output)throw new Error('Usage: node build-website.mjs BACKUP.json OUTPUT/index.html')
 const html=websiteHTML(JSON.parse(fs.readFileSync(backup,'utf8')))
 fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true})
 fs.writeFileSync(output,html)
 console.log(`Created read-only snapshot: ${path.resolve(output)}. Nothing uploaded.`)
}
