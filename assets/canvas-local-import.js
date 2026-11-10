/* Hamoki Studio: browser-local canvas drafts and cancellable, deduplicated uploads.
 * A Blob stays in IndexedDB until the server confirms the asset and the canvas
 * acknowledges its final geometry. This module has no model-generation calls. */
'use strict';
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.HamokiCanvasLocalImport=api;
})(typeof window==='object'?window:null,function(){
  const TYPES=new Set(['image/png','image/jpeg','image/webp']);
  const LIMIT=12*1024*1024;
  function validate(file){
    if(!file||!TYPES.has(file.type)||!file.size||file.size>LIMIT)
      throw Error('只支持单张不超过12MB的 PNG、JPG、WebP 图片');
  }
  function indexedStore(indexedDBRef){
    if(!indexedDBRef)return {
      async list(){return [];},
      async put(){throw Error('浏览器不支持 IndexedDB，刷新后本地草稿可能丢失');},
      async remove(){}
    };
    let opened;
    const db=()=>opened||(opened=new Promise((resolve,reject)=>{
      const req=indexedDBRef.open('hamoki-canvas-local-import-v1',1);
      req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('drafts'))req.result.createObjectStore('drafts',{keyPath:'id'});};
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||Error('无法打开图片草稿数据库'));
    }));
    async function transact(mode,fn){
      const database=await db();
      return new Promise((resolve,reject)=>{
        const tx=database.transaction('drafts',mode);
        const request=fn(tx.objectStore('drafts'));
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error||Error('图片草稿读写失败'));
        tx.onerror=()=>reject(tx.error||Error('图片草稿事务失败'));
      });
    }
    return {
      list:async projectId=>(await transact('readonly',store=>store.getAll())).filter(x=>x.projectId===projectId),
      put:item=>transact('readwrite',store=>store.put(item)),
      remove:id=>transact('readwrite',store=>store.delete(id))
    };
  }
  function xhrTransport({item,onProgress}){
    let xhr=null,reader=null,rejected=null,settled=false;
    const promise=new Promise((resolve,reject)=>{
      rejected=reject;
      reader=new FileReader();
      reader.onerror=()=>{settled=true;reject(Error('本地图片读取失败'));};
      reader.onabort=()=>{settled=true;reject(Error('已取消上传'));};
      reader.onload=()=>{
        if(settled)return;
        xhr=new XMLHttpRequest();
        xhr.open('POST','/api/projects/'+item.projectId+'/assets');
        xhr.setRequestHeader('Content-Type','application/json');
        xhr.withCredentials=true;
        xhr.upload.onprogress=ev=>{
          if(ev.lengthComputable)onProgress(Math.min(99,Math.floor(ev.loaded/ev.total*100)));
        };
        xhr.onerror=()=>{settled=true;reject(Error('上传网络连接失败'));};
        xhr.onabort=()=>{settled=true;reject(Error('已取消上传'));};
        xhr.onload=()=>{
          if(settled)return;
          settled=true;
          let response={};
          try{response=JSON.parse(xhr.responseText||'{}');}catch{}
          if(xhr.status<200||xhr.status>=300)return reject(Error(response.error||'上传失败 HTTP '+xhr.status));
          if(!response.node?.id)return reject(Error('服务端未返回素材节点'));
          resolve(response.node);
        };
        const n=item.node;
        xhr.send(JSON.stringify({
          image:reader.result,name:item.fileName,x:n.x,y:n.y,w:n.w,h:n.h,
          parentNodeId:item.parentNodeId||null,clientImportId:item.id
        }));
      };
      reader.readAsDataURL(item.blob);
    });
    return {promise,abort(){
      if(settled)return;
      settled=true;
      try{reader?.abort();}catch{}
      try{xhr?.abort();}catch{}
      rejected?.(Error('已取消上传'));
    }};
  }
  function cancelServerImport(item){
    return fetch('/api/projects/'+item.projectId+'/assets/import/'+item.id,{
      method:'DELETE',credentials:'same-origin'
    }).then(r=>{if(!r.ok)throw Error('服务端取消记录失败 HTTP '+r.status);});
  }
  function createQueue(options){
    const storage=options.storage;
    const upload=options.upload;
    const makeURL=options.makeURL;
    const revokeURL=options.revokeURL;
    const makeId=options.makeId;
    const notify=options.notify||(()=>{});
    const onCommit=options.onCommit||(()=>{});
    const onCancelRemote=options.onCancelRemote||(()=>Promise.resolve());
    const maxConcurrent=Math.max(1,options.maxConcurrent||2);
    const items=new Map(),pending=[],enqueued=new Set();
    let running=0,restored=new Set();
    function record(item){
      const {node}=item;
      return {id:item.id,projectId:item.projectId,blob:item.blob,fileName:item.fileName,
        parentNodeId:item.parentNodeId,mode:item.mode,phase:item.phase,
        node:{id:node.id,kind:'reference',x:node.x,y:node.y,w:node.w,h:node.h,
          title:node.title,parentNodeId:node.parentNodeId,createdAt:node.createdAt}};
    }
    function signal(type,item,extra){notify(type,item,extra);}
    function build(data){
      const url=makeURL(data.blob);
      const node={...data.node,id:data.id,kind:'reference',url,previewUrl:url,__local:true};
      const item={id:data.id,projectId:data.projectId,blob:data.blob,fileName:data.fileName,
        parentNodeId:data.parentNodeId,mode:data.mode||'background',
        phase:data.mode==='deferred'?'deferred':'queued',progress:0,url,node,
        removed:false,waiters:[],ready:Promise.resolve(),activeTask:null,persistFailed:false};
      items.set(item.id,item);
      return item;
    }
    function save(item){
      return storage.put(record(item)).catch(e=>{
        item.persistFailed=true;
        signal('storage-error',item,e);
      });
    }
    function add(file,meta){
      validate(file);
      if(!meta?.projectId)throw Error('需要项目 ID 才能保存本地图片');
      const id=makeId();
      const data={
        id,projectId:meta.projectId,blob:file,fileName:meta.name||file.name||'本地图片',
        parentNodeId:meta.parentNodeId||null,mode:meta.deferred?'deferred':'background',
        node:{id,kind:'reference',x:Math.round(meta.x||0),y:Math.round(meta.y||0),
          w:Math.round(meta.w||288),h:Math.round(meta.h||288),
          title:meta.name||file.name||'本地图片',parentNodeId:meta.parentNodeId||null,
          createdAt:new Date().toISOString()}
      };
      const item=build(data);
      signal('added',item);
      item.ready=save(item);
      if(item.mode==='background')schedule(item);
      return item.node;
    }
    async function restore(projectId){
      if(restored.has(projectId))return;
      const entries=await storage.list(projectId);
      for(const entry of entries){
        if(items.has(entry.id))continue;
        if(!entry.blob||!entry.node)continue;
        const item=build(entry);
        signal('added',item);
        if(item.mode==='background')schedule(item);
      }
      restored.add(projectId);
    }
    function schedule(item,urgent=false){
      if(item.removed||item.activeTask||enqueued.has(item.id))return;
      item.phase='queued';enqueued.add(item.id);
      if(urgent)pending.unshift(item.id);else pending.push(item.id);
      signal('state',item);
      pump();
    }
    function settle(item,error,node){
      for(const w of item.waiters.splice(0)){
        if(error)w.reject(error);else w.resolve(node);
      }
    }
    async function run(item){
      item.phase='uploading';item.progress=0;signal('state',item);
      try{
        await item.ready;
        if(item.removed)return;
        const task=upload({item,onProgress:progress=>{
          if(item.removed)return;
          item.progress=Math.max(item.progress,Math.min(100,Math.round(progress)));
          signal('progress',item);
        }});
        item.activeTask=task;
        const serverNode=await task.promise;
        if(item.removed)return;
        item.phase='committing';signal('state',item);
        // Do not clear the local copy until the in-place swap and geometry patch finish.
        await onCommit(item,serverNode);
        if(item.removed)return;
        await storage.remove(item.id);
        revokeURL(item.url);
        items.delete(item.id);
        item.phase='complete';signal('complete',item,serverNode);
        settle(item,null,serverNode);
      }catch(error){
        if(item.removed)return;
        item.phase='failed';item.progress=0;
        item.ready=save(item);signal('failed',item,error);
        settle(item,error);
      }finally{
        item.activeTask=null;
        running--;
        pump();
      }
    }
    function pump(){
      while(running<maxConcurrent&&pending.length){
        const id=pending.shift();enqueued.delete(id);
        const item=items.get(id);
        if(!item||item.removed||item.activeTask)continue;
        running++;
        void run(item);
      }
    }
    function ensure(id){
      const item=items.get(id);
      if(!item)return Promise.reject(Error('本地草稿已不存在'));
      const result=new Promise((resolve,reject)=>item.waiters.push({resolve,reject}));
      if(item.phase==='deferred'||item.phase==='failed')schedule(item,true);
      return result;
    }
    function retry(id){
      const item=items.get(id);
      if(item&&item.phase==='failed')schedule(item,true);
    }
    function update(id,changes){
      const item=items.get(id);
      if(!item||item.removed)return false;
      Object.assign(item.node,changes);
      if(changes.parentNodeId!==undefined)item.parentNodeId=changes.parentNodeId;
      item.ready=item.ready.then(()=>save(item));
      signal('geometry',item);
      return true;
    }
    async function cancel(id){
      const item=items.get(id);
      if(!item||item.removed)return false;
      item.removed=true;items.delete(id);
      item.activeTask?.abort?.();
      const err=Error('已取消上传');
      settle(item,err);
      signal('removed',item);
      try{await item.ready;await storage.remove(id);}finally{revokeURL(item.url);}
      // A cancellation tombstone prevents a late server response from leaving
      // an invisible asset. This is idempotent and never calls a model.
      if(item.mode==='background'||item.phase==='uploading'||item.phase==='committing')
        await onCancelRemote(item);
      return true;
    }
    function get(id){return items.get(id)||null;}
    function nodes(projectId){return [...items.values()].filter(i=>i.projectId===projectId&&!i.removed).map(i=>i.node);}
    return {add,restore,ensure,retry,update,cancel,get,nodes,items};
  }
  return {validate,indexedStore,xhrTransport,cancelServerImport,createQueue,LIMIT};
});