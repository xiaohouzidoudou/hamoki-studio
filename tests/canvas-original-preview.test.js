'use strict'
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const js=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8')
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8')
const css=fs.readFileSync(path.join(__dirname,'../assets/style.css'),'utf8')

function previewHarness(){
 const start=js.indexOf('let canvasPreviewCandidate=null,previousCanvasTap=null;')
 const end=js.indexOf('function openCanvasOriginal(n)',start)
 assert.ok(start>0&&end>start,'preview handler must exist')
 const opened=[]
 let clock=1000
 const box={
  currentProject:{nodes:[{id:'a',kind:'generated',historyId:'one'},{id:'b',kind:'reference'}]},
  Date:{now:()=>clock},
  Math,
  openCanvasOriginal:(node)=>opened.push(node.id)
 }
 vm.runInNewContext(js.slice(start,end)+'\nthis.tap=openCanvasTap',box)
 const fire=(id='a',opts={})=>{
  const event={pointerId:1,clientX:100,clientY:80}
  const gesture={before:[{id}]}
  const candidate={id,pointerId:1,x:100,y:80,at:clock-80,dragged:false,...opts}
  box.tap(event,gesture,candidate)
 }
 return {fire,opened,advance:(ms)=>{clock+=ms}}
}

test('single click selects image without opening the original preview',()=>{
 const h=previewHarness()
 h.fire()
 assert.deepEqual(h.opened,[])
 h.advance(600)
 assert.deepEqual(h.opened,[],'no delayed single-click popup')
})

test('double click opens original only for two stationary clicks on the same image',()=>{
 const h=previewHarness()
 h.fire();h.advance(180);h.fire()
 assert.deepEqual(h.opened,['a'])
 h.advance(160);h.fire('b')
 assert.deepEqual(h.opened,['a'],'a different image must not reuse click history')
 h.advance(120);h.fire('b',{dragged:true})
 assert.deepEqual(h.opened,['a'],'a drag must not open a preview')
 h.advance(200);h.fire('b')
 assert.deepEqual(h.opened,['a'],'a drag cancels the first click')
 h.advance(200);h.fire('b')
 assert.deepEqual(h.opened,['a','b'])
})

test('full-size viewer has close, Escape, backdrop and actual-size support',()=>{
 for(const id of ['canvasOriginalModal','canvasOriginalImage','canvasOriginalClose','canvasOriginalFit'])assert.match(html,new RegExp('id="'+id+'"'))
 assert.match(js,/function openCanvasOriginal\(n\)/)
 assert.match(js,/const original=nodeImage\(n\)/)
 assert.match(js,/closeCanvasOriginal\(\)/)
 assert.match(js,/e\.key==='Escape'/)
 assert.match(css,/\.canvas-original-stage img\.actual-size/)
})
