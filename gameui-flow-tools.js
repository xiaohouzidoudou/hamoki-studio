/* Contextual image actions: real AI job enqueue, real masked edits, honest crop-based UI components. */
'use strict';
(() => {
 const F=()=>window.GameFlow;
 const $=id=>document.getElementById(id);
 const make=(tag,cls,text)=>F().mk(tag,cls,text);
 const icon=name=>F().ico(name);
 const field=(label,element)=>{const wrap=make('div');const title=make('label','form-label',label);wrap.append(title,element);return wrap;};
 const button=(name,text,kind,fn)=>{const b=make('button',kind||'soft-button');b.type='button';b.append(icon(name),make('span','',text));if(fn)b.addEventListener('click',fn);return b;};
 const message=(host,text,bad=false)=>{host.textContent=text;host.style.color=bad?'#ffc2bd':'#a5d4be';};
 function setupDialog(title,eyebrow,intro){const dialog=$('flow-dialog'),body=$('dialog-body'),footer=$('dialog-footer');body.replaceChildren();footer.replaceChildren();$('dialog-title').textContent=title;$('dialog-eyebrow').textContent=eyebrow||'GAME UI WORKFLOW';if(intro)body.append(make('p','dialog-intro',intro));dialog.hidden=false;return {body,footer};}
 function close(){F().closeDialog();}
 function preview(source,title){const root=make('div','dialog-current');const img=make('img');img.src=source;img.alt=title;const info=make('div');info.append(make('strong','',title),make('small','','当前项目中的原始图片会保留，新版本作为子节点自动关联'));root.append(img,info);return root;}
 const option=(value,title)=>{const o=make('option','',title);o.value=value;return o;};
 const getImageData=async imageUrl=>{
  const im=new Image();im.src=imageUrl;await im.decode();const sw=im.naturalWidth,sh=im.naturalHeight;if(!sw||!sh)throw Error('无法读取原始图片');const factor=Math.min(1,1600/Math.max(sw,sh));const width=Math.max(1,Math.round(sw*factor)),height=Math.max(1,Math.round(sh*factor));const source=document.createElement('canvas');source.width=width;source.height=height;source.getContext('2d').drawImage(im,0,0,width,height);const dw=Math.max(75,Math.round(Math.min(500/width,360/height)*width)),dh=Math.max(75,Math.round(dw*height/width));return {source,width,height,dw,dh};
 };
 function openGenerate(node,mode='variation'){
  const f=F(),s=f.state,url=f.getImage(node);if(!url)return f.toast('原图尚未就绪',true);
  const isMask=mode==='mask';if(isMask&&node.kind!=='generated')return f.toast('局部蒙版需要先有一张历史生成图片。可先使用「衍生新版本」。',true);
  const title=isMask?'局部重绘':'衍生新版本';
  const {body,footer}=setupDialog(title,isMask?'MASKED IMAGE EDIT':'IMAGE VARIATION',isMask?
     '在图片上涂抹需要修改的区域。未涂抹部分尽量保持不变，效果取决于中转站及模型；仅兼容支持蒙版编辑的 OpenAI Images 接口。':
     '基于这张游戏 UI 生成新版本，自动继承来源关系。生成走现有队列，不会覆盖原图。');
  body.append(preview(url,f.nodeTitle(node)));
  const prompt=make('textarea','text-area');prompt.rows=3;prompt.maxLength=3000;prompt.placeholder='例如：维持原风格和布局，将右上角商城按钮替换为活动入口…';
  if(!isMask)prompt.value='保留原图的美术风格、角色身份、主要布局和配色，生成一个精致的游戏 UI 衍生版本。';
  body.append(field('修改要求 *',prompt));
  const pair=make('div','dialog-two'),sel=make('select','select-input'),model=make('input','text-input');model.placeholder='例如 gpt-image-1.5';model.maxLength=150;pair.append(field('中转站',sel),field('图片模型 ID',model));body.append(pair);
  const providers=(s.providers||[]).filter(p=>!isMask||(p.mode==='openai'&&(p.imageMode||'images')==='images'));
  if(!providers.length){body.append(make('p','hint',isMask?'没有兼容蒙版编辑的 OpenAI Images 中转站，请先在设置中添加。':'请先在设置中配置生图中转站。'));}
  providers.forEach(p=>sel.append(option(p.id,p.name)));
  sel.value=providers.some(p=>p.id===s.providerId)?s.providerId:providers[0]?.id||'';
  const applyModel=()=>{const p=providers.find(p=>p.id===sel.value);model.value=p?.imageModel||'';};
  sel.addEventListener('change',applyModel);applyModel();
  const settings=make('div','dialog-two'),ratio=make('select','select-input'),res=make('select','select-input');for(const r of ['16:9','1:1','4:3','3:2','9:16','2:3'])ratio.append(option(r,r));ratio.value='16:9';for(const r of ['1K','2K','4K'])res.append(option(r,r));settings.append(field('画面比例',ratio),field('分辨率',res));body.append(settings);
  const hint=make('p','hint',isMask?'画笔涂抹区域会变为透明蒙版，系统同时提交与蒙版相同尺寸的源 PNG。真实编辑可能收费。':'会从当前节点向右生成新版本并自动连接，不需要手工建线。');body.append(hint);
  let mask=null,brushUsed=false;
  if(isMask){
    const status=make('p','hint','正在加载画笔与原图…');body.append(status);
    const stage=make('div','mask-stage');const img=make('img');img.alt='可在上面涂抹修改范围';img.src=url;const overlay=make('canvas');overlay.setAttribute('aria-label','蒙版绘制区');stage.append(img,overlay);body.append(stage);
    const control=make('div','dialog-toolbar');const range=make('input');range.type='range';range.min='8';range.max='100';range.value='34';const label=make('span','','画笔 34px');range.addEventListener('input',()=>label.textContent='画笔 '+range.value+'px');
    const reset=button('refresh','清除涂抹','soft-button');control.append(label,range,reset);body.append(control);
    getImageData(url).then(({source,width,height,dw,dh})=>{
      mask=document.createElement('canvas');mask.width=width;mask.height=height;const context=mask.getContext('2d');context.fillStyle='white';context.fillRect(0,0,width,height);
      stage.style.width=dw+'px';stage.style.height=dh+'px';img.style.width=dw+'px';img.style.height=dh+'px';img.style.maxHeight='none';overlay.width=dw;overlay.height=dh;overlay.style.width=dw+'px';overlay.style.height=dh+'px';
      const view=overlay.getContext('2d');status.textContent='画笔涂抹需要重新生成的区域，点击清除可重画。';let down=false,last=null;
      function paint(ev,begin){const r=overlay.getBoundingClientRect(),p={x:(ev.clientX-r.left)*dw/r.width,y:(ev.clientY-r.top)*dh/r.height};const from=begin||!last?p:last;
        const brush=Number(range.value);
        context.save();context.globalCompositeOperation='destination-out';context.lineWidth=brush*width/dw;context.lineCap='round';context.lineJoin='round';context.beginPath();context.moveTo(from.x*width/dw,from.y*height/dh);context.lineTo(p.x*width/dw,p.y*height/dh);context.stroke();context.beginPath();context.arc(p.x*width/dw,p.y*height/dh,brush/2*width/dw,0,Math.PI*2);context.fill();context.restore();
        view.strokeStyle='rgba(90,255,178,.85)';view.lineWidth=brush;view.lineCap='round';view.beginPath();view.moveTo(from.x,from.y);view.lineTo(p.x,p.y);view.stroke();view.fillStyle='rgba(88,242,161,.50)';view.beginPath();view.arc(p.x,p.y,brush/2,0,2*Math.PI);view.fill();last=p;brushUsed=true;}
      overlay.addEventListener('pointerdown',ev=>{ev.preventDefault();down=true;last=null;overlay.setPointerCapture(ev.pointerId);paint(ev,true);});
      overlay.addEventListener('pointermove',ev=>{if(down)paint(ev,false);});
      const end=()=>{down=false;last=null;};overlay.addEventListener('pointerup',end);overlay.addEventListener('pointercancel',end);
      reset.addEventListener('click',()=>{context.globalCompositeOperation='source-over';context.fillStyle='white';context.fillRect(0,0,width,height);view.clearRect(0,0,dw,dh);brushUsed=false;});
      mask.source=source;
    }).catch(e=>{mask=null;status.textContent='读取图片失败：'+e.message;});
  }
  const back=button('close','取消','soft-button',close),send=button('magic','添加到生图队列','primary-button');footer.append(back,send);
  send.disabled=providers.length===0;
  send.addEventListener('click',async()=>{
    const instruction=prompt.value.trim(),providerId=sel.value,modelId=model.value.trim();
    if(!instruction||!providerId||!modelId)return message(hint,'请填写修改要求、中转站和模型 ID。',true);
    if(isMask&&(!mask||!brushUsed))return message(hint,'请先用画笔标出需要修改的区域。',true);
    const request={projectId:s.id,sourceNodeId:node.id,prompt:instruction,targets:[{providerId,model:modelId}],ratio:ratio.value,resolution:res.value,count:1,quality:'auto',editMode:node.kind==='generated'?'edit':'new'};
    if(node.kind==='generated')request.sourceId=node.historyId;else request.referenceNodes=[{nodeId:node.id,role:'general'}];
    if(isMask){request.mask=mask.toDataURL('image/png');request.maskSourceImage=mask.source.toDataURL('image/png');}
    send.disabled=true;send.querySelector('span').textContent='正在提交…';
    try{await f.api('/api/jobs',f.post(request));close();f.toast('已提交生成队列，完成后自动生成关联版本');}
    catch(e){message(hint,'队列未确认：'+e.message+'。若上游可能已收到请求，请先核对队列，避免重复扣费。',true);}
    finally{send.disabled=false;send.querySelector('span').textContent='添加到生图队列';}
  });
  prompt.focus();
 }
 function openSlices(node){
  const f=F(),url=f.getImage(node);if(!url)return f.toast('原图不存在',true);
  const {body,footer}=setupDialog('UI 素材拆件','UI ASSET EXTRACTION','拖动鼠标框选需要的按钮、角色、图标、背景等区域，可以多选。裁切结果以独立 PNG 保存并连回原图；这里是精确区域提取，不冒充 AI 透明抠图。');
  body.append(preview(url,f.nodeTitle(node)));
  const status=make('p','hint','在图片上拖动可添加拆件区域；也可以先生成 3×2 辅助分区再手动重选。');body.append(status);
  const stage=make('div','slice-stage'),image=make('img');image.src=url;image.alt='需要拆解的游戏 UI';const overlay=make('canvas');stage.append(image,overlay);body.append(stage);
  const controls=make('div','dialog-toolbar');
  const guide=button('board','6 区参考','soft-button'),undo=button('undo','撤销框选','soft-button'),clear=button('trash','清空','soft-button');controls.append(guide,undo,clear);body.append(controls);
  const chips=make('div','slice-list');body.append(chips);
  let source=null,rects=[],active=null,pointer=null;
  function describe(){chips.replaceChildren();for(const [i,r] of rects.entries()){chips.append(make('span','slice-chip','拆件 '+(i+1)+' · '+Math.round(r.w*100)+'% × '+Math.round(r.h*100)+'%'));}status.textContent=rects.length?'已选中 '+rects.length+' 个区域，可继续框选或导出 PNG。':'拖动鼠标框选需要独立保存的素材区域。';}
  function render(){if(!source)return;const ctx=overlay.getContext('2d'),w=overlay.width,h=overlay.height;ctx.clearRect(0,0,w,h);
    const draw=(r,index)=>{ctx.fillStyle='rgba(80,216,166,.16)';ctx.strokeStyle='#7afcbd';ctx.lineWidth=2;ctx.setLineDash(index<0?[4,4]:[]);ctx.fillRect(r.x*w,r.y*h,r.w*w,r.h*h);ctx.strokeRect(r.x*w+.5,r.y*h+.5,r.w*w-1,r.h*h-1);ctx.setLineDash([]);ctx.fillStyle='#8affc2';ctx.font='bold 12px Segoe UI';ctx.fillText('区域 '+(index+1),r.x*w+7,r.y*h+16);};
    rects.forEach(draw);if(active)draw(active,-1);
  }
  function point(ev){const r=overlay.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(ev.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(ev.clientY-r.top)/r.height))};}
  getImageData(url).then(value=>{source=value;const {dw,dh}=value;stage.style.width=dw+'px';stage.style.height=dh+'px';image.style.width=dw+'px';image.style.height=dh+'px';image.style.maxHeight='none';overlay.width=dw;overlay.height=dh;describe();render();
    overlay.addEventListener('pointerdown',ev=>{if(ev.button!==0||rects.length>=12)return;ev.preventDefault();pointer=point(ev);overlay.setPointerCapture(ev.pointerId);});
    overlay.addEventListener('pointermove',ev=>{if(!pointer)return;const to=point(ev);active={x:Math.min(pointer.x,to.x),y:Math.min(pointer.y,to.y),w:Math.abs(pointer.x-to.x),h:Math.abs(pointer.y-to.y)};render();});
    overlay.addEventListener('pointerup',ev=>{if(!pointer)return;const to=point(ev);const r={x:Math.min(pointer.x,to.x),y:Math.min(pointer.y,to.y),w:Math.abs(pointer.x-to.x),h:Math.abs(pointer.y-to.y)};pointer=null;active=null;if(r.w*dw>=12&&r.h*dh>=12)rects.push(r);describe();render();});
    overlay.addEventListener('pointercancel',()=>{pointer=null;active=null;render();});
  }).catch(e=>message(status,'无法加载原图：'+e.message,true));
  guide.addEventListener('click',()=>{if(!source)return;rects=[];for(let row=0;row<2;row++)for(let col=0;col<3;col++)rects.push({x:col/3,y:row/2,w:1/3,h:1/2});describe();render();});
  undo.addEventListener('click',()=>{rects.pop();describe();render();});
  clear.addEventListener('click',()=>{rects=[];describe();render();});
  const back=button('close','取消','soft-button',close),send=button('scissors','保存为拆件素材','primary-button');footer.append(back,send);
  send.addEventListener('click',async()=>{if(!source||!rects.length)return message(status,'请至少框选一个区域。',true);send.disabled=true;send.querySelector('span').textContent='正在裁切…';
    try{const files=[],names=[];let idx=0;for(const r of rects){idx++;const iw=source.width,ih=source.height,sx=Math.max(0,Math.floor(r.x*iw)),sy=Math.max(0,Math.floor(r.y*ih)),sw=Math.min(iw-sx,Math.max(1,Math.round(r.w*iw))),sh=Math.min(ih-sy,Math.max(1,Math.round(r.h*ih)));const c=document.createElement('canvas');c.width=sw;c.height=sh;c.getContext('2d').drawImage(source.source,sx,sy,sw,sh,0,0,sw,sh);const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));if(!blob||blob.size>12*1024*1024)throw Error('第'+idx+'个拆件大于 12MB，请缩小选择范围');files.push(new File([blob],'game-ui-asset-'+idx+'.png',{type:'image/png'}));names.push('拆件 · '+idx);}
      await f.uploadFiles(files,node.id,names);close();f.toast('已将 '+files.length+' 个实际裁切素材加入画布并连接原图');
    }catch(e){message(status,'拆件未完成：'+e.message,true);}finally{send.disabled=false;send.querySelector('span').textContent='保存为拆件素材';}
  });
 }
 window.GameFlowTools={openGenerate,openSlices};
})();