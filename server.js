"use strict";
const http=require("node:http");
const fs=require("node:fs");
const path=require("node:path");
const {CATALOG,makePlan}=require("./lib/prompt");
const root=path.join(__dirname,"public");
const mime={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8"};
const host=process.env.HOST||"127.0.0.1";
const port=Number(process.env.PORT||8035);
const imageApiUrl=process.env.IMAGE_API_URL||"";
const imageModel=process.env.IMAGE_MODEL||"";
const imageApiKey=process.env.IMAGE_API_KEY||"";
const corsHeaders={"Content-Security-Policy":"default-src 'self'; img-src 'self' data: https:; connect-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'","X-Content-Type-Options":"nosniff","Cache-Control":"no-store"};
function json(res,status,data){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8",...corsHeaders});res.end(JSON.stringify(data));}
function body(req){return new Promise((resolve,reject)=>{let size=0,chunks=[];req.on("data",c=>{size+=c.length;if(size>10000){reject(Error("请求体过大"));req.destroy();}else chunks.push(c);});req.on("end",()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString()||"{}"));}catch(e){reject(Error("JSON格式不正确"));}});req.on("error",reject);});}
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,"http://localhost");
 if(req.method==="GET"&&url.pathname==="/api/health")return json(res,200,{ok:true,version:"1.0.0-alpha.1",imageConfigured:!!(imageApiUrl&&imageApiKey&&imageModel)});
 if(req.method==="GET"&&url.pathname==="/api/catalog")return json(res,200,CATALOG);
 if(req.method==="POST"&&url.pathname==="/api/plan")return json(res,200,makePlan(await body(req)));
 if(req.method==="POST"&&url.pathname==="/api/generate"){
  if(!(imageApiUrl&&imageApiKey&&imageModel))return json(res,503,{error:"图片接口尚未配置。可先使用完整提示词，配置 IMAGE_API_URL / IMAGE_API_KEY / IMAGE_MODEL 后再生图。"});
  const v=await body(req);const prompt=String(v.prompt||"").slice(0,12000);if(!prompt)return json(res,400,{error:"提示词不能为空"});
  const endpoint=new URL(imageApiUrl);if(endpoint.protocol!=="https:")return json(res,500,{error:"生图接口必须使用HTTPS"});
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),110000);
  try{
   const upstream=await fetch(endpoint,{method:"POST",headers:{"Authorization":"Bearer "+imageApiKey,"Content-Type":"application/json"},body:JSON.stringify({model:imageModel,prompt,size:v.ratio==="16:9"?"1536x1024":"1024x1536",n:1}),signal:controller.signal});
   const raw=await upstream.text();if(!upstream.ok)return json(res,502,{error:"生图上游请求失败（HTTP "+upstream.status+"）"});
   let result;try{result=JSON.parse(raw)}catch{return json(res,502,{error:"生图接口响应不是JSON"});}
   const item=result.data?.[0];const url=item?.url;const b64=item?.b64_json;
   if(typeof b64==="string"&&b64.length<12000000)return json(res,200,{image:"data:image/png;base64,"+b64});
   if(typeof url==="string"&&url.startsWith("https://"))return json(res,200,{image:url});
   return json(res,502,{error:"生图上游返回格式不受支持"});
  }finally{clearTimeout(timer);}
 }
 if(req.method!=="GET")return json(res,404,{error:"接口不存在"});
 const name=url.pathname==="/"?"index.html":url.pathname.slice(1);
 if(!["index.html","app.js","style.css"].includes(name))return json(res,404,{error:"页面不存在"});
 const file=path.join(root,name);res.writeHead(200,{"Content-Type":mime[path.extname(file)],...corsHeaders});fs.createReadStream(file).pipe(res);
 }catch(e){if(!res.headersSent)json(res,400,{error:"请求处理失败："+e.message});}
});
if(require.main===module)server.listen(port,host,()=>console.log("Hamoki Studio rebuild ready on "+host+":"+port));
module.exports={server};
