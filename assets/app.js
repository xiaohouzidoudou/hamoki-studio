/* Hamoki Studio V0.6.3 — invite-only accounts, isolated per-user workspaces. */
'use strict';
const APP_BASE=new URL(document.currentScript.src,location.href).pathname.replace(/\/assets\/app\.js$/, '');
const $=id=>document.getElementById(id);
const ico=(name,extra='')=>`<svg class="icon ${extra}" aria-hidden="true"><use href="#ic-${name}"></use></svg>`;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n};
const show=id=>$(id)?.classList.remove('hidden');
const hide=id=>$(id)?.classList.add('hidden');
let providers=[],activeId=null,editId=null,draftProvider=false,projectList=[],currentProject=null,historyItems=[],jobs=[],paused=false;
let composerMode='image';
const runtimeRoutes={text:{providerId:'',model:''},vision:{providerId:'',model:''}},runtimeCatalog=new Map();
let selectedNodeId=null,viewerId=null,sourceId=null,sourceNodeId=null,maskData=null,maskSourceId=null;
let enhanceMode=false;
let referenceInputs=[],reverseImage=null,reverseResult='',reverseBusy=false,selectedTab='history',tool='select';
let cam={x:220,y:130,scale:1},gesture=null,spaceDown=false,activePointers=new Map(),saveViewportTimer=null,lastProjectRevision=-1,projectSaveBusy=0;
let repaintMask=null,visualMask=null,maskMarked=0,maskErase=false,maskDrawing=false,maskCanvasRaw=null,maskSourcePng=null;
let demoMode=false,authorized=false,polling=false,toastTimer=null,forceProjectRefresh=false;
let compareSelection=new Set(),currentImgSuggestions=[];
let referenceNodeRoles=[], editingPrompt=null;
let multiNodeIds=new Set(),undoStack=[],redoStack=[],marqueeRect=null;
let imageEditingSource=null,imageEditCanvas=null,imageEditOriginal=null,imageEditCrop=null,imageEditDrag=null;
let visibleNodeSignature='',visibleUpdateTimer=null,lastIdlePoll=0,previewSaving=false;
const previewBuildQueue=[],previewAttempted=new Set();
const modelCatalogByProvider=new Map();
const quickModelPrefs=new Map(),quickModelFetches=new Map();
let quickModelOpened=false,quickModelQuery="",quickModelBusy=false,quickModelError="";
const ROLE_OPTIONS=[['shape','造型'],['color','配色'],['style','画风'],['pose','姿态'],['background','背景'],['general','综合']];
const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
const savedUi={get(k){try{return localStorage.getItem(k)}catch{return null}},set(k,v){try{localStorage.setItem(k,v)}catch{}}};
let currentUser=null,authMode='login';
let textChatBusy=false,textChatController=null,textChatProjectId=null,diagnosticItems=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function safeText(s){return String(s??'')}
function toast(text){$('toast').textContent=safeText(text);show('toast');clearTimeout(toastTimer);toastTimer=setTimeout(()=>hide('toast'),3400)}
function humanDate(s){try{return new Date(s).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}catch{return '刚刚'}}
function reportClientIssue(info){
 if(!authorized)return;
 // Small sanitized diagnostics envelope; never send the request body, prompt, image or API Key.
 const payload={action:String(info.action||'browser_error').slice(0,64),method:info.method,path:info.path,status:info.status,message:String(info.message||'网页错误').slice(0,400)};
 fetch(APP_BASE+'/api/logs',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).catch(()=>{});
}
function formatLogLine(x){return `[${x.at||'-'}] ${x.level==='warning'?'WARN':'ERROR'} · ${x.action||x.source||'unknown'} · ${x.method||'-'} ${x.path||''} ${x.status||''}${x.model?' · '+x.model:''}
${x.message||'无错误详情'}`}
async function refreshErrorLogs(){
 if(!authorized){show('loginModal');return}
 $('logsSubtitle').textContent='正在读取本账号的错误记录…';
 try{
  const payload=await api('logs');diagnosticItems=Array.isArray(payload.logs)?payload.logs:[];
  const area=$('errorLogsList');area.replaceChildren();
  $('logsSubtitle').textContent=`最近 ${diagnosticItems.length} 条 · 仅当前账号可查看`;
  $('logCount').textContent=String(diagnosticItems.length);
  if(!diagnosticItems.length){area.append(el('div','errorlogs-empty','暂无错误日志。出现生成失败或中转站报错后，这里会自动记录。'));return}
  for(const x of diagnosticItems){
   const card=el('article','errorlog-row '+(x.level==='warning'?'warning':'error'));
   const head=el('div','errorlog-head');head.append(el('strong','',x.level==='warning'?'警告':'错误'),el('span','',humanDate(x.at)),el('span','',x.action||x.source||'系统'));
   if(x.status)head.append(el('span','',`HTTP ${x.status}`));
   if(x.model)head.append(el('span','',`模型：${x.model}`));
   card.append(head,el('p','',x.message||'未知错误'));
   if(x.path)card.append(el('div','micro muted',[x.method||'',x.path].filter(Boolean).join(' ')));
   area.append(card)
  }
 }catch(e){$('logsSubtitle').textContent='读取失败';$('errorLogsList').replaceChildren(el('div','errorlogs-empty','无法读取日志：'+e.message))}
}
function openErrorLogs(){show('logsModal');refreshErrorLogs()}
function openHelp(){
 closeQuickModelMenu();closeQuickProviderMenu();
 const scroll=$('helpModal')?.querySelector('.help-scroll');if(scroll)scroll.scrollTop=0;
 $('helpStartBtn').childNodes[0].textContent=authorized?'前往中转站管理 ':'登录或注册后开始 ';
 show('helpModal');
}
function startFromHelp(){hide('helpModal');if(authorized)openSettings();else show('loginModal')}

async function copyErrorLogs(){
 if(!diagnosticItems.length)return toast('暂时没有日志可复制');
 const body=['Hamoki Studio 错误日志（不含 API Key、密码、图片或提示词）','账号：'+(currentUser?.name||'当前用户'),'',...diagnosticItems.map(formatLogLine)].join('\n\n');
 try{await navigator.clipboard.writeText(body);toast('日志已复制，可以直接交给 Codex')}catch{toast('复制失败，请检查浏览器剪贴板权限')}
}
async function clearErrorLogs(){
 if(!confirm('清空本账号的所有错误日志？不会删除项目和图片。'))return;
 try{await api('logs',{method:'DELETE'});diagnosticItems=[];await refreshErrorLogs();toast('错误日志已清空')}catch(e){toast('清空失败：'+e.message)}
}

async function api(path,opts={}){
 const options={method:opts.method||'GET',credentials:'same-origin',headers:opts.body!==undefined?{'Content-Type':'application/json'}:{}};
 if(opts.body!==undefined)options.body=JSON.stringify(opts.body);
 const route=path.startsWith('/')?path:'/api/'+path;
 let res;
 try{res=await fetch(APP_BASE+route,options)}catch(err){
   if(!/\/(?:logs|login|register|logout)$/.test(route))reportClientIssue({source:'browser',action:'network_error',method:options.method,path:route,message:'网络连接失败：'+String(err?.message||err)});
   throw err;
 }
 const type=res.headers.get('content-type')||'';const body=type.includes('application/json')?await res.json():await res.text();
 if(!res.ok){
   if(!/\/(?:logs|login|register|logout)$/.test(route) && res.status!==404){
     reportClientIssue({source:'browser',action:'api_error',method:options.method,path:route,status:res.status,message:body?.error||'HTTP '+res.status});
   }
   if(res.status===401&&authorized){authorized=false;currentUser=null;show('loginModal');$('loginStatus').textContent='登录状态已失效，请重新登录'}
   throw Error(body?.error||'请求失败 HTTP '+res.status)
 }
 return body;
}
function activeProvider(){return providers.find(p=>p.id===activeId)}
function quickModelStorageKey(){return currentUser?.id?'hs-studio-model-choice-'+currentUser.id:null}
function loadQuickModelPreferences(){
 quickModelPrefs.clear();const key=quickModelStorageKey();if(!key)return;
 try{const saved=JSON.parse(savedUi.get(key)||'{}');if(saved&&typeof saved==='object')for(const [id,model] of Object.entries(saved))if(/^[a-f0-9-]{8,}$/.test(id)&&typeof model==='string'&&model.length<=160)quickModelPrefs.set(id,model)}catch{}
}
function rememberQuickModel(model,providerId=activeId){
 if(!providerId||!model||model.length>160)return;
 quickModelPrefs.set(providerId,model);
 const key=quickModelStorageKey();if(key)savedUi.set(key,JSON.stringify(Object.fromEntries(quickModelPrefs)));
}
function forgetQuickModel(providerId){
 quickModelPrefs.delete(providerId);
 const key=quickModelStorageKey();if(key)savedUi.set(key,JSON.stringify(Object.fromEntries(quickModelPrefs)));
}

function currentNode(){return currentProject?.nodes?.find(n=>n.id===selectedNodeId)||null}
function currentHistory(id){return historyItems.find(h=>h.id===id)||null}
function nodeImage(n){if(n.kind==='reference')return n.url;const h=currentHistory(n.historyId);return h?.url||''}
function previewImage(n){if(n.kind==='reference')return n.previewUrl||'';const h=currentHistory(n.historyId);return h?.previewUrl||''}
function mediaIdFromURL(src){try{const u=new URL(src,location.href);if(u.origin!==location.origin)return null;return u.pathname.match(/\/api\/media\/([a-f0-9-]{36}\.(?:png|jpg|webp))$/)?.[1]||null}catch{return null}}
function toDataUrl(blob){return new Promise((resolve,reject)=>{const rd=new FileReader();rd.onload=()=>resolve(rd.result);rd.onerror=reject;rd.readAsDataURL(blob)})}
async function imagePreviewBlob(input){const isImageElement=input instanceof HTMLImageElement;let source=input;const bitmap=!isImageElement&&typeof createImageBitmap==='function'?await createImageBitmap(input):null;try{if(bitmap)source=bitmap;else if(!isImageElement){const url=URL.createObjectURL(input);try{source=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('图片解码失败'));img.src=url})}finally{URL.revokeObjectURL(url)}}const width=source.naturalWidth||source.width,height=source.naturalHeight||source.height;if(!width||!height)return null;const scale=Math.min(1,480/Math.max(width,height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));canvas.getContext('2d',{alpha:true}).drawImage(source,0,0,canvas.width,canvas.height);let blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.72));if(!blob||blob.type!=='image/webp')blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.72));return blob?.size&&blob.size<=500*1024?blob:null}finally{bitmap?.close()}}
function queueGeneratedPreview(img,original){const id=mediaIdFromURL(original);if(!id||previewAttempted.has(id))return;previewAttempted.add(id);previewBuildQueue.push({id,img});drainPreviewQueue()}
async function drainPreviewQueue(){if(previewSaving||!authorized||document.visibilityState==='hidden')return;previewSaving=true;try{while(previewBuildQueue.length&&authorized&&document.visibilityState!=='hidden'){const task=previewBuildQueue.shift();try{if(!task.img.naturalWidth)continue;const blob=await imagePreviewBlob(task.img);if(!blob)continue;await api(`media/${task.id}/preview`,{method:'POST',body:{preview:await toDataUrl(blob)}})}catch(e){console.debug('缩略图将下次再生成:',e.message)}await sleep(180)}}finally{previewSaving=false}}
function putPreview(img,original,small=null){img.decoding='async';img.loading='lazy';if(!original)return;const preview=small||(()=>{const id=mediaIdFromURL(original);return id?APP_BASE+'/api/previews/'+id:null})();if(!preview){img.src=original;return}img.onerror=()=>{img.onerror=null;img.onload=()=>{img.onload=null;queueGeneratedPreview(img,original)};img.src=original};img.src=preview}
function worldViewBounds(){const r=$('board').getBoundingClientRect(),padding=420/Math.max(.18,cam.scale);return{x0:-cam.x/cam.scale-padding,y0:-cam.y/cam.scale-padding,x1:(r.width-cam.x)/cam.scale+padding,y1:(r.height-cam.y)/cam.scale+padding}}
function nodeVisible(n,bounds){return n.x+n.w>=bounds.x0&&n.x<=bounds.x1&&n.y+n.h>=bounds.y0&&n.y<=bounds.y1}
function scheduleVisibleRefresh(){if(visibleUpdateTimer)return;visibleUpdateTimer=setTimeout(()=>{visibleUpdateTimer=null;if(!currentProject||!authorized)return;const b=worldViewBounds(),sig=currentProject.nodes.filter(n=>nodeVisible(n,b)).map(n=>n.id).join('|');if(sig!==visibleNodeSignature)renderNodes()},90)}

function projectPath(extra=''){return `/api/projects/${currentProject?.id||'unknown'}${extra}`}
function currentBoardPoint(fx=.5,fy=.48){const r=$('board').getBoundingClientRect();return{x:(r.width*fx-cam.x)/cam.scale,y:(r.height*fy-cam.y)/cam.scale}}
function setSaving(text='正在保存'){const t=$('saveStatus');t.innerHTML='';const dot=el('span','online-dot');t.append(dot,document.createTextNode(' '+text))}
function changeTool(t){tool=t;closeBoardContextMenu();$('board')?.setAttribute('data-tool',tool);document.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('active',x.dataset.tool===t));$('canvasHint').textContent=t==='note'?'在画布空白处点击添加便签':t==='hand'?'左键或中键拖动平移画布':'左键框选 · 中键或空格拖动画布 · 右键菜单'}
function setAuthMode(mode){authMode=mode;$('showLogin')?.classList.toggle('active',mode==='login');$('showRegister')?.classList.toggle('active',mode==='register');$('loginPane')?.classList.toggle('hidden',mode!=='login');$('registerPane')?.classList.toggle('hidden',mode!=='register')}
function fillAccountHeader(){if(!$('accountTitle'))return;$('accountTitle').textContent=currentUser?.name||'我的创作空间'}
async function init(){bindEvents();setAuthMode('login');try{const r=await api('status');if(!r.backend)throw Error('找不到服务端');demoMode=!!r.demoMode;if(!r.authenticated){show('loginModal');$('loginStatus').textContent='请输入账号密码后继续';fillAccountHeader();return}authorized=true;currentUser=r.user||null;loadQuickModelPreferences();fillAccountHeader();hide('loginModal');await boot()}catch(e){$('loginStatus').textContent=e.message;show('loginModal')}setInterval(()=>{if(!authorized||document.visibilityState==='hidden')return;const busy=jobs.some(j=>['queued','running'].includes(j.status));if(busy||Date.now()-lastIdlePoll>12000){lastIdlePoll=Date.now();refreshProjectData()}},3000);setInterval(()=>{if(authorized&&document.visibilityState!=='hidden')refreshStorage()},60000);setInterval(()=>{if(authorized&&document.visibilityState!=='hidden')updateGenerationElapsed()},1000);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&authorized){lastIdlePoll=0;drainPreviewQueue();refreshProjectData()}})}
async function login(){const username=$('loginUser').value.trim(),password=$('loginPass').value;try{$('loginStatus').textContent='正在登录…';const r=await api('/api/login',{method:'POST',body:{username,password}});authorized=true;currentUser=r.user||{name:username};loadQuickModelPreferences();fillAccountHeader();hide('loginModal');$('loginPass').value='';await boot()}catch(e){authorized=false;$('loginStatus').textContent=e.message}}
async function register(){const inviteCode=$('inviteCode').value.trim(),username=$('registerUser').value.trim(),password=$('registerPass').value;try{$('loginStatus').textContent='正在创建账号…';const r=await api('/api/register',{method:'POST',body:{inviteCode,username,password}});authorized=true;currentUser=r.user||{name:username};loadQuickModelPreferences();fillAccountHeader();hide('loginModal');$('registerPass').value='';await boot()}catch(e){authorized=false;$('loginStatus').textContent=e.message}}
async function logoutAccount(){textChatController?.abort();try{await api('/api/logout',{method:'POST',body:{}})}catch{}closeCanvasMenu();closeQuickProviderMenu();closeQuickModelMenu();quickModelPrefs.clear();quickModelFetches.clear();modelCatalogByProvider.clear();populateComposerModelSuggestions(null);authorized=false;currentUser=null;providers=[];projectList=[];currentProject=null;historyItems=[];jobs=[];diagnosticItems=[];hide('logsModal');hide('settingsModal');hide('libraryModal');for(const cap of ['text','vision'])runtimeRoutes[cap]={providerId:'',model:''};runtimeCatalog.clear();fillAccountHeader();$('connectionStatus').textContent='已退出';$('logCount').textContent='···';show('loginModal');setAuthMode('login');$('loginStatus').textContent='你已退出账号'}
function niceBytes(n){return n>=1024**3?(n/1024**3).toFixed(2)+' GB':n>=1024**2?(n/1024**2).toFixed(1)+' MB':n>=1024?(n/1024).toFixed(0)+' KB':'0 KB'}
async function refreshStorage(){if(!authorized)return;try{const s=await api('storage');$('storageUsage').textContent=niceBytes(s.totalBytes)+' / '+niceBytes(s.quotaBytes);$('storageFill').style.width=clamp(s.totalBytes/Math.max(1,s.quotaBytes)*100,0,100)+'%';$('storageFill').style.background=s.totalBytes/s.quotaBytes>.9?'#ef897e':''}catch{if($('storageUsage'))$('storageUsage').textContent='稍后重试'}}
async function boot(){await Promise.all([loadProviders(),loadProjects(),refreshStorage()]);if(!providers.length)openSettings(true);$('connectionStatus').textContent=(currentUser?.name?currentUser.name+' · ':'')+(demoMode?'演示模式':'已登录');if(demoMode)toast('安全演示站：只用占位图、不消耗额度；请前往独立站进行真实生图');$('assistantDescription').textContent=demoMode?'演示工作台 · 不会调用模型':'账号独立工作区 · 真实 AI 生图';}
async function loadProviders(){const result=await api('providers');providers=result.providers||[];activeId=result.activeId||providers[0]?.id||null;renderProviderSelect();renderProviderCards();renderRuntimeSelectors();}
function renderProviderSelect(){closeQuickModelMenu();populateComposerModelSuggestions(activeId);const s=$('providerSelect');s.replaceChildren();if(!providers.length)s.add(new Option('＋ 添加中转站',''));
 for(const p of providers)s.add(new Option(p.name+(demoMode?' · 演示':p.hasKey?'':' · 未配置 Key'),p.id));if(activeId)s.value=activeId;
 const p=activeProvider();$('imageModel').value=(p&&(quickModelPrefs.get(p.id)||p.imageModel))||'';$('connectionStatus').textContent=(currentUser?.name?currentUser.name+' · ':'')+providers.length+' 个中转站';renderQuickProviderOptions();}
