/* Canvas generation frames.
   While a paid image job is queued or running, the canvas shows a placeholder in
   the exact slot the finished artwork will occupy. The placeholder carries the
   same name/size caption as the final artwork and loops a transparent monkey
   progress animation, so 生成 has an immediate visual result on the board.
   Only in-flight work belongs on the canvas: when a job fails or is interrupted
   its frame is removed from the board, and the failure is reported only in the
   bottom 生成队列 panel. Job fields (planned/name/preview) come from server.js;
   the local predictions below keep the frame correct when an older server is
   still running. */
'use strict';
(() => {
  const SIZES = {
    '1K': {'1:1':'1024x1024','3:2':'1536x1024','2:3':'1024x1536','16:9':'1536x864','9:16':'864x1536','4:3':'1280x960','3:4':'960x1280'},
    '2K': {'1:1':'2048x2048','3:2':'2304x1536','2:3':'1536x2304','16:9':'2560x1440','9:16':'1440x2560','4:3':'2304x1728','3:4':'1728x2304'},
    '4K': {'1:1':'2816x2816','3:2':'3456x2304','2:3':'2304x3456','16:9':'3840x2160','9:16':'2160x3840','4:3':'3200x2400','3:4':'2400x3200'}
  };
  const TILE = 288, MIN_EDGE = 90, GAP = 36;
  const STATUS_LABEL = {queued:'排队中',running:'生成中'};
  // Failed / interrupted jobs never get a canvas frame; the queue panel owns them.
  const VISIBLE = new Set(['queued','running']);
  const CAPTION_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3.5"/><path d="m6.2 16.6 4-4.6 3 3.2 2.2-2.3 3.4 3.9"/><circle cx="15.6" cy="8.6" r="1.6" fill="currentColor" stroke="none"/></svg>';

  let canvasEl = null;
  let latest = [];
  const frames = new Map();

  function imageSize(ratio, resolution) {
    const group = SIZES[resolution] || SIZES['1K'];
    return group[ratio] || group['1:1'] || '1024x1024';
  }
  function previewFor(job) {
    const preview = job && job.preview;
    if (preview && Number.isFinite(Number(preview.width)) && Number.isFinite(Number(preview.height)) && Number(preview.width) > 0 && Number(preview.height) > 0) {
      return {width: Math.round(Number(preview.width)), height: Math.round(Number(preview.height))};
    }
    const [width, height] = imageSize(String(job?.ratio || '1:1'), String(job?.resolution || '1K')).split('x').map(Number);
    return {width, height};
  }
  function boxFor(width, height) {
    if (!(width > 0 && height > 0)) return {w: TILE, h: TILE};
    const ratio = width / height;
    return ratio >= 1
      ? {w: TILE, h: Math.max(MIN_EDGE, Math.round(TILE / ratio))}
      : {w: Math.max(MIN_EDGE, Math.round(TILE * ratio)), h: TILE};
  }
  // Same placement contract as lib/v1-canvas-placement.js: each generation goes
  // to the right of the previous artwork and never covers an existing element.
  function placeAfter(elements, width, height) {
    const list = Array.isArray(elements) ? elements : [];
    const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
    const coord = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    let anchor = [...list].reverse().find(node => node.kind === 'generated')
      || [...list].reverse().find(node => node.kind === 'reference') || null;
    if (!anchor) return {x: 150, y: 170, w: width, h: height};
    const y = coord(anchor.y, 170);
    let x = coord(anchor.x, 150) + positive(anchor.w, width) + GAP;
    for (let i = 0; i <= list.length; i++) {
      const conflicts = list.filter(node => {
        const nx = coord(node.x, 0), ny = coord(node.y, 0);
        const nw = positive(node.w, width), nh = positive(node.h, height);
        return x < nx + nw + GAP && x + width + GAP > nx
          && y < ny + nh + GAP && y + height + GAP > ny;
      });
      if (!conflicts.length) break;
      const nextX = Math.max(x, ...conflicts.map(node => coord(node.x, 0) + positive(node.w, width) + GAP));
      if (nextX <= x) break;
      x = nextX;
    }
    return {x: Math.round(x), y, w: width, h: height};
  }
  function nodeKind(el) {
    if (el.classList.contains('generated-result-node')) return 'generated';
    if (el.classList.contains('canvas-note')) return 'note';
    return 'reference';
  }
  function domNodes() {
    if (!canvasEl) return [];
    return [...canvasEl.querySelectorAll('.canvas-node[data-id]')].map(el => ({
      kind: nodeKind(el),
      x: parseFloat(el.style.left) || 0,
      y: parseFloat(el.style.top) || 0,
      w: parseFloat(el.style.width) || el.offsetWidth || TILE,
      h: parseFloat(el.style.height) || el.offsetHeight || TILE
    }));
  }
  function visibleJobs() {
    const retried = new Set(latest.map(job => job && job.retryOf).filter(Boolean));
    const seen = new Set();
    return latest.filter(job => {
      if (!job || !job.id || seen.has(job.id)) return false;
      seen.add(job.id);
      return VISIBLE.has(job.status) && !retried.has(job.id) && !job.resultId;
    }).slice(0, 24);
  }
  function placementFor(job, occupied) {
    const planned = job.planned;
    if (planned && ['x','y','w','h'].every(key => Number.isFinite(Number(planned[key])))) {
      return {x: Math.round(Number(planned.x)), y: Math.round(Number(planned.y)), w: Math.round(Number(planned.w)), h: Math.round(Number(planned.h))};
    }
    const preview = previewFor(job);
    const box = boxFor(preview.width, preview.height);
    return placeAfter(occupied, box.w, box.h);
  }
  function createFrame(job) {
    const el = document.createElement('div');
    el.className = 'generation-frame generation-frame-new';
    el.dataset.jobId = job.id;
    el.setAttribute('role', 'group');
    const caption = document.createElement('div');
    caption.className = 'generation-frame-caption';
    caption.innerHTML = CAPTION_ICON;
    const name = document.createElement('span');
    name.className = 'generation-frame-name';
    const size = document.createElement('span');
    size.className = 'generation-frame-size';
    caption.append(name, size);
    const body = document.createElement('div');
    body.className = 'generation-frame-body';
    // The 6-second transparent monkey animation already includes its own green
    // progress bar; do not stack the old spinner or a duplicate progress track.
    const picture = document.createElement('picture');
    picture.className = 'generation-frame-monkey';
    const reducedMotion = document.createElement('source');
    reducedMotion.media = '(prefers-reduced-motion: reduce)';
    reducedMotion.srcset = 'assets/hamoki-monkey-progress-still.webp';
    const monkey = document.createElement('img');
    monkey.className = 'generation-frame-monkey-img';
    monkey.src = 'assets/hamoki-monkey-progress-6s-loop.webp';
    monkey.alt = '';
    monkey.width = 360;
    monkey.height = 98;
    monkey.setAttribute('aria-hidden', 'true');
    picture.append(reducedMotion, monkey);
    const label = document.createElement('span');
    label.className = 'generation-frame-label';
    body.append(picture, label);
    el.append(caption, body);
    return {el, name, size, label, status: '', jobId: job.id};
  }
  function updateFrame(entry, job, placement, displayName) {
    const status = VISIBLE.has(job.status) ? job.status : 'queued';
    const {el, name, size, label} = entry;
    for (const candidate of VISIBLE) el.classList.toggle('status-' + candidate, candidate === status);
    if (entry.status !== status) {
      entry.status = status;
      label.textContent = STATUS_LABEL[status] || '生成中';
    }
    name.textContent = displayName;
    const preview = previewFor(job);
    const sizeText = preview.width + ' × ' + preview.height;
    if (size.textContent !== sizeText) size.textContent = sizeText;
    el.style.left = placement.x + 'px';
    el.style.top = placement.y + 'px';
    el.style.width = placement.w + 'px';
    el.style.height = placement.h + 'px';
    el.setAttribute('aria-label', displayName + ' · ' + (STATUS_LABEL[status] || '生成中'));
  }
  function render() {
    if (!canvasEl) return;
    const jobs = visibleJobs();
    const wanted = new Set(jobs.map(job => job.id));
    for (const [id, entry] of frames) {
      if (wanted.has(id)) continue;
      entry.el.remove();
      frames.delete(id);
    }
    const occupied = domNodes();
    let sequence = occupied.filter(node => node.kind === 'generated').length;
    for (const job of jobs) {
      const placement = placementFor(job, occupied);
      let displayName = String(job.name || '').trim();
      const numbered = /^图片生成(\d+)$/.exec(displayName);
      if (numbered) sequence = Math.max(sequence, Number(numbered[1]));
      if (!displayName) {
        sequence += 1;
        displayName = '图片生成' + sequence;
      }
      let entry = frames.get(job.id);
      if (!entry) {
        entry = createFrame(job);
        frames.set(job.id, entry);
        canvasEl.append(entry.el);
      }
      updateFrame(entry, job, placement, displayName);
      occupied.push({kind: 'generated', x: placement.x, y: placement.y, w: placement.w, h: placement.h});
    }
    window.HamokiViewport?.syncBounds?.();
  }
  function sync(jobs) {
    latest = Array.isArray(jobs) ? jobs : [];
    if (canvasEl) render();
  }
  function mount(area) {
    canvasEl = area || document.getElementById('canvas');
    if (!canvasEl) return;
    for (const entry of frames.values()) entry.el.remove();
    frames.clear();
    render();
  }
  function reveal(job) {
    const viewport = document.getElementById('canvas-viewport');
    if (!viewport) return;
    const entry = frames.get(job && job.id);
    let rect = null;
    if (job && job.planned) {
      rect = {x: Number(job.planned.x), y: Number(job.planned.y), w: Number(job.planned.w), h: Number(job.planned.h)};
    } else if (entry) {
      // Older servers do not return a reserved slot; the freshly painted frame
      // already knows the locally predicted position, so scroll to that instead.
      rect = {
        x: parseFloat(entry.el.style.left) || 0,
        y: parseFloat(entry.el.style.top) || 0,
        w: parseFloat(entry.el.style.width) || TILE,
        h: parseFloat(entry.el.style.height) || TILE
      };
    }
    if (!rect) return;
    const centerX = rect.x + rect.w / 2;
    const centerY = rect.y + rect.h / 2;
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    const host = window.HamokiViewport;
    if (host && host.centerOnWorld) {
      // First show the empty generation slot at 100%; the finished artwork
      // will be zoomed to 180% by the completion handler.
      host.centerOnWorld(1, centerX, centerY, motion);
    } else {
      const zoom = 1;
      const origin = host?.worldOrigin?.() || {left: 0, top: 0};
      host?.setZoom?.(zoom);
      host?.scrollToVirtual?.(origin.left + centerX * zoom - viewport.clientWidth / 2,
        origin.top + centerY * zoom - viewport.clientHeight / 2, motion);
    }
    if (entry) entry.el.classList.add('generation-frame-new');
  }
  window.HamokiGenerationFrames = {
    sync,
    mount,
    reveal,
    refresh: () => render(),
    activeCount: () => visibleJobs().length
  };
})();
