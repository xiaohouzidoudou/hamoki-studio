// ===== 全局状态 =====
const state = {
    sidebarExpanded: false,
    customSizeEnabled: false,
    customWidth: '1536',
    customHeight: '1024',
    composeMode: 'text2img',
    queueCollapsed: true,
    currentView: 'image-generate',
    zoom: 1,
    providers: [],
    activeProviderId: null,
    jobs: [],
    queueFilter: 'active',
    queuePaused: false,
    queueConcurrency: 1,
    jobPollReady: false
};

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initQueue();
    initCanvas();
    initNavigation();
    renderCurrentView();
    initImageClipboard();
    loadJobs(); // 加载真实的任务队列
    setInterval(loadJobs, 3000); // 每3秒刷新一次队列
});

// ===== 侧边栏 =====
function initSidebar() {
    const toggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    const update = () => {
        const expanded = !!state.sidebarExpanded;
        sidebar.classList.toggle('expanded',expanded);
        const label = expanded ? '收起侧栏' : '展开侧栏';
        const text = toggle.querySelector('.sidebar-toggle-label');
        if (text) text.textContent = label;
        toggle.setAttribute('aria-label',label);
        toggle.setAttribute('title',label);
        toggle.setAttribute('aria-expanded',String(expanded));
    };
    update();
    toggle.addEventListener('click', () => {
        state.sidebarExpanded = !state.sidebarExpanded;
        update();
    });
}

// ===== 队列面板 =====
function initQueue() {
    const collapseBtn = document.getElementById('queue-collapse-btn');
    const panel = document.getElementById('queue-panel');
    const title = document.querySelector('.queue-title');
    const toggleExpanded = open => {
        state.queueCollapsed = !open;
        panel.classList.toggle('expanded',open);
        panel.classList.toggle('collapsed',!open);
        collapseBtn.setAttribute('aria-expanded',String(open));
        collapseBtn.setAttribute('aria-label',open?'收起生成队列':'展开生成队列');
        if (open && !state.jobs.some(j => ['running','queued','failed','interrupted'].includes(j.status)) && state.jobs.some(j => j.status === 'done')) {
            state.queueFilter = 'done';
            document.querySelectorAll('.queue-tab').forEach((tab,i) => tab.classList.toggle('active',i===2));
            renderQueue();
        }
    };
    toggleExpanded(false);
    collapseBtn.addEventListener('click', () => toggleExpanded(state.queueCollapsed));
    title.addEventListener('click', () => toggleExpanded(state.queueCollapsed));
    const filters = ['active','queued','done'];
    document.querySelectorAll('.queue-tab').forEach((tab,i) => tab.addEventListener('click', () => {
        state.queueFilter = filters[i];
        document.querySelectorAll('.queue-tab').forEach(el => el.classList.remove('active'));
        tab.classList.add('active');
        renderQueue();
    }));
    document.getElementById('queue-pause')?.addEventListener('click', async () => {
        try {
            const res = await fetch('/api/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:state.queuePaused?'resume':'pause'})});
            if (!res.ok) throw Error((await res.json()).error || '操作失败');
            await loadJobs();
        } catch(e) {void window.HamokiGlassUI.alert('队列操作失败：' + e.message);}
    });
}

function showQueueNotice(job, count = 1) {
    let notice = document.getElementById('queue-finish-toast');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'queue-finish-toast';
        notice.className = 'queue-finish-toast';
        notice.setAttribute('role','status');
        notice.setAttribute('aria-live','polite');
        notice.hidden = true;
        document.body.appendChild(notice);
    }
    notice.replaceChildren();
    const isDone = job.status === 'done';
    notice.classList.toggle('error',!isDone);
    const image = isDone ? window.HamokiCanvas?.findHistory(job.resultId)?.url : null;
    if (image) {
        const thumbnail = document.createElement('img');
        thumbnail.src = image;
        thumbnail.alt = '刚生成的作品';
        notice.appendChild(thumbnail);
    }
    const info = document.createElement('div');
    info.className = 'queue-finish-info';
    const headline = document.createElement('strong');
    headline.textContent = isDone ? (count > 1 ? `${count} 张图片已生成` : '图片已生成') : '生成失败';
    const subtitle = document.createElement('span');
    subtitle.textContent = isDone ? '作品已放到画布右侧' :
        (job.completionUncertain ? '上游超时，请先核对消费记录' : '请展开底部队列查看原因');
    info.append(headline,subtitle);
    notice.appendChild(info);
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label','关闭提示');
    close.textContent = '×';
    close.addEventListener('click',()=>{notice.hidden=true;});
    notice.appendChild(close);
    notice.hidden = false;
    clearTimeout(showQueueNotice.timer);
    showQueueNotice.timer = setTimeout(() => {notice.hidden=true;},4700);
}


