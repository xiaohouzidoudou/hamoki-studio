import assert from 'node:assert/strict'

export async function verifyCanvasAssets({page,context,base,projectId}) {
  let denyUpload=true,uploads=0,puts=0,maxSnapshotBytes=0
  await page.route('**/api/cowart/assets?*',route=>{
    uploads++
    if(denyUpload)return route.fulfill({status:503,json:{error:'模拟图片存储不可用'}})
    return route.continue()
  })
  const listener=request=>{
    if(request.method()==='PUT'&&request.url().includes('/api/cowart/snapshot?')){
      puts++;maxSnapshotBytes=Math.max(maxSnapshotBytes,request.postDataBuffer()?.length||0)
    }
  }
  page.on('request',listener)
  const inlineBytes=await page.evaluate(()=>{
    const e=window.__cowartEditor
    const head=atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==')
    const src=n=>'data:image/png;base64,'+btoa(head+'\0'.repeat(5*1024*1024-head.length-1)+String(n))
    e.createAssets([1,2].map(n=>({id:'asset:large-'+n,typeName:'asset',type:'image',meta:{},props:{name:'large-'+n+'.png',src:src(n),mimeType:'image/png',w:1,h:1,isAnimated:false}})))
    for(const n of [1,2])e.createShape({id:'shape:large-'+n,type:'image',x:n*300,y:1100,props:{assetId:'asset:large-'+n,w:240,h:240}})
    return JSON.stringify(e.store.getStoreSnapshot()).length
  })
  assert.ok(inlineBytes>12*1024*1024,'Fixture must exceed old snapshot request limit')
  await page.locator('.hamoki-save-error').filter({hasText:'模拟图片存储不可用'}).waitFor()
  assert.equal(puts,0,'Failed upload must not save a partial snapshot')
  assert.equal(await page.evaluate(()=>window.__cowartEditor.getAsset('asset:large-1').props.src.startsWith('data:')),true)
  denyUpload=false
  await page.evaluate(()=>{window.__cowartEditor.updateShape({id:'shape:large-1',type:'image',x:650})})
  await page.waitForFunction(()=>[1,2].every(n=>window.__cowartEditor?.getAsset('asset:large-'+n)?.props.src.startsWith('/api/media/')))
  assert.equal(uploads,3,'One failed upload then exactly two successful uploads')
  assert.ok(maxSnapshotBytes<100*1024,'Snapshot must contain small URLs, not inline media')
  const saved=await (await context.request.get(base+'/api/cowart/snapshot?projectId='+projectId)).json()
  for(const n of [1,2]){
    const url=saved.snapshot.store['asset:large-'+n].props.src
    assert.match(url,/^\/api\/media\/[a-f0-9-]{36}\.png$/)
    const image=await context.request.get(base+url)
    assert.equal(image.status(),200);assert.equal((await image.body()).length,5*1024*1024)
  }
  const uploadsBeforeMove=uploads
  await page.evaluate(()=>{window.__cowartEditor.updateShape({id:'shape:large-1',type:'image',x:720})})
  for(let i=0;i<100;i++){
    const obj=await (await context.request.get(base+'/api/cowart/snapshot?projectId='+projectId)).json()
    if(obj.snapshot?.store?.['shape:large-1']?.x===720)break
    await new Promise(r=>setTimeout(r,100))
  }
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.__cowartEditor?.getShape('shape:large-1')?.x===720)
  assert.equal(uploads,uploadsBeforeMove,'Moving saved images must not reupload their bytes')
  assert.equal(await page.evaluate(()=>window.__cowartEditor.getAsset('asset:large-2').props.src.startsWith('/api/media/')),true)
  page.off('request',listener)
  await page.unroute('**/api/cowart/assets?*')
  console.log('PASS: >12MB inline canvas migrated to URLs, failed upload preserves originals, move/reload needs no reupload')
}
