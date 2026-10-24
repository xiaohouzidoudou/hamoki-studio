const test=require('node:test'),assert=require('node:assert/strict');
test('完整备份下载按块写入，完成才提交文件；断流取消保留旧文件',async t=>{
 const {downloadArchive}=await import('../cowart/src/canvas/archiveTransfer.js');
 const original=global.fetch;t.after(()=>{global.fetch=original});
 let writes=[],closed=false,aborted=false,created=0;
 const destination={async createWritable(){created++;return {async write(bytes){writes.push(Buffer.from(bytes).toString())},async close(){closed=true},async abort(){aborted=true}}}};
 global.fetch=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(Buffer.from('ZIP'));controller.enqueue(Buffer.from('DATA'));controller.close()}}),{headers:{'content-type':'application/zip','content-length':'7'}});
 await downloadArchive('own',destination);
 assert.deepEqual(writes,['ZIP','DATA']);assert.equal(closed,true);assert.equal(aborted,false);
 writes=[];closed=false;
 global.fetch=async()=>new Response(Buffer.from('ZIP'),{headers:{'content-type':'application/zip','content-length':'7'}});
 await assert.rejects(downloadArchive('own',destination),/不完整/);
 assert.equal(closed,false);assert.equal(aborted,true);assert.equal(created,2);
});
test('完整备份下载 API 错误不创建文件，大文件回退不分配整块内存',async t=>{
 const {downloadArchive}=await import('../cowart/src/canvas/archiveTransfer.js');
 const original=global.fetch;t.after(()=>{global.fetch=original});
 let created=0,cancelled=false;
 const destination={async createWritable(){created++;throw Error('unexpected')}};
 global.fetch=async()=>new Response(JSON.stringify({error:'原图缺失'}),{status:409,headers:{'content-type':'application/json'}});
 await assert.rejects(downloadArchive('own',destination),/原图缺失/);assert.equal(created,0);
 global.fetch=async()=>new Response(new ReadableStream({cancel(){cancelled=true}}),{headers:{'content-type':'application/zip','content-length':String(101*1024**2)}});
 await assert.rejects(downloadArchive('own',null),/大备份/);assert.equal(cancelled,true);
 const stop=new AbortController();stop.abort();
 global.fetch=async()=>new Response(Buffer.from('ZIP'),{headers:{'content-type':'application/zip','content-length':'3'}});
 await assert.rejects(downloadArchive('own',destination,{signal:stop.signal}),{name:'AbortError'});
 assert.equal(created,0);
});
