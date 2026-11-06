/* Shared infinite canvas interaction math for image generation and game UI. */
'use strict';
(function(root){
 const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
 function wheelFactor(event){const speed=event.deltaMode===1?.045:event.deltaMode===2?.15:.0015;return Math.exp(-event.deltaY*speed);}
 function anchoredZoom({zoom,x,y},target,px,py,min=.1,max=10){
  const next=clamp(Number(target)||1,min,max);
  const wx=(px-x)/zoom,wy=(py-y)/zoom;
  return {zoom:next,x:px-wx*next,y:py-wy*next};
 }
 function center({width,height,zoom},worldX,worldY){return {x:width/2-worldX*zoom,y:height/2-worldY*zoom};}
 function fitBounds(nodes,viewport,{marginX=110,marginY=145,min=.1,max=10}={}){
  if(!nodes.length)return null;
  const minX=Math.min(...nodes.map(n=>n.x)),minY=Math.min(...nodes.map(n=>n.y));
  const maxX=Math.max(...nodes.map(n=>n.x+n.w)),maxY=Math.max(...nodes.map(n=>n.y+n.h));
  const w=Math.max(1,maxX-minX),h=Math.max(1,maxY-minY);
  const zoom=clamp(Math.min((viewport.width-marginX)/w,(viewport.height-marginY)/h),min,max);
  return {zoom,...center({width:viewport.width,height:viewport.height,zoom},(minX+maxX)/2,(minY+maxY)/2)};
 }
 function dragDelta(from,to,zoom){return {x:(to.x-from.x)/zoom,y:(to.y-from.y)/zoom};}
 root.HamokiCanvasCore=Object.freeze({clamp,wheelFactor,anchoredZoom,center,fitBounds,dragDelta});
})(typeof window!=='undefined'?window:globalThis);
