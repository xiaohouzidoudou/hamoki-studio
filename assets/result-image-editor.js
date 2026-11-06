/* Hamoki Studio – local, zero-model image tools for generated results.
   Crop / scale / expand run entirely in the browser on a canvas copy; the
   original node and history entry are never modified. */
'use strict';
(() => {
  const mk = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = String(text);
    return el;
  };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const MAX_SIDE = 8192;
  const MAX_PIXELS = 24e6;
  const MIN_SIDE = 16;
  let current = null;

  function open(options) {
    if (current) current.close(false);
    const { url, mode = 'crop', onApply } = options || {};
    if (!url) return Promise.reject(Error('没有可读取的图片地址'));
    if (!['crop', 'scale', 'expand'].includes(mode)) return Promise.reject(Error('不支持的图片处理方式'));

    const state = {
      mode,
      img: null,
      ready: false,
      busy: false,
      crop: { x: 0, y: 0, w: 0, h: 0 },
      scale: { w: 0, h: 0, lock: true },
      expand: { l: 20, r: 20, t: 20, b: 20, bg: 'transparent' },
      aspect: 'free',
      view: { scale: 1, cssW: 0, cssH: 0 },
      drag: null
    };
    let canvas, ctx, stage, controls, applyButton, cancelButton, hintNode, errorNode;
    let resolveClose = () => {};
    let previousFocus = document.activeElement;
    let observer = null;

    const backdrop = mk('div', 'rie-backdrop');
    const panel = mk('div', 'rie-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'rie-title');
    const head = mk('header', 'rie-head');
    const headText = mk('div', 'rie-head-text');
    headText.append(
      mk('span', 'rie-kicker', '本地图片工具 · 不调用模型'),
      Object.assign(mk('h2', 'rie-title', mode === 'crop' ? '裁切图片' : mode === 'scale' ? '缩放图片' : '扩图'), { id: 'rie-title' }),
      mk('p', 'rie-subtitle', mode === 'crop'
        ? '在图片上拖动选框，或直接输入像素位置；确认后生成一张新图。'
        : mode === 'scale'
          ? '按百分比或像素重采样，原图保持不变。'
          : '向外扩展画布，扩展区可用透明、白底或边缘延展补齐。')
    );
    const closeButton = mk('button', 'rie-close', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', '关闭图片工具');
    closeButton.title = '关闭';
    head.append(headText, closeButton);

    const body = mk('div', 'rie-body');
    stage = mk('div', 'rie-stage');
    canvas = mk('canvas', 'rie-canvas');
    canvas.setAttribute('aria-label', '图片预览');
    const loading = mk('div', 'rie-loading', '正在读取图片…');
    stage.append(canvas, loading);
    controls = mk('aside', 'rie-controls');
    body.append(stage, controls);

    const foot = mk('footer', 'rie-foot');
    hintNode = mk('span', 'rie-hint', '正在读取原图…');
    errorNode = mk('p', 'rie-error');
    errorNode.setAttribute('role', 'alert');
    errorNode.hidden = true;
    const actions = mk('div', 'rie-actions');
    cancelButton = mk('button', 'rie-cancel', '取消');
    cancelButton.type = 'button';
    applyButton = mk('button', 'rie-apply', '应用');
    applyButton.type = 'button';
    applyButton.disabled = true;
    actions.append(cancelButton, applyButton);
    foot.append(hintNode, actions);
    panel.append(head, body, foot, errorNode);
    backdrop.append(panel);
    document.body.append(backdrop);
    document.body.classList.add('rie-open');

    ctx = canvas.getContext('2d');
    const close = result => {
      if (!backdrop.isConnected) return;
      observer?.disconnect();
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onWindowResize);
      backdrop.remove();
      document.body.classList.remove('rie-open');
      if (current && current.close === close) current = null;
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      resolveClose(result === true);
    };
    current = { close };

    function note(message) {
      errorNode.textContent = message || '';
      errorNode.hidden = !message;
    }
    function canApply() {
      if (!state.ready || state.busy || !state.img) return false;
      if (mode === 'crop') return state.crop.w >= 8 && state.crop.h >= 8;
      if (mode === 'scale') return !validateSize(state.scale.w, state.scale.h);
      const size = expandOutputSize();
      return !validateSize(size.w, size.h);
    }
    function validateSize(w, h) {
      if (!Number.isFinite(w) || !Number.isFinite(h) || w < MIN_SIDE || h < MIN_SIDE) return '宽高至少 ' + MIN_SIDE + ' 像素';
      if (w > MAX_SIDE || h > MAX_SIDE) return '单边不能超过 ' + MAX_SIDE + ' 像素';
      if (w * h > MAX_PIXELS) return '总像素不能超过 2400 万';
      return '';
    }
    function refreshApply() {
      applyButton.disabled = !canApply();
    }
    function setBusy(busy) {
      state.busy = busy;
      applyButton.textContent = busy ? '正在保存…' : '应用';
      cancelButton.disabled = busy;
      closeButton.disabled = busy;
      refreshApply();
    }
    function outputSize() {
      if (mode === 'crop') return { w: Math.round(state.crop.w), h: Math.round(state.crop.h) };
      if (mode === 'scale') return { w: Math.round(state.scale.w), h: Math.round(state.scale.h) };
      return expandOutputSize();
    }
    function expandMargins() {
      const img = state.img;
      return {
        l: Math.round(img.width * state.expand.l / 100),
        r: Math.round(img.width * state.expand.r / 100),
        t: Math.round(img.height * state.expand.t / 100),
        b: Math.round(img.height * state.expand.b / 100)
      };
    }
    function expandOutputSize() {
      const img = state.img;
      if (!img) return { w: 0, h: 0 };
      const m = expandMargins();
      return { w: img.width + m.l + m.r, h: img.height + m.t + m.b };
    }
    function updateHint() {
      const img = state.img;
      if (!img) return;
      const size = outputSize();
      if (mode === 'crop') hintNode.textContent = '输出 ' + size.w + ' × ' + size.h + ' px · 原图 ' + img.width + ' × ' + img.height;
      else if (mode === 'scale') hintNode.textContent = '输出 ' + size.w + ' × ' + size.h + ' px · 原图 ' + img.width + ' × ' + img.height;
      else hintNode.textContent = '输出 ' + size.w + ' × ' + size.h + ' px · 原图 ' + img.width + ' × ' + img.height + ' · 扩展区' + ({ transparent: '透明', white: '白底', edge: '边缘延展' }[state.expand.bg]);
      refreshApply();
    }
    function layout() {
      if (!state.img) return;
      const img = state.img;
      const box = stage.getBoundingClientRect();
      const availW = Math.max(120, box.width - 28);
      const availH = Math.max(120, box.height - 28);
      const size = mode === 'expand' ? expandOutputSize() : { w: img.width, h: img.height };
      const scale = Math.min(availW / size.w, availH / size.h, 4);
      const cssW = Math.max(1, Math.round(size.w * scale));
      const cssH = Math.max(1, Math.round(size.h * scale));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      canvas.width = Math.max(1, Math.round(cssW * dpr));
      canvas.height = Math.max(1, Math.round(cssH * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      state.view = { scale, cssW, cssH };
      syncCropFields();
      updateHint();
      draw();
    }
    function scheduleLayout() {
      requestAnimationFrame(layout);
    }
    function drawCheckerboard(w, h) {
      ctx.save();
      ctx.fillStyle = '#1C1C1E';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#2C2C2E';
      const cell = 10;
      for (let y = 0; y < h; y += cell) {
        for (let x = 0; x < w; x += cell) {
          if (((x / cell) + (y / cell)) % 2 === 0) ctx.fillRect(x, y, Math.min(cell, w - x), Math.min(cell, h - y));
        }
      }
      ctx.restore();
    }
    function drawCrop() {
      const img = state.img, { scale, cssW, cssH } = state.view;
      const c = state.crop;
      const x = c.x * scale, y = c.y * scale, w = c.w * scale, h = c.h * scale;
      ctx.save();
      ctx.fillStyle = 'rgba(5,9,13,.62)';
      ctx.fillRect(0, 0, cssW, Math.max(0, y));
      ctx.fillRect(0, y + h, cssW, Math.max(0, cssH - y - h));
      ctx.fillRect(0, y, Math.max(0, x), h);
      ctx.fillRect(x + w, y, Math.max(0, cssW - x - w), h);
      ctx.strokeStyle = 'rgba(255,255,255,.22)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(x + w * i / 3, y); ctx.lineTo(x + w * i / 3, y + h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, y + h * i / 3); ctx.lineTo(x + w, y + h * i / 3); ctx.stroke();
      }
      ctx.strokeStyle = '#0A84FF';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + .75, y + .75, Math.max(0, w - 1.5), Math.max(0, h - 1.5));
      for (const point of handlePoints(x, y, w, h)) {
        ctx.fillStyle = '#1C1C1E';
        ctx.fillRect(point.x - 4, point.y - 4, 8, 8);
        ctx.strokeStyle = '#0A84FF';
        ctx.lineWidth = 1;
        ctx.strokeRect(point.x - 4, point.y - 4, 8, 8);
      }
      const label = Math.round(c.w) + ' × ' + Math.round(c.h);
      ctx.font = '600 11px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
      const tw = ctx.measureText(label).width + 12;
      let bx = x + 8, by = y + 8;
      if (by + 18 > y + h) by = Math.max(y + 4, y + h - 22);
      if (bx + tw > x + w) bx = Math.max(x + 4, x + w - tw - 8);
      ctx.fillStyle = 'rgba(28,28,30,.90)';
      ctx.fillRect(bx, by, tw, 18);
      ctx.strokeStyle = 'rgba(255,255,255,.12)';
      ctx.strokeRect(bx + .5, by + .5, tw - 1, 17);
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.fillText(label, bx + 6, by + 13);
      ctx.restore();
    }
    function drawEdgeFill(cssW, cssH, margins) {
      const img = state.img, scale = state.view.scale;
      ctx.drawImage(img, 0, 0, cssW, cssH);
      const x = margins.l * scale, y = margins.t * scale;
      const iw = img.width * scale, ih = img.height * scale;
      ctx.drawImage(img, 0, 0, img.width, 1, 0, 0, cssW, y);
      ctx.drawImage(img, 0, img.height - 1, img.width, 1, 0, y + ih, cssW, cssH - y - ih);
      ctx.drawImage(img, 0, 0, 1, img.height, 0, y, x, ih);
      ctx.drawImage(img, img.width - 1, 0, 1, img.height, x + iw, y, cssW - x - iw, ih);
    }
    function draw() {
      if (!state.img) return;
      const img = state.img, { cssW, cssH, scale } = state.view;
      ctx.clearRect(0, 0, cssW, cssH);
      if (mode === 'expand') {
        const margins = expandMargins();
        if (state.expand.bg === 'white') {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, cssW, cssH);
        } else if (state.expand.bg === 'edge') {
          drawEdgeFill(cssW, cssH, margins);
        } else {
          drawCheckerboard(cssW, cssH);
        }
        const x = margins.l * scale, y = margins.t * scale;
        const iw = img.width * scale, ih = img.height * scale;
        ctx.drawImage(img, x, y, iw, ih);
        ctx.save();
        ctx.strokeStyle = 'rgba(10,132,255,.9)';
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + .75, y + .75, Math.max(0, iw - 1.5), Math.max(0, ih - 1.5));
        ctx.restore();
      } else {
        ctx.drawImage(img, 0, 0, cssW, cssH);
        if (mode === 'crop') drawCrop();
        else {
          ctx.strokeStyle = 'rgba(255,255,255,.12)';
          ctx.lineWidth = 1;
          ctx.strokeRect(.5, .5, cssW - 1, cssH - 1);
        }
      }
    }
    function handlePoints(x, y, w, h) {
      return [
        { name: 'nw', x, y }, { name: 'n', x: x + w / 2, y }, { name: 'ne', x: x + w, y },
        { name: 'e', x: x + w, y: y + h / 2 }, { name: 'se', x: x + w, y: y + h },
        { name: 's', x: x + w / 2, y: y + h }, { name: 'sw', x, y: y + h },
        { name: 'w', x, y: y + h / 2 }
      ];
    }
    const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
    function pointerPoint(event) {
      const rect = canvas.getBoundingClientRect();
      const cx = event.clientX - rect.left, cy = event.clientY - rect.top;
      return { cx, cy, x: cx / state.view.scale, y: cy / state.view.scale };
    }
    function hitHandle(cx, cy) {
      const c = state.crop, scale = state.view.scale;
      for (const point of handlePoints(c.x * scale, c.y * scale, c.w * scale, c.h * scale)) {
        if (Math.abs(cx - point.x) <= 8 && Math.abs(cy - point.y) <= 8) return point.name;
      }
      return '';
    }
    function insideCrop(cx, cy) {
      const c = state.crop, scale = state.view.scale;
      return cx >= c.x * scale && cx <= (c.x + c.w) * scale && cy >= c.y * scale && cy <= (c.y + c.h) * scale;
    }
    function applyCropRect(x, y, w, h) {
      const img = state.img;
      let width = Math.abs(w), height = Math.abs(h);
      let left = w < 0 ? x - width : x, top = h < 0 ? y - height : y;
      width = Math.min(Math.max(8, width), img.width);
      height = Math.min(Math.max(8, height), img.height);
      left = clamp(left, 0, img.width - width);
      top = clamp(top, 0, img.height - height);
      state.crop = { x: left, y: top, w: width, h: height };
      syncCropFields();
      updateHint();
      draw();
    }
    function setAspect(value) {
      state.aspect = value;
      controls.querySelectorAll('[data-aspect]').forEach(button => button.classList.toggle('active', button.dataset.aspect === value));
      if (!state.img) return;
      const img = state.img;
      if (value === 'free') return;
      if (value === 'original') {
        applyCropRect(0, 0, img.width, img.height);
        return;
      }
      const [rw, rh] = value.split(':').map(Number);
      const ratio = rw / rh;
      let w = img.width, h = w / ratio;
      if (h > img.height) { h = img.height; w = h * ratio; }
      applyCropRect((img.width - w) / 2, (img.height - h) / 2, w, h);
    }
    function setScaleSize(w, h) {
      const img = state.img;
      if (!img) return;
      w = Math.round(clamp(w, MIN_SIDE, MAX_SIDE));
      h = Math.round(clamp(h, MIN_SIDE, MAX_SIDE));
      state.scale.w = w;
      state.scale.h = h;
      const problem = validateSize(w, h);
      note(problem);
      controls.querySelectorAll('[data-percent]').forEach(button => {
        button.classList.toggle('active', Math.round(img.width * Number(button.dataset.percent) / 100) === w &&
          Math.round(img.height * Number(button.dataset.percent) / 100) === h);
      });
      syncScaleFields();
      updateHint();
    }
    function applyPercent(percent) {
      const img = state.img;
      if (!img) return;
      state.scale.lock = true;
      const lock = controls.querySelector('[data-lock]');
      if (lock) lock.checked = true;
      setScaleSize(img.width * percent / 100, img.height * percent / 100);
    }
    function markFreeAspect() {
      if (state.aspect === 'free') return;
      state.aspect = 'free';
      controls.querySelectorAll('[data-aspect]').forEach(button => button.classList.toggle('active', button.dataset.aspect === 'free'));
    }
    function syncCropFields() {
      if (!state.img) return;
      controls.querySelectorAll('[data-crop]').forEach(input => {
        if (document.activeElement === input) return;
        input.value = String(Math.round(state.crop[input.dataset.crop]));
      });
    }
    function syncScaleFields() {
      if (!state.img) return;
      controls.querySelectorAll('[data-size]').forEach(input => {
        if (document.activeElement === input) return;
        input.value = String(Math.round(state.scale[input.dataset.size]));
      });
    }
    function buildCropControls() {
      controls.append(mk('h3', 'rie-section-title', '比例'));
      const aspects = mk('div', 'rie-chips');
      for (const [value, label] of [['free', '自由'], ['original', '原始'], ['1:1', '1:1'], ['4:3', '4:3'], ['3:4', '3:4'], ['16:9', '16:9'], ['9:16', '9:16']]) {
        const button = mk('button', 'rie-chip', label);
        button.type = 'button';
        button.dataset.aspect = value;
        button.classList.toggle('active', value === state.aspect);
        button.onclick = () => setAspect(value);
        aspects.append(button);
      }
      controls.append(aspects, mk('h3', 'rie-section-title', '选区像素'));
      const grid = mk('div', 'rie-fields');
      for (const [key, label] of [['x', 'X'], ['y', 'Y'], ['w', '宽'], ['h', '高']]) {
        const field = mk('label', 'rie-field');
        field.append(mk('span', '', label));
        const input = mk('input', 'rie-input');
        input.type = 'number';
        input.min = key === 'x' || key === 'y' ? '0' : '8';
        input.dataset.crop = key;
        input.addEventListener('input', () => {
          if (!state.img) return;
          const value = Number(input.value);
          if (!Number.isFinite(value)) return;
          if (key === 'x') applyCropRect(value, state.crop.y, state.crop.w, state.crop.h);
          else if (key === 'y') applyCropRect(state.crop.x, value, state.crop.w, state.crop.h);
          else if (key === 'w') applyCropRect(state.crop.x, state.crop.y, value, state.crop.h);
          else applyCropRect(state.crop.x, state.crop.y, state.crop.w, value);
        });
        input.addEventListener('blur', () => { input.value = String(Math.round(state.crop[key])); });
        field.append(input);
        grid.append(field);
      }
      const reset = mk('button', 'rie-text-button', '重置为整张图片');
      reset.type = 'button';
      reset.onclick = () => setAspect('original');
      controls.append(grid, reset, mk('p', 'rie-tip', '拖动选框内部可移动，拖动八个角点或边线可调整大小。'));
    }
    function buildScaleControls() {
      controls.append(mk('h3', 'rie-section-title', '按比例'));
      const percents = mk('div', 'rie-chips');
      for (const percent of [25, 50, 75, 100, 150, 200]) {
        const button = mk('button', 'rie-chip', percent + '%');
        button.type = 'button';
        button.dataset.percent = String(percent);
        button.onclick = () => applyPercent(percent);
        percents.append(button);
      }
      controls.append(percents, mk('h3', 'rie-section-title', '输出像素'));
      const grid = mk('div', 'rie-fields');
      const widthField = mk('label', 'rie-field');
      widthField.append(mk('span', '', '宽度'));
      const widthInput = mk('input', 'rie-input');
      widthInput.type = 'number'; widthInput.min = String(MIN_SIDE); widthInput.max = String(MAX_SIDE);
      widthInput.dataset.size = 'w';
      widthInput.addEventListener('input', () => {
        if (!state.img) return;
        const value = Number(widthInput.value);
        if (!Number.isFinite(value)) return;
        const ratio = state.img.width / state.img.height;
        setScaleSize(value, state.scale.lock ? value / ratio : state.scale.h);
      });
      widthInput.addEventListener('blur', () => { widthInput.value = String(Math.round(state.scale.w)); });
      widthField.append(widthInput);
      const heightField = mk('label', 'rie-field');
      heightField.append(mk('span', '', '高度'));
      const heightInput = mk('input', 'rie-input');
      heightInput.type = 'number'; heightInput.min = String(MIN_SIDE); heightInput.max = String(MAX_SIDE);
      heightInput.dataset.size = 'h';
      heightInput.addEventListener('input', () => {
        if (!state.img) return;
        const value = Number(heightInput.value);
        if (!Number.isFinite(value)) return;
        const ratio = state.img.width / state.img.height;
        setScaleSize(state.scale.lock ? value * ratio : state.scale.w, value);
      });
      heightInput.addEventListener('blur', () => { heightInput.value = String(Math.round(state.scale.h)); });
      heightField.append(heightInput);
      grid.append(widthField, heightField);
      const lockRow = mk('label', 'rie-check');
      const lock = mk('input');
      lock.type = 'checkbox'; lock.checked = true; lock.dataset.lock = '';
      lock.addEventListener('change', () => { state.scale.lock = lock.checked; });
      lockRow.append(lock, mk('span', '', '锁定原始宽高比'));
      controls.append(grid, lockRow, mk('p', 'rie-tip', '使用高质量重采样；缩小后如需还原，请从原图重新处理。'));
    }
    function buildExpandControls() {
      controls.append(mk('h3', 'rie-section-title', '四边扩展比例'));
      const grid = mk('div', 'rie-fields');
      for (const [key, label] of [['l', '左'], ['r', '右'], ['t', '上'], ['b', '下']]) {
        const field = mk('label', 'rie-field');
        field.append(mk('span', '', label + ' %'));
        const input = mk('input', 'rie-input');
        input.type = 'number'; input.min = '0'; input.max = '100'; input.step = '5';
        input.dataset.margin = key;
        input.addEventListener('input', () => {
          if (!state.img) return;
          const value = Number(input.value);
          if (!Number.isFinite(value)) return;
          state.expand[key] = clamp(Math.round(value), 0, 100);
          const size = expandOutputSize();
          const problem = validateSize(size.w, size.h);
          note(problem);
          updateHint();
          layout();
        });
        input.addEventListener('blur', () => { input.value = String(state.expand[key]); });
        field.append(input);
        grid.append(field);
      }
      controls.append(grid, mk('h3', 'rie-section-title', '扩展区填充'));
      const backgrounds = mk('div', 'rie-chips');
      for (const [value, label] of [['transparent', '透明'], ['white', '白底'], ['edge', '边缘延展']]) {
        const button = mk('button', 'rie-chip', label);
        button.type = 'button';
        button.dataset.background = value;
        button.classList.toggle('active', value === state.expand.bg);
        button.onclick = () => {
          state.expand.bg = value;
          backgrounds.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
          draw();
          updateHint();
        };
        backgrounds.append(button);
      }
      controls.append(backgrounds, mk('p', 'rie-tip', '透明模式输出 PNG 透明边；边缘延展会拉伸最外圈像素填补空白。'));
    }
    function renderOutput() {
      const img = state.img;
      if (!img) return null;
      if (mode === 'crop') {
        const x = clamp(Math.round(state.crop.x), 0, Math.max(0, img.width - 1));
        const y = clamp(Math.round(state.crop.y), 0, Math.max(0, img.height - 1));
        const w = Math.max(1, Math.min(Math.round(state.crop.w), img.width - x));
        const h = Math.max(1, Math.min(Math.round(state.crop.h), img.height - y));
        const output = mk('canvas');
        output.width = w; output.height = h;
        const octx = output.getContext('2d');
        octx.imageSmoothingEnabled = true;
        octx.imageSmoothingQuality = 'high';
        octx.drawImage(img, x, y, w, h, 0, 0, w, h);
        return output;
      }
      if (mode === 'scale') {
        const w = Math.round(state.scale.w), h = Math.round(state.scale.h);
        const output = mk('canvas');
        output.width = w; output.height = h;
        const octx = output.getContext('2d');
        octx.imageSmoothingEnabled = true;
        octx.imageSmoothingQuality = 'high';
        octx.drawImage(img, 0, 0, img.width, img.height, 0, 0, w, h);
        return output;
      }
      const margins = expandMargins();
      const size = expandOutputSize();
      const output = mk('canvas');
      output.width = size.w; output.height = size.h;
      const octx = output.getContext('2d');
      if (state.expand.bg === 'white') {
        octx.fillStyle = '#FFFFFF';
        octx.fillRect(0, 0, size.w, size.h);
      } else if (state.expand.bg === 'edge') {
        octx.drawImage(img, 0, 0, img.width, img.height, 0, 0, size.w, size.h);
        octx.drawImage(img, 0, 0, img.width, 1, 0, 0, size.w, margins.t);
        octx.drawImage(img, 0, img.height - 1, img.width, 1, 0, margins.t + img.height, size.w, margins.b);
        octx.drawImage(img, 0, 0, 1, img.height, 0, margins.t, margins.l, img.height);
        octx.drawImage(img, img.width - 1, 0, 1, img.height, margins.l + img.width, margins.t, margins.r, img.height);
      }
      octx.drawImage(img, margins.l, margins.t);
      return output;
    }
    async function applyChanges() {
      if (!canApply()) return;
      const output = renderOutput();
      if (!output) return;
      setBusy(true);
      note('');
      try {
        const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png'));
        if (!blob) throw Error('图片导出失败');
        if (blob.size > 12 * 1024 * 1024) throw Error('结果超过 12MB，请降低尺寸后重试');
        const saved = await onApply?.({ blob, width: output.width, height: output.height, mode });
        if (saved !== false) close(true);
      } catch (error) {
        note(error.message || '处理失败');
      } finally {
        setBusy(false);
      }
    }
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (!state.busy) close(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = [...panel.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(node => node.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    function onWindowResize() { scheduleLayout(); }

    closeButton.onclick = () => close(false);
    cancelButton.onclick = () => close(false);
    applyButton.onclick = applyChanges;
    backdrop.addEventListener('pointerdown', event => {
      if (event.target === backdrop && !state.busy) close(false);
    });
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onWindowResize);
    observer = new ResizeObserver(scheduleLayout);
    observer.observe(stage);

    if (mode === 'crop') buildCropControls();
    else if (mode === 'scale') buildScaleControls();
    else buildExpandControls();

    canvas.addEventListener('pointerdown', event => {
      if (mode !== 'crop' || !state.ready || state.busy) return;
      const point = pointerPoint(event);
      const handle = hitHandle(point.cx, point.cy);
      if (handle) {
        markFreeAspect();
        state.drag = { type: 'resize', handle, before: { ...state.crop } };
      } else if (insideCrop(point.cx, point.cy)) {
        state.drag = { type: 'move', before: { ...state.crop }, origin: point };
      } else {
        markFreeAspect();
        state.drag = { type: 'new', before: { ...state.crop }, anchor: point };
      }
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('is-dragging');
      event.preventDefault();
    });
    canvas.addEventListener('pointermove', event => {
      if (mode !== 'crop' || !state.ready) return;
      const point = pointerPoint(event);
      if (!state.drag) {
        const handle = hitHandle(point.cx, point.cy);
        canvas.style.cursor = handle ? CURSORS[handle] : insideCrop(point.cx, point.cy) ? 'move' : 'crosshair';
        return;
      }
      const before = state.drag.before;
      if (state.drag.type === 'new') {
        const anchor = state.drag.anchor;
        const dx = point.x - anchor.x, dy = point.y - anchor.y;
        if (Math.hypot(dx, dy) < 3) return;
        applyCropRect(anchor.x, anchor.y, dx, dy);
      } else if (state.drag.type === 'move') {
        const dx = point.x - state.drag.origin.x, dy = point.y - state.drag.origin.y;
        state.crop = { x: clamp(before.x + dx, 0, state.img.width - before.w), y: clamp(before.y + dy, 0, state.img.height - before.h), w: before.w, h: before.h };
        syncCropFields(); updateHint(); draw();
      } else {
        let left = before.x, top = before.y, right = before.x + before.w, bottom = before.y + before.h;
        if (state.drag.handle.includes('w')) left = point.x;
        if (state.drag.handle.includes('e')) right = point.x;
        if (state.drag.handle.includes('n')) top = point.y;
        if (state.drag.handle.includes('s')) bottom = point.y;
        applyCropRect(left, top, right - left, bottom - top);
      }
    });
    const endDrag = () => {
      if (!state.drag) return;
      state.drag = null;
      canvas.classList.remove('is-dragging');
      canvas.style.cursor = 'crosshair';
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (!backdrop.isConnected) return;
      if (!image.naturalWidth || !image.naturalHeight) {
        hintNode.textContent = '图片尺寸无效';
        note('无法读取图片尺寸');
        return;
      }
      loading.remove();
      state.img = image;
      state.ready = true;
      state.crop = { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight };
      state.scale = { w: image.naturalWidth, h: image.naturalHeight, lock: true };
      state.expand = { l: 20, r: 20, t: 20, b: 20, bg: 'transparent' };
      controls.querySelectorAll('[data-crop]').forEach(input => {
        input.max = input.dataset.crop === 'h' ? String(image.naturalHeight) : String(image.naturalWidth);
        input.value = String(input.dataset.crop === 'h' ? image.naturalHeight : input.dataset.crop === 'w' ? image.naturalWidth : 0);
      });
      controls.querySelectorAll('[data-margin]').forEach(input => { input.value = '20'; });
      syncScaleFields();
      layout();
      refreshApply();
      closeButton.focus();
    };
    image.onerror = () => {
      loading.textContent = '图片加载失败';
      hintNode.textContent = '图片加载失败';
      note('无法读取这张图片，请关闭后重试');
    };
    image.src = url;

    return new Promise(resolve => {
      resolveClose = resolve;
    });
  }

  window.HamokiResultImageEditor = { open };
})();
