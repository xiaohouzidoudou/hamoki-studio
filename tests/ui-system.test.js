'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'assets/ui-system.css'),'utf8');
const ui=fs.readFileSync(path.join(root,'assets/ui-system.js'),'utf8');
const app=fs.readFileSync(path.join(root,'assets/app.js'),'utf8');

test('new UI assets load after existing application styles and scripts',()=>{
 assert.match(html,/<link rel="stylesheet" href="assets\/style\.css">\s*<link rel="stylesheet" href="assets\/ui-system\.css">/);
 assert.match(html,/<script src="assets\/app\.js" defer><\/script>\s*<script src="assets\/ui-system\.js" defer><\/script>/);
});

test('desktop composer remains scrollable and fixed prompt remains available',()=>{
 assert.match(css,/\.lovart-inspired-panel \.studio-config-scroll\{[^}]*overflow-y:auto!important/);
 assert.match(css,/\.lovart-inspired-panel \.studio-prompt-dock\{[^}]*flex:0 0 auto/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});

test('modal keyboard trap preserves dismiss and canvas shortcuts',()=>{
 assert.match(ui,/MutationObserver/);
 assert.match(ui,/e\.key==='Tab'/);
 assert.match(ui,/e\.key==='Escape'/);
 assert.match(app,/document.querySelector\('\.modal-back:not\(\.hidden\)'\)\)return/);
 assert.doesNotMatch(ui,/e\.stopPropagation\(\)/);
 assert.match(ui,/focusables\(remaining\)/);
});
