#!/usr/bin/env python3
"""Run pinned upstream Game UI Design Workflow tools inside an isolated pack directory.

Root and source file are assigned by the authenticated Node workspace. The
external caller cannot supply filesystem paths or shell commands.
"""
from __future__ import annotations
import json
import re
import sys
import zipfile
from pathlib import Path
import yaml
from PIL import Image
APP=Path(__file__).resolve().parents[1]
UP=APP/'vendor/game-ui-design-workflow'
sys.path.insert(0,str(UP/'scripts'))
from split_sprite_sheet import split_sprite_sheet, SplitSettings
from build_sprite_atlas import build_atlas
from export_engine_manifest import export_manifests
GOOD=re.compile(r'^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$')
def make_parent(path):
    path.parent.mkdir(parents=True,exist_ok=True)
    return path
def load(root,name):
    return json.loads((root/name).read_text(encoding='utf-8'))
def template(name):
    value=yaml.safe_load((UP/'templates/contracts'/name).read_text(encoding='utf-8'))
    assert isinstance(value,dict)
    return value
def save_yaml(root,name,value):
    dest=make_parent(root/name)
    dest.write_text(yaml.safe_dump(value,allow_unicode=True,sort_keys=False),encoding='utf-8')
def emit(obj):
    print(json.dumps(obj,ensure_ascii=False,separators=(',',':')),flush=True)
def split(root):
    conf=load(root,'split-config.json')
    source=root/'source.png'
    if not source.is_file():raise ValueError('Source image missing')
    with Image.open(source) as pic:
        w,h=pic.size
        if w*h>35000000 or min(w,h)<32:raise ValueError('Image dimensions outside supported bounds')
    settings=SplitSettings(mode=conf['mode'],background_tolerance=int(conf['tolerance']),
                           connect_gap=int(conf['connectGap']),min_area=64,padding=6,
                           alpha_threshold=8,prefix='element')
    result=split_sprite_sheet(source,root/'assets/sprites/detected',
                               root/'packages/detected-png.zip',settings)
    items=result['items']
    if not 1<=len(items)<=64:raise ValueError('Auto split returned unsupported sprite count (1-64)')
    total=sum((root/'assets/sprites/detected'/x['path']).stat().st_size for x in items)
    if total>105*1024*1024:raise ValueError('Cut components exceed size limit')
    # Preserve the original software's exact detected crop metadata.
    out=[{'id':i['id'],'filename':i['path'],'bbox':i['bbox'],
          'dimensions':i['dimensions'],'semanticName':i['id'],
          'category':'control','state':'default','sliceType':'full','margins':[0,0,0,0]} for i in items]
    (root/'items.json').write_text(json.dumps(out,ensure_ascii=False),encoding='utf-8')
    manifest=template('sprite-contract.yaml')
    manifest.update({'project_id':root.name,'pack_id':root.name,'status':'review',
      'source':{'sheet_path':'source.png'},'items':[
        {'id':i['id'],'path':'assets/sprites/detected/'+i['filename'],
         'bbox':i['bbox'],'dimensions':i['dimensions']} for i in out],
      'review':{'complete':False,'text_free':False,'notes':['Awaiting human review']}})
    save_yaml(root,'contracts/sprite-contract.yaml',manifest)
    emit({'itemCount':len(out),'items':out,'detectedMode':result['detected_mode']})
