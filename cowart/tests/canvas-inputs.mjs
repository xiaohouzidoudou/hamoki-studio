import assert from 'node:assert/strict'

export async function verifyCanvasInputs({page,projectId,submissions,imageRows,png,screenshotPath}) {
  const initial=submissions.length
  const originals=imageRows.slice(0,3)
  const ids=await page.evaluate(historyIds=>historyIds.map(id=>Object.values(window.__cowartEditor.store.getStoreSnapshot().store)
    .find(s=>s.typeName==='shape'&&s.meta?.studioHistoryId===id).id),originals.map(h=>h.id))
  const originalPositions=await page.evaluate(ids=>ids.map(id=>{
    const s=window.__cowartEditor.getShape(id);return {id,x:s.x,y:s.y}
  }),ids)
  const ratio=page.getByTestId('cowart-output-ratio')
  const recoveryKey='hamoki-cowart-active:'+projectId
  async function submit(prompt,buttonName='直接生成 1 张'){
    const count=submissions.length
    await page.locator('.hamoki-studio-panel textarea').fill(prompt)
    await page.getByRole('button',{name:buttonName,exact:true}).click()
    for(let i=0;i<100&&submissions.length===count;i++)await new Promise(r=>setTimeout(r,40))
    assert.equal(submissions.length,count+1)
    const id=imageRows.at(-1).id
    await page.waitForFunction(id=>Object.values(window.__cowartEditor.store.getStoreSnapshot().store)
      .some(s=>s.typeName==='shape'&&s.meta?.studioHistoryId===id),id)
    await page.waitForFunction(key=>!sessionStorage.getItem(key),recoveryKey)
    return {payload:submissions.at(-1),shape:await page.evaluate(id=>Object.values(window.__cowartEditor.store.getStoreSnapshot().store)
      .find(s=>s.typeName==='shape'&&s.meta?.studioHistoryId===id),id)}
  }
  await page.evaluate(ids=>{
    const e=window.__cowartEditor
    e.createShape({id:'shape:input-holder',type:'frame',x:40,y:1000,meta:{cowartAiImageHolder:true,cowartAiAspectLocked:true,cowartAiAspectRatio:16/9},props:{w:640,h:360,name:'AI 图片'}})
    e.select('shape:input-holder',ids[0],ids[1])
  },ids)
  await page.waitForFunction(()=>document.querySelector('[data-testid="cowart-output-ratio"]').value==='16:9')
  assert.equal(await page.getByLabel('参考图 1 用途',{exact:true}).inputValue(),'general')
  assert.equal(await page.getByLabel('参考图 2 用途',{exact:true}).inputValue(),'general')
  await ratio.selectOption('9:16')
  const holderSize=await page.evaluate(()=>{const s=window.__cowartEditor.getShape('shape:input-holder');return {w:s.props.w,h:s.props.h}})
  assert.ok(Math.abs(holderSize.w/holderSize.h-9/16)<0.002)
  const aspect=await page.evaluate(()=>{
    const e=window.__cowartEditor,s=e.getShape('shape:input-holder')
    return {ratio:s.meta.cowartAiAspectRatio,locked:e.getShapeUtil(s).isAspectRatioLocked(s)}
  })
  assert.equal(aspect.locked,true)
  assert.equal(aspect.ratio,holderSize.w/holderSize.h,'Output preset must update the native aspect-lock ratio too')
  const filled=await submit('综合两张参考图生成游戏界面，放入占位框')
  assert.equal(filled.payload.sourceId,undefined)
  assert.equal(filled.payload.ratio,'9:16')
  assert.deepEqual(filled.payload.referenceHistory,originals.slice(0,2).map(h=>({sourceId:h.id,role:'general'})))
  assert.deepEqual(filled.payload.references,[],'Existing generated references must not be rasterized and uploaded again')
  assert.equal(filled.shape.parentId,'shape:input-holder')
  assert.equal(await page.getByText('已完成，已放入所选空占位框',{exact:true}).count(),1)
  assert.ok(filled.shape.x>=0&&filled.shape.y>=0&&filled.shape.x+filled.shape.props.w<=holderSize.w+1&&filled.shape.y+filled.shape.props.h<=holderSize.h+1)
  assert.equal(filled.shape.props.w,filled.shape.props.h,'Fixture square image is contained without stretching into a portrait')
  await page.getByRole('button',{name:'开启下一轮',exact:true}).click()
  await page.evaluate(ids=>{window.__cowartEditor.select(...ids)},ids)
  await page.getByLabel('修改主图',{exact:true}).selectOption(ids[2])
  await page.getByLabel('参考图 1 用途',{exact:true}).selectOption('color')
  await page.getByLabel('参考图 2 用途',{exact:true}).selectOption('style')
  await page.evaluate(()=>{window.__cowartEditor.zoomToFit({animation:{duration:0}})})
  await page.locator('.hamoki-studio-panel').evaluate(panel=>{panel.scrollTop=0})
  await page.screenshot({path:screenshotPath,fullPage:true})
  const edited=await submit('修改第三张图按钮，使用第一张配色和第二张风格')
  assert.equal(edited.payload.sourceId,originals[2].id)
  assert.equal(edited.payload.editMode,'edit')
  assert.deepEqual(edited.payload.referenceHistory,[{sourceId:originals[0].id,role:'color'},{sourceId:originals[1].id,role:'style'}])
  assert.match(edited.payload.prompt,/输入1 = 画布图片3（修改主图）/)
  assert.match(edited.payload.prompt,/输入2 = 画布图片1（配色）/)
  await page.getByRole('button',{name:'开启下一轮',exact:true}).click()
  await page.evaluate(()=>{window.__cowartEditor.select('shape:input-holder')})
  await page.waitForFunction(()=>document.querySelector('[data-testid="cowart-output-ratio"]').value==='9:16')
  await ratio.selectOption('3:2')
  assert.deepEqual(await page.evaluate(()=>{const s=window.__cowartEditor.getShape('shape:input-holder');return {w:s.props.w,h:s.props.h}}),holderSize,'Filled holder cannot be resized by a new output ratio')
  const beside=await submit('再生成一张，不覆盖占位框中的作品')
  assert.equal(beside.payload.ratio,'3:2')
  assert.notEqual(beside.shape.parentId,'shape:input-holder')
  assert.ok(beside.shape.x>=40+holderSize.w)
  assert.ok(await page.evaluate(id=>!!window.__cowartEditor.getShape(id),filled.shape.id))
  await page.getByRole('button',{name:'开启下一轮',exact:true}).click()
  await page.evaluate(({src,referenceId})=>{
    const e=window.__cowartEditor
    e.createAssets([{id:'asset:input-upload',type:'image',typeName:'asset',meta:{},props:{name:'uploaded.png',src,w:1,h:1,mimeType:'image/png',isAnimated:false}}])
    e.createShape({id:'shape:input-upload',type:'image',x:60,y:2300,props:{w:180,h:180,assetId:'asset:input-upload'}})
    e.select('shape:input-upload',referenceId)
  },{src:'data:image/png;base64,'+png.toString('base64'),referenceId:ids[1]})
  await page.getByLabel('修改主图',{exact:true}).selectOption('shape:input-upload')
  await page.getByLabel('参考图 2 用途',{exact:true}).selectOption('shape')
  const uploaded=await submit('修改导入的原图，参考第二张造型')
  assert.equal(uploaded.payload.sourceId,undefined)
  assert.equal(uploaded.payload.editMode,'edit')
  assert.equal(uploaded.payload.references.length,1)
  assert.deepEqual(uploaded.payload.referenceRoles,['general'])
  assert.deepEqual(uploaded.payload.referenceOrder,[{kind:'upload',index:0},{kind:'history',index:0}])
  assert.deepEqual(uploaded.payload.referenceHistory,[{sourceId:originals[1].id,role:'shape'}])
  assert.match(uploaded.payload.references[0],/^data:image\/png;base64,/)
  await page.getByRole('button',{name:'开启下一轮',exact:true}).click()
  await page.evaluate(id=>{
    const e=window.__cowartEditor
    e.createShape({id:'shape:smart-holder',type:'frame',x:1400,y:2100,meta:{cowartAiImageHolder:true},props:{w:480,h:480,name:'AI 图片'}})
    e.select('shape:smart-holder',id)
  },ids[0])
  let planCalls=0
  await page.route('**/api/cowart/plan',route=>{
    planCalls++
    return route.fulfill({json:{plan:{action:'edit',reply:'仅修改选中的一张图，输出到占位框',editSpec:{change:'按钮改色'}}}})
  })
  await page.getByLabel('执行方式').selectOption('smart')
  await page.locator('.hamoki-vision-switch input').uncheck()
  await page.getByLabel('文字分析模型').selectOption('mock')
  await page.getByLabel('文字模型 ID').fill('mock-text')
  const smart=await submit('修改这张图片的按钮颜色，结果放入空占位框','智能理解并执行')
  assert.equal(smart.payload.sourceId,originals[0].id,'One selected source plus a holder is unambiguous for an edit plan')
  assert.equal(smart.shape.parentId,'shape:smart-holder')
  assert.equal(planCalls,1)
  assert.equal(submissions.length,initial+5)
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>!!window.__cowartEditor?.getShape('shape:input-holder'))
  assert.deepEqual(await page.evaluate(ids=>ids.map(id=>{const s=window.__cowartEditor.getShape(id);return {id,x:s.x,y:s.y}}),ids),originalPositions,'Reference originals remain unchanged')
  assert.ok(await page.evaluate(id=>!!window.__cowartEditor.getShape(id),filled.shape.id),'Holder child survives save and refresh')
  console.log('PASS: Holder ratio/fill/containment, independent role references, explicit/imported/smart edit source, no overwrite and refresh; five additional submissions')
}
