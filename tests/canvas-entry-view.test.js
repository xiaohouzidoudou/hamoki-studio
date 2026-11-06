'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const script=fs.readFileSync(path.join(root,'script.js'),'utf8');
const studio=fs.readFileSync(path.join(root,'studio-v2.js'),'utf8');
test('every visit opens the canvas at 50% and centers the newest generated artwork',()=>{
  assert.match(script,/applyZoom\(0\.5\);/);
  assert.match(script,/setZoom: applyZoom/);
  assert.match(script,/centerOnWorld/);
  assert.match(studio,/const ENTRY_VIEW_ZOOM = 0\.5;/);
  assert.match(studio,/function latestCanvasArtwork\(\)/);
  assert.match(studio,/function applyEntryView\(\)/);
  assert.match(studio,/renderCanvas\(\);\s*\n\s*applyEntryView\(\);/);
  assert.match(studio,/centerOnWorld\?\.\(ENTRY_VIEW_ZOOM/);
});
test('zoom changes share one transform and readout path without a second opening jump',()=>{
  assert.match(script,/function syncZoomReadout\(zoom\)/);
  assert.match(script,/function applyZoom\(target\)/);
  assert.match(script,/state\.zoom = next;/);
  // The opening view runs once; a later refresh (generation, undo, manual sync) must
  // not drag the board back to the newest picture.
  assert.match(studio,/if \(entryViewApplied\) return;/);
  assert.match(studio,/entryViewApplied = true;/);
});
test('pressing generate opens the new blank slot at 100% and centers it',()=>{
  const frame=fs.readFileSync(path.join(root,'assets/generation-frame.js'),'utf8');
  assert.match(script,/centerOnWorld\(scale, worldX, worldY, behavior = 'auto'\)/);
  assert.match(frame,/function reveal\(job\)/);
  assert.match(frame,/host\.centerOnWorld\(1, centerX, centerY, motion\)/);
  assert.match(frame,/generation-frame-new/);
  // Both entry points use the same reveal: the right-hand generator and the floating
  // result composer.
  assert.match(script,/HamokiGenerationFrames\?\.reveal\(createdJobs\[0\]\)/);
  assert.match(studio,/HamokiGenerationFrames\?\.reveal\(accepted\.jobs\[0\]\)/);
});
