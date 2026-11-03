'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),net=require('node:net')
const {spawn}=require('node:child_process')
const crypto=require('node:crypto')
const pause=ms=>new Promise(r=>setTimeout(r,ms))
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg=='
const blue='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg=='

test('Cowart input selection defaults to independent comprehensive references, with an explicit primary and non-destructive holder reuse',async()=>{
  const module=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../cowart/src/lib/canvasInputs.js')).toString('base64'))
  const first={id:'shape:first',type:'image'},second={id:'shape:second',type:'image'}
  const holder={id:'shape:holder',type:'frame',meta:{cowartAiImageHolder:true}}
  assert.equal(module.canvasInputSelection([first]).primary,first)
  assert.equal(module.canvasInputSelection([first,second]).primary,null)
  assert.equal(module.canvasInputSelection([first,holder]).primary,null)
  assert.equal(module.canvasInputSelection([first,holder]).anchor,holder)
  assert.equal(module.canvasInputSelection([first,second],second.id).primary,second)
  assert.equal(module.canvasInputSelection([first],'').primary,null)
  assert.equal(module.isEmptyImageHolder({},holder),true)
  assert.equal(module.isEmptyImageHolder({child:{typeName:'shape',type:'image',parentId:holder.id}},holder),false)
  assert.equal(module.isEmptyImageHolder({child:{typeName:'shape',type:'group',parentId:holder.id}},holder),false)
  assert.equal(module.isEmptyImageHolder({child:{typeName:'shape',type:'draw',parentId:holder.id}},holder),false,'sketches and annotations cannot be covered by generated images')
})

