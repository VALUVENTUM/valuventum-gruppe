import test from 'node:test';
import assert from 'node:assert/strict';
import {CHAIN_ID, addressFromPublicDER, genesis, newPair, signedTransaction, toUnits, total} from '../src/core.mjs';
import {stateHash} from '../src/deterministic-state.mjs';
import {executeConsensusBlock,prepareConsensusProposal,checkConsensusTx,encodeTx,MAX_TX_BYTES} from '../src/abci-execution.mjs';

function scenario() {
  const sender=newPair(),recipient=newPair(), time=Math.floor(Date.now()/1000);
  const initial=genesis([{publicDER:sender.publicDER,balanceUnits:toUnits('2000')},{publicDER:recipient.publicDER,balanceUnits:'0'}]);
  const make=(amount,nonce)=>signedTransaction({privatePEM:sender.privatePEM,publicDER:sender.publicDER,to:addressFromPublicDER(recipient.publicDER),amountUnits:toUnits(amount),nonce});
  return {sender,recipient,time,initial,make,ctx:{height:1,blockTime:time}};
}

test('ABCI per-transaction mixed block is deterministic; invalid entries do not abort valid entry',()=>{
  const s=scenario(),valid=encodeTx(s.make('100',1));
  const bad=Buffer.from('invalid JSON');
  const a=executeConsensusBlock(s.initial,[valid,bad,valid],s.ctx);
  const b=executeConsensusBlock(structuredClone(s.initial),[valid,bad,valid],s.ctx);
  assert.deepEqual(a,b);
  assert.deepEqual(a.results.map(x=>x.code),[0,1,1]);
  assert.equal(a.state.accounts[s.make('100',1).payload.from].balanceUnits,toUnits('1900'));
  assert.equal(a.state.accounts[addressFromPublicDER(s.recipient.publicDER)].balanceUnits,toUnits('90'));
  assert.equal(a.state.poolUnits,toUnits('60'));
  assert.equal(a.state.receipts.length,1);
  assert.equal(a.appHash,stateHash(a.state));
  assert.equal(total(a.state),total(s.initial));
  assert.equal(s.initial.height,0);
});

test('ABCI two sequential distinct signed payments in same block are credited once each',()=>{
  const s=scenario(), a=encodeTx(s.make('100',1)),b=encodeTx(s.make('20',2));
  const res=executeConsensusBlock(s.initial,[a,b],s.ctx);
  assert.deepEqual(res.results.map(x=>x.code),[0,0]);
  assert.equal(res.state.accounts[addressFromPublicDER(s.sender.publicDER)].balanceUnits,toUnits('1880'));
  assert.equal(res.state.accounts[addressFromPublicDER(s.recipient.publicDER)].balanceUnits,toUnits('108'));
  assert.equal(res.state.poolUnits,toUnits('62'));
  assert.equal(res.state.receipts.length,2);
});

test('ABCI proposer filters duplicates, bad and out-of-sequence orders while preserving tx bytes',()=>{
  const s=scenario(),valid=encodeTx(s.make('100',1)),nonce2=encodeTx(s.make('10',2)),bad=Buffer.from('{');
  const result=prepareConsensusProposal(s.initial,[bad,nonce2,valid,valid,nonce2],s.ctx,valid.length+nonce2.length);
  assert.deepEqual(result,[valid,nonce2]);
  assert.deepEqual(prepareConsensusProposal(s.initial,[valid],s.ctx,valid.length-1),[]);
});

test('ABCI invalid time, block height and huge message blocked',()=>{
  const s=scenario(),tx=encodeTx(s.make('100',1));
  assert.throws(()=>executeConsensusBlock(s.initial,[tx],{height:2,blockTime:s.time}),/height/);
  assert.throws(()=>executeConsensusBlock(s.initial,[tx],{height:1,blockTime:-1}),/time/);
  assert.equal(checkConsensusTx(s.initial,Buffer.alloc(MAX_TX_BYTES+1),s.time).code,1);
  assert.equal(executeConsensusBlock(s.initial,[Buffer.alloc(MAX_TX_BYTES+1)],s.ctx).results[0].code,1);
  assert.deepEqual(prepareConsensusProposal(s.initial,[Buffer.alloc(MAX_TX_BYTES+1)],s.ctx,9999999),[]);
});

test('ABCI deterministic empty blocks grow height but not supply',()=>{
  const s=scenario(),a=executeConsensusBlock(s.initial,[],s.ctx);
  const b=executeConsensusBlock(a.state,[],{height:2,blockTime:s.time+2});
  assert.equal(b.state.height,2);
  assert.equal(total(a.state),total(s.initial));
  assert.equal(total(b.state),total(s.initial));
});

test('ABCI malformed JSON, top-level fields and bad signatures reject individually',()=>{
  const s=scenario(),tx=s.make('100',1),forged=structuredClone(tx);
  forged.payload.amountUnits=toUnits('200');
  const result=executeConsensusBlock(s.initial,[Buffer.from('not-json'),Buffer.from(JSON.stringify({...tx,extra:1})),encodeTx(forged)],s.ctx);
  assert.deepEqual(result.results.map(x=>x.code),[1,1,1]);
  assert.equal(result.state.receipts.length,0);
  assert.equal(result.state.accounts[addressFromPublicDER(s.sender.publicDER)].balanceUnits,toUnits('2000'));
});