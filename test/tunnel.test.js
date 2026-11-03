import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,mkdirSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startTunnel} from '../server.pro/tunnel.js';
const until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');};
test('tunnel URL capture, recovery and shutdown with simulated child processes',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'recall-tunnel-'));mkdirSync(path.join(root,'data'));const children=[],logs=[];let stop;
 try{stop=startTunnel({root,port:300,prepare:async()=>'/test/cloudflared',retryMs:5,log:s=>logs.push(s),spawnProcess:(file,args)=>{assert.ok(args.includes('http://127.0.0.1:300'));assert.ok(args.includes('http2'));const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.exitCode=null;c.kill=()=>{c.exitCode=0;c.emit('exit',0);};children.push(c);return c;}});
 await until(()=>children.length===1);children[0].stderr.write('https://test-recall.trycloud');children[0].stderr.write('flare.com\n');const f=path.join(root,'data/https-url.txt');await until(()=>logs.some(x=>x.includes('MEMORY SERVER URL')));assert.equal(readFileSync(f,'utf8').trim(),'https://test-recall.trycloudflare.com');
 children[0].kill();await until(()=>children.length===2);assert.equal(existsSync(f),false);stop();await until(()=>children[1].exitCode===0);
 }finally{stop?.();await new Promise(r=>setTimeout(r,30));rmSync(root,{recursive:true,force:true});}
});
test('download failure is reported and retry is bounded',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'recall-fail-'));mkdirSync(path.join(root,'data'));let attempts=0;const logs=[];
 const stop=startTunnel({root,port:300,prepare:async()=>{attempts++;throw Error('blocked download');},retryMs:1,log:s=>logs.push(s)});
 try{await until(()=>logs.some(x=>x.includes('retry limit')));assert.equal(attempts,4);assert.ok(logs.some(x=>x.includes('blocked download')));}finally{stop();await new Promise(r=>setTimeout(r,30));rmSync(root,{recursive:true,force:true});}
});
