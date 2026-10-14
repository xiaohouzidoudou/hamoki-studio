'use strict';
// Thin adapter for REAL, pinned third-party sources. Do not clone their prompts here.
// Source: tnbao91/ai_asset v2.3.0 @ 006a796da817d742b0308a9326c9254a8e875b7b
// Source: guiguiyan930-source/game-ui-design-workflow @ 1ec604638dd1a27198576206eb3e47632725a078
const fs=require('node:fs'),path=require('node:path'),YAML=require('yaml');
const folder=path.join(__dirname,'..','vendor');
const ai=path.join(folder,'ai_asset');
const workflow=path.join(folder,'game-ui-design-workflow','skills');
function source(root,relative){return fs.readFileSync(path.join(root,relative),'utf8')}
const primer=source(ai,'studio_primer.md');
const schema=source(ai,'schema/style_guide.schema.yaml');
const styleDefinition=YAML.parse(schema);
const assetSchema=source(ai,'schema/asset_spec.schema.yaml'),layoutSchema=source(ai,'schema/layout_spec.schema.yaml');
const skills={
 workflow:source(workflow,'game-ui-workflow/SKILL.md'),
 design:source(workflow,'game-ui-specification/SKILL.md'),
 pages:source(workflow,'game-ui-page-generator/SKILL.md'),
 extension:source(workflow,'game-ui-extension/SKILL.md')
};
const tokenFiles=['materials','render_shape','light_color','layout_negative','character_environment','ui_components'];
const dictionaries=tokenFiles.map(name=>YAML.parse(source(ai,'style_tokens/'+name+'.yaml')));
function section(index){
 const start=primer.indexOf('## §'+index+' —');
 const end=primer.indexOf('## §'+(index+1)+' —',start+1);
 if(start<0||end<=start)throw Error('ai_asset primer section missing: §'+index);
 return primer.slice(start,end);
}
const styleRules=section(3),assetRules=section(4),qualityRules=section(5);
function extractYAML(text){
 const match=String(text||'').match(/```ya?ml\s*([\s\S]*?)```/i);
 return match?match[1].trim():String(text||'').split(/# REVIEW NOTES/i)[0].trim();
}
function validateGuide(text){
 const yaml=extractYAML(text);
 let parsed;
 try{parsed=YAML.parse(yaml,{uniqueKeys:true})}catch(e){throw Error('ai_asset STYLE 没有返回有效的 YAML：'+String(e.message).slice(0,150))}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('ai_asset STYLE 必须返回 style_guide.yaml 对象');
 if(String(parsed.version)!=='1'&&String(parsed.version)!=='1.0')throw Error('ai_asset STYLE 缺少正确的 version: 1.0');
 for(const [root,key] of [['project','platform'],['style','rendering'],['shape','language']]){
  const value=parsed[root]?.[key],choices=styleDefinition[root]?.[key]?.enum;
  if(typeof value!=='string'||!choices?.includes(value))throw Error('ai_asset STYLE 字段 '+root+'.'+key+' 必须符合官方枚举，请改用支持 YAML 的视觉模型');
 }
 for(const field of ['primary','secondary','accent']){
  const colors=parsed.palette?.[field];
  if(!Array.isArray(colors)||!colors.length||colors.some(c=>typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c)))throw Error('ai_asset STYLE 的 palette.'+field+' 必须是可验证的六位十六进制颜色列表');
 }
 // Official schema is data, not a JSON-Schema dialect: traverse its enums/types directly.
 const failures=[];
 function inspect(data,spec,trail){
  if(failures.length>=7)return;
  const key=trail.join('.');
  if(!spec){failures.push(key+': not defined in upstream schema');return}
  if(Array.isArray(spec.enum)){
   const vals=(key==='project.genre'||key==='style.mood')?data:[data];
   if(!Array.isArray(vals)||!vals.length||vals.some(v=>!spec.enum.includes(v)))failures.push(key+': invalid enum ('+JSON.stringify(data).slice(0,70)+')');
   return;
  }
  const type=spec.type;
  if(type==='list_hex'){
   if(!Array.isArray(data)||!data.length||data.some(c=>typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c)))failures.push(key+': expected HEX color array');
   return;
  }
  if(type==='float_0_1'){if(typeof data!=='number'||data<0||data>1)failures.push(key+': expected confidence 0..1');return}
  if(type==='bool'){if(typeof data!=='boolean')failures.push(key+': expected boolean');return}
  if(type==='list_free'||type==='list_string'){if(!Array.isArray(data)||data.some(v=>typeof v!=='string'))failures.push(key+': expected string array');return}
  if(type==='string'){if(typeof data!=='string')failures.push(key+': expected string');return}
  if(type==='int'){if(!Number.isInteger(data))failures.push(key+': expected integer');return}
  if(type&&typeof type==='string')return;
  if(!data||typeof data!=='object'||Array.isArray(data)){failures.push(key+': expected map');return}
  for(const [k,v] of Object.entries(data))inspect(v,spec[k],[...trail,k]);
 }
 for(const [root,value] of Object.entries(parsed)){
  if(root==='version')continue;
  inspect(value,styleDefinition[root],[root]);
 }
 if(failures.length)throw Error('ai_asset STYLE 不符合官方 schema：'+failures.join('；').slice(0,450));
 if(!parsed.color_map||!Object.keys(parsed.color_map).length)throw Error('当前是游戏 UI 风格分析，ai_asset 要求提供 color_map 表面颜色，请确认所选视觉模型符合 STYLE 输出规范');

 return {yaml,parsed,review:String(text||'').match(/# REVIEW NOTES[\s\S]*/)?.[0]||''};
}
function tokenPhrases(guide){
 const data=typeof guide==='string'?validateGuide(guide).parsed:guide;
 const out=new Set();
 const visit=(branch,trail=[])=>{
  if(!branch||typeof branch!=='object'||Array.isArray(branch))return;
  for(const [name,value] of Object.entries(branch)){
   const key=[...trail,name].filter(x=>x!=='style').join('_');
   const values=Array.isArray(value)?value:[value];
   if(values.length<5)for(const v of values)if(typeof v==='string'){
    for(const dict of dictionaries){
     const entry=dict[key]?.[v];
     if(typeof entry?.phrase==='string')out.add(key+'.'+v+': '+entry.phrase);
    }
   }
   if(value&&typeof value==='object'&&!Array.isArray(value))visit(value,[...trail,name]);
  }
 };
 visit(data);
 return [...out].slice(0,85);
}
function stylePrompt(notes=''){
 return [
 '按原始项目 tnbao91/ai_asset 的 STYLE / ANALYZER 规则执行。下方是上游原文而非 Hamoki 自编的替代规范。',
 '【原始 STYLE 分析执行规则；§3】',styleRules,
 '【上游 style_guide.schema.yaml；所有字段和可选枚举】',schema,
 '【上游原始游戏 UI 设计规范 Skill】',skills.design,
 '【补充】仅从实际游戏 UI 参考图判断。UI 存在时输出 color_map；不得将布局当 STYLE。只回复官方格式的 YAML 代码块和 REVIEW NOTES。',
 '用户补充：'+String(notes||'').slice(0,1400)
 ].join('\n\n');
}
function layoutPrompt(doc,notes=''){
 return [
 '你是游戏 UI 原型结构读取员。严格遵循上游 ai_asset 的 layout_spec 契约和 game-ui-page-generator 的页面分区原则。',
 '【原始上游布局结构 Schema】',layoutSchema,
 '【原始单页 Skill：与布局直接相关】',skills.pages.slice(0,5400),
 '只从 TARGET 图判断布局和控件；风格以独立 STYLE 图为准。不能虚构图片里不存在的组件。',
 '【策划明确要求】',String(doc||'').slice(0,6000),
 '【用户补充】',String(notes||'').slice(0,900),
 '输出 Layout Blueprint：画布比例、区块位置、组件数量、固定顺序、必须保留的内容、无法判定的地方。'
 ].join('\n\n');
}
function directorPrompt(doc,style,layout,notes=''){
 let dictionary=[];
 try{dictionary=tokenPhrases(style)}catch{ /* existing pre-integration freeform style DNA remains readable */ }
 return [
 '按原始 tnbao91/ai_asset 的 ASSET:（完整游戏 UI 页面）流程处理，保留用户 Word 原型的界面结构。',
 '【原始 ai_asset §4 SYNTHESIZER 规则】',assetRules,
 '【原始 asset_spec.schema.yaml】',assetSchema,
 '【原始 layout_spec.schema.yaml】',layoutSchema,
 '【原始 game-ui-page-generator SKILL】',skills.pages,
 '【原始 game-ui-specification SKILL】',skills.design,
 '【从 ai_asset 原始 style_tokens 自动查得的翻译短语】',dictionary.join('\n')||'参考完整 Style DNA；不得自行补虚构色号。',
 '【目标页面策划要求】',String(doc||'').slice(0,9000),
 '【已确立的 style_guide.yaml】',String(style||'').slice(0,11000),
 '【TARGET 布局】',String(layout||'').slice(0,6500),
 '【用户补充】',String(notes||'').slice(0,1200),
 '为了适配当前工作台：保留上游 ASSET 的 ASSUMPTIONS / SELF-CHECK，同时在最前面插入“最终生图提示词：”，紧接着放完整可直接发送图片模型的提示词；后面输出“质检清单：”及必要验证。不要添加代码、Unity 或自动切图流程。'
 ].join('\n\n');
}
function screenPrompt(documentTaskPrompt){
 return ['你正在执行经过固定版本验证的开源 game-ui-extension 页面盘点 Skill。只记录 Word 确实提及的页面，无法确认的保留待补，不允许新增不存在的页。',
  '【原始 game-ui-extension SKILL】',skills.extension,
  '【上游原始 game-ui-workflow SKILL 的需求、页面清单相关章节，原文截取至组件拆解前】',skills.workflow.split('### 7. Component breakdown')[0],
  '【Hamoki 文件来源和 JSON 协议适配】',String(documentTaskPrompt||'')].join('\n\n');
}
function qualityPrompt(doc,style,layout){
 return [
 '按 tnbao91/ai_asset 原始 CHECK 流程执行，不得用自拟的“合格分数”代替事实判断。',
 '【上游 §5 CHECKER】',qualityRules,
 '【游戏 UI 单页 Skill 的验收条款】',skills.pages,
 '按顺序观察实际提供的游戏 STYLE、TARGET 原型和生成图。没有提供的图像不得声称已验证。请逐项列出证据和返工动作。',
 '【策划】',String(doc||'').slice(0,3500),
 '【STYLE】',String(style||'').slice(0,10000),
 '【TARGET】',String(layout||'').slice(0,4500)
 ].join('\n\n');
}
const version={ai_asset:'006a796da817d742b0308a9326c9254a8e875b7b',game_ui_workflow:'1ec604638dd1a27198576206eb3e47632725a078'};
module.exports={stylePrompt,layoutPrompt,directorPrompt,screenPrompt,qualityPrompt,validateGuide,tokenPhrases,section,version};
