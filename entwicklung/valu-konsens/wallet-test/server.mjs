/** Local synthetic TEST-VALU wallet: read-only state plus signed tx relay.
 * No private keys on the server, no user accounts, no cloud services.
 */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {readDemoState,localRpcUrl,submitSignedDemoTx,validateSignedDemoTx} from './rpc.mjs';
const folder=dirname(fileURLToPath(import.meta.url));
const assets=new Map([
  ['/',['index.html','text/html; charset=utf-8']],
  ['/app.js',['app.js','text/javascript; charset=utf-8']],
  ['/sign.mjs',['sign.mjs','text/javascript; charset=utf-8']],
  ['/style.css',['style.css','text/css; charset=utf-8']]
]);
const csp="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
function response(res,code,type,data){
 res.writeHead(code,{
   'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
   'Referrer-Policy':'no-referrer','Content-Security-Policy':csp,
   'X-Frame-Options':'DENY','Cross-Origin-Resource-Policy':'same-origin'
 });res.end(data);
}
async function parseBody(req){
 if(Number(req.headers['content-length']||0)>65536)throw Error('Testauftrag zu gross');
 let total=0;const chunks=[];
 for await(const part of req){total+=part.length;if(total>65536)throw Error('Testauftrag zu gross');chunks.push(part);}
 if(total===0)throw Error('Leerer Testauftrag');
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 catch{throw Error('Ungueltiger JSON-Testauftrag');}
}
export function createWalletServer({rpcUrl='http://127.0.0.1:28057',reader=readDemoState,submitter=submitSignedDemoTx}={}){
 const checked=localRpcUrl(rpcUrl);
 return createServer(async(req,res)=>{
   const host=req.headers.host||'';
   if(!/^127\.0\.0\.1:\d{2,5}$/.test(host))return response(res,403,'text/plain','Forbidden');
   const path=(req.url||'').split('?')[0];
   if(path==='/api/submit'){
     if(req.method!=='POST')return response(res,405,'text/plain','Method not allowed');
     if(req.headers.origin!==`http://${host}` || req.headers['x-valu-demo']!=='synthetic' ||
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||''))
       return response(res,403,'application/json; charset=utf-8',JSON.stringify({error:'Unzulaessiger Browser-Aufruf'}));
     let tx;
     try{tx=await parseBody(req);validateSignedDemoTx(tx);}catch(e){return response(res,400,'application/json; charset=utf-8',JSON.stringify({error:e.message}));}
     try{
       const result=await submitter(checked,tx);
       return response(res,result.status==='confirmed'?200:409,'application/json; charset=utf-8',JSON.stringify(result));
     }catch(e){
       return response(res,503,'application/json; charset=utf-8',JSON.stringify({error:String(e?.message||'Testauftrag unklar').slice(0,180)}));
     }
   }
   if(req.method!=='GET')return response(res,405,'text/plain','Method not allowed');
   if(path==='/api/state'){
     try{const data=await reader(checked);return response(res,200,'application/json; charset=utf-8',JSON.stringify(data));}
     catch{return response(res,503,'application/json; charset=utf-8',JSON.stringify({error:'Testnetz nicht erreichbar'}));}
   }
   const asset=assets.get(path);
   if(!asset)return response(res,404,'text/plain','Not found');
   try{const bytes=await readFile(join(folder,asset[0]));return response(res,200,asset[1],bytes);}
   catch{return response(res,500,'text/plain','Asset unavailable');}
 });
}
export async function startWalletServer({rpcUrl='http://127.0.0.1:28057',port=8098}={}){
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
 startWalletServer({rpcUrl,port}).then(()=>console.log(`VALU TEST-WALLET: http://127.0.0.1:${port}/ (synthetic transactions only)`))
  .catch(e=>{console.error(e.message);process.exitCode=1;});
}