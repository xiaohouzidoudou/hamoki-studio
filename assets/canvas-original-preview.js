/* Canvas original-image preview. Keep the full-resolution image on this page;
   the browser's native modal top layer handles focus and keyboard Escape. */
(() => {
  'use strict';
  let dialog;
  let stage;
  let content;
  let figure;
  let image;
  let info;
  let closeButton;
  let downloadButton;
  let downloadLabel;
  let imageTools;
  let returnFocus;
  let currentSource = '';
  let currentCard = null;
  let loadRevision = 0;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  function element(tag, className) {
    const node = document.createElement(tag);
    node.className = className;
    return node;
  }

  function mount() {
    if (dialog) return;
    dialog = element('dialog', 'hm-original-preview');
    dialog.setAttribute('aria-label', '原图预览');
    stage = element('div', 'hm-original-stage');
    figure = element('figure', 'hm-original-figure');
    image = element('img', 'hm-original-image');
    image.alt = '原始尺寸的图片';
    image.draggable = false;
    figure.append(image);
    downloadButton = element('button', 'hm-original-download');
    downloadButton.type = 'button';
    downloadButton.disabled = true;
    downloadButton.title = '下载当前图片的原始文件';
    downloadButton.setAttribute('aria-label', '下载原图');
    downloadButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 17v3h16v-3"/></svg>';
    downloadLabel = element('span', 'hm-original-download-label');
    downloadLabel.textContent = '下载原图';
    downloadButton.append(downloadLabel);
    content = element('div', 'hm-original-content');
    content.append(figure);
    stage.append(content);

    closeButton = element('button', 'hm-original-close');
    closeButton.type = 'button';
    closeButton.title = '关闭原图预览 (Esc)';
    closeButton.setAttribute('aria-label', '关闭原图预览');
    closeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5"/></svg>';

    info = element('span', 'hm-original-info');
    info.setAttribute('role', 'status');
    info.setAttribute('aria-live', 'polite');

    // Tools sit just OUTSIDE the artwork at its lower-right corner.
    imageTools = element('div', 'hm-original-tools');
    imageTools.append(info, downloadButton);
    content.append(imageTools);
    dialog.append(stage, closeButton);
    document.body.append(dialog);

    closeButton.addEventListener('click', close);
    downloadButton.addEventListener('click', downloadOriginal);
    window.addEventListener('resize', placeTools);
    dialog.addEventListener('click', event => {
      if (event.target === stage || event.target === dialog) close();
    });
    dialog.addEventListener('close', () => {
      ++loadRevision;
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
      figure.classList.remove('ready');
      content.style.transform = '';
      image.style.removeProperty('max-height');
      currentSource = '';
      currentCard = null;
      downloadButton.disabled = true;
      downloadLabel.textContent = '下载原图';
      if (returnFocus?.isConnected) {
        try { returnFocus.focus({preventScroll: true}); } catch { /* Node removed while preview was open. */ }
      }
      returnFocus = null;
    });
  }


  // Save the original response bytes, not a resized canvas or preview screenshot.
  function downloadName(source, card, blob) {
    let pathName = '';
    try {
      if (!source.startsWith('data:') && !source.startsWith('blob:')) {
        pathName = decodeURIComponent(new URL(source, location.href).pathname.split('/').pop() || '');
      }
    } catch { /* Use a safe generic name if the URL cannot be parsed. */ }
    const cardTitle = card?.querySelector?.('.canvas-node-name')?.textContent?.trim();
    const stem = String(cardTitle || pathName || 'Hamoki-original')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\.(png|jpe?g|webp|gif|avif|svg)$/i, '')
      .trim().slice(0, 72) || 'Hamoki-original';
    const mime = (blob.type || '').split(';')[0].toLowerCase();
    const ext = ({
      'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
      'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg'
    })[mime] || (pathName.match(/\.(png|jpe?g|webp|gif|avif|svg)$/i)?.[1] || 'png');
    return stem + '.' + (ext.toLowerCase() === 'jpeg' ? 'jpg' : ext.toLowerCase());
  }

  async function downloadOriginal(event) {
    event?.stopPropagation();
    if (!dialog?.open || !currentSource || downloadButton.disabled) return;
    const source = currentSource;
    const sourceCard = currentCard;
    downloadButton.disabled = true;
    downloadLabel.textContent = '下载中…';
    try {
      const response = await fetch(source, {credentials: 'same-origin'});
      if (!response.ok) throw new Error('图片读取失败（HTTP ' + response.status + '）');
      const blob = await response.blob();
      if (!blob.size) throw new Error('原图文件为空');
      if (blob.type && !blob.type.startsWith('image/') &&
          blob.type !== 'application/octet-stream') {
        throw new Error('返回的文件不是图片');
      }
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = downloadName(source, sourceCard, blob);
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
      if (dialog.open && source === currentSource) info.textContent = '已开始下载原图';
    } catch (error) {
      if (dialog.open && source === currentSource) {
        info.textContent = '下载失败：' + (error?.message || '无法读取原图');
      }
    } finally {
      if (dialog?.open && source === currentSource) {
        downloadButton.disabled = !image.naturalWidth;
        downloadLabel.textContent = '下载原图';
      }
    }
  }

  // Anchor controls on the backdrop OUTSIDE the image, preferably on its right.
  // Move the image slightly within existing margins if the side space is tight;
  // for edge-to-edge images use the free space just below the bottom-right corner.
  function placeTools() {
    if (!dialog?.open || !image?.naturalWidth || !imageTools) return;
    content.style.transform = '';
    image.style.removeProperty('max-height');
    imageTools.dataset.placement = 'right';
    const photo = figure.getBoundingClientRect();
    const tools = imageTools.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const gap = 12;
    const edge = 12;
    const spareRight = viewportWidth - photo.right;
    const neededRight = tools.width + gap + edge;
    if (spareRight >= neededRight) return;

    // Preserve image resolution and display size by using the unused left margin.
    const shiftLeft = Math.ceil(neededRight - spareRight);
    if (photo.left - shiftLeft >= edge) {
      content.style.transform = 'translateX(-' + shiftLeft + 'px)';
      return;
    }

    // If the image nearly spans the window, place the stack below its right edge.
    imageTools.dataset.placement = 'below';
    const spareBottom = viewportHeight - photo.bottom;
    const missing = Math.max(0, tools.height + gap + edge - spareBottom);
    if (!missing) return;
    const shiftUp = Math.min(Math.ceil(missing), Math.max(0, Math.floor(photo.top - edge)));
    if (shiftUp) content.style.transform = 'translateY(-' + shiftUp + 'px)';
    const stillMissing = Math.max(0, missing - shiftUp);
    // Only extremely constrained screens need a small last-resort reduction.
    if (stillMissing) {
      image.style.maxHeight = Math.max(132, Math.floor(photo.height - 2 * stillMissing - 8)) + 'px';
    }
  }

  function animateFrom(sourceRect) {
    if (reducedMotion?.matches || typeof figure.animate !== 'function') return;
    const end = figure.getBoundingClientRect();
    if (!end.width || !end.height) return;
    let start = {opacity: 0.65, transform: 'translateY(10px) scale(.965)'};
    if (sourceRect && sourceRect.width > 0 && sourceRect.height > 0) {
      const dx = (sourceRect.left + sourceRect.width / 2) - (end.left + end.width / 2);
      const dy = (sourceRect.top + sourceRect.height / 2) - (end.top + end.height / 2);
      const scale = Math.max(.12, Math.min(.97,
        sourceRect.width / end.width, sourceRect.height / end.height));
      start = {opacity: .7, transform: `translate3d(${dx}px,${dy}px,0) scale(${scale})`};
    }
    figure.animate([start, {opacity: 1, transform: 'translate3d(0,0,0) scale(1)'}],
      {duration: 340, easing: 'cubic-bezier(.22, 1, .36, 1)'});
  }

  function open(src, card) {
    if (typeof src !== 'string' || !src.trim()) return false;
    mount();
    if (dialog.open) return true;
    const previewRect = card?.querySelector?.('.canvas-node-image')?.getBoundingClientRect()
      || card?.getBoundingClientRect?.() || null;
    const rect = previewRect
      ? {left: previewRect.left, top: previewRect.top,
         width: previewRect.width, height: previewRect.height} : null;
    returnFocus = card?.isConnected ? card : document.activeElement;
    currentSource = src;
    currentCard = card || null;
    const revision = ++loadRevision;
    figure.classList.remove('ready');
    downloadButton.disabled = true;
    downloadLabel.textContent = '下载原图';
    info.textContent = '正在打开原图…';
    image.onload = async () => {
      try { await image.decode?.(); } catch { /* Let the browser render when ready. */ }
      if (!dialog.open || revision !== loadRevision) return;
      info.textContent = image.naturalWidth && image.naturalHeight
        ? `原图 · ${image.naturalWidth} × ${image.naturalHeight}`
        : '原图预览';
      figure.classList.add('ready');
      downloadButton.disabled = false;
      placeTools();
      animateFrom(rect);
    };
    image.onerror = () => {
      if (revision !== loadRevision || !dialog.open) return;
      downloadButton.disabled = true;
      figure.classList.remove('ready');
      info.textContent = '原图加载失败，请确认图片文件仍存在';
    };
    dialog.showModal();
    image.src = src;
    closeButton.focus({preventScroll: true});
    return true;
  }

  function close() {
    if (dialog?.open) dialog.close();
  }

  window.HamokiCanvasOriginalPreview = Object.freeze({open, close});
})();
