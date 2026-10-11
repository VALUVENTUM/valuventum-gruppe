import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {CHAIN_ID,genesis,newPair,addressFromPublicDER,toUnits,signedTransaction} from '../src/core.mjs';
import {stateHash} from '../src/deterministic-state.mjs';

async function startWorker(dir,config) {
  const child=spawn(process.execPath,[new URL('../src/abci-worker.mjs',import.meta.url).pathname,'--genesis',config,'--state-dir',join(dir,'stored')],{stdio:['pipe','pipe','pipe']});
  let nextId=0;const pending=new Map();
  child.stderr.on('data',b=>{console.error('worker error:',b.toString())});
  readline.createInterface({input:child.stdout}).on('line',line=>{
    try{const msg=JSON.parse(line);const waiting=pending.get(msg.id);if(!waiting)throw Error('unmatched reply');pending.delete(msg.id);waiting(msg);}catch(e){console.error(e)}
  });
  const ask=async (method,props={})=>{
    const id=++nextId;
    const reply=new Promise((resolve,reject)=>{pending.set(id,resolve);child.once('exit',()=>reject(Error('Worker terminated early')))});
    child.stdin.write(JSON.stringify({id,method,...props})+'\n');
    const response=await reply;
    if(!response.ok)throw Error(response.error);
    return response.result;
  };
  const stop=async()=>{child.stdin.end();await new Promise(resolve=>child.once('exit',resolve))};
  return {ask,stop};
}

test('Actual JSON-lines adapter stages, commits, reloads and rejects duplicate TEST-VALU',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'valu-abci-worker-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const sender=newPair(),receiver=newPair(),now=Math.floor(Date.now()/1000);
  const accounts=[{publicDER:sender.publicDER,balanceUnits:toUnits('2000')},{publicDER:receiver.publicDER,balanceUnits:'0'}];
  const config=join(dir,'demo-genesis.json');
  await writeFile(config,JSON.stringify({version:1,chainId:CHAIN_ID,wallets:accounts}));
  const tx=signedTransaction({privatePEM:sender.privatePEM,publicDER:sender.publicDER,to:addressFromPublicDER(receiver.publicDER),amountUnits:toUnits('100'),nonce:1});
  const wire=Buffer.from(JSON.stringify(tx)).toString('base64');
  let worker=await startWorker(dir,config);
  const info=await worker.ask('info'); assert.equal(info.height,0);
  const initialized=await worker.ask('init',{chainId:CHAIN_ID,initialHeight:1});
  assert.equal(initialized.appHash,stateHash(genesis(accounts)));
  assert.equal((await worker.ask('check',{tx:wire,blockTime:now})).code,0);
  const prepared=await worker.ask('prepare',{txs:[wire,wire],height:1,blockTime:now,maxBytes:10000});
  assert.deepEqual(prepared.txs,[wire]);
  assert.equal((await worker.ask('process',{txs:[wire,wire],height:1,blockTime:now})).accept,true);
  const result=await worker.ask('finalize',{txs:[wire,wire],height:1,blockTime:now});
  assert.deepEqual(result.results.map(x=>x.code),[0,1]);
  assert.equal((await worker.ask('info')).height,0,'finalize cannot claim committed state');
  const written=await worker.ask('commit');assert.equal(written.height,1);assert.equal(written.appHash,result.appHash);
  const q=await worker.ask('query',{path:'/demo-state'});
  assert.equal(q.code,0);const state=JSON.parse(q.value);
  assert.equal(state.balances[addressFromPublicDER(sender.publicDER)],toUnits('1900'));
  assert.equal(state.balances[addressFromPublicDER(receiver.publicDER)],toUnits('90'));
  assert.equal(state.poolUnits,toUnits('60'));
  await worker.stop();
  worker=await startWorker(dir,config);
  assert.equal((await worker.ask('info')).height,1);
  assert.equal((await worker.ask('check',{tx:wire,blockTime:now})).code,1);
  const again=await worker.ask('finalize',{txs:[wire],height:2,blockTime:now+1});
  assert.equal(again.results[0].code,1);
  await worker.ask('commit');await worker.stop();
});