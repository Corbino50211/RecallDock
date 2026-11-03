import {readFile,writeFile,mkdir,chmod,rename,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
const builds={
 x64:{url:'https://github.com/cloudflare/cloudflared/releases/download/2026.10.7/cloudflared-linux-amd64',sha:'1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872'},
 arm64:{url:'https://github.com/cloudflare/cloudflared/releases/download/2026.10.7/cloudflared-linux-arm64',sha:'3df43aedc9ff291d1735b5cb576cb97e0b157488796db2e32b28aecabb445775'}
};
const digest=b=>createHash('sha256').update(b).digest('hex');
export async function prepareBinary(root,signal){
 if(process.platform!=='linux'||!builds[process.arch])throw Error('Automatic tunnel supports Linux x64 and arm64 only.');
 const build=builds[process.arch],dir=path.join(root,'bin'),file=path.join(dir,'cloudflared');await mkdir(dir,{recursive:true,mode:0o700});
 try{if(digest(await readFile(file))===build.sha){await chmod(file,0o700);return file;}}catch{}
 console.log('Downloading verified Cloudflare tunnel helper (first startup only)...');
 const response=await fetch(build.url,{signal:AbortSignal.any([signal,AbortSignal.timeout(120000)])});if(!response.ok)throw Error('Tunnel download failed: HTTP '+response.status);
 const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>100*1024*1024)throw Error('Tunnel download exceeded size limit');chunks.push(chunk);}
 const bytes=Buffer.concat(chunks);if(digest(bytes)!==build.sha)throw Error('Tunnel checksum verification failed. No binary was executed.');
 await writeFile(file+'.part',bytes,{mode:0o700});await rename(file+'.part',file);await chmod(file,0o700);return file;
}
export function startTunnel({root,port,prepare=prepareBinary,spawnProcess=spawn,log=console.log,retryMs=5000}){
 const controller=new AbortController(),urlFile=path.join(root,'data','https-url.txt');let child,timer,closed=false,failures=0,generation=0,killTimer;
 function clearURL(){return rm(urlFile,{force:true}).catch(()=>{});}
 async function run(){
 const current=++generation;await clearURL();if(closed)return;
 try{
  const binary=await prepare(root,controller.signal);if(closed)return;
  // Isolated working directory avoids picking up an unrelated Cloudflare config.
  const cwd=path.join(root,'data','tunnel');await mkdir(cwd,{recursive:true,mode:0o700});
  child=spawnProcess(binary,['tunnel','--no-autoupdate','--protocol','http2','--url',`http://127.0.0.1:${port}`],{cwd,stdio:['ignore','pipe','pipe']});
  let buffer='',published=false,finished=false;
  const output=async chunk=>{buffer=(buffer+chunk.toString()).slice(-8192);const match=buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/);if(match&&!published&&!closed&&current===generation){published=true;try{await writeFile(urlFile,match[0]+'\n',{mode:0o600});if(closed||current!==generation){await clearURL();return;}log('MEMORY SERVER URL: '+match[0]);log('Copy that address into the website and Claude plugin. Also saved in data/https-url.txt.');}catch(e){log('Could not save tunnel URL: '+e.message);}}};
  child.stdout.on('data',output);child.stderr.on('data',output);
  const ended=reason=>{if(finished)return;finished=true;generation++;void clearURL();if(closed)return;log('HTTPS tunnel stopped: '+reason);retry();};
  child.once('error',e=>ended(e.code||e.message));child.once('exit',(code,signal)=>ended(signal||String(code)));
 }catch(e){if(!closed){log('HTTPS tunnel could not start: '+e.message);retry();}}
 }
 function retry(){if(++failures<=3)timer=setTimeout(()=>void run(),retryMs);else log('Tunnel retry limit reached. Backend is still running. Check outbound downloads/process permissions, then restart.');}
 void run();
 return ()=>{closed=true;generation++;clearTimeout(timer);controller.abort();void clearURL();if(child&&child.exitCode===null){child.kill('SIGTERM');killTimer=setTimeout(()=>child?.kill('SIGKILL'),3000);killTimer.unref();child.once('exit',()=>clearTimeout(killTimer));}};
}
