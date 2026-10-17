// Bounded metadata-only view of the selected tldraw content for server AI planning.
// The planner NEVER receives image data URLs, source URLs, credentials or raw snapshots.
function textOf(value, limit = 280){
  if(typeof value==='string')return value.slice(0,limit);
  if(!value||typeof value!=='object')return '';
  const parts=[];
  function visit(v,depth){
    if(depth>5||parts.join('').length>limit)return;
    if(typeof v==='string')return;
    if(Array.isArray(v)){for(const item of v.slice(0,24))visit(item,depth+1);return;}
    if(typeof v.text==='string')parts.push(v.text);
    if(v.content)visit(v.content,depth+1);
  }
  visit(value,0);
  return parts.join(' ').slice(0,limit);
}
function boundsOf(editor,shape){
  try {
    const b=editor.getShapePageBounds(shape);
    return b&&{x:b.x,y:b.y,w:b.w,h:b.h};
  }catch{return null}
}
function near(a,b,pad=90){
  if(!a||!b)return false;
  return !(a.x+a.w+pad<b.x||b.x+b.w+pad<a.x||a.y+a.h+pad<b.y||b.y+b.h+pad<a.y);
}
export function summarizeCanvasSelection(editor) {
  if(!editor)return [];
  const selected=editor.getSelectedShapes().slice(0,8);
  const ids=new Set(selected.map(s=>s.id));
  let all=[];
  try{all=Array.from(editor.getCurrentPageShapeIds()).map(id=>editor.getShape(id)).filter(Boolean)}catch{}
  const annotations=all.filter(s=>!ids.has(s.id)&&['text','arrow','note'].includes(s.type))
    .map(s=>({shape:s,bounds:boundsOf(editor,s),text:textOf(s.props?.richText||s.props?.text||s.props?.name)}))
    .filter(x=>x.text);
  const results=selected.map(s=>{
    const b=boundsOf(editor,s);
    return {
      kind:['image','text','arrow','frame','note'].includes(s.type)?s.type:'shape',
      selected:true,
      isHolder:!!s.meta?.cowartAiImageHolder,
      isGenerated:!!s.meta?.studioHistoryId,
      width:Math.round(Number(s.props?.w)||b?.w||0),
      height:Math.round(Number(s.props?.h)||b?.h||0),
      text:textOf(s.props?.richText||s.props?.text||s.props?.name),
      annotations:annotations.filter(x=>near(b,x.bounds)).slice(0,6).map(x=>x.text)
    };
  });
  // When editing a selected source image, neighboring annotation arrows and notes
  // may be unselected. Their text is still supplied in the planning context.
  return results;
}
