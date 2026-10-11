/** Read-only CometBFT RPC reader for the synthetic VALU demo chain.
 * Queries a TRUSTED LOCAL node. Does not verify block proofs or sign transactions.
 */
import {CHAIN_ID} from '../src/core.mjs';
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

async function callRpc(origin,method,params,fetcher) {
  const result=await fetcher(origin,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),
    signal:AbortSignal.timeout(4000)
  });
  if(!result.ok) throw Error('Local RPC returned HTTP '+result.status);
  const body=await result.json();
  if (body.error || !body.result) throw Error('Local RPC rejected '+method);
  return body.result;
}

function validUnits(input) {
  return typeof input==='string' && unitsPattern.test(input);
}

function cleanReceipt(item) {
  if(!item || typeof item.id!=='string' || !/^[0-9a-f]{64}$/.test(item.id) ||
      !Number.isSafeInteger(item.height) || item.height < 1 ||
      !addressPattern.test(item.from) || !addressPattern.test(item.to) ||
      ![item.grossUnits,item.receiverUnits,item.poolUnits].every(validUnits) ||
      BigInt(item.receiverUnits)+BigInt(item.poolUnits)!==BigInt(item.grossUnits)) {
    throw Error('Invalid demo receipt');
  }
  return {id:item.id,height:item.height,from:item.from,to:item.to,
    grossUnits:item.grossUnits,receiverUnits:item.receiverUnits,poolUnits:item.poolUnits};
}

export async function readDemoState(input,{fetcher=fetch}={}) {
  const origin=localRpcUrl(input);
  const status=await callRpc(origin,'status',{},fetcher);
  if (status.node_info?.network!==CHAIN_ID) throw Error('Wrong demo chain');
  const response=await callRpc(origin,'abci_query',{path:'/demo-state'},fetcher);
  if(Number(response.response?.code)!==0 || typeof response.response?.value!=='string')
    throw Error('Demo state is not available');
  let raw;
  try {raw=JSON.parse(Buffer.from(response.response.value,'base64').toString('utf8'));}
  catch {throw Error('Invalid demo state encoding');}
  if(raw?.demo!==true || !Number.isSafeInteger(raw.height) || raw.height<0 ||
     raw.height > Number(status.sync_info?.latest_block_height??-1) ||
     typeof raw.appHash!=='string' || !/^[0-9a-f]{64}$/.test(raw.appHash) ||
     !validUnits(raw.poolUnits) || !raw.balances || Array.isArray(raw.balances) ||
     typeof raw.balances !== 'object') throw Error('Unexpected demo state');
  const balances=Object.entries(raw.balances);
  if(balances.length!==2 || !balances.every(([a,u])=>addressPattern.test(a)&&validUnits(u)))
    throw Error('Unexpected demo wallet accounts');
  if(!Array.isArray(raw.receipts) || raw.receipts.length>10000)throw Error('Demo receipts missing or unbounded');
  const receipts=raw.receipts.map(cleanReceipt).slice(-20).reverse();
  return {
    demo:true,readOnly:true,source:'local-cometbft-rpc',chainId:CHAIN_ID,
    height:raw.height,appHash:raw.appHash,
    accounts:balances.map(([address,balanceUnits])=>({address,balanceUnits})),
    poolUnits:raw.poolUnits,receipts
  };
}