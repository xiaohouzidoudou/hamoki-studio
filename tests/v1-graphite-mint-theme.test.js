'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'assets','graphite-mint-theme.css'),'utf8');

test('graphite mint CSS is loaded last as reversible local V1 skin',()=>{
 const linked='assets/graphite-mint-theme.css?v=graphite-mint-2';
 assert.ok(html.includes(linked));
 assert.ok(html.lastIndexOf(linked)>html.lastIndexOf('assets/gameui-tool-stage2.css'));
 assert.match(css,/--gg-deep:#0D1015/);
 assert.match(css,/--gg-panel:#191E26/);
 assert.match(css,/--gg-green:#74D2A4/);
 assert.match(css,/--bg-dark:#0D1015/);
 assert.match(css,/body \.hg-plaza\{background:#11161D/);
 assert.ok(fs.existsSync(path.join(root,'data','local-dev-backups','index-before-graphite-green-20261104.html')));
});
test('large surfaces stay neutral and mint is reserved for selected/action UI',()=>{
 for(const token of ['.top-bar{','.sidebar,.sidebar.expanded','.canvas-viewport{','.params-panel{','.result-floating-toolbar{','.result-floating-editor{','.hmt-screen{','body .hg-plaza{','.hs-dialog{']){
   assert.ok(css.includes(token),'missing graphite region '+token);
 }
 assert.match(css,/\.nav-icon-btn\.active,[\s\S]*?border-left:3px solid var\(--gg-green\)/);
 assert.match(css,/\.result-floating-toolbar \.result-download\{[\s\S]*?background:#78CFA5/);
 assert.match(css,/\.params-panel \.generate-button\{[\s\S]*?background:#78CFA5/);
 assert.doesNotMatch(css,/body\s*\{[^}]*background:\s*#[0-9a-fA-F]{6}.*green/i);
});
