/* L1/L2 enhancements share the existing application routes and DOM. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id),app=()=>window.HamokiStudioUI;
 const storage={get(key){try{return localStorage.getItem(key)}catch{return null}},set(key,value){try{localStorage.setItem(key,value)}catch{}}};
 const templates=[
  {name:'OpenAI 官方',url:'https://api.openai.com/v1',mode:'openai',imageMode:'images'},
  {name:'OpenRouter',url:'https://openrouter.ai/api/v1',mode:'openai',imageMode:'chat'},
  {name:'DeepSeek',url:'https://api.deepseek.com/v1',mode:'openai',imageMode:'chat'},
  {name:'Cloudflare Workers AI',url:'https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1',mode:'openai',imageMode:'chat'}
 ];
 function initSidebarSections(){
  let saved={};try{saved=JSON.parse(storage.get('hs-sidebar-sections'))||{}}catch{}
  document.querySelectorAll('.sidebar-section').forEach(section=>{
   const name=section.dataset.section,toggle=section.querySelector('.section-toggle'),content=section.querySelector('.section-content');
   if(!toggle||!content)return;
   const apply=expanded=>{section.classList.toggle('expanded',expanded);section.classList.toggle('collapsed',!expanded);toggle.setAttribute('aria-expanded',String(expanded));content.hidden=!expanded;content.inert=!expanded};
   content.id=content.id||'sidebar-content-'+name;toggle.setAttribute('aria-controls',content.id);
   apply(saved[name]?saved[name]==='expanded':name==='quick');
   toggle.addEventListener('click',()=>{const expanded=!section.classList.contains('expanded');apply(expanded);saved[name]=expanded?'expanded':'collapsed';storage.set('hs-sidebar-sections',JSON.stringify(saved))});
  });
 }
 function initQuickTemplates(){
  const title=$('formTitle');if(!title||$('quickTemplateButton'))return;
  const button=document.createElement('button');button.id='quickTemplateButton';button.type='button';button.className='soft-btn quick-template-btn';button.textContent='快速配置（新建）';
  // selectEdit replaces formTitle.textContent; keep this button outside it.
  title.after(button);button.addEventListener('click',showTemplateSelector);
 }
 function showTemplateSelector(){
  const panel=$('providerTemplateSelector');if(!panel)return;
  panel.classList.remove('hidden');panel.querySelector('button')?.focus();
 }
 function initTemplateSelector(){
  const panel=$('providerTemplateSelector');if(!panel)return;
  const list=panel.querySelector('.provider-quick-templates');
  templates.forEach(template=>{
   const button=document.createElement('button');button.type='button';button.className='provider-template-card';
   const title=document.createElement('strong'),url=document.createElement('small');title.textContent=template.name;url.textContent=template.url;button.append(title,url);
   button.addEventListener('click',()=>{if(app()?.newProviderTemplate(template)){panel.classList.add('hidden');$('pfKey').focus();app().toast('已新建模板草稿，请填写新 Key 并手动保存')}});list.append(button);
  });
 }
 let wizardStep=1,wizardOwner='',wizardBusy=false;
 const wizardKey=()=> 'hs-wizard-completed:'+encodeURIComponent(app()?.state().userId||'');
 function setWizardStep(step){
  wizardStep=step;
  $('onboardingModal').querySelectorAll('.onboarding-step').forEach(node=>node.classList.toggle('active',Number(node.dataset.step)===step));
  $('onboardingModal').querySelectorAll('.step-number').forEach((node,i)=>node.classList.toggle('active',i<step));
 }
 function showFirstTimeWizard(){
  const state=app()?.state();if(!state?.authorized||!state.userId)return;
  if(wizardOwner!==state.userId){for(const id of ['onboardingApiUrl','onboardingApiKey','onboardingPrompt'])$(id).value='';$('onboardingProviderForm').classList.add('hidden');$('onboardingPreview').classList.add('hidden');$('onboardingPreview').querySelector('img').removeAttribute('src');$('onboardingContinueUpload').classList.add('hidden')}
  wizardOwner=state.userId;setWizardStep(1);$('onboardingModal').classList.remove('hidden');
 }
 function finishWizard(){
  storage.set(wizardKey(),'true');$('onboardingApiKey').value='';$('onboardingModal').classList.add('hidden');
 }
 function checkFirstTimeUser(){
  const state=app()?.state();if(!state?.authorized||!state.ready||!state.userId||state.providerCount||storage.get(wizardKey()))return;
  showFirstTimeWizard();
 }
 function wizardCurrent(){const s=app()?.state();return s?.authorized&&s.userId===wizardOwner&&!$('onboardingModal').classList.contains('hidden')}
 function initWizard(){
  const modal=$('onboardingModal');if(!modal)return;
  modal.querySelectorAll('[data-template]').forEach(button=>button.addEventListener('click',()=>{
   $('onboardingApiUrl').value=button.dataset.template==='openai'?templates[0].url:'';
   $('onboardingApiKey').value='';$('onboardingProviderForm').classList.remove('hidden');$('onboardingApiUrl').focus();
  }));
  $('onboardingSaveProvider').addEventListener('click',async()=>{
   if(wizardBusy||!wizardCurrent())return;
   wizardBusy=true;$('onboardingSaveProvider').disabled=true;
   try{const saved=await app().createOnboardingProvider($('onboardingApiUrl').value.trim(),$('onboardingApiKey').value.trim());if(saved&&wizardCurrent()){$('onboardingApiKey').value='';setWizardStep(2)}}
   catch(error){app().toast(error.message)}finally{wizardBusy=false;$('onboardingSaveProvider').disabled=false}
  });
  $('onboardingSkipProvider').addEventListener('click',()=>{if(!wizardBusy)setWizardStep(2)});
  $('onboardingUploadBtn').addEventListener('click',()=>{if(!wizardBusy)$('onboardingFiles').click()});
  $('onboardingFiles').addEventListener('change',async event=>{
   const files=[...event.target.files];event.target.value='';if(!files.length||wizardBusy||!wizardCurrent())return;
   wizardBusy=true;$('onboardingUploadBtn').disabled=true;
   try{const url=await app().uploadOnboarding(files);if(!wizardCurrent())return;if(!url)throw Error('图片未上传成功，请检查后手动重试');const preview=$('onboardingPreview');preview.querySelector('img').src=url;preview.classList.remove('hidden');$('onboardingContinueUpload').classList.remove('hidden')}
   catch(error){app().toast(error.message)}finally{wizardBusy=false;$('onboardingUploadBtn').disabled=false}
  });
  for(const id of ['onboardingContinueUpload','onboardingSkipUpload'])$(id).addEventListener('click',()=>{if(!wizardBusy)setWizardStep(3)});
  $('onboardingGenerate').addEventListener('click',()=>{if(!wizardCurrent())return;const prompt=$('onboardingPrompt').value.trim();finishWizard();app().preparePrompt(prompt);app().toast('请在创作区选择模型并确认参数，再手动点击开始生成（可能扣费）')});
  $('onboardingSkipGenerate').addEventListener('click',finishWizard);
  $('onboardingClose').addEventListener('click',()=>{if(!wizardBusy)finishWizard()});
  // Clear secret inputs on logout/session expiry; no cross-account wizard state.
  new MutationObserver(()=>{if(modal.classList.contains('hidden'))$('onboardingApiKey').value=''}).observe(modal,{attributes:true,attributeFilter:['class']});
  new MutationObserver(()=>{if(!app()?.state().authorized){$('onboardingApiKey').value='';modal.classList.add('hidden')}}).observe($('loginModal'),{attributes:true,attributeFilter:['class']});
 }
 function addModelRecommendations(){
  const menu=$('composerModelMenu');if(!menu)return;
  menu.querySelectorAll('.composer-model-option').forEach(option=>{
   const name=(option.querySelector('.composer-model-name')?.textContent||'').toLowerCase();
   const reason=/turbo|lightning/.test(name)?'偏重速度，能力以服务商为准':/dall-e|dalle/.test(name)?'适合文生图，能力以服务商为准':/flux|sd3/.test(name)?'偏重画质，能力以服务商为准':'';
   const old=option.querySelector('.composer-model-reason');option.classList.toggle('recommended',!!reason);
   if(!reason){old?.remove();return}if(old?.textContent===reason)return;
   const tag=old||document.createElement('small');tag.className='composer-model-reason';tag.textContent=reason;if(!old)option.append(tag);
  });
 }
 function enhanceModelSelector(){
  const menu=$('composerModelMenu');if(!menu)return;
  // Disconnect around writes so decoration cannot enqueue itself forever.
  const observer=new MutationObserver(()=>{observer.disconnect();addModelRecommendations();observe()});
  const observe=()=>observer.observe(menu,{childList:true,subtree:true,characterData:true});addModelRecommendations();observe();
 }
 function applyWorkflowMode(value){
  const mode=value==='pro'?'pro':'quick';storage.set('hs-workflow-mode',mode);
  $('assistantPanel')?.classList.toggle('workflow-quick',mode==='quick');
  if(mode==='quick')$('advanced')?.classList.add('hidden');
  document.querySelectorAll('.workflow-mode-btn').forEach(button=>{const active=button.dataset.mode===mode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))});
 }
 function initWorkflowModes(){
  const config=$('assistantPanel')?.querySelector('.model-config');if(!config||$('workflowModeSwitcher'))return;
  const switcher=document.createElement('div');switcher.id='workflowModeSwitcher';switcher.className='workflow-mode-switcher';switcher.setAttribute('role','group');switcher.setAttribute('aria-label','参数显示模式');
  for(const [mode,label] of [['quick','快速模式'],['pro','专业模式']]){const button=document.createElement('button');button.type='button';button.className='workflow-mode-btn';button.dataset.mode=mode;button.textContent=label;button.addEventListener('click',()=>applyWorkflowMode(mode));switcher.append(button)}
  config.before(switcher);applyWorkflowMode(storage.get('hs-workflow-mode'));
 }
 function init(){
  initSidebarSections();initQuickTemplates();initTemplateSelector();initWizard();enhanceModelSelector();initWorkflowModes();
  // Tool buttons already have changeTool handlers in app.js; only upload needs wiring.
  $('uploadCanvasTop')?.addEventListener('click',()=>$('canvasFiles').click());
  document.addEventListener('studio:ready',checkFirstTimeUser);checkFirstTimeUser();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
 window.HamokiUIOptimization=Object.freeze({showFirstTimeWizard,showTemplateSelector,applyWorkflowMode});
})();
