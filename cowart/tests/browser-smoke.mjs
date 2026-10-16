import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here=path.dirname(fileURLToPath(import.meta.url))
const root=path.resolve(here,'../..')
const data=mkdtempSync(path.join(tmpdir(),'hamoki-cowart-browser-'))
const port=await new Promise(resolve=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p))})})
const app=spawn(process.execPath,[path.join(root,'gateway.js')],{cwd:root,env:{
  ...process.env,HOST:'127.0.0.1',PORT:String(port),APP_ALLOWED_HOST:'127.0.0.1',
  COWART_PREVIEW:'1',DATA_DIR:data,APP_ENCRYPTION_KEY:'browser-smoke-local-only-secret-123456789012345',
  COOKIE_SECURE:'0',INVITE_CODE:'local-smoke',NODE_ENV:'test'
},stdio:['ignore','pipe','pipe']})
let output=''
for(const stream of [app.stdout,app.stderr])stream.on('data',buf=>output+=buf)
let browser
try{
  for(let i=0;i<150&&!output.includes('account gateway ready');i++){
    if(app.exitCode!==null)throw Error('Gateway boot failed: '+output)
    await new Promise(r=>setTimeout(r,80))
  }
  assert.match(output,/account gateway ready/,'Studio gateway did not start')
  browser=await chromium.launch({headless:true})
  const context=await browser.newContext()
  const base='http://127.0.0.1:'+port
  const registration=await context.request.post(base+'/api/register',{data:{
    username:'smokeuser',password:'safe-test-123',inviteCode:'local-smoke'
  }})
  assert.equal(registration.status(),201,await registration.text())
  const projects=await (await context.request.get(base+'/api/projects')).json()
  const projectId=projects.defaultId
  assert.match(projectId,/^[a-f0-9-]{36}$/)
  const page=await context.newPage()
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  const entry=base+'/cowart/?projectId='+encodeURIComponent(projectId)
  const response=await page.goto(entry,{waitUntil:'domcontentloaded',timeout:25000})
  assert.equal(response.status(),200)
  await page.locator('.hamoki-studio-panel').waitFor({timeout:25000})
  await page.waitForFunction(()=>!!window.__cowartEditor,{timeout:25000})
  await page.locator('textarea').fill('把周年庆奖励按钮简化，减少背景灯光，不增加前景')
  assert.equal(await page.locator('.hamoki-studio-panel textarea').inputValue(),
    '把周年庆奖励按钮简化，减少背景灯光，不增加前景')
  // Change the actual tldraw document and ensure the gateway persists it, not IndexedDB.
  await page.evaluate(()=>{
    const editor=window.__cowartEditor
    editor.createShape({id:'shape:smoke-green-card',type:'geo',x:240,y:240,
      props:{geo:'rectangle',w:220,h:130,color:'green'}})
  })
  let stored=false
  for(let i=0;i<80;i++){
    await new Promise(resolve=>setTimeout(resolve,120))
    const res=await context.request.get(base+'/api/cowart/snapshot?projectId='+projectId)
    const obj=await res.json()
    if(obj.snapshot?.store?.['shape:smoke-green-card']){stored=true;break}
  }
  assert.equal(stored,true,'Document was not saved to authenticated Studio snapshot')
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>!!window.__cowartEditor?.getShape('shape:smoke-green-card'),{timeout:25000})
  assert.equal(errors.length,0,'Browser page errors: '+errors.join(' | '))
  mkdirSync(path.join(root,'cowart','test-results'),{recursive:true})
  await page.screenshot({path:path.join(root,'cowart','test-results','browser-smoke.png'),fullPage:true})
  console.log('PASS: authenticated Cowart renders, Studio panel responds, tldraw shape persists and survives reload')
}finally{
  await browser?.close()
  app.kill('SIGTERM')
  rmSync(data,{recursive:true,force:true})
}
