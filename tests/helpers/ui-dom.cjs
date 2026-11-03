// Minimal DOM test double for offline event tests; does not claim browser layout coverage.
const fs=require('node:fs'),path=require('node:path');
module.exports=function(){
 const observers=[],pending=new Set();
 function changed(node){for(const observer of observers)if(observer.target&&(observer.target===node||observer.options.subtree&&observer.target.contains(node)))pending.add(observer)}
 class Element{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.attrs={};this.dataset={};this.listeners={};this.style={};this.value='';this.disabled=false;this._text='';this.className='';this.classList={contains:c=>this.className.split(/\s+/).includes(c),add:(...cs)=>{for(const c of cs)if(!this.classList.contains(c))this.className+=' '+c},remove:(...cs)=>{this.className=this.className.split(/\s+/).filter(c=>!cs.includes(c)).join(' ')},toggle:(c,value)=>{const yes=value??!this.classList.contains(c);this.classList[yes?'add':'remove'](c);return yes}}}
  set textContent(v){this._text=String(v);this.children=[];changed(this)}
  get textContent(){return this._text+this.children.map(x=>x.textContent).join('')}
  setAttribute(k,v){this.attrs[k]=String(v);if(k==='id')this.id=v;if(k==='class')this.className=v;if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=v}
  removeAttribute(k){delete this.attrs[k];delete this[k]}
  getAttribute(k){return this.attrs[k]}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node)}changed(this)}
  add(node){this.append(node)}
  replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes)}
  remove(){if(this.parent){this.parent.children=this.parent.children.filter(n=>n!==this);changed(this.parent);this.parent=null}}
  before(node){const p=this.parent;node.parent=p;p.children.splice(p.children.indexOf(this),0,node);changed(p)}
  after(node){const p=this.parent;node.parent=p;p.children.splice(p.children.indexOf(this)+1,0,node);changed(p)}
  contains(node){return node===this||this.children.some(c=>c.contains(node))}
  matches(selector){if(selector.includes(']['))return selector.match(/\[[^\]]+\]/g).every(part=>this.matches(part));if(selector.startsWith('#'))return this.id===selector.slice(1);if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));if(selector.startsWith('[')){const [,attr,value]=selector.match(/^\[([^=\]]+)(?:="?([^"\]]+)"?)?\]$/)||[];return attr?.startsWith('data-')?value?this.dataset[attr.slice(5)]===value:attr.slice(5) in this.dataset:attr in this.attrs}return this.tagName===selector}
  querySelectorAll(selector){const all=[];for(const child of this.children){if(child.matches(selector))all.push(child);all.push(...child.querySelectorAll(selector))}return all}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn)}
  async fire(type,extra={}){for(const fn of this.listeners[type]||[])await fn({target:this,...extra});if(this['on'+type])await this['on'+type]({target:this,...extra})}
  click(){return this.fire('click')}
  focus(){this.focused=true}
 }
 const document=new Element('document');document.readyState='complete';document.createElement=tag=>new Element(tag);document.createTextNode=text=>{const e=new Element('text');e.textContent=text;return e};document.getElementById=id=>document.querySelector('#'+id);document.dispatchEvent=event=>document.fire(event.type);
 const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8'),stack=[document];
 for(const match of html.matchAll(/<!--[\s\S]*?-->|<\/?[\w-]+\b[^>]*>/g)){
  const token=match[0];if(token.startsWith('<!--'))continue;
  const tag=token.match(/^<\/?([\w-]+)/)[1].toLowerCase();if(token.startsWith('</')){const i=stack.findLastIndex(e=>e.tagName===tag);if(i>0)stack.length=i;continue}
  const node=new Element(tag);for(const a of token.matchAll(/([\w:-]+)="([^"]*)"/g))node.setAttribute(a[1],a[2]);stack.at(-1).append(node);
  if(!/\/$/.test(token.slice(0,-1))&&!['input','img','meta','link','br','use','path','circle','rect','line','hr'].includes(tag))stack.push(node);
 }
 class MutationObserver{constructor(fn){this.fn=fn;observers.push(this)}observe(target,options){this.target=target;this.options=options}disconnect(){this.target=null;pending.delete(this)}}
 return {document,Element,MutationObserver,flush(){let rounds=0;while(pending.size){if(++rounds>20)throw Error('MutationObserver did not settle');const list=[...pending];pending.clear();for(const o of list)if(o.target)o.fn()}return rounds}};
};
