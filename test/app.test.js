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
test('GitHub Pages CORS, bearer browser sessions and API-only hosting',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'recall-pages-')),frontendOrigin='https://corbino50211.github.io';
 const s=createApp({dataDir:dir,origin:'https://api.example.com',frontendOrigin,invite:'test-invite'});await new Promise(r=>s.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+s.address().port;
 const req=(route,method='GET',body,token,origin=frontendOrigin)=>fetch(base+route,{method,headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
 try{
 const pre=await fetch(base+'/api/login',{method:'OPTIONS',headers:{Origin:frontendOrigin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,authorization'}});assert.equal(pre.status,204);assert.equal(pre.headers.get('access-control-allow-origin'),frontendOrigin);assert.equal(pre.headers.get('access-control-allow-credentials'),null);
 const bad=await fetch(base+'/api/login',{method:'OPTIONS',headers:{Origin:'https://evil.test','Access-Control-Request-Method':'POST'}});assert.equal(bad.status,403);assert.equal(bad.headers.get('access-control-allow-origin'),null);
 assert.equal((await req('/')).status,404);assert.equal((await req('/app.js')).status,404);
 const register=await req('/api/register','POST',{email:'pages@example.com',password:'long-password-123',invite:'test-invite',sessionMode:'bearer'});assert.equal(register.status,200);assert.equal(register.headers.get('set-cookie'),null);const {token}=await register.json();assert.ok(token);
 const me=await req('/api/me','GET',null,token);assert.equal(me.status,200);assert.equal(me.headers.get('access-control-allow-origin'),frontendOrigin);
 assert.equal((await req('/api/me','GET',null,token,'https://evil.test')).status,403);
 assert.equal((await req('/api/devices','POST',{name:'Pages-created device'},token)).status,201);
 assert.equal((await req('/api/memories','POST',{project:'pages',content:'Cross-origin memory'},token)).status,201);
 assert.equal((await (await req('/api/memories','GET',null,token)).json()).length,1);
 await req('/api/logout','POST',{},token);assert.equal((await req('/api/me','GET',null,token)).status,401);
 const login=await req('/api/login','POST',{email:'pages@example.com',password:'long-password-123',sessionMode:'bearer'});assert.equal(login.status,200);assert.ok((await login.json()).token);
 }finally{await close(s);rmSync(dir,{recursive:true,force:true});}
});
