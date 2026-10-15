'use strict';
// Resolve the exact existing Word prototype's dimensions before submitting a paid
// image job; the ordinary canvas's 1:1 default must not override a portrait UI.
const ratios={'1:1':1,'3:2':3/2,'2:3':2/3,'16:9':16/9,'9:16':9/16,'4:3':4/3,'3:4':3/4};
function dimensions(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<12)return null;
 const png=Buffer.from([137,80,78,71,13,10,26,10]);
 if(bytes.length>=24&&bytes.subarray(0,8).equals(png)){
  return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
 }
 if(bytes[0]===0xff&&bytes[1]===0xd8){
  for(let i=2;i+10<bytes.length;){
   if(bytes[i]!==0xff){i++;continue}
   while(i<bytes.length&&bytes[i]===0xff)i++;
   const marker=bytes[i++];
   if(marker===0xd9||marker===0xda)break;
   if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
   if(i+2>bytes.length)break;
   const len=bytes.readUInt16BE(i);
   if(len<2||i+len>bytes.length)break;
   if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&len>=7)
    return [bytes.readUInt16BE(i+5),bytes.readUInt16BE(i+3)];
   i+=len;
  }
 }
 if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&bytes.length>=30){
  const kind=bytes.toString('ascii',12,16);
  if(kind==='VP8X')return [bytes.readUIntLE(24,3)+1,bytes.readUIntLE(27,3)+1];
  if(kind==='VP8 '&&bytes.length>=30)return [bytes.readUInt16LE(26)&0x3fff,bytes.readUInt16LE(28)&0x3fff];
  if(kind==='VP8L'&&bytes.length>=25){
   const bits=bytes.readUInt32LE(21);
   return [(bits&0x3fff)+1,((bits>>14)&0x3fff)+1];
  }
 }
 return null;
}
function referenceRatio(bytes){
 const size=dimensions(bytes);
 if(!size||!size.every(x=>Number.isInteger(x)&&x>0&&x<=50000))throw Error('原型图片尺寸无法识别，请明确指定画幅比例再生图');
 const [width,height]=size,exact=width/height;
 const ratio=Object.keys(ratios).reduce((best,r)=>Math.abs(Math.log(ratios[r]/exact))<Math.abs(Math.log(ratios[best]/exact))?r:best,'1:1');
 return {ratio,width,height};
}
module.exports={dimensions,referenceRatio};
