'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
test('chat model selection falls back to saved provider defaults after edits without forcing a second manual selection',()=>{
 assert.match(source,/model:\(r\?\.model\|\|initialRuntimeModel\(p,cap\)\|\|''\)\.trim\(\)/);
 assert.match(source,/if\(!r\.model\)r\.model=initialRuntimeModel\(p,cap\)\|\|'';/);
 assert.match(source,/const explicit=p\?\.capabilities\?\.\[cap\]\?\.defaultModel/);
});
