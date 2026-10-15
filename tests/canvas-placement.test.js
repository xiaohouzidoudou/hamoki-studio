'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {nextGeneratedPosition,intersects,STEP,COLUMNS}=require('../lib/canvas-placement');

test('new results use left-to-right four-column rows without overlaps',()=>{
 const p={nodes:[]};
 for(let i=0;i<10;i++){
  const pos=nextGeneratedPosition(p);
  assert.equal(pos.x,180+(i%COLUMNS)*STEP);
  assert.equal(pos.y,170+Math.floor(i/COLUMNS)*STEP);
  assert.equal(p.nodes.some(n=>intersects(pos.x,pos.y,n)),false);
  p.nodes.push({...pos,id:String(i)});
 }
 assert.equal(p.generationLayout.nextSlot,10);
});
test('existing images remain unchanged and occupied slots are skipped',()=>{
 const other={id:'old',x:170,y:160,w:300,h:300};
 const p={nodes:[other],generationLayout:{x:180,y:170,nextSlot:0}};
 const before={...other};
 const pos=nextGeneratedPosition(p);
 assert.equal(pos.x,180+STEP);
 assert.deepEqual(other,before);
 assert.equal(intersects(pos.x,pos.y,other),false);
});
test('initial generation region begins to the right of the existing content',()=>{
 const p={nodes:[{x:150,y:170,w:288,h:288}]};
 const pos=nextGeneratedPosition(p);
 assert.ok(pos.x>438);
 assert.equal(intersects(pos.x,pos.y,p.nodes[0]),false);
});
test('manual movement into a future slot does not create overlap',()=>{
 const p={nodes:[],generationLayout:{x:180,y:170,nextSlot:0}};
 let pos=nextGeneratedPosition(p);
 p.nodes.push({x:180+STEP,y:170,w:288,h:288});
 assert.deepEqual({x:pos.x,y:pos.y},{x:180,y:170});
 pos=nextGeneratedPosition(p);
 assert.deepEqual({x:pos.x,y:pos.y},{x:180+STEP*2,y:170});
});
test('new result retrieval control exists in the desktop canvas',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const js=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
 assert.match(html,/id="latestGenerated"/);
 assert.match(js,/function focusLatestGenerated\(/);
 assert.match(js,/\$\('latestGenerated'\)\.onclick=focusLatestGenerated/);
});