// ===== 画布 =====
function initCanvas() {
    const viewport = document.getElementById('canvas-viewport');
    const canvas = document.getElementById('canvas');
    const zoomBtns = document.querySelectorAll('.zoom-btn');
    const zoomText = document.querySelector('.zoom-text');
    const zoomTrigger=document.getElementById('canvasZoomTrigger');
    const zoomMenu=document.getElementById('canvasZoomMenu');
    const zoomCurrent=zoomTrigger?.querySelector('.canvas-zoom-current');
    // Infinite-scroll work area: shift the logical canvas away from scroll
    // origin and grow the surrounding empty space whenever the user nears an
    // edge. Canvas node x/y are UNCHANGED (including negative positions).
    const GUTTER = 4096, EDGE = 600, EXTEND = 3072;
    const padding = {left:GUTTER,top:GUTTER,right:GUTTER,bottom:GUTTER};
    viewport.style.overflowAnchor='none';
    for(const key of ['left','top','right','bottom'])
        canvas.style['margin'+key[0].toUpperCase()+key.slice(1)] = padding[key]+'px';

    function growForScroll(targetLeft,targetTop) {
        let shiftX=0,shiftY=0;
        const grow=(key,size)=>{
            padding[key]+=size;
            canvas.style['margin'+key[0].toUpperCase()+key.slice(1)]=padding[key]+'px';
        };
        // Allow continuous negative-direction movement without ever hitting 0.
        if(targetLeft<EDGE) {
            shiftX=Math.ceil((EDGE+EXTEND-targetLeft)/EXTEND)*EXTEND;
            grow('left',shiftX);
        }
        if(targetTop<EDGE) {
            shiftY=Math.ceil((EDGE+EXTEND-targetTop)/EXTEND)*EXTEND;
            grow('top',shiftY);
        }
        // Leave genuine scrollable whitespace beyond the right/bottom edges.
        const remainingX=viewport.scrollWidth-viewport.clientWidth;
        const remainingY=viewport.scrollHeight-viewport.clientHeight;
        if(targetLeft+shiftX>remainingX-EDGE)
            grow('right',Math.ceil((targetLeft+shiftX-(remainingX-EDGE)+EXTEND)/EXTEND)*EXTEND);
        if(targetTop+shiftY>remainingY-EDGE)
            grow('bottom',Math.ceil((targetTop+shiftY-(remainingY-EDGE)+EXTEND)/EXTEND)*EXTEND);
        return {x:shiftX,y:shiftY};
    }
    function scrollToVirtual(left,top,behavior='auto') {
        const delta=growForScroll(left,top);
        viewport.scrollTo({left:left+delta.x,top:top+delta.y,behavior});
    }
    function expandNearEdge(){
        const left=viewport.scrollLeft,top=viewport.scrollTop;
        const delta=growForScroll(left,top);
        if(delta.x)viewport.scrollLeft=left+delta.x;
        if(delta.y)viewport.scrollTop=top+delta.y;
    }

    function syncBounds() {
        const scale = state.zoom || 1;
        // Keep enough world space for new pictures, scrolling and middle-button panning.
        const cards = canvas.querySelectorAll('.canvas-node, .generation-frame');
        let right = 0, bottom = 0;
        cards.forEach(card => {
            right = Math.max(right, parseFloat(card.style.left || 0) + card.offsetWidth);
            bottom = Math.max(bottom, parseFloat(card.style.top || 0) + card.offsetHeight);
        });
        // Virtualized cards outside the viewport still occupy world space.
        const all=window.HamokiCanvas?.allExtent?.();
        if(all){right=Math.max(right,all.maxX);bottom=Math.max(bottom,all.maxY);}
        canvas.style.width = Math.ceil(Math.max(right + 380, viewport.clientWidth / scale + 420)) + 'px';
        canvas.style.height = Math.ceil(Math.max(bottom + 380, viewport.clientHeight / scale + 420)) + 'px';
    }

    function syncZoomReadout(zoom) {
        zoomText.textContent = Math.round(zoom * 100) + '%';
        if(zoomCurrent)zoomCurrent.textContent=Math.round(zoom*100)+'%';
        zoomMenu?.querySelectorAll('[data-zoom]').forEach(button=>
            button.classList.toggle('active',Math.abs(Number(button.dataset.zoom)-zoom)<0.0001));
    }

    // All zoom entry points funnel through here so the canvas transform, the scrollable
    // world bounds and both percentage readouts can never disagree.
    function applyZoom(target) {
        const next = Math.max(0.1, Math.min(10, Number(target) || 1));
        state.zoom = next;
        canvas.style.transform = `scale(${next})`;
        syncBounds();
        window.HamokiCanvas?.scheduleVirtualRefresh?.();
        window.HamokiCanvas?.updatePopoverVisibility?.();
        window.HamokiReturnNodes?.schedule?.();
        syncZoomReadout(next);
        return next;
    }

    let zoomAnimationFrame = 0;
    function cancelZoomAnimation() {
        if (zoomAnimationFrame) cancelAnimationFrame(zoomAnimationFrame);
        zoomAnimationFrame = 0;
        canvas.style.willChange = '';
    }

    function zoomTo(target, clientX, clientY) {
        cancelZoomAnimation();
        const oldZoom = state.zoom || 1;
        const next = window.HamokiCanvasCore.clamp(Number(target)||1,.1,10);
        if (Math.abs(oldZoom - next) < 0.0001) return;
        window.HamokiCanvas?.bumpPopoverMotion?.();
        const rect = viewport.getBoundingClientRect();
        const px = Number.isFinite(clientX) ? clientX - rect.left : rect.width / 2;
        const py = Number.isFinite(clientY) ? clientY - rect.top : rect.height / 2;
        const anchor=window.HamokiCanvasCore.anchoredZoom({zoom:oldZoom,x:padding.left-viewport.scrollLeft,y:padding.top-viewport.scrollTop},next,px,py);
        applyZoom(next);
        const desiredLeft = padding.left-anchor.x;
        const desiredTop = padding.top-anchor.y;
        scrollToVirtual(desiredLeft,desiredTop);
        // Some browsers apply native wheel compositor scrolling just after the event.
        // Correct the anchor on the next paint so the same artwork stays under the cursor.
        requestAnimationFrame(() => {
            if (state.zoom !== next) return;
            scrollToVirtual(desiredLeft,desiredTop);
            window.HamokiCanvas?.updatePopoverVisibility?.();
        });
    }

    // Completion zoom: tween the scale and scroll in the SAME animation frame.
    // Keep the world point already under the viewport center fixed there; a CSS
    // transform-only transition would drift because this canvas also scrolls.
    function animateZoomTo(target, duration = 460) {
        cancelZoomAnimation();
        const startZoom = state.zoom || 1;
        const endZoom = Math.max(0.1, Math.min(10, Number(target) || 1));
        if (Math.abs(endZoom - startZoom) < .0001) return;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            zoomTo(endZoom);
            return;
        }
        const px = viewport.clientWidth / 2;
        const py = viewport.clientHeight / 2;
        const worldX = (viewport.scrollLeft - padding.left + px) / startZoom;
        const worldY = (viewport.scrollTop - padding.top + py) / startZoom;
        let startedAt = null;
        canvas.style.willChange = 'transform';
        const frame = time => {
            if (startedAt === null) startedAt = time;
            const progress = Math.min(1, (time - startedAt) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            const zoom = startZoom + (endZoom - startZoom) * eased;
            applyZoom(zoom);
            scrollToVirtual(padding.left + worldX * zoom - px,
                padding.top + worldY * zoom - py, 'instant');
            if (progress < 1) zoomAnimationFrame = requestAnimationFrame(frame);
            else {zoomAnimationFrame = 0; canvas.style.willChange = '';}
        };
        zoomAnimationFrame = requestAnimationFrame(frame);
    }

    // Opening-view helper: set an absolute zoom and place one world point in the middle
    // of the visible canvas. The second attempt after paint wins over browser scroll
    // restoration and any late layout from the first canvas render.
    function centerOnWorld(scale, worldX, worldY, behavior = 'auto') {
        cancelZoomAnimation();
        const zoom = applyZoom(scale);
        const left = padding.left + (Number(worldX) || 0) * zoom - viewport.clientWidth / 2;
        const top = padding.top + (Number(worldY) || 0) * zoom - viewport.clientHeight / 2;
        scrollToVirtual(left, top, behavior);
        requestAnimationFrame(() => {
            if (state.zoom !== zoom) return;
            scrollToVirtual(left, top, behavior);
            window.HamokiCanvas?.updatePopoverVisibility?.();
        });
        return {scale: zoom, left, top};
    }

    function fitSelection(){
        const world=window.HamokiCanvas?.fitWorldBounds?.();
        if(world){
            const w=Math.max(1,world.maxX-world.minX),h=Math.max(1,world.maxY-world.minY);
            const target=Math.min(10,Math.max(.1,
                Math.min((viewport.clientWidth-110)/w,(viewport.clientHeight-172)/h)));
            const x=(world.minX+world.maxX)/2,y=(world.minY+world.maxY)/2;
            zoomTo(target);
            scrollToVirtual(padding.left+x*target-viewport.clientWidth/2,
                padding.top+y*target-viewport.clientHeight/2);
            return;
        }
        const selected=canvas.querySelector('.canvas-node.selected');
        const cards=selected?[selected]:[...canvas.querySelectorAll('.canvas-node, .generation-frame')];
        if(!cards.length){
            window.HamokiCanvas?.toast?.('画布还没有可以适应的图片或文本');
            return;
        }
        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
        cards.forEach(card=>{
            const x=parseFloat(card.style.left)||0,y=parseFloat(card.style.top)||0;
            const w=parseFloat(card.style.width)||card.offsetWidth||300;
            const h=parseFloat(card.style.height)||card.offsetHeight||240;
            minX=Math.min(minX,x);minY=Math.min(minY,y);
            maxX=Math.max(maxX,x+w);maxY=Math.max(maxY,y+h);
        });
        const w=Math.max(1,maxX-minX),h=Math.max(1,maxY-minY);
        const target=Math.min(10,Math.max(.1,
            Math.min((viewport.clientWidth-110)/w,(viewport.clientHeight-172)/h)));
        zoomTo(target);
        const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2;
        scrollToVirtual(padding.left+centerX*target-viewport.clientWidth/2,
            padding.top+centerY*target-viewport.clientHeight/2);
        requestAnimationFrame(()=>scrollToVirtual(
            padding.left+centerX*target-viewport.clientWidth/2,
            padding.top+centerY*target-viewport.clientHeight/2));
    }

    function closeZoomMenu(){
        if(zoomMenu)zoomMenu.hidden=true;
        zoomTrigger?.setAttribute('aria-expanded','false');
    }
    zoomTrigger?.addEventListener('click',event=>{
        event.stopPropagation();
        const open=zoomMenu.hidden;
        zoomMenu.hidden=!open;
        zoomTrigger.setAttribute('aria-expanded',String(open));
    });
    zoomMenu?.addEventListener('click',event=>{
        const button=event.target.closest('button');
        if(!button)return;
        event.stopPropagation();
        const {action,zoom}=button.dataset;
        if(zoom)animateZoomTo(Number(zoom),260);
        if(action==='reset')animateZoomTo(1,260);
        if(action==='fit')fitSelection();
        closeZoomMenu();
    });
    document.addEventListener('pointerdown',event=>{
        if(!event.target.closest('#canvasZoomHud'))closeZoomMenu();
    });
    document.addEventListener('keydown',event=>{
        if(event.key==='Escape')closeZoomMenu();
    });

    window.HamokiViewport = {
        zoomTo,
        getZoom: () => state.zoom || 1,
        animateZoomTo,
        setZoom: target => {cancelZoomAnimation();return applyZoom(target);},
        centerOnWorld,
        reset: () => zoomTo(1),
        fitSelection,
        syncBounds,
        worldOrigin:()=>({left:padding.left,top:padding.top}),
        worldToScroll:(x,y,zoom=state.zoom||1)=>({
            left:padding.left+x*zoom,top:padding.top+y*zoom
        }),
        scrollToWorld:(x,y,zoom=state.zoom||1,behavior='auto')=>
            scrollToVirtual(padding.left+x*zoom,padding.top+y*zoom,behavior),
        scrollToVirtual,
        extendScrollBounds:expandNearEdge
    };

    zoomBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            zoomTo(state.zoom * (btn.textContent.trim() === '+' ? 1.2 : 1 / 1.2));
        });
    });

    viewport.addEventListener('wheel', e => {
        // Ordinary wheel zooms; cursor stays over the same artwork point.
        e.preventDefault();
        const factor = window.HamokiCanvasCore.wheelFactor(e);
        zoomTo(state.zoom * factor, e.clientX, e.clientY);
    }, {passive: false});

    // User input always takes priority over a completion zoom animation.
    viewport.addEventListener('pointerdown',cancelZoomAnimation,{capture:true});

    // Middle-mouse pan remains available without selecting or moving art.
    let panning = false, lastX = 0, lastY = 0;
    viewport.addEventListener('mousedown', e => {
        if (e.button !== 1 && !(e.button === 0 && e.shiftKey)) return;
        panning = true;
        window.HamokiCanvas?.beginPopoverMotion?.('pan');
        lastX = e.clientX;
        lastY = e.clientY;
        viewport.classList.add('canvas-panning');
        e.preventDefault();
    });
    viewport.addEventListener('auxclick', e => {
        if (e.button === 1) e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
        if (!panning) return;
        const desiredLeft=viewport.scrollLeft-(e.clientX-lastX);
        const desiredTop=viewport.scrollTop-(e.clientY-lastY);
        lastX=e.clientX;
        lastY=e.clientY;
        scrollToVirtual(desiredLeft,desiredTop);
        e.preventDefault();
    });
    const stopPan = () => {
        if (!panning) return;
        panning = false;
        viewport.classList.remove('canvas-panning');
        window.HamokiCanvas?.endPopoverMotion?.('pan');
    };
    document.addEventListener('mouseup', stopPan);
    window.addEventListener('blur', stopPan);
    viewport.addEventListener('scroll',expandNearEdge,{passive:true});
    window.addEventListener('resize', syncBounds);
    syncBounds();
    // Every visit opens at 50%. studio-v2.js centers the viewport on the newest
    // generated artwork once the project data has finished loading.
    applyZoom(0.5);
    // Preserve the former initial composition position, now with room to
    // pan freely in every direction (including past the original top/left).
    viewport.scrollLeft=padding.left;
    viewport.scrollTop=padding.top;
}


