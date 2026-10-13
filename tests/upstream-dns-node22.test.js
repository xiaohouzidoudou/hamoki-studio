'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const dns=require('node:dns').promises;
process.env.NODE_ENV='test';
process.env.ALLOW_PRIVATE_UPSTREAMS='1';
const {remote}=require('../lib/upstream');
test('Node.js 22 DNS pinned lookup supports opts.all and returns a public upstream body',async()=>{
 const server=http.createServer((req,res)=>{
   assert.equal(req.url,'/v1/models');
   res.writeHead(200,{'Content-Type':'application/json'});
   res.end(JSON.stringify({data:[{id:'safe-test-model'}]}));
 });
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const old=dns.lookup;
 try{
   dns.lookup=async(host,opts)=>{
     assert.equal(host,'hamoki-api.example');
     assert.equal(opts.all,true);
     return [{address:'127.0.0.1',family:4}];
   };
   const url='http://hamoki-api.example:'+server.address().port+'/v1/models';
   const response=await remote(url,{timeout:10000});
   assert.equal(response.status,200);
   assert.deepEqual(JSON.parse(response.body.toString()).data,[{id:'safe-test-model'}]);
 }finally{
   dns.lookup=old;
   await new Promise(ok=>server.close(ok));
 }
});
