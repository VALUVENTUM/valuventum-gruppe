/** Read and submit synthetic VALU demo transactions to a TRUSTED LOCAL node.
 * Only 127.0.0.1 RPC is allowed. This is not an independent proof verifier.
 */
import {CHAIN_ID,addressFromPublicDER,calculateSplit,verifyText,txHash} from '../src/core.mjs';
const unitsPattern = /^(0|[1-9][0-9]*)$/;
const addressPattern = /^VALU-(?:[0-9A-F]{4}-){5}[0-9A-F]{4}$/;

export function localRpcUrl(input) {
  if (typeof input !== 'string') throw Error('Local RPC URL required');
  let u;
  try { u=new URL(input); } catch { throw Error('Invalid RPC URL'); }
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !u.port ||
      Number(u.port)<1024 || Number(u.port)>65535 || u.username || u.password ||
      u.pathname!=='/' || u.search || u.hash) {
    throw Error('Demo RPC must be http://127.0.0.1:<port> only');
  }
  return u.origin;
}

async function callRpc(origin,method,params,fetcher,timeout=5000) {
  const result=await fetcher(origin,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),
    signal:AbortSignal.timeout(timeout)
  });
  if(!result.ok) throw Error('Local RPC returned HTTP '+result.status);
  const body=await result.json();
  if(body.error || !body.result) throw Error('Local RPC rejected '+method);
  return body.result;
}
const validUnits=input=>typeof input==='string'&&unitsPattern.test(input);
function cleanReceipt(item){
  if(!item || typeof item.id!=='string' || !/^[0-9a-f]{64}$/.test(item.id) ||
      !Number.isSafeInteger(item.height) || item.height<1 ||
      !addressPattern.test(item.from) || !addressPattern.test(item.to) ||
      ![item.grossUnits,item.receiverUnits,item.poolUnits].every(validUnits) ||
      BigInt(item.receiverUnits)+BigInt(item.poolUnits)!==BigInt(item.grossUnits))
    throw Error('Invalid demo receipt');
  return {id:item.id,height:item.height,from:item.from,to:item.to,
    grossUnits:item.grossUnits,receiverUnits:item.receiverUnits,poolUnits:item.poolUnits};
}
export async function readDemoState(input,{fetcher=fetch}={}){
  const origin=localRpcUrl(input);
  const status=await callRpc(origin,'status',{},fetcher);
  if(status.node_info?.network!==CHAIN_ID)throw Error('Wrong demo chain');
  const response=await callRpc(origin,'abci_query',{path:'/demo-state'},fetcher);
  if(Number(response.response?.code)!==0 || typeof response.response?.value!=='string')
    throw Error('Demo state is not available');
  let raw;
  try {raw=JSON.parse(Buffer.from(response.response.value,'base64').toString('utf8'));}
  catch {throw Error('Invalid demo state encoding');}
  if(raw?.demo!==true || !Number.isSafeInteger(raw.height) || raw.height<0 ||
     raw.height>Number(status.sync_info?.latest_block_height??-1) ||
     typeof raw.appHash!=='string' || !/^[0-9a-f]{64}$/.test(raw.appHash) ||
     !validUnits(raw.poolUnits) || !raw.balances || Array.isArray(raw.balances) ||
     typeof raw.balances!=='object' || !Array.isArray(raw.accounts)) throw Error('Unexpected demo state');
  const balances=Object.entries(raw.balances);
  if(balances.length!==2 || !balances.every(([a,u])=>addressPattern.test(a)&&validUnits(u)))
    throw Error('Unexpected demo wallet accounts');
  if(raw.accounts.length!==balances.length)throw Error('Demo accounts do not match balances');
  const meta=new Map(raw.accounts.map(a=>[a?.address,a]));
  if(meta.size!==balances.length)throw Error('Duplicate demo account metadata');
  const accounts=balances.map(([address,balanceUnits])=>{
    const info=meta.get(address);
    if(!info || typeof info.publicDER!=='string' || info.publicDER.length>256 ||
       !Number.isSafeInteger(info.nonce) || info.nonce<0 ||
       addressFromPublicDER(info.publicDER)!==address)
      throw Error('Invalid demo account metadata');
    return {address,balanceUnits,publicDER:info.publicDER,nonce:info.nonce};
  });
  if(!Array.isArray(raw.receipts)||raw.receipts.length>10000)throw Error('Demo receipts missing or unbounded');
  return {demo:true,readOnly:true,source:'local-cometbft-rpc',chainId:CHAIN_ID,
    height:raw.height,appHash:raw.appHash,accounts,poolUnits:raw.poolUnits,
    receipts:raw.receipts.map(cleanReceipt).slice(-20).reverse()};
}

