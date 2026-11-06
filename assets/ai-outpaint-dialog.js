/* Dedicated AI outpainting dialog. Uses the existing paid generation queue,
   original image source and parent-node lineage; never paints a local result. */
'use strict';
(() => {
  const RATIOS=['1:1','3:2','2:3','16:9','9:16','4:3','3:4'];
  const SIDES=[['left','左'],['right','右'],['top','上'],['bottom','下']];
  const DEFAULT_PROMPT='保留参考原图中现有的主体、人物特征、文字、构图重点和艺术风格，只向指定方向自然补画新的场景。新旧区域在光线、透视、色彩及纹理上无缝连续；禁止简单拉伸原图、复制边缘或添加纯色边框。';
  const nearest=(w,h)=>RATIOS.reduce((a,b)=>{
    const value=s=>Number(s.split(':')[0])/Number(s.split(':')[1]);
    return Math.abs(Math.log(value(b)/(w/h)))<Math.abs(Math.log(value(a)/(w/h)))?b:a;
  });
  let active=null;
  const el=(tag,cls,text)=>{
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    if(text!==undefined)node.textContent=String(text);
    return node;
  };
  function open(config) {
    if(active)active.close();
    if(!config?.sourceUrl||typeof config.onGenerate!=='function')throw Error('缺少扩图原图或生成接口');
    const providers=(config.getProviders?.()||[]).filter(p=>p?.id);
    const selectedAtOpen=config.getProviderId?.()||'';
    let sourceW=Number(config.sourceWidth)||0,sourceH=Number(config.sourceHeight)||0;
    let margins={left:40,right:0,top:0,bottom:0},files=[],waiting=false;
    const previousFocus=document.activeElement;
    const root=el('div','haop-backdrop');
    root.innerHTML=
      '<section class="haop-dialog" role="dialog" aria-modal="true" aria-labelledby="haop-title">'+
        '<header class="haop-header"><div class="haop-heading"><small>AI IMAGE OUTPAINTING</small>'+
          '<h2 id="haop-title">AI 扩图</h2><p>选择扩展方向与幅度，再补充提示词。原图内容保持不变。</p></div>'+
          '<button class="haop-close" type="button" aria-label="关闭扩图窗口">×</button></header>'+
        '<div class="haop-main"><section class="haop-left">'+
          '<div class="haop-section-head"><strong>扩图预览</strong><span class="haop-dimensions">读取原图中…</span></div>'+
          '<div class="haop-stage"><div class="haop-preview"><img alt="原始图片预览" class="haop-image"><div class="haop-preview-hint" aria-hidden="true" hidden></div></div></div>'+
          '<p class="haop-caption">虚线框为扩展边界，透明部分由 AI 补画。</p>'+
          '<div class="haop-section-head"><strong>扩展方向</strong><span>可以选择多个方向</span></div>'+
          '<div class="haop-presets" role="group" aria-label="扩图方向">'+
            '<button type="button" data-preset="all">四周</button>'+
            '<button type="button" data-preset="left">向左</button>'+
            '<button type="button" data-preset="right">向右</button>'+
            '<button type="button" data-preset="top">向上</button>'+
            '<button type="button" data-preset="bottom">向下</button></div>'+
          '<div class="haop-amplitude"><div class="haop-amplitude-head"><strong>扩展幅度</strong><span>自定义百分比 · 实时更新预览</span></div><div class="haop-sides"></div></div>'+
        '</section><section class="haop-right">'+
          '<div class="haop-section-head"><strong>参考图片</strong><span>最多再添加 4 张</span></div>'+
          '<div class="haop-references"><div class="haop-source"><img class="haop-source-img" alt="本次扩图原图"><span>原图 · 必选</span></div>'+
          '<div class="haop-extra-refs"></div><button type="button" class="haop-addref">＋ 添加参考图</button></div>'+
          '<input type="file" class="haop-files" accept="image/png,image/jpeg,image/webp" multiple hidden>'+
          '<label class="haop-prompt-label" for="haop-prompt">扩图提示词 <span>可直接修改</span></label>'+
          '<textarea id="haop-prompt" class="haop-prompt" maxlength="950" spellcheck="false"></textarea>'+
          '<div class="haop-plan" role="status"></div>'+
          '<div class="haop-inherit"><div><strong>生图设置</strong><span class="haop-inherit-badge">跟随原图</span></div>'+
            '<label class="haop-model-label" for="haop-model-select">生图模型</label>'+
            '<div class="haop-model-row"><select class="haop-model-select" id="haop-model-select" aria-label="扩图模型，默认跟随原图"></select>'+
              '<button type="button" class="haop-model-fetch" title="获取当前原图中转商可用的模型">获取</button></div>'+
            '<input type="text" class="haop-model-custom" maxlength="120" placeholder="输入生图模型 ID" aria-label="自定义生图模型 ID" hidden>'+
            '<p class="haop-model-note">默认跟随原图模型。中转站和模型需支持 Images Edits 透明蒙版及指定尺寸；兼容接口不代表已验证，生成可能扣费。</p></div>'+
        '</section></div>'+
        '<footer class="haop-footer"><p class="haop-error" role="alert" hidden></p>'+
          '<div class="haop-foot-actions"><span>生成图与原图建立关联，在画布下方显示。</span>'+
            '<button class="haop-cancel" type="button">取消</button>'+
            '<button class="haop-submit" type="button">生成扩图 <span aria-hidden="true">↗</span></button></div></footer>'+
      '</section>';
    const $=s=>root.querySelector(s);
    const $$=s=>[...root.querySelectorAll(s)];
    document.body.append(root);
    document.body.classList.add('haop-open');
    window.HamokiGlobalBorderTrace?.pause?.();
    const preview=$('.haop-preview'),previewImage=$('.haop-image');
    const submit=$('.haop-submit'),message=$('.haop-error'),prompt=$('.haop-prompt');
    let lastPreset='left';
    function alertUser(msg){
      message.textContent=msg||'';
      message.hidden=!msg;
    }
    function close(){
      if(waiting)return;
      root.remove();
      for(const file of files)URL.revokeObjectURL(file.url);
      document.removeEventListener('keydown',onKey,true);
      window.removeEventListener('resize',onResize);
      document.body.classList.remove('haop-open');
      window.HamokiGlobalBorderTrace?.resume?.();
      if(active?.close===close)active=null;
      if(previousFocus?.isConnected)previousFocus.focus();
    }
    active={close};
    function onKey(ev){
      if(ev.key==='Escape'){ev.preventDefault();ev.stopPropagation();close();}
      if(ev.key==='Tab'){
        const focusables=$$('button:not(:disabled),input:not(:disabled):not([hidden]),select:not(:disabled),textarea:not(:disabled)')
          .filter(n=>n.getClientRects().length);
        if(!focusables.length)return;
        if(ev.shiftKey&&document.activeElement===focusables[0]){ev.preventDefault();focusables.at(-1).focus();}
        else if(!ev.shiftKey&&document.activeElement===focusables.at(-1)){ev.preventDefault();focusables[0].focus();}
      }
    }
    document.addEventListener('keydown',onKey,true);
    $('.haop-close').onclick=close;
    $('.haop-cancel').onclick=close;
    root.addEventListener('pointerdown',ev=>{if(ev.target===root)close();});
    const sourceImage=$('.haop-source-img');
    sourceImage.src=previewImage.src=config.sourceUrl;
    previewImage.onload=()=>{
      sourceW=previewImage.naturalWidth||sourceW;
      sourceH=previewImage.naturalHeight||sourceH;
      update();
    };
    previewImage.onerror=()=>alertUser('原图预览读取失败，请确认该图片仍然存在。');
    prompt.value=DEFAULT_PROMPT;
    // Always use the current source image's provider/model for outpainting.
    const selectedProvider=providers.find(p=>p.id===selectedAtOpen)||(!selectedAtOpen?providers[0]:null);
    const selectedModel=String(config.getModel?.()||selectedProvider?.imageModel||'').trim();
    const inheritedResolution=['1K','2K','4K'].includes(config.resolution)?config.resolution:'1K';
    const inheritedQuality=['auto','low','medium','high'].includes(config.quality)?config.quality:'auto';
    const modelSelect=$('.haop-model-select');
    const modelCustom=$('.haop-model-custom');
    const modelFetch=$('.haop-model-fetch');
    const modelNote=$('.haop-model-note');
    const modelBadge=$('.haop-inherit-badge');
    const FOLLOW='__follow__',MANUAL='__manual__';
    const availableModels=new Set([selectedModel,selectedProvider?.imageModel].filter(Boolean));
    function renderModels(extra=[]){
      const previous=modelSelect.value||FOLLOW;
      for(const item of extra){
        if(typeof item==='string'&&item.trim())availableModels.add(item.trim());
      }
      modelSelect.replaceChildren();
      modelSelect.add(new Option('跟随原图 · '+(selectedModel||'未记录模型'),FOLLOW));
      for(const value of availableModels)modelSelect.add(new Option(value,value));
      modelSelect.add(new Option('手动输入模型 ID…',MANUAL));
      modelSelect.value=[...modelSelect.options].some(opt=>opt.value===previous)?previous:FOLLOW;
      updateModelState();
    }
    function updateModelState(){
      modelCustom.hidden=modelSelect.value!==MANUAL;
      modelBadge.textContent=modelSelect.value===FOLLOW?'跟随原图':'已手动选择';
      if(!modelCustom.hidden&&!modelCustom.value)modelCustom.placeholder='输入生图模型 ID';
    }
    function modelNow(){
      return modelSelect.value===FOLLOW?selectedModel:
        (modelSelect.value===MANUAL?modelCustom.value.trim():modelSelect.value);
    }
    modelSelect.addEventListener('change',()=>{
      updateModelState();
      if(!modelCustom.hidden)modelCustom.focus();
    });
    renderModels();
    async function fetchModels(){
      if(!selectedProvider?.id){
        modelNote.textContent='原图中转商不可用，无法获取模型。';
        return;
      }
      modelFetch.disabled=true;modelFetch.textContent='获取中';
      try{
        const response=await fetch('/api/models?providerId='+encodeURIComponent(selectedProvider.id),{cache:'no-store'});
        const data=await response.json().catch(()=>({}));
        if(!response.ok)throw Error(data.error||'模型列表读取失败');
        const ids=Array.isArray(data.models)?data.models.filter(m=>typeof m==='string'&&m.trim()):[];
        if(!ids.length)throw Error('没有返回模型');
        const images=ids.filter(m=>/image|flux|banana|seedream|dall-e|qwen.*img|imagen|hidream|z-image/i.test(m));
        const items=(images.length?images:ids).slice(0,140);
        renderModels(items);
        modelNote.textContent='可选模型已更新；模型和中转站必须支持透明蒙版及指定尺寸，兼容性尚需验证。';
      }catch(err){
        modelNote.textContent='模型列表暂不可用，可手动输入；中转站须支持透明蒙版及指定尺寸。';
      }finally{
        if(root.isConnected){modelFetch.disabled=false;modelFetch.textContent='获取';}
      }
    }
    modelFetch.addEventListener('click',()=>{void fetchModels();});
    void fetchModels();
    const sidesBox=$('.haop-sides');
    for(const [key,title] of SIDES){
      const label=el('label','haop-side-input');
      const txt=el('span','',title+'扩');
      const row=el('div','haop-side-value');
      const field=el('input');
      field.type='number';field.min='0';field.max='200';field.step='1';field.inputMode='numeric';
      field.value=margins[key];field.dataset.side=key;
      field.setAttribute('aria-label',title+'侧扩展百分比');
      field.oninput=()=>{
        if(field.value.trim()==='')return;
        const v=Number(field.value);
        if(Number.isFinite(v)){
          margins[key]=Math.min(200,Math.max(0,Math.round(v)));
          lastPreset='custom';update();
        }
      };
      field.onchange=()=>{
        const v=Number(field.value);
        margins[key]=Number.isFinite(v)?Math.min(200,Math.max(0,Math.round(v))):0;
        field.value=String(margins[key]);
        lastPreset='custom';update();
      };
      const stepper=el('span','haop-stepper');
      for(const [delta,name,path] of [
        [1,'增加','m7 14 5-5 5 5'],
        [-1,'减少','m7 10 5 5 5-5']
      ]){
        const step=el('button','haop-step '+(delta>0?'haop-step-up':'haop-step-down'));
        step.type='button';step.setAttribute('aria-label',name+title+'侧扩展百分比');
        step.setAttribute('title',name+' 1%');
        step.setAttribute('data-hm-no-border-trace','');
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
        svg.setAttribute('viewBox','0 0 24 24');
        svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');
        svg.setAttribute('stroke-width','2.4');svg.setAttribute('stroke-linecap','round');
        svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
        const stroke=document.createElementNS('http://www.w3.org/2000/svg','path');
        stroke.setAttribute('d',path);svg.append(stroke);step.append(svg);
        step.addEventListener('click',()=>{
          margins[key]=Math.min(200,Math.max(0,margins[key]+delta));
          field.value=String(margins[key]);lastPreset='custom';update();field.focus();
        });
        stepper.append(step);
      }
      row.append(field,el('span','haop-unit','%'),stepper);
      label.append(txt,row);sidesBox.append(label);
    }
    const presets={
      all:{left:25,right:25,top:20,bottom:20},
      left:{left:40,right:0,top:0,bottom:0},
      right:{left:0,right:40,top:0,bottom:0},
      top:{left:0,right:0,top:40,bottom:0},
      bottom:{left:0,right:0,top:0,bottom:40}
    };
    for(const b of $$('.haop-presets button')){
      b.onclick=()=>{
        margins={...presets[b.dataset.preset]};
        lastPreset=b.dataset.preset;
        for(const field of $$('.haop-sides input'))field.value=margins[field.dataset.side];
        update();
      };
    }
    function geometry(){
      const w=sourceW||1024,h=sourceH||1024;
      const left=Math.round(w*margins.left/100),right=Math.round(w*margins.right/100);
      const top=Math.round(h*margins.top/100),bottom=Math.round(h*margins.bottom/100);
      return {w,h,left,right,top,bottom,outW:w+left+right,outH:h+top+bottom};
    }
    function update(){
      const g=geometry();
      preview.style.aspectRatio=String(g.outW)+' / '+String(g.outH);
      const stage=$('.haop-stage');
      const scale=Math.min(465/g.outW,(Math.max(180,stage.clientWidth)-32)/g.outW,
        (Math.max(180,stage.clientHeight)-30)/g.outH);
      preview.style.width=Math.max(1,Math.round(g.outW*scale))+'px';
      preview.style.height=Math.max(1,Math.round(g.outH*scale))+'px';
      previewImage.style.left=(g.left/g.outW*100)+'%';
      previewImage.style.top=(g.top/g.outH*100)+'%';
      previewImage.style.width=(g.w/g.outW*100)+'%';
      previewImage.style.height=(g.h/g.outH*100)+'%';
      let targetNote='';
      try{
        const plan=window.HamokiOutpaintPlan?.plan(g.w,g.h,margins,modelNow());
        if(plan)targetNote=' · 输出 '+plan.width+' × '+plan.height;
      }catch(error){targetNote=' · '+error.message;}
      $('.haop-dimensions').textContent='原图 '+g.w+' × '+g.h+' → 预览 '+g.outW+' × '+g.outH+targetNote;
      const directions=SIDES.filter(([id])=>margins[id]>0).map(([id,title])=>title+' '+margins[id]+'%');
      const hint=$('.haop-preview-hint');
      if(directions.length){
        const largest=SIDES.reduce((best,[id,title])=>
          margins[id]>margins[best[0]]?[id,title]:best,SIDES[0]);
        const [side,title]=largest;
        const room=side==='left'?g.left:side==='right'?g.right:side==='top'?g.top:g.bottom;
        hint.hidden=room*scale<48;
        hint.textContent='向'+title+' '+margins[side]+'%';
        let x=g.left+g.w/2,y=g.top+g.h/2;
        if(side==='left')x=g.left/2;
        if(side==='right')x=g.left+g.w+g.right/2;
        if(side==='top')y=g.top/2;
        if(side==='bottom')y=g.top+g.h+g.bottom/2;
        hint.style.left=(x/g.outW*100)+'%';
        hint.style.top=(y/g.outH*100)+'%';
      }else hint.hidden=true;
      $('.haop-plan').textContent=directions.length
        ?'本次扩展：'+directions.join('、')+' · 新画面由 AI 生成'
        :'请至少设置一个方向的扩展幅度。';
      submit.disabled=waiting||!directions.length;
      for(const b of $$('.haop-presets button'))b.classList.toggle('active',b.dataset.preset===lastPreset);
    }
    update();
    function renderExtra(){
      const holder=$('.haop-extra-refs');holder.replaceChildren();
      for(const ref of files){
        const tile=el('div','haop-extra-tile');
        const image=el('img');image.alt=ref.file.name;image.src=ref.url;
        const del=el('button','','×');
        del.type='button';del.title='移除 '+ref.file.name;
        del.setAttribute('aria-label','移除参考图 '+ref.file.name);
        del.onclick=()=>{
          files=files.filter(r=>r!==ref);
          URL.revokeObjectURL(ref.url);renderExtra();
        };
        tile.append(image,del);holder.append(tile);
      }
      $('.haop-addref').disabled=files.length>=4;
    }
    function addFiles(list){
      for(const file of list){
        if(files.length>=4){alertUser('最多添加 4 张其他参考图（原图固定占 1 张）');break;}
        if(!['image/png','image/jpeg','image/webp'].includes(file.type)||!file.size||file.size>12*1024*1024){
          alertUser('仅支持每张不超过 12MB 的 PNG、JPG 或 WebP 图片');continue;
        }
        if(files.reduce((sum,r)=>sum+r.file.size,0)+file.size>40*1024*1024){
          alertUser('其他参考图合计不能超过 40MB');break;
        }
        files.push({file,url:URL.createObjectURL(file)});
      }
      renderExtra();
    }
    $('.haop-addref').onclick=()=>$('.haop-files').click();
    $('.haop-files').onchange=ev=>{addFiles(ev.target.files);ev.target.value='';};
    root.addEventListener('paste',ev=>{
      const incoming=[...(ev.clipboardData?.files||[])].filter(f=>f.type.startsWith('image/'));
      if(incoming.length){ev.preventDefault();addFiles(incoming);}
    });
    const send=async()=>{
      if(waiting)return;
      alertUser('');
      if(!sourceW||!sourceH)return alertUser('原图尚未加载完成');
      if(SIDES.every(([id])=>!margins[id]))return alertUser('请至少选择一个扩展方向');
      const instructions=prompt.value.trim();
      if(!instructions)return alertUser('请填写扩图提示词');
      const p=selectedProvider;
      if(!p)return alertUser('请先配置中转商');
      if(p.hasKey===false)return alertUser('所选中转商没有可用的 API Key');
      if(p.mode!=='openai'||(p.imageMode||'images')!=='images')
        return alertUser('真正的扩图需要支持透明蒙版的 OpenAI Images Edits 模型；请切换相应的中转商');
      const model=modelNow();
      if(!model)return alertUser('请先选择或填写生图模型 ID');
      const g=geometry();
      let layout;
      try{
        layout=window.HamokiOutpaintPlan.plan(g.w,g.h,margins,model);
      }catch(error){return alertUser('无法扩图：'+error.message);}
      const directions=SIDES.filter(([id])=>margins[id]>0).map(([id,title])=>title+'侧 '+margins[id]+'%').join('、');
      const rect=layout.original;
      const spec='【精准蒙版扩图】随请求附上了透明外围画布与对应蒙版。原图完整保留在画布坐标 ('+rect.x+','+rect.y+') 的 '+rect.w+'×'+rect.h+' 区域中，不得修改或拉伸该区域。只补画外侧透明的 '+directions+'，新画面应与原图边缘自然衔接。最终画布为 '+layout.width+'×'+layout.height+' 像素，必须保持原图主体大小和比例不变。';
      let finalPrompt=instructions+'\n\n'+spec;
      if(finalPrompt.length>1000)return alertUser('提示词与扩图参数合计超出 1000 字，请精简提示词');
      waiting=true;submit.disabled=true;submit.textContent='正在提交…';
      $('.haop-cancel').disabled=$('.haop-close').disabled=true;
      try{
        // A real image edit: transparent margins are the only writable area.
        // Both canvases are precisely the output size, with equal X/Y scale.
        const sourceCanvas=document.createElement('canvas');
        sourceCanvas.width=layout.width;sourceCanvas.height=layout.height;
        const sourceContext=sourceCanvas.getContext('2d',{willReadFrequently:false});
        if(!sourceContext)throw Error('浏览器无法创建扩图画布');
        sourceContext.clearRect(0,0,layout.width,layout.height);
        sourceContext.drawImage(previewImage,rect.x,rect.y,rect.w,rect.h);
        const maskCanvas=document.createElement('canvas');
        maskCanvas.width=layout.width;maskCanvas.height=layout.height;
        const maskContext=maskCanvas.getContext('2d');
        if(!maskContext)throw Error('浏览器无法生成扩图蒙版');
        maskContext.clearRect(0,0,layout.width,layout.height);
        maskContext.fillStyle='#000';
        maskContext.fillRect(rect.x,rect.y,rect.w,rect.h);
        const maskSourceImage=sourceCanvas.toDataURL('image/png');
        const mask=maskCanvas.toDataURL('image/png');
        if(maskSourceImage.length>24*1024*1024)throw Error('扩图画布过大，请降低扩展幅度后再试');
        if(mask.length>5.4*1024*1024)throw Error('扩图蒙版过大，请降低扩展幅度');
        const accepted=await config.onGenerate({
          prompt:finalPrompt,providerId:p.id,model,ratio:layout.ratio,
          resolution:inheritedResolution,quality:inheritedQuality,
          count:1,includeSource:true,transparentBg:false,outpaint:true,
          mask,maskSourceImage,
          outpaintRect:{width:layout.width,height:layout.height,...rect},
          references:files.map(r=>({file:r.file,title:r.file.name})),customSize:layout.customSize
        });
        if(accepted!==true)throw Error('队列未确认提交成功，请先核对任务状态，避免重复扣费');
        waiting=false;close();
      }catch(err){
        alertUser('提交失败：'+err.message);
      }finally{
        waiting=false;submit.disabled=false;submit.textContent='生成扩图 ↗';
        $('.haop-cancel').disabled=$('.haop-close').disabled=false;
      }
    };
    submit.onclick=send;
    function onResize(){if(root.isConnected)update();}
    window.addEventListener('resize',onResize);
    prompt.addEventListener('keydown',ev=>{
      if((ev.ctrlKey||ev.metaKey)&&ev.key==='Enter'){ev.preventDefault();void send();}
    });
    requestAnimationFrame(()=>$('.haop-close').focus());
    return {close};
  }
  window.HamokiAiOutpaint={open};
})();