test('Cowart per-image roles reach existing adapters, history ownership is enforced and uploaded primary uses the edit route first',async t=>{
  const seen=[]
  const upstream=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c)
    seen.push({url:req.url,bytes:Buffer.concat(chunks),text:Buffer.concat(chunks).toString('utf8')})
    res.writeHead(200,{'Content-Type':'application/json'})
    res.end(JSON.stringify({data:[{b64_json:png}]}))
  })
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r))
  const port=await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})})
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-cowart-inputs-'))
  const app=spawn(process.execPath,[path.join(__dirname,'../gateway.js')],{env:{...process.env,
    HOST:'127.0.0.1',PORT:String(port),APP_ALLOWED_HOST:'127.0.0.1',APP_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),
    INVITE_CODE:'fixture-only',DATA_DIR:dir,NODE_ENV:'test',COOKIE_SECURE:'0',COWART_PREVIEW:'1',ALLOW_PRIVATE_UPSTREAMS:'1'
  },stdio:['ignore','pipe','pipe']})
  t.after(async()=>{
    if(app.exitCode===null)await new Promise(r=>{app.once('exit',r);app.kill()})
    await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true})
  })
  let logs='';for(const stream of [app.stdout,app.stderr])stream.on('data',c=>logs+=c)
  for(let i=0;i<100&&!logs.includes('account gateway ready');i++){if(app.exitCode!==null)throw Error(logs);await pause(50)}
  assert.match(logs,/account gateway ready/)
  const base='http://127.0.0.1:'+port
  function client(){
    let cookie=''
    return async(url,method='GET',body)=>{
      const r=await fetch(base+url,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined})
      if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0]
      return {status:r.status,data:await r.json()}
    }
  }
  const a=client(),b=client()
  for(const [api,username] of [[a,'inputa'],[b,'inputb']])assert.equal((await api('/api/register','POST',{username,password:'fixture-password',inviteCode:'fixture-only'})).status,201)
  const projectId=(await a('/api/projects')).data.defaultId
  const foreignProject=(await b('/api/projects')).data.defaultId
  const endpoint='http://127.0.0.1:'+upstream.address().port
  const provider=(await a('/api/providers','POST',{name:'Fixture image roles',url:endpoint+'/v1',apiKey:'fixture-only',mode:'openai',imageMode:'images',imageModel:'gpt-image-2',
    capabilities:{edit:{inheritBaseUrl:false,baseUrl:endpoint+'/edit/v1',defaultModel:'gpt-image-2'}}})).data.provider
  const payload={projectId,providerId:provider.id,model:'gpt-image-2',prompt:'游戏按钮',count:1,ratio:'1:1',resolution:'1K'}
  async function complete(body){
    const answer=await a('/api/jobs','POST',body)
    assert.equal(answer.status,201,JSON.stringify(answer.data))
    let job
    for(let i=0;i<100;i++){
      job=(await a('/api/jobs?projectId='+projectId)).data.jobs.find(j=>j.id===answer.data.jobs[0].id)
      if(['done','failed'].includes(job.status))break
      await pause(40)
    }
    assert.equal(job.status,'done',job.error)
    return job
  }
  const first=await complete(payload),second=await complete(payload)
  const refs=[{sourceId:first.resultId,role:'color'},{sourceId:second.resultId,role:'style'}]
  const composite=await complete({...payload,editMode:'new',referenceHistory:refs,references:['data:image/png;base64,'+blue],referenceRoles:['shape']})
  assert.equal(composite.sourceId,null,'comprehensive references must not silently become an edit source')
  assert.deepEqual(composite.referenceRoles,['color','style','shape'])
  assert.equal(seen.at(-1).url,'/v1/images/edits','existing image-generation adapter receives actual reference pixels')
  assert.match(seen.at(-1).text,/参考图1：只参考这张图的配色/)
  assert.match(seen.at(-1).text,/参考图2：只参考这张图的画风/)
  assert.match(seen.at(-1).text,/参考图3：以这张图作为造型/)
  assert.equal((seen.at(-1).text.match(/filename=/g)||[]).length,3)
  const defaults=await complete({...payload,editMode:'new',referenceHistory:[{sourceId:first.resultId},{sourceId:second.resultId}]})
  assert.deepEqual(defaults.referenceRoles,['general','general'])
  const edited=await complete({...payload,editMode:'edit',referenceHistory:refs,references:['data:image/png;base64,'+blue],referenceRoles:['general']})
  assert.equal(edited.capability,'edit')
  assert.equal(edited.sourceId,null,'uploaded primary cannot be replaced by a generated reference')
  assert.equal(seen.at(-1).url,'/edit/v1/images/edits','uploaded-image editing must use separately configured edit capability')
  const primaryOffset=seen.at(-1).bytes.indexOf(Buffer.from(blue,'base64')),referenceOffset=seen.at(-1).bytes.indexOf(Buffer.from(png,'base64'))
  assert.ok(primaryOffset>=0&&referenceOffset>=0&&primaryOffset<referenceOffset,'uploaded primary is the first actual image')
  assert.deepEqual(edited.referenceRoles,['general','color','style'])
  const mixedPayload={...payload,editMode:'new',references:['data:image/png;base64,'+blue],referenceRoles:['color'],referenceHistory:[{sourceId:first.resultId,role:'style'}]}
  const mixed=await complete({...mixedPayload,referenceOrder:[{kind:'upload',index:0},{kind:'history',index:0}]})
  assert.deepEqual(mixed.referenceRoles,['color','style'])
  let aOffset=seen.at(-1).bytes.indexOf(Buffer.from(blue,'base64')),bOffset=seen.at(-1).bytes.indexOf(Buffer.from(png,'base64'))
  assert.ok(aOffset>=0&&bOffset>=0&&aOffset<bOffset,'mixed references preserve user order, not storage type order')
  const reversed=await complete({...mixedPayload,referenceOrder:[{kind:'history',index:0},{kind:'upload',index:0}]})
  assert.deepEqual(reversed.referenceRoles,['style','color'])
  aOffset=seen.at(-1).bytes.indexOf(Buffer.from(blue,'base64'));bOffset=seen.at(-1).bytes.indexOf(Buffer.from(png,'base64'))
  assert.ok(aOffset>=0&&bOffset>=0&&bOffset<aOffset)
  const firstNode=(await a('/api/projects/'+projectId)).data.project.nodes.find(n=>n.historyId===first.resultId)
  assert.equal((await a('/api/projects/'+projectId+'/memory/feedback','POST',{nodeId:firstNode.id,historyId:first.resultId,kind:'approved'})).status,200)
  const approvedReference=await complete({...payload,editMode:'new',referenceHistory:[{sourceId:first.resultId,role:'color'}],referenceOrder:[{kind:'history',index:0}]})
  assert.deepEqual(approvedReference.referenceRoles,['color'],'a selected image must not be silently duplicated as another project-style reference')
  assert.equal((seen.at(-1).text.match(/filename=/g)||[]).length,1)
  const before=seen.length
  for(const invalid of [
    {...payload,references:[],referenceRoles:['shape']},
    {...payload,referenceHistory:[{sourceId:first.resultId,role:['color']}]},
    {...payload,referenceHistory:[{sourceId:crypto.randomUUID()}]},
    {...payload,referenceHistory:Array(9).fill(refs[0])},
    {...payload,references:Array(4).fill('data:image/png;base64,'+blue),referenceRoles:Array(4).fill('general'),referenceHistory:Array(5).fill(refs[0])},
    {...mixedPayload,referenceOrder:[{kind:'upload',index:0},{kind:'upload',index:0}]},
    {...mixedPayload,referenceOrder:[{kind:'history',index:8},{kind:'upload',index:0}]},
    {...mixedPayload,editMode:'edit',referenceOrder:[{kind:'history',index:0},{kind:'upload',index:0}]}
  ])assert.equal((await a('/api/jobs','POST',invalid)).status,400)
  assert.equal((await b('/api/jobs','POST',{...payload,projectId:foreignProject,referenceHistory:refs})).status,400)
  assert.equal(seen.length,before,'invalid roles and foreign media never reach paid upstreams')
})
