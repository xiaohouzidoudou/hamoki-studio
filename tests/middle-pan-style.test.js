'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),js=fs.readFileSync(path.join(root,'assets/app.js'),'utf8'),css=fs.readFileSync(path.join(root,'assets/style.css'),'utf8');
const chunk=(a,b)=>js.slice(js.indexOf(a),js.indexOf(b,js.indexOf(a)+a.length));
test('middle button pans in capture phase even over images; left remains marquee',()=>{
 const down=chunk('function pointerDown(e){','function pointerMove(e){');
 assert.ok(down.includes("if(e.button===1){e.preventDefault();e.stopPropagation();activePointers.set(e.pointerId,boardXY(e));startPan(e);return}"));
 assert.ok(down.includes("if(tool==='select'&&e.pointerType!=='touch')"));
 const setup=chunk('function setupBoard(){','async function fileData(f)');
 assert.ok(setup.includes("board.addEventListener('pointerdown',e=>{if(e.button===1){pointerDown(e)}},true)"));
 assert.ok(setup.includes("board.addEventListener('auxclick',e=>{if(e.button===1){e.preventDefault();e.stopPropagation()}})"));
});
test('reference appearance is scoped to assistant and interactive controls are preserved',()=>{
 for(const name of ['lovart-inspired-panel','studio-config-scroll','studio-model-card','studio-primary-model','studio-reference-card','studio-layer-card','studio-advanced-card','studio-prompt-dock','studio-send-button'])
  assert.ok(css.includes(name),name);
 assert.ok(css.includes('linear-gradient(112deg,#6ef1d3'));
 assert.ok(js.includes('renderStudioLayerChips()'));
 assert.ok(js.includes('studioReferenceRole'));
});

test('advanced settings use native details visibility and text mode hides image-specific controls',()=>{
 const source=js.slice(js.indexOf('function arrangeStudioLayout(){'),js.indexOf('function addLiveTextMessage('));
 assert.ok(source.includes("const advanced=models.querySelector('#advanced')"));
 assert.ok(source.includes("advanced.classList.remove('hidden');details.append(advanced)"));
 assert.ok(source.includes("panel.querySelector(selector)?.classList.toggle('hidden',composerMode==='text')"));
 assert.ok(source.includes("panel.classList.toggle('studio-text-mode',composerMode==='text')"));
 assert.ok(css.includes('.board.middle-panning'));
});
