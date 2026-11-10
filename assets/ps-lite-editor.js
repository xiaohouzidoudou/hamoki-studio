/* Hamoki PS Lite: non-destructive single-image editor (no layers). */
(function(){
'use strict';
const C=(n,a,b)=>Math.max(a,Math.min(b,n)),mk=(t,cls,txt)=>{const x=document.createElement(t);if(cls)x.className=cls;if(txt!==undefined)x.textContent=txt;return x;};
const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const styles=[
'.psl-overlay{position:fixed;inset:0;z-index:2147482000;background:#071016da;backdrop-filter:blur(14px);display:grid;place-items:center;padding:12px;color:#e9f0f3;font:13px system-ui,sans-serif}',
'.psl-app{height:min(900px,96vh);width:min(1390px,98vw);display:flex;flex-direction:column;border-radius:16px;border:1px solid #ffffff36;background:#1c242d;overflow:hidden;box-shadow:0 25px 90px #000a}',
'.psl-head,.psl-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 16px;background:#202b35;border-bottom:1px solid #ffffff20;flex-wrap:wrap}',
'.psl-foot{border-top:1px solid #ffffff20;border-bottom:0}.psl-head strong{font-size:16px}',
'.psl-body{display:grid;grid-template-columns:125px minmax(0,1fr) 220px;flex:1;min-height:0}',
'.psl-tools{display:flex;flex-direction:column;gap:5px;overflow:auto;padding:9px;border-right:1px solid #ffffff22}',
'.psl-canvas-area{display:grid;place-items:center;min-width:0;min-height:0;overflow:auto;padding:16px;background-color:#29323c;background-image:linear-gradient(45deg,#ffffff07 25%,transparent 25%),linear-gradient(-45deg,#ffffff07 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ffffff07 75%),linear-gradient(-45deg,transparent 75%,#ffffff07 75%);background-size:24px 24px;background-position:0 0,0 12px,12px -12px,-12px 0}',
'.psl-stage{position:relative;line-height:0;box-shadow:0 6px 26px #0009;touch-action:none}.psl-stage canvas{display:block;touch-action:none}',
'.psl-marquee{display:none;position:absolute;pointer-events:none;border:1px dashed #fff;outline:1px solid #0008;box-shadow:0 0 0 9999px #0002}',
'.psl-settings{padding:12px;overflow:auto;border-left:1px solid #ffffff20}.psl-settings label{display:flex;justify-content:space-between;gap:7px;margin:12px 0 4px;color:#d0dadf}.psl-settings input[type=range]{width:100%;accent-color:#89d2c7}',
'.psl-app button,.psl-app select,.psl-app input[type=color]{font:inherit;min-height:30px;border-radius:7px;background:#303c48;border:1px solid #ffffff2d;color:#e5f0f3;padding:6px 9px;cursor:pointer}',
'.psl-app button:hover{background:#425563}.psl-app button[aria-pressed=true]{background:#1c5453;border-color:#a5f2e5}.psl-app button:disabled{opacity:.4;cursor:default}',
'.psl-tools button{text-align:left}.psl-primary{background:#77c8bb!important;color:#152f30!important;font-weight:650!important}',
'.psl-options{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:12px 0}.psl-options input[type=color]{width:44px;height:36px;padding:2px}.psl-status{color:#b6c8d1;min-height:18px}.psl-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
'@media(max-width:700px){.psl-body{grid-template-columns:70px minmax(0,1fr);grid-template-rows:minmax(0,1fr) auto}.psl-tools button{font-size:11px;padding:7px 3px}.psl-settings{grid-column:1/3;border-left:0;border-top:1px solid #ffffff20;max-height:180px}.psl-app{height:97vh}}',
'@media(prefers-reduced-motion:reduce){.psl-app *{transition:none!important;animation:none!important}}'
].join('\n');
const ensureCSS=()=>{if(document.getElementById('ps-lite-css'))return;const e=mk('style');e.id='ps-lite-css';e.textContent=styles;document.head.append(e);};
const getImage=url=>new Promise((ok,no)=>{const img=new Image();img.crossOrigin='anonymous';img.onload=()=>ok(img);img.onerror=()=>no(Error('图片加载失败'));img.src=url;});
const toBlob=(c,type,quality)=>new Promise((ok,no)=>c.toBlob(b=>b?ok(b):no(Error('图片导出失败')),type,quality));
function open(opt){
 if(!opt||!opt.url||!opt.onApply)return Promise.reject(Error('缺少图片或保存回调'));
 ensureCSS();
 return new Promise(resolve=>{
  const root=mk('div','psl-overlay'),app=mk('div','psl-app'),head=mk('div','psl-head'),foot=mk('div','psl-foot'),body=mk('div','psl-body'),tools=mk('div','psl-tools'),work=mk('div','psl-canvas-area'),settings=mk('div','psl-settings'),stage=mk('div','psl-stage'),selectMark=mk('div','psl-marquee'),status=mk('span','psl-status','正在载入原图…'),dim=mk('span','psl-status'),actions=mk('div','psl-row'),topActions=mk('div','psl-row');
  const source=canvas(1,1),ctx=source.getContext('2d',{willReadFrequently:true}),view=canvas(1,1),vctx=view.getContext('2d');
  let tool='select',sel=null,drag=null,scale=1,busy=false,loaded=false,done=false;
  let adj={brightness:0,contrast:0,saturation:0,temperature:0,highlights:0,shadows:0};
  const undo=[],redo=[],sliders={},buttons={};
  const btn=(parent,label,act)=>{const b=mk('button',null,label);b.type='button';b.onclick=act;parent.append(b);return b;};
  head.append(mk('strong',null,'图片编辑 · PS Lite'),dim);
  const undoBtn=btn(topActions,'↶ 撤销',()=>history(true)),redoBtn=btn(topActions,'↷ 重做',()=>history(false));
  btn(topActions,'× 关闭',()=>close());head.append(topActions);
  const toolsList=[['select','▧ 选区'],['crop','⌗ 裁剪'],['brush','✎ 画笔'],['eraser','◌ 橡皮擦'],['eyedropper','◉ 吸管'],['text','T 文字'],['rect','□ 矩形'],['ellipse','◯ 圆形'],['line','╱ 直线'],['arrow','↗ 箭头'],['mosaic','▦ 马赛克']];
  toolsList.forEach(([id,label])=>{buttons[id]=btn(tools,label,()=>choose(id));buttons[id].title=label;});
  function choose(t){tool=t;Object.keys(buttons).forEach(k=>buttons[k].setAttribute('aria-pressed',String(k===t)));status.textContent='已选择 '+t;}
  choose('select');
  btn(tools,'↶ 左旋90°',()=>rotate(-1));btn(tools,'↷ 右旋90°',()=>rotate(1));
  btn(tools,'⇋ 水平翻转',()=>flip(true));btn(tools,'⇅ 垂直翻转',()=>flip(false));
  btn(tools,'调整尺寸',resize);
  stage.append(view,selectMark);work.append(stage);
  settings.append(mk('strong',null,'色彩调整'));
  [['brightness','亮度'],['contrast','对比度'],['saturation','饱和度'],['temperature','色温'],['highlights','高光'],['shadows','阴影']].forEach(([k,title])=>{
   const label=mk('label'),val=mk('span',null,'0');label.append(mk('span',null,title),val);
   const input=mk('input');input.type='range';input.min=-100;input.max=100;input.value=0;input.step=1;
   input.oninput=()=>{adj[k]=Number(input.value);val.textContent=input.value;render();};sliders[k]={input,val};settings.append(label,input);
  });
  btn(settings,'重置调色',()=>{adj=Object.fromEntries(Object.keys(adj).map(k=>[k,0]));refreshSliders();render();});
  const optRow=mk('div','psl-options'),color=mk('input'),width=mk('input'),wLabel=mk('span',null,'12px');
  color.type='color';color.value='#ffffff';color.title='画笔颜色';width.type='range';width.min=1;width.max=90;width.value=12;
  width.oninput=()=>wLabel.textContent=width.value+'px';optRow.append('画笔颜色',color,'大小',width,wLabel);settings.append(optRow);
  const cropRow=mk('div','psl-options');
  btn(cropRow,'裁剪选区',()=>{try{cropSelected();}catch(e){status.textContent=e.message;}});
  btn(cropRow,'取消选区',()=>{sel=null;marquee();});settings.append(cropRow);
  const format=mk('select');[['image/png','PNG'],['image/jpeg','JPG'],['image/webp','WebP']].forEach(([v,t])=>{const o=mk('option',null,t);o.value=v;format.append(o);});
  const exportBtn=btn(actions,'下载',download);
  btn(actions,'取消',()=>close());
  const saveBtn=btn(actions,'保存到画布',save);saveBtn.classList.add('psl-primary');
  actions.prepend(format);foot.append(status,actions);body.append(tools,work,settings);app.append(head,body,foot);root.append(app);
  const priorFocus=document.activeElement,oldOverflow=document.body.style.overflow;document.body.style.overflow='hidden';document.body.append(root);app.tabIndex=-1;app.focus();
  function close(success){if(done)return;done=true;document.removeEventListener('keydown',hotkeys,true);document.body.style.overflow=oldOverflow;root.remove();priorFocus?.focus?.();resolve(!!success);}
  function hotkeys(e){if(done)return;if(e.key==='Escape'){e.preventDefault();close();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();history(!e.shiftKey);}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();history(false);}}
  document.addEventListener('keydown',hotkeys,true);
  const snap=()=>({w:source.width,h:source.height,p:ctx.getImageData(0,0,source.width,source.height),adj:{...adj}});
  function remember(){if(!loaded)return;undo.push(snap());if(undo.length>12)undo.shift();redo.length=0;buttonsState();}
  function buttonsState(){undoBtn.disabled=!undo.length;redoBtn.disabled=!redo.length;}
  function refreshSliders(){for(const k in sliders){sliders[k].input.value=adj[k];sliders[k].val.textContent=String(adj[k]);}}
  function restore(s){source.width=s.w;source.height=s.h;ctx.putImageData(s.p,0,0);adj={...s.adj};refreshSliders();sel=null;render();}
  function history(isUndo){const from=isUndo?undo:redo,to=isUndo?redo:undo;if(!from.length)return;to.push(snap());restore(from.pop());buttonsState();}
  function finalCanvas(){
   const out=canvas(source.width,source.height),o=out.getContext('2d',{willReadFrequently:true});o.drawImage(source,0,0);
   if(Object.values(adj).every(v=>v===0))return out;
   const im=o.getImageData(0,0,out.width,out.height),d=im.data;
   const contrast=(100+adj.contrast)/100,sat=(100+adj.saturation)/100;
   for(let i=0;i<d.length;i+=4){if(!d[i+3])continue;
    const lum=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];
    const tonal=lum>128?(lum-128)/127*adj.highlights*.34:(128-lum)/128*adj.shadows*.34;
    let r=(d[i]-128)*contrast+128+adj.brightness*1.4+adj.temperature*.75+tonal;
    let g=(d[i+1]-128)*contrast+128+adj.brightness*1.4+tonal;
    let b=(d[i+2]-128)*contrast+128+adj.brightness*1.4-adj.temperature*.75+tonal;
    const gray=.2126*r+.7152*g+.0722*b;
    d[i]=C(gray+(r-gray)*sat,0,255);d[i+1]=C(gray+(g-gray)*sat,0,255);d[i+2]=C(gray+(b-gray)*sat,0,255);
   }o.putImageData(im,0,0);return out;
  }
  function marquee(){
   if(!sel){selectMark.style.display='none';return;}
   const x=Math.min(sel.x,sel.x2),y=Math.min(sel.y,sel.y2),w=Math.abs(sel.x2-sel.x),h=Math.abs(sel.y2-sel.y);
   Object.assign(selectMark.style,{display:'block',left:x*scale+'px',top:y*scale+'px',width:w*scale+'px',height:h*scale+'px'});
  }
  function render(){
   if(!loaded)return;
   view.width=source.width;view.height=source.height;vctx.clearRect(0,0,view.width,view.height);vctx.drawImage(finalCanvas(),0,0);
   scale=Math.min(1.4,Math.max(.01,(work.clientWidth-48)/source.width),Math.max(.01,(work.clientHeight-48)/source.height));
   if(source.width*scale>work.clientWidth-32||source.height*scale>work.clientHeight-32)scale=Math.min((work.clientWidth-48)/source.width,(work.clientHeight-48)/source.height);
   const w=Math.max(1,Math.round(source.width*scale)),h=Math.max(1,Math.round(source.height*scale));
   view.style.width=w+'px';view.style.height=h+'px';stage.style.width=w+'px';stage.style.height=h+'px';dim.textContent=source.width+' × '+source.height+'px';
   marquee();
  }
  function transform(fn,w,h){if(!loaded)return;remember();const before=canvas(source.width,source.height);before.getContext('2d').drawImage(source,0,0);source.width=w||before.width;source.height=h||before.height;fn(before);sel=null;render();}
  function rotate(sign){transform(old=>{ctx.save();ctx.translate(source.width/2,source.height/2);ctx.rotate(sign*Math.PI/2);ctx.drawImage(old,-old.width/2,-old.height/2);ctx.restore();},source.height,source.width);}
  function flip(horizontal){transform(old=>{ctx.save();if(horizontal){ctx.translate(source.width,0);ctx.scale(-1,1);}else{ctx.translate(0,source.height);ctx.scale(1,-1);}ctx.drawImage(old,0,0);ctx.restore();});}
  function resize(){
   const value=prompt('输入新尺寸 宽x高',source.width+'x'+source.height);if(!value)return;
   const m=value.trim().match(/^(\d+)\s*[x×,]\s*(\d+)$/);if(!m){status.textContent='格式示例：1920x1080';return;}
   const w=+m[1],h=+m[2];if(w<8||h<8||w>8192||h>8192||w*h>32000000){status.textContent='尺寸超出范围';return;}
   transform(old=>{ctx.imageSmoothingQuality='high';ctx.drawImage(old,0,0,w,h);},w,h);
  }
  function cropSelected(){
   if(!sel)throw Error('请先框选裁剪区域');const x=Math.round(Math.min(sel.x,sel.x2)),y=Math.round(Math.min(sel.y,sel.y2)),w=Math.round(Math.abs(sel.x2-sel.x)),h=Math.round(Math.abs(sel.y2-sel.y));
   if(w<8||h<8)throw Error('裁剪区域至少8×8像素');remember();const data=ctx.getImageData(x,y,w,h);source.width=w;source.height=h;ctx.putImageData(data,0,0);sel=null;render();
  }
  function pos(e){const rect=view.getBoundingClientRect();return{x:C((e.clientX-rect.left)/rect.width*source.width,0,source.width),y:C((e.clientY-rect.top)/rect.height*source.height,0,source.height)};}
  function stroke(a,b){
   ctx.save();ctx.lineWidth=Number(width.value);ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=color.value;ctx.fillStyle=color.value;
   if(tool==='eraser')ctx.globalCompositeOperation='destination-out';
   if(sel){ctx.beginPath();ctx.rect(Math.min(sel.x,sel.x2),Math.min(sel.y,sel.y2),Math.abs(sel.x-sel.x2),Math.abs(sel.y-sel.y2));ctx.clip();}
   ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.restore();
  }
  function shape(a,b,t){
   ctx.save();ctx.lineWidth=Number(width.value);ctx.strokeStyle=color.value;ctx.fillStyle=color.value;ctx.lineJoin='round';
   const dx=b.x-a.x,dy=b.y-a.y;ctx.beginPath();
   if(t==='rect')ctx.strokeRect(a.x,a.y,dx,dy);
   else if(t==='ellipse'){ctx.ellipse((a.x+b.x)/2,(a.y+b.y)/2,Math.max(1,Math.abs(dx)/2),Math.max(1,Math.abs(dy)/2),0,0,2*Math.PI);ctx.stroke();}
   else if(t==='mosaic'){const x=Math.round(Math.min(a.x,b.x)),y=Math.round(Math.min(a.y,b.y)),w=Math.max(1,Math.round(Math.abs(dx))),h=Math.max(1,Math.round(Math.abs(dy))),small=canvas(Math.max(1,Math.round(w/12)),Math.max(1,Math.round(h/12)));small.getContext('2d').drawImage(source,x,y,w,h,0,0,small.width,small.height);ctx.imageSmoothingEnabled=false;ctx.drawImage(small,0,0,small.width,small.height,x,y,w,h);ctx.imageSmoothingEnabled=true;}
   else{ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();if(t==='arrow'){const ang=Math.atan2(dy,dx),sz=Math.max(10,Number(width.value)*2.7);ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-sz*Math.cos(ang-.45),b.y-sz*Math.sin(ang-.45));ctx.lineTo(b.x-sz*Math.cos(ang+.45),b.y-sz*Math.sin(ang+.45));ctx.closePath();ctx.fill();}}
   ctx.restore();
  }
  view.addEventListener('pointerdown',e=>{
   if(!loaded||busy)return;const p=pos(e);
   if(tool==='eyedropper'){const col=ctx.getImageData(Math.min(source.width-1,Math.floor(p.x)),Math.min(source.height-1,Math.floor(p.y)),1,1).data;color.value='#'+[col[0],col[1],col[2]].map(v=>v.toString(16).padStart(2,'0')).join('');status.textContent='吸取颜色：'+color.value;return;}
   if(tool==='text'){const t=prompt('输入文字');if(!t)return;remember();ctx.save();ctx.fillStyle=color.value;ctx.font=Math.max(14,Number(width.value)*2)+'px system-ui,sans-serif';ctx.textBaseline='top';t.split('\n').slice(0,10).forEach((v,i)=>ctx.fillText(v,p.x,p.y+i*Math.max(17,Number(width.value)*2.6)));ctx.restore();render();return;}
   if(!['select','crop'].includes(tool))remember();
   drag={start:p,last:p,tool,original:['rect','ellipse','line','arrow','mosaic'].includes(tool)?ctx.getImageData(0,0,source.width,source.height):null};
   if(['brush','eraser'].includes(tool))stroke(p,p);
   try{view.setPointerCapture(e.pointerId);}catch(_){}
   e.preventDefault();
  });
  view.addEventListener('pointermove',e=>{
   if(!drag)return;const p=pos(e);
   if(['select','crop'].includes(drag.tool)){sel={x:drag.start.x,y:drag.start.y,x2:p.x,y2:p.y};marquee();}
   else if(['brush','eraser'].includes(drag.tool)){stroke(drag.last,p);drag.last=p;render();}
   else if(drag.original){ctx.putImageData(drag.original,0,0);shape(drag.start,p,drag.tool);render();}
  });
  function endPointer(e){if(!drag)return;const p=pos(e);if(['select','crop'].includes(drag.tool)){sel={x:drag.start.x,y:drag.start.y,x2:p.x,y2:p.y};marquee();}
   else if(['brush','eraser'].includes(drag.tool)){stroke(drag.last,p);render();}
   else if(drag.original){ctx.putImageData(drag.original,0,0);shape(drag.start,p,drag.tool);render();}
   drag=null;}
  view.addEventListener('pointerup',endPointer);view.addEventListener('pointercancel',endPointer);
  async function blobFor(type){
   const c=finalCanvas();if(type==='image/jpeg'){const o=canvas(c.width,c.height),cx=o.getContext('2d');cx.fillStyle='#fff';cx.fillRect(0,0,o.width,o.height);cx.drawImage(c,0,0);return toBlob(o,type,.92);}return toBlob(c,type,.92);
  }
  async function download(){if(!loaded)return;try{const type=format.value,blob=await blobFor(type),link=URL.createObjectURL(blob),a=mk('a');a.href=link;a.download='hamoki-edited.'+({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[type]);a.click();setTimeout(()=>URL.revokeObjectURL(link),1200);status.textContent='导出成功';}catch(e){status.textContent=e.message;}}
  async function save(){if(!loaded||busy)return;busy=true;saveBtn.disabled=true;status.textContent='保存新图片中…';try{const blob=await blobFor('image/png');await opt.onApply({blob,width:source.width,height:source.height});close(true);}catch(e){status.textContent='保存失败：'+e.message;busy=false;saveBtn.disabled=false;}}
  getImage(opt.url).then(img=>{if(done)return;if(img.naturalWidth*img.naturalHeight>32000000)throw Error('图片尺寸过大，请先使用裁剪工具');source.width=img.naturalWidth;source.height=img.naturalHeight;ctx.drawImage(img,0,0);loaded=true;render();buttonsState();status.textContent='本地编辑，不消耗 Token；保存时创建新图片，原图不变。';}).catch(e=>{status.textContent=e.message;saveBtn.disabled=true;});
  window.addEventListener('resize',()=>{if(!done)render();},{once:true});
 });
}
window.HamokiPsLite={open};
})();