import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {execFileSync} from 'node:child_process'

test('standalone app has embedded assets and syntactically valid bundled JavaScript',()=>{
  const html=fs.readFileSync('Housecurrent.html','utf8')
  const scripts=[...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)]
  assert.equal(scripts.length,1)
  assert.ok(html.includes('<style>'))
  assert.ok(!html.includes('src="app.js"'))
  assert.ok(!html.includes('href="styles.css"'))
  assert.ok(!html.includes('fonts.googleapis.com'))
  assert.ok(!/^import /m.test(scripts[0][1]))
  assert.ok(!/^export /m.test(scripts[0][1]))
  execFileSync(process.execPath,['--check','--input-type=module'],{input:scripts[0][1]})
  assert.equal(html,fs.readFileSync('dist/Housecurrent.html','utf8'))
})
