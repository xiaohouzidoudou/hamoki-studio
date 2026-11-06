const readBody = async res => {
  const str=await res.text();
  let obj;try{obj=JSON.parse(str)}catch{throw Object.assign(Error('Sub2 返回非 JSON 响应'),{statusCode:502})}
  if(!res.ok||obj?.code&&obj.code!==0&&obj.code!==200&&obj.code!==1&&obj.code!=='SUCCESS'){
    throw Object.assign(Error(obj?.message||obj?.error||'Sub2 API 请求失败'),{statusCode:[400,401,403,409,422,429].includes(res.status)?res.status:502});
  }
  return obj?.data??obj;
};
export class Sub2Client {
  constructor(base){
    const b=String(base||'').trim().replace(/\/+$/,'');
    if(b){
      const u=new URL(b);
      if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('Invalid Sub2 URL');
      if(u.protocol==='http:'&&!['localhost','127.0.0.1','::1'].includes(u.hostname)&&process.env.SUB2_ALLOW_PRIVATE_HTTP!=='1')throw Error('Sub2 仅允许 HTTPS 或经明确批准的私有 HTTP');
    }
    this.base=b;
  }
  get enabled(){return !!this.base}
  async publicSettings(){
    const data=await this.request('/api/v1/settings/public',null,{timeout:6000});
    return {turnstileEnabled:data?.turnstile_enabled===true,turnstileSiteKey:typeof data?.turnstile_site_key==='string'?data.turnstile_site_key:''};
  }
  async request(path,token,{method='GET',body,timeout=10000,idempotencyKey}={}){
    if(!this.enabled)throw Object.assign(Error('Sub2 尚未配置'),{statusCode:503});
    const headers={accept:'application/json'};
    if(token)headers.authorization='Bearer '+token;
    if(body!==undefined)headers['content-type']='application/json';
    if(idempotencyKey)headers['Idempotency-Key']=idempotencyKey;
    let response;
    try{response=await fetch(this.base+path,{method,headers,body:body!==undefined?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout),redirect:'error'})}
    catch{throw Object.assign(Error('Sub2 暂时不可达'),{statusCode:502})}
    return readBody(response);
  }
  async login(email,password,turnstileToken){
    if(typeof email!=='string'||typeof password!=='string'||email.length>254||password.length>128)throw Object.assign(Error('登录参数不合法'),{statusCode:400});
    if(turnstileToken!==undefined&&(typeof turnstileToken!=='string'||turnstileToken.length>2048))throw Object.assign(Error('人机验证参数不合法'),{statusCode:400});
    const result=await this.request('/api/v1/auth/login',null,{method:'POST',body:{email,password,...(turnstileToken?{turnstile_token:turnstileToken}:{})}});
    if(result?.requires_2fa)throw Object.assign(Error('Sub2 当前账号需要二次验证，请先使用 Sub2 控制台；Studio 尚未实现该验证流程'),{statusCode:409});
    if(!result?.access_token)throw Object.assign(Error('Sub2 登录未返回授权 Token，检查验证码/版本配置'),{statusCode:409});
    const profile=await this.profile(result.access_token);
    if(!profile?.id)throw Object.assign(Error('Sub2 未返回可确认的用户 ID'),{statusCode:502});
    return {profile,tokens:{access_token:result.access_token,refresh_token:result.refresh_token||null,expires_at:Date.now()+(Number(result.expires_in)||900)*1000}};
  }
  async refresh(refreshToken){
    if(!refreshToken)throw Object.assign(Error('Sub2 授权已过期，请重新连接'),{statusCode:401});
    const x=await this.request('/api/v1/auth/refresh',null,{method:'POST',body:{refresh_token:refreshToken}});
    if(!x.access_token)throw Object.assign(Error('Sub2 刷新 Token 失败，请重新连接'),{statusCode:401});
    return {access_token:x.access_token,refresh_token:x.refresh_token||refreshToken,expires_at:Date.now()+Number(x.expires_in||900)*1000};
  }
  async profile(token){
    const x=await this.request('/api/v1/user/profile',token);
    return x?.user||x;
  }
  async availableModels(token){
    const x=await this.request('/api/v1/keys?page=1&page_size=100',token);
    const keys=Array.isArray(x?.items)?x.items:Array.isArray(x)?x:[];
    // The account session enumerates metadata only. Secret keys are never sent to browsers.
    return keys.map(k=>({id:k.id,name:k.name,active:k.status==='active',hasSecret:!!k.key,groupId:k.group_id})); 
  }
  async createKey(token,userId){
    const x=await this.request('/api/v1/keys',token,{method:'POST',body:{name:'Hamoki Studio 专用 Key'},idempotencyKey:'hamoki-studio-'+userId});
    const key=x?.key||x?.api_key||x?.token;
    if(typeof key!=='string'||!key.startsWith('sk-'))throw Object.assign(Error('Sub2 未返回新建 Key 的明文；不能自动配置生图'),{statusCode:502});
    return key;
  }
  async models(apiKey){
    const x=await this.request('/v1/models',apiKey);
    return (Array.isArray(x)?x:Array.isArray(x?.data)?x.data:[]).map(m=>m.id).filter(m=>typeof m==='string');
  }
  async submitImage(apiKey,body,idempotencyKey){
    return this.request('/v1/images/generations/async',apiKey,{method:'POST',body,timeout:20000,idempotencyKey});
  }
  async task(apiKey,taskId){
    if(!/^[a-zA-Z0-9_-]{8,128}$/.test(taskId))throw Object.assign(Error('任务 ID 不合法'),{statusCode:400});
    return this.request('/v1/images/tasks/'+encodeURIComponent(taskId),apiKey);
  }
}
