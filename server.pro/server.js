// Server.pro entrypoint: no npm install and no startup flags required.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {startTunnel} from './tunnel.js';
const root=path.dirname(fileURLToPath(import.meta.url));
async function start(){
 if(Number(process.versions.node.split('.')[0])<24)throw Error('Select Node.js 24 or newer in your server settings.');
 const settings=JSON.parse(readFileSync(path.join(root,'settings.json'),'utf8'));
 const port=Number(process.env.PORT||settings.port);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('settings.json port must be your allocated port (1–65535).');
 const frontend=new URL(settings.frontendOrigin);
 if(frontend.origin!==settings.frontendOrigin||frontend.protocol!=='https:')throw Error('frontendOrigin must be an HTTPS origin without a trailing slash or path.');
 const dataDir=path.join(root,'data');mkdirSync(dataDir,{recursive:true,mode:0o700});
 const inviteFile=path.join(dataDir,'invite-code.txt');
 try{writeFileSync(inviteFile,randomBytes(24).toString('base64url')+'\n',{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
 const invite=readFileSync(inviteFile,'utf8').trim();if(invite.length<24)throw Error('data/invite-code.txt is invalid. Restore it or enter a private code with at least 24 characters.');
 const {createApp}=await import('./backend.js');
 let stopTunnel=()=>{};
 const server=createApp({dataDir,origin:`http://localhost:${port}`,frontendOrigin:frontend.origin,secure:true,serveFrontend:true,invite});
 server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Port is already in use. Check settings.json and your allocated port.':e.message);process.exitCode=1;server.close();});
 server.listen(port,'0.0.0.0',()=>{
  console.log(`RecallDock API running on port ${port}.`);
  console.log('SETUP CODE: '+invite);
  console.log('Use this private code once when creating your account. Do not share it.');
  console.log('Website, accounts and memories are running together. Waiting for your website link…');
  if(settings.tunnel!==false)stopTunnel=startTunnel({root,port});
  else console.log('Automatic tunnel disabled. Connect your own HTTPS proxy to this port.');
 });
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopTunnel();server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref();});
}
start().catch(e=>{console.error('RecallDock startup failed: '+e.message);process.exitCode=1;});
