'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const composer=read('assets/result-floating-composer.js');
const host=read('studio-v2.js');
const editor=read('assets/result-image-editor.js');
const editorCss=read('assets/result-image-editor.css');
const toolbarCss=read('assets/result-popup-controls.css');
const index=read('index.html');

test('image toolbar keeps common actions on the bar and moves background removal out of More',()=>{
  assert.match(composer,/\['remove-bg','去背景','cutout'\]/);
  assert.match(composer,/summary\.append\(ico\('more'\)\)/);
  assert.doesNotMatch(composer,/mk\('span','', *'更多'\)/);
  assert.match(composer,/summary\.setAttribute\('aria-label','更多图片工具'\)/);
  assert.match(composer,/result-toolbar-more-trigger/);
});

test('primary toolbar exposes AI outpainting; More keeps crop tools but no fake HD upscale',()=>{
  for(const action of ['expand','resize','grid9','trim-edge','auto-crop']){
    assert.ok(composer.includes("'"+action+"'"),'missing action '+action);
  }
  assert.doesNotMatch(composer,/menuAction\('hd','高清','upscale'\)/);
  assert.match(composer,/\['expand','扩图','outpaint'\]/);
  assert.doesNotMatch(composer,/menuAction\('expand'/);
  assert.match(composer,/function prepareAiOutpaint\(\)/);
  assert.match(composer,/if\(action==='expand'\)\{prepareAiOutpaint\(\);return;\}/);
  assert.match(composer,/richPrompt\.replace\(next,\{notify:true\}\)/);
  assert.match(composer,/onGenerate:config=>ctx\.onGenerate\(config\)/);
  assert.match(composer,/menuAction\('resize','缩放','resize'\)/);
  assert.match(composer,/menuAction\('grid9','九宫格缩放','grid9'\)/);
  assert.match(composer,/mk\('div','result-submenu'\)/);
  assert.match(composer,/result-submenu-action/);
  assert.match(composer,/裁切方式/);
  assert.match(composer,/裁切图片|裁切/);
});

test('background removal turns on the transparent output flow and replaces the old prompt',()=>{
  assert.match(composer,/function prepareBackgroundRemoval\(\)/);
  assert.match(composer,/transparentToggle\.checked=true/);
  assert.match(composer,/output='transparent'/);
  assert.match(composer,/仅保留原图主体/);
  assert.match(composer,/richPrompt\.replace\(REMOVAL_PROMPT,\{notify:false\}\)/);
  assert.doesNotMatch(composer,/REMOVAL_PROMPT\s*\+|\+\s*REMOVAL_PROMPT/);
  assert.doesNotMatch(host,/当前模型还没有连接此项图像处理能力/);
});

test('result composer opens without a prefilled reference image or generation prompt',()=>{
  assert.doesNotMatch(composer,/references\.push\(\{id:'original'/);
  assert.match(composer,/includeSource:!!ctx\.nodeId/);
  assert.match(host,/function cardPrompt\(h\) \{[\s\S]*?return '';/);
  assert.match(host,/\(ui\.prompt\|\|''\)\.trim\(\)\|\|h\.editInstruction\|\|h\.prompt/);
});

test('studio keeps local cropping and slicing while disabling fake HD and local expansion',()=>{
  assert.match(host,/\['crop','trim-edge','auto-crop','resize','grid9'\]/);
  assert.match(host,/if\(action==='hd'\|\|action==='expand'\)/);
  assert.doesNotMatch(host,/saveCanvasBlob\(node,blob,'高清 '/);
  assert.match(host,/action==='resize'\?'scale':action/);
  assert.match(host,/async function runLocalImageAction/);
  assert.match(host,/function trimBounds/);
  assert.match(host,/function autoCropBounds/);
  assert.match(host,/Math\.round\(source\.width\*2\/3\)/);
  assert.match(host,/saveCanvasBlob\(node,blob,'九宫格 '/);
  assert.match(host,/placement:'related'/);
});

test('local image editor keeps the original untouched and saves a new PNG',()=>{
  assert.match(editor,/window\.HamokiResultImageEditor\s*=\s*\{\s*open\s*\}/);
  for(const mode of ['crop','scale','expand'])assert.ok(editor.includes("'"+mode+"'"),'missing mode '+mode);
  assert.match(editor,/output\.toBlob\(resolve, ?'image\/png'\)/);
  assert.match(editor,/结果超过 12MB/);
  assert.match(editor,/锁定原始宽高比/);
  assert.match(editor,/边缘延展/);
  assert.match(editorCss,/\.rie-backdrop\{/);
  assert.match(editorCss,/@media\(max-width:760px\)/);
});

test('page loads the editor assets and keeps the toolbar readable on narrow canvases',()=>{
  assert.match(index,/assets\/result-image-editor\.js\?v=image-editor-2/);
  assert.match(index,/assets\/result-image-editor\.css\?v=image-tools-1/);
  assert.match(toolbarCss,/@media\(max-width:1080px\)/);
  assert.match(toolbarCss,/\.result-toolbar-primary \.result-toolbar-action\{font-size:0!important/);
  assert.match(toolbarCss,/max-height:calc\(100dvh - 92px\)/);
});
