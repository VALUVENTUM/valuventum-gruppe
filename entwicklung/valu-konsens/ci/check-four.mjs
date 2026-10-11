/** Test RPC-only assertion client. Never connects beyond the four local ports. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createPrivateKey,createPublicKey} from 'node:crypto';
import {CHAIN_ID,publicDER,addressFromPublicDER,signedTransaction,toUnits} from '../src/core.mjs';
import {signDemoPayment} from '../wallet-test/sign.mjs';
const dir=process.argv[2], mode=process.argv[3];
if(!dir || !['ready','pay1','continue3','catchup'].includes(mode))throw Error('Usage: check-four.mjs <data> ready|pay1|continue3|catchup');
const nodes=Array.from({length:4},(_,i)=>({i,url:`http://127.0.0.1:${28057+10*i}`}));
const initial=JSON.parse(readFileSync(join(dir,'demo-genesis.json'),'utf8'));
const pem=readFileSync(join(dir,'sender-demo.pem'),'utf8');
const pub=publicDER(createPublicKey(createPrivateKey(pem)));
const sender=addressFromPublicDER(pub),receiver=addressFromPublicDER(initial.wallets[1].publicDER);
async function rpc(n,method,params={}){
 const response=await fetch(n.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(8000)});
 const body=await response.json();
 if(!response.ok || body.error)throw Error(`${n.i}:${method}: ${JSON.stringify(body.error??response.status)}`);
 return body.result;
}
async function wait(label,fn,ms=125000){
 let problem='';const t=Date.now();
 while(Date.now()-t<ms){try{const result=await fn();if(result)return result;}catch(e){problem=String(e.message)}await delay(650);}
 throw Error(`Timeout ${label}: ${problem}`);
}
async function heights(ns){return Promise.all(ns.map(async n=>{
 const result=await rpc(n,'status'); assert.equal(result.node_info.network,CHAIN_ID);return Number(result.sync_info.latest_block_height);
}));}
async function states(ns){return Promise.all(ns.map(async n=>{
 const r=await rpc(n,'abci_query',{path:'/demo-state'});
 assert.equal(Number(r.response.code),0);return JSON.parse(Buffer.from(r.response.value,'base64').toString('utf8'));
}));}
async function checkBalances(ns,gross,received,pool){
 await wait('same VALU balances',async()=>{
  const s=await states(ns);
  return s.every(x=>x.balances[sender]===toUnits(gross) && x.balances[receiver]===toUnits(received) && x.poolUnits===toUnits(pool));
 });
}
async function agreement(ns,h){
 await wait(`shared height >=${h}`,async()=>{const values=await heights(ns);return values.every(v=>v>=h);});
 const blocks=await Promise.all(ns.map(n=>rpc(n,'block',{height:String(h)})));
 const ids=blocks.map(x=>x.block_id.hash), hashes=blocks.map(x=>x.block.header.app_hash);
 assert.equal(new Set(ids).size,1,'different block hashes');
 assert.equal(new Set(hashes).size,1,'different app hashes');
 console.log('MATCHING_BLOCK_AND_APP_HASH_AT_HEIGHT',h);
}
async function send(nonce,amount,n=nodes[0],expectDuplicate=false){
 const tx=signedTransaction({privatePEM:pem,publicDER:pub,to:receiver,amountUnits:toUnits(amount),nonce});
 const r=await rpc(n,'broadcast_tx_commit',{tx:Buffer.from(JSON.stringify(tx)).toString('base64')});
 const check=Number(r.check_tx?.code??-1);
 if(expectDuplicate){assert.notEqual(check,0);console.log('DUPLICATE_NONCE_REJECTED');return null;}
 assert.equal(check,0,r.check_tx?.log);assert.equal(Number(r.tx_result?.code??r.deliver_tx?.code??-1),0);
 return Number(r.height);
}
async function sendViaBrowserWallet(amount,expectedNonce){
 const url='http://127.0.0.1:28999';
 const snapshot=await (await fetch(url+'/api/state',{signal:AbortSignal.timeout(8000)})).json();
 const account=snapshot.accounts.find(item=>item.address===sender);
 assert.equal(account?.nonce+1,expectedNonce,'wrong signer nonce from live wallet');
 const tx=await signDemoPayment({privatePEM:pem,senderPublicDER:account.publicDER,to:receiver,valu:amount,nonce:account.nonce+1});
 const reply=await fetch(url+'/api/submit',{method:'POST',headers:{'content-type':'application/json','x-valu-demo':'synthetic','origin':url},body:JSON.stringify(tx),signal:AbortSignal.timeout(45000)});
 const result=await reply.json();
 assert.equal(reply.status,200,JSON.stringify(result));
 assert.equal(result.status,'confirmed');
 assert.equal(result.grossUnits,toUnits(amount));
 console.log('BROWSER_SIGNED_WALLET_PAYMENT_CONFIRMED',result.height);
 return result.height;
}
if(mode==='ready'){
 await wait('4 validators online',async()=>{
  const h=await heights(nodes);const peers=await Promise.all(nodes.map(async n=>Number((await rpc(n,'net_info')).n_peers)));
  return h.every(x=>x>=2)&&peers.every(x=>x>=2);
 });
 const v=await rpc(nodes[0],'validators',{height:'1',page:'1',per_page:'100'});
 assert.equal(Number(v.total),4);console.log('FOUR_VALIDATORS_NETWORK_LIVE');
}
if(mode==='pay1'){
 const h=await send(1,'100');
 await checkBalances(nodes,'1900','90','60');
 await agreement(nodes,h+1);
 console.log('FOUR_VALIDATORS_90_10_PAYMENT_OK');
}
if(mode==='continue3'){
 const live=nodes.slice(0,3);const before=await heights(live);
 await wait('3/4 continue blocks',async()=>{const now=await heights(live);return now.every((x,i)=>x>=before[i]+2);});
 const h=await sendViaBrowserWallet('50',2);
 await checkBalances(live,'1850','135','65');
 await agreement(live,h+1);
 writeFileSync(join(dir,'followup-height.txt'),String(h+1));
 console.log('THREE_OF_FOUR_QUORUM_PAYMENT_OK');
}
if(mode==='catchup'){
 await checkBalances(nodes,'1850','135','65');
 await agreement(nodes,Number(readFileSync(join(dir,'followup-height.txt'),'utf8')));
 await send(1,'100',nodes[3],true);
 console.log('VALU_COMETBFT_V03826_FOUR_VALIDATOR_QUORUM_RESTART_TEST_OK');
}