async function activate(id){if(!id)return openSettings(true);closeQuickProviderMenu();closeQuickModelMenu();try{await api(`providers/${id}/activate`,{method:'POST',body:{}});activeId=id;const p=providers.find(x=>x.id===id);renderProviderSelect();renderProviderCards();renderRuntimeSelectors();toast('已切换图片服务商：'+activeProvider().name)}catch(e){toast(e.message)}}
async function loadProjects(){const r=await api('projects');projectList=r.projects||[];renderProjects();const last=savedUi.get('hs-v04-project');const pick=projectList.some(p=>p.id===last)?last:r.defaultId||projectList[0]?.id;if(pick)await switchProject(pick)}
function renderProjects(){const root=$('projectList');root.replaceChildren();for(const [i,p] of projectList.entries()){
 const item=el('button','project-entry'+(currentProject?.id===p.id?' active':''));item.type='button';const iconbox=el('span','proj-icon');iconbox.innerHTML=ico(i%3===0?'layers':i%3===1?'spark':'image');const details=el('span','proj-data');const name=el('strong','',p.title);const sub=el('small','',p.imageCount+' 张画布元素');details.append(name,sub);item.append(iconbox,details);item.onclick=()=>switchProject(p.id);item.oncontextmenu=e=>{e.preventDefault();projectContext(p)};item.title='单击进入项目';const row=el('div','project-row');const remove=el('button','project-delete');remove.type='button';remove.title='删除画布（可恢复归档）';remove.setAttribute('aria-label','删除画布 '+p.title);remove.innerHTML=ico('trash');remove.onclick=e=>{e.stopPropagation();archiveProject(p.id)};row.append(item,remove);root.append(row)}
}
async function createProject(){const title=prompt('新项目叫什么名字？','新的创作项目');if(title===null)return;try{const r=await api('projects',{method:'POST',body:{title:title.trim()||'新的创作项目'}});await loadProjects();await switchProject(r.project.id);toast('新项目已建立')}catch(e){toast(e.message)}}
async function renameProject(){if(!currentProject)return;const name=prompt('项目名称',currentProject.title);if(name===null||!name.trim())return;try{const r=await api(projectPath(),{method:'PATCH',body:{title:name.trim()}});currentProject=r.project;$('currentProjectTitle').textContent=currentProject.title;await refreshProjectList();toast('项目已重命名')}catch(e){toast(e.message)}}
function projectContext(p){const choice=prompt(`项目：${p.title}\n输入新名称修改，输入 DELETE 归档项目`,p.title);if(choice===null)return;if(choice==='DELETE'){archiveProject(p.id);return}if(!choice.trim())return;api(`/api/projects/${p.id}`,{method:'PATCH',body:{title:choice.trim()}}).then(refreshProjectList).catch(e=>toast(e.message))}
async function archiveProject(id){if(!confirm('删除画布「'+(projectList.find(p=>p.id===id)?.title||'当前项目')+'」？\n它将从列表移除，原始图片和历史仍保留，可在备份中恢复。'))return;try{await api(`/api/projects/${id}`,{method:'DELETE'});await loadProjects();toast('画布已从项目列表移除，原图与历史已保留')}catch(e){toast(e.message)}}
async function refreshProjectList(){const r=await api('projects');projectList=r.projects||[];renderProjects()}
async function switchProject(id){if(!id||!authorized)return;if(textChatBusy&&textChatProjectId!==id)textChatController?.abort();try{
 const r=await api(`/api/projects/${id}`);currentProject=r.project;lastProjectRevision=currentProject.revision??0;savedUi.set('hs-v04-project',id);
 selectedNodeId=sourceId=sourceNodeId=maskData=maskSourcePng=null;enhanceMode=false;referenceInputs=[];referenceNodeRoles=[];editingPrompt=null;multiNodeIds.clear();closeBoardContextMenu();undoStack=[];redoStack=[];cam={...{x:220,y:130,scale:1},...(currentProject.viewport||{})};
 $('currentProjectTitle').textContent=currentProject.title;renderProjects();$('projectsPanel').classList.remove('open');
 const [h,j]=await Promise.all([api(`history?projectId=${id}`),api(`jobs?projectId=${id}`)]);historyItems=h.history||[];jobs=j.jobs||[];paused=!!j.paused;renderAll();
}catch(e){toast('打开项目失败：'+e.message)}}
function renderAll(){updateScene();renderNodes();renderConversation();renderContext();renderLibrary();updateStats();}
function updateStats(){const n=jobs.filter(j=>['queued','running'].includes(j.status)).length;$('queueBadge').textContent=n;$('libraryCount').textContent=historyItems.length;$('pauseBtn').textContent=paused?'▶ 恢复队列':'Ⅱ 暂停队列'}
async function refreshProjectData(){if(polling||!currentProject||!authorized)return;polling=true;const id=currentProject.id;try{
 const [h,j,r]=await Promise.all([api(`history?projectId=${id}`),api(`jobs?projectId=${id}`),api(`/api/projects/${id}`)]);
 if(currentProject?.id!==id)return;const oldHash=historyItems.map(x=>x.id+':'+x.favorite).join('|');const newHash=(h.history||[]).map(x=>x.id+':'+x.favorite).join('|');
 historyItems=h.history||[];jobs=j.jobs||[];paused=!!j.paused;updateStats();syncGenerationActivity();
 const p=r.project;
 if(!gesture&&projectSaveBusy===0&&(p.revision??0)!==lastProjectRevision){
   currentProject=p;lastProjectRevision=p.revision??0;renderNodes();if(!(textChatBusy&&textChatProjectId===id))renderConversation();renderProjects();setSaving('已同步');
 }else if(newHash!==oldHash&&!gesture){renderNodes();if(!(textChatBusy&&textChatProjectId===id))renderConversation()}
 if(!$('libraryModal').classList.contains('hidden'))renderLibrary();
 }catch(e){if(!/401/.test(e.message))setSaving('连接异常')}finally{polling=false}}
function updateScene(){const sc=$('scene');sc.style.transform=`translate(${cam.x}px,${cam.y}px) scale(${cam.scale})`;const b=$('board');b.style.setProperty('--zoom',cam.scale);b.style.setProperty('--gridx',`${cam.x}px`);b.style.setProperty('--gridy',`${cam.y}px`);$('zoomLevel').textContent=Math.round(cam.scale*100)+'%';placeToolbar();scheduleVisibleRefresh()}
function changeCamera(next,save=true){cam={x:next.x,y:next.y,scale:clamp(next.scale,.18,2.8)};updateScene();if(save)scheduleViewportSave()}
function scheduleViewportSave(){clearTimeout(saveViewportTimer);const id=currentProject?.id;if(!id)return;saveViewportTimer=setTimeout(async()=>{if(!currentProject||currentProject.id!==id)return;const coords={...cam};projectSaveBusy++;setSaving('正在同步');try{const r=await api(`/api/projects/${id}/viewport`,{method:'POST',body:coords});currentProject.viewport=r.viewport;setSaving('已同步')}catch(e){setSaving('保存失败');toast(e.message)}finally{projectSaveBusy--}},700)}
function zoomAt(factor,x,y){const scale=clamp(cam.scale*factor,.18,2.8),wx=(x-cam.x)/cam.scale,wy=(y-cam.y)/cam.scale;changeCamera({x:x-wx*scale,y:y-wy*scale,scale})}
function fitCanvas(){const nodes=currentProject?.nodes||[];const rect=$('board').getBoundingClientRect();if(!nodes.length)return changeCamera({x:rect.width*.42,y:rect.height*.27,scale:1});const minx=Math.min(...nodes.map(n=>n.x)),miny=Math.min(...nodes.map(n=>n.y)),maxx=Math.max(...nodes.map(n=>n.x+n.w)),maxy=Math.max(...nodes.map(n=>n.y+n.h));const sx=(rect.width-150)/(maxx-minx),sy=(rect.height-150)/(maxy-miny),scale=clamp(Math.min(sx,sy,1.4),.18,1.4);changeCamera({x:(rect.width-(maxx+minx)*scale)/2,y:(rect.height-(maxy+miny)*scale)/2,scale})}
function boardXY(e){const rect=$('board').getBoundingClientRect();return{x:e.clientX-rect.left,y:e.clientY-rect.top}}
function worldXY(e){const {x,y}=boardXY(e);return{x:(x-cam.x)/cam.scale,y:(y-cam.y)/cam.scale}}
let canvasPreviewCandidate=null;
function openCanvasOriginal(n){
 const original=nodeImage(n);
 if(!original)return toast('找不到这张图的原始文件');
 const modal=$('canvasOriginalModal'),image=$('canvasOriginalImage');
 image.src=original;image.alt=n.kind==='reference'?'参考图片原图':'AI 生成作品原图';
 image.classList.remove('actual-size');
 $('canvasOriginalFit').textContent='查看原始尺寸';
 show('canvasOriginalModal');
 $('canvasOriginalClose').focus();
}
function closeCanvasOriginal(){
 hide('canvasOriginalModal');
 $('canvasOriginalImage').removeAttribute('src');
}
function renderNodes(){const layer=$('nodeLayer');layer.replaceChildren();const all=currentProject?.nodes||[];const bounds=worldViewBounds(),nodes=all.filter(n=>nodeVisible(n,bounds));const depth=new Map(all.map((n,i)=>[n.id,i+1]));visibleNodeSignature=nodes.map(n=>n.id).join('|');$('emptyStage').classList.toggle('hidden',all.length>0);
 for(const n of nodes){const card=el('article','canvas-node'+(multiNodeIds.has(n.id)?' selected':'')+(referenceNodeRoles.some(r=>r.nodeId===n.id)?' multi-reference':'')+(n.kind==='note'?' note-node':''));card.dataset.id=n.id;card.style.left=n.x+'px';card.style.top=n.y+'px';card.style.width=n.w+'px';card.style.height=n.h+'px';card.style.zIndex=String(depth.get(n.id));
  if(n.kind==='note'){
    card.append(el('h4','','✦  灵感便签'));const txt=el('div','note-content',n.text||'双击编辑便签');card.append(txt);
    card.ondblclick=e=>{e.stopPropagation();editNote(n,card)};
  }else{
    const box=el('div','node-image-box'),src=nodeImage(n),im=el('img');putPreview(im,src,previewImage(n));im.draggable=false;im.alt=n.kind==='reference'?'参考图片':'AI 生成作品';box.append(im);
    im.addEventListener('click',e=>{
      if(e.detail!==1||e.shiftKey||e.ctrlKey||e.metaKey||spaceDown||tool==='hand')return;
      if(!canvasPreviewCandidate||canvasPreviewCandidate.id!==n.id)return;
      if(canvasPreviewCandidate.dragged||Date.now()-canvasPreviewCandidate.at>900)return;
      canvasPreviewCandidate=null;openCanvasOriginal(n);
    });
    box.append(el('span','node-badge'+(n.kind==='reference'?' reference':''),n.kind==='reference'?'参考素材':'AI GENERATED'));
    const foot=el('div','node-foot');const label=el('div','node-text');const h=currentHistory(n.historyId);label.append(el('b','',n.kind==='reference'?(n.title||'参考图片'):(h?.prompt||'生成的作品')),el('small','',n.kind==='reference'?'REFERENCE · 上传图片':(h?.model||'AI MODEL')+' · '+humanDate(n.createdAt)));foot.append(label);card.append(box,foot);card.ondblclick=e=>{e.stopPropagation();if(h)openViewer(h.id);else addNodeAsRef(n)};
  }
  card.addEventListener('pointerdown',e=>{if(e.target.closest('textarea,.inline-note,.resize-grip'))return;startNodeDrag(e,n)});
  const grip=el('span','resize-grip');grip.title='拖动调整大小';grip.addEventListener('pointerdown',e=>startResize(e,n));card.append(grip);layer.append(card);
 }
 renderLinks();placeToolbar();renderStudioLayerChips();}
function renderLinks(){const svg=$('linkLayer');svg.replaceChildren();if(!currentProject)return;const nodes=currentProject.nodes;const nById=new Map(nodes.map(n=>[n.id,n]));
 const bounds=worldViewBounds();for(const n of nodes){if(!n.parentNodeId)continue;const p=nById.get(n.parentNodeId);if(!p||(!nodeVisible(n,bounds)&&!nodeVisible(p,bounds)))continue;const x1=p.x+p.w,y1=p.y+p.h*.46,x2=n.x,y2=n.y+n.h*.46,dx=Math.max(65,Math.abs(x2-x1)*.5);const line=document.createElementNS('http://www.w3.org/2000/svg','path');line.setAttribute('class','version-link');line.setAttribute('d',`M ${x1} ${y1} C ${x1+dx} ${y1}, ${x2-dx} ${y2}, ${x2} ${y2}`);svg.appendChild(line)}
 svg.style.display=$('versionToggle').classList.contains('disabled-links')?'none':'block';}
function selectNode(id,additive=false){
 if(additive){if(multiNodeIds.has(id))multiNodeIds.delete(id);else if(id)multiNodeIds.add(id)}
 else{multiNodeIds.clear();if(id)multiNodeIds.add(id)}
 selectedNodeId=multiNodeIds.has(id)?id:[...multiNodeIds].at(-1)||null;
 document.querySelectorAll('.canvas-node').forEach(n=>{n.classList.toggle('selected',multiNodeIds.has(n.dataset.id));n.classList.toggle('multi-reference',referenceNodeRoles.some(r=>r.nodeId===n.dataset.id))});
 placeToolbar();updateUndoButtons();
}
function pickAllNodes(){if(!currentProject)return;multiNodeIds=new Set(currentProject.nodes.filter(n=>n.kind!=='note').map(n=>n.id));selectedNodeId=[...multiNodeIds].at(-1)||null;renderNodes();toast('已选中 '+multiNodeIds.size+' 张图片')}
function selectedSceneNodes(){return(currentProject?.nodes||[]).filter(n=>multiNodeIds.has(n.id))}
function snapshotScene(ids){const wanted=new Set(ids);return(currentProject?.nodes||[]).filter(n=>wanted.has(n.id)).map(n=>({id:n.id,x:n.x,y:n.y,w:n.w,h:n.h,groupId:n.groupId??null,...(n.kind==='note'?{text:n.text||''}:{})}))}
function historyRecord(before,after,beforeOrder=null,afterOrder=null){if(JSON.stringify(before)===JSON.stringify(after)&&JSON.stringify(beforeOrder)===JSON.stringify(afterOrder))return;undoStack.push({before,after,beforeOrder,afterOrder});if(undoStack.length>60)undoStack.shift();redoStack=[];updateUndoButtons()}
function updateUndoButtons(){$('undoAction').disabled=!undoStack.length;$('redoAction').disabled=!redoStack.length}
async function persistScene(updates,options={}){if(!currentProject||!updates.length)return;projectSaveBusy++;setSaving('正在同步');try{const result=await api(projectPath('/nodes/batch'),{method:'PATCH',body:{updates,...options}});lastProjectRevision=result.revision;setSaving('已同步');return result}finally{projectSaveBusy--}}
async function applySceneChange(updates,options={}){const before=snapshotScene(updates.map(n=>n.id)),beforeOrder=currentProject.nodes.map(n=>n.id);try{
 await persistScene(updates,options);
 for(const update of updates){const n=currentProject.nodes.find(n=>n.id===update.id);if(n)Object.assign(n,update)}
 if(options.front||options.back){const ids=new Set(updates.map(x=>x.id)),selected=currentProject.nodes.filter(n=>ids.has(n.id)),other=currentProject.nodes.filter(n=>!ids.has(n.id));currentProject.nodes=options.front?[...other,...selected]:[...selected,...other]}
 const after=snapshotScene(updates.map(n=>n.id)),afterOrder=currentProject.nodes.map(n=>n.id);
 historyRecord(before,after,beforeOrder,afterOrder);renderNodes();setSaving('已同步');
 }catch(e){toast('画布保存失败：'+e.message);forceProjectRefresh=true;await refreshProjectData()}}
async function stepHistory(kind){if(!currentProject)return;const from=kind==='undo'?undoStack:redoStack,to=kind==='undo'?redoStack:undoStack;if(!from.length)return;const item=from.pop();
 if(item.kind==='bulk-remove'){
  try{
   if(kind==='undo'){
    const r=await api(projectPath('/nodes/restore'),{method:'POST',body:{batchId:item.batchId}});
    currentProject.nodes.push(...r.restored);lastProjectRevision=r.revision;to.push(item);multiNodeIds=new Set(item.ids);selectedNodeId=item.ids.at(-1)||null;
   }else{
    const r=await api(projectPath('/nodes/batch'),{method:'DELETE',body:{ids:item.ids}});
    currentProject.nodes=currentProject.nodes.filter(n=>!item.ids.includes(n.id));lastProjectRevision=r.revision;item.batchId=r.batchId;to.push(item);multiNodeIds.clear();selectedNodeId=null;
   }
   renderNodes();toast(kind==='undo'?'已恢复刚才移除的图片':'已重新移除图片');
  }catch(e){from.push(item);toast('恢复操作失败：'+e.message)}
  updateUndoButtons();return;
 }
 const updates=kind==='undo'?item.before:item.after,order=kind==='undo'?item.beforeOrder:item.afterOrder;
 try{await persistScene(updates,order?{orderIds:order}:{});for(const entry of updates){const n=currentProject.nodes.find(n=>n.id===entry.id);if(n)Object.assign(n,entry)}if(order){const byId=new Map(currentProject.nodes.map(n=>[n.id,n]));currentProject.nodes=order.map(id=>byId.get(id)).filter(Boolean).concat(currentProject.nodes.filter(n=>!order.includes(n.id)))}to.push(item);renderNodes();toast(kind==='undo'?'已撤销画布操作':'已重做画布操作')}
 catch(e){from.push(item);toast('撤销或重做失败：'+e.message)}updateUndoButtons();}
async function arrangeSelection(mode){const nodes=selectedSceneNodes();if(nodes.length<(mode==='grid'?1:2))return toast('请先 Shift+单击或框选至少两张图片');const changes=[];if(mode==='left'||mode==='top'){const axis=mode==='left'?'x':'y',v=Math.min(...nodes.map(n=>n[axis]));for(const n of nodes)changes.push({id:n.id,[axis]:v})}
 if(mode==='grid'){const list=[...nodes].sort((a,b)=>a.y-b.y||a.x-b.x);const cols=Math.min(5,Math.max(1,Math.ceil(Math.sqrt(list.length)))),x=Math.min(...list.map(n=>n.x)),y=Math.min(...list.map(n=>n.y)),cellW=Math.max(...list.map(n=>n.w))+32,cellH=Math.max(...list.map(n=>n.h))+42;for(let i=0;i<list.length;i++)changes.push({id:list[i].id,x:x+(i%cols)*cellW,y:y+Math.floor(i/cols)*cellH})}
 await applySceneChange(changes);toast(mode==='grid'?'已按网格自动排列':'已完成对齐')}
async function groupSelection(ungroup=false){const nodes=selectedSceneNodes();if(!nodes.length)return toast('请先选择画布元素');if(!ungroup&&nodes.length<2)return toast('组合需要至少两个元素');const group=ungroup?null:crypto.randomUUID();await applySceneChange(nodes.map(n=>({id:n.id,groupId:group})));toast(ungroup?'已取消组合':'已组合所选元素')}
async function layerSelection(front){const nodes=selectedSceneNodes();if(!nodes.length)return toast('请先选择画布元素');await applySceneChange(nodes.map(n=>({id:n.id})),front?{front:true}:{back:true});toast(front?'已移至最上层':'已移至最下层')}
function positionFloatingMenu(anchor,menu,preferAbove=false){
 const a=anchor.getBoundingClientRect(),margin=8,gap=8,vw=innerWidth,vh=innerHeight;
 const width=Math.min(menu.id==='canvasMenu'?232:280,Math.max(180,vw-margin*2));
 menu.style.width=width+'px';
 menu.style.maxHeight='none';
 const natural=Math.max(100,menu.scrollHeight);
 const above=a.top-margin-gap,below=vh-a.bottom-margin-gap;
 const opensAbove=preferAbove?(above>=Math.min(natural,220)||above>below):(below<Math.min(natural,200)&&above>below);
 const available=Math.max(100,opensAbove?above:below);
 const height=Math.min(natural,available);
 const left=clamp(a.right-width,margin,Math.max(margin,vw-width-margin));
 menu.style.left=Math.round(left)+'px';
 menu.style.right='auto';
 menu.style.top=Math.round(opensAbove?a.top-gap-height:a.bottom+gap)+'px';
 menu.style.maxHeight=Math.floor(available)+'px';
}
function closeCanvasMenu(){hide('canvasMenu');$('canvasMenuToggle')?.setAttribute('aria-expanded','false')}
function toggleCanvasMenu(){
 const menu=$('canvasMenu');if(!menu.classList.contains('hidden'))return closeCanvasMenu();
 closeQuickProviderMenu();if(menu.parentNode!==document.body)document.body.append(menu);
 show('canvasMenu');$('canvasMenuToggle').setAttribute('aria-expanded','true');
 positionFloatingMenu($('canvasMenuToggle'),menu);
}
function closeQuickProviderMenu(){hide('providerQuickMenu');$('providerQuickToggle')?.setAttribute('aria-expanded','false')}
function openQuickProviderMenu(){
 const anchor=$('providerQuickToggle'),menu=$('providerQuickMenu');
 if(!providers.length)return openSettings(true);
 if(!menu.classList.contains('hidden'))return closeQuickProviderMenu();
 closeCanvasMenu();closeQuickModelMenu();if(menu.parentNode!==document.body)document.body.append(menu);
 show('providerQuickMenu');anchor.setAttribute('aria-expanded','true');
 positionFloatingMenu(anchor,menu,true);
}
function positionOpenMenus(){
 if(!$('canvasMenu').classList.contains('hidden'))positionFloatingMenu($('canvasMenuToggle'),$('canvasMenu'));
 if(!$('providerQuickMenu').classList.contains('hidden'))positionFloatingMenu($('providerQuickToggle'),$('providerQuickMenu'),true);
 if(quickModelOpened)positionQuickModelMenu();
}
function renderQuickProviderOptions(){
 const anchor=$('providerQuickToggle'),menu=$('providerQuickMenu');if(!anchor||!menu)return;
 const selected=activeProvider();$('providerQuickLabel').textContent=selected?.name||'添加中转站';
 anchor.title=selected?.name||'选择或添加中转站';
 menu.replaceChildren();
 for(const p of providers){
  const option=el('button','provider-quick-option'+(p.id===activeId?' active':''));option.type='button';option.setAttribute('role','option');option.setAttribute('aria-selected',String(p.id===activeId));
  option.append(el('span','provider-quick-name',p.name),el('small','',p.hasKey?'已配置 Key':'未配置 Key'));
  option.onclick=()=>{closeQuickProviderMenu();if(p.id!==activeId)activate(p.id)};
  menu.append(option);
 }
 const manage=el('button','provider-quick-manage','管理中转站');manage.type='button';manage.onclick=()=>{closeQuickProviderMenu();openSettings()};menu.append(manage);
}

