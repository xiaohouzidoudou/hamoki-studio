/* Guide lost users back to existing canvas nodes, without changing node layout. */
'use strict';
(() => {
  let installed=null;
  const readNumber=(value,fallback=0)=>{
    const n=Number.parseFloat(value);
    return Number.isFinite(n)?n:fallback;
  };
  function init(){
    if(installed)return installed;
    const viewport=document.getElementById('canvas-viewport');
    const canvas=document.getElementById('canvas');
    if(!viewport||!canvas)return null;

    const toast=document.createElement('div');
    toast.className='hamoki-return-nodes';
    toast.hidden=true;
    toast.setAttribute('role','group');
    toast.setAttribute('aria-label','返回画布节点');

    const text=document.createElement('span');
    text.textContent='当前视图没有节点';
    const go=document.createElement('button');
    go.type='button';
    go.className='hamoki-return-nodes-go';
    go.textContent='返回节点';
    const close=document.createElement('button');
    close.type='button';
    close.className='hamoki-return-nodes-close';
    close.setAttribute('aria-label','关闭返回节点提示');
    close.textContent='×';
    toast.append(text,go,close);
    document.body.appendChild(toast);

    let ready=false,closedByUser=false,lastSelected=null,frame=0,delay=0;
    let returning=false,returnTimer=0;
    const origin=()=>window.HamokiViewport?.worldOrigin?.()||{left:0,top:0};
    const zoom=()=>Math.max(.1,readNumber(window.HamokiViewport?.getZoom?.(),1));
    const nonCanvas=()=>{
      const box=viewport.getBoundingClientRect();
      return !box.width||!box.height||!viewport.isConnected ||
        document.body.classList.contains('hamoki-templates-mode')||
        document.body.classList.contains('rie-open')||
        document.body.classList.contains('haop-open')||
        document.body.classList.contains('hs-modal-open');
    };
    const cards=()=>[...canvas.querySelectorAll('.canvas-node, .generation-frame')]
      .filter(card=>card.getClientRects().length);
    function rectOf(card){
      const left=readNumber(card.style.left);
      const top=readNumber(card.style.top);
      const w=Math.max(1,readNumber(card.style.width,card.offsetWidth||288));
      const h=Math.max(1,readNumber(card.style.height,card.offsetHeight||288));
      return {left,top,right:left+w,bottom:top+h,
        cx:left+w/2,cy:top+h/2,card,id:card.dataset.id||null};
    }
    function placeToast(){
      const v=viewport.getBoundingClientRect();
      // Position inside the actual visible canvas, never over the queue/sidebar.
      toast.style.left=Math.round(v.left+v.width/2)+'px';
      toast.style.top=Math.round(v.bottom-16)+'px';
    }
    function check(){
      if(!ready||nonCanvas()){toast.hidden=true;return;}
      const nodes=cards();
      if(!nodes.length){
        // A genuinely new/empty board has no destination to return to.
        toast.hidden=true;closedByUser=false;return;
      }
      placeToast();
      const z=zoom(),o=origin();
      const xmin=(viewport.scrollLeft-o.left)/z;
      const ymin=(viewport.scrollTop-o.top)/z;
      const xmax=xmin+viewport.clientWidth/z;
      const ymax=ymin+viewport.clientHeight/z;
      const hasNode=nodes.some(card=>{
        const box=rectOf(card);
        // A few pixels of the node must be genuinely within the viewing area.
        return box.right>xmin+3/z&&box.left<xmax-3/z&&
          box.bottom>ymin+3/z&&box.top<ymax-3/z;
      });
      if(hasNode){
        closedByUser=false;
        if(returning){returning=false;clearTimeout(returnTimer);}
      }
      toast.hidden=hasNode||closedByUser||returning;
    }
    function schedule(){
      if(frame)return;
      frame=requestAnimationFrame(()=>{frame=0;check();});
    }
    function sync(){
      // Render completes before the opening camera centers on the latest image.
      ready=true;toast.hidden=true;
      clearTimeout(delay);
      delay=setTimeout(schedule,300);
    }
    function remember(id){
      if(id)lastSelected=id;
    }
    function returnToNode(){
      if(!ready||nonCanvas())return;
      const items=cards().map(rectOf);
      if(!items.length){toast.hidden=true;return;}
      const z=zoom(),o=origin();
      const cx=(viewport.scrollLeft-o.left+viewport.clientWidth/2)/z;
      const cy=(viewport.scrollTop-o.top+viewport.clientHeight/2)/z;
      // Return to the previously selected image when possible. Otherwise use
      // the nearest *rendered* node so large scattered boards need not zoom to 10%.
      const target=items.find(n=>n.id&&n.id===lastSelected)||
        items.reduce((best,n)=>{
          const distance=(n.cx-cx)**2+(n.cy-cy)**2;
          return distance<best.distance?{node:n,distance}:best;
        },{node:null,distance:Infinity}).node;
      if(!target)return;
      const x=target.cx-viewport.clientWidth/(2*z);
      const y=target.cy-viewport.clientHeight/(2*z);
      const motion=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';
      returning=true;
      toast.hidden=true;
      if(window.HamokiViewport?.scrollToWorld)
        window.HamokiViewport.scrollToWorld(x,y,z,motion);
      else viewport.scrollTo({left:o.left+x*z,top:o.top+y*z,behavior:motion});
      clearTimeout(returnTimer);
      returnTimer=setTimeout(()=>{
        returning=false;
        schedule();
      },1500);
    }
    go.addEventListener('click',returnToNode);
    close.addEventListener('click',()=>{
      closedByUser=true;
      toast.hidden=true;
    });
    viewport.addEventListener('scroll',schedule,{passive:true});
    window.addEventListener('resize',schedule,{passive:true});
    document.addEventListener('visibilitychange',schedule,{passive:true});
    const observer=typeof ResizeObserver==='function'?new ResizeObserver(schedule):null;
    observer?.observe(viewport);
    installed={sync,remember,schedule,returnToNode,element:toast};
    return installed;
  }
  const api={
    sync:()=>init()?.sync(),
    remember:id=>init()?.remember(id),
    schedule:()=>init()?.schedule()
  };
  window.HamokiReturnNodes=api;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
