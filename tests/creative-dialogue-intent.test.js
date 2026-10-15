'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
const start=source.indexOf('function shouldStartCreativePage(');
const end=source.indexOf('\nasync function assistantSend()',start);
assert.ok(start>0&&end>start,'the actual browser helper must be available');
const decide=new Function(source.slice(start,end)+'\nreturn shouldStartCreativePage;')();
const pages={creativeWorkflow:{pages:[{id:'checkin',name:'签到'}]},nodes:[{kind:'reference'}]};
test('first page uses real Word / STYLE / LAYOUT professional workflow',()=>{
 assert.equal(decide('按签到原型做周年庆签到UI，保留全部奖励',pages),true);
 assert.equal(decide('制作新的超级大放送界面',pages),true);
 assert.equal(decide('给我做周年庆签到页面',pages),true);
});
test('after first image: natural Chinese art direction edits the artwork, not starts a new page',()=>{
 const p={...pages,nodes:[...pages.nodes,{kind:'generated'}]};
 for(const text of ['背景压暗一点','按钮太大了','奖励框再简洁些，其他别动','颜色保持，边框薄一点','这张可以','这个不对','再试一版，其他元素不动','不要前景遮挡','位置稍微调整']){
  assert.equal(decide(text,p),false,'should keep generated image context: '+text);
 }
 assert.equal(decide('制作新的礼包页面，按对应原型来',p),true);
 assert.equal(decide('下一页面做返利UI',p),true);
});
test('only a project with imported pages enters the specialist new-page workflow',()=>{
 assert.equal(decide('画一只小猴子',{nodes:[]}),false);
 assert.equal(decide('背景压暗一点',{creativeWorkflow:{pages:[]},nodes:[{kind:'generated'}]}),false);
});
