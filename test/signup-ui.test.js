import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('self-hosted signup hides address input, reports progress and displays failures next to form',async()=>{
 const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false,required:true,handlers:{},addEventListener(event,fn){this.handlers[event]=fn;}});return elements.get(id);};
 get('workspace').hidden=true;let resolveFetch;const requests=[];
 const context={document:{getElementById:get,querySelectorAll:()=>[]},window:{RECALLDOCK_CONFIG:{sameOrigin:true}},location:{origin:'https://recall.example',protocol:'https:'},localStorage:{getItem:()=>null,setItem(){}},URL,URLSearchParams,AbortSignal,fetch:(url,opts)=>{requests.push({url,opts});return new Promise(r=>resolveFetch=r);},setTimeout};
 vm.runInNewContext(readFileSync('public/app.js','utf8'),context);
 assert.equal(get('serverLabel').hidden,true);assert.equal(get('serverUrl').required,false);
 await get('switchAuth').handlers.click({preventDefault(){}});assert.equal(get('invite').required,true);assert.equal(get('password').minLength,12);assert.equal(get('authSubmit').textContent,'Create account →');
 get('email').value='test@example.com';get('password').value='password-long';get('invite').value='wrong';
 const pending=get('auth').handlers.submit({preventDefault(){}});assert.equal(get('authSubmit').disabled,true);assert.equal(get('authSubmit').textContent,'Creating account…');assert.equal(requests[0].url,'https://recall.example/api/register');
 resolveFetch({ok:false,json:async()=>({error:'A valid server invite code is required'})});await pending;
 assert.match(get('authStatus').textContent,/invite code/);assert.equal(get('authSubmit').disabled,false);
 get('auth').handlers.invalid({target:{validationMessage:'Please fill in this field.'}});assert.equal(get('authStatus').textContent,'Please fill in this field.');
});
