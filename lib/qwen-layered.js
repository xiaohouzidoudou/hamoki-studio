/* Server-side Qwen Image Layered Gradio adapter. No local model/GPU required. */
'use strict';
const { Buffer } = require('node:buffer');

const DEFAULT_SPACE = 'Qwen/Qwen-Image-Layered';
const PNG_SIGNATURE = Buffer.from([137,80,78,71,13,10,26,10]);
const MAX_LAYER_BYTES = 14 * 1024 * 1024;
const MAX_TOTAL_BYTES = 90 * 1024 * 1024;

function spaceBase(space) {
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(space)) {
    return 'https://' + space.replace('/', '-').replace(/[^A-Za-z0-9-]/g, '-').toLowerCase() + '.hf.space';
  }
  const url = new URL(space);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw Error('拆层服务地址必须为 HTTPS Gradio 地址');
  }
  return url.origin;
}

function findGallery(response) {
  const data = response?.data;
  if (!Array.isArray(data) || !Array.isArray(data[0]) || data[0].length < 2 || data[0].length > 10) {
    throw Error('Qwen 未返回可用的多图层结果，请核查服务版本与模型状态');
  }
  return data[0];
}

function getFileReference(entry) {
  const image = Array.isArray(entry) ? entry[0] : entry?.image ?? entry;
  if (typeof image === 'string') return image;
  if (image && typeof image === 'object') return image.url || image.path || image.name || '';
  return '';
}

function allowedLayerUrl(ref, base) {
  if (typeof ref !== 'string' || !ref || ref.length > 8192) throw Error('图层下载地址无效');
  if (ref.startsWith('data:image/png;base64,')) return { kind: 'data', data: ref };
  let url;
  if (ref.startsWith('https://')) url = new URL(ref);
  else if (ref.startsWith('/')) url = new URL('/gradio_api/file=' + encodeURI(ref), base);
  else throw Error('拆层服务返回了不支持的图层地址');
  const origin = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password ||
      (url.origin !== origin.origin && !(origin.hostname.endsWith('.hf.space') && url.hostname.endsWith('.hf.space')))) {
    throw Error('拆层结果地址不属于已配置的可信服务');
  }
  return { kind: 'url', url: url.href };
}

function checkPng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || buffer.length > MAX_LAYER_BYTES ||
      !buffer.subarray(0,8).equals(PNG_SIGNATURE) || buffer.toString('ascii',12,16) !== 'IHDR') {
    throw Error('服务返回的图层不是有效 PNG 或文件过大');
  }
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20), color = buffer[25];
  if (width < 1 || height < 1 || width > 8192 || height > 8192 || ![4,6].includes(color)) {
    throw Error('Qwen 输出必须是带透明通道的 RGBA PNG 图层');
  }
  return { bytes: buffer, mime: 'image/png', width, height };
}

async function getLayer(ref, base, fetchFn=fetch) {
  const allowed = allowedLayerUrl(ref,base);
  if (allowed.kind === 'data') {
    const data = allowed.data.slice('data:image/png;base64,'.length);
    if (data.length > MAX_LAYER_BYTES * 4/3 + 16) throw Error('图层体积超出限制');
    return checkPng(Buffer.from(data,'base64'));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetchFn(allowed.url, { signal: controller.signal, redirect: 'error' });
    if (!res.ok) throw Error('下载图层失败，HTTP ' + res.status);
    if (Number(res.headers.get('content-length')||0) > MAX_LAYER_BYTES) throw Error('图层文件超过 14 MB');
    const reader = res.body?.getReader();
    if (!reader) throw Error('拆层响应为空');
    const parts = []; let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > MAX_LAYER_BYTES) {await reader.cancel(); throw Error('图层下载体积超出限制');}
      parts.push(Buffer.from(chunk.value));
    }
    return checkPng(Buffer.concat(parts,size));
  } finally {clearTimeout(timer);}
}

async function infer({ bytes, layers=4, steps=50, prompt='' }, {space=process.env.QWEN_LAYERED_SPACE || DEFAULT_SPACE, token=process.env.QWEN_LAYERED_HF_TOKEN || '', client, fetchFn=fetch}={}) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 20 || bytes.length > 12*1024*1024) throw Error('原图必须小于 12 MB');
  if (!Number.isInteger(layers) || layers < 2 || layers > 8) throw Error('拆层数量应在 2 到 8 之间');
  if (!Number.isInteger(steps) || steps < 10 || steps > 50) throw Error('推理步数应在 10 到 50 之间');
  const base = spaceBase(space);
  let app = client, image;
  if (!app) {
    const gradio = await import('@gradio/client');
    app = await gradio.Client.connect(space, token ? {token} : {});
    image = gradio.handle_file(bytes);
  } else image = bytes; // Only injectable local test clients bypass Gradio's upload wrapper.
  const result = await app.predict('/infer_1', {
    input_image: image, seed: 777, randomize_seed: false,
    prompt: String(prompt||'').slice(0,500), neg_prompt: ' ',
    true_guidance_scale: 4, num_inference_steps: steps,
    layer: layers, cfg_norm: true, use_en_prompt: true
  });
  const entries = findGallery(result);
  const extracted = [];
  let total = 0;
  for (const entry of entries) {
    const img = await getLayer(getFileReference(entry), base, fetchFn);
    total += img.bytes.length;
    if (total > MAX_TOTAL_BYTES) throw Error('多图层总量超过 90 MB，请减少层数');
    extracted.push(img);
  }
  if (extracted.some(item => item.width !== extracted[0].width || item.height !== extracted[0].height)) {
    throw Error('拆层结果尺寸不一致，暂不保存以免破坏画布');
  }
  return extracted;
}

module.exports = { infer, checkPng, findGallery, getFileReference, allowedLayerUrl, spaceBase, DEFAULT_SPACE };
