'use strict';
const crypto=require('node:crypto');
const MAX_DOCUMENTS=12,MAX_PAGES=36;
const clean=(s,n=180)=>String(s||'').replace(/\s+/g,' ').trim().slice(0,n);
function titleLine(line){
 const s=clean(line,130);
 if(!s||s.length>62)return '';
 let m=s.match(/^(?:#{1,4}\s*|第[一二三四五六七八九十\d]+(?:章|节|部分)[：:\s]*|[（(]?[一二三四五六七八九十\d]{1,2}[)）、.．、]\s*)([^：:，。；;]+)$/);
 if(m&&m[1].length>=2&&m[1].length<=35)return clean(m[1],35);
 if(!/(领取|显示|点击|进入|打开|获得|配置|需要|可以|通过|包含|选择|修改|按钮|返回|支持|采用)/.test(s)&&/^[^，。；;：:]{2,20}(?:页面|界面|弹窗|菜单|活动|奖励|商店|礼包|签到|返利|回馈|钻石|泰坦|驾驶员|大放送|任务)$/.test(s))return s;
 return '';
}
function docPages(doc){
 const blocks=doc.blocks||[],sections=[],fallback=clean(doc.name?.replace(/\.docx$/i,''),65)||'文档首页';
 let active=null,sectionNo=0;const imageAt=[];
 const newSection=(name,index)=>{
  const title=clean(name,80);
  if(active&&active.name===title)return;
  active={id:crypto.randomUUID(),name:title,docId:doc.id,sourceName:doc.name,sectionIndex:index,requirements:[],imageIndexes:[],analysis:{},status:'needs-review',issues:[]};
  sections.push(active);sectionNo++;
 };
 blocks.forEach((b,i)=>{
  if(b.kind==='image'){imageAt.push({index:Number(b.index),pos:i});if(!active)newSection(fallback,0);active.imageIndexes.push(Number(b.index));return}
  const lines=String(b.text||'').split('\n');
  const candidate=b.level?clean(b.text,70):lines.length===1?titleLine(lines[0]):'';
  if(candidate&&sections.length<MAX_PAGES){newSection(candidate,i);return}
  if(!active)newSection(fallback,0);
  const t=clean(b.text,1000);if(t&&active.requirements.join('').length<4200)active.requirements.push(t);
 });
 if(!sections.length)newSection(fallback,0);
 // If a front-page overview has no picture and no requirements, don't present it as a fully specified screen.
 return sections.slice(0,MAX_PAGES).map(s=>{
  const text=s.requirements.join('\n').slice(0,4400);
  return {...s,requirements:text,issues:s.imageIndexes.length?[]:['当前章节未包含原型图，请确认页面结构'],status:s.imageIndexes.length?'draft':'needs-prototype'};
 });
}
function mergePages(prev,docs){
 const exists=new Map((prev||[]).map(p=>[p.docId+'|'+p.name,p]));
 const result=[];
 for(const doc of docs)for(const page of docPages(doc)){
  const saved=exists.get(page.docId+'|'+page.name);
  result.push(saved?{...page,id:saved.id,analysis:saved.analysis||{},status:saved.status||page.status,issues:page.issues,layoutImageIndex:saved.layoutImageIndex,quality:saved.quality}:page);
 }
 return result.slice(0,MAX_PAGES);
}
function parsePageResponse(answer,docs,previous){
 let raw=String(answer||'').trim();
 const fenced=raw.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/i);if(fenced)raw=fenced[1];
 const start=raw.indexOf('{'),end=raw.lastIndexOf('}');if(start<0||end<start)throw Error('AI 没有返回可识别的页面 JSON，请检查文字模型是否支持结构化任务');
 let data;
 try{data=JSON.parse(raw.slice(start,end+1))}catch{throw Error('AI 返回了不完整的页面 JSON，请手动检查文档后重试')}
 if(!Array.isArray(data.pages)||!data.pages.length)throw Error('AI 未识别到页面，请先查看文档章节');
 const pages=[],names=new Set();
 for(const candidate of data.pages.slice(0,MAX_PAGES)){
  const doc=docs.find(x=>x.id===candidate.docId);
  if(!doc)continue;
  const name=clean(candidate.name,80);
  if(!name)continue;
  const text=doc.text||'';
  // Ground names in source text; model must not invent pages.
  if(!text.includes(name)&&!(doc.name||'').includes(name))continue;
  const key=doc.id+'|'+name;if(names.has(key))continue;names.add(key);
  const indexes=Array.isArray(candidate.imageIndexes)?[...new Set(candidate.imageIndexes.filter(x=>Number.isInteger(x)&&x>=0&&x<doc.images.length))].slice(0,8):[];
  const source=clean(candidate.requirements,4400);
  const prev=(previous||[]).find(p=>p.docId===doc.id&&p.name===name);
  pages.push({id:prev?.id||crypto.randomUUID(),name,docId:doc.id,sourceName:doc.name,
   requirements:source&&text.includes(source)?source:prev?.requirements||'【未能从文档定位独立需求，请人工核对后再设计】',
   imageIndexes:indexes,layoutImageIndex:indexes[0]??null,
   analysis:prev?.analysis||{},quality:prev?.quality||null,
   status:prev?.status|| (indexes.length?'draft':'needs-prototype'),
   issues:indexes.length?[]:['缺少原型图片；需人工确认布局后生图']});
 }
 if(!pages.length)throw Error('AI 页面名称无法与上传文档匹配，已拒绝凭空创建页面');
 return pages;
}
function splitPrompt(docs){
 return `你是游戏 UI 策划需求分析师，只做“文档分屏”而不是设计美术。
只根据以下 Word 文档提取实际提及的独立游戏 UI 页面/弹窗/活动屏幕，识别各自的原型图归属。
严格输出一个 JSON 对象：{"pages":[{"name":"页面原文名称","docId":"原文给出的 ID","requirements":"原文确实存在的一段完整文字（必须逐字连续出现在该文档；无法提取时留空）","imageIndexes":[0],"uncertainties":["缺原型"]}]}。
规则：不得杜撰不存在的页面；如果文档只概览了一项活动，仍可建“待补充原型”的页面；一个截图不能未经证据自动分给七个活动；列表索引必须在该文档图片范围内。最多 36 个页面。不要输出代码块。
文档集合：\n${docs.map(d=>`【docId:${d.id}】【名称:${d.name}】【图片数量:${d.images.length}】【段落与插图顺序】\n${(d.blocks||[]).slice(0,550).map(b=>b.kind==='image'? `[图片 #${b.index}]` :clean(b.text,700)).join('\n').slice(0,11000)}`).join('\n\n').slice(0,30000)}`;
}
module.exports={MAX_DOCUMENTS,MAX_PAGES,docPages,mergePages,parsePageResponse,splitPrompt,titleLine};
