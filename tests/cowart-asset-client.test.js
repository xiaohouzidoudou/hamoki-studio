const test=require('node:test');
const assert=require('node:assert/strict');

test('上传快照独立记录、同图复用，保存后的 URL 不覆盖并发替换',async()=>{
 const nativeFetch=global.fetch,previousLocation=global.location;
 global.location={search:''};
 let uploads=0,rejectUpload=false;
 const url='/api/media/00000000-0000-4000-8000-000000000001.png';
 global.fetch=async(input,options)=>{
  if(input==='/api/projects')return Response.json({defaultId:'project',projects:[{id:'project'}]});
  if(String(input).startsWith('/api/cowart/assets')){
   uploads++;if(rejectUpload)return Response.json({error:'空间不足'},{status:413});
   return Response.json({url});
  }
  return nativeFetch(input,options);
 };
 try{
  const {uploadCanvasAssets,applySavedAssetSources}=await import('../cowart/src/lib/canvasAssets.js');
  const src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==';
  const asset=id=>({id,typeName:'asset',type:'image',props:{src,w:320,h:240,mimeType:'image/png'}});
  const snapshot={schema:{},store:{a:asset('a'),b:asset('b')}};
  const result=await uploadCanvasAssets(snapshot);
  assert.equal(uploads,1);assert.equal(snapshot.store.a.props.src,src);
  assert.equal(result.snapshot.store.a.props.src,url);
  const live=new Map([['a',asset('a')],['b',{...asset('b'),props:{src:'blob:newer'}}]]);
  const editor={store:{mergeRemoteChanges:fn=>fn()},getAsset:id=>live.get(id),updateAssets:items=>{for(const item of items)live.set(item.id,item)}};
  applySavedAssetSources(editor,result.replacements);
  assert.equal(live.get('a').props.src,url);assert.equal(live.get('b').props.src,'blob:newer');
  assert.equal(live.get('a').props.w,320);assert.equal(live.get('a').props.h,240);
  live.delete('a');applySavedAssetSources(editor,result.replacements);assert.equal(live.has('a'),false);
  rejectUpload=true;
  await assert.rejects(uploadCanvasAssets(snapshot),/空间不足/);
  assert.equal(snapshot.store.a.props.src,src);
 }finally{global.fetch=nativeFetch;global.location=previousLocation}
});
