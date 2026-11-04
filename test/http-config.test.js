import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateServer} from '../plugin/scripts/recall.mjs';
test('remote HTTP requires explicit saved opt-in; HTTPS and localhost keep working',()=>{
 const url='http://corbino5021.lets.game:300/';
 assert.throws(()=>validateServer({url}),/allow-http/);
 assert.throws(()=>validateServer({url,allowHttp:'true'}),/allow-http/);
 assert.equal(validateServer({url,allowHttp:true}).url,url);
 assert.doesNotThrow(()=>validateServer({url:'https://memory.example.com'}));
 assert.doesNotThrow(()=>validateServer({url:'http://localhost:3000'}));
 for(const url of ['ftp://memory.example.com','http://name:password@memory.example.com','http://memory.example.com/api','http://memory.example.com/?token=secret'])assert.throws(()=>validateServer({url,allowHttp:true}));
});
