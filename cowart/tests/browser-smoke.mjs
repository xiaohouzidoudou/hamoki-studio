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
  const errors=[],apiResponses=[],failedRequests=[],consoleErrors=[]
  page.on('pageerror',e=>errors.push({message:e.message,stack:e.stack?.slice(0,750)}))
  page.on('requestfailed',r=>failedRequests.push({url:r.url(),failure:r.failure()}))
  page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text().slice(0,500))})
  page.on('response',res=>{if(res.url().includes('/api/cowart/snapshot'))apiResponses.push(res.status()+' '+res.request().method())})
  const entry=base+'/cowart/?projectId='+encodeURIComponent(projectId)
  const response=await page.goto(entry,{waitUntil:'domcontentloaded',timeout:25000})
  assert.equal(response.status(),200)
  await page.locator('.hamoki-studio-panel').waitFor({timeout:25000})
  await page.waitForFunction(()=>!!window.__cowartEditor,{timeout:25000})
  const dark=await page.evaluate(()=>window.__cowartEditor.user.getIsDarkMode())
  assert.equal(dark,true,'Studio canvas must start in dark mode')
  const canvasBounds=await page.locator('.cowart-canvas > .tl-container').boundingBox()
  const panelBounds=await page.locator('.hamoki-studio-panel').boundingBox()
  assert.ok(canvasBounds&&panelBounds)
  assert.ok(canvasBounds.x+canvasBounds.width<=panelBounds.x+8,
    'Studio sidebar must not overlap the editable canvas viewport on desktop')
  const firstShapes=await page.evaluate(()=>window.__cowartEditor.getCurrentPageShapes().length)
  assert.equal(firstShapes,0,'Fresh project should start on an empty canvas, not giant onboarding labels')
  await page.getByLabel('执行方式').selectOption('smart')
  const visionSwitch=page.locator('.hamoki-vision-switch input[type="checkbox"]')
  await visionSwitch.waitFor({timeout:8000})
  assert.equal(await visionSwitch.isChecked(),true,'Selected-image visual understanding is enabled by default')
  await visionSwitch.uncheck()
  assert.equal(await visionSwitch.isChecked(),false,'User can disable additional charged vision analysis')
  await visionSwitch.check()
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
  mkdirSync(path.join(root,'cowart','test-results'),{recursive:true})
  await page.screenshot({path:path.join(root,'cowart','test-results','browser-smoke.png'),fullPage:true})
  if(!stored) {
    const saveAlert=await page.locator('.hamoki-save-error').allTextContents()
    console.error('Browser save diagnostic:',JSON.stringify({saveAlert,apiResponses,errors,appLogs:output.slice(-1400)}))
  }
  assert.equal(stored,true,'Document was not saved to authenticated Studio snapshot')
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>!!window.__cowartEditor?.getShape('shape:smoke-green-card'),{timeout:25000})
  if(errors.length)console.error('Browser resources diagnostic:',JSON.stringify({errors,failedRequests,consoleErrors}))
  assert.equal(errors.length,0,'Browser page errors: '+errors.map(x=>x.message).join(' | '))
  mkdirSync(path.join(root,'cowart','test-results'),{recursive:true})
  await page.screenshot({path:path.join(root,'cowart','test-results','browser-smoke.png'),fullPage:true})
  // Mock only image/provider APIs: authentication, canvas persistence and reload
  // still use the real gateway. These are not paid-provider E2E claims.
  const imageRows=[], imageJobs=[], submissions=[]
  let rejectSave=false
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==','base64')
  await page.route('**/api/providers',route=>route.fulfill({json:{activeId:'mock',providers:[
    {id:'mock',name:'Mock image provider',hasKey:true,imageModel:'mock-image'}
  ]}}))
  await page.route('**/api/media/*.png',route=>route.fulfill({contentType:'image/png',body:png}))
  await page.route('**/api/history?*',route=>route.fulfill({json:{history:imageRows}}))
  await page.route('**/api/jobs**',async route=>{
    if(route.request().method()==='POST'){
      const payload=route.request().postDataJSON()
      submissions.push(payload)
      const id=crypto.randomUUID(),resultId=crypto.randomUUID()
      imageRows.push({id:resultId,projectId,prompt:payload.prompt,url:'/api/media/'+resultId+'.png'})
      const job={id,resultId,status:'done'}
      imageJobs.push(job)
      await route.fulfill({json:{jobs:[job]}})
    }else await route.fulfill({json:{jobs:imageJobs}})
  })
  await page.route('**/api/cowart/snapshot?*',route=>{
    if(rejectSave && route.request().method()==='PUT')
      return route.fulfill({status:503,json:{error:'模拟保存失败'}})
    return route.continue()
  })
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>!!window.__cowartEditor)
  await page.getByLabel('执行方式').selectOption('direct')
  await page.evaluate(()=>window.__cowartEditor.selectNone())
  const recoveryKey='hamoki-cowart-active:'+projectId
  for(let round=0;round<3;round++){
    if(round>0){
      const previous=imageRows.at(-1).id
      await page.evaluate(id=>{
        const e=window.__cowartEditor
        e.select(e.getCurrentPageShapes().find(s=>s.meta?.studioHistoryId===id).id)
      },previous)
    }
    console.log('Mock image round:',round+1)
    rejectSave=round===1
    await page.locator('.hamoki-studio-panel textarea').fill(round===0?'生成游戏按钮':'保持布局，调整按钮颜色 '+round)
    await page.getByRole('button',{name:'直接生成 1 张',exact:true}).click()
    await page.waitForFunction(n=>window.__cowartEditor.getCurrentPageShapes().filter(s=>s.meta?.studioHistoryId).length===n,round+1)
    assert.equal(submissions.length,round+1)
    assert.equal(submissions[round].sourceId,round===0?undefined:imageRows[round-1].id)
    if(rejectSave){
      await page.locator('.hamoki-save-error').waitFor()
      const pending=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),recoveryKey)
      assert.equal(pending.jobId,imageJobs[round].id,'Failed save must retain original job identity')
      assert.equal(pending.resultId,imageRows[round].id)
      await page.getByRole('button',{name:'开启下一轮',exact:true}).click()
      assert.equal(await page.evaluate(key=>!!sessionStorage.getItem(key),recoveryKey),true)
      await page.getByRole('button',{name:'直接生成 1 张',exact:true}).click()
      assert.equal(submissions.length,round+1,'Unsaved result must block a new image submission')
      // Reload before result was saved: recover by polling the same job, never POST again.
      rejectSave=false
      await page.reload({waitUntil:'domcontentloaded'})
      await page.waitForFunction(n=>window.__cowartEditor?.getCurrentPageShapes().filter(s=>s.meta?.studioHistoryId).length===n,round+1)
      assert.equal(submissions.length,round+1,'Recovery must not submit another image job')
    }
    await page.waitForFunction(key=>!sessionStorage.getItem(key),recoveryKey)
    if(round<2){
      await page.getByRole('button',{name:'开启下一轮',exact:true}).click()
    }
  }
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.__cowartEditor?.getCurrentPageShapes().filter(s=>s.meta?.studioHistoryId).length===3)
  const generated=await page.evaluate(()=>window.__cowartEditor.getCurrentPageShapes()
    .filter(s=>s.meta?.studioHistoryId).map(s=>({id:s.meta.studioHistoryId,x:s.x,y:s.y})))
  assert.deepEqual(generated.map(s=>s.id).sort(),imageRows.map(s=>s.id).sort(),'Original and both edited versions survive reload')
  const chain=imageRows.map(row=>generated.find(s=>s.id===row.id))
  assert.ok(chain[1].x>chain[0].x && chain[2].x>chain[1].x,'Edits are placed left to right without replacing originals')
  assert.equal(submissions.length,3)
  assert.equal(new Set(submissions.map(s=>s.idempotencyKey)).size,3)
  const legacyUrl='/api/media/'+crypto.randomUUID()+'.png'
  await page.route('**/api/projects/'+projectId,route=>route.fulfill({json:{project:{id:projectId,nodes:[
    {id:'legacy-reference',kind:'reference',url:legacyUrl,x:40,y:900,w:128,h:128}
  ]}}}))
  await page.getByRole('button',{name:'↳ 导入旧 Studio 画布素材',exact:true}).click()
  await page.waitForFunction(()=>window.__cowartEditor.getCurrentPageShapes().some(s=>s.meta?.studioNodeId==='legacy-reference'))
  await page.getByRole('button',{name:'↳ 导入旧 Studio 画布素材',exact:true}).click()
  await page.waitForFunction(()=>!document.querySelector('.hamoki-legacy-tools button').disabled)
  assert.equal(await page.evaluate(()=>window.__cowartEditor.getCurrentPageShapes()
    .filter(s=>s.meta?.studioNodeId==='legacy-reference').length),1,'Legacy remote image imports without invalid fileSize or duplication')
  await page.evaluate(()=>{window.__cowartEditor.zoomToFit({animation:{duration:0}})})
  assert.equal(errors.length,0,'Image workflow must not cause browser page errors')
  await page.screenshot({path:path.join(root,'cowart','test-results','browser-smoke.png'),fullPage:true})
  console.log('PASS: mock generation + two edits, saved versions, failed-save reload recovery; exactly three image submissions')
  console.log('PASS: authenticated Cowart renders, Studio panel responds, tldraw shape persists and survives reload')
}catch(error){
  const failedPage=browser?.contexts()[0]?.pages()[0]
  if(failedPage){
    console.error('Browser smoke diagnostic:',await failedPage.locator('.hamoki-studio-panel').innerText().catch(()=>''))
    console.error('Canvas recovery diagnostic:',await failedPage.evaluate(()=>({
      shapes:window.__cowartEditor?.getCurrentPageShapes().map(s=>({id:s.id,meta:s.meta})),
      recovery:Object.fromEntries(Object.entries(sessionStorage).filter(([key])=>key.startsWith('hamoki-cowart-')))
    })).catch(()=>null))
    await failedPage.screenshot({path:path.join(root,'cowart','test-results','browser-smoke.png'),fullPage:true}).catch(()=>{})
  }
  throw error
}finally{
  await browser?.close()
  app.kill('SIGTERM')
  rmSync(data,{recursive:true,force:true})
}
