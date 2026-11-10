(()=>{
'use strict';
const M={png:'image/png',jpg:'image/jpeg',webp:'image/webp',avif:'image/avif'};
const el=(t,c,txt)=>{const e=document.createElement(t);if(c)e.className=c;if(txt!==undefined)e.textContent=txt;return e;};
function css(){if(document.getElementById('hic-css'))return;const s=el('style');s.id='hic-css';s.textContent=[
'.hic-overlay{position:fixed;inset:0;z-index:2147482500;background:#081015d9;backdrop-filter:blur(15px);display:grid;place-items:center;padding:14px;color:#e8f2f4;font:13px system-ui,sans-serif}',
'.hic-panel{width:min(760px,96vw);max-height:95vh;background:#1c2831;border:1px solid #ffffff32;border-radius:16px;box-shadow:0 25px 90px #0009;display:flex;flex-direction:column;overflow:hidden}',
'.hic-head,.hic-foot{display:flex;align-items:center;justify-content:space-between;padding:15px 18px;gap:12px;flex-wrap:wrap;border-bottom:1px solid #ffffff20}.hic-foot{border-top:1px solid #ffffff20;border-bottom:0}.hic-head strong{font-size:16px}',
'.hic-main{padding:17px;overflow:auto}.hic-muted{font-size:12px;color:#b3c6cf}',
'.hic-drop{min-height:126px;border:1px dashed #89bcb4;border-radius:11px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:7px;text-align:center;cursor:pointer;background:#ffffff06;padding:15px}.hic-drop.over{background:#25554e6b;border-color:#91e4d7}',
'.hic-list{display:grid;gap:7px;max-height:220px;overflow:auto;margin:13px 0}.hic-item{display:flex;gap:9px;align-items:center;background:#ffffff09;border-radius:8px;padding:7px;min-width:0}.hic-item img{width:48px;height:48px;object-fit:contain;background:#ffffff12;border-radius:5px}.hic-info{flex:1;min-width:0;overflow:hidden}.hic-info strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
'.hic-options{display:flex;gap:13px;align-items:center;flex-wrap:wrap;margin:14px 0}.hic-options label{display:flex;align-items:center;gap:6px}',
'.hic-panel button,.hic-panel select,.hic-panel input[type=color]{font:inherit;border-radius:7px;border:1px solid #ffffff2c;background:#30434c;color:#e8f2f4;padding:7px 9px}.hic-panel button{cursor:pointer}.hic-panel button:hover{background:#42616a}.hic-panel button:disabled{opacity:.45;cursor:default}.hic-panel .hic-primary{background:#83d1c3;color:#15312c;font-weight:700}',
'.hic-status{font-size:12px;color:#b3cad2;min-height:20px;line-height:1.5}.hic-btns{display:flex;gap:8px;align-items:center}',
'@media(prefers-reduced-motion:reduce){.hic-panel *{animation:none!important;transition:none!important}}'
].join('\n');document.head.append(s);}
const add=(p,c)=>{p.append(c);return c;};
const btn=(p,t,fn)=>{const b=add(p,el('button',null,t));b.type='button';b.onclick=fn;return b;};
const supports=m=>{try{const c=document.createElement('canvas');c.width=c.height=1;return c.toDataURL(m).startsWith('data:'+m);}catch(e){return false;}};
function open(){
css();if(document.querySelector('.hic-overlay'))return;
const prev=document.activeElement,overflow=document.body.style.overflow,urls=[],items=[];
const o=el('div','hic-overlay'),panel=el('section','hic-panel'),head=el('header','hic-head'),main=el('main','hic-main'),foot=el('footer','hic-foot');
o.setAttribute('role','dialog');o.setAttribute('aria-modal','true');o.setAttribute('aria-label','图片格式转换');
const title=el('div');title.append(el('strong',null,'图片格式转换'),el('div','hic-muted','浏览器本地处理 · 不上传服务器 · 不消耗 Token'));
head.append(title);
const drop=el('div','hic-drop'),upload=el('input'),list=el('div','hic-list'),options=el('div','hic-options'),status=el('div','hic-status'),count=el('span','hic-muted','尚未添加图片'),buttons=el('div','hic-btns');
function close(){document.removeEventListener('keydown',key,true);document.removeEventListener('paste',paste,true);o.remove();urls.forEach(u=>URL.revokeObjectURL(u));document.body.style.overflow=overflow;prev?.focus?.();}
btn(head,'× 关闭',close);
drop.append(el('strong',null,'拖入图片或点击选择'),el('span','hic-muted','支持批量文件和 Ctrl+V 粘贴，转换后直接下载'));
drop.tabIndex=0;drop.setAttribute('role','button');drop.onclick=()=>upload.click();
drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();upload.click();}};
upload.type='file';upload.multiple=true;upload.accept='image/*,.bmp,.svg,.avif';upload.hidden=true;
const lab=el('label'),format=el('select');lab.append('目标格式 ',format);
Object.entries(M).forEach(([ext,m])=>{const op=el('option',null,ext.toUpperCase());op.value=ext;if(!supports(m))op.disabled=true;format.append(op);});format.value='png';
const qlab=el('label'),quality=el('input'),ql=el('span',null,'92%');quality.type='range';quality.min='30';quality.max='100';quality.value='92';quality.oninput=()=>ql.textContent=quality.value+'%';qlab.append('画质 ',quality,ql);
const bgLab=el('label'),background=el('input');background.type='color';background.value='#ffffff';bgLab.append('JPG底色 ',background);
const szLab=el('label'),max=el('select');[['0','原始尺寸'],['4096','最长边4096'],['2048','最长边2048'],['1024','最长边1024']].forEach(([v,t])=>{const x=el('option',null,t);x.value=v;max.append(x);});szLab.append('尺寸 ',max);
format.onchange=()=>bgLab.hidden=format.value!=='jpg';bgLab.hidden=true;
options.append(lab,qlab,bgLab,szLab);
main.append(drop,upload,list,options,status);foot.append(count,buttons);panel.append(head,main,foot);o.append(panel);
document.body.style.overflow='hidden';document.body.append(o);drop.focus();
const clear=btn(buttons,'清空',()=>{items.length=0;urls.forEach(u=>URL.revokeObjectURL(u));urls.length=0;render();});
const go=btn(buttons,'转换并下载',convert);go.className='hic-primary';
function key(e){if(e.key==='Escape'){e.preventDefault();close();}}
function paste(e){if(!o.isConnected||e.target.closest('input,textarea,[contenteditable=true]'))return;const fs=[...(e.clipboardData?.files||[])].filter(f=>f.type.startsWith('image/'));if(fs.length){e.preventDefault();include(fs);}}
document.addEventListener('keydown',key,true);document.addEventListener('paste',paste,true);
drop.ondragover=e=>{e.preventDefault();drop.classList.add('over');};drop.ondragleave=()=>drop.classList.remove('over');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');include(e.dataTransfer?.files||[]);};
upload.onchange=()=>{include(upload.files||[]);upload.value='';};
function include(fs){for(const f of [...fs]){if(items.length>=20){status.textContent='单批最多20张';break;}if(f.size>30*1048576){status.textContent='已跳过超过30MB的文件';continue;}if(!f.type.startsWith('image/')&&!/\.(png|jpe?g|webp|avif|gif|bmp|svg)$/i.test(f.name))continue;items.push(f);urls.push(URL.createObjectURL(f));}render();}
function render(){list.replaceChildren();count.textContent=items.length+' 张图片';go.disabled=clear.disabled=!items.length;items.forEach((f,i)=>{const item=el('div','hic-item'),im=el('img'),info=el('div','hic-info');im.src=urls[i];im.alt='';info.append(el('strong',null,f.name||'剪贴板图片'),el('span','hic-muted',(f.size/1048576).toFixed(2)+' MB'));item.append(im,info);btn(item,'移除',()=>{URL.revokeObjectURL(urls[i]);items.splice(i,1);urls.splice(i,1);render();});list.append(item);});}
async function load(f){const u=URL.createObjectURL(f);try{const im=new Image();await new Promise((yes,no)=>{im.onload=yes;im.onerror=()=>no(Error('浏览器不支持此图片的解码'));im.src=u;});if(im.naturalWidth*im.naturalHeight>40000000)throw Error('像素超过4000万');return im;}finally{URL.revokeObjectURL(u);}}
async function convert(){if(!items.length)return;go.disabled=true;clear.disabled=true;const ext=format.value,mime=M[ext],limit=+max.value;let ok=0,bad=0,errs=[];
for(const [i,f] of [...items].entries()){try{status.textContent='转换中 '+(i+1)+' / '+items.length+'：'+f.name;const im=await load(f),s=limit?Math.min(1,limit/Math.max(im.naturalWidth,im.naturalHeight)):1;const c=document.createElement('canvas');c.width=Math.max(1,Math.round(im.naturalWidth*s));c.height=Math.max(1,Math.round(im.naturalHeight*s));const x=c.getContext('2d');if(!x)throw Error('无法创建画布');if(ext==='jpg'){x.fillStyle=background.value;x.fillRect(0,0,c.width,c.height);}x.imageSmoothingQuality='high';x.drawImage(im,0,0,c.width,c.height);
const blob=await new Promise((yes,no)=>c.toBlob(b=>b&&b.type===mime?yes(b):no(Error('浏览器不支持该格式编码')),mime,+quality.value/100));
const link=URL.createObjectURL(blob),a=el('a');a.href=link;a.download=(f.name||'image').replace(/\.[^.]+$/,'')+'.'+ext;a.click();setTimeout(()=>URL.revokeObjectURL(link),6000);ok++;}catch(e){bad++;errs.push((f.name||'图片')+'：'+e.message);}}
status.textContent='完成：成功 '+ok+' 张，失败 '+bad+' 张。'+errs.slice(0,2).join('；');go.disabled=false;clear.disabled=false;}
render();
}
window.HamokiImageConverter={open};
})();