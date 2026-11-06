import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const quotaBytes = 1024 ** 3;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
export class Accounts {
  constructor(dir){
    fs.mkdirSync(dir,{recursive:true});
    this.dir=dir;
    this.db = new DatabaseSync(path.join(dir,'accounts.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.db.exec('CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, hash TEXT, role TEXT NOT NULL DEFAULT \'user\', status TEXT NOT NULL DEFAULT \'active\', created TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 0, sub2_id TEXT UNIQUE, sub2_tokens TEXT, sub2_key TEXT, temp_expires INTEGER);');
    const cols=this.db.prepare('PRAGMA table_info(users)').all().map(x=>x.name);
    if(!cols.includes('sub2_key'))this.db.exec('ALTER TABLE users ADD COLUMN sub2_key TEXT');
    if(!cols.includes('temp_expires'))this.db.exec('ALTER TABLE users ADD COLUMN temp_expires INTEGER');
    this.db.exec('CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);');
    this.db.exec('CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT,action TEXT,target TEXT,created TEXT NOT NULL);');
    this.db.exec('CREATE TABLE IF NOT EXISTS image_tasks(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),dedupe_key TEXT NOT NULL,body_digest TEXT NOT NULL,remote_id TEXT,status TEXT NOT NULL,error TEXT,created TEXT NOT NULL,updated TEXT NOT NULL,UNIQUE(user_id,dedupe_key));');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_image_tasks_user ON image_tasks(user_id,created DESC);');
    // A restart after dispatch may lose the upstream task id. Never auto-reissue these paid calls.
    this.db.prepare("UPDATE image_tasks SET status='uncertain',error='进程重启中断提交，可能已经扣费；不会自动重试',updated=? WHERE status='submitting'").run(new Date().toISOString());
    this.keyFile=path.join(dir,'master.key');
    if(!fs.existsSync(this.keyFile))fs.writeFileSync(this.keyFile,crypto.randomBytes(32),{flag:'wx',mode:0o600});
    this.master=fs.readFileSync(this.keyFile);
    if(this.master.length!==32)throw Error('Master key length invalid');
    // Administrator authority is mapped to an explicitly configured, verified
    // Sub2 user ID. A first visitor never becomes administrator automatically.
    this.adminSub2Id=String(process.env.STUDIO_ADMIN_SUB2_ID||'');
    if(this.adminSub2Id&&!/^[1-9][0-9]*$/.test(this.adminSub2Id))throw Error('STUDIO_ADMIN_SUB2_ID must be a positive integer');
    // Old activation.hash may remain in a pre-existing volume; it is ignored.
  }
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r}catch(e){this.db.exec('ROLLBACK');throw e}}
  audit(actor,action,target){this.db.prepare('INSERT INTO audit(actor,action,target,created) VALUES(?,?,?,?)').run(actor,action,target,new Date().toISOString())}
  getById(id){return this.db.prepare('SELECT id,username,role,status,created,must_change,sub2_id FROM users WHERE id=?').get(id)}
  createSession(id){
    if(!this.getById(id)?.sub2_id)throw Object.assign(Error('只允许 Sub2 账号登录'),{statusCode:403});
    const t=crypto.randomBytes(32).toString('hex');
    this.db.prepare('INSERT INTO sessions(token_hash,user_id,expires) VALUES(?,?,?)').run(digest(t),id,Date.now()+30*864e5);
    return t;
  }
  session(token){
    if(!token||! /^[0-9a-f]{64}$/.test(token))return null;
    const row=this.db.prepare('SELECT u.id,u.username,u.role,u.status,u.must_change,u.sub2_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?').get(digest(token),Date.now());
    if(row?.status!=='active'||!row.sub2_id)return null;
    return {...row,role:this.adminSub2Id&&String(row.sub2_id)===this.adminSub2Id?'admin':'user',must_change:0};
  }
  revokeSessions(id){this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id)}
  logout(token){if(token)this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token))}
  listUsers(){return this.db.prepare('SELECT id,username,role,status,created,must_change,sub2_id FROM users ORDER BY created DESC').all()}
  disable(id,actor,disabled){
    const u=this.getById(id);
    if(!u||u.role==='admin'||String(u.sub2_id)===this.adminSub2Id)throw Object.assign(Error('不允许禁用管理员'),{statusCode:403});
    this.db.prepare('UPDATE users SET status=? WHERE id=?').run(disabled?'disabled':'active',id);
    if(disabled)this.revokeSessions(id);
    this.audit(actor,disabled?'user.disable':'user.enable',id);
  }
  encrypt(obj){
    const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.master,iv);
    const bytes=Buffer.concat([cipher.update(JSON.stringify(obj),'utf8'),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64');
  }
  decrypt(encoded){
    if(!encoded)return null;
    const bytes=Buffer.from(encoded,'base64'),iv=bytes.subarray(0,12),tag=bytes.subarray(12,28);
    const dec=crypto.createDecipheriv('aes-256-gcm',this.master,iv);dec.setAuthTag(tag);
    return JSON.parse(Buffer.concat([dec.update(bytes.subarray(28)),dec.final()]).toString('utf8'));
  }
  sub2Identity(sub2Id,username,tokens){
    const id=String(sub2Id);
    if(!/^[1-9][0-9]*$/.test(id))throw Object.assign(Error('Sub2 身份 ID 不合法'),{statusCode:502});
    return this.transaction(()=>{
      let u=this.db.prepare('SELECT id FROM users WHERE sub2_id=?').get(id);
      if(!u){
        const uid=crypto.randomUUID();
        const clean=String(username||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,20);
        const display='sub2_'+(clean||'user')+'_'+digest(id).slice(0,6);
        const role=this.adminSub2Id===id?'admin':'user';
        this.db.prepare('INSERT INTO users(id,username,hash,role,status,created,sub2_id) VALUES(?,?,?,?,?,?,?)').run(uid,display,null,role,'active',new Date().toISOString(),id);
        u={id:uid};
      }
      const role=this.adminSub2Id===id?'admin':'user';
      this.db.prepare('UPDATE users SET sub2_tokens=?,role=?,must_change=0 WHERE id=?').run(this.encrypt(tokens),role,u.id);
      const result=this.getById(u.id);
      return {...result,role};
    });
  }
  sub2Tokens(id){
    const r=this.db.prepare('SELECT sub2_tokens FROM users WHERE id=?').get(id);
    return this.decrypt(r?.sub2_tokens);
  }
  updateSub2Tokens(id,tokens){
    this.db.prepare('UPDATE users SET sub2_tokens=? WHERE id=? AND sub2_id IS NOT NULL').run(this.encrypt(tokens),id);
  }
  sub2Key(id){
    const r=this.db.prepare('SELECT sub2_key FROM users WHERE id=?').get(id);
    return this.decrypt(r?.sub2_key)?.key||null;
  }
  setSub2Key(id,key){this.db.prepare('UPDATE users SET sub2_key=? WHERE id=?').run(this.encrypt({key}),id)}
  createImageTask(userId,dedupeKey,bodyDigest){
    return this.transaction(()=>{
      const existing=this.db.prepare('SELECT * FROM image_tasks WHERE user_id=? AND dedupe_key=?').get(userId,dedupeKey);
      if(existing){
        if(existing.body_digest!==bodyDigest)throw Object.assign(Error('同一个任务编号不能用于不同的生成请求'),{statusCode:409});
        return {task:existing,created:false};
      }
      const id=crypto.randomUUID(),now=new Date().toISOString();
      this.db.prepare('INSERT INTO image_tasks(id,user_id,dedupe_key,body_digest,status,created,updated) VALUES(?,?,?,?,?,?,?)').run(id,userId,dedupeKey,bodyDigest,'submitting',now,now);
      return {task:this.getImageTask(userId,id),created:true};
    });
  }
  getImageTask(userId,id){
    return this.db.prepare('SELECT id,user_id,remote_id,status,error,created,updated FROM image_tasks WHERE user_id=? AND id=?').get(userId,id)||null;
  }
  imageTasks(userId){
    return this.db.prepare('SELECT id,remote_id,status,error,created,updated FROM image_tasks WHERE user_id=? ORDER BY created DESC LIMIT 80').all(userId);
  }
  updateImageTask(userId,id,status,remoteId=null,error=null){
    if(!['processing','done','failed','uncertain','expired'].includes(status))throw Error('任务状态不合法');
    this.db.prepare('UPDATE image_tasks SET status=?,remote_id=COALESCE(?,remote_id),error=?,updated=? WHERE user_id=? AND id=?').run(status,remoteId,error,new Date().toISOString(),userId,id);
    return this.getImageTask(userId,id);
  }
  userMediaBytes(id){
    const base=path.join(this.dir,'users',id);
    let total=0;
    for(const folder of ['media','previews']){
      const d=path.join(base,folder);
      if(fs.existsSync(d))for(const ent of fs.readdirSync(d,{withFileTypes:true}))if(ent.isFile())total+=fs.statSync(path.join(d,ent.name)).size;
    }
    return total;
  }
  quota(id){return {usedBytes:this.userMediaBytes(id),quotaBytes,remainingBytes:Math.max(0,quotaBytes-this.userMediaBytes(id))}}
}