function projectDownload(){if(!currentProject)return toast('请先打开项目');closeCanvasMenu();location.href=APP_BASE+projectPath('/backup')}
function importProjectChoose(){closeCanvasMenu();$('projectArchiveFile').click()}
async function importProjectFile(f){if(!f)return;if(!f.name.toLowerCase().endsWith('.hamoki'))return toast('请选择 .hamoki 项目备份文件');if(f.size>38*1024*1024)return toast('备份文件太大，请分批整理项目');if(!confirm('导入后会新建独立项目，原项目不会被覆盖。是否继续？'))return;
 const raw=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(f)});
 try{setSaving('正在导入项目');const result=await api('projects/import',{method:'POST',body:{archive:raw}});await loadProjects();await switchProject(result.project.id);await refreshProjectList();toast('项目已恢复：图片、版本树、对话及画布位置已导入')}
 catch(e){toast('导入失败：'+e.message)}finally{setSaving('已同步')}
}

function toggleReferenceNode(id,role){
 const n=currentProject?.nodes?.find(x=>x.id===id);if(!n||n.kind==='note')return;
 const idx=referenceNodeRoles.findIndex(x=>x.nodeId===id);
 if(idx>=0)referenceNodeRoles.splice(idx,1);
 else if(referenceInputs.length+referenceNodeRoles.length>=8){toast('参考图总数最多 8 张（含上传与画布参考）');return}
 else referenceNodeRoles.push({nodeId:id,role:role||'general'});
 selectNode(id);renderContext();toast(referenceNodeRoles.length+' 张参考图已选择；可设置造型、配色和画风');
}
function selectedImages(){return selectedSceneNodes().filter(n=>n.kind!=='note')}
function downloadSelectedImages(){
 const nodes=selectedImages();if(!nodes.length)return toast('请先框选图片');
 if(nodes.length>80)return toast('每批最多下载 80 张原图，请分批选择');
 const address=APP_BASE+projectPath('/nodes/export')+'?ids='+encodeURIComponent(nodes.map(n=>n.id).join(','));
 const link=el('a');link.href=address;link.download='hamoki-selected-images.zip';document.body.append(link);link.click();link.remove();
 toast('正在打包下载 '+nodes.length+' 张原图');
}
function addSelectedReferences(){
 const nodes=selectedImages();if(!nodes.length)return toast('请先框选图片');
 const add=nodes.filter(n=>!referenceNodeRoles.some(r=>r.nodeId===n.id));
 const available=8-referenceInputs.length-referenceNodeRoles.length;
 if(add.length>available)return toast('最多只能再加入 '+Math.max(available,0)+' 张参考图，请减少选择后重试');
 if(!add.length)return toast('选中的图片已经在参考图列表中');
 referenceNodeRoles.push(...add.map(n=>({nodeId:n.id,role:'general'})));
 renderContext();if(window.innerWidth<850)$('assistantPanel').classList.add('open');
 toast('已将 '+add.length+' 张图片设为综合参考；不会自动发起生成');
}
function compareSelectedImages(){
 const nodes=selectedImages();if(nodes.length<2)return toast('请选择至少两张图片进行对比');
 if(nodes.length>12)return toast('一次最多并排对比 12 张，请减少选中的图片');
 const root=$('selectedCompareGrid');root.replaceChildren();
 for(const [i,n] of nodes.entries()){
  const card=el('div','selected-compare-item'),img=el('img'),caption=el('div','compare-caption'),h=currentHistory(n.historyId);
  img.src=nodeImage(n);img.alt='对比图片 '+(i+1);img.loading='lazy';
  caption.append(el('strong','','图片 '+(i+1)),el('small','',(h?.model||'本地参考素材')+' · '+(h?.prompt||n.title||'无历史提示词').slice(0,180)));
  card.append(img,caption);root.append(card);
 }
 show('selectedCompareModal');
}
async function copySelectedPrompts(){
 const nodes=selectedImages(),list=nodes.map(n=>({n,h:currentHistory(n.historyId)})).filter(x=>x.h?.prompt);
 if(!list.length)return toast('选中的图片没有生成提示词（上传素材不包含提示词）');
 const text=list.map((item,i)=>'【图片 '+(i+1)+' · '+(item.h.model||'AI')+'】\n'+item.h.prompt).join('\n\n');
 try{await navigator.clipboard.writeText(text);toast('已复制 '+list.length+' 条提示词')}
 catch(e){
  const box=el('textarea');box.value=text;box.style.cssText='position:fixed;left:-10000px;top:0';document.body.append(box);box.select();
  const copied=document.execCommand('copy');box.remove();toast(copied?'已复制 '+list.length+' 条提示词':'浏览器不支持自动复制，请允许剪贴板访问');
 }
}
async function removeSelectedImages(){
 const nodes=selectedImages();if(!nodes.length)return toast('请先框选图片');
 if(!confirm('确认从当前画布移除 '+nodes.length+' 张图片？\n已生成作品的历史与原图不会被删除，可使用 Ctrl+Z 撤销。'))return;
 const ids=nodes.map(n=>n.id);
 try{
  const result=await api(projectPath('/nodes/batch'),{method:'DELETE',body:{ids}});
  lastProjectRevision=result.revision;
  currentProject.nodes=currentProject.nodes.filter(n=>!ids.includes(n.id));
  referenceNodeRoles=referenceNodeRoles.filter(r=>!ids.includes(r.nodeId));
  if(sourceNodeId&&ids.includes(sourceNodeId))sourceNodeId=null;
  multiNodeIds.clear();selectedNodeId=null;
  undoStack.push({kind:'bulk-remove',ids,batchId:result.batchId});if(undoStack.length>60)undoStack.shift();
  redoStack=[];updateUndoButtons();renderNodes();renderContext();toast('已从画布移除 '+ids.length+' 张图片，可按 Ctrl+Z 恢复');
 }catch(e){toast('批量移除失败：'+e.message)}
}
function closeBoardContextMenu(){hide('boardContextMenu')}
function showBoardContextMenu(e){
 if(e.target.closest('button,input,textarea,select,.tool-dock,.canvas-hud,.selection-toolbar,.empty-cta,.board-context-menu'))return;
 e.preventDefault();e.stopPropagation();closeCanvasMenu();closeQuickModelMenu();closeQuickProviderMenu();
 const nodeElement=e.target.closest('.canvas-node'),id=nodeElement?.dataset.id;
 if(id&&!multiNodeIds.has(id))selectNode(id);
 const menu=$('boardContextMenu');menu.replaceChildren();
 const nodes=selectedImages(),single=nodes.length===1?nodes[0]:null,h=single?currentHistory(single.historyId):null;
 const caption=id?nodes.length+' 张图片已选择':'画布快捷操作';
 menu.append(el('div','context-title',caption));
 const item=(title,fn,danger=false)=>{const btn=el('button',danger?'danger':'',title);btn.type='button';btn.setAttribute('role','menuitem');btn.onclick=()=>{closeBoardContextMenu();fn()};menu.append(btn)};
 if(nodes.length){
  if(single&&h)item('查看原图',()=>openViewer(h.id));
  if(single&&h)item('AI 智能拆组件',()=>openSmartComponents(h.id));
  if(single&&h)item('继续修改这张图',()=>continueFrom(h.id,single.id));
  if(single&&h)item('一键切图',openSelectedImageCut);
  if(single)item('本地编辑图片',()=>openLocalImageEditor(single));
  item('批量下载原图 ZIP',downloadSelectedImages);
  item('作为综合参考图',addSelectedReferences);
  if(nodes.length>1){
   item('整齐排列',()=>arrangeSelection('grid'));item('左对齐',()=>arrangeSelection('left'));item('顶端对齐',()=>arrangeSelection('top'));
   item('图片对比',compareSelectedImages);
   item('提取提示词',copySelectedPrompts);
  }
  item('移到最上层',()=>layerSelection(true));item('移到最下层',()=>layerSelection(false));
  if(nodes.length>1){item('组合所选（可选）',()=>groupSelection(false));item('取消组合',()=>groupSelection(true));}
  item('从画布移除',removeSelectedImages,true);
  item('取消选择',()=>selectNode(null));
 }else{
  item('全选当前画布图片',pickAllNodes);
  item('上传图片',()=>$('canvasFiles').click());
  item('添加便签',()=>createNote(worldXY(e)));
  item('适应画布大小',fitCanvas);
  if(undoStack.length)item('撤销上一步',()=>stepHistory('undo'));
  if(redoStack.length)item('重做上一步',()=>stepHistory('redo'));
 }
 if(menu.parentNode!==document.body)document.body.append(menu);
 show('boardContextMenu');
 const width=menu.getBoundingClientRect().width,height=menu.getBoundingClientRect().height;
 menu.style.left=clamp(e.clientX,8,Math.max(8,innerWidth-width-8))+'px';
 menu.style.top=clamp(e.clientY,8,Math.max(8,innerHeight-height-8))+'px';
}
let smartComponentTimer=null,smartComponentSource=null,smartComponentPlan=null;
async function openSmartComponents(historyId){
 if(!currentProject||!historyId)return toast("请选中一张已生成图片");
 if(!currentProject.nodes.some(n=>n.kind==="generated"&&n.historyId===historyId))return toast("只能拆当前画布上的生成图");
 smartComponentSource=historyId;show("smartComponentModal");
 $("smartComponentSource").src=currentHistory(historyId)?.url||"";
 await refreshSmartComponents();
 if(smartComponentTimer)clearInterval(smartComponentTimer);
 smartComponentTimer=setInterval(()=>{if(!$("smartComponentModal").classList.contains("hidden"))refreshSmartComponents().catch(()=>{});},4000);
}
async function refreshSmartComponents(){
 const data=await api(projectPath("/ai-components")),plan=data.plan,items=$("smartComponentItems");smartComponentPlan=plan;items.replaceChildren();
 if(!plan){$("smartComponentHint").textContent="点击 AI 识别这张图，自动列出可拆出的组件。";$("smartComponentGenerateAll").disabled=true;$("smartComponentDownload").disabled=true;return}
 if(plan.sourceId!==smartComponentSource){$("smartComponentHint").textContent="保存的是另一张图的拆解结果，可以重新分析当前图片。";return}
 const done=plan.items.filter(x=>x.status==="done").length;const unstarted=plan.items.filter(x=>!x.jobId).length;
 $("smartComponentGenerateAll").disabled=plan.status!=="ready"||unstarted===0||!!plan.auto?.enabled;
 $("smartComponentDownload").disabled=done===0;
 $("smartComponentHint").textContent=plan.status==="analyzing"?"正在识别组件...":plan.status==="failed"?"识别失败："+plan.error:"已识别 "+plan.items.length+" 个组件 · 已完成 "+done+" 个 · 待提交 "+unstarted+" 个"+(plan.auto?.enabled?" · 自动制作中":"")+(plan.auto?.error?" · "+plan.auto.error:"");
 for(const item of plan.items){
  const card=el("div","smart-component-card");if(item.url){const img=el("img");img.src=item.url;img.alt=item.name;card.append(img)}
  const info=el("div","smart-component-details");info.append(el("strong","",item.index+". "+item.name),el("small","",item.category+" · "+item.status));
  if(item.resultId){const transparentStatus=item.category==="background"?"背景图无需透明":item.transparentVerified===true?"已检测到透明通道":"未检测到有效透明背景，请检查或重生成";info.append(el("small",item.transparentVerified===false&&item.category!=="background"?"smart-component-warning":"",transparentStatus));const view=el("button","soft-btn","查看大图");view.type="button";view.onclick=()=>openViewer(item.resultId);info.append(view)}
  const busy=item.status==="queued"||item.status==="running";
  const button=el("button","soft-btn",busy?"生成中...":item.status==="done"?"重新生成":item.status==="failed"?"重试此组件":"生成此组件");button.type="button";button.disabled=busy;
  button.onclick=async()=>{if(!confirm("生成「"+item.name+"」会调用图片模型并可能产生费用。继续？"))return;
   button.disabled=true;try{await api(projectPath("/ai-components/generate"),{method:"POST",body:{itemId:item.id,confirmCost:true,retry:item.status==="done"}});await refreshSmartComponents()}catch(e){toast(e.message);button.disabled=false}};
  info.append(button);card.append(info);items.append(card);
 }
}
async function generateAllSmartComponents(){
 const plan=smartComponentPlan;if(!plan||plan.sourceId!==smartComponentSource||plan.status!=="ready")return;
 const todo=plan.items.filter(x=>!x.jobId).length;if(!todo)return toast("没有等待制作的组件");
 if(!confirm("即将自动逐个制作 "+todo+" 个组件。每个组件会单独调用付费图片模型，可能产生 "+todo+" 次费用，模型可能失败或重绘变形。确定开始吗？"))return;
 const button=$("smartComponentGenerateAll");button.disabled=true;
 try{await api(projectPath("/ai-components/generate-all"),{method:"POST",body:{confirmCost:true}});await refreshSmartComponents()}catch(e){toast(e.message);button.disabled=false}
}
function downloadSmartComponents(){
 const plan=smartComponentPlan;if(!plan||plan.sourceId!==smartComponentSource)return;
 const ids=plan.items.filter(x=>x.resultId&&x.status==="done").map(x=>x.resultId);
 if(!ids.length)return toast("目前没有可下载的组件");
 location.href=APP_BASE+"/api/export?ids="+encodeURIComponent(ids.join(","));
}
function closeSmartComponents(){hide("smartComponentModal");if(smartComponentTimer)clearInterval(smartComponentTimer);smartComponentTimer=null}
async function runSmartComponentAnalysis(){
 if(!smartComponentSource)return;
 if(!confirm("AI 将识别这张游戏 UI 中的组件，可能产生模型费用。确认继续？"))return;
 const button=$("smartComponentAnalyze");button.disabled=true;
 try{await api(projectPath("/ai-components/analyze"),{method:"POST",body:{historyId:smartComponentSource,confirmCost:true}});await refreshSmartComponents()}catch(e){toast(e.message)}finally{button.disabled=false}
}
function openSelectedImageCut(){
 const selected=selectedSceneNodes();
 if(selected.length!==1||selected[0].kind!=='generated'||!selected[0].historyId){
  toast('请先选中一张已生成的图片，再使用一键切图');return;
 }
 document.dispatchEvent(new CustomEvent('hamoki:open-delivery',{detail:{
  projectId:currentProject.id,historyId:selected[0].historyId
 }}));
}
function placeToolbar(){
 const toolbar=$('selectionToolbar'),images=selectedSceneNodes().filter(n=>n.kind!=='note'),n=currentNode();
 toolbar.classList.toggle('bulk-selection-toolbar',images.length>1);
 if(!n||(!images.length&&n.kind!=='note')){hide('selectionToolbar');return}
 toolbar.replaceChildren();
 if(images.length>1){
  const heading=el('div','bulk-selection-count'),title=el('span','','已选择 '+images.length+' 张图片'),close=el('button','','取消选择');
  close.type='button';close.onclick=()=>selectNode(null);heading.append(title,close);toolbar.append(heading);
  const actions=[['download','批量下载',downloadSelectedImages],['plus','作为参考图',addSelectedReferences],['fit','整齐排列',()=>arrangeSelection('grid')],['zoom','图片对比',compareSelectedImages],['copy','提取提示词',copySelectedPrompts],['trash','批量移除',removeSelectedImages]];
  for(const [icon,label,action] of actions){
   const button=el('button',label==='批量移除'?'destructive':'');button.type='button';button.innerHTML=ico(icon);button.append(document.createTextNode(label));button.onclick=action;toolbar.append(button);
  }
  const r=$('board').getBoundingClientRect(),left=Math.min(...images.map(n=>n.x))*cam.scale+cam.x,top=Math.min(...images.map(n=>n.y))*cam.scale+cam.y;
  show('selectionToolbar');
  toolbar.style.left=clamp(left,12,Math.max(12,r.width-toolbar.offsetWidth-12))+'px';
  toolbar.style.top=clamp(top-toolbar.offsetHeight-12,12,Math.max(12,r.height-toolbar.offsetHeight-12))+'px';return;
 }
 const choices=n.kind==='note'?[['edit','编辑',()=>editNote(n,document.querySelector('.canvas-node[data-id="'+n.id+'"]'))],['trash','移除',()=>removeNode(n),true]]:
 n.kind==='reference'?[['edit','本地编辑',()=>openLocalImageEditor(n)],['plus','设为参考',()=>toggleReferenceNode(n.id,'general')],['wand','图片反推',()=>reverseNode(n)],['download','下载',downloadSelectedImages],['trash','移除',()=>removeNode(n),true]]:
 [['spark','AI 智能拆组件',()=>openSmartComponents(n.historyId)],['image','一键切图',openSelectedImageCut],['edit','本地编辑',()=>openLocalImageEditor(n)],['wand','继续修改',()=>continueFrom(n.historyId,n.id)],['refresh','重生成',()=>regenerateFrom(n.historyId,n.id)],['edit','局部重绘',()=>openMask(n.historyId)],['spark','高清增强',()=>enhanceFrom(n.historyId,n.id)],['image','去背景',()=>removeBackground(n.historyId,n.id)],['copy','设为参考',()=>toggleReferenceNode(n.id,'general')],['zoom','反推',()=>reverseNode(n)],['download','下载',()=>{location.href=APP_BASE+'/api/download/'+n.historyId}],['trash','移除',()=>removeNode(n),true]];
 for(const [icon,label,action,danger] of choices){const b=el('button',danger?'destructive':'');b.innerHTML=ico(icon);b.append(document.createTextNode(label));b.onclick=action;toolbar.append(b)}
 const board=$('board').getBoundingClientRect(),left=cam.x+n.x*cam.scale,top=cam.y+n.y*cam.scale-48;
 show('selectionToolbar');toolbar.style.left=clamp(left,10,Math.max(10,board.width-toolbar.offsetWidth-10))+'px';
 toolbar.style.top=clamp(top,10,Math.max(10,board.height-45))+'px';
}
async function removeNode(n){if(!confirm('从画布移除此元素？已生成的历史作品不会被删除。'))return;try{await api(projectPath(`/nodes/${n.id}`),{method:'DELETE',body:{}});currentProject.nodes=currentProject.nodes.filter(x=>x.id!==n.id);if(selectedNodeId===n.id)selectedNodeId=null;renderNodes();setSaving('已保存')}catch(e){toast(e.message)}}
function editNote(n,card){if(!card)return;const old=card.querySelector('.note-content');if(!old||card.querySelector('textarea'))return;const textarea=el('textarea','inline-note');textarea.value=n.text||'';textarea.style.cssText='width:100%;height:100%;border:0;background:transparent;color:#43382c;font:inherit;resize:none;outline:none;line-height:1.6';old.replaceWith(textarea);textarea.focus();textarea.select();const save=async()=>{const previous=n.text||'',next=textarea.value.slice(0,1600);n.text=next;if(textarea.parentNode){textarea.replaceWith(el('div','note-content',n.text))}try{await persistScene([{id:n.id,text:next}]);if(previous!==next)historyRecord([{id:n.id,text:previous}],[{id:n.id,text:next}])}catch(e){n.text=previous;toast(e.message)}};textarea.onkeydown=e=>{if(e.key==='Escape'){textarea.value=n.text;textarea.blur()}if(e.key==='Enter'&&e.ctrlKey)textarea.blur()};textarea.onblur=save;}
function startNodeDrag(e,n){
 canvasPreviewCandidate=e.target.closest('.node-image-box img')&&e.button===0?{id:n.id,at:Date.now(),x:e.clientX,y:e.clientY,dragged:false}:null;if(e.button!==0&&e.pointerType!=='touch')return;if((e.ctrlKey||e.metaKey)&&n.kind!=='note'){e.preventDefault();e.stopPropagation();selectNode(n.id,true);return}if(spaceDown||tool==='hand'){startPan(e);return}e.stopPropagation();e.preventDefault();if(e.shiftKey){selectNode(n.id,true);return}
 if(!multiNodeIds.has(n.id)){
  const together=n.groupId?currentProject.nodes.filter(x=>x.groupId===n.groupId).map(x=>x.id):[n.id];
  multiNodeIds=new Set(together);selectedNodeId=n.id;renderNodes();
 }
 const group=currentProject.nodes.filter(x=>multiNodeIds.has(x.id));
 gesture={type:'move-multi',id:e.pointerId,origin:boardXY(e),before:snapshotScene(group.map(x=>x.id))};$('board').setPointerCapture(e.pointerId)}
