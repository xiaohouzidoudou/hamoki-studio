import assert from 'node:assert/strict'

// No image model calls: a local fixture exercises actual tldraw input handling.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAIAAABqhmJGAAADaElEQVR4nO3avU0jURSAUYM2pQFCGiGjALLpwykRqfsgowAyOtsAiQ34WYlg7vvMOSGJZyR/3DtvfHF1c30Ami6nLwD4OQFDmIAhTMAQJmAIEzCECRjCBAxhAoYwAUOYgCFMwBAmYAgTMIQJGMIEDGEChjABQ5iAIUzAECZgCBMwhAkYwgQMYQKGMAFDmIAhTMAQJmAIEzCECRjCBAxhAoYwAUOYgCFMwBAmYAgTMIQJGMIEDGEChjABQ5iAIUzAEPbnsKqn18fpS4B/ttuHw3ourm6uDyvRLYvbVip5oYClS8i2RsZLBCxdorbpjOcPsdRL19P0Sc3wBP7+/o/PLzteC3zpdH+35hyeDPirenVLruRtqOGxgD+tV7p0M94mGp55BlYvacfPHu5GnocHJvDH+zR4OZtRvO07h+dPoYFMwMYv5+T4YZfeeZEensCWZ+qOoy87L3/VW284s+/55AQ2fjkPx7kh7BALwvYL2P7M7/G01xY9NoHtz5yT49AWbYWGMAFDmIAhTMAQJmAIEzCECRjCBAxhAoYwAUOYgCFMwBAmYAgTMIQJGMIEDGEChjABQ5iAIUzAECZgCBMwhAkYwgQMYQKGMAFDmIAhTMAQJmAIEzCECRjCBAxhAoYwAUOYgCFMwBAmYAgTMIQJGMIEDGEChjABQ5iAIUzAECZgCBMwhAkYwgQMYQKGMAFDmIAhTMAQJmAIEzCECRjCBAxhAoYwAUOYgCFMwBAmYAgTMIQJGMIEDGEChjABQ5iAIUzAECZgCBMwhAkYwgQMYQKGMAFDmIAhTMAQJmAIEzCECRjCBAxhYwGf7u+mPhrO5vu8X8Db7cNunwWzdvu2W6EhbDJgWzTn4TT3PLhrwLZofoNtx6fF4RXaEKbuNHocezn+z0nDdJ0+1LvzmukQC8Iurm6u9//Up9fHj388Pr/sfyXwM59ujvuf8sxM4E/v0y5NxWmNescm8Ddz2ChmZacvjqym3rBMBvxNw28s1Szi9O1R8+D70eGA/9swLG4b/Y3w/Cm0X3fQtU3/wn9+Ar8zignZptNdLuA3MmZx2xrpLhrwOyWzlG2lbgMBA4FDLODHBAxhAoYwAUOYgCFMwBAmYAgTMIQJGMIEDGEChjABQ5iAIUzAECZgCBMwhAkYwgQMYQKGMAFDmIAhTMAQJmAIEzCECRjCBAxhAoYwAUOYgCFMwBAmYAgTMIQJGMIEDGEChjABQ5iAIUzAECZgCBMwhAkYwgQMYQKGQ9dfbauD6wphGLUAAAAASUVORK5CYII=','base64')

