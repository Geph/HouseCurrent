import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const root=path.resolve('dist')
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'}
http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');const target=path.resolve(root,'.'+decodeURIComponent(url.pathname));const file=url.pathname.endsWith('/')?path.join(target,'index.html'):target;if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end()}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found')}res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(data)})}).listen(3022,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:3022'))