function startResize(e,n){if(e.button!==0&&e.pointerType!=='touch')return;e.preventDefault();e.stopPropagation();selectNode(n.id);gesture={type:'resize',id:e.pointerId,nodeId:n.id,origin:boardXY(e),startW:n.w,startH:n.h,before:snapshotScene([n.id])};$('board').setPointerCapture(e.pointerId)}
function startPan(e){e.preventDefault();$('board').classList.toggle('middle-panning',e.button===1);gesture={type:'pan',id:e.pointerId,origin:boardXY(e),startX:cam.x,startY:cam.y};$('board').setPointerCapture(e.pointerId)}
function startPinch(){if(activePointers.size<2)return;const a=[...activePointers.values()],center={x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2},distance=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);gesture={type:'pinch',center,distance,start:{...cam},wx:(center.x-cam.x)/cam.scale,wy:(center.y-cam.y)/cam.scale}}
function pointerDown(e){if(e.button===1){e.preventDefault();e.stopPropagation();activePointers.set(e.pointerId,boardXY(e));startPan(e);return}if(e.button!==0&&e.pointerType!=='touch')return;const pt=boardXY(e);activePointers.set(e.pointerId,pt);if(activePointers.size>=2&&e.pointerType==='touch'){startPinch();return}if(e.target.closest('.tool-dock,.canvas-hud,.selection-toolbar,.empty-cta'))return;if(e.target.closest('.canvas-node'))return;const pos=worldXY(e);if(tool==='note'){createNote(pos);changeTool('select');return}
 if(tool==='select'&&e.pointerType!=='touch'){e.preventDefault();marqueeRect=el('div','marquee-rect');$('board').append(marqueeRect);gesture={type:'marquee',id:e.pointerId,origin:pt,start:pos,additive:!!e.shiftKey};$('board').setPointerCapture(e.pointerId);return}
 selectNode(null);startPan(e)}
function pointerMove(e){
 if(canvasPreviewCandidate&&Math.hypot(e.clientX-canvasPreviewCandidate.x,e.clientY-canvasPreviewCandidate.y)>6)canvasPreviewCandidate.dragged=true;if(activePointers.has(e.pointerId))activePointers.set(e.pointerId,boardXY(e));if(!gesture)return;if(gesture.type==='pinch'&&activePointers.size>=2){e.preventDefault();const a=[...activePointers.values()];const mid={x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2},distance=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);const sc=clamp(gesture.start.scale*distance/Math.max(10,gesture.distance),.18,2.8);changeCamera({x:mid.x-gesture.wx*sc,y:mid.y-gesture.wy*sc,scale:sc},false);return}if(gesture.id!==e.pointerId)return;
 const now=boardXY(e),dx=now.x-gesture.origin.x,dy=now.y-gesture.origin.y;
 if(gesture.type==='marquee'){const left=Math.min(now.x,gesture.origin.x),top=Math.min(now.y,gesture.origin.y);Object.assign(marqueeRect.style,{left:left+'px',top:top+'px',width:Math.abs(dx)+'px',height:Math.abs(dy)+'px'});return}
 if(gesture.type==='pan')changeCamera({x:gesture.startX+dx,y:gesture.startY+dy,scale:cam.scale},false);
 if(gesture.type==='move-multi'){for(const original of gesture.before){const n=currentProject.nodes.find(x=>x.id===original.id);if(!n)continue;n.x=Math.round(original.x+dx/cam.scale);n.y=Math.round(original.y+dy/cam.scale);const card=document.querySelector(`.canvas-node[data-id="${n.id}"]`);if(card){card.style.left=n.x+'px';card.style.top=n.y+'px'}}renderLinks();placeToolbar()}
 if(gesture.type==='resize'){const n=currentProject.nodes.find(x=>x.id===gesture.nodeId);if(!n)return;n.w=clamp(Math.round(gesture.startW+dx/cam.scale),90,1200);n.h=clamp(Math.round(gesture.startH+dy/cam.scale),90,1200);const card=document.querySelector(`.canvas-node[data-id="${n.id}"]`);if(card){card.style.width=n.w+'px';card.style.height=n.h+'px'}renderLinks();placeToolbar()}}
async function pointerUp(e){activePointers.delete(e.pointerId);if(!gesture)return;if(gesture.type==='pinch'){if(activePointers.size<2){gesture=null;scheduleViewportSave()}return}if(gesture.id!==e.pointerId)return;const g=gesture;gesture=null;
 if(g.type==='pan'){$('board').classList.remove('middle-panning');scheduleViewportSave();return}
 if(g.type==='marquee'){const end=worldXY(e),loX=Math.min(g.start.x,end.x),hiX=Math.max(g.start.x,end.x),loY=Math.min(g.start.y,end.y),hiY=Math.max(g.start.y,end.y);marqueeRect?.remove();marqueeRect=null;
  if(!g.additive)multiNodeIds.clear();
  if(Math.hypot(boardXY(e).x-g.origin.x,boardXY(e).y-g.origin.y)>=5){
   for(const n of currentProject.nodes){if(n.kind!=='note'&&n.x<hiX&&n.x+n.w>loX&&n.y<hiY&&n.y+n.h>loY)multiNodeIds.add(n.id)}
  }
  selectedNodeId=[...multiNodeIds].at(-1)||null;renderNodes();if(multiNodeIds.size>0)toast('已选择 '+multiNodeIds.size+' 张图片');return}
 const ids=g.before.map(x=>x.id),after=snapshotScene(ids);if(JSON.stringify(g.before)===JSON.stringify(after)){if(g.type==='move-multi'&&canvasPreviewCandidate&&!canvasPreviewCandidate.dragged&&canvasPreviewCandidate.id===g.before[0]?.id&&Date.now()-canvasPreviewCandidate.at<900){const selected=currentProject.nodes.find(n=>n.id===canvasPreviewCandidate.id);canvasPreviewCandidate=null;if(selected)openCanvasOriginal(selected)}return}canvasPreviewCandidate=null;
 try{await persistScene(after);historyRecord(g.before,after);setSaving('已同步')}catch(err){for(const original of g.before){const n=currentProject.nodes.find(x=>x.id===original.id);if(n)Object.assign(n,original)}renderNodes();toast('画布位置保存失败：'+err.message)}
}
function setupBoard(){const board=$('board');board.dataset.tool=tool;board.addEventListener('contextmenu',showBoardContextMenu);board.addEventListener('auxclick',e=>{if(e.button===1){e.preventDefault();e.stopPropagation()}});board.addEventListener('pointerdown',e=>{if(e.button===1){pointerDown(e)}},true);board.addEventListener('pointerdown',e=>{if(e.button!==1)pointerDown(e)});board.addEventListener('pointermove',pointerMove);board.addEventListener('pointerup',pointerUp);board.addEventListener('pointercancel',pointerUp);
 board.addEventListener('wheel',e=>{if(e.target.closest('.selection-toolbar'))return;e.preventDefault();const p=boardXY(e);zoomAt(e.deltaY<0?1.11:.9,p.x,p.y)},{passive:false});board.addEventListener('dblclick',e=>{if(e.target===board&&tool==='note')createNote(worldXY(e))});
 let dragDepth=0;board.addEventListener('dragenter',e=>{e.preventDefault();dragDepth++;show('dropOverlay')});board.addEventListener('dragover',e=>e.preventDefault());board.addEventListener('dragleave',e=>{e.preventDefault();dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)hide('dropOverlay')});board.addEventListener('drop',async e=>{e.preventDefault();dragDepth=0;hide('dropOverlay');await uploadToCanvas(e.dataTransfer.files,worldXY(e))});
}
async function fileData(f){if(!['image/png','image/jpeg','image/webp'].includes(f.type))throw Error('只支持 PNG、JPG、WebP 图片');if(f.size>12*1024*1024)throw Error('单张图片不能超过 12MB');return new Promise((resolve,reject)=>{const rd=new FileReader();rd.onload=()=>resolve(rd.result);rd.onerror=reject;rd.readAsDataURL(f)})}
async function uploadToCanvas(files,at){if(!currentProject)return;const arr=[...files].filter(f=>f.type.startsWith('image/')).slice(0,15);if(!arr.length)return;let ok=0;for(const [i,f] of arr.entries()){try{const data=await fileData(f);let preview=null;try{const blob=await imagePreviewBlob(f);if(blob)preview=await toDataUrl(blob)}catch{}const r=await api(projectPath('/assets'),{method:'POST',body:{image:data,preview,name:f.name,x:at.x+(i%4)*335,y:at.y+Math.floor(i/4)*345,w:288,h:288}});currentProject.nodes.push(r.node);ok++}catch(e){toast(f.name+': '+e.message)}}renderNodes();await refreshProjectList();refreshStorage();toast(`已将 ${ok} 张图片放入当前画布`)}
async function createNote(at){if(!currentProject)return;try{const r=await api(projectPath('/notes'),{method:'POST',body:{x:at.x,y:at.y,w:245,h:170,text:'记录你的创作想法…'}});currentProject.nodes.push(r.node);renderNodes();selectNode(r.node.id);toast('双击便签可以编辑内容')}catch(e){toast(e.message)}}
async function addFiles(files){for(const f of [...files]){if(referenceInputs.length+referenceNodeRoles.length>=8){toast('参考图总数最多 8 张（含上传与画布参考）');break}try{referenceInputs.push({data:await fileData(f),name:f.name})}catch(e){toast(e.message)}}renderContext()}
async function addNodeAsRef(n){if(referenceInputs.length+referenceNodeRoles.length>=8)return toast('参考图总数最多 8 张（含上传与画布参考）');try{const src=nodeImage(n),r=await fetch(src,{credentials:'same-origin'});if(!r.ok)throw Error('原图读取失败');const blob=await r.blob();const f=new File([blob],n.title||'画布参考图',{type:blob.type||'image/png'});await addFiles([f]);if(window.innerWidth<850)$('assistantPanel').classList.add('open');toast('已加入参考图片')}catch(e){toast(e.message)}}
function renderContext(){const bar=$('contextStrip');bar.replaceChildren();const h=currentHistory(sourceId);if(h){const card=el('div','context-card'),img=el('img');putPreview(img,h.url,h.previewUrl);card.append(img,el('span','',maskData?'蒙版原图：'+h.model:'参考原图模型：'+h.model));const close=el('button','','×');close.onclick=()=>{sourceId=sourceNodeId=maskData=null;enhanceMode=false;renderContext()};card.append(close);bar.append(card)}bar.classList.toggle('hidden',!h);
 const refs=$('refStrip');refs.replaceChildren();for(const [i,r] of referenceInputs.entries()){const card=el('div','ref-thumb'),im=el('img');im.src=r.data;im.title=r.name;const close=el('button','','×');close.title='移除参考图';close.onclick=()=>{referenceInputs.splice(i,1);renderContext()};card.append(im,close);refs.append(card)}for(const [i,item] of referenceNodeRoles.entries()){
  const n=currentProject?.nodes?.find(n=>n.id===item.nodeId);if(!n)continue;
  const chip=el('div','role-chip'),im=el('img');putPreview(im,nodeImage(n),previewImage(n));im.alt='参考图'+(i+1);
  const label=el('span','',`图${i+1}`);const picker=el('select','role-picker');picker.setAttribute('aria-label','图'+(i+1)+'的参考用途');
  for(const [val,name] of ROLE_OPTIONS)picker.add(new Option(name,val));picker.value=item.role;
  picker.onchange=()=>{item.role=picker.value;renderContext()};
  const remove=el('button','remove-role','×');remove.title='移除参考图';remove.onclick=()=>toggleReferenceNode(item.nodeId);
  chip.append(im,label,picker,remove);refs.append(chip);
 }
 refs.classList.toggle('hidden',!referenceInputs.length&&!referenceNodeRoles.length);
 $('referenceTip').classList.toggle('hidden',!referenceNodeRoles.length);
 const counter=document.querySelector('.studio-ref-count');if(counter)counter.textContent=(referenceInputs.length+referenceNodeRoles.length)+' / 8';
}
function continueFrom(id,nodeId){
 enhanceMode=false;
 const h=currentHistory(id);if(!h)return toast('原图没有找到');
 sourceId=h.id;sourceNodeId=nodeId||currentProject.nodes.find(n=>n.historyId===id)?.id||null;maskData=maskSourcePng=null;editingPrompt=h.prompt;
 /* The chosen service and model stay untouched; the historical source is an image reference only. */
 /* Original aspect/resolution are shown in history but must not replace current controls. */
 $('transparentBg').checked=false;$('prompt').value='';$('prompt').placeholder='正在修改上一版本：例如「换成红色头发，其他部分不变」';
 renderContext();$('prompt').focus();if(innerWidth<850)$('assistantPanel').classList.add('open');toast('已把原图设为编辑参考；继续使用你当前选择的服务商、模型与参数');
}
function regenerateFrom(id,nodeId){continueFrom(id,nodeId);$('prompt').value='保持原图的角色造型和整体构图，重新生成一个细节更精致的版本。';toast('重新生成已准备好，点击发送后才会调用模型并计费')}
function enhanceFrom(id,nodeId){continueFrom(id,nodeId);enhanceMode=true;$('resolution').value='4K';$('quality').value='high';$('prompt').value='尽量保持原图主体、色彩、构图完全一致。强化线条清晰度、材质细节及光影层次，输出当前模型可支持的最高细节版本。';toast('已准备 AI 高清重绘，实际尺寸和效果取决于模型；不会无提示扣费')}
function removeBackground(id,nodeId){const p=activeProvider();if(!p||p.mode!=='openai'||p.imageMode!=='images')return toast('透明去背景需要支持透明输出的 OpenAI Images 模型');continueFrom(id,nodeId);$('transparentBg').checked=true;$('prompt').value='只保留原图的主体，移除背景和杂物，背景透明，尽量保留发丝、饰品边缘等细节。';toast('已准备 AI 去背景，生成图可能有细节变化；确认后才会收费')}

function checkProvider(capability='image'){
 if(!authorized){toast('请先等待工作区连接');return false}
 const selectedId=activeId;
 const p=providers.find(item=>item.id===selectedId),config=p?.capabilities?.[capability];
 const hasKey=config?.inheritApiKey===false?!!config.hasKey:!!p?.hasKey;
 const hasUrl=config?.inheritBaseUrl===false?!!config.baseUrl:!!p?.url;
 if(!p||config?.enabled===false||!hasUrl||(!hasKey&&!demoMode)){
  openSettings(true);toast('请检查'+(capability==='edit'?'图片编辑':'图片生成')+'服务商、API 地址和密钥');return false
 }
 return true
}
function nearestSupportedAspectRatio(width,height){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('参考图尺寸无效');
 const variants=['1:1','3:2','2:3','16:9','9:16','4:3','3:4'],v=width/height;
 return variants.reduce((a,b)=>Math.abs(Math.log(Number(b.split(':')[0])/Number(b.split(':')[1])/v))<Math.abs(Math.log(Number(a.split(':')[0])/Number(a.split(':')[1])/v))?b:a);
}
async function referenceRatioValue(){
if($('ratio').value!=='reference')return null;
let src=referenceInputs[0]?.data;
if(!src&&sourceId){const h=currentHistory(sourceId);src=h?.url||h?.previewUrl}
if(!src&&referenceNodeRoles.length){const n=currentProject?.nodes.find(x=>x.id===referenceNodeRoles[0].nodeId);if(n?.kind==='generated'){const h=currentHistory(n.historyId);src=h?.url||h?.previewUrl}else if(n?.assetFile)src=APP_BASE+'/api/media/'+n.assetFile}
if(!src)throw Error('请先添加参考图');
const dims=await new Promise((ok,fail)=>{const im=new Image();im.onload=()=>ok([im.naturalWidth,im.naturalHeight]);im.onerror=()=>fail(Error('读取参考图尺寸失败'));im.src=src});
return nearestSupportedAspectRatio(dims[0],dims[1]);
}
function generationBody(targets){if(!currentProject)throw Error('请先选择项目');const text=$('prompt').value.trim();if(!text)throw Error('请填写创作描述');if(!targets&&!checkProvider(sourceId||maskData?'edit':'image'))throw Error('请先配置对应能力的中转站');if(!targets&&!($('imageModel').value.trim()||activeProvider()?.imageModel))throw Error('请先在操作台选择图片模型');const point=currentBoardPoint(.45,.34);return {projectId:currentProject.id,prompt:text,providerId:activeId,model:($('imageModel').value.trim()||activeProvider()?.imageModel||''),ratio:$('ratio').value,resolution:$('resolution').value,quality:$('quality').value,count:Number($('amount').value),transparentBg:$('transparentBg').checked,references:referenceInputs.map(r=>r.data),referenceNodes:referenceNodeRoles.map(r=>({...r})),sourceId,sourceNodeId,mask:maskData,maskSourceImage:maskSourcePng,canvasX:Math.round(point.x),canvasY:Math.round(point.y),...(targets?{targets,count:1}:{})}}
async function submitGeneration(targets=null){if(composerMode==='text'&&!targets)return submitTextChat();let body;try{const referenceRatio=await referenceRatioValue();body=generationBody(targets);if(referenceRatio){body.ratio=referenceRatio;toast('已按参考图选择最接近的模型比例：'+referenceRatio)}}catch(e){if(e.message!=='请先配置对应能力的中转站')toast(e.message);return}const count=targets?targets.length:body.count;if(!targets&&body.model)rememberQuickModel(body.model);const displayTargets=targets?.length?targets:[{providerId:body.providerId,model:body.model}];const details=displayTargets.map(t=>(providers.find(p=>p.id===t.providerId)?.name||'未选择服务商')+' / '+(t.model||'未选择模型')).join('\n');if(!confirm(`${demoMode?'演示提交':'真实付费请求'}：即将提交 ${count} 个任务${body.mask?'（局部蒙版）':''}\n本次实际使用：\n${details}\n比例 ${body.ratio} / 分辨率 ${body.resolution}\n${demoMode?'不会扣费':'会产生中转站费用，取消或超时也可能已计费'}。确认继续？`))return;
 $('generateBtn').disabled=true;try{const r=await api('jobs',{method:'POST',body});toast(`已提交 ${r.jobs.length} 个${demoMode?'演示':'真实'}任务，结果会自动落到当前画布`);hide('compareModal');referenceInputs=[];referenceNodeRoles=[];sourceId=sourceNodeId=maskData=null;maskSourcePng=null;editingPrompt=null;enhanceMode=false;$('transparentBg').checked=false;renderContext();$('prompt').value='';await refreshProjectData();if(window.innerWidth<850)$('assistantPanel').classList.remove('open')}
 catch(e){toast('生成提交失败：'+e.message)}finally{$('generateBtn').disabled=false}}
