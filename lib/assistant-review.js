'use strict';
// One bounded independent visual review per paid image. No hidden regeneration.
// Images are always supplied in the exact order described in this prompt.
const clean=(v,n=450)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,n);
function prompt({rules='',requirements='',instruction='',hasStyle=false,hasPrototype=false,hasSource=false}={}){
 const order=[];
 if(hasStyle)order.push('已批准的游戏美术风格参考');
 if(hasPrototype)order.push('目标页面原型图（只代表结构内容，不代表画风）');
 if(hasSource)order.push('被修改的原始图片（检查是否破坏未指定区域）');
 order.push('最后一张：本次生成结果');
 return [
  '你是独立的游戏 UI 视觉验收员。必须实际比对所附图像，不能凭提示词想象图中内容。',
  '图像顺序：'+order.join('、')+'。前三类参考如未提供则不得声称做过该项对比。',
  '项目规则：'+clean(rules,4700),
  '当前页面策划与原型：'+clean(requirements,2200),
  '本次用户具体创作/修改要求（必须逐项核对）：'+clean(instruction,3200),
  '只检查肉眼可以看出的事实：是否漏按钮/奖励/区域、是否新增原型没有的模块、配色和风格是否偏离、文字是否明显错漏、是否出现被禁前景、修改是否破坏未要求变化的区域。尤其逐项核对用户要求的网格行数、列数和排列方向；比如用户要求5列6行而输出6列5行，虽同为30格也必须判为needs_work。',
  '不能判断内容或缺乏可靠对照时返回 uncertain，不可武断地返回 pass。',
  '严格只输出 JSON：{"status":"pass|needs_work|uncertain","summary":"中文简短结论","issues":["实际可见的具体问题，最多5条"],"correction":"只修正上述问题且保持其它已正确内容的下一轮生图指令，若无问题则为空"}。',
  '最多五项问题；不要返回 Markdown；不要自创分数或声称像素级一致。'
 ].join('\n\n');
}
function parse(raw){
 const m=String(raw||'').match(/\{[\s\S]*\}/);
 if(!m)return {status:'uncertain',summary:'审图模型没有返回可识别的结构化报告',issues:[],correction:''};
 try{
  const x=JSON.parse(m[0]),status=['pass','needs_work','uncertain'].includes(x.status)?x.status:'uncertain';
  const issues=Array.isArray(x.issues)?x.issues.slice(0,5).map(v=>clean(v,240)).filter(Boolean):[];
  return {status,summary:clean(x.summary,280)||'审图没有给出有效结论',issues,correction:status==='needs_work'?clean(x.correction,1300):''};
 }catch{return {status:'uncertain',summary:'审图报告格式不完整，未将作品判定为合格',issues:[],correction:''}}
}
module.exports={prompt,parse};
