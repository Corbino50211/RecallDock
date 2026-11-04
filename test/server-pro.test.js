import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const root=path.resolve('server.pro');
test('upload folder contains the current backend',()=>assert.equal(readFileSync(path.join(root,'backend.js'),'utf8'),readFileSync('server.js','utf8')));
test('standalone upload starts from another cwd, creates invite and persists accounts across restart',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'recall-upload-'));cpSync(root,dir,{recursive:true});
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 writeFileSync(path.join(dir,'settings.json'),JSON.stringify({port,frontendOrigin:'https://corbino50211.github.io',tunnel:false}));
 let child;
 async function boot(){child=spawn(process.execPath,[path.join(dir,'server.js')],{cwd:tmpdir(),env:{...process.env,PORT:String(port)}});let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);for(let n=0;n<100;n++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok)return;}catch{}if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,30));}throw Error('Startup timeout');}
 async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}}
 const call=(route,body)=>fetch(`http://127.0.0.1:${port}/api/${route}`,{method:'POST',headers:{Origin:'https://corbino50211.github.io','Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
 await boot();const invite=readFileSync(path.join(dir,'data/invite-code.txt'),'utf8').trim();assert.ok(invite.length>=24);
 const credentials={email:'upload@example.com',password:'long-password-123',sessionMode:'bearer'};
 assert.equal((await call('register',{...credentials,invite})).status,200);
 const page=await fetch(`http://127.0.0.1:${port}/`);assert.equal(page.status,200);assert.match(await page.text(),/authStatus/);
 const config=await fetch(`http://127.0.0.1:${port}/config.js`);assert.match(await config.text(),/sameOrigin: true/);
 const login=await fetch(`http://127.0.0.1:${port}/api/login`,{method:'POST',headers:{Origin:`http://127.0.0.1:${port}`,'Content-Type':'application/json'},body:JSON.stringify(credentials)});assert.equal(login.status,200);
 const rejected=await fetch(`http://127.0.0.1:${port}/api/login`,{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify(credentials)});assert.equal(rejected.status,403);
 await stop();await boot();assert.equal(readFileSync(path.join(dir,'data/invite-code.txt'),'utf8').trim(),invite);assert.equal((await call('login',credentials)).status,200);
 }finally{await stop();rmSync(dir,{recursive:true,force:true});}
});
