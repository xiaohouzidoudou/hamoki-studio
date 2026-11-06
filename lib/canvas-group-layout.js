'use strict';

// Pure layout of a group. Original source files and pixel dimensions are untouched.
const allowedLayouts=new Set(['manual','grid','row','column']);
const allowedAlign=new Set(['start','center','end']);
const allowedColors=new Set(['mint','blue','violet','amber','slate']);
const clamp=(value,min,max,def)=>Number.isFinite(Number(value))?
  Math.max(min,Math.min(max,Math.round(Number(value)))):def;
function normalizeGroupSettings(input={},existing={}) {
  const layout=allowedLayouts.has(input.layout)?input.layout:(existing.layout||'manual');
  const align=allowedAlign.has(input.align)?input.align:(existing.align||'start');
  const color=allowedColors.has(input.color)?input.color:(existing.color||'mint');
  return {
    layout,align,color,
    columns:clamp(input.columns??existing.columns,1,8,3),
    gap:clamp(input.gap??existing.gap,8,70,17),
    padding:clamp(input.padding??existing.padding,12,72,19),
    title:typeof input.title==='string'?input.title.trim().slice(0,60):(existing.title||'素材组'),
    promptNodeId:input.promptNodeId===null?null:
      typeof input.promptNodeId==='string'?input.promptNodeId:(existing.promptNodeId||null)
  };
}
function layoutNodes(nodes,settings) {
  if(settings.layout==='manual'||nodes.length<1)return [];
  const baseX=Math.min(...nodes.map(n=>Number(n.x)||0));
  const baseY=Math.min(...nodes.map(n=>Number(n.y)||0));
  const maxSide=198;
  const sizes=nodes.map(node=>{
    if(node.kind==='note')return {w:264,h:178};
    const w=Math.max(90,Number(node.w)||210),h=Math.max(90,Number(node.h)||210);
    const f=Math.min(1,maxSide/Math.max(w,h));
    return {w:Math.max(110,Math.round(w*f)),h:Math.max(110,Math.round(h*f))};
  });
  const columns=settings.layout==='column'?1:
    settings.layout==='row'?nodes.length:settings.columns;
  const rows=Math.ceil(nodes.length/columns);
  const colWidths=Array.from({length:columns},()=>0);
  const rowHeights=Array.from({length:rows},()=>0);
  sizes.forEach(({w,h},i)=>{
    const col=i%columns,row=Math.floor(i/columns);
    colWidths[col]=Math.max(colWidths[col],w);
    rowHeights[row]=Math.max(rowHeights[row],h);
  });
  const offset=(large,small)=>settings.align==='center'?(large-small)/2:
    settings.align==='end'?(large-small):0;
  const positions=[];
  let y=baseY;
  for(let row=0;row<rows;row++){
    let x=baseX;
    for(let col=0;col<columns;col++){
      const i=row*columns+col;if(i>=nodes.length)break;
      const node=nodes[i],size=sizes[i];
      const aligned=settings.layout==='column'
        ?0:offset(colWidths[col],size.w);
      positions.push({id:node.id,
        x:Math.round(x+aligned),y:Math.round(y+(settings.layout==='row'?offset(rowHeights[row],size.h):0)),
        w:size.w,h:size.h});
      x+=colWidths[col]+settings.gap;
    }
    y+=rowHeights[row]+settings.gap;
  }
  return positions;
}
module.exports={normalizeGroupSettings,layoutNodes};
