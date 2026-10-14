'use strict';
// Workflow state glue only. All art-direction methods are loaded from pinned,
// verbatim third-party sources under vendor/. There is no competing local prompt engine.
const upstream=require('./creative-upstream');
const steps=[
 {id:'document',title:'文档与页面识别'},
 {id:'style',title:'美术风格分析'},
 {id:'layout',title:'原型布局分析'},
 {id:'director',title:'美术总监创作方案'},
 {id:'generation',title:'画布生图'},
 {id:'quality',title:'视觉双重质检'}
];
const make=()=>({version:2,status:'empty',document:null,documents:[],pages:[],activePageId:null,styleDNA:'',styleLocked:false,notes:'',styleNodeIds:[],layoutImageIndex:0,analysis:{},quality:null,stages:Object.fromEntries(steps.map(x=>[x.id,'pending'])),updatedAt:new Date().toISOString()});
function extractPrompt(value){
 const text=String(value||'');
 const match=text.match(/(?:^|\n)[#*\s]*[「【]?最终生图提示词[」】]?\s*[:：]?\s*\n?([\s\S]*?)(?=\n[#*\s]*[「【]?质检清单[」】]?|\n# ASSUMPTIONS|$)/);
 return (match?.[1]||text).trim().slice(0,11500);
}
module.exports={steps,make,extractPrompt,stylePrompt:upstream.stylePrompt,layoutPrompt:upstream.layoutPrompt,directorPrompt:upstream.directorPrompt,qualityPrompt:upstream.qualityPrompt};
