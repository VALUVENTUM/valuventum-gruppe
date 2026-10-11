import test from 'node:test';
import assert from 'node:assert/strict';
import {readDemoState,localRpcUrl} from '../wallet-test/rpc.mjs';
import {createWalletServer} from '../wallet-test/server.mjs';
import {CHAIN_ID,newPair,addressFromPublicDER} from '../src/core.mjs';

const pairA=newPair(),pairB=newPair();
const a=addressFromPublicDER(pairA.publicDER);
const b=addressFromPublicDER(pairB.publicDER);
const receipt={id:'a'.repeat(64),height:3,from:a,to:b,grossUnits:'100000',receiverUnits:'90000',poolUnits:'10000'};
const sample={demo:true,height:3,poolUnits:'60000',balances:{[a]:'1900000',[b]:'90000'},accounts:[{address:a,publicDER:pairA.publicDER,nonce:1},{address:b,publicDER:pairB.publicDER,nonce:0}],appHash:'b'.repeat(64),receipts:[receipt]};
const okResponse={node_info:{network:CHAIN_ID},sync_info:{latest_block_height:'3'}};
function fakeFetch(raw=sample,status=okResponse){
 return async(_url,options)=>{
   const {method}=JSON.parse(options.body);
   const result=method==='status'?status:{response:{code:0,value:Buffer.from(JSON.stringify(raw)).toString('base64')}};
   return {ok:true,json:async()=>({result})};
 };
}

test('Only local, uncredentialed, HTTP CometBFT RPC addresses accepted',()=>{
 assert.equal(localRpcUrl('http://127.0.0.1:28057'),'http://127.0.0.1:28057');
 for(const url of ['https://127.0.0.1:28057','http://evil.example:28057',
  'http://192.168.1.22:28057','http://localhost:28057','http://127.0.0.1:80',
  'http://a:b@127.0.0.1:28057','http://127.0.0.1:28057/other',
  'http://127.0.0.1:28057/?x=1'])assert.throws(()=>localRpcUrl(url));
});

test('Returns real RPC values in read-only schema without private material',async()=>{
 const data=await readDemoState('http://127.0.0.1:28057',{fetcher:fakeFetch()});
 assert.equal(data.height,3);assert.equal(data.chainId,CHAIN_ID);
 assert.deepEqual(data.accounts,[{address:a,balanceUnits:'1900000',publicDER:pairA.publicDER,nonce:1},{address:b,balanceUnits:'90000',publicDER:pairB.publicDER,nonce:0}]);
 assert.equal(data.poolUnits,'60000');assert.equal(data.receipts.length,1);
 assert.equal(data.readOnly,true);assert.equal(data.demo,true);
 assert.doesNotMatch(JSON.stringify(data),/privatePEM|seedPhrase|sender-demo.pem/);
});

test('Wrong chain, malformed amounts and invalid receipts never shown',async()=>{
 await assert.rejects(readDemoState('http://127.0.0.1:28057',{fetcher:fakeFetch(sample,{...okResponse,node_info:{network:'ANOTHER-CHAIN'}})}));
 await assert.rejects(readDemoState('http://127.0.0.1:28057',{fetcher:fakeFetch({...sample,balances:{[a]:'-100',[b]:'90000'}})}));
 await assert.rejects(readDemoState('http://127.0.0.1:28057',{fetcher:fakeFetch({...sample,receipts:[{...receipt,receiverUnits:'95000'}]})}));
 await assert.rejects(readDemoState('http://127.0.0.1:28057',{fetcher:fakeFetch({...sample,appHash:'NOT_A_HASH'})}));
});

test('Wallet serves local HTML, live JSON and refuses write methods',async(t)=>{
 const server=createWalletServer({reader:async()=>({demo:true,readOnly:true,height:3,accounts:[]})});
 await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const home=await fetch(origin+'/');assert.equal(home.status,200);
 assert.match(await home.text(),/Test-Wallet/);
 assert.match(home.headers.get('content-security-policy'),/connect-src 'self'/);
 for(const path of ['/app.js','/sign.mjs','/style.css']){
   const res=await fetch(origin+path);assert.equal(res.status,200,path);assert.ok((await res.text()).length>100);
 }
 const api=await fetch(origin+'/api/state');assert.equal(api.status,200);
 assert.equal((await api.json()).height,3);
 const forbidden=await fetch(origin+'/api/state',{method:'POST'});assert.equal(forbidden.status,405);
 const missing=await fetch(origin+'/private-key');assert.equal(missing.status,404);
});

test('Offline RPC results in explicit 503, never fabricated balances',async(t)=>{
 const server=createWalletServer({reader:async()=>{throw Error('connection refused')}});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/state`);
 assert.equal(response.status,503);
 const data=await response.json();assert.equal(data.error,'Testnetz nicht erreichbar');
 assert.equal(data.balances,undefined);
});