/* Qwen Image Layered UI action for the game-UI workflow. */
'use strict';
(()=>{
 const F=()=>window.GameFlow, $=id=>document.getElementById(id);
 const mk=(tag,cls,text)=>F().mk(tag,cls,text);
 const ico=name=>F().ico(name);
 const field=(label,el)=>{const w=mk('div');w.append(mk('label','form-label',label),el);return w;};
 const btn=(name,text,cls,fn)=>{const b=mk('button',cls);b.type='button';b.append(ico(name),mk('span','',text));if(fn)b.addEventListener('click',fn);return b;};
 const msg=(el,text,bad=false)=>{el.textContent=text;el.style.color=bad?'#ffc2bd':'#a5d4be';};
 function open(node){
  const f=F(),url=f.getImage(node);if(!url)return f.toast('原图不存在',true);
  const dialog=$('flow-dialog'),body=$('dialog-body'),footer=$('dialog-footer');body.replaceChildren();footer.replaceChildren();$('dialog-title').textContent='智能自动拆层';$('dialog-eyebrow').textContent='QWEN IMAGE LAYERED';
  const intro=mk('p','dialog-intro','AI 将整张图分解成独立透明 PNG 图层。原图会保留，结果会作为新节点连接回原图。');body.append(intro);
  const img=mk('img');img.src=url;img.alt='原始游戏 UI';img.style.cssText='width:100%;max-height:190px;object-fit:contain;border-radius:10px';body.append(img);
  const count=mk('select','select-input');[3,4,5,6,8].forEach(n=>{const o=mk('option','',n+' 个图层');o.value=String(n);count.append(o)});count.value='4';
  const prompt=mk('textarea','text-area');prompt.rows=2;prompt.maxLength=500;prompt.placeholder='可选：描述图中的元素和遮挡内容';body.append(field('拆分数量',count),field('图片描述（可选）',prompt));
  const status=mk('p','hint','图片将发送到 Qwen 公开推理端点处理；首次启动可能需要等待。');body.append(status);
  const close=()=>f.closeDialog(),cancel=btn('close','取消','soft-button',close),run=btn('layers','开始智能拆层','primary-button');footer.append(cancel,run);dialog.hidden=false;
  run.addEventListener('click',async()=>{run.disabled=true;run.querySelector('span').textContent='正在拆层…';msg(status,'正在上传原图并等待 Qwen 推理…');
   try{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error('读取原图失败');const blob=await response.blob();const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('读取图片失败'));reader.readAsDataURL(blob)});
    const result=await f.api('/api/layered/decompose',f.post({projectId:f.state.id,parentNodeId:node.id,image:data,layers:Number(count.value),prompt:prompt.value.trim()}));
    await f.loadProject();f.focusNode(node.id);close();f.toast('智能拆层完成，已加入 '+result.count+' 个透明图层');
   }catch(e){msg(status,'拆层失败：'+e.message+'。原图保持不变，不会自动重试。',true);}finally{run.disabled=false;run.querySelector('span').textContent='开始智能拆层';}
  });
 }
 window.addEventListener('DOMContentLoaded',()=>{if(window.GameFlowTools)window.GameFlowTools.openLayered=open;else window.GameFlowTools={openLayered:open};});
})();
