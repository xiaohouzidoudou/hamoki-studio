'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {normalizeCustomImageSize} = require('../lib/custom-image-size');

test('exact sizes are optional and preserve legacy presets', () => {
  assert.equal(normalizeCustomImageSize(null),null);
  assert.equal(normalizeCustomImageSize(undefined),null);
  assert.equal(normalizeCustomImageSize('1920x1088'),'1920x1088');
  assert.equal(normalizeCustomImageSize('1024x1024'),'1024x1024');
  assert.equal(normalizeCustomImageSize('3840x2160'),'3840x2160');
});
test('invalid sizes are rejected before paid work can enter the queue', () => {
  for (const size of ['1920x1080','0x1024','512x5120','4096x4096','3840x3840',
    '512x2048','600x600','1024 x 1024','auto',{},-1]) {
    assert.throws(()=>normalizeCustomImageSize(size),undefined,String(size));
  }
});
test('a size just at max ratio of 3:1 is accepted', () => {
  assert.equal(normalizeCustomImageSize('1536x512'),'1536x512');
});
