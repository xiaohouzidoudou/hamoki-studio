'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
const slice=(left,right)=>{const i=app.indexOf(left),j=app.indexOf(right,i+left.length);assert(i>=0&&j>i);return app.slice(i,j)};
test('UI startup rearranges existing controls without invoking discarded default route logic',()=>{
 const body=slice('function arrangeStudioLayout(){','function setComposerMode(mode){');
 assert.doesNotMatch(body,/\\broutes\\b|capability-quick-bar|abilityBindings/);
 for(const expected of ['studio-config-scroll','studio-model-card','studio-reference-card','studio-layer-card','studio-advanced-card','studio-prompt-dock','studio-primary-model'])
   assert.ok(body.includes(expected),'missing layout section: '+expected);
 for(const existing of ["$('composerModelWrap')","$('textRouteBox')","$('attachRef')","'contextStrip'","'refStrip'","'referenceTip'","models.querySelector('#advanced')","$('conversation')"])
   assert.ok(body.includes(existing),'original interactive control must be reused: '+existing);
 assert.ok(body.includes('panel.insertBefore(scroll,zone)'));
 assert.ok(body.includes("heading.querySelector('button').onclick=()=>openSettings()"));
});
test('core app initialization still binds management controls and refreshes storage',()=>{
 assert.match(app,/async function init\(\)\{bindEvents\(\)/);
 assert.match(app,/\$\(id\)\.onclick=\(\)=>openSettings\(\)/);
 assert.match(app,/function refreshStorage\(\)/);
 assert.match(app,/await Promise\.all\(\[loadProviders\(\),loadProjects\(\),refreshStorage\(\)\]\)/);
});
