import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {addressFromPublicDER, genesis, newPair, signedTransaction, toUnits, total} from '../src/core.mjs';
import {stateHash} from '../src/deterministic-state.mjs';
import {ValuLifecycle} from '../src/abci-lifecycle.mjs';

function scenario() {
  const sender=newPair(), receiver=newPair();
  const initial=genesis([
    {publicDER:sender.publicDER, balanceUnits:toUnits('2000')},
    {publicDER:receiver.publicDER, balanceUnits:toUnits('0')}
  ]);
  const tx=signedTransaction({privatePEM:sender.privatePEM,publicDER:sender.publicDER,
    to:addressFromPublicDER(receiver.publicDER),amountUnits:toUnits('100'),nonce:1});
  return {initial,tx,ctx:{height:1,blockTime:tx.payload.issuedAt}};
}

async function sandbox(t) {
  const dir=await mkdtemp(join(tmpdir(),'valu-test-'));
  t.after(async()=>{await rm(dir,{recursive:true,force:true})});
  return dir;
}

test('FinalizeBlock without Commit never writes disk state', async(t)=>{
  const dir=await sandbox(t), s=scenario();
  const app=await ValuLifecycle.open(dir,s.initial);
  const before=app.info();
  const candidate=app.finalizeBlock([s.tx],s.ctx);
  assert.equal(candidate.height,1);
  assert.deepEqual(app.info(),before);
  const files=await readdir(dir).catch(()=>[]);
  assert.equal(files.includes('valu-state.json'),false);
  const restarted=await ValuLifecycle.open(dir,s.initial);
  assert.equal(restarted.info().height,0);
});

test('Commit persists exact 90/10 state across a process-like restart',async(t)=>{
  const dir=await sandbox(t),s=scenario(), app=await ValuLifecycle.open(dir,s.initial);
  const expected=app.finalizeBlock([s.tx],s.ctx);
  const committed=await app.commit();
  assert.equal(committed.appHash,expected.appHash);
  const again=await ValuLifecycle.open(dir,s.initial);
  assert.deepEqual(again.info(),committed);
  const state=again.snapshot();
  assert.equal(state.accounts[s.tx.payload.from].balanceUnits,toUnits('1900'));
  assert.equal(state.accounts[s.tx.payload.to].balanceUnits,toUnits('90'));
  assert.equal(state.poolUnits,toUnits('60'));
  assert.equal(total(state),total(s.initial));
  assert.equal(stateHash(state),committed.appHash);
});

test('Two independent local replicas calculate equal state hashes and save individually',async(t)=>{
  const root=await sandbox(t),s=scenario();
  const a=await ValuLifecycle.open(join(root,'a'),s.initial);
  const b=await ValuLifecycle.open(join(root,'b'),s.initial);
  assert.deepEqual(a.processProposal([s.tx],s.ctx),{accept:true});
  assert.deepEqual(b.processProposal([s.tx],s.ctx),{accept:true});
  assert.deepEqual(a.finalizeBlock([s.tx],s.ctx),b.finalizeBlock([s.tx],s.ctx));
  assert.deepEqual(await a.commit(),await b.commit());
  const restartA=await ValuLifecycle.open(join(root,'a'),s.initial);
  const restartB=await ValuLifecycle.open(join(root,'b'),s.initial);
  assert.deepEqual(restartA.snapshot(),restartB.snapshot());
});

test('A second writer cannot overwrite a committed height',async(t)=>{
  const dir=await sandbox(t),s=scenario();
  const a=await ValuLifecycle.open(dir,s.initial),b=await ValuLifecycle.open(dir,s.initial);
  a.finalizeBlock([s.tx],s.ctx);
  b.finalizeBlock([s.tx],s.ctx);
  await a.commit();
  await assert.rejects(()=>b.commit(),/Stale committed state/);
  assert.equal((await ValuLifecycle.open(dir,s.initial)).info().height,1);
});

