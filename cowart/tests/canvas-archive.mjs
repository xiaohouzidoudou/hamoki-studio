import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
export async function verifyCanvasArchive({page,context,base,projectId}) {
  await page.setViewportSize({width:1440,height:1000})
  await page.addInitScript(() => { window.showSaveFilePicker = undefined })
  await page.evaluate(() => { window.showSaveFilePicker = undefined })
  let paid = 0, uploads = 0
  const stopPaid = async route => { paid++; await route.abort() }
  await page.route('**/api/jobs',stopPaid)
  await page.route('**/api/cowart/plan',stopPaid)
  page.on('request',request=>{
    if(request.method()==='POST' && new URL(request.url()).pathname==='/api/cowart/assets')uploads++
  })
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==','base64')
  await page.locator('input[type=file][accept*="image"]').setInputFiles({name:'archive-source.png',mimeType:'image/png',buffer:png})
  await page.waitForFunction(()=>Object.values(window.__cowartEditor.records).some(r=>r.typeName==='shape'&&r.type==='image'))
  // Edit immediately before backup to exercise the autosave flush, not a fixed delay.
  const source=await page.evaluate(()=>{
    const d=window.__cowartEditor,image=Object.values(d.records).find(r=>r.typeName==='shape'&&r.type==='image')
    d.updateShape({id:image.id,props:{flipX:true,crop:{topLeft:{x:.1,y:0},bottomRight:{x:.9,y:1}}},meta:{...image.meta,studioHistoryId:'archive-old-history',studioProjectId:'archive-old-project'}})
    d.createShapes([{id:'shape:archive-annotation',type:'text',x:300,y:180,props:{text:'备份文字',richText:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'备份文字',marks:[{type:'bold'}]}]}]}},meta:{cowartAnnotationSourceShapeId:image.id}}])
    return image.id
  })
  const filePanel=async()=>{
    const region=page.getByRole('region',{name:'文件面板'})
    if(!await region.isVisible())await page.getByRole('button',{name:'文件',exact:true}).click()
    return region
  }
  const panel=await filePanel()
  const downloading=page.waitForEvent('download')
  await panel.getByRole('button',{name:'完整画布备份 ZIP',exact:true}).click()
  const download=await downloading
  assert.equal(await download.failure(),null)
  const bytes=await readFile(await download.path())
  assert.equal(bytes.readUInt32LE(0),0x04034b50)
  const saved=await(await context.request.get(base+'/api/cowart/snapshot?projectId='+projectId)).json()
  assert.equal(saved.snapshot.store[source].props.flipX,true)
  assert.ok(saved.snapshot.store['shape:archive-annotation'])
  const created=await context.request.post(base+'/api/projects',{data:{title:'Archive target'}})
  assert.equal(created.status(),201)
  const target=(await created.json()).project.id
  await page.goto(base+'/cowart/?projectId='+target)
  await page.waitForFunction(()=>!!window.__cowartEditor)
  await page.evaluate(()=>window.__cowartEditor.createShapes([{id:'shape:keep',type:'geo',x:100,y:100,props:{w:100,h:100,geo:'rectangle'}}]))
  const previous=await page.evaluate(()=>Object.keys(window.__cowartEditor.records).sort())
  await (await filePanel()).getByRole('button',{name:'导入完整备份 ZIP',exact:true}).click()
  await page.getByLabel('导入完整备份文件',{exact:true}).setInputFiles({name:'backup.zip',mimeType:'application/zip',buffer:bytes})
  await page.waitForFunction(()=>window.__cowartEditor.getPages().length===2)
  const restored=await page.evaluate(()=>{
    const d=window.__cowartEditor
    const image=Object.values(d.records).find(r=>r.meta?.hamokiArchiveOrigin)
    const text=Object.values(d.records).find(r=>r.meta?.cowartAnnotationSourceShapeId)
    return {image,text,asset:d.records[image.props.assetId],hasPrevious:!!d.records['shape:keep']}
  })
  assert.equal(restored.hasPrevious,true)
  assert.notEqual(restored.image.id,source)
  assert.equal(restored.image.meta.studioHistoryId,undefined)
  assert.equal(restored.text.meta.cowartAnnotationSourceShapeId,restored.image.id)
  assert.equal(restored.image.props.flipX,true)
  assert.deepEqual(await(await context.request.get(base+restored.asset.props.src)).body(),png)
  await page.evaluate(()=>window.__cowartEditor.undo())
  assert.deepEqual(await page.evaluate(()=>Object.keys(window.__cowartEditor.records).sort()),previous)
  await page.evaluate(()=>window.__cowartEditor.redo())
  await page.waitForFunction(()=>document.querySelector('.hamoki-sync')?.textContent==='已同步')
  await page.reload();await page.waitForFunction(()=>window.__cowartEditor?.getPages().length===2)
  assert.ok(await page.evaluate(()=>window.__cowartEditor.records['shape:keep']))
  const before=await page.evaluate(()=>JSON.stringify(window.__cowartEditor.records))
  const beforeUploads=uploads,corrupt=Buffer.from(bytes)
  const manifestOffset=30+Buffer.byteLength('canvas.json')
  corrupt[manifestOffset]^=1
  await page.getByLabel('导入完整备份文件',{exact:true}).setInputFiles({name:'broken.zip',mimeType:'application/zip',buffer:corrupt})
  await page.getByRole('status').filter({hasText:'校验失败'}).waitFor()
  assert.equal(uploads,beforeUploads)
  assert.equal(await page.evaluate(()=>JSON.stringify(window.__cowartEditor.records)),before)
  const rejectSave=async route => {
    if(route.request().method()==='PUT')await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'模拟保存失败'})})
    else await route.continue()
  }
  await page.route('**/api/cowart/snapshot?*',rejectSave)
  await page.evaluate(()=>window.__cowartEditor.updateShape({id:'shape:keep',props:{w:121}}))
  let unexpectedDownload=false
  const onDownload=()=>{unexpectedDownload=true}
  page.on('download',onDownload)
  await (await filePanel()).getByRole('button',{name:'完整画布备份 ZIP',exact:true}).click()
  await page.getByRole('status').filter({hasText:'模拟保存失败'}).waitFor()
  assert.equal(unexpectedDownload,false,'保存失败不得把旧服务器版本当成当前完整备份')
  assert.equal(await page.evaluate(()=>window.__cowartEditor.records['shape:keep'].props.w),121)
  page.off('download',onDownload)
  await page.unroute('**/api/cowart/snapshot?*',rejectSave)
  await page.getByRole('button',{name:'重试保存',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('.hamoki-sync')?.textContent==='已同步')
  await page.getByRole('button',{name:'收起 Studio',exact:true}).click()
  for(const width of [320,375,390]) {
    await page.setViewportSize({width,height:844})
    const panel=await filePanel()
    const button=panel.getByRole('button',{name:'完整画布备份 ZIP',exact:true})
    await button.scrollIntoViewIfNeeded()
    const box=await button.boundingBox()
    assert.ok(box.x>=0 && box.x+box.width<=width+1)
  }
  await page.setViewportSize({width:1440,height:1000})
  await page.evaluate(()=>{
    const d=window.__cowartEditor,image=Object.values(d.records).find(r=>r.meta?.hamokiArchiveOrigin)
    d.setCurrentPage(image.parentId)
    d.zoomToFit()
  })
  await page.getByRole('button',{name:'关闭提示',exact:true}).click()
  assert.equal(paid,0)
  console.log('PASS portable archive: saved latest edit, original bytes, add pages, remap, undo/redo, reload, corrupt read-only, 320/375/390, zero paid requests')
}
