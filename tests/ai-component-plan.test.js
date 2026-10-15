'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseInventory,analysisPrompt,componentPrompt}=require('../lib/ai-component-plan');
const sample={items:[
 {name:'干净活动背景',category:'background',box:[0,0,1000,1000],description:'深蓝紫色机械活动背景，需要移除覆盖的按钮并补全纹理'},
 {name:'黄色奖励按钮',category:'control',box:[250,650,750,770],description:'黄色双层立体按钮，暗色外轮廓及明亮高光材质'}
]};
test('one image inventory accepts bounded individual visual assets',()=>{
 const a=parseInventory(JSON.stringify(sample));
 assert.equal(a.length,2);assert.equal(a[0].category,'background');
 assert.match(componentPrompt(a[1],'统一蓝紫色'),/黄色奖励按钮/);
 assert.match(analysisPrompt('亮色卡通机械'),/JSON/);
});
test('strip model JSON code fence without accepting arbitrary text',()=>{
 const a=parseInventory('```json\n'+JSON.stringify(sample)+'\n```');
 assert.equal(a.length,2);
 assert.throws(()=>parseInventory('button panel icon'));
});
test('reject hallucinated or unsafe component categories and bounding boxes',()=>{
 assert.throws(()=>parseInventory(JSON.stringify({items:[{...sample.items[0],category:'unknown'}]})));
 assert.throws(()=>parseInventory(JSON.stringify({items:[{...sample.items[0],box:[100,200,50,900]}]})));
 assert.throws(()=>parseInventory(JSON.stringify({items:[]})));
 assert.throws(()=>parseInventory(JSON.stringify({items:Array.from({length:25},()=>sample.items[0])})));
});
