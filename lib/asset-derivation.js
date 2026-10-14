'use strict';
const fs=require('node:fs'),path=require('node:path');
const creative=require('./creative-upstream');
const ROOT=path.join(__dirname,'..','vendor','ai_asset');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const TYPES=Object.freeze({
 screen:{label:'游戏 UI 界面',command:'ASSET',ratio:'9:16',schema:'schema/asset_spec.schema.yaml',rule:'完整游戏屏幕、菜单或活动页面；内容与信息层级完整，安全区域适当，画面不能是通用网页后台'},
 kit:{label:'UI Kit',command:'ASSET',ratio:'3:2',schema:'schema/asset_spec.schema.yaml',rule:'UI-KIT 模式：在一张整洁素材板上绘制同风格的按钮、面板、标签、标签页和进度条，各组件彼此独立不遮挡'},
 icons:{label:'图标 / 道具',command:'ASSET/OBJECT',ratio:'1:1',schema:'schema/object_spec.schema.yaml',rule:'ASSET SHEET 或 OBJECT 模式：同风格图标、游戏货币、宝箱和道具，单个元素独立且可辨认；一张图是素材板，不是多个独立 PNG'},
 background:{label:'游戏背景',command:'BACKGROUND',ratio:'9:16',schema:'schema/background_spec.schema.yaml',rule:'BACKGROUND 模式：没有 UI 按钮、HUD、文字和角色的纯场景背景；画面边缘不要贴近镜头的前景遮挡物'},
 character:{label:'角色设定',command:'CHARACTER',ratio:'2:3',schema:'schema/character_spec.schema.yaml',rule:'CHARACTER 模式：角色全身概念设计或表情设定，保留身份和材质语言；角色姿势变体如需身份锁定须额外提供角色参考图'}
});
const list=()=>Object.entries(TYPES).map(([id,t])=>({id,...t}));
function validateItems(input){
 if(!Array.isArray(input)||input.length<1||input.length>8)throw Error('每批选择 1 至 8 份素材任务');
 return input.map((x,i)=>{
  if(!x||!TYPES[x.kind])throw Error('第 '+(i+1)+' 个素材类型不支持');
  const description=String(x.description||'').trim();
  if(!description||description.length>300)throw Error('每份素材需要 1 至 300 字具体描述');
  return {kind:x.kind,description,index:i+1};
 });
}
function buildPlanPrompt(items,styleDNA){
 const selected=validateItems(items);
 if(!String(styleDNA||'').trim())throw Error('请先分析画风或复用现有 Style DNA');
 let tokens='';
 try{tokens=creative.tokenPhrases(styleDNA).join('\n')}catch{tokens='Style DNA 为历史自由文本格式，请仅依据其真实描述，不要虚构颜色代码。'}
 const schemas=[...new Set(selected.map(x=>TYPES[x.kind].schema))];
 return [
 '你是游戏美术素材生产的提示词策划。使用原版 tnbao91/ai_asset 的 SYNTHESIZER 规范批量生成多份可直接发给图像模型的提示词。',
 '【ai_asset 原始 §4 设计规范】',creative.section(4),
 ...schemas.flatMap(x=>['【原版 '+x+'】',read(x).slice(0,12500)]),
 '【从官方风格字典提取的真实短语】',tokens.slice(0,5200)||'根据 Style DNA 约束，不添加新风格。',
 '【统一 Style DNA，五类素材全部严格遵守】',String(styleDNA).slice(0,12000),
 '【本批次独立素材任务】',selected.map(t=>JSON.stringify({index:t.index,kind:t.kind,command:TYPES[t.kind].command,ratio:TYPES[t.kind].ratio,description:t.description,requirements:TYPES[t.kind].rule})).join('\n'),
 '【输出格式】只输出 JSON：{"items":[{"index":1,"kind":"screen","prompt":"可直接提交生图模型的完整中文提示词"}]}。按输入顺序，index/kind 一一对应，不得删除、合并、添加任务。',
 '每条 prompt 清楚规定主体、构图、颜色/材质/描边、该类型的 ai_asset 子模式、负面约束、需要的文字或元素。对既有游戏 UI 风格要忠实：不增加不在需求中的物品、按钮或文字。',
 'UI-KIT 与图标素材板是单张整图，不宣称已自动切片。BACKGROUND 不要画 HUD、人物、按钮；CHARACTER 不要将风格参考截图里的其他人物身份强加到新角色。不要虚构 Unity/Three.js 代码。',
 '单条 prompt 建议 250-900 中文字，最多 2500 字。严禁把整个 ai_asset 操作教程原样复制到 prompt。'
 ].join('\n\n');
}
function parsePlan(output,source){
 const tasks=validateItems(source);
 const raw=String(output||'').trim().replace(/^\x60{3}(?:json)?\s*/i,'').replace(/\s*\x60{3}$/,'');
 let value;try{value=JSON.parse(raw)}catch{throw Error('文字模型没有返回可解析的 JSON 素材清单，请检查模型输出格式')}
 const items=value?.items;
 if(!Array.isArray(items)||items.length!==tasks.length)throw Error('生成的素材任务数量不匹配，未保存不完整草稿');
 return tasks.map((x,i)=>{
  const item=items[i],prompt=item?.prompt;
  if(item?.index!==i+1||item.kind!==x.kind||typeof prompt!=='string'||prompt.trim().length<45||prompt.length>7000)
   throw Error('第 '+(i+1)+' 份素材提示词格式有误；没有提交生图任务');
  return {kind:x.kind,description:x.description,prompt:prompt.trim(),ratio:TYPES[x.kind].ratio,status:'draft'};
 });
}
module.exports={TYPES,list,validateItems,buildPlanPrompt,parsePlan};
