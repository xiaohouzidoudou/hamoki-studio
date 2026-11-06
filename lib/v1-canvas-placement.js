'use strict';

// Place each completed image to the right of the most relevant existing artwork.
// Only the new node moves; never reorder or silently rewrite existing art.
function placeGeneratedImage(nodes, {parentId = null, width = 288, height = 288, gap = 36} = {}) {
  const elements = Array.isArray(nodes) ? nodes : [];
  const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  const coord = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const parent = parentId ? elements.find(node => node.id === parentId) : null;
  const siblings = parent ? elements.filter(node => node.parentNodeId === parent.id && node.kind === 'generated') : [];
  let anchor = siblings.length ? siblings[siblings.length - 1] : parent;
  if (!anchor) anchor = [...elements].reverse().find(node => node.kind === 'generated')
    || [...elements].reverse().find(node => node.kind === 'reference') || null;
  if (!anchor) return {x: 150, y: 170, w: width, h: height};

  const y = coord(parent ? parent.y : anchor.y, 170); // Consistent top edge for siblings.
  let x = coord(anchor.x, 150) + positive(anchor.w, width) + gap;
  // Reserve the full width of every existing item that intersects this row.
  // This also avoids collisions with manually moved images and notes.
  for (let i = 0; i <= elements.length; i++) {
    const conflicts = elements.filter(node => {
      const nx = coord(node.x, 0), ny = coord(node.y, 0);
      const nw = positive(node.w, width), nh = positive(node.h, height);
      return x < nx + nw + gap && x + width + gap > nx
        && y < ny + nh + gap && y + height + gap > ny;
    });
    if (!conflicts.length) break;
    const nextX = Math.max(x, ...conflicts.map(node => coord(node.x, 0) + positive(node.w, width) + gap));
    if (nextX <= x) break;
    x = nextX;
  }
  return {x: Math.round(x), y: Math.round(y), w: width, h: height};
}

// Derived artwork belongs directly above or below its source, never behind
// another image. Scan free vertical slots without moving existing canvas nodes.
function placeRelatedImage(nodes, {parentId, width = 288, height = 288, gap = 48} = {}) {
  const elements = Array.isArray(nodes) ? nodes : [];
  const parent = elements.find(node => node.id === parentId);
  if (!parent) return placeGeneratedImage(elements, {width, height, gap});
  const value = (number, fallback) => Number.isFinite(Number(number)) ? Number(number) : fallback;
  const size = (number, fallback) => {
    const n = value(number, fallback);
    return n > 0 ? n : fallback;
  };
  const w = size(width, 288), h = size(height, 288);
  const px = value(parent.x, 0), py = value(parent.y, 0);
  const pw = size(parent.w, 288), ph = size(parent.h, 288);
  const padding = Math.max(8, Math.min(18, gap / 3));
  const x = Math.round(Math.max(-200000, Math.min(200000 - w, px + (pw - w) / 2)));
  const clear = y => elements.every(node => {
    const nx = value(node.x, 0), ny = value(node.y, 0);
    const nw = size(node.w, 288), nh = size(node.h, 288);
    return x >= nx + nw + padding || x + w + padding <= nx ||
      y >= ny + nh + padding || y + h + padding <= ny;
  });
  // Try neighbouring rows and columns instead of walking thousands of pixels
  // up/down one blocked column. Vertical slots receive a slight preference.
  const positions=[];
  const centerY=py+(ph-h)/2,centerX=px+pw/2;
  const columns=Math.min(7,Math.max(3,Math.ceil(Math.sqrt(elements.length))));
  const rows=Math.min(9,Math.max(3,Math.ceil(Math.sqrt(elements.length))));
  for(let column=0;column<=columns;column++){
    const shifts=column?[column,-column]:[0];
    for(const shift of shifts){
      const left=Math.round(x+shift*(w+gap));
      for(let row=0;row<=rows;row++){
        const delta=row*(h+gap);
        const yBelow=Math.round(py+ph+gap+delta);
        const yAbove=Math.round(py-h-gap-delta);
        for(const top of [yBelow,yAbove]){
          const dist=Math.hypot(left+w/2-centerX,top+h/2-(py+ph/2));
          positions.push({x:left,y:top,score:dist+Math.abs(left+w/2-centerX)*.14});
        }
        if(column&&row===0){
          const dist=Math.abs(left+w/2-centerX);
          positions.push({x:left,y:Math.round(centerY),score:dist*1.15});
        }
      }
    }
  }
  // Stable ordering keeps below before above when equally close.
  positions.sort((a,b)=>a.score-b.score);
  for(const pos of positions){
    if(pos.x<-200000||pos.x+w>200000||pos.y<-200000||pos.y+h>200000)continue;
    const collision=elements.some(node=>{
      const nx=value(node.x,0),ny=value(node.y,0);
      const nw=size(node.w,288),nh=size(node.h,288);
      return pos.x<nx+nw+padding && pos.x+w+padding>nx &&
        pos.y<ny+nh+padding && pos.y+h+padding>ny;
    });
    if(!collision)return {x:pos.x,y:pos.y,w,h};
  }
  throw Error('关联图片周围没有可用位置，请先整理画布');
}

module.exports = {placeGeneratedImage, placeRelatedImage};
