import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addressFromPublicDER, calculateSplit, genesis, newPair, showValu,
  signedTransaction, toUnits, total
} from '../src/core.mjs';
import {executeBlock, stateHash} from '../src/deterministic-state.mjs';

function setup() {
  const sender = newPair(), receiver = newPair();
  const initial = genesis([
    {publicDER: sender.publicDER, balanceUnits: toUnits('2000')},
    {publicDER: receiver.publicDER, balanceUnits: toUnits('0')}
  ]);
  const now = Math.floor(Date.now() / 1000);
  function payment(gross, nonce=1) {
    return signedTransaction({privatePEM:sender.privatePEM, publicDER:sender.publicDER,
      to:addressFromPublicDER(receiver.publicDER), amountUnits:toUnits(gross), nonce});
  }
  return {sender, receiver, initial, now, payment};
}

test('Gleicher Konsensblock auf zwei Replikas liefert denselben Zustand und Hash', () => {
  const s=setup(), tx=s.payment('100');
  const a=executeBlock(structuredClone(s.initial),[tx],{height:1,blockTime:s.now});
  const b=executeBlock(structuredClone(s.initial),[tx],{height:1,blockTime:s.now});
  assert.deepEqual(a,b);
  assert.equal(a.appHash,stateHash(a.state));
});

test('100 VALU brutto: Sender -100, Empfaenger +90, Topf +10',()=>{
  const s=setup(), tx=s.payment('100');
  const result=executeBlock(s.initial,[tx],{height:1,blockTime:s.now});
  assert.equal(showValu(result.state.accounts[tx.payload.from].balanceUnits),'1900.000');
  assert.equal(showValu(result.state.accounts[tx.payload.to].balanceUnits),'90.000');
  assert.equal(showValu(result.state.poolUnits),'60.000');
  assert.equal(total(result.state),total(s.initial));
  assert.equal(s.initial.height,0);
});

test('1500 VALU brutto folgt der 90/10-Modellregel: 1350/150',()=>{
  const split=calculateSplit(toUnits('1500'));
  assert.equal(showValu(split.receiverUnits),'1350.000');
  assert.equal(showValu(split.poolUnits),'150.000');
});

test('Zwei identische Zahlungen in einem Block scheitern atomar',()=>{
  const s=setup(), tx=s.payment('100');
  const copy=structuredClone(s.initial);
  assert.throws(()=>executeBlock(s.initial,[tx,tx],{height:1,blockTime:s.now}),/Nonce|bereits/);
  assert.deepEqual(s.initial,copy);
});

test('Eine wiederholte Buchung im Folgebock wird nicht neu ausgegeben',()=>{
  const s=setup(), tx=s.payment('100');
  const first=executeBlock(s.initial,[tx],{height:1,blockTime:s.now});
  assert.throws(()=>executeBlock(first.state,[tx],{height:2,blockTime:s.now}),/Nonce|bereits/);
});

test('Manipulierter Betrag wird blockiert und Ursprung bleibt unverändert',()=>{
  const s=setup(), tx=s.payment('100');
  tx.payload.amountUnits=toUnits('200');
  const snapshot=structuredClone(s.initial);
  assert.throws(()=>executeBlock(s.initial,[tx],{height:1,blockTime:s.now}),/Signatur/);
  assert.deepEqual(s.initial,snapshot);
});

test('Auslaufzeit wird gegen vereinbarte Blockzeit statt Systemuhr geprüft',()=>{
  const s=setup(), tx=s.payment('100');
  assert.throws(()=>executeBlock(s.initial,[tx],{height:1,blockTime:s.now+5000}),/Zeitgrenze/);
  assert.equal(executeBlock(s.initial,[tx],{height:1,blockTime:s.now}).state.height,1);
});

test('Fehlerhafte Blockhoehe und fehlende Konsenszeit werden verworfen',()=>{
  const s=setup(), tx=s.payment('100');
  assert.throws(()=>executeBlock(s.initial,[tx],{height:2,blockTime:s.now}),/Blockhöhe/);
  assert.throws(()=>executeBlock(s.initial,[tx],{height:1}),/Konsens-Zeit/);
});

test('Leerer Block ist deterministisch und verändert keine Guthaben',()=>{
  const s=setup();
  const res=executeBlock(s.initial,[],{height:1,blockTime:s.now});
  assert.equal(res.state.height,1);
  assert.equal(total(res.state),total(s.initial));
  assert.equal(res.state.receipts.length,0);
});

test('Gespeicherter Zustand lässt sich reproduzierbar neu laden',()=>{
  const s=setup(), tx=s.payment('100');
  const first=executeBlock(s.initial,[tx],{height:1,blockTime:s.now});
  const restored=JSON.parse(JSON.stringify(first.state));
  assert.equal(stateHash(restored),first.appHash);
  const nextA=executeBlock(first.state,[],{height:2,blockTime:s.now+1});
  const nextB=executeBlock(restored,[],{height:2,blockTime:s.now+1});
  assert.deepEqual(nextA,nextB);
});