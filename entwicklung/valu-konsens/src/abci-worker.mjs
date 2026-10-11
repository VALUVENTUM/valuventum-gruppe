/** STDIN/STDOUT JSON-line worker for the local Go CometBFT ABCI adapter. */
import {readFile} from 'node:fs/promises';
import readline from 'node:readline';
import {CHAIN_ID,genesis} from './core.mjs';
import {stateHash} from './deterministic-state.mjs';
import {ValuLifecycle} from './abci-lifecycle.mjs';
import {checkConsensusTx,executeConsensusBlock,prepareConsensusProposal} from './abci-execution.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i+1]) throw Error(`Missing ${name}`);
  return process.argv[i+1];
}
const genesisConfig=JSON.parse(await readFile(arg('--genesis'),'utf8'));
if (genesisConfig.version!==1 || genesisConfig.chainId!==CHAIN_ID ||
    !Array.isArray(genesisConfig.wallets) || genesisConfig.wallets.length!==2) throw Error('Invalid demo genesis');
const syntheticGenesis=genesis(genesisConfig.wallets);
const app=await ValuLifecycle.open(arg('--state-dir'),syntheticGenesis);
const decode = v => Buffer.from(v,'base64');
const decodeAll = v => {if(!Array.isArray(v)) throw Error('Missing tx array');return v.map(decode);};
function ctx(q) {return {height:q.height,blockTime:q.blockTime};}
function response(result) { process.stdout.write(JSON.stringify(result)+'\n'); }

async function handle(q) {
  switch(q.method) {
    case 'info': return app.info();
    case 'init':
      if (q.chainId!==CHAIN_ID || q.initialHeight!==1 || app.info().height!==0) throw Error('Chain id, initial height or persisted height mismatch');
      return {appHash:stateHash(syntheticGenesis)};
    case 'check': return checkConsensusTx(app.snapshot(),decode(q.tx),q.blockTime);
    case 'prepare': return {txs:prepareConsensusProposal(app.snapshot(),decodeAll(q.txs),ctx(q),q.maxBytes).map(x=>x.toString('base64'))};
    case 'process':
      try {executeConsensusBlock(app.snapshot(),decodeAll(q.txs),ctx(q));return {accept:true};}
      catch(err) {return {accept:false,reason:err.message};}
    case 'finalize': {
      const candidate=executeConsensusBlock(app.snapshot(),decodeAll(q.txs),ctx(q));
      app.setPendingConsensus(candidate);
      return {appHash:candidate.appHash,height:candidate.state.height,results:candidate.results};
    }
    case 'commit': return await app.commit();
    case 'query': {
      if(q.path!=='/demo-state') return {code:1,log:'Unknown query path'};
      const snapshot=app.snapshot();
      const balances=Object.fromEntries(Object.entries(snapshot.accounts).map(([address,a])=>[address,a.balanceUnits]));
      return {code:0,value:JSON.stringify({demo:true,height:snapshot.height,poolUnits:snapshot.poolUnits,balances,appHash:stateHash(snapshot),receipts:snapshot.receipts.map(({id,height,from,to,grossUnits,receiverUnits,poolUnits})=>({id,height,from,to,grossUnits,receiverUnits,poolUnits}))})};
    }
    default: throw Error('Unknown method');
  }
}

for await (const line of readline.createInterface({input:process.stdin,crlfDelay:Infinity})) {
  let q;
  try {
    if (Buffer.byteLength(line) > 2*1024*1024) throw Error('Request too large');
    q=JSON.parse(line);
    const value=await handle(q);
    response({id:q.id,ok:true,result:value});
  } catch(err) {
    response({id:q?.id??null,ok:false,error:String(err?.message??err).slice(0,500)});
  }
}