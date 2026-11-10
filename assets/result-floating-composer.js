/* Hamoki Studio V1 – selected-result floating tools and complete inline composer.
   UI owns drafts only; the existing /api/jobs and provider catalog remain authoritative. */
'use strict';
(() => {
  const RATIO_CHOICES=[
    ['auto','自适应'],
    ['1:1','1:1'],['9:16','9:16'],['16:9','16:9'],
    ['3:4','3:4'],['4:3','4:3'],['2:3','2:3'],['3:2','3:2'],
    ['4:5','4:5'],['5:4','5:4'],['21:9','21:9'],
    ['9:21','9:21'],['1:2','1:2'],['2:1','2:1'],['1:3','1:3'],['3:1','3:1']
  ];
  const RATIO_FALLBACK={'5:4':'4:3','4:5':'3:4','21:9':'16:9','9:21':'9:16','1:2':'9:16','2:1':'16:9','1:3':'9:16','3:1':'16:9'};
  const ICONS={
    edit:{d:'M12 20h9 M15 4l5 5-12 12-5 1 1-5L17 4a2 2 0 0 1 3 3',a:'M4 20l1.1-3.4 2.3 2.3L4 20Z'},
    reference:{d:'M7 7h13v13H7z M4 17V4h13',a:'M11 10.4h4a1.6 1.6 0 0 1 1.6 1.6v3.6a1.6 1.6 0 0 1-1.6 1.6h-4a1.6 1.6 0 0 1-1.6-1.6V12A1.6 1.6 0 0 1 11 10.4Z'},
    reuse:{d:'M20 7v5h-5 M4 17v-5h5 M5.9 9A7 7 0 0 1 18 7 M18.1 15A7 7 0 0 1 6 17',a:'M12 10.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z'},
    reverse:{d:'m12 2 2 7 7 3-7 2-2 7-2-7-7-2 7-3Z',a:'M18.6 3.2l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7Z'},
    more:{d:'M5 12h.01M12 12h.01M19 12h.01',a:'M5 12a1.15 1.15 0 1 0 2.3 0 1.15 1.15 0 0 0-2.3 0Zm5.85 0a1.15 1.15 0 1 0 2.3 0 1.15 1.15 0 0 0-2.3 0Zm5.85 0a1.15 1.15 0 1 0 2.3 0 1.15 1.15 0 0 0-2.3 0Z'},
    download:'M12 3v12m-5-5 5 5 5-5M5 18v3h14v-3',
    grid:{d:'M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z',a:'M15 13h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z'},
    rotate:'M20 11a8 8 0 1 1-2-5M20 3v5h-5',
    mirror:'M12 2v20M9 4H4v16h5m6-16h5v16h-5',
    upscale:'M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6M8 12h8',
    outpaint:'M4 4h16v16H4zM9 9h6v6H9zM12 2v3m0 14v3M2 12h3m14 0h3',
    remove:'M4 4h16v16H4zM7 13l3 3 7-7',
    cutout:{d:'M6.2 3.2a2.6 2.6 0 1 1-1.9 4.4 2.6 2.6 0 0 1 1.9-4.4Zm0 13.2a2.6 2.6 0 1 1-1.9 4.4 2.6 2.6 0 0 1 1.9-4.4Zm1.6-3.1 12.4 7.8m-12.4.4L20.2 6.9',a:'M14.6 11.1l1.1 1.6 1.9.4-1.4 1.4.3 1.9-1.9-.8-1.6 1 .2-1.9-1.4-1.4 1.9-.4Z'},
    crop:'M7 3v13a2 2 0 0 0 2 2h12M3 7h13a2 2 0 0 1 2 2v12',
    trim:'M4 4h16v16H4zM8 8h8v8H8zM2 12h4m12 0h4M12 2v4m0 12v4',
    resize:'M4 20 20 4M14 4h6v6M10 20H4v-6',
    grid9:'M4 4h16v16H4zM9.33 4v16M14.67 4v16M4 9.33h16M4 14.67h16',
    library:'M3 6h18v14H3zM3 10h18m-9-8v4',
    trash:'M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 10v8m4-8v8',
    upload:'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5',
    chevron:'m6 9 6 6 6-6',
    sliders:'M4 7h16M4 17h16M9 4v6M15 14v6',
    spark:{d:'m12 2 2 7 7 3-7 2-2 7-2-7-7-2 7-3',a:'M12 8.6l1.2 2.2 2.2 1.2-2.2 1.2L12 15.4l-1.2-2.2L8.6 12l2.2-1.2Z'},
    send:'M3 20 21 12 3 4l4 8-4 8Zm4-8h14',
    arrowUp:'M12 19V5m-7 7 7-7 7 7',
    pose:'M12 3a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5m0 6v6m0-5-5 3m5-3 5 3m-5 2-4 5m4-5 4 5',
    style:'M16 3 21 8 11 18l-5 1 1-5 9-11ZM5 21l3-3',
    expand:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
    x:'M5 5l14 14M19 5 5 19',
    refresh:'M20 7v5h-5M4 17v-5h5M5.9 9A7 7 0 0 1 18 7M18.1 15A7 7 0 0 1 6 17'
  };
  const mk=(tag,cls,text)=>{
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(text!==undefined)el.textContent=String(text);
    return el;
  };
  const ico=name=>{
    const spec=ICONS[name]||ICONS.more;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24');
    svg.setAttribute('fill','none');
    svg.setAttribute('stroke','currentColor');
    svg.setAttribute('stroke-width','2');
    svg.setAttribute('stroke-linecap','round');
    svg.setAttribute('stroke-linejoin','round');
    svg.setAttribute('aria-hidden','true');
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',typeof spec==='string'?spec:spec.d);
    svg.append(path);
    // Green accent layer: the two-tone look used across the studio UI.
    if(spec&&spec.a){
      const accent=document.createElementNS('http://www.w3.org/2000/svg','path');
      accent.setAttribute('d',spec.a);
      accent.setAttribute('fill','#74D2A4');
      accent.setAttribute('stroke','none');
      accent.setAttribute('class','ico-a');
      svg.append(accent);
    }
    return svg;
  };
  const makeButton=(label,name,cls='')=>{
    const b=mk('button',cls,label);
    b.type='button';
    if(name)b.prepend(ico(name));
    return b;
  };
  const label=(text,forId)=>{
    const l=mk('label','result-field-label',text);
    if(forId)l.htmlFor=forId;
    return l;
  };
  function section(title,child,extra){
    const block=mk('section','result-form-section');
    const head=mk('div','result-section-head');
    head.append(label(title));
    if(extra)head.append(extra);
    block.append(head,child);
    return block;
  }
  const imageLike=file=>['image/png','image/jpeg','image/webp'].includes(file.type);
  const validFile=file=>imageLike(file)&&file.size>0&&file.size<=12*1024*1024;
  const safeFallback=value=>RATIO_FALLBACK[value]||value;
  function create(ctx){
    const h=ctx.history,toast=ctx.toast;
    let cleanupSettings=()=>{};
    let refSeq=0,dead=false,files=[];
    const references=[];
    // The selected image is the edit source and occupies one of the five
    // reference slots, even though it is no longer shown as a thumbnail.
    const referenceLimit=ctx.nodeId?4:5;
    const referenceLimitNote=ctx.nodeId?'（所选图片已占用1个名额）':'';
    // The selected image is the edit source, not a visible reference. The
    // popup starts with an empty reference list so it never looks preloaded.
    const notify=(message,bad=false)=>toast(message,bad);
    const toolbar=mk('div','generated-result-toolbar');
    const primary=mk('div','result-toolbar-primary');
    const footer=mk('div','result-toolbar-download');
    const editor=mk('div','generated-result-editor');
    const input=mk('textarea','generated-result-prompt');
    input.rows=3;
    input.maxLength=16000;
    input.value=ctx.initialPrompt||'';
    input.placeholder='描述需要保留和改变的内容，例如：保留原布局，将按钮和标题改成绿色，背景不要前景…';
    input.setAttribute('aria-label','生成提示词');
    // Default to 自适应: the first reference (or the selected image when editing)
    // decides the aspect ratio, so a portrait prototype no longer needs 1:1.
    let currentRatio='auto';
    let currentResolution=['1K','2K','4K'].includes(h.resolution)?h.resolution:'1K';
    let currentCount=1,output='normal';
    const allProviders=()=>ctx.getProviders()||[];
    let chosenProvider='';
    let chosenModel=h.model||'';
    let remoteProviders=[];
    const fetchedModels=new Map();
    let syncModelDropdown=()=>{};
    const activeProviders=()=>allProviders().length?allProviders():remoteProviders;
    const getProvider=()=>activeProviders().find(p=>p.id===chosenProvider);
    const displayedModel=()=>modelSelect.value==='__custom__'?customModel.value.trim():modelSelect.value;
    const modelLabel=mk('span','result-model-subtitle','选择提供图片生成能力的中转站与模型');
    const status=mk('span','result-compose-status');
    status.setAttribute('role','status');
    status.setAttribute('aria-live','polite');
    const footerMsg=mk('span','generated-result-meta-text',h.model||'图片修改');
    function say(text,bad=false) {
      status.textContent=text;
      status.classList.toggle('is-error',bad);
    }
    // The canvas_ref syntax is an internal image binding, not prompt prose.
    const stripCanvasMarkers=text=>String(text||'').replace(/\{\{canvas_ref:[^}]*\}\}/g,'');
    function markDraft(){
      ctx.onDraft(input.value);
      footerMsg.textContent='草稿已保存';
      updateChar();
    }
    const header=mk('div','generated-result-editor-head');
    const headerStart=mk('div','result-editor-title');
    headerStart.append(mk('strong','', '继续创作'),mk('small','', '基于这张图片重新生成'));
    const close=makeButton('','x','generated-result-dismiss');
    close.setAttribute('aria-label','关闭编辑面板');
    close.title='取消选中';
    close.addEventListener('click',ctx.onClose);
    header.append(headerStart,close);
    editor.append(header);
    // Model and intermediary selection: the same provider IDs and upstream catalog as the main panel.
    const modelControls=mk('div','result-provider-grid');
    const providerBlock=mk('div','result-provider-cell');
    providerBlock.append(label('中转商'));
    const providerSelect=mk('select','result-select');
    providerSelect.setAttribute('aria-label','选择中转商');
    providerBlock.append(providerSelect);
    const modelBlock=mk('div','result-provider-cell');
    const modelTitle=mk('div','result-model-head');
    modelTitle.append(label('图像模型'));
    const fetchModels=makeButton('获取模型','refresh','result-fetch-models');
    fetchModels.title='通过当前中转站查询模型列表，不会生成图片';
    modelTitle.append(fetchModels);
    const modelSelect=mk('select','result-select');
    modelSelect.setAttribute('aria-label','选择图像模型');
    const customModel=mk('input','result-custom-model');
    customModel.type='text';
    customModel.placeholder='输入模型 ID';
    customModel.maxLength=120;
    customModel.hidden=true;
    modelBlock.append(modelTitle,modelSelect,customModel);
    modelControls.append(providerBlock,modelBlock);
    const modelSection=section('模型与中转商',modelControls);
    modelSection.append(modelLabel);
    editor.append(modelSection);
    function updateModels(preferred){
      const p=getProvider();
      const choices=[p?.imageModel,h.providerId===chosenProvider?h.model:null,
        ...(fetchedModels.get(chosenProvider)||[])].filter(Boolean);
      const uniq=[...new Set(choices.map(x=>String(x)))].slice(0,140);
      const wanted=preferred||chosenModel||p?.imageModel||'';
      if(wanted && !uniq.includes(wanted))uniq.unshift(wanted);
      modelSelect.replaceChildren();
      if(!uniq.length){
        modelSelect.add(new Option('请先在设置中配置模型',''));
      }else for(const value of uniq){
        modelSelect.add(new Option(value,value));
      }
      modelSelect.add(new Option('自定义模型 ID…','__custom__'));
      if(wanted){
        modelSelect.value=wanted;
        if(modelSelect.value!==wanted){
          modelSelect.value='__custom__';customModel.value=wanted;
        }
      }
      customModel.hidden=modelSelect.value!=='__custom__';
      chosenModel=displayedModel();
      modelLabel.textContent=p?(p.imageModel?'默认：'+p.imageModel:'请确认模型ID'):'尚未配置中转商，请到设置中添加';
      syncModelDropdown();
    }
    function updateProviders(preserve){
      const choices=activeProviders();
      const native=document.getElementById('provider-select')?.value||ctx.activeProviderId();
      chosenProvider=preserve&&choices.some(p=>p.id===chosenProvider)?chosenProvider:
        (choices.find(p=>p.id===h.providerId)?.id || choices.find(p=>p.id===native)?.id || choices[0]?.id || '');
      providerSelect.replaceChildren();
      if(!choices.length)providerSelect.add(new Option('请先添加中转商',''));
      else for(const p of choices)providerSelect.add(new Option(p.name,p.id));
      providerSelect.value=chosenProvider;
      chosenModel=h.providerId===chosenProvider && h.model?h.model:(getProvider()?.imageModel||'');
      updateModels(chosenModel);
    }
    providerSelect.addEventListener('change',()=>{
      chosenProvider=providerSelect.value;
      chosenModel=getProvider()?.imageModel||'';
      updateModels(chosenModel);
    });
    modelSelect.addEventListener('change',()=>{
      customModel.hidden=modelSelect.value!=='__custom__';
      if(!customModel.hidden)customModel.focus();
      chosenModel=displayedModel();
    });
    customModel.addEventListener('input',()=>{chosenModel=customModel.value.trim();});
    fetchModels.addEventListener('click',async()=>{
      if(!chosenProvider)return notify('先选择中转商',true);
      fetchModels.disabled=true;fetchModels.lastChild.textContent=' 获取中…';
      try{
        const r=await fetch('/api/models?providerId='+encodeURIComponent(chosenProvider),{cache:'no-store'});
        const payload=await r.json().catch(()=>({}));
        if(!r.ok)throw Error(payload.error||'上游没有开放模型列表');
        const found=Array.isArray(payload.models)?payload.models.filter(s=>typeof s==='string'):[];
        if(!found.length)throw Error('上游未返回模型；仍可手动输入模型ID');
        const preferred=found.filter(s=>/image|flux|banana|seedream|dall-e|qwen.*img/i.test(s));
        fetchedModels.set(chosenProvider,(preferred.length?preferred:found).slice(0,140));
        updateModels(displayedModel());
        say('已载入 '+fetchedModels.get(chosenProvider).length+' 个候选模型，请确认该模型支持生图');
      }catch(e){say('获取模型失败：'+e.message+'；可以手动输入模型ID',true);}
      finally{fetchModels.disabled=false;fetchModels.lastChild.textContent=' 获取模型';}
    });
    const initial=allProviders();
    if(initial.length)updateProviders(false);
    else fetch('/api/providers',{cache:'no-store'}).then(r=>r.json()).then(d=>{
      if(dead)return;
      remoteProviders=Array.isArray(d.providers)?d.providers:[];
      updateProviders(false);
    }).catch(()=>{if(!dead)updateProviders(false);});
    // Prompt text and optimizer.
    const promptHead=mk('div','result-section-head');
    promptHead.append(label('提示词'));
    const promptActions=mk('div','result-prompt-actions');
    const reversePrompt=makeButton('从图片反推','reverse','result-reverse-prompt');
    reversePrompt.title='使用视觉模型反推提示词，执行前确认可能产生的费用';
    reversePrompt.onclick=async()=>{
      reversePrompt.disabled=true;
      try{
        await ctx.onAction('reverse',{prompt:input.value,textarea:input,statusEl:footerMsg});
        richPrompt.replace(input.value,{notify:true});
        updateChar();
      }catch(e){say('反推失败：'+e.message,true);notify('反推失败：'+e.message,true);}
      finally{reversePrompt.disabled=false;}
    };
    const optimize=makeButton('优化提示词','spark','result-optimize');
    optimize.title='本地补充界面层级和画面约束，不调用付费模型';
    promptActions.append(reversePrompt,optimize);
    promptHead.append(promptActions);
    const promptSection=mk('section','result-form-section result-prompt-section');
    const charCount=mk('span','result-char-count');
    promptSection.append(promptHead,input,charCount);
    editor.append(promptSection);
    const richPrompt=window.HamokiRefChips.create(input,{
      targetClass:'result-rich-prompt',
      resolve:id=>ctx.resolveCanvasRef?.(id),
      onReveal:id=>ctx.onRevealRef?.(id),
      onChange:()=>markDraft(),
      onRemove:id=>{
        const idx=references.findIndex(ref=>ref.nodeId===id);
        if(idx>=0){references.splice(idx,1);renderRefs();}
      }
    });
    function updateChar(){
      const count=stripCanvasMarkers(input.value).length;
      charCount.textContent=String(count)+' / 1000';
      charCount.classList.toggle('is-error',count>1000);
    }
    input.addEventListener('input',()=>{
      richPrompt.replace(input.value);
      markDraft();
    });
    updateChar();
    optimize.addEventListener('click',()=>{
      const text=input.value.trim();
      if(!text)return notify('先填写提示词再优化',true);
      if(text.includes('画面约束：'))return notify('已经优化过，可以直接修改或生成');
      let details=['主体突出、信息层级清晰、按钮最醒目','美术风格与配色统一，图标文字清晰','背景保持简洁，给交互控件充分留白'];
      if(references.length)details.unshift('除明确要求外，保留参考图片的核心构图与设计风格');
      const next=text+'\n画面约束：'+details.join('；')+'。';
      if(next.length>1000)return notify('优化内容超过1000字，请先精简原提示词',true);
      richPrompt.replace(next,{notify:true});richPrompt.focus();
      say('已补充本地构图与层级约束');
    });
    // Reference thumbnail gallery, uploads, drag and image paste.
    const refBody=mk('div','result-reference-body');
    const refGrid=mk('div','result-reference-grid');
    refGrid.setAttribute('role','list');
    refGrid.setAttribute('aria-label','生成参考图');
    const fileInput=mk('input');fileInput.type='file';fileInput.accept='image/png,image/jpeg,image/webp';
    fileInput.multiple=true;fileInput.hidden=true;
    const refMode=mk('select','result-select result-reference-mode');
    refMode.setAttribute('aria-label','参考图片使用方式');
    for(const [v,title] of [
      ['general','默认图像参考'],['style','仅参考风格'],['interactive','交互参考'],
      ['person','人物融入'],['copy','完整复制'],['layout','仅参考构图'],['subject','保留主体形象']
    ])refMode.add(new Option(title,v));
    // Keep the default reference behavior internally; the visible mode selector,
    // redundant add button and explanatory blank row are not part of the compact UI.
    refBody.append(refGrid,fileInput);
    editor.append(section('参考图片',refBody));
    function renderRefs(){
      refGrid.replaceChildren();
      for(const [i,ref] of references.entries()){
        const cell=mk('div','result-ref-tile');
        cell.setAttribute('role','listitem');
        const im=mk('img');im.src=ref.url;im.alt=ref.title;
        const mark=mk('span','result-ref-mark',ref.source?'原图':'参考');
        const order=mk('span','result-ref-order',String(i+1));
        const x=makeButton('','x','result-ref-remove');x.title='移除这张参考图';x.setAttribute('aria-label','移除'+ref.title);
        x.onclick=()=>{
          const index=references.findIndex(x=>x.id===ref.id);
          if(index<0)return;
          const removed=references.splice(index,1)[0];
          if(removed.local)URL.revokeObjectURL(removed.url);
          if(removed.nodeId)richPrompt.remove(removed.nodeId,{notify:false});
          renderRefs();
        };
        cell.tabIndex=0;
        cell.title='双击定位原始参考图片：'+ref.title;
        const reveal=()=>{
          if(ref.nodeId)ctx.onRevealRef?.(ref.nodeId);
          else if(ref.url)window.open(ref.url,'_blank','noopener');
        };
        cell.addEventListener('dblclick',e=>{
          if(e.target.closest('.result-ref-remove'))return;
          e.preventDefault();e.stopPropagation();reveal();
        });
        cell.addEventListener('keydown',e=>{
          if(e.key==='Enter'){e.preventDefault();reveal();}
        });
        cell.append(im,mark,order,x);
        refGrid.append(cell);
      }
      // One upload entry in the top toolbar is sufficient. An empty slot here
      // looked like a broken thumbnail and left unnecessary blank space.
      refBody.closest('.result-form-section')?.toggleAttribute('hidden',!references.length);
    }
    function addFiles(items){
      const incoming=Array.from(items||[]).filter(Boolean);
      if(!incoming.length)return 0;
      let total=references.filter(r=>r.file).reduce((sum,r)=>sum+r.file.size,0);
      let added=0;
      for(const file of incoming){
        if(references.length>=referenceLimit){say('最多使用'+referenceLimit+'张参考图片'+referenceLimitNote,true);break;}
        if(!validFile(file)){say('仅支持单张不超过12MB的PNG/JPG/WebP图片',true);continue;}
        if(total+file.size>40*1024*1024){say('参考图片合计不能超过40MB',true);break;}
        references.push({id:'upload-'+(++refSeq),url:URL.createObjectURL(file),file,local:true,title:file.name||'参考图'});
        added++;total+=file.size;
      }
      renderRefs();
      if(added)say('已添加'+added+'张参考图片，可单独删除');
      return added;
    }
    fileInput.addEventListener('change',()=>{addFiles(fileInput.files);fileInput.value='';});
    async function addCanvasReference(item,{appendChip=true}={}){
      if(!item?.id||!item.url)return false;
      const present=references.find(ref=>ref.nodeId===item.id);
      if(!present){
        if(references.length>=referenceLimit){say('最多添加'+referenceLimit+'张参考图'+referenceLimitNote+'，请先移除一张',true);return false;}
        if(item.id===ctx.nodeId && references.some(ref=>ref.source)){
          // Current selected image is already a reference.
        }else{
          let file;
          try {
            const response=await fetch(item.url,{credentials:'same-origin'});
            if(!response.ok)throw Error('原始图片不可读取');
            const blob=await response.blob();
            const type=['image/png','image/jpeg','image/webp'].includes(blob.type)?blob.type:'image/png';
            const ext=type==='image/jpeg'?'jpg':type==='image/webp'?'webp':'png';
            file=new File([blob],(item.title||'画布图片').replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g,'_').slice(0,60)+'.'+ext,{type});
            if(!validFile(file))throw Error('只支持12MB以内的PNG/JPG/WebP');
            const total=references.filter(r=>r.file).reduce((sum,r)=>sum+r.file.size,0);
            if(total+file.size>40*1024*1024)throw Error('全部参考图不能超过40MB');
          }catch(error){say('图片引用失败：'+error.message,true);return false;}
          if(references.length>=referenceLimit){say('最多添加'+referenceLimit+'张参考图'+referenceLimitNote+'，请先移除一张',true);return false;}
          references.push({id:'canvas-'+item.id,nodeId:item.id,url:item.url,title:item.title||'画布图片',file,local:false});
          renderRefs();
        }
      }
      if(appendChip)richPrompt.append(item);
      return true;
    }
    editor.__addCanvasReference=addCanvasReference;
    editor.addEventListener('dragover',e=>{
      if(e.dataTransfer?.types?.includes('Files')){e.preventDefault();refBody.classList.add('is-dragging');}
    });
    editor.addEventListener('dragleave',()=>refBody.classList.remove('is-dragging'));
    editor.addEventListener('drop',e=>{
      if(!e.dataTransfer?.files?.length)return;
      e.preventDefault();e.stopPropagation();
      refBody.classList.remove('is-dragging');addFiles(e.dataTransfer.files);
    });
    editor.addEventListener('paste',e=>{
      const imageFiles=Array.from(e.clipboardData?.files||[]).filter(imageLike);
      if(!imageFiles.length)return;
      e.preventDefault();e.stopPropagation();addFiles(imageFiles);
    });
    renderRefs();
    // Parameter controls: 8 native ratios plus four explicit nearest-ratio options.
    const ratioGroup=mk('div','result-choice-grid result-ratio-grid');
    const ratioHint=mk('small','result-option-hint');
    function updateRatio(){
      ratioGroup.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.value===currentRatio));
      const mapped=RATIO_FALLBACK[currentRatio];
      ratioHint.textContent=mapped?'当前模型预设不支持精确'+currentRatio+'；提交时将明确提示近似采用'+mapped:(currentRatio==='auto'?'自适应会优先跟随首张参考图的比例':'当前选择 '+currentRatio+'，最终支持范围以所选模型为准');
      ratioHint.classList.toggle('is-warning',!!mapped);
    }
    for(const [v,name] of RATIO_CHOICES){
      const b=makeButton('',null,'result-choice');
      b.dataset.value=v;b.setAttribute('aria-label','比例 '+name);
      const ratioShape=mk('span','result-ratio-preview');
      if(v==='auto'){
        // Dashed outline = follows whatever the reference image looks like.
        ratioShape.classList.add('is-auto');
        ratioShape.style.width='17px';
        ratioShape.style.height='13px';
      }else{
        const [rw,rh]=v.split(':').map(Number);
        const iconScale=Math.min(17/rw,13/rh);
        ratioShape.style.width=Math.max(5,Math.round(rw*iconScale))+'px';
        ratioShape.style.height=Math.max(6,Math.round(rh*iconScale))+'px';
      }
      b.append(ratioShape,mk('span','result-ratio-name',name));
      b.onclick=()=>{currentRatio=v;updateRatio();};
      ratioGroup.append(b);
    }
    const ratioBody=mk('div','result-field-body');ratioBody.append(ratioGroup,ratioHint);
    editor.append(section('画面比例',ratioBody));
    updateRatio();
    function choices(title,values,selected,setter){
      const group=mk('div','result-choice-grid result-small-choices');
      for(const value of values){
        const b=makeButton(value,null,'result-choice');
        b.dataset.value=value;b.classList.toggle('active',value===selected);
        b.onclick=()=>{
          group.querySelectorAll('button').forEach(item=>item.classList.remove('active'));
          b.classList.add('active');setter(value);
        };
        group.append(b);
      }
      return section(title,group);
    }
    const options=mk('div','result-options-grid');
    options.append(
      choices('清晰度',['1K','2K','4K'],currentResolution,v=>{currentResolution=v;}),
      choices('生成数量',['1','2','4'],'1',v=>{currentCount=Number(v);})
    );
    editor.append(options);
    // Queue button: no paid work without explicit user confirmation.
    const actionFoot=mk('div','result-composer-footer');
    const go=makeButton('','arrowUp','generated-result-primary');
    go.title='按此处设置生成，提交前会确认费用与参数';
    go.onclick=async()=>{
      const cleanPrompt=stripCanvasMarkers(input.value).trim();
      if(!cleanPrompt)return say('请填写生成提示词',true);
      if(cleanPrompt.length>1000)return say('提示词最多1000字，请先精简',true);
      if(!chosenProvider)return say('请先选择中转商',true);
      const model=displayedModel();
      if(!model)return say('请选择或填写图像模型ID',true);
      let prompt=cleanPrompt;
      if(references.length&&refMode.value!=='general'){
        const hint={
          style:'仅参考素材的绘画风格和配色，不要复制参考图中的主体内容。',
          pose:'仅参考素材中人物或主体的姿势、动作方向与动态，其他设计按本次提示词重新生成。',
          layout:'仅参考素材的版式、构图和信息布局，不必照搬画风。',
          interactive:'利用参考图片的内容和空间关系开展交互式重新设计，保留与目标任务相关的元素。',
          person:'保持参考图中的人物身份与主要特征，让人物自然融入本次要求的场景。',
          copy:'尽可能完整保持参考图的造型、布局、配色、风格和主体细节；只改变提示词明确要求的部分。',
          subject:'保持参考素材的主体身份、主要轮廓和关键视觉特征。'
        }[refMode.value];
        if(hint&&!prompt.includes(hint))prompt+='\n'+hint;
      }
      if(prompt.length>1000)return say('参考要求叠加后超出1000字，请精简提示词',true);
      const payload={
        prompt,providerId:chosenProvider,model,
        ratio:safeFallback(currentRatio),ratioRequested:currentRatio,
        resolution:currentResolution,quality:({low:'low',standard:'medium',high:'high',ultra:'high',max:'high'}[currentQuality]),mode:generationMode,count:currentCount,
        transparentBg:output==='transparent',
        references:references.map(r=>r.file?{file:r.file,title:r.title}:{
          source:true,url:r.url,title:r.title
        }),
        includeSource:!!ctx.nodeId||references.some(r=>r.source)
      };
      go.disabled=true;go.lastChild.textContent=' 正在核对…';
      try {
        const result=await ctx.onGenerate(payload);
        if(result===true)say('已向原生生图队列提交请求；请以队列状态为准');
        else if(result!==false)say('请在下方队列检查提交结果');
      }catch(e){
        say('提交失败：'+e.message,true);
        notify('提交失败：'+e.message,true);
      }finally{
        go.disabled=false;go.lastChild.textContent=' 加入生成队列';
      }
    };
    const footNote=mk('small','result-submit-hint','提交前确认模型、比例、张数与可能产生的费用');
    const actionTop=mk('div','result-composer-foot-head');
    actionTop.append(footerMsg,go);
    actionFoot.append(actionTop,footNote,status);
    editor.append(actionFoot);
    // Reference-inspired compact composer. Settings float UP outside the prompt area.
    editor.classList.add('result-composer-compact');
    const refSection=refBody.closest('.result-form-section');
    const ratioSection=ratioBody.closest('.result-form-section');
    const settingsPanel=mk('div','result-floating-settings');
    settingsPanel.id='result-generation-settings';
    settingsPanel.setAttribute('role','group');
    settingsPanel.setAttribute('aria-label','生成参数');
    settingsPanel.hidden=true;
    // 快速/精细 与 画质 两块未接入后端，已移除；默认沿用快速 + 标准。
    let generationMode='quick';
    let currentQuality='standard';
    ratioSection.querySelector('.result-field-label').textContent='比例';
    const resolutionSection=options.querySelector('.result-form-section');
    const countSection=options.querySelectorAll('.result-form-section')[1];
    if(resolutionSection)resolutionSection.querySelector('.result-field-label').textContent='清晰度';
    const customResolution=makeButton('自定义',null,'result-choice result-custom-resolution');
    customResolution.disabled=true;
    customResolution.title='目前后端仅支持 1K、2K 和 4K 输出';
    resolutionSection.querySelector('.result-small-choices').append(customResolution);
    const advanced=mk('details','result-settings-advanced');
    advanced.append(mk('summary','','更多设置 · 生成数量'),countSection);
    settingsPanel.append(resolutionSection,ratioSection,advanced);
    const footerBar=mk('div','result-compact-footer');
    const modelTrigger=makeButton('','spark','result-model-trigger');
    const modelNameNode=mk('span','result-model-name','选择模型');
    modelTrigger.replaceChildren(ico('spark'),modelNameNode,ico('chevron'));
    const settingsTrigger=makeButton('','sliders','result-settings-trigger');
    const settingsNameNode=mk('span','result-settings-name','9:16 · 1K · 1张');
    settingsTrigger.replaceChildren(ico('sliders'),settingsNameNode,ico('chevron'));
    settingsTrigger.setAttribute('aria-expanded','false');
    const transparency=mk('label','result-transparency');
    const transparentToggle=mk('input');transparentToggle.type='checkbox';
    transparency.append(mk('span','','透明背景'),transparentToggle);
    // Surface the default transparency instructions in the editable prompt.
    const TRANSPARENT_PROMPT_TITLE='【透明背景要求】';
    const TRANSPARENT_PROMPT_BLOCK=TRANSPARENT_PROMPT_TITLE+'\n'+
      '只生成主体及必要细节，输出带真实 Alpha 透明通道的 PNG 图片。不要添加场景、地面、白色或纯色背景，也不要用棋盘格模拟透明。主体轮廓与镂空边缘干净清晰，保留半透明材质与自然发光效果。';
    let retainedEditedTransparency=false;
    let baseBeforeTransparency=null;
    function syncTransparentPrompt(enabled){
      const current=input.value||'';
      if(enabled){
        // Never duplicate an already-present or customized instruction.
        if(current.includes(TRANSPARENT_PROMPT_TITLE) ||
            (retainedEditedTransparency&&current.trim()))return true;
        retainedEditedTransparency=false;
        const before=current.trimEnd();
        const next=before?before+'\n\n'+TRANSPARENT_PROMPT_BLOCK:TRANSPARENT_PROMPT_BLOCK;
        if(stripCanvasMarkers(next).length>1000){
          say('提示词加入透明背景要求后超过1000字，请先精简提示词',true);
          return false;
        }
        baseBeforeTransparency=before;
        richPrompt.replace(next,{notify:true});
        richPrompt.rich.scrollTop=richPrompt.rich.scrollHeight;
        say('已追加透明背景要求，可直接在提示词中修改');
        return true;
      }
      // Removing the switch must never destroy a manually customized block.
      const exact='\n\n'+TRANSPARENT_PROMPT_BLOCK;
      let next=current;
      if(current.includes(exact))next=current.replace(exact,'');
      else if(current.trim()===TRANSPARENT_PROMPT_BLOCK)next='';
      if(next!==current){
        richPrompt.replace(next,{notify:true});
        retainedEditedTransparency=false;
        baseBeforeTransparency=null;
        say('已移除默认透明背景要求');
      }else if(current.includes(TRANSPARENT_PROMPT_TITLE) ||
          (baseBeforeTransparency!==null && current.trim() && current.trim()!==baseBeforeTransparency)){
        retainedEditedTransparency=true;
        say('已关闭透明模式；手动修改过的提示词已保留');
      }
      return true;
    }
    transparentToggle.onchange=()=>{
      if(transparentToggle.checked&&!syncTransparentPrompt(true)){
        transparentToggle.checked=false;
        output='normal';
        return;
      }
      if(!transparentToggle.checked)syncTransparentPrompt(false);
      output=transparentToggle.checked?'transparent':'normal';
    };
    const submit=go;
    submit.classList.add('result-submit-icon');
    submit.setAttribute('aria-label','加入生成队列');
    submit.title='加入生成队列';
    const footerTools=mk('div','result-footer-tools');
    reversePrompt.lastChild.textContent='';
    reversePrompt.setAttribute('aria-label','从图片反推提示词');
    reversePrompt.title='从图片反推提示词';
    optimize.lastChild.textContent='';
    optimize.setAttribute('aria-label','优化提示词');
    optimize.title='优化提示词（不消耗模型额度）';
    footerTools.append(reversePrompt,optimize);
    footerBar.append(modelTrigger,settingsTrigger,transparency,footerTools,submit);
    const modelPopover=mk('div','result-model-popover');
    modelPopover.hidden=true;
    modelPopover.setAttribute('role','listbox');
    modelPopover.setAttribute('aria-label','选择模型和中转商');
    modelPopover.id='result-model-options';
    modelTrigger.setAttribute('aria-controls',modelPopover.id);
    modelTrigger.setAttribute('aria-haspopup','listbox');
    modelTrigger.setAttribute('aria-expanded','false');
    const modelList=mk('div','result-model-options');
    modelPopover.append(modelList);
    // Match the existing right-hand "模型 · 中转商" picker: model above,
    // provider beneath, one selectable row per configured provider.
    syncModelDropdown=()=>{
      const current=getProvider();
      const modelName=displayedModel()||current?.imageModel||'选择模型';
      modelNameNode.textContent=modelName;
      modelTrigger.title=current?modelName+' · '+current.name:'请先添加中转商';
      modelList.replaceChildren();
      for(const p of activeProviders()){
        const value=String(p.imageModel||(p.id===chosenProvider?displayedModel():'')||'').trim();
        const selected=p.id===chosenProvider;
        const row=makeButton('',null,'model-picker-option result-model-option');
        row.setAttribute('role','option');
        row.setAttribute('aria-selected',String(selected));
        row.classList.toggle('active',selected);
        row.disabled=!value;
        const icon=mk('span','model-option-icon');icon.append(ico('spark'));
        const title=mk('span','model-option-text');
        title.append(mk('strong','',value||'未配置图片模型'),mk('small','',p.name));
        const check=mk('span','model-option-check',selected?'✓':'');
        row.append(icon,title,check);
        row.onclick=()=>{
          chosenProvider=p.id;
          providerSelect.value=p.id;
          chosenModel=value;
          updateModels(value);
          closePanels();
        };
        modelList.append(row);
      }
      if(!modelList.children.length)
        modelList.append(mk('p','result-model-empty','请先在设置中添加模型中转商'));
    };
    syncModelDropdown();
    function closePanels(){
      settingsPanel.hidden=true;modelPopover.hidden=true;
      settingsTrigger.setAttribute('aria-expanded','false');
      modelTrigger.setAttribute('aria-expanded','false');
    }
    function fitPopover(panel){
      panel.classList.remove('result-popover-below');
      panel.style.left=panel===settingsPanel?'90px':'12px';
      const r=editor.getBoundingClientRect();
      const boardTop=document.getElementById('canvas-viewport')?.getBoundingClientRect().top||0;
      const safeTop=Math.max(12,boardTop+9);
      // Reference popup is anchored to the FOOTER controls, not the
      // composer's top edge. It intentionally overlays the prompt area.
      const popupAnchor=r.bottom-53;
      const above=popupAnchor-safeTop-8,below=innerHeight-r.bottom-12;
      if(above<310&&below>above+80)panel.classList.add('result-popover-below');
      const space=panel.classList.contains('result-popover-below')?below:above;
      panel.style.maxHeight=Math.max(120,Math.min(540,space-9))+'px';
      const p=panel.getBoundingClientRect();
      if(p.right>innerWidth-9)
        panel.style.left=Math.max(0,editor.offsetWidth-panel.offsetWidth-5)+'px';
    }
    settingsTrigger.onclick=()=>{
      const open=settingsPanel.hidden;closePanels();settingsPanel.hidden=!open;
      settingsTrigger.setAttribute('aria-expanded',String(open));
      if(open)requestAnimationFrame(()=>fitPopover(settingsPanel));
    };
    modelTrigger.onclick=()=>{
      const open=modelPopover.hidden;closePanels();
      if(open)syncModelDropdown();
      modelPopover.hidden=!open;
      modelTrigger.setAttribute('aria-expanded',String(open));
      if(open)requestAnimationFrame(()=>fitPopover(modelPopover));
    };
    const settingsOutside=e=>{if(!editor.contains(e.target))closePanels();else if(!settingsPanel.contains(e.target)&&!settingsTrigger.contains(e.target)&&!modelPopover.contains(e.target)&&!modelTrigger.contains(e.target))closePanels();};
    document.addEventListener('pointerdown',settingsOutside);
    cleanupSettings=()=>document.removeEventListener('pointerdown',settingsOutside);
    // The header already attached the one close handler; the outer popover
    // cleanup removes settingsOutside when the editor is destroyed.
    function refreshSettingsSummary(){
      const ratio=currentRatio==='auto'?'自适应':currentRatio;
      settingsNameNode.textContent=ratio+' · '+currentResolution+' · '+currentCount+'张';
    }
    settingsPanel.addEventListener('click',()=>refreshSettingsSummary());
    refreshSettingsSummary();
    // Rich text uses visual image chips. Raw tokens are metadata only.
    // Restore saved chip references to actual image files as needed.
    for(const id of richPrompt.ids()){
      const item=ctx.resolveCanvasRef?.(id);
      if(item)void addCanvasReference(item,{appendChip:false});
    }
    updateChar();
    const toolsRow=mk('div','result-compact-tools');
    const uploadTop=makeButton('上传','upload','result-upload-top');
    uploadTop.onclick=()=>fileInput.click();
    const styleTop=makeButton('风格','style','result-style-top');
    const setRefMode=(mode)=>{
      const next=refMode.value===mode?'general':mode;
      refMode.value=next;
      styleTop.classList.toggle('active',next==='style');
    };
    styleTop.onclick=()=>setRefMode('style');
    const utilities=mk('div','result-top-utilities');
    const layoutTop=makeButton('','grid','result-layout-top');
    layoutTop.title='切换参考图缩略图大小';
    layoutTop.setAttribute('aria-label','切换参考图缩略图大小');
    layoutTop.onclick=()=>{const on=editor.classList.toggle('result-refs-large');layoutTop.setAttribute('aria-pressed',String(on));};
    const expandTop=makeButton('','expand','result-expand-top');
    expandTop.title='展开或收起提示词输入区域';
    expandTop.setAttribute('aria-label','展开或收起提示词输入区域');
    expandTop.onclick=()=>{const on=editor.classList.toggle('result-input-expanded');expandTop.setAttribute('aria-pressed',String(on));};
    const mobileDownload=makeButton('','download','result-mobile-download');
    mobileDownload.title='下载原始图片';
    mobileDownload.setAttribute('aria-label','下载原始图片');
    mobileDownload.onclick=()=>Promise.resolve(ctx.onAction('download',{
      prompt:input.value,textarea:input,statusEl:footerMsg
    })).catch(e=>notify('下载失败：'+e.message,true));
    utilities.append(mobileDownload,layoutTop,expandTop,close);
    toolsRow.append(uploadTop,styleTop,utilities);
    // Remove the headers from the DOM. The legacy display:flex rule overrides
    // the UA [hidden] style, so setting hidden alone was not sufficient.
    refSection.querySelector('.result-section-head')?.remove();
    promptSection.querySelector('.result-section-head')?.remove();
    const statusArea=mk('div','result-compact-status');statusArea.append(status,footerMsg);
    editor.replaceChildren(header,toolsRow,refSection,promptSection,footerBar,statusArea,settingsPanel,modelPopover);
    editor.addEventListener('keydown',e=>{if(e.key==='Escape')closePanels();});
    richPrompt.rich.addEventListener('keydown',e=>{
      if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){
        e.preventDefault();go.click();
      }
    });
    // Floating action toolbar. Download is deliberately the last, rightmost item.
    const ACTION_LABELS={
      expand:'AI 扩图',resize:'缩放',crop:'裁切','trim-edge':'边缘裁切',
      'auto-crop':'自动裁切',grid9:'九宫格缩放',grid:'宫格切图',rotate:'旋转90°',
      mirror:'水平镜像',library:'加入素材库',delete:'移除画布图片',
      reference:'引用',reuse:'做同款',reverse:'反推','remove-bg':'去背景'
    };
    const REMOVAL_PROMPT='仅保留原图主体，完整移除背景和杂物，输出透明背景 PNG，并保留发丝、半透明边缘与柔和投影。';
    function prepareBackgroundRemoval(){
      const provider=getProvider();
      if(!provider)return notify('请先选择支持透明背景的模型',true);
      if(provider.mode!=='openai'||(provider.imageMode||'images')!=='images')
        return notify('去背景需要 OpenAI Images 兼容模型，并确认该模型支持透明输出',true);
      // A removal request must not keep the old generation prompt: otherwise
      // the model receives two conflicting instructions at once.
      richPrompt.replace(REMOVAL_PROMPT,{notify:false});
      transparentToggle.checked=true;
      output='transparent';
      // The removal prompt is a one-click helper, not a saved draft. Clear the
      // previous draft so reopening the image still starts blank.
      ctx.onDraft?.('');
      updateChar();richPrompt.focus();
      say('已用去背景提示词替换当前描述，并开启透明背景；请确认模型与费用后生成');
      notify('已替换为去背景提示词：透明背景 + 抠图要求；生成会重新绘制主体边缘，请确认后再提交');
    }
    function prepareAiOutpaint(){
      closePanels();
      if(!window.HamokiAiOutpaint?.open)return say('扩图窗口尚未加载，请刷新页面',true);
      try{
        window.HamokiAiOutpaint.open({
          sourceUrl:ctx.picture,
          sourceWidth:ctx.sourceWidth||h.pixelWidth,
          sourceHeight:ctx.sourceHeight||h.pixelHeight,
          getProviders:activeProviders,
          getProviderId:()=>h.providerId||chosenProvider,
          getModel:()=>h.model||displayedModel(),
          resolution:h.resolution||currentResolution,
          quality:h.quality||'auto',
          onGenerate:config=>ctx.onGenerate(config)
        });
      }catch(error){say('打开扩图窗口失败：'+error.message,true);}
    }
    const act=async(action,button)=>{
      if(action==='edit')return ctx.onAction('edit',{prompt:input.value,textarea:input,statusEl:footerMsg});
      if(action==='remove-bg'){prepareBackgroundRemoval();return;}
      if(action==='expand'){prepareAiOutpaint();return;}
      if(action==='download'){
        return ctx.onAction('download',{prompt:input.value,textarea:input,statusEl:footerMsg});
      }
      button.disabled=true;
      try{
        await ctx.onAction(action,{prompt:input.value,textarea:input,statusEl:footerMsg});
      }catch(e){
        const message=(ACTION_LABELS[action]||action)+'失败：'+e.message;
        say(message,true);notify(message,true);
      }finally{button.disabled=false;}
    };
    for(const [action,name,icon] of [
      ['edit','编辑','edit'],['expand','扩图','outpaint'],['reference','引用','reference'],
      ['reuse','做同款','reuse'],['reverse','反推','reverse'],
      ['remove-bg','去背景','cutout']
    ]){
      const b=makeButton(name,icon,'generated-result-action result-toolbar-action');
      b.dataset.action=action;
      b.title=action==='remove-bg'?'去背景：用抠图提示词替换当前描述并开启透明背景':
        action==='expand'?'AI 扩图：在画布外围生成新内容，不拉伸原图':name;
      b.onclick=()=>act(action,b);
      primary.append(b);
    }
    // The trigger is icon-only: the menu itself explains the rare tools.
    const menu=mk('details','result-toolbar-more');
    const summary=mk('summary','result-toolbar-more-trigger');
    summary.append(ico('more'));
    summary.title='更多图片工具';
    summary.setAttribute('aria-label','更多图片工具');
    summary.setAttribute('aria-expanded','false');
    const menuContent=mk('div','result-toolbar-menu');
    menuContent.setAttribute('role','menu');
    menuContent.setAttribute('aria-label','更多图片工具');
    // The crop flyout is portalled to <body> so the scrollable menu can never
    // clip it. It is positioned next to its trigger on every open.
    const submenu=mk('div','result-submenu');
    submenu.setAttribute('role','menu');
    submenu.setAttribute('aria-label','裁切方式');
    submenu.setAttribute('aria-hidden','true');
    document.body.append(submenu);
    const cropGroup=mk('div','result-menu-group');
    const cropParent=makeButton('裁切','crop','result-menu-action result-menu-parent');
    cropParent.dataset.action='crop';
    cropParent.setAttribute('aria-haspopup','menu');
    cropParent.setAttribute('aria-expanded','false');
    const cropCaret=mk('span','result-menu-caret','›');
    cropCaret.setAttribute('aria-hidden','true');
    cropParent.append(cropCaret);
    cropGroup.append(cropParent);
    for(const [action,name,icon] of [
      ['crop','裁切','crop'],['trim-edge','边缘裁切','trim'],['auto-crop','自动裁切','spark']
    ]){
      const b=makeButton(name,icon,'result-submenu-action');
      b.dataset.action=action;
      b.setAttribute('role','menuitem');
      b.onclick=()=>{closeMenu();act(action,b);};
      submenu.append(b);
    }
    function positionSubmenu(){
      if(!submenu.classList.contains('is-open'))return;
      const r=cropParent.getBoundingClientRect();
      const width=submenu.offsetWidth||176,height=submenu.offsetHeight||128;
      let left=r.left-width-6;
      if(left<8)left=Math.min(innerWidth-width-8,r.right+6);
      let top=Math.min(r.top-6,innerHeight-height-8);
      top=Math.max(8,top);
      submenu.style.left=Math.round(left)+'px';
      submenu.style.top=Math.round(top)+'px';
    }
    function openSubmenu(){
      if(!menu.open)return;
      submenu.classList.add('is-open');
      submenu.setAttribute('aria-hidden','false');
      cropParent.setAttribute('aria-expanded','true');
      positionSubmenu();
    }
    function closeSubmenu(){
      if(!submenu.classList.contains('is-open'))return;
      submenu.classList.remove('is-open');
      submenu.setAttribute('aria-hidden','true');
      cropParent.setAttribute('aria-expanded','false');
    }
    function closeMenu(){
      menu.open=false;
      closeSubmenu();
    }
    function fitMenu(){
      if(!menu.open)return;
      const r=summary.getBoundingClientRect();
      const available=Math.max(170,innerHeight-r.bottom-18);
      menuContent.style.maxHeight=Math.min(available,620)+'px';
    }
    cropParent.onclick=e=>{
      e.preventDefault();e.stopPropagation();
      if(submenu.classList.contains('is-open'))closeSubmenu();else openSubmenu();
    };
    cropParent.addEventListener('keydown',e=>{
      if(e.key!=='ArrowRight')return;
      e.preventDefault();openSubmenu();
      submenu.querySelector('button')?.focus();
    });
    submenu.addEventListener('keydown',e=>{
      if(e.key!=='Escape'&&e.key!=='ArrowLeft')return;
      e.preventDefault();e.stopPropagation();closeSubmenu();cropParent.focus();
    });
    const menuAction=(action,name,icon)=>{
      const b=makeButton(name,icon,'result-menu-action');
      b.dataset.action=action;
      b.setAttribute('role','menuitem');
      b.onclick=()=>{closeMenu();act(action,b);};
      return b;
    };
    const separator=()=>mk('div','result-menu-sep');
    menuContent.append(
      menuAction('resize','缩放','resize'),
      cropGroup,
      menuAction('grid9','九宫格缩放','grid9'),
      separator(),
      menuAction('grid','宫格切图','grid'),
      menuAction('rotate','旋转90°','rotate'),
      menuAction('mirror','水平镜像','mirror'),
      separator(),
      menuAction('library','加入素材库','library'),
      menuAction('delete','移除画布图片','trash')
    );
    const menuTitles={
      resize:'本地按比例或像素重采样',
      grid9:'裁成 3×3 九宫格切片',
      grid:'把图片等分为 2×2 四张切片',
      rotate:'顺时针旋转 90°',
      mirror:'水平镜像翻转',
      library:'把这张作品加入当前项目素材库',
      delete:'从画布移除，原图和历史保留'
    };
    for(const [action,title] of Object.entries(menuTitles))
      menuContent.querySelector('[data-action="'+action+'"]')?.setAttribute('title',title);
    cropParent.title='选择手动裁切、边缘裁切或自动裁切';
    menu.append(summary,menuContent);
    menu.addEventListener('toggle',()=>{
      summary.setAttribute('aria-expanded',String(menu.open));
      if(menu.open)fitMenu();else closeSubmenu();
    });
    menu.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&menu.open){
        e.preventDefault();e.stopPropagation();
        if(submenu.classList.contains('is-open')){closeSubmenu();cropParent.focus();}
        else{closeMenu();summary.focus();}
      }
    });
    const outsideMenu=e=>{
      if(!menu.open)return;
      if(menu.contains(e.target)||submenu.contains(e.target))return;
      closeMenu();
    };
    const closeMenuOnScroll=e=>{
      if(!menu.open)return;
      if(menuContent.contains(e.target)||submenu.contains(e.target))return;
      closeMenu();
    };
    const onViewportChange=()=>{
      if(!menu.open)return;
      if(!cropParent.getClientRects().length){closeMenu();return;}
      fitMenu();
      positionSubmenu();
    };
    menuContent.addEventListener('scroll',closeSubmenu,{passive:true});
    document.addEventListener('pointerdown',outsideMenu);
    document.addEventListener('scroll',closeMenuOnScroll,true);
    window.addEventListener('resize',onViewportChange);
    toolbar.append(primary,menu);
    const download=makeButton('','download','generated-result-action result-download');
    download.dataset.action='download';download.title='下载原始图片';
    download.setAttribute('aria-label','下载原始图片');
    download.addEventListener('click',()=>act('download',download));
    footer.append(download);
    toolbar.append(footer); // Download is the last, right-aligned toolbar group.
    return {
      toolbar,editor,
      cleanup(){
        dead=true;
        cleanupSettings();
        document.removeEventListener('pointerdown',outsideMenu);
        document.removeEventListener('scroll',closeMenuOnScroll,true);
        window.removeEventListener('resize',onViewportChange);
        submenu.remove();
        for(const ref of references)if(ref.local)URL.revokeObjectURL(ref.url);
        references.length=0;
      }
    };
  }
  window.HamokiFloatingComposer={create,ratioFallback:RATIO_FALLBACK};
})();
