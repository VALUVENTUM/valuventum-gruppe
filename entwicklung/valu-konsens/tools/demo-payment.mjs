/** Sends an intentionally synthetic signed transaction to local CometBFT RPC. */
import {readFile} from 'node:fs/promises';
import {createPublicKey,createPrivateKey} from 'node:crypto';
import {join} from 'node:path';
import {publicDER,addressFromPublicDER,signedTransaction,toUnits} from '../src/core.mjs';
const dir=process.argv[2],url=process.argv[3]??'http://127.0.0.1:26657';
const expectDuplicate=process.argv[4]==='--expect-rejected';
if(!dir)throw Error('usage: node tools/demo-payment.mjs <demo-data-dir> [comet-rpc-url] [--expect-rejected]');
const privatePEM=await readFile(join(dir,'sender-demo.pem'),'utf8');
const senderPub=publicDER(createPublicKey(createPrivateKey(privatePEM)));
const config=JSON.parse(await readFile(join(dir,'demo-genesis.json'),'utf8'));
const recipientPub=config.wallets[1].publicDER;
const tx=signedTransaction({privatePEM,publicDER:senderPub,to:addressFromPublicDER(recipientPub),amountUnits:toUnits('100'),nonce:1});
const hex=Buffer.from(JSON.stringify(tx)).toString('hex');
const payload={jsonrpc:'2.0',id:1,method:'broadcast_tx_commit',params:{tx:'0x'+hex}};
const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)});
const result=await response.json();
if(result.error)throw Error(JSON.stringify(result.error));
console.log(JSON.stringify(result.result));
const check=result.result?.check_tx?.code;
const deliver=result.result?.deliver_tx?.code??result.result?.tx_result?.code;
if(expectDuplicate){
  if(check!==1)throw Error('Expected a duplicate nonce rejection at CheckTx (code 1)');
  console.log('EXPECTED_DUPLICATE_REJECTION_OK');
}else{
  if(check!==0 || deliver!==0)throw Error(`Synthetic payment not confirmed with code 0: check=${check}, deliver=${deliver}`);
  console.log('COMETBFT_SYNTHETIC_PAYMENT_CONFIRMED');
}