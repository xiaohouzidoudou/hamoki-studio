/* Hamoki Studio Game-UI Tools: functional catalog, independently authored workflow. */
(() => {
  'use strict';
  const $ = q => document.querySelector(q);
  const $$ = q => [...document.querySelectorAll(q)];
  const categories = ['全部','常用','收藏','UI界面','图标道具','角色生物','场景建筑','海报宣发','特效材质','图像处理','灵感设定','质检交付','买量','小游戏','文游'];
  const intros={
    UI界面:'以游戏内实际交互为目标，清晰呈现面板、信息层级、组件状态和布局关系。',
    图标道具:'围绕游戏物品、技能、资源和货币，统一材质、描边、配色与相对尺寸。',
    角色生物:'基于项目世界观绘制角色和生物，保留角色特征并确保变化版本间的一致性。',
    场景建筑:'面向地图、战斗区域、建筑、地形和游戏世界的可复用环境资产。',
    海报宣发:'突出商业卖点与视觉中心，保留标题和按钮位置的安全留白。',
    特效材质:'生成清晰的材质与视觉特效概念图，留意边缘质量和必要的透明背景。',
    图像处理:'依据参考图进行局部编辑和修正，尽可能保留没有指定修改的部分。',
    灵感设定:'提供美术方向与世界观的视觉设定，突出可讨论、可演化的方案。',
    质检交付:'评估美术结果的清晰、边缘、易读与一致性；真正交付需要专用处理能力。',
    买量:'以单一卖点组织图像，适配推广版面与不同屏幕尺寸。',
    小游戏:'追求易识别、高一致性、低生产成本的轻量游戏素材。',
    文游:'兼顾长文本的阅读体验与角色、剧情、美术场景的可用性。'
  };
  const extra=[
    [/按钮|控件/,'按钮或控件的默认、交互、禁用状态清晰区分，边界和留白一致。'],
    [/弹窗|对话框|面板/,'清晰分出标题、正文、内容区域与关闭/确认控件，不用装饰遮挡信息。'],
    [/HUD|血条|进度条/,'强调整体信息层级，数字及状态标识在小屏幕下仍然清晰。'],
    [/图标|道具|材料|宝箱|货币/,'构成同一系列，排列整齐，套组内物体的光照和相对大小一致。'],
    [/三视图|八方向|多角度/,'角色或物体在不同视角之间保持造型和细节一致。'],
    [/进阶|成长|阶段|形态/,'从简单到复杂逐级变化，保留共同特征，变化程度具有明确节奏。'],
    [/界面换皮|变风格/,'参考原界面的排版和交互布局，只改变视觉表现、配色及装饰材质。'],
    [/拆层|提取|透明/,'重点展示待分离的元素及轮廓；不能把普通图片当作真正带独立图层的文件。'],
    [/动作|序列帧|技能演示/,'姿态和运动方向明确，连续帧之间身份特征与比例稳定。']
  ];
  const icon={
    bookmark:'<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z" fill="#74D2A4" opacity=".22"/><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    upload:'<svg viewBox="0 0 24 24"><path d="M12 17V4M7 9l5-5 5 5" stroke="#74D2A4"/><path d="M4 16v4h16v-4"/></svg>'
  };
  let records=[], category='全部', selected=null, drafts=new Map(), favorites=new Set(), loaded=false, mounting=false;
  try{const prev=JSON.parse(localStorage.getItem('hamoki:game-ui-tools:favs')||'[]');if(Array.isArray(prev))favorites=new Set(prev);}catch{}
  function el(tag,cls,text){
    const e=document.createElement(tag);
    if(cls)e.className=cls;
    if(text!==undefined)e.textContent=String(text);
    return e;
  }
  function snack(text){
    let e=$('#hgToast');
    if(!e){e=el('div','hg-notice');e.id='hgToast';e.setAttribute('role','status');document.body.append(e);}
    e.textContent=text;e.hidden=false;
    clearTimeout(snack.timer);snack.timer=setTimeout(()=>e.hidden=true,2500);
  }
  function mount(){
    if(mounting)return;
    const root=$('.main-content');
    if(!root)return;
    const panel=el('section','hg-plaza');panel.id='hgPlaza';panel.hidden=true;
    panel.innerHTML=[
      '<div class="hg-scroll">',
        '<header class="hg-head"><div><div class="hg-kicker">HAMOKI / GAME UI PRODUCTION</div><h1>游戏美术工具</h1><p>选择制作任务，填写规格与参考图要求，接入原有自由画布工作流。</p></div><div class="hg-head-stat"><strong id="hgTotal">221</strong><span>个工具任务</span></div></header>',
        '<div class="hg-tools"><label class="hg-search"><input id="hgSearch" type="search" placeholder="搜索按钮、图标、面板、背景、拆图…" aria-label="搜索游戏工具"></label><select id="hgType" class="hg-kind" aria-label="工具能力"><option value="all">全部工具</option><option value="image">素材生成</option><option value="edit">参考图编辑</option><option value="processing">图像处理</option><option value="review">质检交付</option></select></div>',
        '<div id="hgCategories" class="hg-categories" role="group" aria-label="游戏工具分类"></div>',
        '<div class="hg-layout"><section class="hg-catalog"><div class="hg-catalog-head"><strong>选择制作任务</strong><span id="hgCount">加载中…</span></div><div class="hg-grid" id="hgGrid"></div><div class="hg-empty" id="hgEmpty" hidden>没有符合条件的工具。</div></section><aside class="hg-editor" id="hgEditor" aria-label="工具参数"><div class="hg-empty-tool"><h3>选择一种制作任务</h3><p>每种任务都带有自己的输入项、参考图要求与输出规格。</p></div></aside></div>',
        '<p class="hg-foot">本地任务目录采用公开功能分类与输入约束，提示词由 Hamoki 独立生成；特殊处理能力不会被假装成已完成。</p>',
      '</div>'
    ].join('');
    root.append(panel);
    const css=document.createElement('link');css.rel='stylesheet';css.href='assets/gameui-tool-plaza.css?v=2';document.head.append(css);
    panel.addEventListener('click',clickPanel);
    panel.addEventListener('input',e=>{
      if(e.target.id==='hgSearch')render();
      if(e.target.matches('[data-field]')&&selected){
        const current=drafts.get(selected.id)||{};
        current[e.target.dataset.field]=e.target.value;
        drafts.set(selected.id,current);
      }
    });
    $('#hgType').addEventListener('change',render);
    mounting=true;
  }
  function showCategories(){
    const num=new Map([['全部',records.length],['常用',records.filter(x=>x.featured).length],['收藏',favorites.size]]);
    records.forEach(t=>num.set(t.category,(num.get(t.category)||0)+1));
    const frag=document.createDocumentFragment();
    for(const name of categories){
      if(!num.has(name))continue;
      const b=el('button','hg-cat',name);b.type='button';b.dataset.category=name;b.setAttribute('aria-pressed',String(name===category));
      b.append(el('small','',num.get(name)));frag.append(b);
    }
    $('#hgCategories').replaceChildren(frag);
  }
  function filtered(){
    const search=($('#hgSearch')?.value||'').trim().toLowerCase(),type=$('#hgType')?.value||'all';
    return records.filter(t=>{
      if(category==='常用'&&!t.featured)return false;
      if(category==='收藏'&&!favorites.has(t.id))return false;
      if(!['全部','常用','收藏'].includes(category)&&t.category!==category)return false;
      if(type!=='all'&&t.taskType!==type)return false;
      if(search&&![t.name,t.category,...(t.tags||[]),...t.fields.map(x=>x.label)].join(' ').toLowerCase().includes(search))return false;
      return true;
    });
  }
  function thumbnail(t){
    const kind=t.category==='角色生物'?'body':t.category==='场景建筑'?'bg':t.taskType==='review'||t.taskType==='processing'?'diagram':'base';
    const box=el('div','hg-card-preview');
    const art=el('div','hg-art');art.style.setProperty('--hue',(t.id.length*9%30-10)+'deg');
    const element=el('div','hg-art-'+kind);
    if(kind==='base')element.append(el('div','hg-art-grid'));
    if(kind==='diagram'){
      const two=el('div','hg-art-diagram');two.append(el('i'),el('i'));element.append(two);
    }
    if(kind==='base'){
      const grid=element.querySelector('.hg-art-grid');for(let i=0;i<6;i++)grid.append(el('i'));
    }
    art.append(element);
    const hasCover=/^assets\/ui-tool-art-[A-Za-z0-9-]+\.webp$/.test(t.preview);
    if(hasCover){
      const img=el('img','hg-stage2-card-preview');
      img.src=t.preview;
      img.alt=t.name+'的原创效果示意图，并非AI实际生成样张';
      img.loading='lazy';img.decoding='async';
      art.hidden=true;
      img.addEventListener('error',()=>{
        img.remove();art.hidden=false;
        const badge=box.querySelector('.hg-stage2-preview-badge');
        if(badge)badge.textContent='示意图加载失败';
      },{once:true});
      box.append(img);
    }
    box.append(art);
    box.append(el('span','hg-category-label',t.category));
    return box;
  }
  function card(t){
    const a=el('article','hg-card');a.classList.toggle('hg-card-selected',selected?.id===t.id);a.dataset.id=t.id;
    a.append(thumbnail(t));
    const info=el('div','hg-card-info');info.append(el('strong','',t.name));
    const meta=el('div','hg-card-meta');
    meta.append(el('span','',t.ratio==='smart'?'自适应':t.ratio));
    meta.append(el('span','',t.requiredImages?('参考图 '+t.requiredImages+'+'):('最多 '+t.maxImages+' 张参考图')));info.append(meta);
    const bottom=el('div','hg-card-bottom');
    const open=el('button','hg-open','配置工具');open.type='button';open.dataset.open=t.id;
    const fav=el('button','hg-fav');fav.type='button';fav.dataset.fav=t.id;fav.innerHTML=icon.bookmark;
    fav.classList.toggle('active',favorites.has(t.id));fav.setAttribute('aria-label',favorites.has(t.id)?'取消收藏':'收藏');
    bottom.append(open,fav);info.append(bottom);a.append(info);return a;
  }
  function render(){
    if(!mounting||!loaded)return;
    showCategories();
    const items=filtered(),frag=document.createDocumentFragment();
    items.forEach(x=>frag.append(card(x)));
    $('#hgGrid').replaceChildren(frag);
    $('#hgEmpty').hidden=items.length!==0;
    $('#hgCount').textContent=items.length+' / '+records.length;
  }
  function inputFor(f){
    const row=el('div','hg-field');const name='hg-f-'+f.key;
    const label=el('label','',f.label+(f.required?' *':''));label.htmlFor=name;row.append(label);
    let input;
    if(f.type==='select'&&f.choices?.length){
      input=el('select');f.choices.forEach(c=>{const option=el('option','',c);option.value=c;input.append(option);});
    }else if(f.type==='textarea'){input=el('textarea');input.rows=3;}
    else{input=el('input');input.type=f.type==='number'?'number':'text';}
    input.id=name;input.dataset.field=f.key;
    const draft=drafts.get(selected.id)||{};
    input.value=draft[f.key]??f.default??'';
    input.required=!!f.required;
    input.maxLength=f.maxLength||600;
    row.append(input);return row;
  }
  function openTool(t){
    selected=t;render();
    const editor=$('#hgEditor');editor.classList.add('hg-tool-open');editor.replaceChildren();
    const heading=el('div','hg-editor-head');
    heading.append(el('small','',t.category));
    const close=el('button','hg-close','×');close.type='button';close.dataset.close='1';close.setAttribute('aria-label','关闭工具');heading.append(close);
    const title=el('h2','',t.name);
    const meta=el('div','hg-editor-meta');
    meta.append(el('span','',t.ratio==='smart'?'自适应':t.ratio),el('span','',t.taskType==='image'?'素材生成':t.taskType==='edit'?'图像编辑':'专用处理'));
    const summary=el('p','hg-editor-summary',intros[t.category]||'生产可供游戏项目使用的美术资源。');
    editor.append(heading,title,meta,summary);
    editor.append(el('div','hg-section-label','参考图要求'));
    const ref=el('p','hg-tip',(t.requiredImages?'至少 '+t.requiredImages+' 张，':'选填，')+'最多 '+t.maxImages+' 张。点击使用工具后，在原生生图工作台上传。');
    editor.append(ref);
    editor.append(el('div','hg-section-label','任务参数'));
    const fields=t.fields.length?t.fields:[{key:'additional',label:'具体制作要求',type:'textarea',required:false}];
    fields.forEach(f=>editor.append(inputFor(f)));
    if(t.taskType==='processing'||t.taskType==='review'){
      const warning=el('p','hg-warn','此任务需要专用图像处理或质检能力。当前保留配置项与任务结构，但尚不能直接输出真实 PSD/独立图层或自动质检报告。');
      editor.append(warning);
    }
    const b=el('button','hg-submit',t.taskType==='processing'||t.taskType==='review'?'复制任务参数':'带入原生生图工作台');
    b.type='button';b.dataset.use=t.id;editor.append(b);
    editor.scrollTop=0;
    if (window.matchMedia('(max-width:780px)').matches) {
      const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      editor.scrollIntoView({block:'start',behavior:reduce?'auto':'smooth'});
    }
  }
  function buildPrompt(t,values){
    const parts=[
      '游戏美术制作任务：'+t.name+'。',
      '任务类型：'+t.category+'。',
      intros[t.category]||'',
      '生成目标：独立清晰、结构明确、风格一致的游戏美术方案。保持颜色、质感、边缘、比例、光照和细节语言的整体统一。'
    ];
    for(const [regex,rule] of extra)if(regex.test(t.name))parts.push(rule);
    const output=t.output||{};
    if(output.layout==='sheet'||output.layout==='4x2'){
      parts.push('输出一张有清晰分隔和足够留白的游戏资产图集，物体完整可见，各单元格互不遮挡，方便后续单独拆分。');
    } else if(output.layout==='front_side_back'){
      parts.push('输出统一比例和光照的正面、侧面、背面多视角设定，各个视角对应同一个主体。');
    } else if(output.layout==='single'){
      parts.push('输出主体完整、构图集中、边缘清楚的单张游戏美术画面。');
    }
    if(output.independentFilesDesired){
      parts.push('本次先呈现可辨识的元素与布局，真正独立文件或PSD分层需通过后续专用拆件流程导出。');
    }
    for(const f of t.fields)if(values[f.key]?.trim())parts.push(f.label+'：'+values[f.key].trim()+'。');
    if(values.additional?.trim())parts.push('补充要求：'+values.additional.trim()+'。');
    if(t.requiredImages)parts.push('使用用户提供的参考图保留主要对象或原有结构，仅更改明确指定的部分。');
    parts.push('不要添加无关装饰、品牌水印和不必要的前景；为后续拆件或修改保留清晰边界。');
    return parts.join('\n');
  }
  function useTool(){
    if(!selected)return;
    const t=selected,values={};
    for(const x of $$('#hgEditor [data-field]'))values[x.dataset.field]=x.value;
    for(const f of t.fields){
      if(f.required&&!String(values[f.key]||'').trim()){
        $('#hg-f-'+f.key)?.focus();
        snack('请填写：'+f.label);return;
      }
    }
    drafts.set(t.id,values);
    const prompt=buildPrompt(t,values);
    if(['review','processing'].includes(t.taskType)){
      navigator.clipboard?.writeText?.(JSON.stringify({tool:t.id,name:t.name,fields:values,prompt},null,2))
        .then(()=>snack('工具配置已复制；专用处理功能尚待接入'))
        .catch(()=>snack('专用处理暂不可用'));
      return;
    }
    close();
    const nav=$('.nav-icon-btn[data-view="image-generate"]');
    if(nav)nav.click();
    const text=$('#prompt-input');
    if(!text){snack('请先打开生图面板');return;}
    text.value=prompt.slice(0,text.maxLength>0?text.maxLength:1000);
    text.dispatchEvent(new Event('input',{bubbles:true}));
    const ratio=$('#ratio-group');
    const btn=ratio&&[...ratio.querySelectorAll('.ratio-button')].find(x=>x.dataset.value===t.ratio);
    btn?.click();
    const panel=$('#params-panel .panel-content');
    if(panel){
      let note=$('#hgToolNotice');
      if(!note){note=el('div','hg-import-note');note.id='hgToolNotice';panel.prepend(note);}
      note.textContent='已载入「'+t.name+'」；'+(t.requiredImages?'请上传至少 '+t.requiredImages+' 张参考图后再生成。':'可以继续编辑提示词并生成。');
    }
    text.focus({preventScroll:true});
  }
  function clickPanel(event){
    const button=event.target.closest('button');
    if(!button)return;
    if(button.dataset.category){category=button.dataset.category;render();return;}
    if(button.dataset.open){const t=records.find(x=>x.id===button.dataset.open);if(t)openTool(t);return;}
    if(button.dataset.fav){
      if(favorites.has(button.dataset.fav))favorites.delete(button.dataset.fav);else favorites.add(button.dataset.fav);
      try{localStorage.setItem('hamoki:game-ui-tools:favs',JSON.stringify([...favorites]))}catch{}
      render();return;
    }
    if(button.dataset.close){selected=null;$('#hgEditor').classList.remove('hg-tool-open');$('#hgEditor').replaceChildren(el('div','hg-empty-tool','选择一个工具以查看任务参数'));render();return;}
    if(button.dataset.use){useTool();}
  }
  function open(){
    mount();if(!mounting)return;
    window.HamokiTemplateLibrary?.close?.();
    const panel=$('#hgPlaza');panel.hidden=false;document.body.classList.add('hg-tools-active');
    if(loaded)return;
    fetch('assets/game-ui-tools.json?v=3')
      .then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json();})
      .then(j=>{if(!Array.isArray(j.items)||j.items.length!==221)throw Error('工具目录数据不完整');records=j.items;loaded=true;$('#hgTotal').textContent=records.length;render();})
      .catch(e=>{$('#hgCount').textContent='加载失败';console.error('[game-ui tools]',e);});
  }
  function close(){document.body.classList.remove('hg-tools-active');const p=$('#hgPlaza');if(p)p.hidden=true;}
  function intercept(e){
    const b=e.target.closest?.('.nav-icon-btn[data-view]');
    if(!b)return;
    if(b.dataset.view==='game-ui'){
      e.preventDefault();e.stopImmediatePropagation();
      $$('.nav-icon-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      open();return;
    }
    if(document.body.classList.contains('hg-tools-active')){
      // Close this in-app tool view, then allow the original V1 navigation
      // handler to update state.currentView and render the selected editor.
      // Stopping propagation here leaves the sidebar and editor out of sync.
      close();
    }
  }
  function boot(){
    mount();
    document.addEventListener('click',intercept,true);
    if($('.nav-icon-btn[data-view="game-ui"]')?.classList.contains('active'))open();
  }
  window.HamokiGameToolPlaza={open,close,buildPrompt};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();