function activeGenerationJobs(){return jobs.filter(j=>j.status==='queued'||j.status==='running')}
function updateGenerationElapsed(){
 const clock=$('generationElapsed');if(!clock)return;
 const active=activeGenerationJobs();if(!active.length)return;if(paused){clock.textContent='队列已暂停 · 在任务列表中恢复';return}
 const start=Math.min(...active.map(j=>Date.parse(j.createdAt)||Date.now()));
 const elapsed=Math.max(0,Math.floor((Date.now()-start)/1000));
 clock.textContent=elapsed>=60?`已等待 ${Math.floor(elapsed/60)} 分 ${elapsed%60} 秒`:`已等待 ${elapsed} 秒`;
}
function syncGenerationActivity(){
 const div=$('conversation');if(!div)return;
 const pending=activeGenerationJobs();let status=$('generationActivity');
 if(!pending.length){status?.remove();return}
 const activity=$('studioActivity');if(activity)activity.open=true;
 if(!status){
  status=el('div','generation-activity');status.id='generationActivity';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const orbit=el('div','generation-orbit');orbit.innerHTML=ico('spark');
  const detail=el('div','generation-detail');
  const heading=el('div','generation-heading');const title=el('strong');title.id='generationTitle';
  const dots=el('span','generation-dots');dots.setAttribute('aria-hidden','true');for(let i=0;i<3;i++)dots.append(el('i'));
  heading.append(title,dots);
  const progress=el('div','generation-track');progress.setAttribute('aria-hidden','true');progress.append(el('span'));
  const meta=el('div','generation-meta');meta.append(el('span','', '任务处理期间可以继续操作画布'),el('span','',''));meta.lastElementChild.id='generationElapsed';
  detail.append(heading,progress,meta);status.append(orbit,detail);
 }
 if(status.parentNode!==div){
  const nearBottom=div.scrollHeight-div.scrollTop-div.clientHeight<140;
  div.append(status);
  if(nearBottom)div.scrollTop=div.scrollHeight;
 }
 const running=pending.filter(j=>j.status==='running').length;
 $('generationTitle').textContent=paused?'队列已暂停 · 请到任务列表恢复':running?(pending.length>1?`正在生成 ${pending.length} 张图片`:'AI 正在绘制图片'):(pending.length>1?`${pending.length} 个生成任务排队中`:'生成任务排队中');
 updateGenerationElapsed();
}
function renderConversation(){const div=$('conversation'),oldBottom=div.scrollHeight-div.scrollTop-div.clientHeight<120;div.replaceChildren();const msgs=currentProject?.messages||[];
 if(!msgs.length){const welcome=el('div','assistant-welcome'),im=el('img');im.src=document.querySelector('.brand-wrap img')?.src||APP_BASE+'/assets/hamoki-avatar-128.webp';welcome.append(im,el('h3','','你好！今天想创造什么？'),el('p','','描述一个想法，或者从画布中选择一张图继续修改。我会把真实生成结果直接放到画布上。'));const chip=el('div','welcome-chip');chip.innerHTML=ico('spark');chip.append(document.createTextNode('提示：按 Ctrl + Enter 可以直接提交生图请求'));welcome.append(chip);div.append(welcome);syncGenerationActivity();return}
 for(const msg of msgs.slice(-130)){const line=el('div','chat-item '+(msg.role==='user'?'user':'assistant'));const from=el('div','chat-from'),avatar=el('span','chat-avatar'+(msg.role==='user'?' user':''));avatar.innerHTML=ico(msg.role==='user'?'pointer':'spark');from.append(avatar,document.createTextNode(msg.role==='user'?'我':msg.capability==='text'?'Hamoki · 文字回复':'Hamoki · 生成结果'));line.append(from,el('div','chat-bubble',msg.content||''));if(msg.imageId){const h=currentHistory(msg.imageId);if(h){const im=el('img','chat-result');putPreview(im,h.url,h.previewUrl);im.alt=h.prompt;im.onclick=()=>focusImage(h.id);line.append(im)}}line.append(el('div','chat-time',humanDate(msg.createdAt)));div.append(line)}syncGenerationActivity();if(oldBottom)div.scrollTop=div.scrollHeight}
function focusLatestGenerated(){
 const nodes=(currentProject?.nodes||[]).filter(n=>n.kind==='generated');
 if(!nodes.length)return toast('当前画布还没有生成作品');
 const last=nodes.reduce((a,b)=>Date.parse(a.createdAt||0)>=Date.parse(b.createdAt||0)?a:b);
 focusImage(last.historyId);
}
function focusImage(imageId){const n=currentProject?.nodes?.find(n=>n.historyId===imageId);if(!n)return openViewer(imageId);selectNode(n.id);const rect=$('board').getBoundingClientRect();changeCamera({x:rect.width*.5-(n.x+n.w*.5)*cam.scale,y:rect.height*.5-(n.y+n.h*.5)*cam.scale,scale:cam.scale});if(innerWidth<850)$('assistantPanel').classList.remove('open')}
const skillPrompts={
 views:'请基于参考角色制作统一的三视图设计稿：正面、侧面、背面并排展示。保持面貌、发型、服装结构、配色和装饰完全一致，纯色干净背景。',
 style:'请保持参考图片的主体、造型、构图不变，将绘画风格调整为精致的日系动漫插画，清晰线条、通透配色、细腻赛璐璐光影。',
 bg:'请保持主体人物、动作、服饰、比例和颜色，去除复杂的背景与多余装饰，改为干净的纯白工作室背景。',
 detail:'请以参考图片为主体，重新生成更清晰精细的高清版本，保持人物设计、配色与构图一致，提升线稿精度、材质细节与光影质感。'
};
function applySkill(s){closeSkillsMenu();const n=currentNode();if(n?.kind==='generated'&&!sourceId){sourceId=n.historyId;sourceNodeId=n.id;maskData=null;renderContext()}const existing=$('prompt').value.trim();$('prompt').value=existing?existing+'\n\n'+skillPrompts[s]:skillPrompts[s];if(s==='detail')$('resolution').value='4K';$('prompt').focus();toast('已填入创作指令，可继续修改后发送。支持情况以模型为准')}
async function reverseNode(n){const src=nodeImage(n);if(!src)return toast('图片不可用');try{const res=await fetch(src,{credentials:'same-origin'});if(!res.ok)throw Error('无法读取选中图片');const b=await res.blob(),f=new File([b],'反推参考',{type:b.type||'image/png'});reverseImage=await fileData(f);openReverse()}catch(e){toast(e.message)}}
function reverseFromReferences(){const selected=currentNode();if(selected&&selected.kind!=='note')return reverseNode(selected);if(!referenceInputs.length){$('referenceFiles').click();window.__reverseAfterUpload=true;return}reverseImage=referenceInputs[0].data;openReverse()}
function openReverse(){
 if(demoMode)return toast('共享演示站未开放真实反推。请使用独立 HTTPS 站进行实测');
 if(!reverseImage)return toast('请先添加参考图片');
 renderRuntimeSelectors();
 const pick=runtimeSelection('vision');
 $('reverseThumb').src=reverseImage;
 $('reverseModel').textContent=pick.providerId&&pick.model?'当前反推：'+pick.name+' · '+pick.model:'请选择服务商及视觉模型';
 $('reverseResult').value='';$('reverseWorking').textContent='';
 $('rerunReverse').textContent='开始反推（可能扣费）';
 show('reverseModal');
}
async function runReverse(){
 if(reverseBusy||!reverseImage)return;
 const route=runtimeSelection('vision');if(!route.providerId||!route.model)return toast('请在反推弹窗选择服务商和视觉模型');
 reverseBusy=true;$('rerunReverse').disabled=true;
 $('reverseModel').textContent='当前反推：'+route.name+' · '+route.model;
 $('reverseWorking').textContent='正在调用当前选择的视觉模型分析图片…';$('reverseResult').value='';
 try{
  const r=await api('reverse',{method:'POST',body:{providerId:route.providerId,image:reverseImage,kind:$('reverseKind').value,model:route.model}});
  reverseResult=r.prompt;$('reverseResult').value=r.prompt;$('reverseWorking').textContent='反推完成，可以编辑或直接填入创作描述。';
  $('rerunReverse').textContent='重新反推（可能扣费）';toast('图片反推已完成');
 }catch(e){$('reverseWorking').textContent='反推失败：'+e.message;toast(e.message)}
 finally{reverseBusy=false;$('rerunReverse').disabled=false}
}
function useReverse(append){const text=$('reverseResult').value.trim();if(!text)return toast('没有可用的提示词');const p=$('prompt');p.value=append&&p.value.trim()?p.value.trim()+'\n\n'+text:text;hide('reverseModal');p.focus();if(innerWidth<850)$('assistantPanel').classList.add('open');toast(append?'已追加到创作描述':'已填入创作描述')}
async function copyReverse(){try{await navigator.clipboard.writeText($('reverseResult').value);toast('提示词已复制')}catch{$('reverseResult').select();document.execCommand('copy');toast('已选择提示词，可以手动复制')}}

