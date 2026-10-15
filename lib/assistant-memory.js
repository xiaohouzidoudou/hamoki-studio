'use strict';
// Project-scoped, explicit-feedback memory. No keys, image bytes, or automatic
// promotion of vague criticism into permanent style preferences.
const ID=/^[a-f0-9-]{36}$/i;
const short=(v,n)=>String(v||'').replace(/\s+/g,' ').trim().slice(0,n);
const unique=values=>[...new Set(values)];
function normalize(input){
 const m=input&&typeof input==='object'?input:{};
 return {
  rules:(Array.isArray(m.rules)?m.rules:[]).filter(x=>x&&typeof x.text==='string').slice(-32).map(x=>({id:ID.test(x.id)?x.id:null,text:short(x.text,360),at:short(x.at,40)})).filter(x=>x.id&&x.text),
  approved:(Array.isArray(m.approved)?m.approved:[]).filter(x=>x&&ID.test(x.nodeId)&&ID.test(x.historyId)).slice(-16).map(x=>({nodeId:x.nodeId,historyId:x.historyId,at:short(x.at,40)})),
  feedback:(Array.isArray(m.feedback)?m.feedback:[]).filter(x=>x&&['approved','rejected'].includes(x.kind)).slice(-32).map(x=>({kind:x.kind,nodeId:ID.test(x.nodeId)?x.nodeId:null,note:short(x.note,350),at:short(x.at,40)}))
 };
}
function learnRule(input,rule,id,at){
 const m=normalize(input),text=short(rule,360);
 if(text.length<3||!ID.test(id))throw Error('记忆内容无效');
 m.rules=m.rules.filter(x=>x.text!==text).concat({id,text,at}).slice(-32);
 return m;
}
function forgetRule(input,id){
 const m=normalize(input);m.rules=m.rules.filter(x=>x.id!==id);return m;
}
function mark(input,kind,nodeId,historyId,note,at){
 const m=normalize(input);
 if(!ID.test(nodeId)||!ID.test(historyId)||!['approved','rejected'].includes(kind))throw Error('请先选中本项目的一张已生成图片');
 if(kind==='approved')m.approved=m.approved.filter(x=>x.nodeId!==nodeId).concat({nodeId,historyId,at}).slice(-16);
 else m.approved=m.approved.filter(x=>x.nodeId!==nodeId);
 m.feedback=m.feedback.concat({kind,nodeId,note:short(note,350),at}).slice(-32);
 return m;
}
function guide(input,styleDNA='',page=''){
 const m=normalize(input);
 return [
  '【项目已确认的长期约束；不可擅自忽略】',
  m.rules.length?m.rules.map((x,i)=>(i+1)+'. '+x.text).join('\n'):'尚无明确确认的长期规则',
  '【已有项目 Style DNA；仅用于画风，不替代原型结构】',
  String(styleDNA||'').slice(0,4800),
  '【当前页面原型/策划需求；优先保留页面功能与布局】',
  String(page||'').slice(0,2700)
 ].join('\n');
}
function generationPrompt(instruction,input,styleDNA,page){
 return [
  '你正在为同一游戏项目创作。请严格遵循已有项目规则和页面原型，不得凭空增加奖励、按钮、标题或前景装饰。',
  guide(input,styleDNA,page),
  '【本次用户指令；修改时只改变指定部分，其他内容尽量保持】',
  short(instruction,3600),
  '【提交前自检】风格一致、原型内容无遗漏、没有违反负面约束。模型无法保证像素级锁定，局部修改需配合真实源图或蒙版。'
 ].join('\n\n').slice(0,11500);
}
function planningPrompt(input,context){
 const cmd=short(input,2400);
 return [
  '你是 Hamoki 游戏美术助手的后台意图调度器，只选择操作，不直接调用工具。必须只输出单一 JSON 对象，不要代码块。',
  '字段：{"action":"chat|image|remember|approve|reject","mode":"new|edit","reply":"对用户的简短自然回复","rule":"只有用户明确要求长期记住时填写原话含义","edit":{"target":"具体修改对象（中文）","change":"要执行的变化（中文）","preserve":"必须保持不变的属性（中文）","englishVisualTerms":"本轮变化的简短英文视觉术语，不得改变已有风格"}}。',
  '规则：',
  '1. 用户明确要求创建、重画、修改、生成一张图片时才 action=image；对概念提问、随意讨论、询问意见用 chat，禁止代替用户发起付费生图。',
  '2. 用户明确说“以后/今后/整个项目/这套活动都要/不要”等持久设计规范时用 remember，rule 忠实保留原句含义；没有明确范围时只记当前项目。',
  '3. “这张可以/满意/定稿”用 approve，“这张不对/不喜欢”用 reject；未明确选图时默认最近一张本项目生成作品，简单否定反馈不能变成全项目禁止规则。',
  '4. 用户说“按钮放大一点/背景弱一些”等明确具体修改要求时 action=image，mode=edit，使用本项目当前选择或最近生成作品；没有任何历史图片时用 chat 说明缺少源图。新页面创作则 mode=new，交给已有的策划文档、原型与美术工作流处理。',
  '5. edit 仅在 mode=edit 时填写；理解用户中文原话中的对象、增减方向、否定词和保留要求，englishVisualTerms 是本轮局部变化的英文术语，不是新的风格设定。例：“框太平了，增加立体感，其他别动” -> target=当前框，change=增加倒角光影与立体层次，preserve=其余颜色布局内容，englishVisualTerms=add subtle bevel, dimensional highlights and soft shadows。不要编造未见的原型细节。',
  '6. 不要虚构已执行的生成、审核、切图、上传或记忆操作。chat 的 reply 尽可能切实回答，无法判断时询问一个关键问题。',
  '【项目上下文】'+String(context||'').slice(0,6500),
  '【用户消息】'+cmd
 ].join('\n');
}
function parsePlan(raw){
 const original=String(raw||'').trim();
 const m=original.match(/\{[\s\S]*\}/);if(!m)throw Error('后台未能理解这次指令，请换一种说法重试；没有执行生图');
 let obj;try{obj=JSON.parse(m[0])}catch{throw Error('后台没有返回可识别的操作计划；没有执行生图')}
 const action=['chat','image','remember','approve','reject'].includes(obj.action)?obj.action:'chat';
 const edit=obj.edit&&typeof obj.edit==='object'&&!Array.isArray(obj.edit)?{
  target:short(obj.edit.target,160),change:short(obj.edit.change,320),preserve:short(obj.edit.preserve,320),englishVisualTerms:short(obj.edit.englishVisualTerms,320)
 }:null;
 return {action,mode:obj.mode==='edit'?'edit':'new',reply:short(obj.reply,1200),rule:short(obj.rule,360),edit:action==='image'&&obj.mode==='edit'&&edit?.change?edit:null};
}
module.exports={normalize,learnRule,forgetRule,mark,guide,generationPrompt,planningPrompt,parsePlan};
