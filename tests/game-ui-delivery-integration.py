#!/usr/bin/env python3
"""Offline integration test using real pinned upstream sprite and atlas algorithms."""
from __future__ import annotations
import json,subprocess,sys,tempfile,zipfile
from pathlib import Path
from PIL import Image,ImageDraw
def run(action,root):
    p=subprocess.run([sys.executable,str(Path(__file__).resolve().parents[1]/'lib/game-ui-delivery.py'),action,str(root)],
                     capture_output=True,text=True,timeout=45)
    if p.returncode:raise AssertionError(f'{action}: {p.stderr} {p.stdout}')
    return json.loads(p.stdout)
with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);img=Image.new('RGB',(480,270),(19,26,32))
    d=ImageDraw.Draw(img);d.rectangle((42,50,175,199),fill=(240,189,59))
    d.rectangle((280,63,410,206),fill=(88,190,124))
    img.save(root/'source.png')
    (root/'split-config.json').write_text(json.dumps({'mode':'background','tolerance':8,'connectGap':0}))
    r=run('split',root)
    assert r['itemCount']==2,r
    assert r['detectedMode']=='background'
    items=json.loads((root/'items.json').read_text())
    for x,name,category in zip(items,['button-primary','icon-gold'],['control','icon']):
        x.update(semanticName=name,category=category,state='default',
                 sliceType='9-slice' if category=='control' else '1:1',
                 margins=[12,12,12,12] if category=='control' else [0,0,0,0])
    (root/'delivery-config.json').write_text(json.dumps({'items':items}))
    out=run('deliver',root)
    assert out['itemCount']==2 and set(out['manifestTargets'])=={'unity','cocos','godot','generic'}
    assert (root/'assets/sprites/reviewed/button-primary.png').exists()
    for kind in out['manifestTargets']:
        obj=json.loads((root/'exports'/kind/'main.json').read_text())
        assert obj['engine']==kind
    unity=json.loads((root/'exports/unity/main.json').read_text())
    assert len(unity['sprites'])==2
    with zipfile.ZipFile(root/'packages/game-ui-delivery.zip') as archive:
        names=set(archive.namelist())
        assert 'assets/atlases/main.png' in names
        assert 'assets/sprites/reviewed/button-primary.png' in names
        assert 'exports/unity/main.json' in names and archive.testzip() is None
    print('UPSTREAM_INTEGRATION_PASS',out,flush=True)