function closeQuickModelMenu(){
 quickModelOpened=false;quickModelQuery='';hide('composerModelMenu');
 $('imageModel')?.setAttribute('aria-expanded','false');$('composerModelToggle')?.setAttribute('aria-expanded','false');
}
function positionQuickModelMenu(){
 const anchor=$('composerModelWrap'),menu=$('composerModelMenu');if(!quickModelOpened||!anchor||!menu)return;
 const a=anchor.getBoundingClientRect(),vw=innerWidth,vh=innerHeight,padding=8,gap=7;
 const width=Math.min(360,Math.max(205,Math.min(vw-2*padding,Math.max(a.width,280))));
 menu.style.width=Math.round(width)+'px';
 menu.style.maxHeight='none';
 const above=a.top-gap-padding,below=vh-a.bottom-gap-padding;
 const natural=Math.max(122,menu.scrollHeight);
 const openAbove=above>below||below<Math.min(natural,180);
 const available=Math.max(90,openAbove?above:below);
 const height=Math.min(natural,available);
 menu.style.left=Math.round(clamp(a.right-width,padding,Math.max(padding,vw-width-padding)))+'px';
 menu.style.right='auto';menu.style.top=Math.round(openAbove?a.top-gap-height:a.bottom+gap)+'px';
 menu.style.maxHeight=Math.floor(available)+'px';
}
function renderQuickModelOptions(){
 const menu=$('composerModelMenu');if(!menu)return;menu.replaceChildren();
 const p=activeProvider(),catalog=modelCatalogByProvider.get(activeId)||[];
 if(!p){menu.append(el('div','composer-model-empty','请先添加一个中转站'));return}
 const caption=el('div','composer-model-heading');
 caption.append(el('span','',p.name+' · 生图模型'),el('span','composer-model-count',catalog.length?catalog.length+' 个模型':''));
 menu.append(caption);
 const grsaiExamples=p.mode==='grsai'?['nano-banana-2.1','nano-banana-2','nano-banana-pro']:[];
 const options=[...new Set([p.imageModel,...catalog,...grsaiExamples].filter(x=>typeof x==='string'&&x.trim()))];
 const q=quickModelQuery.trim().toLowerCase();
 const matching=q?options.filter(id=>id.toLowerCase().includes(q)):options;
 if(quickModelBusy){menu.append(el('div','composer-model-empty','正在获取当前中转站的模型列表…'))}
 else if(quickModelError){menu.append(el('div','composer-model-warn',quickModelError))}
 if(!matching.length&&!quickModelBusy)menu.append(el('div','composer-model-empty',q?'没有匹配的模型，可以继续手动输入模型 ID':'模型列表为空，可刷新列表或手动输入模型 ID'));
 for(const id of matching.slice(0,90)){
  const item=el('button','composer-model-option'+(id===$('imageModel').value?' selected':''));item.type='button';item.setAttribute('role','option');item.setAttribute('aria-selected',String(id===$('imageModel').value));item.title=id;
  item.append(el('span','composer-model-name',id));
  if(grsaiExamples.includes(id))item.append(el('small','composer-model-tag','示例 ID'));
  else if(id===p.imageModel)item.append(el('small','composer-model-tag','建议模型'));
  else if(id===$('imageModel').value)item.append(el('small','composer-model-tag','当前'));
  item.onclick=()=>{if(activeId!==p.id)return;$('imageModel').value=id;rememberQuickModel(id,p.id);closeQuickModelMenu();toast('已切换到 '+id+'，下次生图将使用这个模型')};
  menu.append(item);
 }
 if(matching.length>90)menu.append(el('div','composer-model-empty',`还有 ${matching.length-90} 个，请输入关键词筛选`));
 const footer=el('div','composer-model-footer');
 const refresh=el('button','composer-model-refresh','刷新模型列表');refresh.type='button';refresh.disabled=quickModelBusy;
 if(p.mode==='grsai'){refresh.disabled=true;refresh.textContent='Grsai 无公开模型列表';}
 refresh.onclick=()=>{quickModelQuery='';loadQuickModels(p.id,true)};
 const manage=el('button','composer-model-manage','管理中转站');manage.type='button';manage.onclick=()=>{closeQuickModelMenu();openSettings()};
 footer.append(refresh,manage);menu.append(footer);menu.dataset.activeIndex='-1';
 positionQuickModelMenu();
}
async function loadQuickModels(providerId=activeId,force=false){
 if(!providerId)return;
 if(providers.find(x=>x.id===providerId)?.mode==='grsai'){quickModelBusy=false;quickModelError='';if(quickModelOpened&&activeId===providerId)renderQuickModelOptions();return;}
 if(modelCatalogByProvider.has(providerId)&&!force){if(quickModelOpened&&activeId===providerId)renderQuickModelOptions();return}
 if(quickModelFetches.has(providerId))return quickModelFetches.get(providerId);
 const requestingAccountId=currentUser?.id;
 if(activeId===providerId){quickModelBusy=true;quickModelError='';renderQuickModelOptions()}
 const fetching=(async()=>{
  try{
   const payload=await api(`models?providerId=${encodeURIComponent(providerId)}`);
   if(currentUser?.id!==requestingAccountId)return;
   const raw=Array.isArray(payload.models)?payload.models:[];
   const ids=[...new Set(raw.map(m=>typeof m==='string'?m:m?.id).filter(id=>typeof id==='string'&&id.trim()).map(id=>id.trim()))];
   modelCatalogByProvider.set(providerId,ids);
   if(activeId===providerId)populateComposerModelSuggestions(providerId);
  }catch(e){if(currentUser?.id===requestingAccountId&&activeId===providerId)quickModelError='模型列表获取失败：'+e.message+'；仍可手动输入';}
  finally{quickModelFetches.delete(providerId);if(currentUser?.id===requestingAccountId&&activeId===providerId){quickModelBusy=false;if(quickModelOpened)renderQuickModelOptions()}}
 })();
 quickModelFetches.set(providerId,fetching);return fetching;
}
function openQuickModelMenu(search=''){
 if(!activeProvider())return openSettings(true);
 closeQuickProviderMenu();closeCanvasMenu();
 quickModelOpened=true;quickModelQuery=search;
 const menu=$('composerModelMenu');if(menu.parentNode!==document.body)document.body.append(menu);
 show('composerModelMenu');$('imageModel').setAttribute('aria-expanded','true');$('composerModelToggle').setAttribute('aria-expanded','true');
 renderQuickModelOptions();
 if(!modelCatalogByProvider.has(activeId))loadQuickModels(activeId);
}
function bindQuickModelPicker(){
 const field=$('imageModel'),arrow=$('composerModelToggle');
 arrow.onclick=()=>quickModelOpened?closeQuickModelMenu():openQuickModelMenu('');
 field.addEventListener('focus',()=>{if(!quickModelOpened)openQuickModelMenu('')});
 field.addEventListener('input',()=>{quickModelQuery=field.value;if(!quickModelOpened)openQuickModelMenu(quickModelQuery);else renderQuickModelOptions()});
 field.addEventListener('change',()=>rememberQuickModel(field.value.trim()));
 field.addEventListener('keydown',e=>{
  if(e.key==='Escape'){closeQuickModelMenu();return}
  if(!['ArrowDown','ArrowUp','Enter'].includes(e.key))return;
  if(!quickModelOpened&&e.key!=='Enter')openQuickModelMenu('');
  if(!quickModelOpened)return;
  const buttons=[...$('composerModelMenu').querySelectorAll('.composer-model-option')];
  if(e.key==='Enter'){const n=Number($('composerModelMenu').dataset.activeIndex||'-1');if(n>=0&&buttons[n]){e.preventDefault();buttons[n].click()}return}
  if(!buttons.length)return;
  e.preventDefault();const cur=Number($('composerModelMenu').dataset.activeIndex||'-1');
  const next=e.key==='ArrowDown'?Math.min(cur+1,buttons.length-1):Math.max(cur-1,0);
  buttons.forEach((btn,i)=>btn.classList.toggle('active',i===next));$('composerModelMenu').dataset.activeIndex=String(next);buttons[next].scrollIntoView({block:'nearest'});
 });
 document.addEventListener('pointerdown',e=>{if(!e.target.closest('#composerModelWrap,#composerModelMenu'))closeQuickModelMenu()});
}
function populateComposerModelSuggestions(providerId=activeId){
 if(typeof quickModelOpened!=='undefined'&&quickModelOpened&&providerId===activeId)renderQuickModelOptions();
 const datalist=$('modelSuggestions');datalist.replaceChildren();
 const pf=providers.find(x=>x.id===providerId);const examples=pf?.mode==='grsai'?['nano-banana-2.1','nano-banana-2','nano-banana-pro']:[];
 for(const id of [...new Set([...(modelCatalogByProvider.get(providerId)||[]),...examples])].slice(0,200)){
  const option=el('option');option.value=id;datalist.append(option);
 }
}
function closeSettingsModal(){if(draftProvider){draftProvider=false;editId=null;renderProviderCards()}hide('settingsModal')}
function openSettings(newRecord=false){if(newRecord)return selectEdit(null),show('settingsModal');if(draftProvider)draftProvider=false;selectEdit(editId||activeId);show('settingsModal')}
function renderProviderCards(){
 const root=$('providerList');root.replaceChildren();$('providerTotal').textContent=providers.length+(draftProvider?' + 1 临时':' 个');
 for(const p of providers){
  const btn=el('button','provider-card'+(p.id===editId?' active':''));btn.append(el('strong','',p.name),el('small','',(p.mode==='gemini'?'Gemini':'OpenAI')+' · '+p.imageModel));
  btn.onclick=()=>selectEdit(p.id);root.append(btn);
 }
 if(draftProvider){
  const card=el('div','provider-card provider-draft'+(!editId?' active':'')),label=el('div');
  label.append(el('strong','',$('pfName')?.value.trim()||'新中转站'),el('small','',''));
  label.lastChild.textContent='未保存 · 临时配置';
  const remove=el('button','provider-draft-cancel','×');remove.title='放弃临时中转站';remove.type='button';
  remove.onclick=()=>{draftProvider=false;selectEdit(activeId||providers[0]?.id||null);toast('未保存的中转站已取消')};
  card.append(label,remove);root.append(card);
 }
}
function updateDraftTestControls(){
 const saved=providers.find(p=>p.id===editId);
 const ready=!demoMode&&!!$('pfUrl').value.trim()&&!!($('pfKey').value.trim()||saved?.hasKey)&&!!$('pfMode').value;
 $('checkProvider').disabled=!ready;$('fetchModels').disabled=!ready;
}
function selectEdit(id){
 
 const p=providers.find(x=>x.id===id);
 editId=p?.id||null;draftProvider=!p;
 $('formTitle').textContent=p?'编辑中转站':'新中转站 · 未保存';
 $('pfName').value=p?.name||'';$('pfUrl').value=p?.url||'';$('pfMode').value=p?.mode||'openai';
 syncProviderMode();$('pfImageMode').value=p?.imageMode||($('pfMode').value==='grsai'?'grsai':'images');
 
 
 $('pfResponse').value=p?.responseModel||'';$('pfKey').value='';
 $('keyCaption').textContent=p?.hasKey?'（留空使用已保存 Key）':'';
 renderCapabilityEditor(p);
 $('deleteProvider').disabled=false;$('deleteProvider').textContent=p?'删除':'取消添加';
 $('activateProvider').disabled=!p||p.id===activeId;
 ['probeImage','probeEdit','probeReverse'].forEach(id=>$(id).disabled=!p||demoMode);
 $('checkResult').textContent='输入基础 URL、Key 和协议后，可直接测试连接和获取模型；不会自动保存，也不会付费生图。';
 hide('probePreview');syncResponses();renderProviderCards();updateDraftTestControls();
}
function closeSkillsMenu(){hide('skillsMenu');$('skillsToggle')?.setAttribute('aria-expanded','false')}
function initialRuntimeModel(p,cap){
 const explicit=p?.capabilities?.[cap]?.defaultModel;
 if(explicit)return explicit;
 if(cap==='vision')return p?.visionModel||'';
 return '';
}
function runtimeSelection(cap){
 const r=runtimeRoutes[cap],p=providers.find(x=>x.id===r?.providerId&&x.capabilities?.[cap]?.enabled!==false);
 return {providerId:p?.id||'',model:(r?.model||'').trim(),name:p?.name||''};
}
function updateRuntimeNotice(cap){
 const r=runtimeSelection(cap);
 if(cap==='text')$('textRouteStatus').textContent=r.model?'本次文字模型：'+r.model+' · 切换后直接生效，无需保存路由':'请选择或填写本次使用的文字模型';
 else{
  $('visionModelStatus').textContent=r.model?'本次使用：'+r.name+' / '+r.model+' · 不需要保存默认路由':'请选择或填写支持图片识别的模型';
  if($('reverseModal')&&!$('reverseModal').classList.contains('hidden'))$('reverseModel').textContent=r.model?'当前反推：'+r.name+' · '+r.model:'请选择服务商及视觉模型';
 }
}
function renderRuntimeSelectors(){
 for(const cap of ['text','vision']){
  const prefix=cap==='text'?'text':'vision',sel=$(prefix+'ProviderSelect'),input=$(prefix+'ModelInput'),r=runtimeRoutes[cap];
  if(!sel||!input)continue;
  const available=providers.filter(x=>x.capabilities?.[cap]?.enabled!==false);
  const p=available.find(x=>x.id===r.providerId)||available.find(x=>x.id===activeId)||available[0]||null;
  sel.replaceChildren();
  for(const entry of available)sel.add(new Option(entry.name,entry.id));
  if(!p)sel.add(new Option('请先添加可用中转站',''));
  sel.value=p?.id||'';
  if(r.providerId!==p?.id){
   r.providerId=p?.id||'';
   r.model=initialRuntimeModel(p,cap)||'';
  }
  input.value=r.model;updateRuntimeNotice(cap);
 }
}
function setRuntimeProvider(cap,id){
 const p=providers.find(x=>x.id===id&&x.capabilities?.[cap]?.enabled!==false);if(!p)return;
 const r=runtimeRoutes[cap];r.providerId=p.id;r.model=initialRuntimeModel(p,cap);
 const prefix=cap==='text'?'text':'vision';
 $(prefix+'ModelInput').value=r.model;$(prefix+'ModelsList').replaceChildren();updateRuntimeNotice(cap);
}
async function fetchRuntimeModels(cap,force=false){
 const r=runtimeSelection(cap);if(!r.providerId)return toast('先选择服务商');
 const prefix=cap==='text'?'text':'vision',btn=$(prefix+'FetchModels'),key=cap+'|'+r.providerId,accountId=currentUser?.id;
 btn.disabled=true;
 try{
  let models=runtimeCatalog.get(key);
  if(!models||force){
   const payload=await api('models?providerId='+encodeURIComponent(r.providerId)+'&capability='+cap);
   models=[...new Set((payload.models||[]).map(v=>typeof v==='string'?v:v?.id).filter(v=>typeof v==='string'&&v.trim()).map(v=>v.trim()))];
   if(currentUser?.id!==accountId)return;
   runtimeCatalog.set(key,models);
  }
  if(runtimeRoutes[cap].providerId!==r.providerId)return;
  const datalist=$(prefix+'ModelsList');datalist.replaceChildren();
  for(const model of models.slice(0,400)){const item=el('option');item.value=model;datalist.append(item)}
  if(cap==='text')$('textRouteStatus').textContent='已获取 '+models.length+' 个文字模型；点击输入框选择或手动填写，选择后立即生效。';
  else $('visionModelStatus').textContent='已获取 '+models.length+' 个模型；选择视觉模型后点击「开始反推」。';
  toast('已获取 '+models.length+' 个模型，无需保存路由');
 }catch(e){toast('获取模型失败：'+e.message);updateRuntimeNotice(cap)}
 finally{btn.disabled=false}
}
// V0.6.4 universal per-user capability routing: provider settings and request route are separate.
const ABILITY_META={text:'文字对话',image:'图片生成',vision:'图片反推',edit:'图片编辑 / 局部重绘'};
function renderCapabilityEditor(p){
 const root=$('capabilityEditor');root.replaceChildren();
 const order=['image','vision','text','edit'];
 for(const cap of order){
  const saved=p?.capabilities?.[cap]||{},advanced=cap==='edit';
  const wrap=el('div','capability-edit'+(advanced?' provider-edit-advanced':'')),head=el('div','capability-edit-head');
  const title=el('strong','',ABILITY_META[cap]),toggle=el('label','capability-toggle');
  const enabled=el('input');enabled.type='checkbox';enabled.checked=saved.enabled!==false;enabled.dataset.cap=cap;enabled.dataset.attr='enabled';
  toggle.append(enabled,document.createTextNode('启用'));head.append(title,toggle);
  const fields=el('div','capability-edit-fields');
  const reusable=saved.inheritBaseUrl!==false&&saved.inheritApiKey!==false&&saved.inheritProtocol!==false;
  if(!advanced){
   const checkbox=el('input');checkbox.type='checkbox';checkbox.checked=reusable;checkbox.dataset.cap=cap;checkbox.dataset.attr='reuseBaseInfo';
   const row=el('label','provider-reuse-switch');row.append(checkbox,document.createTextNode('复用基础信息'));
   head.append(row);wrap.append(head);
   const independent=el('div','provider-independent');
   for(const [attr,labelText,placeholder] of [['baseUrl','独立 API Base URL','https://api.example.com/v1'],['apiKey','独立 API Key','不填则使用已保存的独立 Key']]){
    const item=el('label','capability-field'),text=el('span','',labelText),input=el('input','field');
    input.dataset.cap=cap;input.dataset.attr=attr;input.placeholder=placeholder;input.autocomplete='off';
    if(attr==='apiKey'){input.type='password';input.placeholder=saved.hasKey?'已保存独立 Key（留空保留）':'独立 API Key';}
    else input.value=saved[attr]||'';
    item.append(text,input);independent.append(item);
   }
   const modeLabel=el('label','capability-field'),modeText=el('span','','独立协议'),mode=el('select','field');
   mode.dataset.cap=cap;mode.dataset.attr='mode';
   mode.add(new Option('OpenAI 兼容','openai'));mode.add(new Option('Gemini 原生','gemini'));mode.add(new Option('Grsai 图片 API','grsai'));
   mode.value=saved.mode||p?.mode||'openai';modeLabel.append(modeText,mode);independent.append(modeLabel);
   wrap.append(independent);
   const modelLabel=el('label','capability-field provider-cap-model'),labelText=el('span','','建议模型（可选；操作台实际选择优先）'),model=el('input','field');
   model.dataset.cap=cap;model.dataset.attr='defaultModel';model.placeholder=cap==='image'?'image-model':cap==='vision'?'vision-model':'text-model';
   model.value=saved.defaultModel||(cap==='image'?p?.imageModel:cap==='vision'?p?.visionModel:p?.capabilities?.text?.defaultModel)||'';
   const list=el('datalist');list.id='provider-cap-models-'+cap;model.setAttribute('list',list.id);
   modelLabel.append(labelText,model,list);wrap.append(modelLabel);
   checkbox.onchange=()=>{checkbox.dataset.touched='1';independent.classList.toggle('hidden',checkbox.checked)};
   independent.classList.toggle('hidden',checkbox.checked);
   const refresh=()=>wrap.classList.toggle('disabled-capability',!enabled.checked);
   enabled.onchange=refresh;refresh();
   root.append(wrap);
  }else{
   // Preserve the existing special edit/mask settings under a collapsible advanced section.
   wrap.append(head);
   for(const [attr,caption] of [['inheritBaseUrl','继承基础 API 地址'],['inheritApiKey','继承基础 API Key']]){
    const item=el('label','capability-toggle'),input=el('input');
    input.type='checkbox';input.checked=saved[attr]!==false;input.dataset.cap=cap;input.dataset.attr=attr;
    item.append(input,document.createTextNode(caption));fields.append(item);
   }
   for(const [attr,caption] of [['baseUrl','独立 API 地址'],['apiKey','独立 API Key'],['defaultModel','建议编辑模型（可选）']]){
    const item=el('label','capability-field'),input=el('input','field');
    input.dataset.cap=cap;input.dataset.attr=attr;input.placeholder=caption;input.autocomplete='off';
    if(attr==='apiKey'){input.type='password';input.placeholder=saved.hasKey?'已保存独立 Key（留空保留）':'独立 API Key';}
    else input.value=attr==='defaultModel'?(saved[attr]||p?.imageModel||''):(saved[attr]||'');
    item.append(el('span','',caption),input);fields.append(item);
   }
   wrap.append(fields);
   const details=el('details','provider-advanced-settings'),summary=el('summary','','高级设置 · 图片编辑 / 局部重绘');
   details.append(summary,wrap);root.append(details);
  }
 }
}
function collectCapabilityEditor(){
 const root=$('capabilityEditor'),get=(cap,attr)=>root.querySelector('[data-cap="'+cap+'"][data-attr="'+attr+'"]'),caps={};
 const current=providers.find(p=>p.id===editId);
 for(const cap of ['image','vision','text','edit']){
  const enabled=get(cap,'enabled'),saved=current?.capabilities?.[cap]||{},model=get(cap,'defaultModel')?.value.trim()||'';
  if(cap==='edit'){
   caps[cap]={enabled:enabled?.checked!==false,inheritBaseUrl:get(cap,'inheritBaseUrl').checked,inheritApiKey:get(cap,'inheritApiKey').checked,baseUrl:get(cap,'baseUrl').value.trim(),apiKey:get(cap,'apiKey').value.trim(),defaultModel:model};
  }else{
   const reuse=get(cap,'reuseBaseInfo'),touched=reuse.dataset.touched==='1';
   caps[cap]={enabled:enabled?.checked!==false,
    inheritBaseUrl:touched?reuse.checked:(saved.inheritBaseUrl!==false),
    inheritApiKey:touched?reuse.checked:(saved.inheritApiKey!==false),
    inheritProtocol:touched?reuse.checked:(saved.inheritProtocol!==false),
    baseUrl:get(cap,'baseUrl').value.trim(),apiKey:get(cap,'apiKey').value.trim(),
    mode:get(cap,'mode').value,defaultModel:model};
  }
 }
 return caps;
}
function arrangeStudioLayout(){
 const panel=$('assistantPanel'),zone=panel?.querySelector('.composer-zone'),models=zone?.querySelector('.model-config')||panel?.querySelector('.model-config');
 if(!panel||!zone||!models)return;
 panel.classList.add('lovart-inspired-panel');
 const scroll=el('div','studio-config-scroll');scroll.id='studioConfigScroll';
 const modelCard=el('section','studio-model-card');
 let heading=$('studioModelHeading');
 if(!heading){heading=el('div','studio-panel-heading');heading.id='studioModelHeading'}
 heading.innerHTML='<span class="studio-heading-left"><svg class="icon"><use href="#ic-spark"/></svg> 模型选择</span><button type="button" id="studioEditRoutes">管理模型 <svg class="icon sm"><use href="#ic-arrow"/></svg></button>';
 heading.querySelector('button').onclick=()=>openSettings();
 modelCard.append(heading);
 const modelRow=models.querySelector('.model-row'),modelSelect=modelRow?.querySelector('.model-select'),modelWrap=$('composerModelWrap');
 if(modelRow&&modelSelect&&modelWrap){
  const primary=el('div','studio-primary-model'),visual=el('div','studio-model-visual'),detail=el('div','studio-model-detail'),
    kicker=el('span','studio-model-kicker','当前生图模型'),description=el('span','studio-model-description','高质量图像生成 · 可自由切换模型');
  visual.innerHTML='<svg class="icon"><use href="#ic-spark"/></svg>';
  detail.append(kicker,modelWrap,description);
  primary.append(visual,detail);
  modelRow.insertBefore(primary,modelRow.firstChild);
  const provider=el('div','studio-provider-line'),tag=el('span','studio-provider-tag','服务商');
  provider.append(tag,modelSelect);
  modelRow.insertBefore(provider,primary);
 }
 modelCard.append(models);
 scroll.append(modelCard);
 const mode=zone.querySelector('.capability-switcher');if(mode)scroll.append(mode);
 const textBox=$('textRouteBox');if(textBox)scroll.append(textBox);
 const refCard=el('section','studio-reference-card'),refHead=el('div','studio-section-heading'),
       refName=el('div','studio-section-name'),refIcon=el('span','studio-section-icon');
 refIcon.innerHTML='<svg class="icon"><use href="#ic-image"/></svg>';
 refName.append(refIcon,el('strong','','参考图'),el('span','studio-ref-count','0 / 8'));
 const role=$('studioReferenceRole')||el('select','studio-ref-role');
 role.id='studioReferenceRole';role.setAttribute('aria-label','统一设置画布参考图的用途');
 if(!role.options.length){for(const [val,label] of ROLE_OPTIONS)role.add(new Option(label,val));role.value='general'}
 role.onchange=()=>{for(const item of referenceNodeRoles)item.role=role.value;renderContext()};
 refHead.append(refName,role);refCard.append(refHead);
 const add=$('attachRef'),addArea=el('div','studio-add-ref');
 add.classList.add('studio-add-ref-button');
 add.innerHTML='<span class="studio-plus-icon">＋</span><span class="studio-add-ref-text"><strong>添加参考图</strong><small>支持多张，自动综合参考</small></span>';
 addArea.append(add);refCard.append(addArea);
 for(const id of ['contextStrip','refStrip','referenceTip']){const child=$(id);if(child)refCard.append(child)}
 scroll.append(refCard);
 const extra=el('div','studio-quick-tools'),intro=zone.querySelector('.composer-intro'),skills=zone.querySelector('.skill-grid');
 if(intro)extra.append(intro);
 if(skills){skills.classList.add('studio-skill-cards');extra.append(skills)}
 scroll.append(extra);
 const layer=el('details','studio-layer-card');layer.id='studioLayers';layer.open=true;
 layer.innerHTML='<summary><span class="studio-section-name"><span class="studio-section-icon"><svg class="icon"><use href="#ic-layers"/></svg></span><strong>图层管理</strong></span><span class="studio-detail-arrow">展开 <svg class="icon sm"><use href="#ic-chevron"/></svg></span></summary><div id="studioLayerChips" class="studio-layer-chips"></div>';
 scroll.append(layer);
 const details=el('details','studio-advanced-card');details.id='studioAdvanced';
 details.innerHTML='<summary><span class="studio-section-name"><span class="studio-section-icon"><svg class="icon"><use href="#ic-settings"/></svg></span><strong>高级设置</strong><small>（可选）</small></span><svg class="icon sm"><use href="#ic-chevron"/></svg></summary>';
 const advanced=models.querySelector('#advanced');
 if(advanced){advanced.classList.remove('hidden');details.append(advanced)}
 const more=models.querySelector('#moreSettings');if(more){more.hidden=true;more.tabIndex=-1}
 scroll.append(details);
 const activity=el('details','studio-activity');activity.id='studioActivity';
 activity.innerHTML='<summary>创作记录与对话 <svg class="icon sm"><use href="#ic-chevron"/></svg></summary>';
 const conversation=$('conversation');if(conversation)activity.append(conversation);
 scroll.append(activity);
 panel.insertBefore(scroll,zone);
 zone.classList.add('studio-prompt-dock');
 const prompt=zone.querySelector('.composer');if(prompt)prompt.classList.add('studio-prompt-card');
 const instruction=zone.querySelector('.composer-instruction');
 if(instruction){instruction.className='studio-prompt-hint';instruction.textContent='Ctrl + Enter 发送'}
 const button=$('generateBtn');if(button){button.classList.add('studio-send-button');button.innerHTML='<svg class="icon"><use href="#ic-arrow"/></svg><span id="sendButtonLabel">开始生成</span>'}
 // Panel type/mode controls are moved rather than cloned; all API/model event bindings still target original IDs.
 const subtitle=$('assistantDescription');if(subtitle)subtitle.textContent='让灵感变成现实，支持 AI 绘图 · 文字对话';
 renderStudioLayerChips();
}
function renderStudioLayerChips(){
 const host=$('studioLayerChips');if(!host)return;
 host.replaceChildren();
 const all=currentProject?.nodes?.filter(n=>n.kind!=='note')||[],selected=all.filter(n=>multiNodeIds.has(n.id));
 const visible=(selected.length?selected:all.slice(-4)).slice(0,8);
 if(!visible.length){host.append(el('p','studio-layer-empty','画布中的图片将显示在这里，点击可定位选择'));return}
 for(const [i,n] of visible.entries()){
  const chip=el('div','studio-layer-chip'),btn=el('button','studio-layer-select');
  btn.type='button';const image=el('img');putPreview(image,nodeImage(n),previewImage(n));image.alt='';
  btn.append(image,el('span','',(n.title|| (n.kind==='reference'?'参考图层':'图层 '+(i+1))).slice(0,18)));
  btn.onclick=()=>{selectNode(n.id);$('studioLayers').open=true};
  const remove=el('button','studio-layer-remove','×');remove.type='button';remove.title='从画布移除（需确认）';remove.onclick=()=>removeNode(n);
  chip.append(btn,remove);host.append(chip)
 }
}
function setComposerMode(mode){
 composerMode=mode==='text'?'text':'image';
 $('imageModeToggle').classList.toggle('active',composerMode==='image');
 $('textModeToggle').classList.toggle('active',composerMode==='text');
 $('prompt').placeholder=composerMode==='text'?'继续追问… 会参考此项目最近的文字对话':'描述你的创意，也可以选中画布图片继续修改。';
 $('generateBtn').title=composerMode==='text'?'发送文字对话':'提交图片生成任务';$('sendButtonLabel').textContent=composerMode==='text'?'发送消息':'开始生成';
 $('assistantDescription').textContent=composerMode==='text'?'连续对话 · 记住当前项目上下文':'图片生成 · 独立图片 API';
 document.querySelector('.model-config')?.classList.toggle('hidden',composerMode==='text');
 $('textRouteBox').classList.toggle('hidden',composerMode!=='text');
 const activity=$('studioActivity');if(activity&&composerMode==='text')activity.open=true;
 const panel=$('assistantPanel');panel.classList.toggle('studio-text-mode',composerMode==='text');
 for(const selector of ['.studio-model-card','.studio-reference-card','.studio-advanced-card']){
  panel.querySelector(selector)?.classList.toggle('hidden',composerMode==='text');
 }
 if(composerMode==='text')renderRuntimeSelectors();
}
function addLiveTextMessage(prompt,provider){
 const panel=$('conversation'),line=el('div','chat-item assistant live-text-response');
 const from=el('div','chat-from');from.innerHTML=ico('spark');from.append(document.createTextNode(' Hamoki · '+provider+' · 文字回复中'));
 const bubble=el('div','chat-bubble text-stream-bubble','正在连接文字模型…');bubble.setAttribute('aria-live','polite');
 const cursor=el('span','text-stream-cursor');cursor.setAttribute('aria-hidden','true');bubble.append(cursor);
 const footer=el('div','text-stream-footer'),clock=el('span','micro muted','准备发送…');
 const stop=el('button','text-stream-stop','停止生成');stop.type='button';stop.onclick=()=>textChatController?.abort();
 footer.append(clock,stop);line.append(from,bubble,footer);
 panel.append(el('div','chat-item user', ''),line);
 const user=panel.children[panel.children.length-2];
 const uf=el('div','chat-from','我');user.append(uf,el('div','chat-bubble',prompt));
 panel.scrollTop=panel.scrollHeight;
 return {panel,bubble,cursor,clock,stop};
}
async function submitTextChat(){
 const prompt=$('prompt').value.trim(),binding=runtimeSelection('text');
 if(textChatBusy)return toast('文字模型正在回复，请等待或先停止生成');
 if(!prompt)return toast('请先输入文字内容');
 if(!currentProject?.id)return toast('请先打开项目');
 if(!binding.providerId||!binding.model)return toast('请在操作台选择文字服务商和模型');
 if(!confirm('即将调用文字模型 '+binding.model+'（支持项目内多轮对话），可能产生 API 费用。确认发送？'))return;
 const targetId=currentProject.id;const controller=new AbortController();
 textChatBusy=true;textChatController=controller;textChatProjectId=targetId;
 const button=$('generateBtn');button.disabled=true;
 const live=addLiveTextMessage(prompt,binding.name||binding.model);const start=Date.now();let answer='',done=false,errored=false;
 const timer=setInterval(()=>{live.clock.textContent='模型回复中 · '+Math.floor((Date.now()-start)/1000)+' 秒'},1000);
 try{
  const response=await fetch(APP_BASE+'/api/chat/stream',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,projectId:targetId,providerId:binding.providerId,model:binding.model}),signal:controller.signal});
  if(!response.ok){let reason;try{reason=(await response.json()).error}catch{}throw Error(reason||'请求失败 HTTP '+response.status)}
  if(!response.body)throw Error('浏览器不支持流式接收');
  const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
  const event=(raw)=>{
   let kind='',data='';for(const part of raw.split(/\r?\n/)){if(part.startsWith('event:'))kind=part.slice(6).trim();if(part.startsWith('data:'))data+=part.slice(5).trimStart()}
   if(!data)return;let result;try{result=JSON.parse(data)}catch{return}
   if(kind==='delta'&&typeof result.text==='string'){answer+=result.text;live.bubble.firstChild?.nodeType===3?live.bubble.firstChild.textContent=answer:live.bubble.prepend(document.createTextNode(answer));live.panel.scrollTop=live.panel.scrollHeight}
   if(kind==='done')done=true;
   if(kind==='error'){errored=true;throw Error(result.error||'流式请求失败')}
  };
  while(true){const {done:end,value}=await reader.read();if(end)break;pending+=decoder.decode(value,{stream:true});let match;while((match=/\r?\n\r?\n/.exec(pending))){const item=pending.slice(0,match.index);pending=pending.slice(match.index+match[0].length);event(item)}}
  if(pending.trim())event(pending);
  if(!done||errored)throw Error('连接提前断开，回复未保存；请检查日志后再试，避免重复扣费');
  $('prompt').value='';live.clock.textContent='回复完成 · '+Math.ceil((Date.now()-start)/1000)+' 秒';
 }catch(error){
  live.clock.textContent=controller.signal.aborted?'已停止（上游可能已计费）':'回复失败';
  if(!answer){live.bubble.firstChild?.nodeType===3?live.bubble.firstChild.textContent='没有保存回复':live.bubble.prepend(document.createTextNode('没有保存回复'))}
  toast((controller.signal.aborted?'已停止文字生成':'文字对话失败')+'：'+(error?.message||'未知错误'));
 }finally{
  clearInterval(timer);live.cursor.remove();live.stop.remove();textChatBusy=false;textChatController=null;textChatProjectId=null;button.disabled=false;
  if(currentProject?.id===targetId)await refreshProjectData();
 }
}