export async function verifyCanvasInteractions({page,context,base,projectId,screenshotPath}) {
  const imageUrl='/api/media/'+crypto.randomUUID()+'.png'
  const imageRoute='**'+imageUrl
  await page.route(imageRoute,route=>route.fulfill({contentType:'image/png',body:png}))
  await page.evaluate(src=>{
    const editor=window.__cowartEditor
    editor.createAssets([{id:'asset:interaction',typeName:'asset',type:'image',meta:{},props:{src,w:320,h:180,name:'interaction.png',mimeType:'image/png',isAnimated:false}}])
    editor.createShapes([
      {id:'shape:interaction-one',type:'image',x:70,y:80,props:{w:200,h:140,assetId:'asset:interaction'}},
      {id:'shape:interaction-two',type:'image',x:390,y:80,props:{w:180,h:140,assetId:'asset:interaction'}}
    ])
    editor.selectNone();editor.setCurrentTool('select');editor.setCamera({x:0,y:0,z:1})
  },imageUrl)
  const center=async id=>page.evaluate(id=>{
    const editor=window.__cowartEditor,b=editor.getShapePageBounds(id)
    const p=editor.pageToScreen({x:b.x+b.w/2,y:b.y+b.h/2})
    return {x:p.x,y:p.y}
  },id)
  let first=await center('shape:interaction-one'),second=await center('shape:interaction-two')
  await page.mouse.click(first.x,first.y)
  assert.deepEqual(await page.evaluate(()=>window.__cowartEditor.getSelectedShapeIds()),['shape:interaction-one'])
  assert.equal(await page.getByRole('dialog',{name:'原图预览',exact:true}).count(),0,'Single click selects without preview')
  await page.mouse.dblclick(second.x,second.y,{delay:90})
  const modal=page.getByRole('dialog',{name:'原图预览',exact:true})
  await modal.waitFor()
  assert.equal(await page.evaluate(()=>window.__cowartEditor.isIn('select.crop')),false,'Double click must not start crop mode')
  const image=modal.locator('img')
  await image.evaluate(img=>img.decode())
  assert.equal(await image.evaluate(img=>img.naturalWidth),320,'Preview loads original pixels')
  await image.click()
  assert.equal(await modal.count(),1,'Clicking the original must keep preview open')
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'关闭原图预览')
  await page.screenshot({path:screenshotPath,fullPage:true})
  await page.mouse.click(8,8)
  await modal.waitFor({state:'hidden'})
  await page.getByRole('button',{name:'预览原图',exact:true}).click()
  await modal.waitFor()
  await page.keyboard.press('Escape')
  await modal.waitFor({state:'hidden'})
  second=await center('shape:interaction-two')
  await page.mouse.dblclick(second.x,second.y,{delay:90})
  await modal.waitFor()
  await page.keyboard.press('Escape')
  await modal.waitFor({state:'hidden'})
  await page.locator('.hamoki-studio-panel header button').click()
  await page.getByRole('button',{name:'修改这张图',exact:true}).click()
  await page.waitForFunction(()=>document.activeElement===document.querySelector('.hamoki-studio-panel textarea'))
  const camera=await page.evaluate(()=>({...window.__cowartEditor.getCamera()}))
  await page.locator('.hamoki-studio-panel textarea').fill('保持布局')
  await page.keyboard.press('Space')
  assert.equal(await page.locator('.hamoki-studio-panel textarea').inputValue(),'保持布局 ')
  assert.deepEqual(await page.evaluate(()=>({...window.__cowartEditor.getCamera()})),camera,'Typing Space cannot pan the canvas')
  await page.keyboard.press('Delete')
  assert.ok(await page.evaluate(()=>!!window.__cowartEditor.getShape('shape:interaction-two')),'Text editing must not delete the selected image')
  await page.mouse.click(50,450)
  const beforeSpace=await page.evaluate(()=>({...window.__cowartEditor.getCamera()}))
  first=await center('shape:interaction-one')
  await page.mouse.move(first.x,first.y)
  await page.keyboard.down('Space')
  await page.mouse.down()
  await page.mouse.move(first.x+100,first.y+50,{steps:8})
  await page.mouse.up()
  await page.keyboard.up('Space')
  const afterSpace=await page.evaluate(()=>({...window.__cowartEditor.getCamera()}))
  assert.ok(afterSpace.x!==beforeSpace.x||afterSpace.y!==beforeSpace.y,'Space + left drag pans')
  assert.equal(await page.evaluate(()=>window.__cowartEditor.isIn('select')),true,'Releasing Space restores select tool')
  first=await center('shape:interaction-one')
  await page.mouse.move(first.x,first.y)
  await page.mouse.down({button:'middle'})
  await page.mouse.move(first.x+60,first.y+40,{steps:8})
  await page.mouse.up({button:'middle'})
  const afterMiddle=await page.evaluate(()=>({...window.__cowartEditor.getCamera()}))
  assert.ok(afterMiddle.x!==afterSpace.x||afterMiddle.y!==afterSpace.y,'Middle drag pans')
  assert.deepEqual(await page.evaluate(()=>{
    const s=window.__cowartEditor.getShape('shape:interaction-one');return {x:s.x,y:s.y}
  }),{x:70,y:80},'Panning cannot move the original')
  await page.evaluate(()=>{const e=window.__cowartEditor;e.setCamera({x:0,y:0,z:1});e.selectNone()})
  await page.mouse.move(40,60)
  await page.mouse.down()
  await page.mouse.move(280,230,{steps:10})
  await page.mouse.up()
  assert.deepEqual(await page.evaluate(()=>window.__cowartEditor.getSelectedShapeIds()),['shape:interaction-one'],'Left drag on blank canvas selects a marquee')
  second=await center('shape:interaction-two')
  await page.mouse.click(second.x,second.y,{button:'right'})
  await page.getByRole('menu').waitFor()
  assert.equal(await modal.count(),0,'Right click opens context menu, not preview')
  await page.keyboard.press('Escape')
  let saved=false
  for(let i=0;i<60;i++){
    const data=await (await context.request.get(base+'/api/cowart/snapshot?projectId='+projectId)).json()
    if(data.snapshot?.store?.['shape:interaction-two']){saved=true;break}
    await new Promise(r=>setTimeout(r,100))
  }
  assert.equal(saved,true)
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>!!window.__cowartEditor?.getShape('shape:interaction-two'))
  assert.ok(await page.evaluate(()=>!!window.__cowartEditor.getShape('shape:interaction-one')),'Both originals survive interactions and refresh')
  await page.evaluate(()=>{
    const e=window.__cowartEditor
    e.deleteShapes(['shape:interaction-one','shape:interaction-two']);e.deleteAssets(['asset:interaction'])
    e.selectNone();e.setCamera({x:0,y:0,z:1});e.setCurrentTool('select')
  })
  let cleaned=false
  for(let i=0;i<60;i++){
    const data=await (await context.request.get(base+'/api/cowart/snapshot?projectId='+projectId)).json()
    if(!data.snapshot?.store?.['shape:interaction-two']){cleaned=true;break}
    await new Promise(r=>setTimeout(r,100))
  }
  assert.equal(cleaned,true,'Interaction fixture cleanup must be saved before subsequent reload tests')
  await page.unroute(imageRoute)
  console.log('PASS: Cowart click/double-click preview, outside/Escape close, local AI action, text focus, Space/middle pan, marquee, context menu and refresh')
}
