'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
process.env.NODE_ENV='test';
process.env.ALLOW_PRIVATE_UPSTREAMS='1';
const {generate}=require('../lib/upstream');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==','base64');
async function fake(t){
 const calls=[];
 const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  calls.push({path:req.url,body:Buffer.concat(chunks),contentType:req.headers['content-type']});
  res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/chat/completions'){
   if(JSON.parse(Buffer.concat(chunks).toString()).model==='custom-chat-image'){
    return res.end(JSON.stringify({choices:[{message:{content:'data:image/png;base64,'+png.toString('base64')}}]}));
   }
   res.statusCode=400;
   return res.end(JSON.stringify({error:{message:'This model is not supported on the Chat Completions endpoint'}}));
  }
  if(req.url.startsWith('/v1/images/')){
   return res.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));
  }
  res.statusCode=404;res.end('{}');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>server.close());
 return {provider:{url:'http://127.0.0.1:'+server.address().port+'/v1',apiKey:'fixture',mode:'openai',imageMode:'chat'},calls};
}
test('GPT Image 2.5 ignores generic chat-image mode when provided with style and layout references',async t=>{
 const mock=await fake(t);
 const refs=[{mime:'image/png',bytes:png},{mime:'image/png',bytes:png}];
 const task={model:'gpt-image-2.5',prompt:'anniversary game UI',ratio:'9:16',resolution:'1K',quality:'auto',roleHints:['style','shape']};
 const result=await generate(mock.provider,task,refs,null);
 assert.equal(result.mime,'image/png');
 assert.deepEqual(mock.calls.map(x=>x.path),['/v1/images/edits']);
 assert.match(mock.calls[0].contentType,/multipart\/form-data/);
 assert.match(mock.calls[0].body.toString('latin1'),/name="image\[\]"/);
 assert.match(mock.calls[0].body.toString('latin1'),/gpt-image-2.5/);
 assert.match(mock.calls[0].body.toString('latin1'),/864x1536/);
});
test('custom chat image models retain chat routing and both reference images',async t=>{
 const mock=await fake(t);
 const refs=[{mime:'image/png',bytes:png},{mime:'image/png',bytes:png}];
 const result=await generate(mock.provider,{model:'custom-chat-image',prompt:'game UI',ratio:'9:16',resolution:'1K',roleHints:['style','shape']},refs,null);
 assert.equal(result.mime,'image/png');
 assert.deepEqual(mock.calls.map(x=>x.path),['/v1/chat/completions']);
 const body=JSON.parse(mock.calls[0].body.toString());
 assert.equal(body.messages[0].content.filter(x=>x.type==='image_url').length,2);
});
test('DALL-E models ignore generic chat mode for generation',async t=>{
 const mock=await fake(t);
 await generate(mock.provider,{model:'dall-e-3',prompt:'game UI',ratio:'1:1',resolution:'1K',roleHints:[]},[],null);
 assert.deepEqual(mock.calls.map(x=>x.path),['/v1/images/generations']);
});
test('GPT Image 2.5 without references uses image generations, not Chat Completions',async t=>{
 const mock=await fake(t);
 const task={model:'gpt-image-2.5',prompt:'anniversary game UI',ratio:'9:16',resolution:'1K',quality:'auto',roleHints:[]};
 const result=await generate(mock.provider,task,[],null);
 assert.equal(result.mime,'image/png');
 assert.deepEqual(mock.calls.map(x=>x.path),['/v1/images/generations']);
 const parsed=JSON.parse(mock.calls[0].body.toString());
 assert.equal(parsed.model,'gpt-image-2.5');
 assert.equal(parsed.size,'864x1536');
});
