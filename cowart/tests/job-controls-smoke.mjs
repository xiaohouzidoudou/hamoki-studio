import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const data=mkdtempSync(path.join(tmpdir(),'cowart-cancel-browser-'))
let calls=0,releaseUpstream
const upstream=createServer(async(req,res)=>{
  for await(const _ of req){}
  calls++
  await new Promise(resolve=>{releaseUpstream=resolve})
  res.end('{}')
})
await new Promise(r=>upstream.listen(0,'127.0.0.1',r))
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
const app=spawn(process.execPath,[path.join(root,'gateway.js')],{cwd:root,env:{...process.env,
  HOST:'127.0.0.1',PORT:String(port),APP_ALLOWED_HOST:'127.0.0.1',DATA_DIR:data,
  APP_ENCRYPTION_KEY:'local-cancel-smoke-only-12345678901234567890',INVITE_CODE:'local',
  COOKIE_SECURE:'0',COWART_PREVIEW:'1',NODE_ENV:'test',ALLOW_PRIVATE_UPSTREAMS:'1'
},stdio:['ignore','pipe','pipe']})
let output='',browser,page
for(const stream of [app.stdout,app.stderr])stream.on('data',buf=>output+=buf)
const screenshot=path.join(root,'cowart','test-results','job-controls.png')
mkdirSync(path.dirname(screenshot),{recursive:true})
try{
  for(let i=0;i<150&&!output.includes('account gateway ready');i++){
    if(app.exitCode!==null)throw Error(output)
    await new Promise(r=>setTimeout(r,50))
  }
  assert.match(output,/account gateway ready/)
  browser=await chromium.launch({headless:true})
  const context=await browser.newContext(),base='http://127.0.0.1:'+port
  assert.equal((await context.request.post(base+'/api/register',{data:{username:'cancelbrowser',password:'password123',inviteCode:'local'}})).status(),201)
  const projectId=(await(await context.request.get(base+'/api/projects')).json()).defaultId
  assert.equal((await context.request.post(base+'/api/providers',{data:{name:'本地模拟图片上游',url:'http://127.0.0.1:'+upstream.address().port+'/v1',mode:'openai',imageMode:'images',imageModel:'slow',apiKey:'local-test-only'}})).status(),201)
  await context.request.post(base+'/api/queue',{data:{action:'pause'}})
  page=await context.newPage()
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  let submissions=0,cancellations=0,releaseCancel,signalCancel
  const held=new Promise(resolve=>{releaseCancel=resolve}),captured=new Promise(resolve=>{signalCancel=resolve})
  page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/jobs')submissions++})
  await page.route('**/api/jobs/*/cancel',async route=>{
    cancellations++
    if(cancellations===1){await route.fetch();return route.abort('failed')}
    signalCancel();await held;return route.continue()
  })
  await page.goto(base+'/cowart/?projectId='+projectId,{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>!!window.__cowartEditor)
  await page.getByLabel('执行方式').selectOption('direct')
  await page.locator('textarea').fill('排队取消验证')
  await page.getByRole('button',{name:'直接生成 1 张',exact:true}).click()
  const cancel=page.getByRole('button',{name:'取消此任务',exact:true})
  await cancel.waitFor()
  page.once('dialog',d=>d.dismiss());await cancel.click()
  assert.equal(cancellations,0,'拒绝确认不得请求取消')
  page.once('dialog',d=>d.accept());await cancel.click()
  await page.locator('.hamoki-job-controls').filter({hasText:'服务器已记录取消'}).waitFor()
  assert.equal(await page.getByRole('button',{name:'直接生成 1 张',exact:true}).isDisabled(),true,'核对原任务并开启下一轮前不得直接重发')
  assert.equal(calls,0);assert.equal(submissions,1)
  let jobs=(await(await context.request.get(base+'/api/jobs?projectId='+projectId)).json()).jobs
  assert.equal(jobs[0].status,'cancelled');assert.equal(jobs[0].requestOutcome,'not_sent')
  await page.getByRole('button',{name:'开启下一轮',exact:true}).click()
  await context.request.post(base+'/api/queue',{data:{action:'resume'}})
  await page.locator('textarea').fill('运行中取消验证')
  await page.getByRole('button',{name:'直接生成 1 张',exact:true}).click()
  for(let i=0;i<150&&calls<1;i++)await new Promise(r=>setTimeout(r,40))
  assert.equal(calls,1)
  await page.locator('.hamoki-job-controls').filter({hasText:'收费结果尚未确认'}).waitFor()
  page.once('dialog',d=>{assert.match(d.message(),/不能保证退款/);d.accept()});await cancel.click()
  await captured
  assert.equal(await page.getByRole('button',{name:'正在取消…',exact:true}).isDisabled(),true)
  releaseCancel()
  await page.locator('.hamoki-job-controls').filter({hasText:'服务器已记录取消'}).waitFor()
  jobs=(await(await context.request.get(base+'/api/jobs?projectId='+projectId)).json()).jobs
  assert.equal(jobs.length,2);assert.equal(jobs[0].status,'cancelled');assert.equal(jobs[0].requestOutcome,'unknown')
  assert.equal(submissions,2);assert.equal(cancellations,2);assert.equal(calls,1)
  page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'开启下一轮',exact:true}).click()
  assert.equal(submissions,2)
  assert.equal(await page.getByRole('button',{name:'直接生成 1 张',exact:true}).isDisabled(),true)
  releaseUpstream();releaseUpstream=null
  assert.deepEqual(errors,[])
  await page.screenshot({path:screenshot,fullPage:true})
  console.log('PASS: real queued/running cancellation, declined confirmation, lost cancel response queried by original ID; two jobs, one upstream call')
}catch(error){
  await page?.screenshot({path:screenshot,fullPage:true}).catch(()=>{})
  throw error
}finally{
  releaseUpstream?.();upstream.closeAllConnections();upstream.close()
  await browser?.close()
  if(app.exitCode===null){const stopped=new Promise(resolve=>app.once('exit',resolve));app.kill();await stopped}
  rmSync(data,{recursive:true,force:true})
}
