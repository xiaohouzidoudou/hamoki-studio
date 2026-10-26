"use strict";
const names={activity:"活动类型",style:"美术风格",game:"游戏类型",mechanic:"玩法类型",festival:"节日主题",platform:"适配平台"};
const defaults={activity:"活动主界面",style:"Q版卡通",game:"MMORPG",mechanic:"对战竞技",festival:"万圣节",platform:"移动竖屏"};
const state={...defaults};
const el=id=>document.getElementById(id);
async function api(url,options){const res=await fetch(url,options);const data=await res.json();if(!res.ok)throw Error(data.error||"请求失败");return data;}
async function init(){
 try{const all=await api("/api/catalog");for(const [key,options] of Object.entries(all)){const field=document.createElement("div");field.className="field";const heading=document.createElement("div");heading.textContent=names[key]||key;field.append(heading);const chips=document.createElement("div");chips.className="chips";for(const opt of options){const b=document.createElement("button");b.className="chip";b.type="button";b.textContent=opt;b.setAttribute("aria-pressed",String(state[key]===opt));b.addEventListener("click",()=>{state[key]=opt;for(const child of chips.children)child.setAttribute("aria-pressed",String(child===b));});chips.append(b);}field.append(chips);el("fields").append(field);}}
 catch(e){el("status").textContent="参数加载失败："+e.message;}
}
el("plan").addEventListener("click",async()=>{const btn=el("plan");btn.disabled=true;try{const r=await api("/api/plan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...state,title:el("title").value,note:el("note").value})});el("prompt").value=r.prompt;el("status").textContent="设计方案已生成 · "+r.subject+" · "+r.ratio;}catch(e){el("status").textContent=e.message;}finally{btn.disabled=false;}});
el("copy").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(el("prompt").value);el("status").textContent="提示词已复制";}catch{el("prompt").focus();el("prompt").select();el("status").textContent="请手动复制已选中的提示词";}});
el("generate").addEventListener("click",async()=>{const prompt=el("prompt").value.trim();if(!prompt){el("status").textContent="请先生成设计方案";return;}const btn=el("generate");btn.disabled=true;el("status").textContent="正在请求生图模型...";try{const result=await api("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt,ratio:state.platform==="移动竖屏"?"9:16":"16:9"})});const img=document.createElement("img");img.alt="AI生成的游戏UI效果图";img.src=result.image;el("imageArea").replaceChildren(img);el("status").textContent="生成成功";}catch(e){el("status").textContent=e.message;}finally{btn.disabled=false;}});
init();