/* Pixel-accurate outpainting layout shared by the browser and tests.
   Source pixels keep their original dimensions; extra pixels are margins. */
'use strict';
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.HamokiOutpaintPlan=api;
})(typeof window==='undefined'?null:window,function(){
  const RATIOS=['1:1','3:2','2:3','16:9','9:16','4:3','3:4'];
  const MAX_PIXELS=3840*2160;
  const ratioValue=s=>Number(s.split(':')[0])/Number(s.split(':')[1]);
  const nearest=(w,h)=>RATIOS.reduce((a,b)=>
    Math.abs(Math.log(ratioValue(b)/(w/h)))<Math.abs(Math.log(ratioValue(a)/(w/h)))?b:a
  );
  const isPreciseModel=model=>/^gpt-image-2(?:[.\-]|$)/i.test(String(model||''));
  const cleanInt=(value,label,min,max)=>{
    const n=Number(value);
    if(!Number.isFinite(n)||n<min||n>max)throw Error(label+'超出范围');
    return Math.round(n);
  };
  function geometry(width,height,amplitude){
    const w=cleanInt(width,'原图宽度',1,8192),h=cleanInt(height,'原图高度',1,8192);
    const m={};
    for(const side of ['left','right','top','bottom'])
      m[side]=cleanInt(amplitude?.[side]||0,side+'扩展幅度',0,200);
    if(!Object.values(m).some(Boolean))throw Error('请至少选择一个扩展方向');
    const left=Math.round(w*m.left/100),right=Math.round(w*m.right/100);
    const top=Math.round(h*m.top/100),bottom=Math.round(h*m.bottom/100);
    return {w,h,left,right,top,bottom,outW:w+left+right,outH:h+top+bottom,margins:m};
  }
  function plan(width,height,amplitude,model){
    if(!/^gpt-image-(?:1|2)(?:$|[.\-])/i.test(String(model||'')))
      throw Error('该模型尚未接入蒙版扩图，不能使用普通图生图代替');
    const g=geometry(width,height,amplitude);
    const precision=isPreciseModel(model);
    let outputWidth,outputHeight,ratio,customSize=null;
    const aspect=g.outW/g.outH;
    if(precision){
      if(aspect>3||aspect<1/3)
        throw Error('扩展后宽高比超过模型 3:1 限制，请降低扩展幅度后分次扩图');
      const factor=1;
      // Prefer rounding OUTWARDS: an added right/left margin must not make
      // the original image a few pixels smaller merely to align to 16px.
      const upW=Math.max(512,Math.ceil(g.outW*factor/16)*16);
      const upH=Math.max(512,Math.ceil(g.outH*factor/16)*16);
      if(upW<=4096&&upH<=4096&&upW*upH<=MAX_PIXELS&&
         upW<=upH*3&&upH<=upW*3){
        outputWidth=upW;outputHeight=upH;
      }else throw Error('原图和扩展区域超出模型尺寸限制；为保留原图像素，请减少扩展幅度或使用更小的原图');
      if(outputWidth*outputHeight>MAX_PIXELS)
        throw Error('扩图像素超出模型限制，请分次扩图');
      if(outputWidth>outputHeight*3||outputHeight>outputWidth*3)
        throw Error('扩展后宽高比超过模型允许范围');
      customSize=outputWidth+'x'+outputHeight;
      ratio=nearest(outputWidth,outputHeight);
    }else{
      const variants=[
        {ratio:'1:1',width:1024,height:1024},
        {ratio:'3:2',width:1536,height:1024},
        {ratio:'2:3',width:1024,height:1536}
      ];
      const fitting=variants.filter(v=>v.width>=g.outW&&v.height>=g.outH);
      if(!fitting.length)throw Error('该模型的固定输出尺寸放不下原图和扩展区域，无法无损扩图');
      const selected=fitting.reduce((a,b)=>
        Math.abs(Math.log((b.width/b.height)/aspect))<
        Math.abs(Math.log((a.width/a.height)/aspect))?b:a
      );
      outputWidth=selected.width;outputHeight=selected.height;ratio=selected.ratio;
    }
    // Fit the entire requested canvas without resizing the source.
    const scale=1;
    const sourceWidth=g.w;
    const sourceHeight=g.h;
    const emptyX=outputWidth-sourceWidth,emptyY=outputHeight-sourceHeight;
    // Keep directional intent: right-only has x=0, left-only anchors right,
    // top-only anchors bottom; extra native-ratio padding follows the same side.
    const x=g.left+g.right?g.left+Math.round((emptyX-g.left-g.right)*g.left/(g.left+g.right)):Math.round(emptyX/2);
    const y=g.top+g.bottom?g.top+Math.round((emptyY-g.top-g.bottom)*g.top/(g.top+g.bottom)):Math.round(emptyY/2);
    if(x<0||y<0||x+sourceWidth>outputWidth||y+sourceHeight>outputHeight)
      throw Error('扩图区域计算失败');
    return {
      width:outputWidth,height:outputHeight,
      original:{x,y,w:sourceWidth,h:sourceHeight},
      ratio,customSize,precision,scale,
      requested:{width:g.outW,height:g.outH,margins:{...g.margins}}
    };
  }
  return {plan,geometry,isPreciseModel};
});