// ===== 导航切换 =====
function initNavigation() {
    const navBtns = document.querySelectorAll('.nav-icon-btn');
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.view === 'templates') {
                navBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                window.HamokiTemplateLibrary?.open();
                return;
            }
            if (btn.dataset.view === 'settings') {
                window.HamokiSettings?.open();
                return;
            }
            const returningFromTemplates = document.body.classList.contains('hamoki-templates-mode');
            if (returningFromTemplates) window.HamokiTemplateLibrary?.close();
            const sameGenerator = returningFromTemplates && state.currentView === btn.dataset.view;
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentView = btn.dataset.view;
            // Keep the original editor mounted when returning, preserving prompt,
            // references, selected model and current canvas layout.
            if (!sameGenerator) renderCurrentView();
            if (returningFromTemplates) {
                requestAnimationFrame(() => window.HamokiViewport?.syncBounds?.());
            }
        });
    });
}

// ===== 渲染当前视图 =====
function renderCurrentView() {
    const panel = document.getElementById('params-panel');
    if (state.currentView === 'settings') {
        renderSettings(panel);
    } else {
        renderParams(panel);
    }
}

// ===== 加载真实的任务队列 =====
async function loadJobs() {
    try {
        const response = await fetch('/api/jobs', {cache:'no-store'});
        if (!response.ok) throw Error('HTTP ' + response.status);
        const data = await response.json();
        const previous = new Map(state.jobs.map(job => [job.id,job.status]));
        const isFirstPoll = !state.jobPollReady;
        state.jobs = data.jobs || [];
        state.jobPollReady = true;
        state.queuePaused = !!data.paused;
        state.queueConcurrency = data.concurrency || 1;
        // Paint/refresh the canvas placeholders for queued and running jobs even
        // when no job has finished yet.
        window.HamokiGenerationFrames?.sync(state.jobs);
        const completed = isFirstPoll ? [] : state.jobs.filter(j => j.status === 'done' && previous.get(j.id) !== 'done');
        const failed = isFirstPoll ? [] : state.jobs.filter(j => j.status === 'failed' && previous.get(j.id) !== 'failed');
        if (completed.length) {
            // Remove any previous selection BEFORE the canvas is rebuilt, so
            // the finished image never flashes its upper/lower tool panels.
            window.HamokiCanvas?.clearSelection?.();
            await window.HamokiCanvas?.refresh();
            // Smoothly zoom the already-centered placeholder position to 180%.
            window.HamokiCanvas?.revealHistory(completed[0].resultId, 1.8);
            showQueueNotice(completed[0], completed.length);
        } else if (failed.length) {
            showQueueNotice(failed[0]);
        }
        renderQueue();
    } catch (e) {
        const title = document.querySelector('.queue-title');
        if (title) title.textContent = '队列连接中断';
        console.error('加载队列失败:', e);
    }
}


function renderQueue() {
    const content = document.querySelector('.queue-content');
    const title = document.querySelector('.queue-title');
    if (!content || !title) return;
    const running = state.jobs.filter(j => j.status === 'running');
    const queued = state.jobs.filter(j => j.status === 'queued');
    const done = state.jobs.filter(j => j.status === 'done');
    const failed = state.jobs.filter(j => ['failed','interrupted'].includes(j.status));
    title.textContent = running.length || queued.length ? `生成中 ${running.length} · 排队 ${queued.length}` : `生成队列 · 已完成 ${done.length}${failed.length ? ` · 失败 ${failed.length}` : ''}`;
    document.getElementById('queue-panel')?.classList.toggle('has-running',running.length > 0);
    const tabs = document.querySelectorAll('.queue-tab');
    const names = [`进行中 ${running.length} · 失败 ${failed.length}`,`排队中 ${queued.length}`,`已完成 ${done.length}`];
    tabs.forEach((tab,i) => tab.textContent = names[i]);
    const count = document.querySelector('.queue-concurrency');
    if (count) count.textContent = String(state.queueConcurrency || 1);
    const pause = document.getElementById('queue-pause');
    if (pause) pause.textContent = state.queuePaused ? '继续队列' : '暂停队列';
    const filter = state.queueFilter || 'active';
    const shown = filter === 'queued' ? queued : filter === 'done' ? done :
        state.jobs.filter(j => j.status !== 'done' && j.status !== 'cancelled');
    if (!shown.length) {
        content.textContent = filter === 'done' ? '还没有完成的任务' : '当前没有待处理的任务';
        content.classList.add('queue-empty');
        return;
    }
    content.classList.remove('queue-empty');
    const labels = {queued:'排队中',running:'生成中',done:'已完成',failed:'失败',interrupted:'已中断',cancelled:'已取消'};
    content.innerHTML = shown.slice(0,24).map(job => {
        const finished = job.status === 'done' && job.resultId;
        const image = finished ? window.HamokiCanvas?.findHistory(job.resultId)?.url : null;
        const preview = image || 'logo.png';
        const uncertain = job.completionUncertain || /(?:HTTP\s*(?:524|504)|上游请求超时)/i.test(job.error || '');
        const status = job.status === 'failed' && uncertain ? '上游超时 · 结果待核对' : (labels[job.status] || '未知状态');
        const hasRetry = state.jobs.some(item => item.retryOf === job.id);
        const action = ['running','queued'].includes(job.status) ? 'cancel' : ['failed','interrupted'].includes(job.status) && !hasRetry ? 'retry' : '';
        return `
          <div class="queue-item" data-job-id="${job.id}">
            ${image ? `<a href="${image}" target="_blank" rel="noopener noreferrer"><img src="${preview}" alt="已完成图片" class="queue-preview"></a>` : `<img src="${preview}" alt="任务" class="queue-preview">`}
            <div class="queue-info">
              <div class="queue-desc">${escapeHtml(job.prompt || '图像生成任务')}</div>
              <div class="queue-meta"><span>${escapeHtml(job.providerName || '中转站')}</span> · <span>${escapeHtml(job.model || '')}</span> · <span>${escapeHtml(job.resolution || '')}</span> · <span>${escapeHtml(job.ratio || '')}</span></div>
              ${job.error ? `<div class="queue-error">${escapeHtml(job.error)}</div>` : ''}
            </div>
            <div class="queue-progress"><span class="progress-text">${status}</span></div>
            ${action ? `<button type="button" class="queue-action-btn" data-action="${action}" data-id="${job.id}">${action === 'cancel' ? '取消' : uncertain ? '谨慎重试' : '重试'}</button>` : ''}
          </div>`;
    }).join('');
    content.querySelectorAll('[data-action]').forEach(button => {
        button.addEventListener('click', async () => {
            const act = button.dataset.action;
            const job = state.jobs.find(item => item.id === button.dataset.id);
            if (act === 'retry' && state.jobs.some(item => item.retryOf === button.dataset.id)) {
                void window.HamokiGlassUI.alert('这条任务已有后续重试，请先查看新任务状态，避免重复扣费。');
                return;
            }
            const uncertain = job?.completionUncertain || /(?:HTTP\s*(?:524|504)|上游请求超时)/i.test(job?.error || '');
            const warning = act === 'retry'
                ? (uncertain
                    ? '上游网关已超时，但图片可能仍在生成并已计费。请先核对中转站的任务和消费记录。\n确认要重新发起一笔可能再次扣费的请求吗？'
                    : '本操作会重新调用模型，可能再次产生费用。确认提交新的任务吗？')
                : '取消任务仍可能产生上游费用，确定取消吗？';
            if (!(await window.HamokiGlassUI.confirm(warning,{title:act==='retry'?'确认重试任务':'取消生成任务',confirmLabel:act==='retry'?'确认重试':'取消任务',danger:act==='retry'}))) return;
            button.disabled = true;
            try {
                const res = await fetch('/api/jobs/' + button.dataset.id + '/' + act, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(act === 'retry' ? {acknowledgePotentialCharge: true} : {})
                });
                const data = await res.json();
                if (!res.ok) throw Error(data.error || '操作失败');
                await loadJobs();
            } catch(e) {
                void window.HamokiGlassUI.alert('队列操作未确认：' + e.message + '。请先刷新队列核实结果，避免重复提交。');
                button.disabled = false;
            }
        });
    });
}

