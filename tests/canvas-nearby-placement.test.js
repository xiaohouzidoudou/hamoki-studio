'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {placeRelatedImage}=require('../lib/v1-canvas-placement');
const {layoutNodes,normalizeGroupSettings}=require('../lib/canvas-group-layout');

test('derived image prefers a free slot near the parent when the vertical column is crowded',()=>{
 const parent={id:'parent',kind:'generated',x:500,y:400,w:192,h:288};
 const nodes=[parent];
 for(let n=0;n<9;n++){
   nodes.push({id:'below-'+n,x:491,y:722+n*152,w:210,h:118});
   nodes.push({id:'above-'+n,x:491,y:248-n*152,w:210,h:118});
 }
 const pos=placeRelatedImage(nodes,{parentId:'parent',width:210,height:118,gap:34});
 const center=[parent.x+parent.w/2,parent.y+parent.h/2];
 const distance=Math.hypot(pos.x+pos.w/2-center[0],pos.y+pos.h/2-center[1]);
 assert.ok(distance<750,JSON.stringify({distance,pos}));
 for(const node of nodes){
   assert.ok(pos.x+pos.w+14<=node.x||pos.x>=node.x+node.w+14||
       pos.y+pos.h+14<=node.y||pos.y>=node.y+node.h+14,
       'no collision with '+node.id);
 }
});

test('automatic group layout packs images while keeping each member ID stable',()=>{
 const nodes=[
   {id:'a',kind:'generated',x:140,y:300,w:360,h:240},
   {id:'b',kind:'reference',x:510,y:350,w:140,h:280},
   {id:'c',kind:'note',x:720,y:400,w:440,h:320}
 ];
 const cfg=normalizeGroupSettings({layout:'grid',align:'center',columns:3,gap:22,color:'blue'});
 const layout=layoutNodes(nodes,cfg);
 assert.equal(layout.length,3);
 assert.deepEqual(layout.map(x=>x.id),nodes.map(x=>x.id));
 assert.ok(layout[1].x>=layout[0].x+layout[0].w+cfg.gap);
 assert.ok(layout[2].x>=layout[1].x+layout[1].w+cfg.gap);
 assert.ok(layout.every(x=>x.w>=90&&x.h>=90));
});
