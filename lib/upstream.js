'use strict';
/** Provider adapters; outbound DNS is pinned to a validated public IP. */
const dns=require('node:dns').promises;
const net=require('node:net');
const http=require('node:http');
const https=require('node:https');
const crypto=require('node:crypto');
const {StringDecoder}=require('node:string_decoder');

const PRIVATE_IN_TEST=process.env.NODE_ENV==='test' && process.env.ALLOW_PRIVATE_UPSTREAMS==='1';
const MAX_REMOTE=90*1024*1024;
const MAX_IMAGE=12*1024*1024; // per uploaded reference image
const MAX_OUTPUT_IMAGE=36*1024*1024; // downloaded/generated 4K assets
const b64ImageRe=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

function badIP(ip){
  if(net.isIP(ip)===4){const a=ip.split('.').map(Number);return a[0]===0||a[0]===10||a[0]===127||a[0]>=224||(a[0]===169&&a[1]===254)||(a[0]===172&&a[1]>=16&&a[1]<=31)||(a[0]===192&&(a[1]===168||a[1]===0||a[1]===88&&a[2]===99))||(a[0]===100&&a[1]>=64&&a[1]<=127)||(a[0]===198&&[18,19,51].includes(a[1]));}
  if(net.isIP(ip)===6){const s=ip.toLowerCase();return s==='::'||s==='::1'||s.startsWith('fc')||s.startsWith('fd')||s.startsWith('fe8')||s.startsWith('fe9')||s.startsWith('fea')||s.startsWith('feb')||s.startsWith('::ffff:')||s.startsWith('2001:db8');}
  return true;
}
async function checkedURL(raw){
  let u;try{u=new URL(raw)}catch{throw Error('API/图片地址不合法')}
  if(!['https:',...(PRIVATE_IN_TEST?['http:']:[])].includes(u.protocol))throw Error('只允许 HTTPS 上游地址');
  if(u.username||u.password||u.hash)throw Error('地址中不可包含账号、密码或锚点');
  if(!u.hostname||u.hostname.endsWith('.local')||u.hostname==='localhost'&&!PRIVATE_IN_TEST)throw Error('不允许请求本地地址');
  const ips=await dns.lookup(u.hostname,{all:true,verbatim:true});
  if(!ips.length||(!PRIVATE_IN_TEST&&ips.some(x=>badIP(x.address))))throw Error('不允许请求内网或保留 IP 地址');
  return {u,ip:ips[0]};
}
function joinURL(base,segment){return base.replace(/\/+$/,'')+'/'+segment.replace(/^\/+/, '');}
function geminiBase(base){const clean=base.replace(/\/+$/,'');return /\/v1beta$/i.test(clean)?clean:clean+'/v1beta';}
function geminiHeaders(provider){return /(^|\.)laozhang\.ai$/i.test(new URL(provider.url).hostname)?{Authorization:'Bearer '+provider.apiKey}:{'x-goog-api-key':provider.apiKey};}
function geminiEndpoint(provider,model){return joinURL(geminiBase(provider.url),'models/'+encodeURIComponent(model)+':generateContent');}
function httpError(code,body,retryAfter){let info='';try{const json=JSON.parse(body.toString('utf8'));info=json?.error?.message||json?.message||''}catch{info=body.toString('utf8').slice(0,160)}const e=Error('上游 HTTP '+code+(info?'：'+String(info).slice(0,330):''));e.upstreamStatus=code;const sec=Number(retryAfter);if(Number.isFinite(sec)&&sec>=0)e.retryAfterMs=Math.min(60000,sec*1000);return e;}
async function remote(url,options={}){
  const {u,ip}=await checkedURL(url);
  const mod=u.protocol==='https:'?https:http;
  const body=options.body||null;
  return await new Promise((resolve,reject)=>{
    const req=mod.request({protocol:u.protocol,hostname:u.hostname,port:u.port||undefined,path:u.pathname+u.search,method:options.method||'GET',headers:{...(body?{'Content-Length':Buffer.byteLength(body)}:{}),...(options.headers||{})},lookup:(host,opts,cb)=>opts&&opts.all?cb(null,[{address:ip.address,family:ip.family}]):cb(null,ip.address,ip.family),timeout:options.timeout||180000},res=>{
      const chunks=[];let total=0;res.on('data',chunk=>{total+=chunk.length;if(total>(options.limit||MAX_REMOTE)){req.destroy(Error('上游响应超过大小限制'));return}chunks.push(chunk)});
      res.on('end',()=>{const buff=Buffer.concat(chunks);if(res.statusCode<200||res.statusCode>=300){reject(httpError(res.statusCode,buff,res.headers['retry-after']));return}resolve({body:buff,headers:res.headers,status:res.statusCode})});res.on('error',reject);
    });
    req.on('error',reject);req.on('timeout',()=>req.destroy(Object.assign(Error('上游请求超时，可能已扣费；请检查历史记录后再重试'),{timeout:true})));
    if(options.signal){if(options.signal.aborted)req.destroy(Error('任务已取消'));else options.signal.addEventListener('abort',()=>req.destroy(Object.assign(Error('任务已取消；上游可能已产生费用'),{cancelled:true})),{once:true})}
    if(body)req.write(body);req.end();
  });
}
async function remoteJSON(url,options={}){
  const res=await remote(url,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})},body:options.body&&typeof options.body!=='string'&& !Buffer.isBuffer(options.body)?JSON.stringify(options.body):options.body});
  try{return JSON.parse(res.body.toString('utf8'))}catch{throw Error('中转站返回非 JSON 数据，请核对接口类型')}
}
function imageFromDataURL(text){if(typeof text!=='string')throw Error('需要上传图片');const m=b64ImageRe.exec(text);if(!m)throw Error('仅支持 JPG/PNG/WebP 图片');const bytes=Buffer.from(m[2],'base64');if(!bytes.length||bytes.length>MAX_IMAGE)throw Error('图片需小于 12MB');if(!validImage(bytes,m[1]))throw Error('图片格式与内容不匹配');return {mime:m[1],bytes,base64:bytes.toString('base64')};}
function validImage(b,mime){return mime==='image/png'?b.length>24&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?b.length>=4&&b[0]===255&&b[1]===216: mime==='image/webp'?b.length>=12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP':false}
function guessMime(b){if(validImage(b,'image/png'))return 'image/png';if(validImage(b,'image/jpeg'))return 'image/jpeg';if(validImage(b,'image/webp'))return 'image/webp';throw Error('上游未返回可识别的 JPG、PNG 或 WebP 图片')}
function extension(mime){return mime==='image/png'?'png':mime==='image/jpeg'?'jpg':'webp'}
function partsBody(fields,files){const boundary='----Hamoki'+crypto.randomBytes(12).toString('hex'),sections=[];for(const [k,v] of Object.entries(fields)){if(v===undefined||v===null||v==='')continue;sections.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${String(v)}\r\n`))}for(const f of files){sections.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\nContent-Type: ${f.mime}\r\n\r\n`));sections.push(f.bytes);sections.push(Buffer.from('\r\n'))}sections.push(Buffer.from(`--${boundary}--\r\n`));return {body:Buffer.concat(sections),contentType:'multipart/form-data; boundary='+boundary}}
function parseCandidateURL(x){if(typeof x==='string' && x.startsWith('data:'))return {dataURL:x};if(typeof x==='string' && /^https:\/\//.test(x))return {url:x};return null}
async function unwrapImage(payload){
  const candidates=[];
  const grab=x=>{if(!x)return; if(typeof x==='string'){let y=parseCandidateURL(x);if(y)candidates.push(y);return}
    if(x.b64_json)candidates.push({b64:x.b64_json,mime:x.mime_type||x.mimeType});
    if(x.inlineData?.data)candidates.push({b64:x.inlineData.data,mime:x.inlineData.mimeType});
    if(x.inline_data?.data)candidates.push({b64:x.inline_data.data,mime:x.inline_data.mime_type});
    if(x.result&&x.type==='image_generation_call')candidates.push({b64:x.result});
    if(x.image_url){let y=parseCandidateURL(x.image_url?.url||x.image_url);if(y)candidates.push(y)}
    if(x.url){let y=parseCandidateURL(x.url);if(y)candidates.push(y)}
    if(x.image?.url){let y=parseCandidateURL(x.image.url);if(y)candidates.push(y)}
    if(typeof x.text==='string'){const m=x.text.match(/!?\[[^\]]*\]\((data:image\/[^)]+|https:\/\/[^)]+)\)/)||x.text.match(/(data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+)/);if(m)grab(m[1]);}
  };
  for(const x of payload?.data||[])grab(x);
  for(const c of payload?.candidates||[])for(const p of c.content?.parts||[])grab(p);
  for(const x of payload?.output||[])grab(x);
  for(const c of payload?.choices||[]){const message=c.message||{};for(const x of message.images||[])grab(x);if(Array.isArray(message.content))for(const x of message.content)grab(x);else if(typeof message.content==='string')grab({text:message.content});}
  for(const x of candidates){try{let b;if(x.dataURL){const encoded=b64ImageRe.exec(x.dataURL);if(!encoded)throw Error('图片数据格式不正确');b=Buffer.from(encoded[2],'base64')}else if(x.b64){b=Buffer.from(x.b64,'base64')}else if(x.url){b=(await remote(x.url,{timeout:30000,limit:MAX_OUTPUT_IMAGE+1000,headers:{'Accept':'image/*'}})).body}else continue;const mime=guessMime(b);if(b.length>MAX_OUTPUT_IMAGE)throw Error('上游图片超过 36MB');return {bytes:b,mime}}catch(e){if(candidates.length===1)throw e}}
  throw Error('接口返回成功，但没有找到图片数据；请在中转站设置中切换生图接口模式');
}
const VISION_PROMPTS={
  detailed:'你是一名专业 AI 绘画提示词分析师。仔细分析上传图片，输出可直接用于文生图或图生图的中文提示词。准确描述主体、细节、构图视角、动作、场景、光线、颜色、材质与画风；不臆测图片之外的信息。只返回一段中文提示词。',
  character:'只反推图中的人物或主体设计，不描述背景。用一段精确的中文生图提示词描述造型、发型、五官、服饰、颜色、材质、比例、装备和辨识度。不要解释。',
  style:'只分析图像的视觉画风，用一段可复制的中文生图提示词描述绘制媒介、线条、上色技法、光影、色彩、纹理、构图表现。不要复述画中的具体人物、物件或情节。'
};
async function analyzeCreativeImages(provider,images,model,instruction){
 if(provider.mode==='grsai')throw Error('当前 Grsai 图像协议不支持视觉文字分析；请选择视觉模型接口');
 if(!Array.isArray(images)||images.length<1||images.length>6)throw Error('请选择 1 至 6 张视觉参考图片');
 const normalized=images.map(img=>{
  if(!['image/png','image/jpeg','image/webp'].includes(img.mime)||!Buffer.isBuffer(img.bytes)||img.bytes.length>8*1024*1024)throw Error('参考图文件无效或超过 8MB');
  return {mime:img.mime,base64:img.bytes.toString('base64')};
 });
 let answer;
 if(provider.mode==='gemini'){
  const parts=[{text:String(instruction).slice(0,36000)},...normalized.map(x=>({inlineData:{mimeType:x.mime,data:x.base64}}))];
  const result=await remoteJSON(geminiEndpoint(provider,model),{method:'POST',headers:geminiHeaders(provider),body:{contents:[{parts}],generationConfig:{temperature:.2,maxOutputTokens:5600}},timeout:90000,limit:1024*1024});
  answer=result.candidates?.[0]?.content?.parts?.filter(x=>typeof x.text==='string').map(x=>x.text).join('\n');
 }else{
  const content=[{type:'text',text:String(instruction).slice(0,36000)},...normalized.map(x=>({type:'image_url',image_url:{url:'data:'+x.mime+';base64,'+x.base64}}))];
  let result;
  try{
   result=await remoteJSON(joinURL(provider.url,'chat/completions'),{method:'POST',headers:{Authorization:'Bearer '+provider.apiKey},body:{model,messages:[{role:'user',content}],max_tokens:5600},timeout:90000,limit:1024*1024});
   answer=result.choices?.[0]?.message?.content;
  }catch(error){
   if(!needsResponsesEndpoint(error))throw error;
   const input=[{role:'user',content:[
    {type:'input_text',text:String(instruction).slice(0,36000)},
    ...normalized.map(x=>({type:'input_image',image_url:'data:'+x.mime+';base64,'+x.base64}))
   ]}];
   try{
    const payload=await remoteJSON(joinURL(provider.url,'responses'),{method:'POST',headers:{Authorization:'Bearer '+provider.apiKey},
     body:{model,input,max_output_tokens:5600,store:false},timeout:90000,limit:1024*1024});
    answer=responsesText(payload);
   }catch(next){
    if(next.upstreamStatus===404||next.upstreamStatus===405)throw Error('所选视觉模型只支持 Responses，但中转站未开放 /responses；请更换支持看图的视觉模型');
    throw next;
   }
  }
 }
 if(Array.isArray(answer))answer=answer.map(x=>x.text||'').join('\n');
 if(typeof answer!=='string'||!answer.trim())throw Error('视觉模型没有返回文字；请确认所选模型支持多图识别');
 return answer.trim().slice(0,30000);
}
async function reverse(provider,pic,model,kind='detailed'){
  if(provider.mode==='grsai')throw Error('Grsai 统一图像接口不支持反推；请在该能力中配置 OpenAI/Gemini 独立接口。');
  const instruction=VISION_PROMPTS[kind]||VISION_PROMPTS.detailed;let result;
  if(provider.mode==='gemini')result=await remoteJSON(geminiEndpoint(provider,model),{method:'POST',headers:geminiHeaders(provider),body:{contents:[{parts:[{text:instruction},{inlineData:{mimeType:pic.mime,data:pic.base64}}]}],generationConfig:{temperature:.4,maxOutputTokens:2000}},timeout:70000});
  else result=await remoteJSON(joinURL(provider.url,'chat/completions'),{method:'POST',headers:{Authorization:'Bearer '+provider.apiKey},body:{model,messages:[{role:'user',content:[{type:'text',text:instruction},{type:'image_url',image_url:{url:`data:${pic.mime};base64,${pic.base64}`}}]}],max_tokens:2000},timeout:70000});
  let text=provider.mode==='gemini'?result.candidates?.[0]?.content?.parts?.filter(x=>x.text).map(x=>x.text).join('\n'):result.choices?.[0]?.message?.content;
  if(Array.isArray(text))text=text.map(x=>x.text||'').join('\n');if(typeof text!=='string'||!text.trim())throw Error('视觉模型未返回文字，请检查模型是否支持识图');return text.trim();
}
function orientationSize(ratio,resolution,model){
  const modern=/^gpt-image-2(?:$|[.\-])/.test(model);
  if(!modern){if(ratio==='1:1')return '1024x1024';return ['3:2','16:9','4:3'].includes(ratio)?'1536x1024':'1024x1536'}
  const maps={
    '1K':{'1:1':'1024x1024','3:2':'1536x1024','2:3':'1024x1536','16:9':'1536x864','9:16':'864x1536','4:3':'1280x960','3:4':'960x1280'},
    '2K':{'1:1':'2048x2048','3:2':'2304x1536','2:3':'1536x2304','16:9':'2560x1440','9:16':'1440x2560','4:3':'2304x1728','3:4':'1728x2304'},
    '4K':{'1:1':'2816x2816','3:2':'3456x2304','2:3':'2304x3456','16:9':'3840x2160','9:16':'2160x3840','4:3':'3200x2400','3:4':'2400x3200'}
  };
  return maps[resolution]?.[ratio]||maps['1K'][ratio]||'1024x1024';
}
// Grsai unified image API (not the legacy /v1/draw API or Gemini protocol).
function grsaiRoot(raw){
 const base=raw.replace(/\/+$/,'');
 return base.replace(/\/v1\/api(?:\/(?:generate|result))?$/i,'').replace(/\/v1$/i,'');
}
function grsaiURL(p,route){return joinURL(grsaiRoot(p.url),'v1/api/'+route)}
function grsaiError(payload,defaultMessage){
 const why=payload?.failure_reason||payload?.error?.message||payload?.error||payload?.msg;
 return Error(String(why||defaultMessage).slice(0,320));
}
function asyncDelay(ms,signal){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(Error('任务已取消；上游可能已经计费'));
  const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel)};
  const cancel=()=>{done();reject(Error('任务已取消；上游可能已经计费'))};
  const timer=setTimeout(()=>{done();resolve()},ms);
  signal?.addEventListener('abort',cancel,{once:true});
 });
}
async function grsaiGenerate(provider,task,inputs,mask,signal,onProgress){
 if(mask)throw Error('Grsai 新版接口没有蒙版参数，不能进行局部蒙版重绘');
 if(task.transparentBg)throw Error('Grsai 新版接口未注明透明背景参数，请关闭透明背景');
 const model=task.model||provider.imageModel;if(!model)throw Error('请在操作台选择 Grsai 生图模型');
 const auth={Authorization:'Bearer '+provider.apiKey};
 const nano=/^nano-banana(?:-|$)/i.test(model);
 const body={model,prompt:task.prompt,images:inputs.map(item=>'data:'+item.mime+';base64,'+item.bytes.toString('base64')),
  aspectRatio:nano?task.ratio:orientationSize(task.ratio,task.resolution,model),replyType:'async'};
 if(nano)body.imageSize=task.resolution;
 else body.quality=task.quality||'auto';
 let upstreamId=task.upstreamId||'';
 let result;
 if(upstreamId){
  onProgress?.({id:upstreamId,status:'running',progress:task.progress||0});
 }else{
  result=await remoteJSON(grsaiURL(provider,'generate'),{method:'POST',headers:auth,body,signal,timeout:45000,limit:2*1024*1024});
  const status=String(result.status||'').toLowerCase();
  if(status==='failed'||status==='error')throw grsaiError(result,'Grsai 生图失败');
  upstreamId=String(result.id||'').trim().slice(0,200);
  if(status!=='succeeded'&&!upstreamId)throw Error('Grsai 未返回任务 ID 或图片，请核对模型与 API Key');
  if(upstreamId)onProgress?.({id:upstreamId,status,progress:Number(result.progress)||0});
 }
 const started=Date.now();
 for(let tries=0;tries<150;tries++){
  if(signal?.aborted)throw Error('任务已取消；上游可能已经计费');
  if(!result||!['succeeded','failed','error'].includes(String(result.status||'').toLowerCase())){
   if(!upstreamId)throw Error('Grsai 缺少查询任务 ID');
   await asyncDelay(tries===0?1200:2500,signal);
   result=await remoteJSON(grsaiURL(provider,'result')+'?id='+encodeURIComponent(upstreamId),{headers:auth,signal,timeout:20000,limit:2*1024*1024});
  }
  const status=String(result.status||'').toLowerCase();
  if(status==='succeeded'){
   const entry=(result.results||[]).find(v=>typeof v?.url==='string'||typeof v?.b64_json==='string');
   if(!entry)throw Error('Grsai 报告成功，但未返回有效图片 URL');
   const url=entry.url||'';
   const candidate=entry.b64_json?{data:[{b64_json:entry.b64_json}]}:{data:[{url}]};
   return await unwrapImage(candidate);
  }
  if(['failed','error','cancelled','canceled'].includes(status))throw grsaiError(result,'Grsai 生图未完成');
  onProgress?.({id:upstreamId,status,progress:Number(result.progress)||0});
 }
 throw Object.assign(Error('Grsai 任务仍在生成中；上游任务 ID 已保存，请勿重复提交，稍后使用原任务重试查询'),{upstreamPending:true});
}
async function generate(provider,task,inputs,mask,signal,onProgress){
  const model=task.model||provider.imageModel;
  if(provider.mode==='grsai')return await grsaiGenerate(provider,task,inputs,mask,signal,onProgress);
  if(provider.mode==='gemini' && /^gpt-image(?:-|$)/i.test(model))throw Error('Gemini 原生协议不能使用 GPT 图片模型：请先在图片服务商中选择 Nano Banana');
  const systemRatio='构图比例尽量保持 '+task.ratio+'，'+(task.ratio==='1:1'?'正方形。':Number(task.ratio.split(':')[0])>Number(task.ratio.split(':')[1])?'横向构图。':'竖向构图。');
  const roles={shape:'以这张图作为造型与结构参考',color:'只参考这张图的配色方案，不复刻主体',style:'只参考这张图的画风和渲染技法',pose:'参考这张图的构图和动作',background:'参考这张图的场景氛围',general:'综合参考图'};
  const extra=[];
  if(task.sourceId)extra.push('参考图1：上一版本原图，以它为主要编辑对象。');
  for(const [i,role] of (task.roleHints||[]).entries())extra.push('参考图'+(i+(task.sourceId?2:1))+'：'+(roles[role]||roles.general)+'。');
  const prompt=task.prompt+'\n'+extra.join('\n')+'\n'+systemRatio+(task.transparentBg?'\n请输出带透明背景的PNG，仅保留主体。':'');
  let json;
  if(provider.mode==='gemini'){
    if(mask)throw Error('Gemini 原生接口没有标准蒙版参数，请改用普通图片编辑，或切换支持蒙版的 OpenAI 图片接口');
    const parts=[{text:prompt},...inputs.map(x=>({inlineData:{mimeType:x.mime,data:x.bytes.toString('base64')}}))];
    json=await remoteJSON(geminiEndpoint(provider,model),{method:'POST',headers:geminiHeaders(provider),body:{contents:[{role:'user',parts}],generationConfig:{responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:task.ratio,imageSize:task.resolution}}},signal,timeout:300000});
  }else if(provider.imageMode==='chat'){
    if(mask)throw Error('聊天生图接口不支持蒙版，请选择 OpenAI 图片接口');
    const message=inputs.length?[{type:'text',text:prompt},...inputs.map(x=>({type:'image_url',image_url:{url:'data:'+x.mime+';base64,'+x.bytes.toString('base64')}}))]:prompt;
    json=await remoteJSON(joinURL(provider.url,'chat/completions'),{method:'POST',headers:{Authorization:'Bearer '+provider.apiKey},body:{model,messages:[{role:'user',content:message}],stream:false},signal,timeout:180000});
  }else if(provider.imageMode==='responses'){
    if(mask)throw Error('Responses 生图接口不支持此蒙版参数，请选择 OpenAI 图片接口');
    const content=[{type:'input_text',text:prompt},...inputs.map(x=>({type:'input_image',image_url:'data:'+x.mime+';base64,'+x.bytes.toString('base64')}))];
    json=await remoteJSON(joinURL(provider.url,'responses'),{method:'POST',headers:{Authorization:'Bearer '+provider.apiKey},body:{model:provider.responseModel||'gpt-5',input:[{role:'user',content}],tools:[{type:'image_generation',model,size:orientationSize(task.ratio,task.resolution,model),quality:task.quality||'auto'}]},signal,timeout:180000});
  }else if(inputs.length){
    const files=inputs.map((x,i)=>({field:inputs.length===1?'image':'image[]',mime:x.mime,filename:'ref-'+(i+1)+'.'+extension(x.mime),bytes:x.bytes}));if(mask)files.push({field:'mask',mime:'image/png',filename:'mask.png',bytes:mask.bytes});
    const multipart=partsBody({model,prompt,quality:task.quality||'auto',size:orientationSize(task.ratio,task.resolution,model),output_format:'png',...(task.transparentBg?{background:'transparent'}:{})},files);
    json=await remoteJSON(joinURL(provider.url,'images/edits'),{method:'POST',headers:{Authorization:'Bearer '+provider.apiKey,'Content-Type':multipart.contentType},body:multipart.body,signal,timeout:180000});
  }else{
    json=await remoteJSON(joinURL(provider.url,'images/generations'),{method:'POST',headers:{Authorization:'Bearer '+provider.apiKey},body:{model,prompt,size:orientationSize(task.ratio,task.resolution,model),quality:task.quality||'auto',n:1,output_format:'png',...(task.transparentBg?{background:'transparent'}:{})},signal,timeout:180000});
  }
  return await unwrapImage(json);
}
async function listModels(provider){if(provider.mode==='grsai')throw Error('Grsai 新版 API 没有公开标准模型列表端点；请手动填写 nano-banana-2.1 等模型 ID（无需先保存）。');const res=await remoteJSON(provider.mode==='gemini'?joinURL(geminiBase(provider.url),'models'):joinURL(provider.url,'models'),{headers:provider.mode==='gemini'?geminiHeaders(provider):{Authorization:'Bearer '+provider.apiKey},timeout:12000,limit:3*1024*1024});return (Array.isArray(res.data)?res.data:Array.isArray(res.models)?res.models:[]).map(x=>String(x.id||x.name||'').replace(/^models\//,'')).filter(Boolean).slice(0,500)}

function textMessages(history,prompt,maxPromptChars=8000){
 const list=Array.isArray(history)?history:[];
 const messages=list.slice(-24).map(m=>({role:m.role,content:String(m.content||'').slice(0,3000)}))
   .filter(m=>['user','assistant'].includes(m.role)&&m.content.trim());
 while(messages.reduce((s,m)=>s+m.content.length,0)>16000&&messages.length>1)messages.shift();
 messages.push({role:'user',content:String(prompt||'').slice(0,Math.min(Math.max(8000,maxPromptChars),60000))});
 return messages;
}
function textRequest(provider,{model,prompt,history=[],maxPromptChars=8000,maxOutputTokens=2600},stream){
  if(provider.mode==='grsai')throw Error('Grsai 统一图像接口不支持文字对话；请在该能力中配置 OpenAI/Gemini 独立接口。');
 const messages=textMessages(history,prompt,maxPromptChars);
 const endpoint=provider.mode==='gemini'?'models/'+encodeURIComponent(model)+(stream?':streamGenerateContent?alt=sse':':generateContent'):'chat/completions';
 if(provider.mode==='gemini'){
  const contents=messages.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]}));
  return {url:joinURL(geminiBase(provider.url),endpoint),headers:geminiHeaders(provider),body:{contents,generationConfig:{maxOutputTokens}}};
 }
 return {url:joinURL(provider.url,endpoint),headers:{Authorization:'Bearer '+provider.apiKey},body:{model,messages,stream,max_tokens:maxOutputTokens}};
}
function extractText(payload,gemini,stream){
 if(gemini){const parts=payload?.candidates?.[0]?.content?.parts||[];return parts.filter(p=>typeof p.text==='string').map(p=>p.text).join('')}
 let content=stream?payload?.choices?.[0]?.delta?.content:payload?.choices?.[0]?.message?.content;
 if(Array.isArray(content))content=content.map(p=>p.text||'').join('');
 return typeof content==='string'?content:'';
}
function responsesText(payload){
 if(typeof payload?.output_text==='string'&&payload.output_text.trim())return payload.output_text;
 const parts=[];
 for(const node of payload?.output||[]){
  if(node?.type==='message')for(const entry of node.content||[])if(typeof entry.text==='string'&&['output_text','text'].includes(entry.type))parts.push(entry.text);
 }
 if(!parts.length&&payload?.choices?.length)return extractText(payload,false,false);
 return parts.join('\n');
}
function needsResponsesEndpoint(error){
 // Retry ONLY on an explicit, non-billable 400 endpoint incompatibility.
 // Never retry a timeout, 429, 500, or arbitrary upstream rejection.
 return error?.upstreamStatus===400&&/not supported on the Chat Completions endpoint|only supported on (the )?Responses API|use (the )?responses? (endpoint|api)/i.test(String(error.message||''));
}
async function openAIResponses(provider,model,messages,maxOutputTokens){
 const input=messages.map(m=>({role:m.role,content:[{type:'input_text',text:m.content}]}));
 try{
  const data=await remoteJSON(joinURL(provider.url,'responses'),{
   method:'POST',headers:{Authorization:'Bearer '+provider.apiKey},
   body:{model,input,max_output_tokens:maxOutputTokens,store:false},
   timeout:95000,limit:1024*1024
  });
  const result=responsesText(data).trim();
  if(result)return result.slice(0,16000);
  throw Error('Responses 返回了空文本；请检查模型是否支持文字输出');
 }catch(error){
  if(error.upstreamStatus===404||error.upstreamStatus===405){
   throw Error('此模型不能走 Chat Completions，且中转站没有开放 /responses。请换支持文字 Chat Completions 的模型，或让中转站开通 Responses 接口');
  }
  throw error;
 }
}
async function generateText(provider,{model,prompt,history=[],maxPromptChars=8000,maxOutputTokens=2600}){
 const config=textRequest(provider,{model,prompt,history,maxPromptChars,maxOutputTokens},false);
 let data;
 try{data=await remoteJSON(config.url,{method:'POST',headers:config.headers,body:config.body,timeout:95000,limit:1024*1024})}
 catch(error){
  if(provider.mode==='openai'&&needsResponsesEndpoint(error)){
   return openAIResponses(provider,model,textMessages(history,prompt,maxPromptChars),maxOutputTokens);
  }
  throw error;
 }
 const text=extractText(data,provider.mode==='gemini',false);
 if(text.trim())return text.trim().slice(0,16000);
 throw Error('文字模型没有返回可用文本，请检查模型与聊天协议');
}
async function streamText(provider,{model,prompt,history=[]},onDelta,signal){
 const request=textRequest(provider,{model,prompt,history},true);
 const {u,ip}=await checkedURL(request.url);const mod=u.protocol==='https:'?https:http;
 const raw=Buffer.from(JSON.stringify(request.body));
 let answer='',carry='',total=0;const utf8=new StringDecoder('utf8');
 const gemini=provider.mode==='gemini';
 const collect=fragment=>{
  if(!fragment)return;
  const available=16000-answer.length;
  if(available<=0)return;
  const next=fragment.slice(0,available);
  answer+=next;if(next)onDelta(next);
 };
 return await new Promise((resolve,reject)=>{
  let settled=false,bufferedError=[];
  const done=(err,value)=>{if(settled)return;settled=true;if(err)reject(err);else resolve(value)};
  const req=mod.request({protocol:u.protocol,hostname:u.hostname,port:u.port||undefined,path:u.pathname+u.search,method:'POST',
   headers:{'Content-Type':'application/json','Accept':'text/event-stream','Content-Length':raw.length,...request.headers},
   lookup:(host,opts,cb)=>opts&&opts.all?cb(null,[{address:ip.address,family:ip.family}]):cb(null,ip.address,ip.family),timeout:110000},res=>{
    const okay=res.statusCode>=200&&res.statusCode<300;
    const isStream=String(res.headers['content-type']||'').includes('text/event-stream');
    const processEvent=(evt)=>{
      const data=evt.split(/\r?\n/).filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');
      if(!data||data==='[DONE]')return;
      let parsed;try{parsed=JSON.parse(data)}catch{return}
      if(parsed.error)throw Error(String(parsed.error.message||parsed.error).slice(0,400));
      const delta=extractText(parsed,gemini,true);
      if(gemini&&delta.startsWith(answer))collect(delta.slice(answer.length));else collect(delta);
    };
    res.on('data',chunk=>{
      if(settled)return;
      total+=chunk.length;
      if(total>1024*1024){req.destroy(Error('文字流式回复超过 1MB 限制'));return}
      if(!okay||!isStream){bufferedError.push(chunk);return}
      try{
        carry+=utf8.write(chunk);
        let match;
        while((match=/\r?\n\r?\n/.exec(carry))){const item=carry.slice(0,match.index);carry=carry.slice(match.index+match[0].length);processEvent(item)}
      }catch(error){req.destroy(error)}
    });
    res.on('end',()=>{
      if(settled)return;
      try{
        if(!okay)return done(httpError(res.statusCode,Buffer.concat(bufferedError),res.headers['retry-after']));
        if(isStream){carry+=utf8.end();if(carry.trim())processEvent(carry)}
        else{
          let json;try{json=JSON.parse(Buffer.concat(bufferedError).toString('utf8'))}catch{throw Error('中转站没有返回合法的文字数据')}
          collect(extractText(json,gemini,false));
        }
        if(!answer.trim())throw Error('文字模型未返回内容，请检查是否支持流式输出');
        done(null,answer.trim());
      }catch(e){done(e)}
    });
    res.on('error',done);
  });
  req.on('error',done);
  req.on('timeout',()=>req.destroy(Error('文字模型响应超时，上游可能已产生费用，请检查记录后再试')));
  if(signal){if(signal.aborted)req.destroy(Error('请求已取消'));else signal.addEventListener('abort',()=>req.destroy(Error('用户停止生成（上游可能已计费）')),{once:true})}
  req.end(raw);
 });
}

module.exports={analyzeCreativeImages,generateText,streamText,textMessages,checkedURL,joinURL,remote,remoteJSON,imageFromDataURL,validImage,guessMime,extension,reverse,generate,listModels,MAX_IMAGE};
