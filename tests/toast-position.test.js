'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const css=fs.readFileSync(path.join(__dirname,'../assets/style.css'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
test('toast is top-centered and never intercepts clicks',()=>{
 const match=css.match(/\.toast\{([^}]*)\}/);assert.ok(match,'toast style must exist');
 const rule=match[1];
 for(const value of ['position:fixed','left:50%','right:auto','bottom:auto','pointer-events:none','text-align:center','animation:toastTopIn']) assert.ok(rule.includes(value),value);
 assert.match(rule,/top:(?:max\(|\d+)/);
 assert.match(rule,/transform:translateX\(-50%\)/);
 assert.doesNotMatch(rule,/bottom:24px|right:22px/);
 assert.match(css,/@keyframes toastTopIn\{from\{opacity:0;transform:translate\(-50%,-10px\)\}to\{opacity:1;transform:translate\(-50%,0\)\}\}/);
});
test('toast preserves auto-dismiss duration and status semantics',()=>{
 assert.match(html,/id="toast" class="toast hidden" role="status" aria-live="polite"/);
 assert.match(js,/function toast\(text\)\{\$\('toast'\)\.textContent=safeText\(text\);show\('toast'\);clearTimeout\(toastTimer\);toastTimer=setTimeout\(\(\)=>hide\('toast'\),3400\)\}/);
});