function syncProviderMode(){const mode=$('pfMode').value;const sel=$('pfImageMode');sel.replaceChildren();const modes=mode==='gemini'?[['gemini','Gemini generateContent']]:mode==='grsai'?[['grsai','Grsai /v1/api/generate']]:[['images','Images API'],['chat','Chat Completions'],['responses','Responses 工具']];for(const [v,label] of modes)sel.add(new Option(label,v));syncResponses()}
function syncResponses(){$('responseModelRow').classList.toggle('hidden',$('pfImageMode').value!=='responses')}
function formProvider(){const capabilities=collectCapabilityEditor();return{name:$('pfName').value.trim(),url:$('pfUrl').value.trim(),mode:$('pfMode').value,imageMode:$('pfImageMode').value,imageModel:capabilities.image?.defaultModel||'',visionModel:capabilities.vision?.defaultModel||'',responseModel:$('pfResponse').value.trim(),apiKey:$('pfKey').value.trim(),capabilities}}
async function saveProvider(){
 const body=formProvider();
 if(!body.name||!body.url)return toast('请填写名称和基础 API 地址');
 // API connection can be saved without a model; runtime operator selects model at execution time.
 try{
  const path=editId?'providers/'+editId:'providers';
  const r=await api(path,{method:editId?'PUT':'POST',body});
  editId=r.provider.id;draftProvider=false;
  await loadProviders();selectEdit(editId);
  toast('中转站已保存，模型可以在操作台随时选择');
 }catch(e){toast(e.message)}
}
async function deleteProvider(){if(draftProvider){draftProvider=false;selectEdit(activeId||providers[0]?.id||null);toast('未保存配置已放弃');return}if(!editId)return;if(!confirm('真的删除这个中转站吗？密钥将从服务端配置中移除。'))return;try{modelCatalogByProvider.delete(editId);forgetQuickModel(editId);closeQuickModelMenu();await api(`providers/${editId}`,{method:'DELETE',body:{}});editId=null;await loadProviders();selectEdit(null);toast('中转站已删除')}catch(e){toast(e.message)}}
function draftTestPayload(capability='image',baseOnly=true){return {...formProvider(),savedId:editId||null,capability,baseOnly}}
function showModelsForCurrentForm(models){
 for(const cap of ['image','vision','text']){
  const target=document.getElementById('provider-cap-models-'+cap);if(!target)continue;
  target.replaceChildren();
  for(const id of models.slice(0,300)){const item=el('option');item.value=id;target.append(item)}
 }
}
async function connectionCheck(){
 const result=$('checkResult'),data=draftTestPayload('image',true),stamp=JSON.stringify(data);
 result.textContent='正在验证当前表单（未保存的 URL 与 Key 也会用于本次测试）…';
 $('checkProvider').disabled=true;
 try{
  const info=await api('providers/draft/check',{method:'POST',body:data});
  if(JSON.stringify(draftTestPayload('image',true))!==stamp)return;
  result.textContent=info.reachable?'连接成功：模型列表可用（'+(info.models?.length||0)+' 个），耗时 '+info.latencyMs+'ms。'+info.notice:
   '当前接口的 /models 检测未通过：'+(info.error||'无法读取模型列表')+'。'+info.notice;
 }catch(e){if(JSON.stringify(draftTestPayload('image',true))===stamp)result.textContent='连接检查失败：'+e.message}
 finally{updateDraftTestControls()}
}
async function probeProvider(kind){
 if(!editId)return;
 if(demoMode)return toast('共享测试站禁止真实 API 调用');
 if(!confirm(`确认使用 ${providers.find(p=>p.id===editId)?.name||'当前中转站'} 真正调用一次 ${kind==='reverse'?'图片反推':kind==='edit'?'参考图生图':'文生图'} 接口？这可能扣费。`))return;
 const btn=kind==='reverse'?$('probeReverse'):kind==='edit'?$('probeEdit'):$('probeImage');btn.disabled=true;$('checkResult').textContent='正在真实请求中转站，可能需要数十秒…';
 try{const r=await api(`providers/${editId}/probe`,{method:'POST',body:{kind,confirmCost:true}});
 $('checkResult').textContent=(r.success?'实测成功':'实测失败')+` · 耗时 ${r.latencyMs}ms · ${r.summary||r.error||''}`;
 if(r.previewUrl){$('probePreview').src=r.previewUrl;show('probePreview')};await loadProviders();
 }catch(e){$('checkResult').textContent='请求失败：'+e.message}finally{btn.disabled=false}
}
async function fetchModels(){
 const data=draftTestPayload('image',true),stamp=JSON.stringify(data),button=$('fetchModels');
 button.disabled=true;
 try{
  const r=await api('providers/draft/models',{method:'POST',body:data});
  if(JSON.stringify(draftTestPayload('image',true))!==stamp)return;
  const ids=[...new Set((r.models||[]).map(m=>typeof m==='string'?m:m?.id).filter(m=>typeof m==='string'&&m.trim()).map(m=>m.trim()))];
  showModelsForCurrentForm(ids);
  if(editId&&ids.length){modelCatalogByProvider.set(editId,ids);if(editId===activeId)populateComposerModelSuggestions(editId)}
  $('checkResult').textContent=r.reachable?'已获取 '+ids.length+' 个模型。可以在下方各功能的模型框中选择，保存前不会生效。':
    '无法获取模型：'+(r.error||'模型列表不可用')+'。'+r.notice+' 可手动填写模型 ID。';
  toast(r.reachable?'获取模型成功，尚未保存配置':'模型列表不可用，仍可手动填写');
 }catch(e){if(JSON.stringify(draftTestPayload('image',true))===stamp)$('checkResult').textContent='获取模型失败：'+e.message}
 finally{updateDraftTestControls()}
}
function showCompare(){if(!providers.length)return openSettings(true);compareSelection.clear();const div=$('compareOptions');div.replaceChildren();for(const p of providers){const row=el('label','compare-item'),check=el('input');check.type='checkbox';check.disabled=!p.hasKey&&!demoMode;check.value=p.id;const info=el('div');info.append(el('strong','',p.name),el('small','',p.imageMode+' · '+(p.hasKey?'已配置':'未配置 API Key')));const model=el('input','field');model.type='text';model.value=(p.id===activeId?$('imageModel').value.trim():quickModelPrefs.get(p.id))||p.imageModel;model.dataset.forProvider=p.id;model.setAttribute('aria-label',p.name+' 生图模型');check.onchange=()=>{if(check.checked){compareSelection.add(p.id);if(compareSelection.size>2){compareSelection.delete(p.id);check.checked=false;toast('一次最多选择 2 个中转站')}}else compareSelection.delete(p.id)};row.append(check,info,model);div.append(row)}show('compareModal')}
function submitCompare(){if(compareSelection.size<2)return toast('至少选择 2 个中转站');const targets=[...compareSelection].map(providerId=>({providerId,model:document.querySelector(`[data-for-provider="${providerId}"]`).value.trim()}));submitGeneration(targets)}
async function favorite(id,val){try{const r=await api(`history/${id}/favorite`,{method:'POST',body:{favorite:val}});const h=currentHistory(id);if(h)h.favorite=r.image.favorite;renderLibrary();if(viewerId===id)$('favViewer').textContent=h.favorite?'♥ 已收藏':'♡ 收藏';toast(h?.favorite?'已加入收藏':'已取消收藏')}catch(e){toast(e.message)}}
function openViewer(id){const h=currentHistory(id);if(!h)return toast('找不到图片历史');viewerId=id;$('viewerImg').src=h.url;$('viewerPrompt').textContent=h.prompt;$('downloadViewer').href=`${APP_BASE}/api/download/${h.id}`;$('favViewer').textContent=h.favorite?'♥ 已收藏':'♡ 收藏';const area=$('viewerMeta');area.replaceChildren();for(const [k,v] of [['模型',h.model],['服务商',h.providerName],['生成时间',humanDate(h.createdAt)],['版本',h.parentId?'衍生版本':'原始版本'],['比例',h.ratio],['耗时',h.durationMs?Math.round(h.durationMs/1000)+' 秒':'—']]){const box=el('div');box.append(el('small','',k),el('span','',v));area.append(box)}const p=activeProvider();$('inpaintBtn').disabled=!(p?.mode==='openai'&&p?.imageMode==='images'&&p?.capabilities?.edit?.enabled!==false);renderVersions(h);show('viewerModal')}
function renderVersions(h){const box=$('versionList');box.replaceChildren();const ids=new Set([h.id]),pool=[h.id];for(let depth=0;depth<5;depth++){const batch=pool.splice(0);for(const id of batch){const current=currentHistory(id);if(current?.parentId&&!ids.has(current.parentId)){ids.add(current.parentId);pool.push(current.parentId)}for(const child of historyItems.filter(x=>x.parentId===id)){if(!ids.has(child.id)){ids.add(child.id);pool.push(child.id)}}}if(!pool.length)break}
 const versions=historyItems.filter(x=>ids.has(x.id)).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));for(const [i,v] of versions.entries()){const btn=el('button','version-thumb'+(v.id===h.id?' active':''));const im=el('img');putPreview(im,v.url,v.previewUrl);im.alt=v.prompt;btn.append(im,el('small','',v.id===h.id?'当前':v.parentId?'分支 '+(i+1):'原图'));btn.onclick=()=>openViewer(v.id);box.append(btn)}}
function openLibrary(tab='history'){selectedTab=tab;document.querySelectorAll('[data-library]').forEach(b=>b.classList.toggle('active',b.dataset.library===selectedTab));renderLibrary();show('libraryModal')}
function renderLibrary(){const root=$('libraryItems');if(!root)return;root.replaceChildren();document.querySelectorAll('[data-library]').forEach(b=>b.classList.toggle('active',b.dataset.library===selectedTab));$('pauseBtn').textContent=paused?'▶ 恢复队列':'Ⅱ 暂停队列';$('librarySearch').classList.toggle('hidden',selectedTab==='queue');const q=$('librarySearch').value.trim().toLowerCase();if(selectedTab==='queue'){const list=el('div','queue-list');for(const j of jobs){const row=el('div','queue-row'),status=el('span','queue-status '+j.status,statusLabel(j.status)),info=el('div','queue-row-info');info.append(el('b','',j.prompt||'生图任务'),el('small','',j.providerName+' · '+j.model+(j.error?' · '+j.error:'')));row.append(status,info);if(['failed','cancelled','interrupted'].includes(j.status)){const retry=el('button','soft-btn','用当前模型重试');retry.onclick=()=>retryJob(j.id);row.append(retry)}if(['queued','running'].includes(j.status)){const cancel=el('button','soft-btn','取消');cancel.onclick=()=>cancelJob(j.id);row.append(cancel)}list.append(row)}if(!jobs.length)list.append(el('p','muted','还没有生图任务。'));root.append(list);return}
 const images=historyItems.filter(h=>(selectedTab!=='favorites'||h.favorite)&&(!q||[h.model,h.prompt,h.providerName].some(x=>x?.toLowerCase().includes(q))));const grid=el('div','library-grid');for(const h of images){const card=el('div','library-card'),im=el('img');putPreview(im,h.url,h.previewUrl);im.alt=h.prompt;im.onclick=()=>{hide('libraryModal');focusImage(h.id)};const text=el('div','library-meta');text.append(el('strong','',h.prompt),el('small','',h.model+' · '+humanDate(h.createdAt)));const buttons=el('div','library-actions');const detail=el('button','soft-btn','详情'),reuse=el('button','soft-btn','继续创作');detail.onclick=()=>openViewer(h.id);reuse.onclick=()=>{hide('libraryModal');continueFrom(h.id)};buttons.append(detail,reuse);text.append(buttons);card.append(im,text);grid.append(card)}if(!images.length)grid.append(el('p','muted','这里还没有作品。'));root.append(grid)}
