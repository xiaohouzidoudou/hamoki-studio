'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {plan}=require('../assets/ai-outpaint-plan.js');
const {normalizeCustomImageSize}=require('../lib/custom-image-size');

test('right-only extension keeps source geometry and grows right border',()=>{
  const p=plan(1024,1024,{left:0,right:40,top:0,bottom:0},'gpt-image-2.5-flare');
  assert.ok(p.width>p.original.w);
  assert.equal(p.original.x,0);
  assert.equal(p.original.y,0);
  assert.equal(p.original.w/p.original.h,1);
  assert.equal(normalizeCustomImageSize(p.customSize),p.customSize);
});
test('left-only extension anchors the original against the right edge',()=>{
  const p=plan(1024,1024,{left:40,right:0,top:0,bottom:0},'gpt-image-2');
  assert.equal(p.original.x+p.original.w,p.width);
  assert.equal(p.original.y,0);
});
test('top-only and bottom-only preserve upright proportions',()=>{
  for(const side of ['top','bottom']){
    const p=plan(768,1024,{[side]:65},'gpt-image-2.5-flare');
    assert.ok(p.height>p.original.h);
    assert.ok(Math.abs(p.original.w/p.original.h-.75)<.002);
    assert.equal(side==='top',p.original.y>0);
  }
});
test('four-sided extension preserves non-square source aspect and centers',()=>{
  const p=plan(1280,720,{left:25,right:25,top:20,bottom:20},'gpt-image-2');
  assert.ok(p.original.x>0&&p.original.y>0);
  assert.ok(Math.abs(p.original.w/p.original.h-1280/720)<.003);
  assert.ok(p.original.x+p.original.w<p.width);
  assert.ok(p.original.y+p.original.h<p.height);
});
test('legacy model pads a native aspect ratio without anisotropic scaling',()=>{
  const p=plan(1024,1024,{right:40},'gpt-image-1.5');
  assert.equal(p.customSize,null);
  assert.equal(p.width,1536);
  assert.equal(p.height,1024);
  assert.equal(p.original.w/p.original.h,1);
  assert.equal(p.original.x,0);
});
test('image model limits are checked before spending money',()=>{
  assert.throws(()=>plan(1024,1024,{right:200,left:200},'gpt-image-2'),/3:1/);
  assert.throws(()=>plan(1024,1024,{right:0},'gpt-image-2'),/扩展方向/);
});
