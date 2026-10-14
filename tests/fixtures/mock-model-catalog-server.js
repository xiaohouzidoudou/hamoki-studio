'use strict';
// Local-only catalog and completion relay for browser smoke tests. No real upstream calls.
const http=require('node:http');
const models=['mock-text-1','mock-text-2','mock-vision-1','mock-vision-2'];
http.createServer(async(req,res)=>{
 let data='';for await(const part of req)data+=part;
 res.setHeader('Content-Type','application/json');
 if(req.method==='GET'&&req.url.endsWith('/models'))return res.end(JSON.stringify({data:models.map(id=>({id}))}));
 if(req.method==='POST'&&req.url.endsWith('/chat/completions')){
  const body=JSON.parse(data||'{}');const images=Array.isArray(body.messages?.[0]?.content);
  const response=images?'# 模拟视觉分析\n- 页面结构完整；仅用于 UI 测试。':'最终生图提示词：\n真实游戏 UI 需要实际模型才能制作。\n质检清单：核对布局。';
  return res.end(JSON.stringify({id:'mock-completion',model:body.model,choices:[{message:{role:'assistant',content:response}}]}));
 }
 res.statusCode=404;res.end(JSON.stringify({error:'unrecognized mock route'}));
}).listen(8140,'127.0.0.1',()=>console.log('Mock catalog ready on 127.0.0.1:8140'));