function statusLabel(s){return({queued:'排队中',running:'生成中',done:'已完成',failed:'生成失败',interrupted:'已中断',cancelled:'已取消'})[s]||s}
async function toggleQueue(){try{await api('queue',{method:'POST',body:{action:paused?'resume':'pause'}});paused=!paused;updateStats();renderLibrary();toast(paused?'队列已暂停，正在运行中的任务不会中断':'队列已恢复')}catch(e){toast(e.message)}}
async function cancelJob(id){if(!confirm('取消任务可能仍产生上游费用，确定吗？'))return;try{await api(`jobs/${id}/cancel`,{method:'POST',body:{}});await refreshProjectData()}catch(e){toast(e.message)}}
async function retryJob(id){const previous=jobs.find(j=>j.id===id),p=activeProvider(),model=$('imageModel').value.trim();if(!p||!model)return toast('请先选择本次重试使用的服务商和生图模型');if(!confirm(`使用当前选择重试：${p.name} / ${model}\n原任务：${previous?.providerName||'未知'} / ${previous?.model||'未知'}\n这会再次请求上游并可能扣费，确认吗？`))return;try{await api(`jobs/${id}/retry`,{method:'POST',body:{providerId:p.id,model}});await refreshProjectData();toast('已按当前选择重新入队')}catch(e){toast(e.message)}}
function showFromLibrary(){const id=viewerId;hide('viewerModal');continueFrom(id)}
// Existing mask mechanics from V0.3: an opaque mask where painted pixels become transparent.
async function openMask(id){const h=currentHistory(id);if(!h)return;const p=activeProvider();if(p?.mode!=='openai'||p?.imageMode!=='images'||p?.capabilities?.edit?.enabled===false)return toast('请配置支持蒙版编辑的 Images Edits 服务商');maskSourceId=h.id;maskMarked=0;maskErase=false;maskSetTool(false);show('maskModal');const im=$('maskImg');im.onload=()=>{const c=$('maskCanvas');c.width=im.naturalWidth;c.height=im.naturalHeight;c.style.width=im.getBoundingClientRect().width+'px';c.style.height=im.getBoundingClientRect().height+'px';maskCanvasRaw=document.createElement('canvas');maskCanvasRaw.width=c.width;maskCanvasRaw.height=c.height;repaintMask=maskCanvasRaw.getContext('2d');visualMask=c.getContext('2d');resetMask()};im.src=h.url}
function maskSetTool(eraser){maskErase=eraser;$('paintTool').classList.toggle('active',!eraser);$('eraseTool').classList.toggle('active',eraser)}
function resetMask(){if(!repaintMask||!visualMask)return;repaintMask.globalCompositeOperation='source-over';repaintMask.fillStyle='rgba(0,0,0,1)';repaintMask.fillRect(0,0,maskCanvasRaw.width,maskCanvasRaw.height);visualMask.clearRect(0,0,$('maskCanvas').width,$('maskCanvas').height);maskMarked=0}
function maskPoint(e){const c=$('maskCanvas'),r=c.getBoundingClientRect();return{x:(e.clientX-r.left)*c.width/r.width,y:(e.clientY-r.top)*c.height/r.height}}
function paintMask(a,b){const width=Number($('brushSize').value);repaintMask.globalCompositeOperation=maskErase?'source-over':'destination-out';repaintMask.strokeStyle='#000';repaintMask.lineWidth=width;repaintMask.lineCap='round';repaintMask.lineJoin='round';repaintMask.beginPath();repaintMask.moveTo(a.x,a.y);repaintMask.lineTo(b.x,b.y);repaintMask.stroke();visualMask.globalCompositeOperation=maskErase?'destination-out':'source-over';visualMask.strokeStyle='rgba(255,170,88,.67)';visualMask.lineWidth=width;visualMask.lineCap='round';visualMask.lineJoin='round';visualMask.beginPath();visualMask.moveTo(a.x,a.y);visualMask.lineTo(b.x,b.y);visualMask.stroke();maskMarked++}
function acceptMask(){if(!maskMarked)return toast('先用画笔涂抹想修改的区域');sourceId=maskSourceId;sourceNodeId=currentProject.nodes.find(n=>n.historyId===sourceId)?.id||null;maskData=maskCanvasRaw.toDataURL('image/png');const sourceCanvas=document.createElement('canvas');sourceCanvas.width=$('maskImg').naturalWidth;sourceCanvas.height=$('maskImg').naturalHeight;sourceCanvas.getContext('2d').drawImage($('maskImg'),0,0);maskSourcePng=sourceCanvas.toDataURL('image/png');hide('maskModal');hide('viewerModal');renderContext();if(innerWidth<850)$('assistantPanel').classList.add('open');$('prompt').focus();toast('局部选区已保存。输入修改描述后提交生图')}
// Non-AI pixel editor. The original source is immutable; applying saves a new reference node.
function canvasClone(source){const c=document.createElement('canvas');c.width=source.width;c.height=source.height;c.getContext('2d').drawImage(source,0,0);return c}
function renderLocalImage(){if(!imageEditCanvas)return;const view=$('localPreview');view.width=imageEditCanvas.width;view.height=imageEditCanvas.height;const ctx=view.getContext('2d');ctx.drawImage(imageEditCanvas,0,0);$('localDimensions').textContent=`${view.width} × ${view.height} px`;if(document.activeElement!==$('localWidth'))$('localWidth').value=view.width;if(document.activeElement!==$('localHeight'))$('localHeight').value=view.height;
 if(imageEditCrop&&imageEditCrop.w>1&&imageEditCrop.h>1){ctx.save();ctx.strokeStyle='#fdab64';ctx.fillStyle='rgba(247,174,109,.12)';ctx.lineWidth=Math.max(2,Math.min(view.width,view.height)/350);ctx.setLineDash([10,7]);ctx.fillRect(imageEditCrop.x,imageEditCrop.y,imageEditCrop.w,imageEditCrop.h);ctx.strokeRect(imageEditCrop.x,imageEditCrop.y,imageEditCrop.w,imageEditCrop.h);ctx.restore()}
}
async function openLocalImageEditor(node){if(!currentProject||!node||node.kind==='note')return;imageEditingSource=node;imageEditDrag=imageEditCrop=null;show('localEditModal');const img=new Image();const url=nodeImage(node);try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('源图加载失败'));img.src=url});const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.getContext('2d').drawImage(img,0,0);imageEditOriginal=canvas;imageEditCanvas=canvasClone(canvas);renderLocalImage()}catch(e){hide('localEditModal');toast(e.message)}}
function onLocalCropStart(e){if(!imageEditCanvas)return;e.preventDefault();const rect=$('localPreview').getBoundingClientRect();const x=clamp((e.clientX-rect.left)*imageEditCanvas.width/rect.width,0,imageEditCanvas.width),y=clamp((e.clientY-rect.top)*imageEditCanvas.height/rect.height,0,imageEditCanvas.height);imageEditDrag={x,y};imageEditCrop={x,y,w:0,h:0};$('localPreview').setPointerCapture(e.pointerId)}
function onLocalCropMove(e){if(!imageEditDrag||!imageEditCanvas)return;const rect=$('localPreview').getBoundingClientRect(),x=clamp((e.clientX-rect.left)*imageEditCanvas.width/rect.width,0,imageEditCanvas.width),y=clamp((e.clientY-rect.top)*imageEditCanvas.height/rect.height,0,imageEditCanvas.height);imageEditCrop={x:Math.round(Math.min(imageEditDrag.x,x)),y:Math.round(Math.min(imageEditDrag.y,y)),w:Math.round(Math.abs(x-imageEditDrag.x)),h:Math.round(Math.abs(y-imageEditDrag.y))};renderLocalImage()}
function onLocalCropEnd(e){if(!imageEditDrag)return;onLocalCropMove(e);imageEditDrag=null}
function localImageAction(action){const source=imageEditCanvas;if(!source)return;const next=document.createElement('canvas'),ctx=next.getContext('2d');
 if(action==='reset'){imageEditCanvas=canvasClone(imageEditOriginal);imageEditCrop=null;return renderLocalImage()}
 if(action==='rotateLeft'||action==='rotateRight'){next.width=source.height;next.height=source.width;ctx.translate(next.width/2,next.height/2);ctx.rotate(action==='rotateLeft'?-Math.PI/2:Math.PI/2);ctx.drawImage(source,-source.width/2,-source.height/2)}
 else if(action==='flip'){next.width=source.width;next.height=source.height;ctx.translate(next.width,0);ctx.scale(-1,1);ctx.drawImage(source,0,0)}
 else if(action==='resize'){const width=Number($('localWidth').value),height=Number($('localHeight').value);if(!Number.isInteger(width)||!Number.isInteger(height)||width<16||width>8192||height<16||height>8192||width*height>24e6)return toast('输出尺寸须在16–8192像素之间，且总像素不能超过2400万');next.width=width;next.height=height;ctx.imageSmoothingQuality='high';ctx.drawImage(source,0,0,width,height)}
 else if(action==='crop'){const crop=imageEditCrop;if(!crop||crop.w<8||crop.h<8)return toast('请先在图片上拖动鼠标框选至少 8×8 像素的裁切区域');next.width=crop.w;next.height=crop.h;ctx.drawImage(source,crop.x,crop.y,crop.w,crop.h,0,0,crop.w,crop.h)}
 else if(action==='trim'){const thumb=document.createElement('canvas');const f=Math.min(1,640/Math.max(source.width,source.height));thumb.width=Math.max(1,Math.round(source.width*f));thumb.height=Math.max(1,Math.round(source.height*f));const tctx=thumb.getContext('2d');tctx.drawImage(source,0,0,thumb.width,thumb.height);const pixels=tctx.getImageData(0,0,thumb.width,thumb.height).data;let left=thumb.width,top=thumb.height,right=-1,bottom=-1;for(let y=0;y<thumb.height;y++)for(let x=0;x<thumb.width;x++){const i=4*(y*thumb.width+x),a=pixels[i+3];if(a>=20&&(pixels[i]<245||pixels[i+1]<245||pixels[i+2]<245)){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y)}}if(right<left)return toast('整张图片都是透明或接近白色，无法自动去白边');const x0=Math.max(0,Math.floor(left/f)),y0=Math.max(0,Math.floor(top/f)),x1=Math.min(source.width,Math.ceil((right+1)/f)),y1=Math.min(source.height,Math.ceil((bottom+1)/f));if(x0===0&&y0===0&&x1===source.width&&y1===source.height)return toast('未检测到需要裁切的白边');next.width=x1-x0;next.height=y1-y0;ctx.drawImage(source,x0,y0,next.width,next.height,0,0,next.width,next.height)}
 else return;
 imageEditCanvas=next;imageEditCrop=imageEditDrag=null;renderLocalImage();toast('已完成本地处理，原图未修改');
}
async function saveLocalImage(){if(!currentProject||!imageEditCanvas||!imageEditingSource)return;const button=$('localSave');button.disabled=true;try{const blob=await new Promise(r=>imageEditCanvas.toBlob(r,'image/png'));if(!blob)throw Error('无法导出图片');if(blob.size>12*1024*1024)throw Error('结果超过12MB，请缩小尺寸后保存');const data=await fileData(new File([blob],'hamoki-local-edited.png',{type:'image/png'}));let preview=null;try{const thumb=await imagePreviewBlob(blob);if(thumb)preview=await toDataUrl(thumb)}catch{}const n=imageEditingSource;const r=await api(projectPath('/assets'),{method:'POST',body:{image:data,preview,name:'本地编辑 · '+(n.title||'画布图片'),x:n.x+n.w+80,y:n.y,w:imageEditCanvas.width>imageEditCanvas.height?300:260,h:300,parentNodeId:n.id}});currentProject.nodes.push(r.node);renderNodes();selectNode(r.node.id);hide('localEditModal');toast('本地编辑结果已保存到画布，原图保持不变')}catch(e){toast('保存失败：'+e.message)}finally{button.disabled=false}}
function bindEvents(){
 $('smartComponentClose').onclick=closeSmartComponents;
 $('smartComponentAnalyze').onclick=runSmartComponentAnalysis;
 $('smartComponentGenerateAll').onclick=generateAllSmartComponents;
 $('smartComponentDownload').onclick=downloadSmartComponents;
 $('smartComponentModal').addEventListener('pointerdown',e=>{if(e.target.id==='smartComponentModal')closeSmartComponents()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('smartComponentModal').classList.contains('hidden')){e.preventDefault();e.stopImmediatePropagation();closeSmartComponents()}},true);

 $('canvasOriginalClose').onclick=closeCanvasOriginal;
 $('canvasOriginalModal').addEventListener('pointerdown',e=>{if(e.target.id==='canvasOriginalModal')closeCanvasOriginal()});
 $('canvasOriginalFit').onclick=()=>{
  const img=$('canvasOriginalImage');img.classList.toggle('actual-size');
  $('canvasOriginalFit').textContent=img.classList.contains('actual-size')?'适应屏幕':'查看原始尺寸';
 };
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('canvasOriginalModal').classList.contains('hidden')){e.preventDefault();e.stopImmediatePropagation();closeCanvasOriginal()}},true);
 arrangeStudioLayout();setupBoard();$('imageModeToggle').onclick=()=>setComposerMode('image');$('textModeToggle').onclick=()=>setComposerMode('text');bindQuickModelPicker();document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.dataset.close==='settingsModal'?closeSettingsModal():hide(b.dataset.close));document.querySelectorAll('.modal-back').forEach(m=>m.addEventListener('pointerdown',e=>{if(e.target===m&&m.id!=='loginModal'){if(m.id==='settingsModal')closeSettingsModal();else hide(m.id)}}));
 $('loginBtn').onclick=login;$('registerBtn').onclick=register;$('showLogin').onclick=()=>setAuthMode('login');$('showRegister').onclick=()=>setAuthMode('register');$('logout').onclick=logoutAccount;
 $('viewErrorLogs').onclick=openErrorLogs;$('refreshErrorLogs').onclick=refreshErrorLogs;$('copyErrorLogs').onclick=copyErrorLogs;$('clearErrorLogs').onclick=clearErrorLogs;
 $('openHelp').onclick=openHelp;$('authHelp').onclick=openHelp;$('helpStartBtn').onclick=startFromHelp;
 $('newProject').onclick=createProject;$('renameProject').onclick=renameProject;
 $('undoAction').onclick=()=>stepHistory('undo');$('redoAction').onclick=()=>stepHistory('redo');
 $('canvasMenuToggle').onclick=toggleCanvasMenu;
 $('providerQuickToggle').onclick=openQuickProviderMenu;
 $('providerQuickToggle').onkeydown=e=>{if(['ArrowDown','Enter',' '].includes(e.key)){e.preventDefault();openQuickProviderMenu()}};
 document.addEventListener('pointerdown',e=>{if(!e.target.closest('#boardContextMenu'))closeBoardContextMenu();if(!e.target.closest('#canvasMenu,#canvasMenuToggle'))closeCanvasMenu();if(!e.target.closest('#providerQuickMenu,#providerQuickToggle'))closeQuickProviderMenu()});
 for(const btn of document.querySelectorAll('[data-scene-action]'))btn.onclick=()=>{const act=btn.dataset.sceneAction;closeCanvasMenu();if(act==='selectAll')pickAllNodes();if(act==='left'||act==='top'||act==='grid')arrangeSelection(act);if(act==='group')groupSelection(false);if(act==='ungroup')groupSelection(true);if(act==='front'||act==='back')layerSelection(act==='front');if(act==='backup')projectDownload();if(act==='import')importProjectChoose()};
 $('projectArchiveFile').onchange=async e=>{const file=e.target.files?.[0];e.target.value='';if(file)await importProjectFile(file)};
 $('localClose').onclick=()=>hide('localEditModal');$('localSave').onclick=saveLocalImage;
 document.querySelectorAll('[data-local-action]').forEach(b=>b.onclick=()=>localImageAction(b.dataset.localAction));
 $('localPreview').addEventListener('pointerdown',onLocalCropStart);$('localPreview').addEventListener('pointermove',onLocalCropMove);$('localPreview').addEventListener('pointerup',onLocalCropEnd);
 updateUndoButtons();$('archiveProject').onclick=()=>currentProject&&archiveProject(currentProject.id);
 $('mobileProjects').onclick=()=>$('projectsPanel').classList.toggle('open');$('mobileChat').onclick=()=>$('assistantPanel').classList.add('open');$('mobileCloseChat').onclick=()=>$('assistantPanel').classList.remove('open');
 for(const id of ['manageProviders'])$(id).onclick=()=>openSettings();$('newProvider').onclick=()=>selectEdit(null);$('providerSelect').onchange=e=>activate(e.target.value);
 $('pfMode').onchange=()=>{syncProviderMode();updateDraftTestControls()};$('pfImageMode').onchange=syncResponses;
 for(const id of ['pfName','pfUrl','pfKey'])$(id).addEventListener('input',()=>{if(id==='pfName'&&draftProvider)renderProviderCards();updateDraftTestControls()});
 $('saveProvider').onclick=saveProvider;$('deleteProvider').onclick=deleteProvider;$('activateProvider').onclick=()=>activate(editId).then(()=>selectEdit(editId));$('checkProvider').onclick=connectionCheck;$('fetchModels').onclick=fetchModels;$('probeImage').onclick=()=>probeProvider('generate');$('probeEdit').onclick=()=>probeProvider('edit');$('probeReverse').onclick=()=>probeProvider('reverse');
 $('emptyUpload').onclick=()=>$('canvasFiles').click();$('uploadCanvas').onclick=()=>$('canvasFiles').click();$('canvasFiles').onchange=async e=>{await uploadToCanvas(e.target.files,currentBoardPoint(.3,.25));e.target.value=''};
 $('attachRef').onclick=()=>$('referenceFiles').click();$('reverseUpload').onclick=reverseFromReferences;
 $('referenceFiles').onchange=async e=>{await addFiles(e.target.files);e.target.value='';if(window.__reverseAfterUpload&&referenceInputs.length){window.__reverseAfterUpload=false;reverseImage=referenceInputs[0].data;openReverse()}};
 $('emptyNote').onclick=()=>createNote(currentBoardPoint(.35,.32));document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>changeTool(b.dataset.tool));$('latestGenerated').onclick=focusLatestGenerated;$('fitCanvas').onclick=fitCanvas;$('zoomOut').onclick=()=>zoomAt(.8,$('board').clientWidth/2,$('board').clientHeight/2);$('zoomIn').onclick=()=>zoomAt(1.25,$('board').clientWidth/2,$('board').clientHeight/2);
 $('versionToggle').onclick=()=>{$('versionToggle').classList.toggle('disabled-links');renderLinks();toast($('versionToggle').classList.contains('disabled-links')?'版本连接线已隐藏':'版本连接线已显示')};
 $('generateBtn').onclick=()=>submitGeneration();$('compareOpen').onclick=showCompare;$('submitCompare').onclick=submitCompare;$('moreSettings').onclick=()=>$('advanced').classList.toggle('hidden');
 $('skillsToggle').onclick=()=>{const open=$('skillsMenu').classList.contains('hidden');$('skillsMenu').classList.toggle('hidden',!open);$('skillsToggle').setAttribute('aria-expanded',String(open))};
 document.querySelectorAll('[data-skill]').forEach(b=>b.onclick=()=>applySkill(b.dataset.skill));
 for(const cap of ['text','vision']){
  const prefix=cap==='text'?'text':'vision',sel=$(prefix+'ProviderSelect'),field=$(prefix+'ModelInput');
  sel.onchange=()=>setRuntimeProvider(cap,sel.value);
  field.addEventListener('input',()=>{runtimeRoutes[cap].model=field.value.trim();updateRuntimeNotice(cap)});
  $(prefix+'FetchModels').onclick=()=>fetchRuntimeModels(cap,true);
 }
 document.addEventListener('pointerdown',e=>{if(!e.target.closest('#skillsToggle,#skillsMenu'))closeSkillsMenu()});
 $('rerunReverse').onclick=runReverse;$('fillPrompt').onclick=()=>useReverse(false);$('appendPrompt').onclick=()=>useReverse(true);$('copyPrompt').onclick=copyReverse;
 $('openLibrary').onclick=()=>openLibrary('history');$('openTasks').onclick=()=>openLibrary('queue');document.querySelectorAll('[data-library]').forEach(b=>b.onclick=()=>{selectedTab=b.dataset.library;renderLibrary()});$('librarySearch').oninput=renderLibrary;
 $('exportBtn').onclick=()=>{if(!historyItems.length)return toast('当前项目还没有作品');const ids=historyItems.slice(0,40).map(x=>x.id).join(',');location.href=APP_BASE+'/api/export?ids='+encodeURIComponent(ids)};$('pauseBtn').onclick=toggleQueue;
 $('continueBtn').onclick=showFromLibrary;$('inpaintBtn').onclick=()=>openMask(viewerId);$('addAsRef').onclick=async()=>{const h=currentHistory(viewerId);if(h){await addNodeAsRef({kind:'generated',historyId:h.id});hide('viewerModal')}};$('favViewer').onclick=()=>{const h=currentHistory(viewerId);if(h)favorite(h.id,!h.favorite)};
 $('paintTool').onclick=()=>maskSetTool(false);$('eraseTool').onclick=()=>maskSetTool(true);$('clearBrush').onclick=resetMask;$('acceptMask').onclick=acceptMask;$('brushSize').oninput=e=>$('brushLabel').textContent=e.target.value;
 const mask=$('maskCanvas');mask.addEventListener('pointerdown',e=>{e.preventDefault();maskDrawing=true;mask.setPointerCapture(e.pointerId);mask.prev=maskPoint(e);paintMask(mask.prev,mask.prev)});mask.addEventListener('pointermove',e=>{if(!maskDrawing)return;e.preventDefault();const pt=maskPoint(e);paintMask(mask.prev,pt);mask.prev=pt});mask.addEventListener('pointerup',()=>maskDrawing=false);mask.addEventListener('pointercancel',()=>maskDrawing=false);
 document.addEventListener('keydown',e=>{if(document.querySelector('.modal-back:not(.hidden)'))return;if(e.target.matches('textarea,input,select,[contenteditable]')){if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&e.target.id==='prompt'){e.preventDefault();submitGeneration()}return}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();stepHistory(e.shiftKey?'redo':'undo');return}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();stepHistory('redo');return}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();pickAllNodes();return}if(e.code==='Space'){spaceDown=true;$('board').style.cursor='grab';e.preventDefault()}if(e.key.toLowerCase()==='v')changeTool('select');if(e.key.toLowerCase()==='h')changeTool('hand');if(e.key.toLowerCase()==='n')changeTool('note');if(e.key==='Escape'){closeBoardContextMenu();selectNode(null);if(!$('settingsModal').classList.contains('hidden'))closeSettingsModal();document.querySelectorAll('.modal-back').forEach(x=>{if(x.id!=='loginModal')x.classList.add('hidden')})}if(e.key==='Delete'||e.key==='Backspace'){const n=currentNode();if(n)removeNode(n)}if(e.key==='0'&&(e.ctrlKey||e.metaKey)){e.preventDefault();fitCanvas()}});
 document.addEventListener('keyup',e=>{if(e.code==='Space')spaceDown=false});document.addEventListener('paste',async e=>{if(e.target.matches('textarea,input'))return;const files=[...(e.clipboardData?.files||[])].filter(f=>f.type.startsWith('image/'));if(files.length){e.preventDefault();await uploadToCanvas(files,currentBoardPoint(.4,.3))}});
 window.addEventListener('resize',()=>{placeToolbar();scheduleVisibleRefresh();positionOpenMenus();if(window.innerWidth>850)$('assistantPanel').classList.remove('open')});
 document.addEventListener('scroll',positionOpenMenus,true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeCanvasMenu();closeQuickProviderMenu();closeQuickModelMenu();closeSkillsMenu()} });
}
window.addEventListener('error',e=>{reportClientIssue({action:'page_script_error',message:e.message||'脚本执行失败'})});
window.addEventListener('unhandledrejection',e=>{reportClientIssue({action:'unhandled_rejection',message:String(e.reason?.message||e.reason||'未知 Promise 异常')})});
init();