/** Accept signed TEST-ONLY transactions. Never accepts private keys or PEM. */
export function validateSignedDemoTx(tx){
  if(!tx || typeof tx!=='object' || Array.isArray(tx) ||
      Object.keys(tx).sort().join(',')!=='payload,signature' ||
      typeof tx.signature!=='string' || !/^[A-Za-z0-9+/]{85,}={0,2}$/.test(tx.signature))
    throw Error('Ungueltiger signierter Testauftrag');
  const p=tx.payload;
  if(!p || typeof p!=='object' || Array.isArray(p) ||
     Object.keys(p).sort().join(',')!=='amountUnits,chainId,expiresAt,from,issuedAt,memo,nonce,senderPub,to' ||
     p.chainId!==CHAIN_ID || !addressPattern.test(p.from) || !addressPattern.test(p.to) || p.from===p.to ||
     typeof p.senderPub!=='string' || p.senderPub.length>256 ||
     addressFromPublicDER(p.senderPub)!==p.from ||
     !Number.isSafeInteger(p.nonce) || p.nonce<1 ||
     !Number.isSafeInteger(p.issuedAt) || !Number.isSafeInteger(p.expiresAt) ||
     p.expiresAt<=p.issuedAt || p.expiresAt>p.issuedAt+1200 ||
     typeof p.memo!=='string' || p.memo.length>120 || /[\x00-\x08\x0e-\x1f]/.test(p.memo))
    throw Error('Ungueltige Demo-Auftragsfelder');
  calculateSplit(p.amountUnits);
  if(!verifyText(p.senderPub,p,tx.signature))throw Error('Ed25519-Testsignatur ungueltig');
  const wire=Buffer.from(JSON.stringify(tx));
  if(wire.length>65536)throw Error('Testauftrag ist zu gross');
  return wire;
}

export async function submitSignedDemoTx(rpcUrl,tx,{fetcher=fetch,reader=readDemoState}={}){
  const origin=localRpcUrl(rpcUrl);
  const wire=validateSignedDemoTx(tx);
  const info=await callRpc(origin,'status',{},fetcher);
  if(info.node_info?.network!==CHAIN_ID)throw Error('Falsches Testnetz');
  const response=await callRpc(origin,'broadcast_tx_commit',{tx:wire.toString('base64')},fetcher,40000);
  const check=Number(response.check_tx?.code??-1);
  const final=Number(response.tx_result?.code??response.deliver_tx?.code??-1);
  if(check!==0 || final!==0) return {status:'rejected',reason:String(response.check_tx?.log||response.tx_result?.log||'Testauftrag abgewiesen').slice(0,160)};
  const height=Number(response.height);
  const id=txHash(tx);
  if(!Number.isSafeInteger(height)||height<1)throw Error('Bestaetigung ohne gueltige Blockhoehe');
  const state=await reader(origin,{fetcher});
  const receipt=state.receipts.find(r=>r.id===id && r.height===height && r.from===tx.payload.from && r.to===tx.payload.to && r.grossUnits===tx.payload.amountUnits);
  if(!receipt)throw Error('Testauftrag unklar: CometBFT-Quittung fehlt; vor Wiederholung pruefen');
  return {status:'confirmed',height,id,grossUnits:receipt.grossUnits,
    receiverUnits:receipt.receiverUnits,poolUnits:receipt.poolUnits};
}