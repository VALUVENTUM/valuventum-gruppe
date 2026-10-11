/** End-to-end assertion: the read-only HTTP UI uses actual committed CometBFT demo state. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {addressFromPublicDER,toUnits,CHAIN_ID} from '../src/core.mjs';
const dir=process.argv[2],gross=process.argv[3],received=process.argv[4],pool=process.argv[5],receiptCount=Number(process.argv[6]);
if(!dir||!gross||!received||!pool||!Number.isSafeInteger(receiptCount))throw Error('check-wallet.mjs <demo-dir> <sender> <receiver> <pool> <receipt-count>');
const genesis=JSON.parse(await readFile(join(dir,'demo-genesis.json'),'utf8'));
const sender=addressFromPublicDER(genesis.wallets[0].publicDER),receiver=addressFromPublicDER(genesis.wallets[1].publicDER);
let state,last;
for(let i=0;i<50;i++){
 try{
   const res=await fetch('http://127.0.0.1:28999/api/state',{signal:AbortSignal.timeout(3500)});
   if(!res.ok)throw Error('wallet HTTP '+res.status);
   const data=await res.json();
   const balances=new Map(data.accounts.map(a=>[a.address,a.balanceUnits]));
   if(data.chainId===CHAIN_ID && balances.get(sender)===toUnits(gross) && balances.get(receiver)===toUnits(received) && data.poolUnits===toUnits(pool) && data.receipts.length===receiptCount){state=data;break;}
   last=JSON.stringify(data).slice(0,450);
 }catch(e){last=String(e.message)}
 await delay(250);
}
assert.ok(state,'Live wallet did not reflect confirmed balances: '+last);
assert.equal(state.demo,true);assert.equal(state.readOnly,true);
assert.match(state.appHash,/^[a-f0-9]{64}$/);
for(const receipt of state.receipts)assert.equal(BigInt(receipt.receiverUnits)+BigInt(receipt.poolUnits),BigInt(receipt.grossUnits));
const page=await fetch('http://127.0.0.1:28999/');assert.equal(page.status,200);assert.match(await page.text(),/TESTNETZ/);
console.log('VALU_LIVE_READONLY_WALLET_CONFIRMED',JSON.stringify({height:state.height,accounts:state.accounts,pool:state.poolUnits,receipts:state.receipts.length}));