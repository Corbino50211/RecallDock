const $=id=>document.getElementById(id);let register=false,offset=0,sessionToken='',apiBase='';
const notify=s=>$('status').textContent=s;
function serverBase(value){
 const u=new URL(value);
 if(u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Enter a server origin without a path, credentials, or query.');
 if(u.protocol!=='https:'&&!(location.protocol==='http:'&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('Your memory server needs an HTTPS address.');
 return u.origin;
}
try{$('serverUrl').value=window.RECALLDOCK_CONFIG?.apiBaseUrl||localStorage.getItem('recalldock.apiBase')||'';}catch{}
async function api(path,method='GET',body){
 if(!apiBase)throw Error('Enter your memory server URL and sign in.');
 let r;try{r=await fetch(apiBase+'/api/'+path,{method,credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json',...(sessionToken?{Authorization:'Bearer '+sessionToken}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});}catch{throw Error('Cannot reach the memory server. Check its HTTPS address and FRONTEND_ORIGIN setting.');}
 let d;try{d=await r.json();}catch{throw Error('The server did not return a RecallDock API response.');}
 if(!r.ok)throw Error(d.error||'Request failed');return d;
}
function action(id,fn,event='click'){$(id).addEventListener(event,async e=>{e.preventDefault();try{await fn(e);}catch(err){notify(err.message);}});}
function node(tag,value,cls){const el=document.createElement(tag);el.textContent=value;if(cls)el.className=cls;return el;}
async function enter(){const me=await api('me');$('welcome').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;$('account').textContent=me.email;await memories();}
async function memories(append=false){if(!append){offset=0;$('cards').replaceChildren();}const params=new URLSearchParams({q:$('query').value,offset});if($('projectFilter').value)params.set('project',$('projectFilter').value);const data=await api('memories?'+params);for(const item of data){const c=node('article','','card'),meta=node('div',item.project+' · '+new Date(item.created).toLocaleDateString(),'meta'),del=node('button','Delete');del.onclick=async()=>{if(!confirm('Delete this memory from the server?'))return;try{await api('memories/'+item.id,'DELETE');await memories();}catch(e){notify(e.message);}};meta.append(del);c.append(meta,node('pre',item.content));$('cards').append(c);}offset+=data.length;$('more').hidden=data.length<50;if(!offset)$('cards').append(node('div','A fresh start. Add a memory or connect Claude Code to begin.','empty'));}
async function devices(){$('deviceCards').replaceChildren();for(const d of await api('devices')){const c=node('div','','card'),b=node('button','Revoke key');c.append(node('strong',d.name),node('p','Expires '+new Date(d.expires).toLocaleDateString()));b.onclick=async()=>{if(!confirm('Disconnect this device?'))return;try{await api('devices/'+d.id,'DELETE');await devices();}catch(e){notify(e.message);}};c.append(b);$('deviceCards').append(c);}}
action('switchAuth',()=>{register=!register;$('inviteLabel').hidden=!register;$('authTitle').textContent=register?'Make room for context.':'Welcome back.';$('authSubmit').textContent=register?'Create account →':'Sign in →';$('switchAuth').textContent=register?'Already have an account? Sign in':'New here? Create an account';$('password').autocomplete=register?'new-password':'current-password';});
action('auth',async()=>{apiBase=serverBase($('serverUrl').value.trim());sessionToken='';const auth=await api(register?'register':'login','POST',{sessionMode:'bearer',email:$('email').value,password:$('password').value,invite:$('invite').value});if(!auth.token)throw Error('Update your server to the GitHub Pages compatible version.');sessionToken=auth.token;try{localStorage.setItem('recalldock.apiBase',apiBase);}catch{}$('password').value='';$('invite').value='';await enter();notify('Welcome to your dock.');},'submit');
action('logout',async()=>{try{await api('logout','POST');}finally{sessionToken='';location.reload();}});
action('search',()=>memories(),'submit');action('more',()=>memories(true));
action('add',async()=>{await api('memories','POST',{project:$('project').value,content:$('content').value});$('content').value='';await memories();notify('Memory saved.');},'submit');
action('newDevice',async()=>{const d=await api('devices','POST',{name:$('deviceName').value});$('newKey').textContent=d.token;$('keyBox').hidden=false;await devices();},'submit');
action('copyKey',async()=>{await navigator.clipboard.writeText($('newKey').textContent);notify('Key copied.');});action('hideKey',()=>{$('keyBox').hidden=true;$('newKey').textContent='';});
action('export',async()=>{const data=await api('export'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='recalldock-memories.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=async()=>{for(const x of document.querySelectorAll('[data-tab]'))x.classList.toggle('active',x===b);$('memories').hidden=b.dataset.tab!=='memories';$('devices').hidden=b.dataset.tab!=='devices';if(b.dataset.tab==='devices')try{await devices();}catch(e){notify(e.message);}};
// Session tokens stay in memory only. Reloading the page requires signing in again.

