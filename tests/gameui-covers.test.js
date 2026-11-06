// Guards the local game-art catalog against missing or wrong cover references.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const assets=path.join(root,'assets');
const data=JSON.parse(fs.readFileSync(path.join(assets,'game-ui-tools.json'),'utf8'));

test('all 221 tools have their own original illustrative covers',()=>{
  assert.equal(data.items.length,221);
  const seen=new Set();
  for(const tool of data.items){
    assert.match(tool.id,/^[A-Za-z0-9-]+$/);
    assert.equal(tool.preview,'assets/ui-tool-art-'+tool.id+'.webp');
    assert.ok(!seen.has(tool.preview),'duplicate cover reference: '+tool.preview);
    seen.add(tool.preview);
    const file=path.join(root,tool.preview);
    const buf=fs.readFileSync(file);
    assert.ok(buf.length>1000,'empty or broken cover: '+tool.id);
    assert.equal(buf.toString('ascii',0,4),'RIFF');
    assert.equal(buf.toString('ascii',8,12),'WEBP');
    assert.ok(fs.existsSync(path.join(assets,'ui-tool-'+tool.id+'.webp')),'layout reference was lost: '+tool.id);
  }
});
test('covers are rendered directly and editor can re-open the same tool',()=>{
  const plaza=fs.readFileSync(path.join(assets,'gameui-tool-plaza.js'),'utf8');
  const stage2=fs.readFileSync(path.join(assets,'gameui-tool-stage2.js'),'utf8');
  assert.match(plaza,/img\.src=t\.preview/);
  assert.match(stage2,/querySelector\('#hgStage2Upload'\)/);
  assert.match(stage2,/querySelector\('img\.hg-stage2-card-preview'\)/);
});
