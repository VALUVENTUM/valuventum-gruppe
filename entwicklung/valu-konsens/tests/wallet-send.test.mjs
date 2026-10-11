import test from 'node:test';
import assert from 'node:assert/strict';
import {signDemoPayment,accountAddress,unitsFromValu,canonical} from '../wallet-test/sign.mjs';
import {validateSignedDemoTx,submitSignedDemoTx,readDemoState} from '../wallet-test/rpc.mjs';
import {createWalletServer} from '../wallet-test/server.mjs';
import {newPair,addressFromPublicDER,verifyTransaction,toUnits,genesis,txHash,CHAIN_ID} from '../src/core.mjs';

const a=newPair(),b=newPair(),sender=addressFromPublicDER(a.publicDER),recipient=addressFromPublicDER(b.publicDER);
const signing=({privatePEM=a.privatePEM,valu='100',nonce=1,to=recipient}={})=>
  signDemoPayment({privatePEM,senderPublicDER:a.publicDER,to,valu,nonce});

function rpcResponses(tx,checkCode=0){
 const receipt={id:txHash(tx),height:4,from:sender,to:recipient,grossUnits:'100000',receiverUnits:'90000',poolUnits:'10000'};
 const raw={demo:true,height:4,poolUnits:'60000',balances:{[sender]:'1900000',[recipient]:'90000'},
   accounts:[{address:sender,publicDER:a.publicDER,nonce:1},{address:recipient,publicDER:b.publicDER,nonce:0}],
   appHash:'c'.repeat(64),receipts:[receipt]};
 return async(_url,{body})=>{
   const req=JSON.parse(body);
   const result=req.method==='status'?{node_info:{network:CHAIN_ID},sync_info:{latest_block_height:'4'}}:
     req.method==='broadcast_tx_commit'?{check_tx:{code:checkCode,log:checkCode?'Nonce already used':''},tx_result:{code:checkCode},height:'4'}:
     {response:{code:0,value:Buffer.from(JSON.stringify(raw)).toString('base64')}};
   return {ok:true,json:async()=>({result})};
 };
}

test('WebCrypto browser-compatible address and signature match VALU Node core',async()=>{
 const tx=await signing();
 assert.equal(await accountAddress(a.publicDER),sender);
 assert.equal(tx.payload.from,sender);
 assert.equal(tx.payload.chainId,CHAIN_ID);
 assert.equal(tx.payload.amountUnits,toUnits('100'));
 const state=genesis([{publicDER:a.publicDER,balanceUnits:toUnits('2000')},{publicDER:b.publicDER,balanceUnits:'0'}]);
 assert.deepEqual(verifyTransaction(state,tx),{grossUnits:'100000',receiverUnits:'90000',poolUnits:'10000'});
 assert.equal(validateSignedDemoTx(tx).toString('utf8'),JSON.stringify(tx));
 assert.equal(canonical(tx.payload),canonical(JSON.parse(JSON.stringify(tx.payload))));
});

test('Wrong PEM, unsupported decimals and modified signature are rejected',async()=>{
 await assert.rejects(signing({privatePEM:b.privatePEM}),/gehoert nicht/);
 await assert.rejects(signing({valu:'0.001'}),/Vielfaches/);
 assert.throws(()=>unitsFromValu('100.9999'));
 assert.throws(()=>unitsFromValu('-4'));
 const tx=await signing();
 tx.payload.amountUnits='200000';
 assert.throws(()=>validateSignedDemoTx(tx),/signatur/i);
 assert.throws(()=>validateSignedDemoTx({...tx,privatePEM:a.privatePEM}),/signiert/);
});

test('Confirm signed TEST-VALU only after actual CometBFT receipt',async()=>{
 const tx=await signing();
 const fetcher=rpcResponses(tx);
 const result=await submitSignedDemoTx('http://127.0.0.1:28057',tx,{fetcher});
 assert.deepEqual(result,{status:'confirmed',height:4,id:txHash(tx),grossUnits:'100000',receiverUnits:'90000',poolUnits:'10000'});
 const state=await readDemoState('http://127.0.0.1:28057',{fetcher});
 assert.equal(state.accounts[0].nonce,1);
 assert.equal(state.readOnly,true);
 const rejected=await submitSignedDemoTx('http://127.0.0.1:28057',tx,{fetcher:rpcResponses(tx,1)});
 assert.equal(rejected.status,'rejected');
 await assert.rejects(submitSignedDemoTx('http://127.0.0.1:28057',tx,{fetcher,reader:async()=>({...state,receipts:[]})}),/Quittung fehlt/);
});

test('Local HTTP send route requires matching origin, JSON and browser request token',async t=>{
 let forwarded=0,privateSeen=false;
 const server=createWalletServer({reader:async()=>({demo:true,readOnly:true,height:1,accounts:[]}),submitter:async(_rpc,tx)=>{
   forwarded++;privateSeen=JSON.stringify(tx).includes('PRIVATE KEY');
   return {status:'confirmed',height:1,id:'a'.repeat(64)};
 }});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url=`http://127.0.0.1:${server.address().port}`;
 const tx=await signing();
 const post=async(origin,token='synthetic',data=tx,method='POST',headers={})=>fetch(url+'/api/submit',{
   method,headers:{origin,'content-type':'application/json','x-valu-demo':token,...headers},body:JSON.stringify(data)});
 const wrong=await post('https://untrusted.example');assert.equal(wrong.status,403);
 const tokenMissing=await post(url,'other');assert.equal(tokenMissing.status,403);
 const keyLeak=await post(url,'synthetic',{...tx,privatePEM:a.privatePEM});
 assert.equal(keyLeak.status,400,'private key must not pass HTTP validation');
 const ok=await post(url);assert.equal(ok.status,200);assert.equal((await ok.json()).status,'confirmed');
 assert.equal(forwarded,1);assert.equal(privateSeen,false,'Valid browser flow must not transmit private keys');
 const get=await fetch(url+'/api/submit');assert.equal(get.status,405);
});