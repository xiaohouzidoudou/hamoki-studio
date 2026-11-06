'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','assets','result-floating-composer.js'),'utf8');
const begin=source.indexOf("    const TRANSPARENT_PROMPT_TITLE=");
const end=source.indexOf("    transparentToggle.onchange=",begin);
assert.ok(begin>=0&&end>begin,'transparent toggle helpers must be present');
const helperSource=source.slice(begin,end);

function harness(prompt){
  const input={value:prompt};
  const messages=[];
  const richPrompt={
    rich:{scrollTop:0,scrollHeight:200},
    replace(value){input.value=value;}
  };
  const build=new Function('input','richPrompt','stripCanvasMarkers','say',
    helperSource+'\nreturn {sync:syncTransparentPrompt};');
  const {sync}=build(input,richPrompt,
    value=>value.replace(/\{\{canvas_ref:[^}]*\}\}/g,''),
    message=>messages.push(message));
  return {input,sync,messages};
}
const title='【透明背景要求】';

test('opening transparent mode appends a visible, editable block only once',()=>{
  const h=harness('一只小猴，戴着帽子。');
  assert.equal(h.sync(true),true);
  assert.ok(h.input.value.startsWith('一只小猴，戴着帽子。\n\n'+title));
  assert.match(h.input.value,/真实 Alpha 透明通道/);
  h.sync(true);
  assert.equal(h.input.value.split(title).length-1,1);
});
test('closing without edits removes only the automatic block',()=>{
  const h=harness('游戏 UI 宝箱');
  h.sync(true);
  h.sync(false);
  assert.equal(h.input.value,'游戏 UI 宝箱');
});
test('closing after editing default wording keeps the customized instructions',()=>{
  const h=harness('一个背包');
  h.sync(true);
  h.input.value=h.input.value.replace('不要添加场景','可保留柔和投影，但不要添加场景');
  const customized=h.input.value;
  h.sync(false);
  assert.equal(h.input.value,customized);
  h.sync(true);
  assert.equal(h.input.value,customized,'turning on again must not duplicate customized wording');
});
test('even changing the default block title keeps custom wording without duplication',()=>{
  const h=harness('一只松鼠');
  h.sync(true);
  h.input.value=h.input.value.replace(title,'【我的透明要求】');
  const customized=h.input.value;
  h.sync(false);
  h.sync(true);
  assert.equal(h.input.value,customized);
  assert.equal(h.input.value.includes(title),false);
});
test('manually removing the block allows a fresh append',()=>{
  const h=harness('一把宝剑');
  h.sync(true);
  h.input.value='一把宝剑';
  h.sync(false);
  h.sync(true);
  assert.equal(h.input.value.split(title).length-1,1);
});
test('over-limit prompt is untouched and the toggle helper refuses activation',()=>{
  const initial='图'.repeat(980);
  const h=harness(initial);
  assert.equal(h.sync(true),false);
  assert.equal(h.input.value,initial);
  assert.match(h.messages.join(' '),/超过1000字/);
});
test('empty prompt can receive editable instructions',()=>{
  const h=harness('');
  h.sync(true);
  assert.ok(h.input.value.startsWith(title));
  h.sync(false);
  assert.equal(h.input.value,'');
});
