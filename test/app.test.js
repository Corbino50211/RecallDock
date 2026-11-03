import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createApp} from '../server.js';
import {redact} from '../plugin/scripts/recall.mjs';
const origin='http://localhost:3000';
async function listen(dir){const s=createApp({dataDir:dir,origin,invite:'test-invite'});await new Promise(r=>s.listen(0,'127.0.0.1',r));return {s,url:'http://127.0.0.1:'+s.address().port};}
const close=s=>new Promise(r=>s.close(r));
test('accounts, devices, tenant isolation, deduplication, persistence, CSRF, export and revocation',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'recall-'));let {s,url}=await listen(dir);
 const req=async(route,method='GET',data,cookie,token,requestOrigin=origin)=>{const r=await fetch(url+'/api/'+route,{method,headers:{'Content-Type':'application/json',Origin:requestOrigin,...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{
 assert.equal((await req('register','POST',{email:'a@example.com',password:'long-password-123',invite:'wrong'})).status,403);
 const a=await req('register','POST',{email:'a@example.com',password:'long-password-123',invite:'test-invite'});assert.equal(a.status,200);
 const b=await req('register','POST',{email:'b@example.com',password:'long-password-123',invite:'test-invite'});
 assert.equal((await req('login','POST',{email:'a@example.com',password:'bad'})).status,401);
 assert.equal((await req('devices','POST',{name:'bad'},a.cookie,null,'https://evil.test')).status,403);
 const d1=(await req('devices','POST',{name:'laptop'},a.cookie)).body.token;
 const d2=(await req('devices','POST',{name:'desktop'},a.cookie)).body.token;
 assert.equal((await req('memories','POST',{project:'demo',content:'Remember the blue button',source:'one'},null,d1)).status,201);
 await req('memories','POST',{project:'demo',content:'Remember the blue button',source:'one'},null,d1);
 assert.equal((await req('memories?project=demo', 'GET',null,null,d2)).body.length,1);
 assert.equal((await req('memories','GET',null,b.cookie)).body.length,0);
 assert.equal((await req('memories?project=other','GET',null,a.cookie)).body.length,0);
 assert.equal((await req('memories?q=blue','GET',null,a.cookie)).body.length,1);
 assert.equal((await req('devices','POST',{name:'escalation'},null,d1)).status,403);
 const memory=(await req('memories','GET',null,a.cookie)).body[0];
 await req('memories/'+memory.id,'DELETE',null,b.cookie);
 assert.equal((await req('export','GET',null,a.cookie)).body.length,1);
 await close(s);({s,url}=await listen(dir));
 assert.equal((await req('memories','GET',null,null,d2)).body.length,1);
 const device=(await req('devices','GET',null,a.cookie)).body.find(d=>d.name==='laptop');await req('devices/'+device.id,'DELETE',null,a.cookie);
 assert.equal((await req('memories','GET',null,null,d1)).status,401);
 await req('memories/'+memory.id,'DELETE',null,a.cookie);assert.equal((await req('memories','GET',null,a.cookie)).body.length,0);
 await req('logout','POST',{},a.cookie);assert.equal((await req('me','GET',null,a.cookie)).status,401);
 }finally{await close(s);rmSync(dir,{recursive:true,force:true});}
});
function run(home,cwd,args,input=''){return new Promise(resolve=>{const child=spawn(process.execPath,[path.resolve('plugin/scripts/recall.mjs'),...args],{cwd,env:{...process.env,RECALL_HOME:home}});let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('close',code=>resolve({code,out,err}));child.stdin.end(input);});}
test('real hook processes capture, reload, pause and queue offline',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'recall-hooks-')),home=path.join(root,'home'),cwd=path.join(root,'project');mkdirSync(home);mkdirSync(cwd);const {s,url}=await listen(path.join(root,'db'));
 try{let r=await fetch(url+'/api/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'hook@example.com',password:'long-password-123',invite:'test-invite'})});const cookie=r.headers.get('set-cookie').split(';')[0];r=await fetch(url+'/api/devices',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({name:'test'})});const {token}=await r.json();writeFileSync(path.join(home,'config.json'),JSON.stringify({url,token}));
 assert.equal((await run(home,cwd,['project','same-project'])).code,0);
 const event={cwd,session_id:'session',last_assistant_message:'We chose SQLite. password=secret123'};
 assert.equal((await run(home,cwd,['hook','stop'],JSON.stringify(event))).code,0);
 const start=await run(home,cwd,['hook','start'],JSON.stringify({cwd}));assert.match(start.out,/SQLite/);assert.doesNotMatch(start.out,/secret123/);
 await run(home,cwd,['pause']);await run(home,cwd,['hook','stop'],JSON.stringify({...event,last_assistant_message:'DO NOT CAPTURE'}));assert.doesNotMatch((await run(home,cwd,['hook','start'],JSON.stringify({cwd}))).out,/DO NOT CAPTURE/);
 writeFileSync(path.join(home,'config.json'),JSON.stringify({url:'http://127.0.0.1:1',token}));await run(home,cwd,['project','same-project']);const offline=await run(home,cwd,['hook','stop'],JSON.stringify(event));assert.equal(offline.code,0);assert.ok(readdirSync(path.join(home,'queue'),{recursive:true}).some(x=>x.endsWith('.json')));
 }finally{await close(s);rmSync(root,{recursive:true,force:true});}
});
test('redacts private sections and common secrets',()=>{assert.equal(redact('<private>hidden</private> password=secret Bearer abc.def'),'[private] password=[redacted] Bearer [redacted]');});