// ===== 渲染参数面板 =====
const MAX_REFERENCE_IMAGES = 5;
const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;
const MAX_REFERENCE_TOTAL_BYTES = 40 * 1024 * 1024;
const REFERENCE_MIME_TYPES = new Set(['image/png','image/jpeg','image/webp']);
let referenceSequence = 0;
function referenceEntries() {
    if (!Array.isArray(state.referenceImages)) state.referenceImages = [];
    return state.referenceImages;
}
function getReferenceFiles() {
    return referenceEntries().map(entry => entry.file);
}
function showReferenceFeedback(message) {
    const feedback = document.getElementById('reference-feedback');
    if (!feedback) return;
    feedback.textContent = message || '';
    feedback.hidden = !message;
}
function renderReferenceGallery() {
    const entries = referenceEntries();
    const grid = document.getElementById('reference-grid');
    if (!grid) return;
    grid.replaceChildren();
    grid.hidden = entries.length === 0;
    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        const card = document.createElement('div');
        card.className = 'reference-thumb';
        card.setAttribute('role','listitem');
        card.dataset.referenceId = String(entry.id);
        const image = document.createElement('img');
        image.src = entry.url;
        image.alt = '第 ' + (index + 1) + ' 张参考图：' + entry.file.name;
        image.loading = 'lazy';
        image.draggable = false;
        const filename = document.createElement('span');
        filename.className = 'reference-thumb-name';
        filename.textContent = entry.file.name;
        filename.title = entry.file.name;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'reference-thumb-remove';
        remove.setAttribute('aria-label','删除第 ' + (index + 1) + ' 张参考图：' + entry.file.name);
        remove.title = '删除这张参考图';
        remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 5 19 19M19 5 5 19"/></svg>';
        remove.addEventListener('click',event => {
            event.preventDefault();
            event.stopPropagation();
            removeReferenceImage(entry.id);
        });
        card.append(image,filename,remove);
        grid.append(card);
    }
    const count = document.getElementById('reference-count');
    if (count) count.textContent = entries.length + '/' + MAX_REFERENCE_IMAGES;
    const dropZone = document.getElementById('reference-dropzone');
    const upload = document.getElementById('reference-input');
    const full = entries.length >= MAX_REFERENCE_IMAGES;
    if (dropZone) {
        dropZone.classList.toggle('has-image',entries.length > 0);
        dropZone.classList.toggle('is-full',full);
        dropZone.setAttribute('aria-disabled',String(full));
    }
    if (upload) upload.disabled = full;
    const caption = document.getElementById('reference-file-name');
    if (caption) caption.textContent = full ? '参考图已达上限' : entries.length ? '继续添加参考图' : '最多 5 张；Ctrl+V 可追加图片。';
    const details = document.getElementById('reference-dimensions');
    const first = entries[0];
    state.referenceDimensions = first?.width && first?.height
        ? {file:first.file,width:first.width,height:first.height} : null;
    if (details) {
        details.hidden = entries.length === 0;
        details.textContent = first?.width && first?.height
            ? '首张 ' + first.width + ' × ' + first.height + ' · 自适应比例：' + nearestReferenceRatio(first.width,first.height)
            : entries.length ? '已选 ' + entries.length + ' 张，生成时全部作为参考图使用' : '';
    }
}
function appendReferenceImages(files) {
    const entries = referenceEntries();
    const supplied = Array.from(files || []);
    const issues = [];
    let added = 0;
    let total = entries.reduce((bytes,entry) => bytes + entry.file.size,0);
    for (const file of supplied) {
        if (entries.length >= MAX_REFERENCE_IMAGES) {
            issues.push('最多只能添加 ' + MAX_REFERENCE_IMAGES + ' 张参考图');
            break;
        }
        if (!REFERENCE_MIME_TYPES.has(file.type)) {
            issues.push(file.name + ' 不是 PNG、JPG 或 WebP 图片');
            continue;
        }
        if (!file.size || file.size > MAX_REFERENCE_BYTES) {
            issues.push(file.name + ' 超过单张 12 MB 限制');
            continue;
        }
        if (total + file.size > MAX_REFERENCE_TOTAL_BYTES) {
            issues.push('参考图总大小不能超过 40 MB');
            continue;
        }
        const entry = {id:++referenceSequence,file,url:URL.createObjectURL(file),width:null,height:null};
        entries.push(entry);
        total += file.size;
        added++;
        void readReferenceDimensions(file).then(dimensions => {
            if (!referenceEntries().includes(entry)) return;
            entry.width = dimensions.width;
            entry.height = dimensions.height;
            renderReferenceGallery();
        }).catch(() => {
            if (referenceEntries().includes(entry)) showReferenceFeedback('部分图片无法读取尺寸，请确认图片文件有效。');
        });
    }
    renderReferenceGallery();
    showReferenceFeedback(issues.length ? [...new Set(issues)].join('；') : '');
    return added;
}
function removeReferenceImage(id) {
    const entries = referenceEntries();
    const index = entries.findIndex(entry => entry.id === id);
    if (index === -1) return false;
    const removed = entries.splice(index,1)[0];
    URL.revokeObjectURL(removed.url);
    document.dispatchEvent(new CustomEvent('hamoki-reference-removed',{detail:{id}}));
    const input = document.getElementById('reference-input');
    if (input) input.value = '';
    renderReferenceGallery();
    showReferenceFeedback('');
    return true;
}
function clearReferenceImages() {
    for (const entry of referenceEntries()) URL.revokeObjectURL(entry.url);
    state.referenceImages = [];
    const input = document.getElementById('reference-input');
    if (input) input.value = '';
    renderReferenceGallery();
    showReferenceFeedback('');
}
window.HamokiReferences = {
    files:getReferenceFiles,
    add:appendReferenceImages,
    remove:removeReferenceImage,
    clear:clearReferenceImages
};
function activeCompositionMode() {
    return getReferenceFiles().length ? 'img2img' : 'text2img';
}

