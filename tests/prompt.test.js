const test=require("node:test");
const assert=require("node:assert/strict");
const {CATALOG,makePlan}=require("../lib/prompt");
test("catalog has complete option groups",()=>{assert.equal(Object.keys(CATALOG).length,6);});
test("Halloween poster request retains true UI components",()=>{
 const p=makePlan({activity:"活动主界面",style:"Q版卡通",festival:"万圣节",mechanic:"对战竞技",platform:"移动竖屏"});
 for(const term of ["万圣节","排行榜","奖励","按钮","不生成伪汉字","9:16"])assert.ok(p.prompt.includes(term),term);
 assert.equal(p.ratio,"9:16");
});
test("unknown options cannot inject and notes are bounded",()=>{
 const p=makePlan({festival:"bad",note:"x".repeat(3000),title:"t".repeat(1000)});
 assert.equal(p.selected.festival,"万圣节");
 assert.equal(p.note.length,500);
 assert.equal(p.title.length,60);
});
test("alternate layout differs meaningfully",()=>{
 const a=makePlan({activity:"签到界面",platform:"PC宽屏"});
 assert.match(a.prompt,/签到格/);
 assert.equal(a.ratio,"16:9");
});
