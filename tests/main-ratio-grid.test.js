'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'..','script.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','assets','ratio-quick-picks.css'),'utf8');
const choices=script.slice(script.indexOf('<div class="ratio-group" id="ratio-group"'),script.indexOf('</div>',script.indexOf('<div class="ratio-group" id="ratio-group"')));
const expected=['auto','1:1','9:16','16:9','3:4','4:3','2:3','3:2'];

test('all eight ratios are visible in the designed two-row order, with auto first',()=>{
  const actual=[...choices.matchAll(/data-value="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(actual,expected);
  assert.doesNotMatch(choices,/(?:\s|^)hidden(?:\s|>)|ratio-extra/);
  assert.match(choices,/class="ratio-button active" data-value="auto" aria-pressed="true"/);
  assert.doesNotMatch(script,/ratio-more-toggle|setMoreRatiosExpanded|extraRatios/);
});
test('each visible ratio has a size-specific illustration before its label',()=>{
  const buttons=[...choices.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)].map(match=>match[1]);
  assert.equal(buttons.length,8);
  buttons.forEach((html,i)=>{
    assert.match(html,/class="ratio-shape/);
    assert.ok(html.indexOf('ratio-shape') < html.lastIndexOf(expected[i]==='auto'?'自适应':expected[i]));
    assert.doesNotMatch(html,/style="/,'CSP-blocked inline icon sizing is not allowed');
  });
  const iconDims={'auto':[18,12],'1:1':[12,12],'9:16':[8,14],
    '16:9':[18,10],'3:4':[10,13],'4:3':[16,12],'2:3':[9,14],'3:2':[17,11]};
  for(const [value,[width,height]] of Object.entries(iconDims)){
    assert.ok(css.includes('[data-value="'+value+'"] .ratio-shape { width:'+width+'px;height:'+height+'px;'),
      'missing CSS dimensions for '+value);
  }
});
test('selector remains a four-column grid with active highlighting and resets to auto',()=>{
  assert.match(css,/\.params-panel \.ratio-group\s*\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/border-color:#6CAE8E/);
  assert.match(script,/document\.querySelector\('#ratio-group \[data-value="auto"\]'\)\?\.click\(\)/);
  assert.match(script,/if \(btn\.classList\.contains\('ratio-button'\)\) btn\.setAttribute\('aria-pressed','true'\)/);
});
