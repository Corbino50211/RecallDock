import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const derive=promisify(scrypt), hash=s=>createHash('sha256').update(s).digest('hex');
export function createApp({dataDir=process.env.DATA_DIR||'./data',origin=process.env.PUBLIC_URL||'http://localhost:3000',invite=process.env.INVITE_CODE||'',secure=origin.startsWith('https:'),frontendOrigin=process.env.FRONTEND_ORIGIN||origin,serveFrontend=process.env.SERVE_FRONTEND==='true'}={}){
 mkdirSync(dataDir,{recursive:true,mode:0o700});
 const db=new DatabaseSync(`${dataDir}/recall.sqlite`); db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE,password TEXT,salt TEXT);
 CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY,user TEXT REFERENCES users(id) ON DELETE CASCADE,name TEXT,kind TEXT,expires INTEGER,created INTEGER);
 CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY,user TEXT REFERENCES users(id) ON DELETE CASCADE,project TEXT,content TEXT,source TEXT,created INTEGER,UNIQUE(user,project,source));
 CREATE INDEX IF NOT EXISTS memory_user ON memories(user,project,created);`);
 const limits=new Map();
 const clean=setInterval(()=>{for(const [k,v] of limits)if(v.until<Date.now())limits.delete(k);},60000);clean.unref();
 function rate(key,max){let v=limits.get(key);if(!v||v.until<Date.now())limits.set(key,v={n:0,until:Date.now()+60000});if(++v.n>max)throw Object.assign(Error('Too many requests. Try again in a minute.'),{status:429});}
 function issue(user,kind,name){const value=randomBytes(32).toString('base64url');db.prepare('INSERT INTO tokens(hash,user,name,kind,expires,created) VALUES(?,?,?,?,?,?)').run(hash(value),user,name,kind,Date.now()+(kind==='session'?86400000:90*86400000),Date.now());return value;}
 const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
 const text=(s,max)=>typeof s==='string'&&s.trim()&&s.length<=max?s.trim():fail('Missing or invalid field');
 const server=http.createServer(async(req,res)=>{try{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 const url=new URL(req.url,origin),p=url.pathname,m=req.method;
 const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 const requestOrigin=req.headers.origin;
 // A self-hosted website may use its current tunnel hostname. Never trust
 // X-Forwarded-Host; require the browser's Origin to match the actual Host.
 let sameHost=false;
 try{const o=new URL(requestOrigin);sameHost=serveFrontend&&['http:','https:'].includes(o.protocol)&&o.host===req.headers.host;}catch{}
 const allowedOrigin=sameHost?requestOrigin:frontendOrigin;
 if(p.startsWith('/api/')){
  res.setHeader('Vary','Origin');
  if(requestOrigin&&requestOrigin!==allowedOrigin)fail('Invalid request origin',403);
  if(requestOrigin===allowedOrigin){
   res.setHeader('Access-Control-Allow-Origin',allowedOrigin);
   res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');
   res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
   res.setHeader('Access-Control-Max-Age','600');
  }
  if(m==='OPTIONS'){
   const requested=req.headers['access-control-request-method'];
   const headers=(req.headers['access-control-request-headers']||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
   if(requestOrigin!==allowedOrigin||!['GET','POST','DELETE'].includes(requested)||headers.some(x=>!['content-type','authorization'].includes(x)))fail('Preflight denied',403);
   res.writeHead(204);return res.end();
  }
 }
 if(p==='/health')return send({ok:true});
 if(!p.startsWith('/api/')){if(!serveFrontend)fail('API only. Open the GitHub Pages website.',404);if(m!=='GET')return fail('Not found',404);const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/config.js':'config.js'};if(!files[p])return fail('Not found',404);res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');return res.end(readFileSync(new URL(`./public/${files[p]}`,import.meta.url)));}
 rate(req.socket.remoteAddress,240);
 const bearer=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):null;
 if(!['GET','HEAD'].includes(m)&&!bearer&&req.headers.origin!==allowedOrigin)fail('Invalid request origin',403);
 let b={};if(['POST','PUT','PATCH'].includes(m)){if(!req.headers['content-type']?.startsWith('application/json'))fail('JSON required',415);let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>32768)fail('Request too large',413);}try{b=JSON.parse(raw||'{}');}catch{fail('Invalid JSON');}}
 if(p==='/api/register'||p==='/api/login'){
 if(m!=='POST')fail('Method not allowed',405);rate('auth:'+req.socket.remoteAddress,10);
 const email=text(b.email,254).toLowerCase(),password=text(b.password,128);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Enter a valid email');
 let u=db.prepare('SELECT * FROM users WHERE email=?').get(email);
 if(p.endsWith('register')){if(!invite||b.invite!==invite)fail('A valid server invite code is required',403);if(password.length<12)fail('Use a password with at least 12 characters');if(u)fail('Unable to create account',409);const salt=randomBytes(16).toString('hex'),pw=(await derive(password,salt,64)).toString('hex');u={id:randomUUID(),email};try{db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(u.id,email,pw,salt);}catch{fail('Unable to create account',409);}}
 else{const candidate=await derive(password,u?.salt||'missing-user',64);if(!u||!timingSafeEqual(candidate,Buffer.from(u.password,'hex')))fail('Invalid email or password',401);}
 const value=issue(u.id,'session','Website');if(b.sessionMode==='bearer')return send({email:u.email,token:value,expiresAt:Date.now()+86400000});res.setHeader('Set-Cookie',`recall=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${secure?'; Secure':''}`);return send({email:u.email});
 }
 const rawToken=bearer||req.headers.cookie?.split('; ').find(x=>x.startsWith('recall='))?.slice(7)||'';
 const auth=db.prepare('SELECT * FROM tokens WHERE hash=? AND expires>?').get(hash(rawToken),Date.now());if(!auth)fail('Sign in required',401);
 const user=auth.user;rate('user:'+user,180);
 if(p==='/api/me'&&m==='GET')return send({email:db.prepare('SELECT email FROM users WHERE id=?').get(user).email});
 if(p==='/api/logout'&&m==='POST'){db.prepare('DELETE FROM tokens WHERE hash=?').run(auth.hash);res.setHeader('Set-Cookie','recall=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send({ok:true});}
 if(p.startsWith('/api/devices')){
 if(auth.kind!=='session')fail('Website login required',403);
 if(p==='/api/devices'&&m==='GET')return send(db.prepare("SELECT hash AS id,name,created,expires FROM tokens WHERE user=? AND kind='device' AND expires>?").all(user,Date.now()));
 if(p==='/api/devices'&&m==='POST'){if(db.prepare("SELECT count(*) n FROM tokens WHERE user=? AND kind='device' AND expires>?").get(user,Date.now()).n>=30)fail('Revoke a device before adding another');return send({token:issue(user,'device',text(b.name,80))},201);}
 if(m==='DELETE'){db.prepare("DELETE FROM tokens WHERE user=? AND hash=? AND kind='device'").run(user,p.split('/').pop());return send({ok:true});}
 }
 if(p==='/api/export'&&m==='GET')return send(db.prepare('SELECT id,project,content,source,created FROM memories WHERE user=? ORDER BY created DESC').all(user));
 if(p==='/api/memories'&&m==='GET'){
 const project=url.searchParams.get('project'),q=(url.searchParams.get('q')||'').slice(0,200),offset=Math.max(0,Math.min(100000,Number(url.searchParams.get('offset'))||0));
 return send(db.prepare(`SELECT id,project,content,source,created FROM memories WHERE user=? AND (? IS NULL OR project=? OR project='global') AND instr(lower(content),lower(?))>0 ORDER BY created DESC LIMIT 50 OFFSET ?`).all(user,project,project,q,offset));}
 if(p==='/api/memories'&&m==='POST'){
 const project=text(b.project,180),content=text(b.content,12000),source=b.source?text(b.source,200):randomUUID(),id=randomUUID();
 if(db.prepare('SELECT count(*) n FROM memories WHERE user=?').get(user).n>=10000)fail('Memory limit reached; export and delete old entries',409);
 db.prepare('INSERT INTO memories VALUES(?,?,?,?,?,?) ON CONFLICT(user,project,source) DO NOTHING').run(id,user,project,content,source,Date.now());return send({ok:true},201);}
 if(p.startsWith('/api/memories/')&&m==='DELETE'){db.prepare('DELETE FROM memories WHERE id=? AND user=?').run(p.split('/').pop(),user);return send({ok:true});}
 fail('Not found',404);
 }catch(e){if(!res.headersSent){res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.status?e.message:'Server error'}));}else res.end();}});
 server.on('close',()=>{clearInterval(clean);db.close();});return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const server=createApp();server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('RecallDock listening'));}
