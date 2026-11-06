'use strict';

// Optional exact output size for GPT Image 2-family endpoints.
// Validation happens before saving uploaded references or queueing paid work.
function normalizeCustomImageSize(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[0-9]{3,4}x[0-9]{3,4}$/.test(value)) {
    throw Error('自定义尺寸格式应为宽x高，例如 1920x1088');
  }
  const [width, height] = value.split('x').map(Number);
  if (width < 512 || height < 512 || width > 4096 || height > 4096) {
    throw Error('自定义宽高须在 512～4096 像素之间');
  }
  if (width % 16 || height % 16) throw Error('自定义宽高必须为 16 的倍数');
  if (width > height * 3 || height > width * 3) {
    throw Error('自定义宽高比需在 1:3～3:1 之间');
  }
  if (width * height > 3840 * 2160) {
    throw Error('自定义尺寸最多约 829 万像素（3840×2160）');
  }
  return width + 'x' + height;
}

module.exports = {normalizeCustomImageSize};
