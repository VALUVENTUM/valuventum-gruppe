/** Loopback-only read-only test-wallet UI. No signing, no user accounts, no external services. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {readDemoState,localRpcUrl} from './rpc.mjs';
const folder=dirname(fileURLToPath(import.meta.url));
const assets=new Map([
  ['/',['index.html','text/html; charset=utf-8']],
  ['/app.js',['app.js','text/javascript; charset=utf-8']],
  ['/style.css',['style.css','text/css; charset=utf-8']]
]);
const csp="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
function response(res,code,type,data){
 res.writeHead(code,{
   'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
   'Referrer-Policy':'no-referrer','Content-Security-Policy':csp,
   'X-Frame-Options':'DENY'
 });res.end(data);
}
export function createWalletServer({rpcUrl='http://127.0.0.1:28057',reader=readDemoState}={}) {
 const checked=localRpcUrl(rpcUrl);
 return createServer(async(req,res)=>{
   // Reject DNS rebinding: this demo server is only accessed via 127.0.0.1.
   const host=req.headers.host||'';
   if(!/^127\.0\.0\.1:\d+$/.test(host)) return response(res,403,'text/plain','Forbidden');
   if(req.method!=='GET') return response(res,405,'text/plain','Method not allowed');
   const path=(req.url||'').split('?')[0];
   if(path==='/api/state'){
     try { const data=await reader(checked);return response(res,200,'application/json; charset=utf-8',JSON.stringify(data)); }
     catch {return response(res,503,'application/json; charset=utf-8',JSON.stringify({error:'Testnetz nicht erreichbar'}));}
   }
   const asset=assets.get(path);
   if(!asset) return response(res,404,'text/plain','Not found');
   const bytes=await readFile(join(folder,asset[0]));
   return response(res,200,asset[1],bytes);
 });
}
export async function startWalletServer({rpcUrl='http://127.0.0.1:28057',port=8098}={}) {
 if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('Invalid local port');
 const server=createWalletServer({rpcUrl});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return server;
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]){
 const args=process.argv.slice(2);
 const opt=(name,def)=>{const i=args.indexOf(name);return i<0?def:args[i+1];};
 const rpcUrl=opt('--rpc','http://127.0.0.1:28057');
 const port=Number(opt('--port','8098'));
 startWalletServer({rpcUrl,port}).then(()=>{
   console.log(`VALU TEST-WALLET read-only: http://127.0.0.1:${port}/`);
 }).catch(e=>{console.error(e.message);process.exitCode=1;});
}