'use strict';
const CATEGORIES=new Set(['background','container','control','icon','object','text','decoration','other']);
const MAX_ITEMS=24;
function parseInventory(response){
 const raw=String(response||'').trim().replace(/^\x60{3}(?:json)?\s*/i,'').replace(/\s*\x60{3}$/,'');
 let parsed;try{parsed=JSON.parse(raw)}catch{throw Error('AI 组件识别没有返回有效 JSON')}
 if(!Array.isArray(parsed?.items)||parsed.items.length<1||parsed.items.length>MAX_ITEMS)throw Error('识别结果应包含 1-24 个组件');
 return parsed.items.map((item,index)=>{
  if(typeof item?.name!=='string'||!item.name.trim()||item.name.length>65)throw Error('组件名称无效');
  if(!CATEGORIES.has(item.category))throw Error('组件类型无效');
  if(!Array.isArray(item.box)||item.box.length!==4||item.box.some(v=>!Number.isInteger(v)||v<0||v>1000)||item.box[2]<=item.box[0]||item.box[3]<=item.box[1])throw Error('组件范围坐标无效');
  if(typeof item.description!=='string'||item.description.trim().length<12||item.description.length>900)throw Error('组件缺少可用于复原的美术描述');
  return {index:index+1,name:item.name.trim(),category:item.category,box:item.box,description:item.description.trim(),status:'ready'};
 });
}
function analysisPrompt(styleDNA=''){
 return '仅分析传入的这一张完整游戏 UI 成品图。识别画面里真正存在且值得独立复用的美术元素，包括干净背景、面板、按钮底板、页签、奖励图标和装饰。不要臆造、不要重复列出同一素材。按背景到前景排序，不超过24个。只输出 JSON：{"items":[{"name":"中文名称","category":"background|container|control|icon|object|text|decoration|other","box":[左,上,右,下],"description":"原图里的颜色、形状、材质、描边、遮挡及补全要求，至少12字"}]}。box坐标为0至1000。风格DNA：'+String(styleDNA).slice(0,5000);
}
function componentPrompt(item,styleDNA=''){
 if(!item||!CATEGORIES.has(item.category))throw Error('组件不合法');
 return [
  '根据提供的完整游戏 UI 原图，仅制作一个独立美术素材，严格还原原图而不是重新设计。',
  '目标名称：'+item.name,'类别：'+item.category,'原图区域千分比：'+item.box.join(','),
  '原图美术特征：'+item.description,'项目风格 DNA：'+String(styleDNA).slice(0,5500),
  item.category==='background'?'生成与原图一致的干净背景，去掉覆盖其上的 UI 并自然补全。':'生成完整的独立元素，补全被遮挡部分。尽可能采用透明背景，并保留安全边距。',
  '禁止输出整张原界面、拼贴素材板、多个组件或与原图不一致的设计。',
 ].join('\n');
}
module.exports={CATEGORIES,MAX_ITEMS,parseInventory,analysisPrompt,componentPrompt};