test('Corrupted persisted state must not silently create a fresh balance',async(t)=>{
  const dir=await sandbox(t),s=scenario(),a=await ValuLifecycle.open(dir,s.initial);
  a.finalizeBlock([s.tx],s.ctx);await a.commit();
  const target=join(dir,'valu-state.json');
  const envelope=JSON.parse(await readFile(target,'utf8'));
  envelope.state.poolUnits='999999999999';
  await writeFile(target,JSON.stringify(envelope));
  await assert.rejects(()=>ValuLifecycle.open(dir,s.initial),/hash mismatch/);
});

test('Different genesis cannot silently access another chain state',async(t)=>{
  const dir=await sandbox(t),s=scenario(),a=await ValuLifecycle.open(dir,s.initial);
  a.finalizeBlock([s.tx],s.ctx);await a.commit();
  const wrong=structuredClone(s.initial);wrong.note='different synthetic genesis';
  await assert.rejects(()=>ValuLifecycle.open(dir,wrong),/genesis/);
});

test('Old nonce and tampered signature are rejected without changing disk',async(t)=>{
  const dir=await sandbox(t),s=scenario(),a=await ValuLifecycle.open(dir,s.initial);
  assert.deepEqual(a.checkTx(s.tx,s.ctx.blockTime),{ok:true});
  assert.equal(a.processProposal([s.tx,{...s.tx}],s.ctx).accept,false);
  const forged=structuredClone(s.tx);forged.payload.amountUnits=toUnits('200');
  assert.equal(a.processProposal([forged],s.ctx).accept,false);
  a.finalizeBlock([s.tx],s.ctx);await a.commit();
  const before=a.info();
  assert.equal(a.processProposal([s.tx],{height:2,blockTime:s.ctx.blockTime}).accept,false);
  assert.deepEqual(a.info(),before);
});

test('Uncommitted candidate can be discarded before consensus retry',async(t)=>{
  const dir=await sandbox(t),s=scenario(),a=await ValuLifecycle.open(dir,s.initial);
  a.finalizeBlock([s.tx],s.ctx);
  assert.throws(()=>a.finalizeBlock([],s.ctx),/Pending/);
  a.discardPending();
  const next=a.finalizeBlock([],s.ctx);
  await a.commit();
  assert.equal((await ValuLifecycle.open(dir,s.initial)).info().appHash,next.appHash);
  assert.equal(a.snapshot().receipts.length,0);
});

test('Lock file prevents two writers and never auto-removes an uncertain stale lock',async(t)=>{
  const dir=await sandbox(t),s=scenario(),a=await ValuLifecycle.open(dir,s.initial);
  a.finalizeBlock([s.tx],s.ctx);
  await writeFile(join(dir,'valu-state.lock'),'existing');
  await assert.rejects(()=>a.commit(),/State locked/);
  assert.equal(a.info().height,0);
  assert.equal((await ValuLifecycle.open(dir,s.initial)).info().height,0);
});

test('Unknown commit response: restart sees committed nonce and rejects duplicate',async(t)=>{
  const dir=await sandbox(t),s=scenario(),a=await ValuLifecycle.open(dir,s.initial);
  a.finalizeBlock([s.tx],s.ctx);
  await a.commit();
  // Simulate a lost HTTP/IPC answer: a new instance knows only the disk state.
  const b=await ValuLifecycle.open(dir,s.initial);
  assert.equal(b.info().height,1);
  assert.equal(b.processProposal([s.tx],{height:2,blockTime:s.ctx.blockTime}).accept,false);
  assert.equal(b.snapshot().receipts.length,1);
});

test('Unfinished temporary write is ignored; last committed state wins',async(t)=>{
  const dir=await sandbox(t),s=scenario(),a=await ValuLifecycle.open(dir,s.initial);
  a.finalizeBlock([s.tx],s.ctx);const committed=await a.commit();
  await writeFile(join(dir,'.valu-state-ignored.tmp'),'{invalid-json');
  const recovered=await ValuLifecycle.open(dir,s.initial);
  assert.deepEqual(recovered.info(),committed);
});