function renderParams(panel) {
    const modeTitle = ({
        'image-generate':'AI 生图','game-ui':'游戏 UI 生图'
    })[state.currentView] || '生成参数';
    panel.innerHTML = `
        <div class="panel-header">
            <h2>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M6.5 9h11a4 4 0 0 1 3.9 3.1l1 5a2.3 2.3 0 0 1-3.8 2.2l-2.3-2.1H7.7l-2.3 2.1a2.3 2.3 0 0 1-3.8-2.2l1-5A4 4 0 0 1 6.5 9Z"/>
                <path d="M7 12v5M4.5 14.5h5M16.5 13h.01M19 15h.01"/>
              </svg>
              ${modeTitle}
            </h2>
            <button class="refresh-btn" id="reset-params-btn" type="button" title="重置生成参数">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-2.7-6.4M21 3v7h-7"/>
                </svg>
                重置
            </button>
        </div>
        <div class="panel-content">
            <div class="param-group">
                <label class="param-label" id="model-label">模型 · 中转商</label>
                <div class="model-picker" id="model-picker">
                    <button class="model-picker-trigger" id="model-picker-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="model-label model-picker-name">
                        <span class="model-picker-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z"/><path class="ico-a" d="m12 6.6 1.6 4.4 4.4 1.6-4.4 1.6L12 18.6l-1.6-4.4L6 12.6l4.4-1.6Z"/></svg></span>
                        <span class="model-picker-name" id="model-picker-name">加载中转站…</span>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                    </button>
                    <div class="model-picker-list" id="model-picker-list" role="listbox" aria-label="选择模型和中转商" hidden></div>
                </div>
                <select id="provider-select" aria-label="中转站" hidden><option value="">请选择中转站</option></select>
                <select id="model-select" aria-label="图像模型" hidden><option value="">请选择生图模型</option></select>
            </div>
            <div class="param-group">
                <div class="prompt-label-row">
                    <label class="param-label" for="prompt-input">提示词 *</label>
                    <button type="button" id="prompt-history-trigger" class="prompt-history-trigger" aria-expanded="false" aria-controls="hamoki-prompt-history" title="查看提示词历史">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2M4 4l-1.5 3.5"/></svg> 历史
                    </button>
                </div>
                <div class="prompt-editor">
                    <textarea class="prompt-textarea" id="prompt-input" maxlength="1000"
                        placeholder="描述游戏界面、角色、构图、布局、画风与需要保留的元素…"></textarea>
                </div>
                <div class="char-count" id="char-count">0 / 1000</div>
            </div>
            <div class="param-group">
                <div class="reference-state-row">
                    <label class="param-label" id="reference-heading" for="reference-input">参考图（可选）</label>
                    <div class="reference-state-actions">
                        <span class="reference-count" id="reference-count" aria-live="polite">0/5</span>
                    </div>
                </div>
                <label class="upload-dropzone" id="reference-dropzone" for="reference-input">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M20 16.8A4.8 4.8 0 0 0 18.6 7a7 7 0 0 0-13.2 2.5A4.6 4.6 0 0 0 6 19h2"/>
                        <path d="M12 21V12m-4 4 4-4 4 4"/>
                    </svg>
                    <span id="reference-file-name">最多 5 张；Ctrl+V 可追加图片。</span>
                    <input id="reference-input" type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label="添加参考图，可多选">
                </label>
                <div class="reference-grid" id="reference-grid" role="list" aria-label="已添加的参考图" hidden></div>
                <div class="reference-dimensions" id="reference-dimensions" hidden></div>
                <p id="reference-feedback" class="reference-feedback" role="status" aria-live="polite" hidden></p>
            </div>
            <div class="param-group">
                <label class="param-label">分辨率</label>
                <div class="button-group" id="resolution-group">
                    <button type="button" class="param-button active" data-value="1K">1K</button>
                    <button type="button" class="param-button" data-value="2K">2K</button>
                    <button type="button" class="param-button" data-value="4K">4K</button>
                </div>
            </div>
            <div class="param-group">
                <div class="ratio-heading">
                    <span class="param-label" id="ratio-label">比例</span>
                </div>
                <div class="ratio-group" id="ratio-group" role="group" aria-labelledby="ratio-label">
                    <button type="button" class="ratio-button active" data-value="auto" aria-pressed="true"><span class="ratio-shape is-auto" aria-hidden="true"></span>自适应</button>
                    <button type="button" class="ratio-button" data-value="1:1" aria-pressed="false"><span class="ratio-shape" aria-hidden="true"></span>1:1</button>
                    <button type="button" class="ratio-button" data-value="9:16" aria-pressed="false"><span class="ratio-shape" aria-hidden="true"></span>9:16</button>
                    <button type="button" class="ratio-button" data-value="16:9" aria-pressed="false"><span class="ratio-shape" aria-hidden="true"></span>16:9</button>
                    <button type="button" class="ratio-button" data-value="3:4" aria-pressed="false"><span class="ratio-shape" aria-hidden="true"></span>3:4</button>
                    <button type="button" class="ratio-button" data-value="4:3" aria-pressed="false"><span class="ratio-shape" aria-hidden="true"></span>4:3</button>
                    <button type="button" class="ratio-button" data-value="2:3" aria-pressed="false"><span class="ratio-shape" aria-hidden="true"></span>2:3</button>
                    <button type="button" class="ratio-button" data-value="3:2" aria-pressed="false"><span class="ratio-shape" aria-hidden="true"></span>3:2</button>
                </div>
            </div>
            <div class="param-group custom-size-group" id="custom-size-group">
                <div class="custom-size-header">
                    <span class="param-label">自定义尺寸</span>
                    <button type="button" class="custom-size-toggle" id="custom-size-toggle" aria-pressed="false" aria-controls="custom-size-fields">开启</button>
                </div>
                <div class="custom-size-fields" id="custom-size-fields" hidden>
                    <label>宽 <input id="custom-image-width" type="number" min="512" max="4096" step="16" inputmode="numeric" value="1536" aria-label="自定义图片宽度（像素）"></label>
                    <span class="custom-size-times" aria-hidden="true">×</span>
                    <label>高 <input id="custom-image-height" type="number" min="512" max="4096" step="16" inputmode="numeric" value="1024" aria-label="自定义图片高度（像素）"></label>
                    <span class="custom-size-unit">px</span>
                </div>
                <p class="custom-size-hint" id="custom-size-hint" hidden>宽高为16的倍数；仅 GPT Image 2 系列。上游可能调整实际尺寸。</p>
            </div>
            <div class="param-group">
                <label class="param-label">生成数量</label>
                <div class="button-group" id="count-group">
                    <button type="button" class="param-button active" data-value="1">1</button>
                    <button type="button" class="param-button" data-value="2">2</button>
                    <button type="button" class="param-button" data-value="4">4</button>
                </div>
            </div>
            <button class="generate-button" id="generate-btn" type="button">
                <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="m11.5 1.5 1.9 6.6 6.6 1.9-6.6 1.9-1.9 6.6-1.9-6.6L3 10l6.6-1.9zM20 15l.9 2.7L23.5 19l-2.6.9L20 22.5l-1-2.6-2.5-.9 2.5-1.3z"/>
                </svg>
                添加到队列
            </button>
        </div>
    `;
    const header=panel.querySelector('.panel-header');
    const modelRow=panel.querySelector('#model-picker')?.closest('.param-group');
    if(header&&modelRow){
        modelRow.classList.add('header-model-group');
        header.insertBefore(modelRow,header.querySelector('#reset-params-btn'));
    }
    loadProvidersToSelect();
    bindParamsEvents();
    renderReferenceGallery();
    window.HamokiPromptHistory?.mount?.(panel);
}

