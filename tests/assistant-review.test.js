'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const review=require('../lib/assistant-review');
test('prompt only claims actually supplied reference images',()=>{
 const x=review.prompt({rules:'禁止前景遮挡',requirements:'充值返利三个按钮',hasStyle:true,hasPrototype:false,hasSource:false});
 assert.match(x,/禁止前景遮挡/);
 assert.match(x,/充值返利三个按钮/);
 assert.match(x,/已批准的游戏美术风格参考/);
 assert.doesNotMatch(x,/目标页面原型图（只代表结构内容/);
 const structural=review.prompt({instruction:'必须是5列×6行，共30个奖励格子，不要出现前景箱子'});
 assert.match(structural,/5列×6行/);
 assert.match(structural,/6列5行/);
 assert.match(structural,/不要出现前景箱子/);
});
test('parse bounded structured findings without granting false passes',()=>{
 const x=review.parse('响应：```json\n{"status":"needs_work","summary":"缺少按钮","issues":["标题不对","颜色不对"],"correction":"仅修复标题和颜色"}\n```');
 assert.equal(x.status,'needs_work');assert.equal(x.issues.length,2);assert.match(x.correction,/仅修复/);
 assert.equal(review.parse('我觉得不错').status,'uncertain');
 assert.equal(review.parse('{"status":"GREAT","issues":["x"]}').status,'uncertain');
 assert.equal(review.parse('{"status":"pass","correction":"无关建议"}').correction,'');
});
