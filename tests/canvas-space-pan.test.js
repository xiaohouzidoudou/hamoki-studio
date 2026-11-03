'use strict'
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const app=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8')
const css=fs.readFileSync(path.join(__dirname,'../assets/style.css'),'utf8')

test('Space activates temporary hand cursor and releases without changing selected tool',()=>{
 const start=app.indexOf('function setSpacePanDown(active)')
 const end=app.indexOf('function changeTool(t)',start)
 assert.ok(start>0&&end>start)
 const classes=new Set()
 const sandbox={
  $:()=>({classList:{toggle:(name,active)=>active?classes.add(name):classes.delete(name)}})
 }
 vm.runInNewContext('let spaceDown=false;\n'+app.slice(start,end)+'\nthis.setSpacePanDown=setSpacePanDown;this.spaceIsDown=()=>spaceDown',sandbox)
 sandbox.setSpacePanDown(true)
 assert.equal(sandbox.spaceIsDown(),true)
 assert.equal(classes.has('space-panning'),true)
 sandbox.setSpacePanDown(false)
 assert.equal(sandbox.spaceIsDown(),false)
 assert.equal(classes.has('space-panning'),false)
 assert.match(css,/\.board\.space-panning/)
 assert.match(css,/\.board\.space-dragging/)
})

test('Space-drag on blank canvas pans before select marquee or note creation',()=>{
 assert.match(app,/if\(spaceDown\|\|tool==='hand'\)\{startPan\(e\);return\}const pos=worldXY\(e\)/)
 assert.match(app,/classList\.toggle\('space-dragging',spaceDown&&e\.button!==1\)/)
 assert.match(app,/classList\.remove\('middle-panning','space-dragging'\)/)
})

test('Space shortcut ignores form fields and buttons; blur and release clear temporary state',()=>{
 assert.match(app,/e\.target\.matches\('textarea,input,select,\[contenteditable\]'\)/)
 assert.match(app,/e\.code==='Space'&&!e\.ctrlKey&&!e\.altKey&&!e\.metaKey&&!e\.target\.closest\('button,a/)
 assert.match(app,/if\(e\.code==='Space'\)setSpacePanDown\(false\)/)
 assert.match(app,/window\.addEventListener\('blur',\(\)=>setSpacePanDown\(false\)\)/)
 assert.doesNotMatch(app,/\$\('board'\)\.style\.cursor='grab'/)
})
