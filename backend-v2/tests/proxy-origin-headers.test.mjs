import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const proxy=fs.readFileSync(new URL('../src/index.ts',import.meta.url),'utf8');
const legacy=fs.readFileSync(new URL('../../server.js',import.meta.url),'utf8');
test('account proxy retains browser Host while targeting private loopback',()=>{
 assert.match(proxy,/hostname:'127\.0\.0\.1',port:active\.port/);
 assert.match(proxy,/headers:\{\.\.\.req\.raw\.headers,'x-studio-account':u\.id\}/);
 assert.doesNotMatch(proxy,/headers:\{\.\.\.req\.raw\.headers,host:/);
});
test('both gateway and legacy worker retain Origin checks',()=>{
 assert.match(proxy,/if\(o\.host!==req\.headers\.host\)/);
 assert.match(legacy,/if\(origin\.host!==req\.headers\.host/);
});
