'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const js=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../assets/style.css'),'utf8');
test('Left mouse on blank canvas draws marquee; shift adds; touch/hand/space can still pan',()=>{
 assert.match(js,/if\(tool==='select'&&e\.pointerType!=='touch'\)/);
 assert.match(js,/additive:!!e\.shiftKey/);
 assert.match(js,/if\(!g\.additive\)multiNodeIds\.clear\(\)/);
 assert.match(js,/n\.kind!=='note'&&n\.x<hiX/);
 assert.match(js,/if\(spaceDown\|\|tool==='hand'\)/);
 assert.match(js,/if\(spaceDown\|\|tool==='hand'\)\{startPan\(e\);return\}const pos=worldXY\(e\)/);
 assert.match(js,/selectNode\(n\.id,true\);return/);
});
test('Bulk actions are displayed together and reference role defaults general',()=>{
 for(const label of ['批量下载','作为参考图','整齐排列','图片对比','提取提示词','批量移除'])assert.ok(js.includes(label),label);
 assert.match(js,/role:'general'/);
 assert.match(js,/const available=8-referenceInputs\.length-referenceNodeRoles\.length/);
 assert.match(js,/if\(add\.length>available\)return toast/);
 assert.match(js,/if\(!confirm\('确认从当前画布移除/);
 assert.match(js,/kind:'bulk-remove'/);
 assert.match(html,/id="selectionToolbar"/);
 assert.match(css,/selection-toolbar\.bulk-selection-toolbar/);
});
test('Context menu is canvas-only and restores browser default outside board',()=>{
 assert.match(js,/board\.addEventListener\('contextmenu',showBoardContextMenu\)/);
 assert.match(js,/const nodeElement=e\.target\.closest\('\.canvas-node'\)/);
 assert.match(js,/e\.preventDefault\(\);e\.stopPropagation\(\);closeCanvasMenu/);
 assert.doesNotMatch(js,/document\.addEventListener\('contextmenu'/);
 assert.match(html,/id="boardContextMenu"/);
});
test('Large send button keeps generation and chat submission callbacks unchanged',()=>{
 assert.match(html,/id="sendButtonLabel">开始生成/);
 assert.match(css,/\.send-btn\{display:flex;width:100%;height:50px/);
 assert.match(js,/\$\('sendButtonLabel'\)\.textContent=composerMode==='text'\?'发送消息':'开始生成'/);
 assert.match(js,/\$\('generateBtn'\)\.onclick=\(\)=>submitGeneration\(\)/);
});
