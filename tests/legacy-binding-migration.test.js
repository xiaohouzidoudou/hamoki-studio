'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../workspace.js'),'utf8');
test('retire legacy route once while preserving encrypted provider API credentials and independent configuration',()=>{
 const start=source.indexOf('let state=decrypt(),history=readData(historyFile,[]);'),end=source.indexOf('const CAPABILITIES=',start);
 assert(start>=0&&end>start);
 const state={activeId:'one',providers:[
  {id:'one',name:'alpha',apiKey:'sk-BASE',capabilities:{text:{inheritApiKey:false,apiKey:'sk-TEXT',mode:'openai'}}},
  {id:'two',name:'beta',apiKey:'sk-SECOND',capabilities:{vision:{inheritBaseUrl:false,baseUrl:'https://vision.test/v1'}}}
 ],bindings:{text:{providerId:'one',model:'selected-chat-model'},vision:{providerId:'two',model:'selected-vision-model'},image:{providerId:'two',model:'old-default-image'}}};
 let persisted;
 const ctx=vm.createContext({decrypt:()=>structuredClone(state),readData:()=>[],historyFile:'x',encrypt:next=>{persisted=structuredClone(next)}});
 vm.runInContext(source.slice(start,end),ctx);
 assert(persisted,'legacy routing should be migrated once');
 assert.equal(Object.hasOwn(persisted,'bindings'),false);
 assert.equal(persisted.providers[0].apiKey,'sk-BASE');
 assert.equal(persisted.providers[0].capabilities.text.apiKey,'sk-TEXT');
 assert.equal(persisted.providers[0].capabilities.text.defaultModel,'selected-chat-model');
 assert.equal(persisted.providers[1].apiKey,'sk-SECOND');
 assert.equal(persisted.providers[1].capabilities.vision.baseUrl,'https://vision.test/v1');
 assert.equal(persisted.providers[1].capabilities.vision.defaultModel,'selected-vision-model');
 assert.equal(persisted.providers[1].capabilities.image?.defaultModel,undefined,'do not resurrect stale image route');
});
test('migrated account is not re-encrypted on subsequent workspace initialization',()=>{
 const start=source.indexOf('let state=decrypt(),history=readData(historyFile,[]);'),end=source.indexOf('const CAPABILITIES=',start);
 let writes=0;
 const ctx=vm.createContext({decrypt:()=>({providers:[{id:'one',apiKey:'sk-preserved'}],activeId:'one'}),readData:()=>[],historyFile:'x',encrypt:()=>writes++});
 vm.runInContext(source.slice(start,end),ctx);
 assert.equal(writes,0);
});