async function loadProvidersToSelect() {
    try {
        const res = await fetch('/api/providers');
        const data = await res.json();
        state.providers = data.providers || [];
        state.activeProviderId = data.activeId;

        const select = document.getElementById('provider-select');
        if (!select) return;

        if (!state.providers.length) {
            select.innerHTML = '<option value="">请先添加中转站</option>';
            renderCompactModelPicker();
            return;
        }

        select.innerHTML = state.providers.map(p =>
            `<option value="${p.id}" ${p.id === state.activeProviderId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
        ).join('');
        const syncModel = () => {
            const modelSelect = document.getElementById('model-select');
            if (!modelSelect) return;
            const chosen = state.providers.find(p => p.id === select.value);
            modelSelect.replaceChildren();
            if (chosen?.imageModel) modelSelect.add(new Option(chosen.imageModel, chosen.imageModel));
            else modelSelect.add(new Option('请先在设置中配置生图模型', ''));
        };
        select.onchange = () => {syncModel();renderCompactModelPicker();};
        syncModel();
        renderCompactModelPicker();
    } catch (e) {
        console.error('加载中转站失败:', e);
    }
}

// Compact provider+model picker; the hidden selects remain the single source of truth.
function renderCompactModelPicker() {
    const chosenId = document.getElementById('provider-select')?.value;
    const chosen = state.providers.find(item => item.id === chosenId);
    const label = document.getElementById('model-picker-name');
    const list = document.getElementById('model-picker-list');
    const trigger = document.getElementById('model-picker-trigger');
    if (!label || !list || !trigger) return;
    label.textContent = chosen ? (chosen.imageModel || '未配置模型') + ' · ' + chosen.name : '请先在设置中添加中转商';
    trigger.title = label.textContent;
    trigger.disabled = !state.providers.length;
    list.replaceChildren();
    for (const provider of state.providers) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'model-picker-option' + (provider.id === chosenId ? ' active' : '');
        row.setAttribute('role','option');
        row.setAttribute('aria-selected',String(provider.id === chosenId));
        const icon = document.createElement('span');
        icon.className = 'model-option-icon';
        const iconSvg = document.createElementNS('http://www.w3.org/2000/svg','svg');
        iconSvg.setAttribute('viewBox','0 0 24 24');
        iconSvg.setAttribute('fill','none');
        iconSvg.setAttribute('stroke','currentColor');
        iconSvg.setAttribute('stroke-width','1.8');
        const star = document.createElementNS('http://www.w3.org/2000/svg','path');
        star.setAttribute('d',provider.mode === 'gemini' ? 'm12 2 2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3Z' : 'M4 6h16M7 12h10M10 18h4');
        iconSvg.append(star);
        icon.append(iconSvg);
        const titles = document.createElement('span');
        titles.className = 'model-option-text';
        const name = document.createElement('strong');
        name.textContent = provider.imageModel || '未配置图片模型';
        const source = document.createElement('small');
        source.textContent = provider.name;
        titles.append(name,source);
        const check = document.createElement('span');
        check.className = 'model-option-check';
        check.textContent = provider.id === chosenId ? '✓' : '';
        row.append(icon,titles,check);
        row.addEventListener('click',() => {
            const select = document.getElementById('provider-select');
            select.value = provider.id;
            select.dispatchEvent(new Event('change',{bubbles:true}));
            closeCompactModelPicker();
        });
        list.append(row);
    }
}
function closeCompactModelPicker() {
    const list = document.getElementById('model-picker-list');
    const trigger = document.getElementById('model-picker-trigger');
    if (list) list.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded','false');
}
function nearestReferenceRatio(width,height) {
    const options = ['1:1','3:2','2:3','16:9','9:16','4:3','3:4'];
    if (!Number.isFinite(width / height) || width <= 0 || height <= 0) return '1:1';
    return options.reduce((best,item) => {
        const [a,b] = item.split(':').map(Number);
        const [x,y] = best.split(':').map(Number);
        return Math.abs(Math.log((width / height) / (a / b))) <
            Math.abs(Math.log((width / height) / (x / y))) ? item : best;
    },'1:1');
}
async function readReferenceDimensions(file) {
    if (!file) return null;
    const bitmap = await createImageBitmap(file);
    const dimensions = {file,width:bitmap.width,height:bitmap.height};
    bitmap.close();
    return dimensions;
}

function bindParamsEvents() {
    document.getElementById('reset-params-btn')?.addEventListener('click', window.resetParams);
    const textarea = document.getElementById('prompt-input');
    const charCount = document.getElementById('char-count');

    if (textarea && charCount) {
        textarea.addEventListener('input', () => {
            const len = textarea.value.length;
            charCount.textContent = `${len} / 1000`;
            charCount.style.color = len > 1000 ? '#ef4444' : 'var(--text-muted)';
        });
    }

    document.getElementById('model-picker-trigger')?.addEventListener('click',() => {
        const list = document.getElementById('model-picker-list');
        const trigger = document.getElementById('model-picker-trigger');
        if (!list || !trigger) return;
        list.hidden = !list.hidden;
        trigger.setAttribute('aria-expanded',String(!list.hidden));
    });
    if (!window.hamokiModelPickerOutsideClickBound) {
        window.hamokiModelPickerOutsideClickBound = true;
        document.addEventListener('pointerdown',event => {
            if (!event.target.closest('#model-picker')) closeCompactModelPicker();
        });
        document.addEventListener('keydown',event => {
            if (event.key === 'Escape') closeCompactModelPicker();
        });
    }
    document.querySelectorAll('.param-button, .ratio-button').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.button-group, .ratio-group')?.querySelectorAll('.param-button, .ratio-button').forEach(b => {
                b.classList.remove('active');
                if (b.classList.contains('ratio-button')) b.setAttribute('aria-pressed','false');
            });
            btn.classList.add('active');
            if (btn.classList.contains('ratio-button')) btn.setAttribute('aria-pressed','true');
        });
    });

    const customToggle = document.getElementById('custom-size-toggle');
    const customFields = document.getElementById('custom-size-fields');
    const customHint = document.getElementById('custom-size-hint');
    const customWidth = document.getElementById('custom-image-width');
    const customHeight = document.getElementById('custom-image-height');
    const updateCustomSizeUI = () => {
        const enabled = !!state.customSizeEnabled;
        customFields.hidden = !enabled;
        customHint.hidden = !enabled;
        customToggle.textContent = enabled ? '已开启' : '开启';
        customToggle.setAttribute('aria-pressed', String(enabled));
        customToggle.classList.toggle('active', enabled);
        document.querySelectorAll('#resolution-group .param-button, #ratio-group .ratio-button').forEach(button => {
            button.disabled = enabled;
        });
        document.querySelector('#resolution-group')?.classList.toggle('custom-size-locked', enabled);
        document.querySelector('#ratio-group')?.classList.toggle('custom-size-locked', enabled);
    };
    if (customToggle && customFields && customWidth && customHeight) {
        customWidth.value = state.customWidth;
        customHeight.value = state.customHeight;
        customToggle.addEventListener('click', () => {
            state.customSizeEnabled = !state.customSizeEnabled;
            updateCustomSizeUI();
            if (state.customSizeEnabled) customWidth.focus();
        });
        customWidth.addEventListener('input', () => { state.customWidth = customWidth.value; });
        customHeight.addEventListener('input', () => { state.customHeight = customHeight.value; });
        updateCustomSizeUI();
    }

    const imageInput = document.getElementById('reference-input');
    const dropZone = document.getElementById('reference-dropzone');
    if (imageInput && dropZone) {
        imageInput.addEventListener('change', () => {
            // The native input is a picker only. Keep the actual selected files
            // in the gallery so subsequent uploads never overwrite earlier ones.
            const added = Array.from(imageInput.files || []);
            imageInput.value = '';
            appendReferenceImages(added);
        });
        ['dragenter','dragover'].forEach(name => dropZone.addEventListener(name, event => {
            event.preventDefault();
            dropZone.classList.add('is-dragging');
        }));
        ['dragleave','dragend'].forEach(name => dropZone.addEventListener(name, () =>
            dropZone.classList.remove('is-dragging')));
        dropZone.addEventListener('drop', event => {
            event.preventDefault();
            dropZone.classList.remove('is-dragging');
            appendReferenceImages(event.dataTransfer?.files || []);
        });
    }

    const generateBtn = document.getElementById('generate-btn');
    if (generateBtn) {
        generateBtn.addEventListener('click', submitJob);
    }
}

// A pasted image becomes the same reference source used by regular upload.
function initImageClipboard() {
    const viewport = document.getElementById('canvas-viewport');
    if (viewport) {
        viewport.tabIndex = 0;
        viewport.setAttribute('aria-label','自由画布，选择图片或按 Ctrl+V 粘贴图片');
        viewport.addEventListener('pointerdown', event => {
            if (event.target === viewport || event.target.id === 'canvas') viewport.focus({preventScroll:true});
        });
    }
    if(viewport){
        let depth=0;
        viewport.addEventListener('dragenter',event=>{
            if(!Array.from(event.dataTransfer?.types||[]).includes('Files'))return;
            event.preventDefault();depth++;viewport.classList.add('canvas-import-dragging');
        });
        viewport.addEventListener('dragover',event=>{
            if(Array.from(event.dataTransfer?.types||[]).includes('Files'))event.preventDefault();
        });
        viewport.addEventListener('dragleave',event=>{
            event.preventDefault();depth=Math.max(0,depth-1);
            if(!depth)viewport.classList.remove('canvas-import-dragging');
        });
        viewport.addEventListener('drop',event=>{
            event.preventDefault();event.stopPropagation();depth=0;
            viewport.classList.remove('canvas-import-dragging');
            const files=Array.from(event.dataTransfer?.files||[]).filter(f=>REFERENCE_MIME_TYPES.has(f.type));
            if(!files.length)return;
            const zoom=state.zoom||1;
            const bounds=viewport.getBoundingClientRect();
            const origin=window.HamokiViewport?.worldOrigin?.()||{left:0,top:0};
            const x=Math.round((viewport.scrollLeft+event.clientX-bounds.left-origin.left)/zoom-144);
            const y=Math.round((viewport.scrollTop+event.clientY-bounds.top-origin.top)/zoom-144);
            window.HamokiCanvas?.addReferenceFiles(files,{x,y});
        });
    }
    document.addEventListener('paste', event => {
        if (document.body.classList.contains('hs-modal-open') || document.body.classList.contains('flow-mode')) return;
        const items=Array.from(event.clipboardData?.items || []);
        const item = items
            .find(entry => entry.kind === 'file' && ['image/png','image/jpeg','image/webp'].includes(entry.type));
        const editable=!!event.target.closest?.('input,textarea,select,[contenteditable]');
        if(editable)return;
        const pastedOnCanvas=!!viewport;
        if (!item) {
            // For clipboard-denied browsers, the internal copy shortcut works only
            // when there is no unrelated text/file data in the current clipboard.
            const record=pastedOnCanvas && !items.length
                ?window.HamokiImageClipboard?.fallback(window.HamokiCanvas?.getProjectId(),items):null;
            if(record){event.preventDefault();void window.HamokiCanvas.duplicateFromClipboard(record).catch(error=>void window.HamokiGlassUI.alert('图片粘贴失败：'+error.message));}
            return;
        }
        const original=item.getAsFile();
        if(!original)return;
        event.preventDefault();
        if(pastedOnCanvas){
            try{
                // Materialize a local preview before any async hashing or transport.
                if(original.size>12*1024*1024)throw Error('图片超过 12 MB，请先压缩');
                window.HamokiCanvas.addReferenceFile(original);
            }catch(error){void window.HamokiGlassUI.alert('图片粘贴失败：'+error.message);}
            return;
        }
        if (original.size > 12 * 1024 * 1024) {
            void window.HamokiGlassUI.alert('粘贴图片超过 12 MB。请先压缩后重试，原有参考图大小限制不变。');
            return;
        }
        const imageFile = new File([original],original.name || ('粘贴参考图-' + Date.now() + (original.type==='image/png'?'.png':original.type==='image/webp'?'.webp':'.jpg')),
            {type:original.type,lastModified:Date.now()});
        if (!document.getElementById('reference-input')) {
            state.currentView = 'image-generate';
            document.querySelectorAll('.nav-icon-btn').forEach(btn => btn.classList.toggle('active',btn.dataset.view === 'image-generate'));
            renderCurrentView();
        }
        appendReferenceImages([imageFile]);
    });
}

async function submitJob() {
    const prompt = document.getElementById('prompt-input')?.value.trim();
    const providerId = document.getElementById('provider-select')?.value;
    const resolution = document.querySelector('#resolution-group .active')?.dataset.value || '1K';
    const chosenRatio = document.querySelector('#ratio-group .active')?.dataset.value || 'auto';
    const count = parseInt(document.querySelector('#count-group .active')?.dataset.value || '1');
    const model = document.getElementById('model-select')?.value;
    let customSize = null;
    if (state.customSizeEnabled) {
        const widthText = document.getElementById('custom-image-width')?.value.trim() || '';
        const heightText = document.getElementById('custom-image-height')?.value.trim() || '';
        const width = Number(widthText), height = Number(heightText);
        if (!/^\d+$/.test(widthText) || !/^\d+$/.test(heightText) ||
            !Number.isInteger(width) || !Number.isInteger(height) ||
            width < 512 || height < 512 || width > 4096 || height > 4096 ||
            width % 16 !== 0 || height % 16 !== 0 ||
            width > 3 * height || height > 3 * width || width * height > 3840 * 2160) {
            void window.HamokiGlassUI.alert('自定义尺寸需为 16 的倍数、宽高 512～4096、比例 1:3～3:1、总像素不超过 829 万。');
            return;
        }
        if (!/^gpt-image-2(?:$|[.\-])/i.test(String(model || ''))) {
            void window.HamokiGlassUI.alert('自定义尺寸目前只支持 GPT Image 2 系列模型，请切换模型或关闭自定义尺寸。');
            return;
        }
        customSize = width + 'x' + height;
    }
    const referenceFiles = getReferenceFiles();
    if (referenceFiles.some(file => !REFERENCE_MIME_TYPES.has(file.type) || !file.size || file.size > MAX_REFERENCE_BYTES)
        || referenceFiles.length > MAX_REFERENCE_IMAGES
        || referenceFiles.reduce((total,file) => total + file.size,0) > MAX_REFERENCE_TOTAL_BYTES) {
        void window.HamokiGlassUI.alert('请检查参考图：最多 5 张，单张不超过 12 MB、合计不超过 40 MB');
        return;
    }

    if (!prompt) {
        void window.HamokiGlassUI.alert('请输入提示词');
        return;
    }

    if (!providerId) {
        void window.HamokiGlassUI.alert('请选择中转站');
        return;
    }

    try {
        const dimensions = chosenRatio === 'auto' && referenceFiles.length
            ? (state.referenceDimensions?.file === referenceFiles[0] ? state.referenceDimensions : await readReferenceDimensions(referenceFiles[0]))
            : null;
        // Presets retain their original ratios; customSize is sent separately when enabled.
        const ratio = chosenRatio === 'auto'
            ? (dimensions ? nearestReferenceRatio(dimensions.width,dimensions.height) : '1:1')
            : chosenRatio;
        const btn = document.getElementById('generate-btn');
        btn.disabled = true;
        btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg> 提交中...';

        // Send every surviving thumbnail, in its visual order, to the existing
        // multi-reference server API. A deleted thumbnail is never submitted.
        // Cropped images are retained locally until this explicit generation submission.
        await window.HamokiCanvas?.prepareGenerationReferences?.(referenceFiles);
        const references = await Promise.all(referenceFiles.map(file =>
            new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(Error('无法读取参考图片：' + file.name));
                reader.readAsDataURL(file);
            })
        ));
        const res = await fetch('/api/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                targets: [{ providerId, model }],
                ratio,
                resolution,
                customSize,
                count,
                references,
                editMode: 'new',
                quality: 'auto'
            })
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || '提交失败');
        }

        // Immediately show the loading placeholder(s) in the exact canvas slot
        // where the finished image will appear, then bring the first one into view.
        const submitted = await res.json().catch(() => ({}));
        const createdJobs = Array.isArray(submitted.jobs) ? submitted.jobs : [];
        if (createdJobs.length) {
            window.HamokiGenerationFrames?.sync(createdJobs.concat(state.jobs));
            window.HamokiGenerationFrames?.reveal(createdJobs[0]);
        }

        btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> 已添加';
        setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> 添加到队列';
        }, 1500);

        loadJobs();
    } catch (e) {
        void window.HamokiGlassUI.alert('提交失败: ' + e.message);
        const btn = document.getElementById('generate-btn');
        btn.disabled = false;
        btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> 添加到队列';
    }
}

window.resetParams = function() {
    document.getElementById('prompt-input').value = '';
    document.getElementById('char-count').textContent = '0 / 1000';
    window.HamokiTemplateLibrary?.clearAppliedTemplate({reset:true});
    clearReferenceImages();
    document.querySelectorAll('.param-button, .ratio-button').forEach(b => b.classList.remove('active'));
    document.querySelector('#resolution-group [data-value="1K"]').classList.add('active');
    document.querySelector('#ratio-group [data-value="auto"]')?.click();
    document.querySelector('#count-group [data-value="1"]').classList.add('active');
    state.customSizeEnabled = false;
    state.customWidth = '1536';
    state.customHeight = '1024';
    const customFields = document.getElementById('custom-size-fields');
    if (customFields) customFields.hidden = true;
    const customHint = document.getElementById('custom-size-hint');
    if (customHint) customHint.hidden = true;
    const customToggle = document.getElementById('custom-size-toggle');
    if (customToggle) {customToggle.textContent = '开启';customToggle.classList.remove('active');customToggle.setAttribute('aria-pressed','false');}
    for (const id of ['custom-image-width','custom-image-height']) {
        const input = document.getElementById(id);
        if (input) input.value = id === 'custom-image-width' ? state.customWidth : state.customHeight;
    }
    document.querySelectorAll('#resolution-group .param-button, #ratio-group .ratio-button').forEach(button => {button.disabled = false;});
    document.getElementById('resolution-group')?.classList.remove('custom-size-locked');
    document.getElementById('ratio-group')?.classList.remove('custom-size-locked');
};

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===== 设置面板（保持原有代码）=====
function renderSettings(panel) {
    panel.innerHTML = `
        <div class="panel-header">
            <h2>设置</h2>
        </div>
        <div class="panel-content settings-content">
            <div class="settings-section">
                <h3>中转站配置</h3>
                <button class="add-provider-btn" id="add-provider-btn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    添加中转站
                </button>
            </div>
            <div id="providers-list" class="providers-list">加载中...</div>
            <div id="add-form" class="add-provider-form" style="display:none;">
                <h4>添加新的中转站</h4>
                <div class="form-group">
                    <label>名称 *</label>
                    <input type="text" id="provider-name" placeholder="例如：OpenAI">
                </div>
                <div class="form-group">
                    <label>接口类型 *</label>
                    <select id="provider-mode">
                        <option value="openai">OpenAI 兼容</option>
                        <option value="gemini">Gemini</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>基础地址 *</label>
                    <input type="text" id="provider-url" placeholder="https://api.openai.com/v1">
                </div>
                <div class="form-group">
                    <label>API Key *</label>
                    <input type="password" id="provider-key" placeholder="sk-...">
                    <button class="btn-fetch-models" id="fetch-models-btn" type="button">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                        </svg>
                        获取可用模型
                    </button>
                </div>
                <div class="form-group">
                    <label>图像模式</label>
                    <select id="provider-image-mode">
                        <option value="images">images (标准DALL-E)</option>
                        <option value="chat">chat (对话接口)</option>
                        <option value="responses">responses (响应接口)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>图像模型 *</label>
                    <input type="text" id="provider-image-model" placeholder="dall-e-3 或 gpt-image-2">
                </div>
                <div class="form-group">
                    <label>视觉模型（用于图片反推）</label>
                    <input type="text" id="provider-vision-model" placeholder="gpt-4o-mini">
                </div>
                <div id="models-list" class="models-list" style="display:none;"></div>
                <div id="form-message" class="form-message"></div>
                <div class="form-actions">
                    <button class="btn-save" id="save-provider-btn">保存</button>
                    <button class="btn-cancel" id="cancel-provider-btn">取消</button>
                </div>
            </div>
        </div>
    `;
    loadProviders();
    bindSettingsEvents();
}

function bindSettingsEvents() {
    const addBtn = document.getElementById('add-provider-btn');
    const form = document.getElementById('add-form');
    const saveBtn = document.getElementById('save-provider-btn');
    const cancelBtn = document.getElementById('cancel-provider-btn');
    const fetchModelsBtn = document.getElementById('fetch-models-btn');

    addBtn?.addEventListener('click', () => {
        form.style.display = 'block';
        addBtn.style.display = 'none';
    });

    cancelBtn?.addEventListener('click', () => {
        form.style.display = 'none';
        addBtn.style.display = 'flex';
        clearProviderForm();
    });

    saveBtn?.addEventListener('click', saveProvider);
    fetchModelsBtn?.addEventListener('click', fetchModels);
}

async function loadProviders() {
    try {
        const res = await fetch('/api/providers');
        const data = await res.json();
        state.providers = data.providers || [];
        state.activeProviderId = data.activeId;
        renderProvidersList();
    } catch (e) {
        document.getElementById('providers-list').innerHTML = `<div class="error-message">加载失败: ${e.message}</div>`;
    }
}

function renderProvidersList() {
    const list = document.getElementById('providers-list');
    if (!state.providers.length) {
        list.innerHTML = '<div class="empty-state">暂无中转站配置</div>';
        return;
    }

    const colors = [
        'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)'
    ];

    list.innerHTML = state.providers.map((p, i) => `
        <div class="provider-item ${p.id === state.activeProviderId ? 'active' : ''}">
            <div class="provider-icon" style="background: ${colors[i % colors.length]}">
                ${p.name.substring(0, 2).toUpperCase()}
            </div>
            <div class="provider-info">
                <div class="provider-name">
                    ${escapeHtml(p.name)}
                    ${p.id === state.activeProviderId ? '<span class="badge-active">使用中</span>' : ''}
                </div>
                <div class="provider-url">${escapeHtml(p.url)}</div>
            </div>
            <div class="provider-actions">
                ${p.id !== state.activeProviderId ? `<button class="btn-activate" onclick="activateProvider('${p.id}')">激活</button>` : ''}
                <button class="btn-edit" onclick="editProvider('${p.id}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
                <button class="btn-test" onclick="testProvider('${p.id}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M12 1v6m0 6v6"/>
                    </svg>
                </button>
                <button class="btn-delete" onclick="deleteProvider('${p.id}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

async function saveProvider() {
    const name = document.getElementById('provider-name').value.trim();
    const mode = document.getElementById('provider-mode').value;
    const url = document.getElementById('provider-url').value.trim();
    const apiKey = document.getElementById('provider-key').value.trim();
    const imageMode = document.getElementById('provider-image-mode').value;
    const imageModel = document.getElementById('provider-image-model').value.trim() || 'gpt-image-2';
    const visionModel = document.getElementById('provider-vision-model').value.trim() || 'gpt-4o-mini';

    if (!name || !url || !apiKey) {
        showFormMessage('请填写必填项（名称、地址、API Key）', 'error');
        return;
    }

    if (!imageModel) {
        showFormMessage('请填写图像模型', 'error');
        return;
    }

    try {
        const res = await fetch('/api/providers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, mode, url, apiKey, imageMode, imageModel, visionModel })
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || '保存失败');
        }

        await loadProviders();
        document.getElementById('add-form').style.display = 'none';
        document.getElementById('add-provider-btn').style.display = 'flex';
        clearProviderForm();
        showFormMessage('添加成功', 'success');
    } catch (e) {
        showFormMessage(e.message, 'error');
    }
}

async function fetchModels() {
    const url = document.getElementById('provider-url').value.trim();
    const apiKey = document.getElementById('provider-key').value.trim();
    const mode = document.getElementById('provider-mode').value;

    if (!url || !apiKey) {
        showFormMessage('请先填写基础地址和API Key', 'error');
        return;
    }

    const btn = document.getElementById('fetch-models-btn');
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg> 获取中...';

    try {
        const tempRes = await fetch('/api/providers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: '__temp_fetch__',
                mode,
                url,
                apiKey,
                imageMode: 'images',
                imageModel: 'temp',
                visionModel: 'temp'
            })
        });

        if (!tempRes.ok) {
            const data = await tempRes.json();
            throw new Error(data.error || '连接失败');
        }

        const tempProvider = await tempRes.json();
        const providerId = tempProvider.provider.id;
        const modelsRes = await fetch(`/api/models?providerId=${providerId}`);
        await fetch(`/api/providers/${providerId}`, { method: 'DELETE' });

        if (!modelsRes.ok) {
            throw new Error('获取模型列表失败');
        }

        const modelsData = await modelsRes.json();
        displayModels(modelsData.models || []);

    } catch (e) {
        showFormMessage('获取模型失败: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

function displayModels(models) {
    const listEl = document.getElementById('models-list');

    if (!models.length) {
        showFormMessage('未找到可用模型', 'error');
        return;
    }

    const imageModels = models.filter(m =>
        m.toLowerCase().includes('image') ||
        m.toLowerCase().includes('dall-e') ||
        m.toLowerCase().includes('midjourney')
    );

    const visionModels = models.filter(m =>
        m.toLowerCase().includes('vision') ||
        m.toLowerCase().includes('gpt-4') ||
        m.toLowerCase().includes('gemini')
    );

    listEl.innerHTML = `
        <div class="models-section">
            <h5>可用模型列表（共 ${models.length} 个）</h5>
            ${imageModels.length > 0 ? `
                <div class="model-category">
                    <strong>图像模型：</strong>
                    <div class="model-tags">
                        ${imageModels.map(m => `<span class="model-tag" onclick="setImageModel('${m}')">${escapeHtml(m)}</span>`).join('')}
                    </div>
                </div>
            ` : ''}
            ${visionModels.length > 0 ? `
                <div class="model-category">
                    <strong>视觉模型：</strong>
                    <div class="model-tags">
                        ${visionModels.map(m => `<span class="model-tag" onclick="setVisionModel('${m}')">${escapeHtml(m)}</span>`).join('')}
                    </div>
                </div>
            ` : ''}
            <div class="model-category">
                <strong>所有模型：</strong>
                <div class="model-tags">
                    ${models.slice(0, 30).map(m => `<span class="model-tag-small">${escapeHtml(m)}</span>`).join('')}
                    ${models.length > 30 ? `<span class="model-tag-small">...还有 ${models.length - 30} 个</span>` : ''}
                </div>
            </div>
        </div>
    `;
    listEl.style.display = 'block';
    showFormMessage(`找到 ${models.length} 个模型`, 'success');
}

window.setImageModel = function(model) {
    document.getElementById('provider-image-model').value = model;
    showFormMessage(`已设置图像模型: ${model}`, 'success');
};

window.setVisionModel = function(model) {
    document.getElementById('provider-vision-model').value = model;
    showFormMessage(`已设置视觉模型: ${model}`, 'success');
};

window.activateProvider = async function(id) {
    try {
        const res = await fetch(`/api/providers/${id}/activate`, { method: 'POST' });
        const data = await res.json();
        state.activeProviderId = data.activeId;
        renderProvidersList();
        loadProvidersToSelect();
    } catch (e) {
        void window.HamokiGlassUI.alert('激活失败: ' + e.message);
    }
};

window.testProvider = async function(id) {
    try {
        const res = await fetch(`/api/providers/${id}/check`);
        const data = await res.json();
        if (data.reachable) {
            void window.HamokiGlassUI.alert(`连接成功 (${data.latencyMs}ms)\n找到 ${data.models?.length || 0} 个模型`);
        } else {
            void window.HamokiGlassUI.alert(`连接失败\n${data.error || '未知错误'}`);
        }
    } catch (e) {
        void window.HamokiGlassUI.alert('测试失败: ' + e.message);
    }
};

window.deleteProvider = async function(id) {
    if (!(await window.HamokiGlassUI.confirm('确定要删除此中转站吗？',{title:'删除中转站',confirmLabel:'删除',danger:true}))) return;
    try {
        const res = await fetch(`/api/providers/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || '删除失败');
        }
        const data = await res.json();
        state.activeProviderId = data.activeId;
        await loadProviders();
    } catch (e) {
        void window.HamokiGlassUI.alert('删除失败: ' + e.message);
    }
};

window.editProvider = function(id) {
    const provider = state.providers.find(p => p.id === id);
    if (!provider) return;

    // 显示表单
    const form = document.getElementById('add-form');
    const addBtn = document.getElementById('add-provider-btn');
    form.style.display = 'block';
    addBtn.style.display = 'none';

    // 填充数据
    document.getElementById('provider-name').value = provider.name;
    document.getElementById('provider-mode').value = provider.mode;
    document.getElementById('provider-url').value = provider.url;
    document.getElementById('provider-key').value = ''; // 不显示原密码
    document.getElementById('provider-image-mode').value = provider.imageMode || 'images';
    document.getElementById('provider-image-model').value = provider.imageModel || '';
    document.getElementById('provider-vision-model').value = provider.visionModel || '';

    // 修改表单标题
    const formTitle = form.querySelector('h4');
    formTitle.textContent = '编辑中转站';

    // 修改保存按钮
    const saveBtn = document.getElementById('save-provider-btn');
    saveBtn.textContent = '保存修改';
    saveBtn.onclick = () => updateProvider(id);
};

async function updateProvider(id) {
    const name = document.getElementById('provider-name').value.trim();
    const mode = document.getElementById('provider-mode').value;
    const url = document.getElementById('provider-url').value.trim();
    const apiKey = document.getElementById('provider-key').value.trim();
    const imageMode = document.getElementById('provider-image-mode').value;
    const imageModel = document.getElementById('provider-image-model').value.trim();
    const visionModel = document.getElementById('provider-vision-model').value.trim();

    if (!name || !url) {
        showFormMessage('请填写必填项（名称、地址）', 'error');
        return;
    }

    if (!imageModel) {
        showFormMessage('请填写图像模型', 'error');
        return;
    }

    try {
        const body = {
            name,
            mode,
            url,
            imageMode,
            imageModel,
            visionModel
        };

        // 如果填写了新密码，才更新密码
        if (apiKey) {
            body.apiKey = apiKey;
        }

        const res = await fetch(`/api/providers/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || '更新失败');
        }

        await loadProviders();
        document.getElementById('add-form').style.display = 'none';
        document.getElementById('add-provider-btn').style.display = 'flex';
        clearProviderForm();

        // 恢复表单标题和按钮
        const formTitle = document.querySelector('#add-form h4');
        formTitle.textContent = '添加新的中转站';
        const saveBtn = document.getElementById('save-provider-btn');
        saveBtn.textContent = '保存';
        saveBtn.onclick = saveProvider;

        showFormMessage('更新成功', 'success');
    } catch (e) {
        showFormMessage('更新失败: ' + e.message, 'error');
    }
}

function clearProviderForm() {
    document.getElementById('provider-name').value = '';
    document.getElementById('provider-url').value = '';
    document.getElementById('provider-key').value = '';
    document.getElementById('provider-image-model').value = '';
    document.getElementById('provider-vision-model').value = '';
    document.getElementById('form-message').textContent = '';
    document.getElementById('models-list').style.display = 'none';
}

function showFormMessage(msg, type) {
    const el = document.getElementById('form-message');
    el.textContent = msg;
    el.className = `form-message ${type}`;
    setTimeout(() => el.textContent = '', 3000);
}

console.log('Hamoki Studio 已加载');
