'use strict';
/** Small per-account, secret-scrubbed troubleshooting log.
 *  No prompts, payloads, cookies, request headers or raw upstream replies are stored.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const MAX_ENTRIES=160;
const MAX_MESSAGE=460;
const LOG_NAME='diagnostics.json';
const TYPES=new Set(['browser','backend','upstream','queue','storage','system']);
const LEVELS=new Set(['error','warning','info']);

function redact(value){
 let s=String(value??'');
 // Obvious secrets and bearer tokens. Never include request payloads in the first place.
 s=s.replace(/data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+/gi,'[image omitted]');
 s=s.replace(/(?:bearer\s+)[A-Za-z0-9._~+\/-]+/gi,'Bearer [redacted]');
 s=s.replace(/\bsk-[A-Za-z0-9_-]{5,}\b/g,'[key redacted]');
 s=s.replace(/\bAIza[A-Za-z0-9_-]{16,}\b/g,'[key redacted]');
 s=s.replace(/([?&](?:api[_-]?key|key|token|password|secret|access_token)=)[^&\s]+/gi,'$1[redacted]');
 s=s.replace(/((?:password|api[_-]?key|authorization|token|secret)\s*[:=]\s*)[^\s,;]+/gi,'$1[redacted]');
 s=s.replace(/https?:\/\/[^\s"'()]+/gi,match=>{try{const u=new URL(match);return u.origin+u.pathname}catch{return '[url omitted]'}});
 return s.replace(/[\r\n\t]+/g,' ').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,MAX_MESSAGE).trim();
}
function cleanPath(input){
 const s=String(input||'').split('?')[0].split('#')[0];
 return s.startsWith('/api/')?s.replace(/\/[a-f0-9-]{36}(?=\/|$)/ig,'/:id').slice(0,120):'';
}
function newEntry(info={}){
 const status=Number(info.status);
 return {
  id:crypto.randomBytes(8).toString('hex'),
  at:new Date().toISOString(),
  level:LEVELS.has(info.level)?info.level:'error',
  source:TYPES.has(info.source)?info.source:'backend',
  action:redact(info.action).slice(0,72),
  method:['GET','POST','PATCH','PUT','DELETE'].includes(info.method)?info.method:undefined,
  path:cleanPath(info.path)||undefined,
  status:Number.isInteger(status)&&status>=100&&status<=599?status:undefined,
  message:redact(info.message)||'未知错误',
  model:info.model?redact(info.model).slice(0,100):undefined
 };
}
function openDiagnostics(folder){
 const file=path.join(folder,LOG_NAME);
 function read(){
  if(!fs.existsSync(file))return [];
  let parsed;try{parsed=JSON.parse(fs.readFileSync(file,'utf8'))}catch{return []}
  return Array.isArray(parsed)?parsed.slice(-MAX_ENTRIES):[];
 }
 let entries=read();
 function save(){
  const temp=file+'.'+process.pid+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(entries),{mode:0o600});fs.renameSync(temp,file);
 }
 return {
  read:()=>entries.map(x=>({...x})).reverse(),
  append(info){entries.push(newEntry(info));if(entries.length>MAX_ENTRIES)entries=entries.slice(-MAX_ENTRIES);save();return entries.at(-1)},
  clear(){entries=[];save()},
  filename:file
 };
}
module.exports={openDiagnostics,redact};
