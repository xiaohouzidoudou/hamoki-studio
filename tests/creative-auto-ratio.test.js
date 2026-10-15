'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {referenceRatio,dimensions}=require('../lib/creative-auto-ratio');
const png=(w,h)=>{const b=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(w,16);b.writeUInt32BE(h,20);return b};
test('automatic game UI keeps its Word prototype aspect, never defaults to canvas 1:1',()=>{
 assert.deepEqual(referenceRatio(png(394,704)),{ratio:'9:16',width:394,height:704});
 assert.deepEqual(referenceRatio(png(1920,1080)),{ratio:'16:9',width:1920,height:1080});
 assert.deepEqual(referenceRatio(png(512,512)),{ratio:'1:1',width:512,height:512});
 assert.deepEqual(referenceRatio(png(750,1000)),{ratio:'3:4',width:750,height:1000});
});
test('JPEG SOF and WEBP VP8X prototype dimensions are supported',()=>{
 const jpeg=Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08,0x02,0xc0,0x01,0x8a,0x03,0x01,0x11,0x00,0xff,0xd9]);
 assert.deepEqual(dimensions(jpeg),[394,704]);
 const webp=Buffer.alloc(30);webp.write('RIFF',0);webp.write('WEBP',8);webp.write('VP8X',12);webp.writeUIntLE(393,24,3);webp.writeUIntLE(703,27,3);
 assert.equal(referenceRatio(webp).ratio,'9:16');
 assert.throws(()=>referenceRatio(Buffer.from('not an image')),/原型图片尺寸无法识别/);
});
test('real chat flow requests prototype ratio unless user explicitly specifies a ratio',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../assets/creative-workflow-v2.js'),'utf8');
 assert.match(source,/\?\.\[1\]\|\|'reference'/);
 const workspace=fs.readFileSync(path.join(__dirname,'../workspace.js'),'utf8');
 assert.match(workspace,/referenceRatio\(fetchMedia\(proto\.file\)\.bytes\)/);
 assert.match(workspace,/qualityIssues:found\|\|null/);
});
