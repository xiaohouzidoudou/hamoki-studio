import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const modulePath=path.join(root,'lib/upstream.js');
function check(url,env={}){
 const command=`const {checkedURL}=require(${JSON.stringify(modulePath)});checkedURL(${JSON.stringify(url)}).then(()=>console.log('ALLOWED')).catch(e=>console.log('DENIED '+e.message));`;
 const c=spawnSync(process.execPath,['-e',command],{encoding:'utf8',env:{...process.env,NODE_ENV:'production',STUDIO_TRUSTED_SUB2_URL:'',...env}});
 assert.equal(c.status,0,c.stderr);
 return c.stdout.trim();
}
test('legacy SSRF protection stays strict by default',()=>{
 assert.match(check('http://127.0.0.1:51808/v1/models'),/^DENIED/);
 assert.match(check('http://10.0.0.1:51808/v1/models'),/^DENIED/);
});
test('private Sub2 exception is exact loopback v1 prefix and port',()=>{
 const env={STUDIO_TRUSTED_SUB2_URL:'http://127.0.0.1:51808/v1'};
 assert.equal(check('http://127.0.0.1:51808/v1',env),'ALLOWED');
 assert.equal(check('http://127.0.0.1:51808/v1/models',env),'ALLOWED');
 assert.match(check('http://127.0.0.1:51808/api/v1/admin/users',env),/^DENIED/);
 assert.match(check('http://127.0.0.1:8317/v1/models',env),/^DENIED/);
 assert.match(check('http://10.0.0.1:51808/v1/models',env),/^DENIED/);
});
