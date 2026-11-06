/* Hamoki Studio first-party canvas groups. Existing image nodes retain their IDs. */
(() => {
  'use strict';
  const COLORS=['mint','blue','violet','amber','slate'];
  const ICONS={
    download:'M12 3v12m-5-5 5 5 5-5M4 17v3h16v-3',
    run:'M8 5v14l11-7Z',
    trash:'M4.5 7h15M9 7V4.5h6V7M7 7l.8 13h8.4L17 7',
    grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    ungroup:'M4 4h6v6H4zM14 14h6v6h-6zM10 7h4M7 10v4M17 10v4M10 17h4',
    group:'M3 5h18v14H3zM7 9h5v6H7zM14 9h3v6h-3z'
  };
  const HINT='拖动标题可移动整组';
  const uuid=/^[a-f0-9-]{36}$/;
  const make=(name,cls,text)=>{
    const el=document.createElement(name);
    if(cls)el.className=cls;
    if(text!==undefined)el.textContent=String(text);
    return el;
  };
  function svgIcon(name){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');
    svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');
    svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
    svg.setAttribute('aria-hidden','true');
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',ICONS[name]||ICONS.grid);svg.append(path);
    return svg;
  }
  async function request(url,options={}){
    const response=await fetch(url,{credentials:'same-origin',...options});
    if(!response.ok){let error;
      try{error=(await response.json()).error;}catch{}
      throw Error(error||('服务器错误 HTTP '+response.status));
    }
    return response.json();
  }
  const payload=(value)=>({method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  let context=null;
  const info=(group,ctx)=>{
    const members=ctx.nodes.filter(n=>n.groupId===group.id);
    if(!members.length)return null;
    const rect={
      left:Math.min(...members.map(n=>Number(n.x)||0)),
      top:Math.min(...members.map(n=>Number(n.y)||0)),
      right:Math.max(...members.map(n=>(Number(n.x)||0)+(Number(n.w)||288))),
      bottom:Math.max(...members.map(n=>(Number(n.y)||0)+(Number(n.h)||288)))
    };
    return {members,rect};
  };
  function tool(label,icon,action){
    const btn=make('button','hm-group-tool');
    btn.type='button';btn.title=label;btn.setAttribute('aria-label',label);
    btn.append(svgIcon(icon));
    if(label==='整组运行')btn.append(make('span','hm-group-run-label','整组运行'));
    btn.addEventListener('click',event=>{event.stopPropagation();void action(event);});
    btn.addEventListener('pointerdown',event=>event.stopPropagation());
    return btn;
  }
  async function update(group,fields){
    const ctx=context;
    try{
      await request('/api/projects/'+ctx.projectId+'/groups/'+group.id,payload(fields));
      await ctx.refresh();
    }catch(error){ctx.toast('更新分组失败：'+error.message,true);}
  }
  function select(entries,value,aria){
    const el=make('select','hm-group-select');
    el.setAttribute('aria-label',aria);
    for(const [id,label] of entries){
      const option=make('option','',label);option.value=id;el.append(option);
    }
    el.value=value;
    return el;
  }
  function makeGroup(group,data,ctx){
    const {rect,members}=data;
    const frame=make('section','hm-canvas-group');
    frame.dataset.groupId=group.id;
    frame.dataset.color=group.color||'mint';
    const padding=Number(group.padding)||19;
    const x=rect.left-padding,y=rect.top-padding;
    const w=rect.right-rect.left+padding*2,h=rect.bottom-rect.top+padding*2;
    Object.assign(frame.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});
    const head=make('div','hm-group-head');
    head.title=HINT;
    const title=make('button','hm-group-title',group.title||'素材组');
    title.type='button';title.title='双击重命名';
    title.ondblclick=event=>{
      event.preventDefault();event.stopPropagation();
      const input=make('input','hm-group-rename');
      input.value=group.title||'素材组';input.maxLength=60;
      title.replaceWith(input);input.focus();input.select();
      let done=false;
      const finish=async commit=>{
        if(done)return;done=true;
        const name=input.value.trim()||'素材组';
        if(commit&&name!==group.title)await update(group,{title:name});
        else{input.replaceWith(title);}
      };
      input.addEventListener('keydown',e=>{
        if(e.key==='Enter')void finish(true);
        if(e.key==='Escape')void finish(false);
      });
      input.addEventListener('blur',()=>void finish(true));
    };
    const layout=select([['manual','手动'],['grid','自动网格'],['row','自动横排'],['column','自动竖排']],
      group.layout||'manual','布局方式');
    layout.onchange=()=>void update(group,{layout:layout.value});
    layout.onpointerdown=e=>e.stopPropagation();
    const align=select([['start','起点对齐'],['center','居中对齐'],['end','末端对齐']],
      group.align||'start','对齐方式');
    align.onchange=()=>void update(group,{align:align.value});
    align.onpointerdown=e=>e.stopPropagation();
    const color=make('button','hm-group-color');color.type='button';
    color.title='更换分组配色';color.setAttribute('aria-label','更换分组配色');
    color.append(make('span','hm-group-color-indicator'));
    color.onclick=event=>{
      event.stopPropagation();
      const idx=COLORS.indexOf(group.color||'mint');
      void update(group,{color:COLORS[(idx+1)%COLORS.length]});
    };
    const images=members.filter(n=>n.kind!=='note');
    const notes=members.filter(n=>n.kind==='note'&&String(n.text||'').trim());
    head.append(title,make('span','hm-group-count',images.length+' 图'));
    const controls=make('div','hm-group-controls');
    controls.append(layout,align,color);
    if(images.length&&notes.length){
      const run=tool('整组运行','run',()=>void runGroup(group,ctx,images.length));
      run.classList.add('hm-group-run');
      controls.append(run);
    }
    controls.append(tool('下载整组原图 ZIP','download',()=>download(group,ctx)));
    controls.append(tool('解散分组，不删除图片','ungroup',()=>void ungroup(group,ctx)));
    head.append(controls);frame.append(head);
    installDragging(frame,head,group,ctx);
    return frame;
  }
  function installDragging(frame,head,group,ctx){
    head.addEventListener('pointerdown',event=>{
      if(event.button!==0||event.target.closest('button,select,input'))return;
      event.preventDefault();event.stopPropagation();
      const start={x:event.clientX,y:event.clientY},zoom=ctx.zoom()||1;
      let moved=false,dx=0,dy=0;
      const children=[...document.querySelectorAll('#canvas .canvas-node[data-id]')].filter(c=>
        ctx.nodes.find(n=>n.id===c.dataset.id)?.groupId===group.id).map(c=>({
          el:c,x:parseFloat(c.style.left)||0,y:parseFloat(c.style.top)||0
        }));
      const origin={x:parseFloat(frame.style.left)||0,y:parseFloat(frame.style.top)||0};
      const move=e=>{
        if(e.pointerId!==event.pointerId)return;
        dx=Math.round((e.clientX-start.x)/zoom);
        dy=Math.round((e.clientY-start.y)/zoom);
        moved=moved||Math.abs(dx)+Math.abs(dy)>2;
        frame.style.left=(origin.x+dx)+'px';frame.style.top=(origin.y+dy)+'px';
        for(const c of children){c.el.style.left=(c.x+dx)+'px';c.el.style.top=(c.y+dy)+'px';}
      };
      const finish=async e=>{
        if(e.pointerId!==event.pointerId)return;
        window.removeEventListener('pointermove',move,true);
        window.removeEventListener('pointerup',finish,true);
        window.removeEventListener('pointercancel',finish,true);
        if(!moved||e.type==='pointercancel'){
          frame.style.left=origin.x+'px';frame.style.top=origin.y+'px';
          for(const c of children){c.el.style.left=c.x+'px';c.el.style.top=c.y+'px';}
          return;
        }
        try{
          await request('/api/projects/'+ctx.projectId+'/groups/'+group.id+'/move',payload({dx,dy}));
          await ctx.refresh();
        }catch(error){
          ctx.toast('整组移动失败：'+error.message,true);await ctx.refresh();
        }
      };
      window.addEventListener('pointermove',move,true);
      window.addEventListener('pointerup',finish,true);
      window.addEventListener('pointercancel',finish,true);
    });
  }
  async function runGroup(group,ctx,count){
    const providerId=document.getElementById('provider-select')?.value;
    const model=document.getElementById('model-select')?.value;
    if(!providerId||!model){ctx.toast('请先选择中转商和图片模型',true);return;}
    const yes=await window.HamokiGlassUI?.confirm?.(
      '将组内 '+count+' 张参考图与反推提示词一起发送给 '+model+' 生成1张新图片。这可能产生费用，确定加入队列？',
      {title:'整组运行',confirmLabel:'添加到队列'});
    if(!yes)return;
    try{
      const value=await request('/api/projects/'+ctx.projectId+'/groups/'+group.id+'/run',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({providerId,model,ratio:'1:1',resolution:'1K'})
      });
      ctx.toast('整组已加入队列 · '+value.referenceCount+' 张参考图');
      if(value.jobs?.length){
        window.HamokiGenerationFrames?.sync?.(value.jobs);
        window.HamokiGenerationFrames?.reveal?.(value.jobs[0]);
      }
    }catch(error){ctx.toast('整组运行未提交：'+error.message,true);}
  }
  function download(group,ctx){
    const anchor=make('a');
    anchor.href='/api/projects/'+ctx.projectId+'/groups/'+group.id+'/download';
    anchor.download='hamoki-group-'+group.id.slice(0,8)+'.zip';
    document.body.append(anchor);anchor.click();anchor.remove();
  }
  async function ungroup(group,ctx){
    const confirmed=await window.HamokiGlassUI?.confirm?.(
      '解散分组后，所有图片和提示词仍留在画布原位置。',
      {title:'解散 '+(group.title||'素材组'),confirmLabel:'解散分组'});
    if(!confirmed)return;
    try{
      await request('/api/projects/'+ctx.projectId+'/groups/'+group.id,{method:'DELETE'});
      await ctx.refresh();ctx.toast('已解散分组，图片未删除');
    }catch(error){ctx.toast('解散分组失败：'+error.message,true);}
  }
  function render(area,ctx) {
    context=ctx;
    for(const old of area.querySelectorAll('.hm-canvas-group'))old.remove();
    const view=ctx.bounds||{x0:-Infinity,y0:-Infinity,x1:Infinity,y1:Infinity};
    for(const group of ctx.groups){
      const data=info(group,ctx);if(!data)continue;
      const r=data.rect;
      if(r.left>view.x1+200||r.right<view.x0-200||
         r.top>view.y1+200||r.bottom<view.y0-200)continue;
      const frame=makeGroup(group,data,ctx);
      area.insertBefore(frame,area.firstChild);
    }
  }
  async function create(ctx){
    const ids=[...ctx.selectedIds];
    if(ids.length<2){ctx.toast('请先框选两张以上图片或提示词',true);return;}
    try{
      const res=await request('/api/projects/'+ctx.projectId+'/groups',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({nodeIds:ids,title:'素材组 '+(ctx.groups.length+1),
          layout:'manual',align:'start',color:'mint'})
      });
      ctx.clearSelection?.();await ctx.refresh();ctx.toast('已将 '+res.nodes.length+' 个节点打组');
    }catch(error){ctx.toast('打组失败：'+error.message,true);}
  }
  window.HamokiCanvasGroups={render,create};
})();
