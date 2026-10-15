'use strict';
// Server-owned, per-project grid for generated artwork. Existing canvas nodes are never moved.
const TILE=288;
const STEP=352;
const COLUMNS=4;
const MARGIN=24;
const LIMIT=190000;
function validLayout(layout){
 return layout&&Number.isSafeInteger(layout.x)&&Number.isSafeInteger(layout.y)&&
  Number.isSafeInteger(layout.nextSlot)&&layout.nextSlot>=0&&
  layout.x>=-200000&&layout.y>=-200000;
}
function initialLayout(nodes){
 if(!nodes.length)return {x:180,y:170,nextSlot:0};
 const right=Math.max(...nodes.map(n=>n.x+n.w));
 const x=Math.max(180,Math.ceil((right+180)/STEP)*STEP);
 if(x+(COLUMNS-1)*STEP+TILE<=LIMIT)return {x,y:170,nextSlot:0};
 const bottom=Math.max(...nodes.map(n=>n.y+n.h));
 return {x:180,y:Math.max(170,Math.ceil((bottom+180)/STEP)*STEP),nextSlot:0};
}
function intersects(x,y,node){
 return x < node.x+node.w+MARGIN && x+TILE+MARGIN > node.x &&
  y < node.y+node.h+MARGIN && y+TILE+MARGIN > node.y;
}
function nextGeneratedPosition(project){
 if(!project||!Array.isArray(project.nodes))throw Error('Missing project canvas');
 if(!validLayout(project.generationLayout)){
  project.generationLayout=initialLayout(project.nodes);
 }
 const layout=project.generationLayout;
 // Monotonic slots keep rows stable even when old images are moved or deleted.
 for(let slot=layout.nextSlot;slot<layout.nextSlot+12000;slot++){
  const x=layout.x+(slot%COLUMNS)*STEP,y=layout.y+Math.floor(slot/COLUMNS)*STEP;
  if(x+TILE>200000||y+TILE>200000)break;
  if(project.nodes.some(node=>intersects(x,y,node)))continue;
  layout.nextSlot=slot+1;
  return {x,y,w:TILE,h:TILE,slot};
 }
 throw Error('生成结果区已满，请整理画布后继续生成');
}
module.exports={nextGeneratedPosition,initialLayout,intersects,TILE,STEP,COLUMNS};