def deliver(root):
    conf=load(root,'delivery-config.json')
    original=load(root,'items.json')
    mapping=conf['items']
    if len(mapping)!=len(original):raise ValueError('Every crop must be reviewed')
    seen=set();entries=[]
    for i,(source,item) in enumerate(zip(original,mapping)):
        name=item.get('semanticName')
        if not isinstance(name,str) or not GOOD.fullmatch(name) or len(name)>64 or name in seen:
            raise ValueError('Duplicate/invalid semantic kebab-case name, item '+str(i+1))
        seen.add(name)
        category=item.get('category')
        state=item.get('state')
        if category not in ('control','container','icon','character','decoration','background','object'):
            raise ValueError('Bad category')
        if state not in ('default','pressed','selected','disabled','locked','claimed','loading'):
            raise ValueError('Bad state')
        typ=item.get('sliceType')
        if typ not in ('full','1:1','tile','9-slice'):raise ValueError('Invalid slice mode')
        margins=item.get('margins',[])
        if not isinstance(margins,list) or len(margins)!=4 or any(type(v)!=int or v<0 for v in margins):
            raise ValueError('Margins must be four nonnegative integers')
        width,height=source['dimensions']
        if typ=='9-slice' and (margins[0]+margins[1]>=width or margins[2]+margins[3]>=height):
            raise ValueError('9-slice borders cannot cover full sprite')
        detected=root/'assets/sprites/detected'/source['filename']
        if not detected.is_file():raise ValueError('Missing detected sprite')
        dest=make_parent(root/'assets/sprites/reviewed'/(name+'.png'))
        if dest.exists():raise ValueError('Reviewed destination already exists')
        dest.write_bytes(detected.read_bytes())
        meta={'id':source['id'],'semantic_name':name,'component_id':name,
              'category':category,'state':state,'path':'assets/sprites/reviewed/'+name+'.png',
              'dimensions':source['dimensions'],'source_bbox':source['bbox'],
              'slice':{'type':typ}}
        if typ=='9-slice':meta['slice']['margins']=margins
        entries.append(meta)
    sprite=template('sprite-contract.yaml')
    sprite.update({'project_id':root.name,'pack_id':root.name,'status':'approved',
                   'source':{'sheet_path':'source.png'},'items':entries,
                   'review':{'complete':True,'text_free':True,
                   'notes':['Confirmed by user before engine exports']}})
    save_yaml(root,'contracts/sprite-contract.yaml',sprite)
    atlas=template('atlas-contract.yaml')
    atlas.update({'project_id':root.name,'atlas_id':root.name,'source_sprite_pack':root.name,'status':'approved'})
    atlas['settings'].update({'max_size':[4096,4096],'padding':4,'power_of_two':True,'allow_rotation':False})
    atlas['output']={'image_path':'assets/atlases/main.png','data_path':'assets/atlases/main.json'}
    save_yaml(root,'contracts/atlas-contract.yaml',atlas)
    exports=template('export-contract.yaml')
    exports.update({'project_id':root.name,'source_atlas_id':root.name,'status':'approved'})
    exports['targets']=[{'engine':engine,'format':'json-manifest',
                          'manifest_path':'exports/'+engine+'/main.json','native_project_files':False}
                         for engine in ('unity','cocos','godot','generic')]
    save_yaml(root,'contracts/export-contract.yaml',exports)
    atlas_data=build_atlas(root,root/'contracts/sprite-contract.yaml',
                           root/'contracts/atlas-contract.yaml')
    if atlas_data['size'][0]*atlas_data['size'][1]>16777216:raise ValueError('Atlas too large')
    manifests=export_manifests(root,root/'contracts/atlas-contract.yaml',
                              root/'contracts/export-contract.yaml')
    reviewed_zip=root/'packages/sprites-reviewed.zip'
    make_parent(reviewed_zip)
    with zipfile.ZipFile(reviewed_zip,'w',zipfile.ZIP_DEFLATED) as z:
        for entry in entries:z.write(root/entry['path'],entry['path'])
        z.write(root/'contracts/sprite-contract.yaml','contracts/sprite-contract.yaml')
    final=root/'packages/game-ui-delivery.zip'
    with zipfile.ZipFile(final,'w',zipfile.ZIP_DEFLATED) as z:
        for entry in entries:z.write(root/entry['path'],entry['path'])
        for relative in ('assets/atlases/main.png','assets/atlases/main.json',
                         'contracts/sprite-contract.yaml','contracts/atlas-contract.yaml',
                         'contracts/export-contract.yaml'):
            z.write(root/relative,relative)
        for p in manifests:z.write(p,str(p.relative_to(root)))
        # Original editable planning templates are drafts, not approved specs.
        for name in ('gdd.md','prd.md','interaction.md'):
            src=UP/'templates/spec-kit'/name
            z.write(src,'planning-templates/'+name)

        z.writestr('README.txt','Hamoki Studio game UI asset delivery: original Game UI Design Workflow sprite slicing and atlas tools. JSON manifests are metadata, not native engine project files. Check alpha borders, naming and 9-slice in your game engine.\n')
    if final.stat().st_size>120*1024*1024:raise ValueError('Export package exceeds 120MB')
    emit({'itemCount':len(entries),'atlasSize':atlas_data['size'],
          'manifestTargets':['unity','cocos','godot','generic']})
if __name__=='__main__':
    if len(sys.argv)!=3 or sys.argv[1] not in ('split','deliver'):
        raise SystemExit('Use split/deliver and a trusted pack directory')
    base=Path(sys.argv[2]).resolve(strict=True)
    if not (base/'source.png').is_file():raise SystemExit('Missing source')
    try:
        (split if sys.argv[1]=='split' else deliver)(base)
    except Exception as e:
        print(str(e),file=sys.stderr)
        raise SystemExit(2)
