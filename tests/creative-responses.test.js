'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
process.env.NODE_ENV='test';
process.env.ALLOW_PRIVATE_UPSTREAMS='1';
const {generateText,analyzeCreativeImages}=require('../lib/upstream');
async function fakeRelay(t,kind='endpoint-rejected'){
 const paths=[],bodies=[];
 const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);
  const body=JSON.parse(Buffer.concat(chunks).toString()||'{}');
  paths.push(req.url);bodies.push(body);res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/chat/completions'){
   res.statusCode=kind==='rate-limit'?429:400;
   return res.end(JSON.stringify({error:{message:kind==='rate-limit'?'Too many requests':'This model is not supported on the Chat Completions endpoint'}}));
  }
  if(req.url==='/v1/responses'){
   if(kind==='no-responses'){res.statusCode=404;return res.end(JSON.stringify({error:{message:'not found'}}))}
   return res.end(JSON.stringify({output:[{type:'reasoning',summary:[]},{type:'message',content:[{type:'output_text',text:'最终生图提示词：周年庆活动 UI，金属切角面板'}]}]}));
  }
  res.statusCode=404;res.end(JSON.stringify({error:'missing'}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 return {provider:{url:'http://127.0.0.1:'+server.address().port+'/v1',apiKey:'fake',mode:'openai'},paths,bodies};
}
test('GPT-style text model retries on Responses only when Chat endpoint explicitly unsupported',async t=>{
 const relay=await fakeRelay(t);
 const text=await generateText(relay.provider,{model:'gpt-6.1-sol',prompt:'周年庆设计',maxOutputTokens:3000});
 assert.match(text,/周年庆活动/);
 assert.deepEqual(relay.paths,['/v1/chat/completions','/v1/responses']);
 assert.equal(relay.bodies[1].model,'gpt-6.1-sol');
 assert.equal(relay.bodies[1].store,false);
 assert.equal(relay.bodies[1].input[0].content[0].type,'input_text');
});
test('vision Responses input carries images, not only text',async t=>{
 const relay=await fakeRelay(t);
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==','base64');
 const result=await analyzeCreativeImages(relay.provider,[{mime:'image/png',bytes:image}],'gpt-6.1-sol','分析游戏 UI');
 assert.match(result,/周年庆活动/);
 assert.deepEqual(relay.paths,['/v1/chat/completions','/v1/responses']);
 assert.equal(relay.bodies[1].input[0].content[0].type,'input_text');
 assert.equal(relay.bodies[1].input[0].content[1].type,'input_image');
 assert.match(relay.bodies[1].input[0].content[1].image_url,/^data:image\/png;base64,/);
});
test('429 is not retried or double charged through Responses',async t=>{
 const relay=await fakeRelay(t,'rate-limit');
 await assert.rejects(generateText(relay.provider,{model:'gpt-6.1-sol',prompt:'test'}),/HTTP 429/);
 assert.deepEqual(relay.paths,['/v1/chat/completions']);
});
test('unavailable Responses produces direct compatibility instruction',async t=>{
 const relay=await fakeRelay(t,'no-responses');
 await assert.rejects(generateText(relay.provider,{model:'gpt-6.1-sol',prompt:'test'}),/没有开放 \/responses/);
 assert.deepEqual(relay.paths,['/v1/chat/completions','/v1/responses']);
});
