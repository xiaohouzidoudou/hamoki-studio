'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const memory=require('../lib/assistant-memory');
const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
test('confirmed project rules are scoped, deduplicated and appear in generation prompts',()=>{
 let m=memory.normalize(null);
 m=memory.learnRule(m,'周年庆页面不要前景遮挡',a,'2026-10-15');
 m=memory.learnRule(m,'周年庆页面不要前景遮挡',b,'2026-10-15');
 assert.equal(m.rules.length,1);
 const prompt=memory.generationPrompt('制作充值返利',m,'暗蓝紫机械风','按钮与原型一致');
 assert.match(prompt,/不要前景遮挡/);
 assert.match(prompt,/暗蓝紫机械风/);
 assert.match(prompt,/按钮与原型一致/);
 assert.doesNotMatch(memory.generationPrompt('制作新图片',null,'',''),/周年庆页面不要前景遮挡/);
 assert.equal(memory.forgetRule(m,b).rules.length,0);
});
test('rejected output does not become a project-wide style rule',()=>{
 let m=memory.mark(null,'rejected',a,b,'按钮错了','2026-10-15');
 assert.equal(m.rules.length,0);
 assert.equal(m.feedback[0].note,'按钮错了');
 m=memory.mark(m,'approved',a,b,'','2026-10-15');
 assert.equal(m.approved[0].historyId,b);
 assert.equal(m.rules.length,0);
});
test('planner requires parseable explicit structured plan',()=>{
 assert.equal(memory.parsePlan('前言 ```json\\n{\"action\":\"image\",\"mode\":\"edit\"}\\n```').mode,'edit');
 assert.equal(memory.parsePlan('{\"action\":\"unexpected\"}').action,'chat');
 assert.throws(()=>memory.parsePlan('undefined'),/没有执行生图/);
});
