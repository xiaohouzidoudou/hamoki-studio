'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const create=(tag,cls,value)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(value!==undefined)el.textContent=String(value);return el};
 const options=(el,values,chosen)=>{el.replaceChildren();for(const [value,label] of values)el.add(new Option(label,value));el.value=chosen||values[0]?.[0]||''};
 const categories=[['control','按钮/控件'],['container','面板/容器'],['icon','图标'],['object','道具'],['character','角色'],['decoration','装饰'],['background','背景']];
 const states=[['default','默认'],['pressed','按下'],['selected','选中'],['disabled','禁用'],['locked','锁定'],['claimed','已领取'],['loading','加载中']];
 const slices=[['full','完整图片'],['1:1','1:1 图标'],['tile','重复平铺'],['9-slice','9-slice 九宫格']];
 let id=null,data=null,currentPackId=null,poll=null,busy=false;
 function status(s){$('deliveryStatus').textContent=s||''}
 function ensureProject(){if(!id||typeof currentProject==='undefined'||currentProject?.id!==id)throw Error('当前画布项目已切换，请重新打开组件交付窗口')}
 function getPack(){return data?.packs.find(x=>x.id===currentPackId)||null}
 function sourceUI(){
  const root=$('deliverySources');root.replaceChildren();
  if(!data.sources.length){root.append(create('p','delivery-hint','当前项目没有生成作品。先在一图衍生素材中生成 UI Kit 或图标素材板。'));return}
  data.sources.forEach((src,index)=>{
   const label=create('label','delivery-source'),input=create('input'),img=create('img');
   input.type='radio';input.name='deliveryImage';input.value=src.id;input.checked=index===0;
   img.loading='lazy';img.src=src.url;img.alt='生成素材预览';
   label.append(input,img,create('span',null,src.prompt||'已生成作品'));root.append(label);
  });
 }
 function listUI(){
  const root=$('deliveryPacks');root.replaceChildren();
  const statusName={review:'待人工审核',delivered:'已交付',splitting:'正在拆图',delivering:'正在打包',failed:'失败'};
  if(!data.packs.length){root.append(create('p','delivery-hint','还没有组件包。先选择一张 UI Kit 素材板并自动拆图。'));return}
  for(const pack of data.packs){
   const btn=create('button','delivery-pack'+(pack.id===currentPackId?' selected':''));
   btn.type='button';
   btn.append(create('span',null,'组件包 · '+pack.createdAt?.slice(5,16).replace('T',' ')),
    create('small',null,(statusName[pack.status]||pack.status)+' · '+(pack.items?.length||0)+' 个'));
   btn.onclick=()=>{currentPackId=pack.id;listUI();reviewUI()};
   root.append(btn);
  }
 }
 function cropRow(item,index,pack){
  const node=create('article','delivery-component'),head=create('div','delivery-component-top'),img=create('img');
  img.src=pack.pngPreview[index];img.loading='lazy';img.alt='切图 #'+(index+1);
  const desc=create('span',null,'#'+String(index+1).padStart(2,'0')+' · '+item.dimensions.join(' × ')+' px');
  head.append(img,desc);node.append(head);
  const nameLabel=create('label',null,'语义名称（英文短横线）'),name=create('input','field delivery-name');
  name.type='text';name.maxLength=64;name.value=item.semanticName||item.id;name.dataset.field='name';
  nameLabel.append(name);node.append(nameLabel);
  const grid=create('div','delivery-component-grid');
  for(const [key,label,choices,value] of [
   ['category','组件类别',categories,item.category||'control'],
   ['state','组件状态',states,item.state||'default'],
   ['sliceType','切图方式',slices,item.sliceType||'full']]){
    const field=create('label',null,label),sel=create('select','field');
    sel.dataset.field=key;options(sel,choices,value);field.append(sel);grid.append(field);
   }
  node.append(grid);
  const marginsLabel=create('label',null,'9-slice 边距（左,右,上,下）'),margins=create('input','field');
  margins.dataset.field='margins';margins.type='text';margins.value=(item.margins||[0,0,0,0]).join(',');
  margins.placeholder='0,0,0,0';marginsLabel.append(margins);node.append(marginsLabel);
  node.dataset.itemId=item.id;
  return node;
 }
 function reviewUI(){
  const pack=getPack(),root=$('deliveryReview'),downloads=$('deliveryDownloads');root.replaceChildren();downloads.replaceChildren();
  $('deliveryTextFree').checked=false;$('deliverySlicesReviewed').checked=false;
  if(!pack){
   $('deliverySummary').textContent='未选择';root.append(create('p','delivery-hint','等待选择组件包'));
   $('deliveryExport').disabled=true;return;
  }
  const names={review:'等待审核',delivered:'已完成交付',splitting:'拆图进行中',delivering:'资源打包中',failed:'处理失败'};
  $('deliverySummary').textContent=names[pack.status]||pack.status;
  $('deliveryExport').disabled=busy||pack.status!=='review';
  if(pack.error)status('处理失败：'+pack.error);
  if(!pack.items?.length){
   root.append(create('p','delivery-hint',pack.status==='splitting'?'正在由原版脚本识别 PNG，过程中请勿重复提交':pack.error||'暂无可检查的切片'));
  }else{
   pack.items.forEach((x,i)=>root.append(cropRow(x,i,pack)));
   if(pack.status==='delivered'){
    $('deliveryExport').disabled=true;
    const links=[['完整资源 ZIP',pack.zipURL],['透明 PNG 包',pack.reviewedZipURL],
     ['Atlas PNG',pack.atlasURL],...['unity','cocos','godot','generic'].map(x=>[x.toUpperCase()+' JSON',
     '/api/projects/'+id+'/delivery/'+pack.id+'/file/'+x])];
    for(const [label,url] of links){
     const a=create('a',null,label);a.href=url;a.download='';downloads.append(a);
    }
   }
  }
 }
 async function refresh(redraw=true){
  ensureProject();
  const next=await api('projects/'+id+'/delivery');
  if(typeof currentProject==='undefined'||currentProject?.id!==id)return;
  const old=data?.packs.find(p=>p.id===currentPackId)?.status;
  data=next;
  if(!currentPackId||!data.packs.some(p=>p.id===currentPackId))currentPackId=data.packs[0]?.id||null;
  if(redraw||old!==getPack()?.status){listUI();reviewUI()}
 }
 function pollStart(){
  if(poll)clearInterval(poll);
  poll=setInterval(async()=>{
   if($('deliveryModal').classList.contains('hidden')||!id){clearInterval(poll);poll=null;return}
   try{
    const previous=getPack()?.status;await refresh(false);
    const latest=getPack()?.status;
    if(!['splitting','delivering'].includes(latest)){
     clearInterval(poll);poll=null;
     status(latest==='review'?'切图完成，请检查每个组件，确认后再交付。':
      latest==='delivered'?'资源打包完成，已提供所有 ZIP、图集与引擎 JSON 下载。':
      '处理失败，请检查错误并调整源素材板。');
    }else if(latest!==previous)reviewUI();
   }catch(e){status('读取进度失败：'+e.message)}
  },2200);
 }
 async function open(){
  if(typeof currentProject==='undefined'||!currentProject)return;
  id=currentProject.id;data=null;currentPackId=null;busy=false;
  $('deliveryModal').classList.remove('hidden');status('加载中…');
  try{
   await refresh();
   sourceUI();status('只处理已批准的素材板；原始分割不收费。');
   if(['splitting','delivering'].includes(getPack()?.status))pollStart();
  }catch(e){status('读取组件交付失败：'+e.message)}
 }
 function close(){
  $('deliveryModal').classList.add('hidden');
  if(poll){clearInterval(poll);poll=null}
 }
 async function split(){
  if(busy)return;
  try{ensureProject()}catch(e){return status(e.message)}
  const imageId=$('deliverySources').querySelector('input[name=deliveryImage]:checked')?.value;
  if(!imageId)return status('请选择一个已生成的 UI Kit 或素材板');
  if(!$('deliveryPageApproved').checked)return status('请先确认源素材板适合切图（无文字、元素彼此分离）');
  busy=true;$('deliverySplit').disabled=true;
  try{
   const result=await api('projects/'+id+'/delivery/split',{method:'POST',body:{
    historyId:imageId,approvedPage:true,mode:$('deliveryMode').value,
    tolerance:Number($('deliveryTolerance').value),connectGap:Number($('deliveryGap').value)
   }});
   await refresh();currentPackId=result.pack.id;listUI();reviewUI();
   status('正在自动切图；你可以关闭本窗口，稍后继续审核。');pollStart();
  }catch(e){status('无法开始拆图：'+e.message)}finally{busy=false;$('deliverySplit').disabled=false}
 }
 function collect(){
  const rows=[...$('deliveryReview').querySelectorAll('.delivery-component')];
  const pack=getPack();if(rows.length!==pack.items.length)throw Error('切片尚未加载完整');
  return rows.map((row,i)=>{
   const value=key=>row.querySelector('[data-field="'+key+'"]').value.trim();
   const margins=value('margins').split(',').map(t=>Number(t.trim()));
   if(margins.length!==4||margins.some(x=>!Number.isInteger(x)||x<0))throw Error('第 '+(i+1)+' 个组件的边距必须是四个整数');
   return {id:pack.items[i].id,semanticName:value('name'),category:value('category'),
    state:value('state'),sliceType:value('sliceType'),margins};
  });
 }
 async function deliver(){
  if(busy)return;
  try{ensureProject()}catch(e){return status(e.message)}
  const pack=getPack();if(pack?.status!=='review')return status('请先完成自动切图');
  if(!$('deliveryTextFree').checked||!$('deliverySlicesReviewed').checked)
   return status('请先完成人工验收：文字、透明边缘、命名和 9-slice');
  let items;try{items=collect()}catch(e){return status(e.message)}
  if(!confirm('确认这 '+items.length+' 个切片完整、无残余文字且已确认 9-slice 边距吗？将使用原项目代码生成 ZIP、Atlas 和 Unity/Cocos/Godot JSON，不调用付费模型。'))return;
  busy=true;$('deliveryExport').disabled=true;
  try{
   await api('projects/'+id+'/delivery/approve',{method:'POST',body:{
    packId:pack.id,items,confirmTextFree:true,confirmSlices:true
   }});
   await refresh();status('正在打包 PNG/Atlas/JSON…');pollStart();
  }catch(e){status('无法打包资源：'+e.message);$('deliveryExport').disabled=false}
  finally{busy=false}
 }
 $('openDelivery').addEventListener('click',open);
 $('deliveryClose').addEventListener('click',close);
 $('deliverySplit').addEventListener('click',split);
 $('deliveryExport').addEventListener('click',deliver);
 $('deliveryModal').addEventListener('click',e=>{if(e.target===$('deliveryModal'))close()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('deliveryModal').classList.contains('hidden'))close()});
})();
