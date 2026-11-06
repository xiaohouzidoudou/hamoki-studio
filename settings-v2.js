'use strict';
(() => {
  let root, providers = [], activeId = null, editingId = null, prevFocus = null, models = [];
  const providerCheckResults = new Map();
  const $ = id => document.getElementById('hs-' + id);
  const el = (tag, cls, text) => {
    const x = document.createElement(tag);
    if (cls) x.className = cls;
    if (text !== undefined) x.textContent = text;
    return x;
  };
  async function request(url, options) {
    const init = {cache:'no-store', ...(options || {})};
    const method = String(init.method || 'GET').toUpperCase();
    if (['POST','PUT','PATCH'].includes(method)) {
      // All mutating API requests expect JSON, including actions with no payload.
      const headers = new Headers(init.headers || {});
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      init.headers = headers;
      if (init.body == null) init.body = '{}';
    }
    let response;
    try { response = await fetch(url, init); }
    catch { throw Error('本地服务无法连接，请通过 http://127.0.0.1:8028/ 访问本项目'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || '请求失败：HTTP ' + response.status);
    return data;
  }
  const json = obj => ({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
  function notice(text, error = false, form = false) {
    const x = $(form ? 'form-message' : 'message');
    x.textContent = text; x.classList.toggle('error', error); x.hidden = !text;
  }
  function busy(button, flag, caption) {
    if (flag) { button.dataset.oldText = button.textContent; button.textContent = caption || '处理中…'; button.disabled = true; }
    else {button.textContent = button.dataset.oldText || button.textContent; button.disabled = false;}
  }
  function createRoot() {
    if (root) return;
    root = el('div','hs-backdrop'); root.id = 'hs-overlay'; root.hidden = true;
    root.innerHTML = `
      <section class="hs-dialog" role="dialog" aria-modal="true" aria-labelledby="hs-title">
        <header class="hs-head"><div><h2 id="hs-title">设置</h2><p>配置中转站与模型。API Key 由本地服务加密保存。</p></div><button id="hs-close" type="button" aria-label="关闭设置">×</button></header>
        <div class="hs-body">
          <div id="hs-advanced" class="hs-advanced">

          <div class="hs-toolbar"><h3>中转站配置</h3><button id="hs-add" class="hs-primary" type="button">＋ 添加中转站</button></div>
          <p id="hs-message" role="status" aria-live="polite" class="hs-message" hidden></p>
          <div id="hs-providers" class="hs-providers"></div>
          <form id="hs-form" class="hs-form" hidden>
            <h3 id="hs-form-title">添加中转站</h3>
            <div class="hs-fields">
              <label>名称<input id="hs-name" maxlength="60" autocomplete="off" placeholder="例如：OpenAI 中转站" required></label>
              <label>接口类型<select id="hs-mode"><option value="openai">OpenAI 兼容</option><option value="gemini">Gemini</option></select></label>
              <label class="hs-span">基础地址<input id="hs-url" type="url" placeholder="https://example.com/v1" required></label>
              <label class="hs-span">API Key<input id="hs-key" type="password" autocomplete="new-password" placeholder="请输入 API Key"></label>
              <label>图像接口<select id="hs-image-mode"><option value="images">Images</option><option value="chat">Chat Completions</option><option value="responses">Responses</option></select></label>
              <div class="hs-fetch"><span>可用模型</span><button id="hs-discover" type="button">获取模型</button></div>
              <label>生图模型<input id="hs-image-model" placeholder="gpt-image-2" required></label>
              <label>识图模型<input id="hs-vision-model" placeholder="gpt-4o-mini" required></label>
            </div>
            <section id="hs-model-result" class="hs-model-result" hidden>
              <div class="hs-filter"><strong>返回的模型</strong><input id="hs-model-filter" placeholder="搜索模型 ID" type="search"></div>
              <div id="hs-model-list" class="hs-model-list"></div>
              <small>选择「生图」或「识图」填入模型。能列出模型不代表支持图片生成。</small>
            </section>
            <p id="hs-form-message" role="status" aria-live="polite" class="hs-message" hidden></p>
            <div class="hs-form-actions"><button class="hs-primary" id="hs-save" type="submit">保存</button><button id="hs-cancel" type="button">取消</button></div>
          </form>
          <p class="hs-footnote">API Key 不会回显；测试连接只读取模型列表，不会调用付费生图。实际生图需由上游模型支持。</p>
          </div>
        </div>
      </section>`;
    document.body.appendChild(root);
    $('close').addEventListener('click', close);
    root.addEventListener('click', ev => { if (ev.target === root) close(); });
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !root.hidden) close(); });
    $('add').addEventListener('click', () => showForm(null));
    $('cancel').addEventListener('click', cancelForm);
    $('form').addEventListener('submit', save);
    $('discover').addEventListener('click', discover);
    $('model-filter').addEventListener('input', renderModels);
    $('mode').addEventListener('change', () => {
      $('image-mode').disabled = $('mode').value === 'gemini';
      if ($('mode').value === 'gemini') {
        if (!$('image-model').value || $('image-model').value === 'gpt-image-2') $('image-model').value = 'gemini-2.5-flash-image';
        if (!$('vision-model').value || $('vision-model').value === 'gpt-4o-mini') $('vision-model').value = 'gemini-2.5-flash';
      }
    });
  }
  async function open() {
    createRoot(); prevFocus = document.activeElement; root.hidden = false;
    document.body.classList.add('hs-modal-open'); $('close').focus();
    if (new URLSearchParams(location.search).get('settings') === '1') history.replaceState(null, '', location.pathname);
    await refresh();
  }
  function close() {
    if (!root || root.hidden) return;
    cancelForm(); root.hidden = true; document.body.classList.remove('hs-modal-open');
    if (prevFocus?.isConnected) prevFocus.focus();
  }
  async function refresh() {
    if (!root) return;
    $('providers').replaceChildren(el('p','hs-empty','读取中转站列表…'));
    try {
      const data = await request('/api/providers');
      providers = data.providers || []; activeId = data.activeId;
      renderProviders();
      if (typeof loadProvidersToSelect === 'function') loadProvidersToSelect();
    } catch (e) { $('providers').replaceChildren(el('p','hs-empty',e.message)); notice(e.message,true); }
  }
  function button(label, cls, fn) {
    const x = el('button', cls, label); x.type = 'button'; x.addEventListener('click', () => fn(x)); return x;
  }
  // Preset is a pinned configuration recipe, not an extra duplicate saved provider.
  // The API Key is handled only by the server-side encrypted provider store.
  const PIG = Object.freeze({
    name:'生图的小猪',
    url:'https://pig.tuut.cc/v1',
    mode:'openai',
    imageMode:'images',
    imageModel:'gpt-image-2.5-flare',
    visionModel:'gpt-6.1-terra'
  });
  function presetProvider() {
    return providers.find(p => p.name === PIG.name && p.url === PIG.url && p.mode === PIG.mode)
      || providers.find(p => p.url === PIG.url && p.mode === PIG.mode &&
        p.imageMode === PIG.imageMode && p.imageModel === PIG.imageModel &&
        p.visionModel === PIG.visionModel)
      || null;
  }
  function presetMessage(message,bad=false) {
    const node=$('pig-message');
    if(!node) return;
    node.textContent=message;
    node.hidden=!message;
    node.classList.toggle('error',bad);
  }
  function renderPreset(p) {
    const card=el('section','hs-provider hs-pig-provider'+(p?.id===activeId?' active':''));
    card.id='hs-pig-provider';
    const info=el('div','hs-provider-info');
    const heading=el('strong','','');
    heading.append(document.createTextNode(PIG.name),el('span','hs-badge','内置'));
    if(p?.id===activeId) heading.append(el('span','hs-badge','使用中'));
    info.append(heading,el('small','',PIG.url));
    info.append(el('small','hs-pig-details','OpenAI 兼容 · Images · 生图 '+(p?.imageModel||PIG.imageModel)+' · 识图 '+(p?.visionModel||PIG.visionModel)));
    card.append(info);
    const form=el('form','hs-pig-form');
    form.id='hs-pig-form';
    form.noValidate=true;
    const label=el('label','hs-pig-key-label','API Key');
    const input=el('input','hs-pig-key');
    input.id='hs-pig-key';
    input.type='password';
    input.autocomplete='new-password';
    input.setAttribute('aria-label','生图的小猪 API Key');
    input.placeholder=p?.hasKey?'已保存密钥，留空则继续使用':'粘贴 API Key 即可启用';
    input.required=!p?.hasKey;
    label.append(input);
    const save=el('button','hs-primary','保存并启用');
    save.id='hs-pig-save';
    save.type='submit';
    form.append(label,save);
    const picker=el('div','hs-pig-model-picker');
    const discovery=button('获取模型','hs-pig-discover',async btn => {
      const key=input.value.trim();
      if(!key&&!p?.hasKey){presetMessage('请先填写 API Key，再获取模型',true);input.focus();return;}
      busy(btn,true,'获取中…');
      try {
        const result=key
          ? await request('/api/providers/discover-models',json({url:PIG.url,mode:PIG.mode,apiKey:key}))
          : await request('/api/models?providerId='+encodeURIComponent(p.id));
        const ids=[...new Set((result.models||[]).filter(x=>typeof x==='string'&&x.trim()))];
        if(!ids.length)throw Error('上游没有返回模型 ID');
        for(const select of [imageSelect,visionSelect]){
          const current=select.value;
          select.replaceChildren();
          for(const id of [current,...ids].filter((x,i,a)=>x&&a.indexOf(x)===i)){
            const opt=el('option','',id);opt.value=id;select.append(opt);
          }
          select.value=current;
        }
        presetMessage('已获取 '+ids.length+' 个模型，请分别选择生图和识图模型，然后保存。');
      }catch(e){presetMessage('获取模型失败：'+e.message+'。仍可使用原模型。',true);}
      finally{busy(btn,false);}
    });
    const modelField=(title,id,current)=>{
      const wrapper=el('label','hs-pig-model-field',title);
      const select=el('select','');select.id=id;
      const opt=el('option','',current);opt.value=current;select.append(opt);
      wrapper.append(select);picker.append(wrapper);return select;
    };
    const imageSelect=modelField('生图模型','hs-pig-image-model',p?.imageModel||PIG.imageModel);
    const visionSelect=modelField('识图模型','hs-pig-vision-model',p?.visionModel||PIG.visionModel);
    picker.append(discovery);
    card.append(picker);
    if (p?.hasKey && p.id !== activeId) {
      const activate=button('激活','',async b => {
        busy(b,true,'切换中…');
        try {
          await request('/api/providers/'+p.id+'/activate',{method:'POST'});
          await refresh();
          notice('已激活：'+PIG.name);
        } catch(e) {
          presetMessage('激活失败：'+e.message,true);
          busy(b,false);
        }
      });
      activate.id='hs-pig-activate';
      form.append(activate);
    }
    form.addEventListener('submit',event=>{event.preventDefault();void savePreset();});
    card.append(form);
    const hint=el('p','hs-pig-hint','地址和接口固定；模型可获取后选择。获取列表不扣生图费用，也不代表模型支持生图。');
    card.append(hint);
    const status=el('p','hs-message');
    status.id='hs-pig-message';
    status.setAttribute('role','status');
    status.setAttribute('aria-live','polite');
    status.hidden=true;
    card.append(status);
    return card;
  }
  async function savePreset() {
    const existing=presetProvider();
    const key=$('pig-key')?.value.trim()||'';
    if(!key&&!existing?.hasKey){
      presetMessage('请先填写 API Key',true);
      $('pig-key')?.focus();
      return;
    }
    const data={...PIG,imageModel:$('pig-image-model')?.value||existing?.imageModel||PIG.imageModel,
      visionModel:$('pig-vision-model')?.value||existing?.visionModel||PIG.visionModel,
      responseModel:existing?.responseModel||''};
    if(key)data.apiKey=key;
    const button=$('pig-save');
    if(!button||button.disabled) return;
    busy(button,true,'保存中…');
    try {
      const result=await request(existing?'/api/providers/'+existing.id:'/api/providers',{
        method:existing?'PUT':'POST',
        body:JSON.stringify(data)
      });
      const id=existing?.id||result.provider?.id;
      if(!id) throw Error('中转站保存成功，但未返回服务商标识');
      await request('/api/providers/'+id+'/activate',{method:'POST'});
      await refresh();
      notice('「生图的小猪」已保存并启用；所选生图和识图模型已生效。');
    } catch(error){
      presetMessage('保存失败：'+error.message,true);
    } finally {
      busy(button,false);
    }
  }

  // Keep test feedback attached to its own provider row, even after the list re-renders.
  function renderProviderCheck(id) {
    const card = [...document.querySelectorAll('#hs-providers [data-provider-id]')]
      .find(node => node.dataset.providerId === id);
    const slot = card?.querySelector('.hs-provider-check');
    if (!slot) return;
    const result = providerCheckResults.get(id);
    slot.replaceChildren();
    slot.hidden = !result;
    if (!result) return;
    slot.classList.toggle('is-success', result.kind === 'success');
    slot.classList.toggle('is-error', result.kind === 'error');
    slot.classList.toggle('is-pending', result.kind === 'pending');
    slot.append(el('strong','hs-check-title', result.title));
    if (result.detail) slot.append(el('span','hs-check-detail',result.detail));
  }
  function setProviderCheck(id, kind, title, detail) {
    providerCheckResults.set(id,{kind,title,detail});
    renderProviderCheck(id);
  }

  function renderProviders() {
    const list = $('providers'); list.replaceChildren();
    const pinned=presetProvider();
    list.append(renderPreset(pinned));
    const others=providers.filter(p=>p.id!==pinned?.id);
    if(!others.length){list.append(el('p','hs-empty','其他中转站可使用右上角按钮添加。'));return;}
    for (const p of others) {
      const box = el('article','hs-provider' + (p.id === activeId ? ' active' : ''));
      box.dataset.providerId=p.id;
      const info = el('div','hs-provider-info');
      const title = el('strong','',p.name);
      if (p.id === activeId) title.append(el('span','hs-badge','使用中'));
      info.append(title,el('small','',p.url),
        el('small','',(p.mode === 'gemini' ? 'Gemini' : 'OpenAI 兼容') + ' · ' + (p.imageModel || '未设置模型') + ' · ' + (p.hasKey ? '密钥已保存' : '缺少密钥')));
      const check = el('div','hs-provider-check');
      check.setAttribute('role','status');
      check.setAttribute('aria-live','polite');
      check.setAttribute('aria-atomic','true');
      check.hidden=true;
      const actions = el('div','hs-provider-actions');
      if (p.id !== activeId) actions.append(button('激活','',async b => {
        busy(b,true,'切换中…');
        try {await request('/api/providers/'+p.id+'/activate',{method:'POST'}); await refresh(); notice('已激活：'+p.name);}
        catch(e) {notice(e.message,true);busy(b,false);}
      }));
      actions.append(button('编辑','',()=>showForm(p.id)));
      actions.append(button('测试','',async b => {
        setProviderCheck(p.id,'pending','正在测试','读取模型列表…');
        busy(b,true,'测试中…');
        try {
          const result = await request('/api/providers/'+p.id+'/check');
          if (result.reachable) {
            const latency=Number.isFinite(Number(result.latencyMs)) ? Math.round(Number(result.latencyMs))+' ms' : '耗时未知';
            const count=Array.isArray(result.models)?result.models.length:0;
            setProviderCheck(p.id,'success','连接成功',latency+' · '+count+' 个模型');
          } else {
            setProviderCheck(p.id,'error','连接失败',result.error||'模型接口不可用');
          }
        } catch(e) {setProviderCheck(p.id,'error','测试失败',e.message);}
        finally {busy(b,false);}
      }));
      actions.append(button('删除','hs-danger',async b => {
        if (!(await window.HamokiGlassUI.confirm('确定删除「'+p.name+'」？已保存的密钥与配置将删除。',{title:'删除中转站',confirmLabel:'删除',danger:true}))) return;
        busy(b,true,'删除中…');
        try {await request('/api/providers/'+p.id,{method:'DELETE'}); providerCheckResults.delete(p.id); await refresh(); notice('已删除：'+p.name);}
        catch(e){notice(e.message,true);busy(b,false);}
      }));
      box.append(info,check,actions); list.append(box);
      renderProviderCheck(p.id);
    }
  }
  function showForm(id) {
    editingId = id; models = [];
    const p = providers.find(x => x.id === id);
    $('form').reset(); $('form').hidden = false; $('form-title').textContent = p ? '编辑中转站' : '添加中转站';
    $('name').value = p?.name || '';
    $('mode').value = p?.mode || 'openai';
    $('url').value = p?.url || '';
    $('key').value = '';
    $('key').required = !p || !p.hasKey;
    $('key').placeholder = p?.hasKey ? '留空则保留原密钥' : '请输入 API Key';
    $('image-mode').value = p?.mode === 'openai' ? p.imageMode || 'images' : 'images';
    $('image-mode').disabled = $('mode').value === 'gemini';
    $('image-model').value = p?.imageModel || 'gpt-image-2';
    $('vision-model').value = p?.visionModel || 'gpt-4o-mini';
    $('save').textContent = p ? '保存修改' : '保存并添加';
    $('model-result').hidden = true; $('model-filter').value = ''; notice('',false,true); $('name').focus();
  }
  function cancelForm() {
    if (!root) return;
    editingId = null; models = []; $('form').hidden = true; $('form').reset();
    $('model-result').hidden = true; notice('',false,true);
  }
  function readForm() {
    return {name:$('name').value.trim(),mode:$('mode').value,url:$('url').value.trim(),apiKey:$('key').value.trim(),
      imageMode:$('mode').value === 'gemini' ? 'gemini' : $('image-mode').value,
      imageModel:$('image-model').value.trim(),visionModel:$('vision-model').value.trim()};
  }
  async function save(ev) {
    ev.preventDefault();
    const b = readForm();
    if (!b.name || !b.url || !b.imageModel || !b.visionModel || (!editingId && !b.apiKey)) return notice('请填写名称、地址、密钥和模型 ID。',true,true);
    try {if (new URL(b.url).protocol !== 'https:') throw Error('只允许 HTTPS 中转站地址');}
    catch(e) {return notice(e.message === 'Invalid URL' ? '基础地址格式不合法' : e.message,true,true);}
    if (editingId && !b.apiKey) delete b.apiKey;
    const btn = $('save');busy(btn,true,'保存中…');
    try {
      const path = editingId ? '/api/providers/'+editingId : '/api/providers';
      await request(path,{method:editingId?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
      if (editingId) providerCheckResults.delete(editingId);
      cancelForm();await refresh();notice('设置已保存，生图界面的中转站列表已同步。');
    } catch(e) {notice('保存失败：'+e.message,true,true);}
    finally {busy(btn,false);}
  }
  async function discover() {
    const b = readForm(); if (!b.url) return notice('请先填写地址',true,true);
    const old = providers.find(p => p.id === editingId);
    const existing = old && !b.apiKey && b.mode === old.mode && b.url === old.url;
    if (!existing && !b.apiKey) return notice('请填写当前地址的 API Key',true,true);
    const btn = $('discover'); busy(btn,true,'获取中…');
    try {
      const result = existing
        ? await request('/api/models?providerId='+encodeURIComponent(editingId))
        : await request('/api/providers/discover-models',json({url:b.url,mode:b.mode,apiKey:b.apiKey}));
      models = (result.models||[]).filter(x => typeof x === 'string');
      $('model-result').hidden = false;renderModels();
      notice(models.length
        ? '找到 '+models.length+' 个模型。选择「生图」或「识图」即可填入对应栏位。'
        : '上游未返回模型。可以手动输入模型 ID。',!models.length,true);
    } catch(e) {notice('获取模型失败：'+e.message+'。有些站点不提供 /models，请手动输入。',true,true);}
    finally {busy(btn,false);}
  }
  function renderModels() {
    const list = $('model-list'); list.replaceChildren();
    const keyword = $('model-filter').value.toLowerCase().trim();
    let count = 0;
    for (const model of models) {
      if (keyword && !model.toLowerCase().includes(keyword)) continue;
      if (count++ >= 80) break;
      const row = el('div','hs-model-row'); row.append(el('span','',model),
        button('生图','',()=>{$('image-model').value = model;notice('已选择生图模型：'+model,false,true);}),
        button('识图','',()=>{$('vision-model').value = model;notice('已选择识图模型：'+model,false,true);}));
      list.append(row);
    }
    if (!count) list.append(el('p','hs-empty','没有匹配的模型'));
  }
  window.HamokiSettings = {open,close,refresh};
  document.addEventListener('DOMContentLoaded', () => {
    if (new URLSearchParams(location.search).get('settings') === '1') open();
  });
})();
