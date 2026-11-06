/* Hamoki Studio V1: in-app template catalog, no navigation and no replacement generator. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const ORDER = ['全部','收藏','节日','手办·3D','头像·证件照','电商','海报·封面','信息图','改图·修复','风格化','插画·表情','摄影','其他'];
  const FAVORITES_KEY = 'hamoki:studio:v1:template-favorites';
  const icons = Object.freeze({
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ico-a" d="m12 2 2 7.5L21.5 12 14 14.5 12 22l-2-7.5L2.5 12 10 9.5z"/></svg>',
    magnify: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="#74D2A4" opacity=".16"/><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h12v17L12 16l-6 4.5z" fill="#74D2A4" opacity=".22"/><path d="M6 3.5h12v17L12 16l-6 4.5z"/></svg>'
  });
  let templates = [];
  let loadPromise = null;
  let category = '全部';
  let selected = null;
  let appliedTemplate = null;
  let toastTimer = 0;
  const favorites = new Set();
  try {
    for (const id of JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]')) {
      if (typeof id === 'string' && /^[a-z0-9-]{2,80}$/.test(id)) favorites.add(id);
    }
  } catch { /* Storage can be disabled in private mode. */ }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function iconButton(kind, title, image) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hmt-icon-button ' + (kind === 'more' ? 'hmt-more' : '');
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = image;
    return button;
  }
  function notify(message) {
    let toast = document.getElementById('hmtToast');
    if (!toast) {
      toast = el('div', 'hmt-toast');
      toast.id = 'hmtToast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.append(toast);
    }
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
  }
  async function copyPrompt(text) {
    try {
      if (!navigator.clipboard?.writeText) throw Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
      notify('提示词已复制');
    } catch {
      const field = document.createElement('textarea');
      field.value = text;
      field.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
      document.body.append(field);
      field.select();
      let success = false;
      try { success = !!document.execCommand('copy'); } catch {}
      field.remove();
      notify(success ? '提示词已复制' : '复制受浏览器权限限制，可以从详情中手动复制');
    }
  }

  function categoryCounts() {
    const counts = new Map([['全部', templates.length], ['收藏', favorites.size]]);
    for (const t of templates) counts.set(t.category, (counts.get(t.category) || 0) + 1);
    return counts;
  }
  function renderTabs() {
    const nav = $('hmtCategories');
    if (!nav) return;
    const counts = categoryCounts();
    const fragment = document.createDocumentFragment();
    for (const value of ORDER) {
      if (!counts.has(value)) continue;
      const button = el('button','hmt-cat');
      button.type = 'button';
      button.dataset.category = value;
      button.setAttribute('aria-pressed',String(category === value));
      button.append(document.createTextNode(value), el('small','',counts.get(value)));
      button.addEventListener('click', () => {
        category = value;
        for (const other of nav.children)
          other.setAttribute('aria-pressed',String(other.dataset.category === category));
        renderCards();
      });
      fragment.append(button);
    }
    nav.replaceChildren(fragment);
  }
  function renderModelTags(group, item) {
    for (const label of (item.models || []).slice(0, 2))
      group.append(el('span','',label));
    if (!item.models?.length) group.append(el('span','','通用生图模型'));
  }
  function makeCard(item) {
    const root = el('article','hmt-card');
    root.dataset.templateId = item.id;
    const media = el('button','hmt-card-media');
    media.type = 'button';
    media.dataset.detail = item.id;
    media.title = '查看' + item.name + '效果和提示词';
    media.setAttribute('aria-label','查看' + item.name + '模板详情');
    const img = document.createElement('img');
    img.src = item.image;
    img.alt = item.name + '模板效果图';
    img.loading = 'lazy';
    img.decoding = 'async';
    media.append(img);
    if (item.models?.length) media.append(el('span','hmt-picture-chip',item.models[0]));
    if (item.referenceRequired) media.append(el('span','hmt-img2img','需要参考图'));
    root.append(media);

    const info = el('div','hmt-card-content');
    const titleLine = el('div','hmt-card-line');
    titleLine.append(el('h3','',item.name));
    if (item.aspectRatio) titleLine.append(el('span','hmt-card-ratio',item.aspectRatio.replace('/', ':')));
    info.append(titleLine);
    const models = el('div','hmt-card-models');
    renderModelTags(models,item);
    info.append(models,el('p','hmt-card-excerpt',item.prompt));

    const actions = el('div','hmt-card-actions');
    const use = el('button','hmt-primary hmt-use');
    use.type = 'button';
    use.dataset.use = item.id;
    use.innerHTML = icons.spark;
    use.append(document.createTextNode('做同款'));
    use.setAttribute('aria-label','使用模板：' + item.name);
    const detail = iconButton('more', '查看完整提示词', icons.magnify);
    detail.dataset.detail = item.id;
    const fav = iconButton('favorite',favorites.has(item.id) ? '取消收藏' : '收藏模板',icons.bookmark);
    fav.dataset.favorite = item.id;
    fav.classList.toggle('is-favorite',favorites.has(item.id));
    fav.setAttribute('aria-pressed',String(favorites.has(item.id)));
    actions.append(use,detail,fav);
    info.append(actions);
    root.append(info);
    return root;
  }
  function renderCards() {
    const query = ($('hmtSearch')?.value || '').trim().toLocaleLowerCase();
    const kind = $('hmtReferenceFilter')?.value || 'all';
    const filtered = templates.filter(item => {
      if (category === '收藏' && !favorites.has(item.id)) return false;
      if (category !== '收藏' && category !== '全部' && category !== item.category) return false;
      if (kind === 'reference' && !item.referenceRequired) return false;
      if (kind === 'text' && item.referenceRequired) return false;
      if (query && ![item.name,item.prompt,item.category,...(item.models || [])]
        .join(' ').toLocaleLowerCase().includes(query)) return false;
      return true;
    });
    const frag = document.createDocumentFragment();
    for (const item of filtered) frag.append(makeCard(item));
    $('hmtGrid').replaceChildren(frag);
    $('hmtVisible').textContent = filtered.length + ' / ' + templates.length + ' 个模板';
    $('hmtEmpty').hidden = filtered.length !== 0;
  }
  function saveFavorites() {
    try { localStorage.setItem(FAVORITES_KEY,JSON.stringify([...favorites])); } catch {}
  }
  function toggleFavorite(id) {
    const exists = favorites.has(id);
    if (exists) favorites.delete(id); else favorites.add(id);
    saveFavorites();
    renderTabs();
    renderCards();
    notify(exists ? '已取消收藏' : '已加入收藏');
  }

  function openDetails(id) {
    const item = templates.find(t => t.id === id);
    if (!item) return;
    selected = item;
    $('hmtDetailImage').src = item.image;
    $('hmtDetailImage').alt = item.name + '模板预览';
    $('hmtDetailTitle').textContent = item.name;
    $('hmtDetailCategory').textContent = item.category;
    $('hmtDetailPrompt').value = item.prompt;
    const tags = $('hmtDetailTags');
    tags.replaceChildren();
    if (item.aspectRatio) tags.append(el('span','',item.aspectRatio.replace('/', ':')));
    for (const m of (item.models || [])) tags.append(el('span','',m));
    $('hmtDetailReference').textContent = item.referenceRequired
      ? '此模板需要上传你的参考图片。示例图仅展示效果，不会被当作参考图自动上传。'
      : '此模板不需要参考图。使用你当前配置的生图模型即可尝试。';
    const modal = $('hmtDetail');
    if (!modal.open) modal.showModal();
  }
  function closeDetails() {
    const modal = $('hmtDetail');
    if (modal?.open) modal.close();
  }

  // Restore only untouched template values: never discard the user's edits.
  function clearAppliedTemplate({reset = false} = {}) {
    const applied = appliedTemplate;
    const input = $('prompt-input');
    if (!reset && applied && input && input.value === applied.prompt) {
      input.value = applied.previousPrompt;
      input.dispatchEvent(new Event('input',{bubbles:true}));
    }
    if (!reset && applied) {
      const group = $('ratio-group');
      const active = group?.querySelector('.ratio-button.active');
      if (active?.dataset.value === applied.ratio) {
        const previous = [...group.querySelectorAll('.ratio-button')]
          .find(button => button.dataset.value === applied.previousRatio);
        previous?.click();
      }
    }
    $('hmtAppliedNote')?.remove();
    appliedTemplate = null;
  }

  /* Use the existing input, native ratio buttons, existing intermediary/model and queue. */
  function applyTemplate(id) {
    const item = templates.find(t => t.id === id);
    if (!item) return false;
    closeDetails();
    const imageNav = document.querySelector('.nav-icon-btn[data-view="image-generate"]');
    imageNav?.click();   // This is an in-app view switch, not an HTTP navigation.
    const textarea = $('prompt-input');
    const group = $('ratio-group');
    if (!textarea || !group) {
      notify('生图面板尚未就绪，请切换到 AI 生图后重试');
      return false;
    }
    const currentRatio = group.querySelector('.ratio-button.active')?.dataset.value || 'auto';
    const previousPrompt = appliedTemplate && textarea.value === appliedTemplate.prompt
      ? appliedTemplate.previousPrompt : textarea.value;
    const previousRatio = appliedTemplate && currentRatio === appliedTemplate.ratio
      ? appliedTemplate.previousRatio : currentRatio;
    textarea.value = item.prompt.slice(0,textarea.maxLength > 0 ? textarea.maxLength : 1000);
    textarea.dispatchEvent(new Event('input',{bubbles:true}));
    const ratio = (item.aspectRatio || '').replace('/',':');
    const available = [...group.querySelectorAll('.ratio-button')];
    const matching = available.find(button => button.dataset.value === ratio);
    if (matching) matching.click();
    appliedTemplate = {
      prompt:textarea.value, ratio:matching?.dataset.value || currentRatio,
      previousPrompt, previousRatio
    };

    const panel = document.querySelector('#params-panel .panel-content');
    if (panel) {
      let note = $('hmtAppliedNote');
      if (!note) {
        note = el('div','hmt-applied-note');
        note.id = 'hmtAppliedNote';
        note.setAttribute('role','status');
        panel.prepend(note);
      }
      const label = el('span','','已带入「' + item.name + '」');
      const context = el('small','',item.referenceRequired
        ? '上传你自己的参考图后即可生成；原有模型设置不会更改。'
        : '提示词和比例已填写；可修改内容后再生成。');
      const back = el('button','hmt-return','返回模板');
      back.type = 'button';
      back.addEventListener('click',()=>document.querySelector('.nav-icon-btn[data-view="templates"]')?.click());
      const remove = el('button','hmt-remove');
      remove.type = 'button';
      remove.title = '移除模板（保留手动编辑的内容）';
      remove.setAttribute('aria-label','移除已带入的模板');
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5 19 19M19 5 5 19"/></svg>';
      remove.addEventListener('click',()=>clearAppliedTemplate());
      const content = el('div','hmt-applied-message');
      content.append(label,context);
      const actions = el('div','hmt-applied-actions');
      actions.append(back,remove);
      note.replaceChildren(content,actions);
    }
    textarea.focus({preventScroll:true});
    return true;
  }

  // Copy and open the text-to-image composer. Existing references make the
  // generator run image-to-image, so ask before clearing them.
  async function copyToTextToImage() {
    const item = selected;
    if (!item) return;
    const refs = window.HamokiReferences;
    const refCount = refs?.files?.().length || 0;
    if (refCount && !(await window.HamokiGlassUI.confirm(`当前生图面板已有 ${refCount} 张参考图。进入文生图需要移除这些参考图，是否继续？`,{title:'确认移除参考图'}))) return;
    await copyPrompt(item.prompt);
    if (refCount) refs.clear();
    applyTemplate(item.id);
  }

  async function loadTemplates() {
    if (loadPromise) return loadPromise;
    loadPromise = fetch('assets/templates.json',{cache:'force-cache'}).then(async res => {
      if (!res.ok) throw Error('HTTP ' + res.status);
      const raw = await res.json();
      if (!Array.isArray(raw)) throw Error('模板数据格式错误');
      templates = raw.filter(t => t && /^[a-z0-9-]{2,80}$/.test(t.id)
        && typeof t.name === 'string' && typeof t.prompt === 'string'
        && /^assets\/tpl-[a-z0-9-]+\.webp$/.test(t.image));
      if (!templates.length) throw Error('没有可用模板');
      $('hmtTotal').textContent = String(templates.length);
      $('hmtStatus').hidden = true;
      renderTabs();
      renderCards();
      return templates;
    }).catch(error => {
      $('hmtStatus').hidden = false;
      $('hmtStatus').textContent = '模板加载失败，请稍后点击模板重试。';
      loadPromise = null;
      console.error('[Hamoki templates]',error);
      return [];
    });
    return loadPromise;
  }

  function open() {
    $('hamokiTemplateScreen').hidden = false;
    document.body.classList.add('hamoki-templates-mode');
    loadTemplates();
  }
  function close() {
    closeDetails();
    document.body.classList.remove('hamoki-templates-mode');
    $('hamokiTemplateScreen').hidden = true;
  }
  function init() {
    const grid = $('hmtGrid');
    if (!grid) return;
    grid.addEventListener('click', event => {
      const target = event.target.closest('button');
      if (!target || !grid.contains(target)) return;
      if (target.dataset.use) applyTemplate(target.dataset.use);
      else if (target.dataset.detail) openDetails(target.dataset.detail);
      else if (target.dataset.favorite) toggleFavorite(target.dataset.favorite);
    });
    $('hmtSearch').addEventListener('input',renderCards);
    $('hmtReferenceFilter').addEventListener('change',renderCards);
    $('hmtReset').addEventListener('click', () => {
      category = '全部';
      $('hmtSearch').value = '';
      $('hmtReferenceFilter').value = 'all';
      renderTabs();
      renderCards();
    });
    $('hmtDialogClose').addEventListener('click',closeDetails);
    $('hmtDetailCopy').addEventListener('click',()=>{ void copyToTextToImage(); });
    $('hmtDetailUse').addEventListener('click',()=>{ if(selected) applyTemplate(selected.id); });
    $('hmtDetail').addEventListener('click',event => {
      if (event.target === $('hmtDetail')) closeDetails();
    });
    document.addEventListener('keydown', event => {
      if (!document.body.classList.contains('hamoki-templates-mode') || $('hmtDetail').open) return;
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey &&
        !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) {
        event.preventDefault(); $('hmtSearch').focus();
      } else if (event.key === 'Escape' && document.activeElement === $('hmtSearch')) {
        $('hmtSearch').value = ''; renderCards(); $('hmtSearch').blur();
      }
    });
    if (new URLSearchParams(location.search).get('view') === 'templates')
      document.querySelector('.nav-icon-btn[data-view="templates"]')?.click();
  }
  // Flow navigation is captured by the existing workflow module. Close the
  // template view before that module handles the same click.
  document.addEventListener('click', event => {
    if (!document.body.classList.contains('hamoki-templates-mode')) return;
    if (event.target.closest?.('.nav-icon-btn[data-view="game-ui-flow"]')) close();
  }, true);
  window.HamokiTemplateLibrary = Object.freeze({open,close,applyTemplate,clearAppliedTemplate});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
