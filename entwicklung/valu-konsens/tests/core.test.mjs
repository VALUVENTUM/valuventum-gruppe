import test from 'node:test';
import assert from 'node:assert/strict';
import {
 CHAIN_ID, addressFromPublicDER, applyTransaction, calculateSplit,
 canonical, genesis, newPair, signText, signedTransaction, showValu,
 toUnits, total, txHash, verifyTransaction, votePayload
} from '../src/core.mjs';

function setup() {
 const alice=newPair(),bob=newPair();
 const state=genesis([{publicDER:alice.publicDER,balanceUnits:toUnits('1000')},{publicDER:bob.publicDER,balanceUnits:toUnits('0')}]);
 const validators=['v1','v2','v3','v4'].map(name=>({name,...newPair()}));
 const tx=signedTransaction({privatePEM:alice.privatePEM,publicDER:alice.publicDER,to:addressFromPublicDER(bob.publicDER),amountUnits:toUnits('100'),nonce:1});
 const certificate=validators.slice(0,3).map(v=>({name:v.name,signature:signText(v.privatePEM,votePayload({name:v.name,height:1,previousHead:state.head,txHash:txHash(tx)}))}));
 return {alice,bob,state,validators,tx,certificate};
}
test('stabile Serialisierung schliesst unterschiedliche Schluesselreihenfolge aus',()=>assert.equal(canonical({b:2,a:1}),canonical({a:1,b:2})));
test('Ganze VALU werden exakt in Untereinheiten verarbeitet',()=>{assert.equal(toUnits('100'),'100000');assert.equal(showValu(toUnits('0.010')),'0.010');assert.throws(()=>toUnits('-1'));assert.throws(()=>toUnits('1.00001'));});
test('90/10 ohne zusaetzliche Gebuehr und ohne Verlust an Gesamtmenge',()=>{assert.deepEqual(calculateSplit(toUnits('100')),{grossUnits:'100000',receiverUnits:'90000',poolUnits:'10000'});assert.throws(()=>calculateSplit('11'));});
test('Gueltige Ed25519-Signatur ermoeglicht Testzahlung',()=>{const s=setup();assert.equal(verifyTransaction(s.state,s.tx).grossUnits,'100000');});
test('Manipulation an Betrag oder Empfaenger wird blockiert',()=>{const s=setup();const t=structuredClone(s.tx);t.payload.amountUnits=toUnits('200');assert.throws(()=>verifyTransaction(s.state,t),/Signatur/);t.payload.amountUnits=s.tx.payload.amountUnits;t.payload.to=s.tx.payload.from;assert.throws(()=>verifyTransaction(s.state,t));});
test('Unbekannter Wallet-Schluessel kann fremdes Testkonto nicht vertreten',()=>{const s=setup();const t=structuredClone(s.tx);t.payload.senderPub=newPair().publicDER;assert.throws(()=>verifyTransaction(s.state,t));});
test('Gueltiges Quorum speichert einmalige 90/10-Buchung',()=>{const s=setup();const n=applyTransaction(s.state,s.tx,s.certificate,s.validators);assert.equal(n.height,1);assert.equal(showValu(n.accounts[s.tx.payload.from].balanceUnits),'900.000');assert.equal(showValu(n.accounts[s.tx.payload.to].balanceUnits),'90.000');assert.equal(showValu(n.poolUnits),'60.000');assert.equal(showValu(total(n)),'1050.000');assert.throws(()=>applyTransaction(n,s.tx,s.certificate,s.validators));});
test('Zwei statt drei Unterschriften werden zurueckgewiesen',()=>{const s=setup();assert.throws(()=>applyTransaction(s.state,s.tx,s.certificate.slice(0,2),s.validators),/Quorum/);});
test('Doppelte Validator-Stimme zaehlt nicht zweimal',()=>{const s=setup();const bad=[s.certificate[0],s.certificate[0],s.certificate[1]];assert.throws(()=>applyTransaction(s.state,s.tx,bad,s.validators),/doppelte/);});
test('Signatur eines anderen Validators ist nicht vertauschbar',()=>{const s=setup();const bad=structuredClone(s.certificate);bad[0].name='v4';assert.throws(()=>applyTransaction(s.state,s.tx,bad,s.validators));});
test('Nicht gedeckte Buchung bleibt gesperrt',()=>{const s=setup();const big=signedTransaction({privatePEM:s.alice.privatePEM,publicDER:s.alice.publicDER,to:addressFromPublicDER(s.bob.publicDER),amountUnits:toUnits('1001'),nonce:1});assert.throws(()=>verifyTransaction(s.state,big),/Zu wenig/);});
test('Falsche Netzwerkkennung wird zurueckgewiesen',()=>{const s=setup();const bad=structuredClone(s.tx);bad.payload.chainId='ANOTHER';assert.throws(()=>verifyTransaction(s.state,bad),/netz/i);});
test('Doppelter Nonce wird vor zweitem Transfer blockiert',()=>{const s=setup();const n=applyTransaction(s.state,s.tx,s.certificate,s.validators);const t=signedTransaction({privatePEM:s.alice.privatePEM,publicDER:s.alice.publicDER,to:addressFromPublicDER(s.bob.publicDER),amountUnits:toUnits('10'),nonce:1});assert.throws(()=>verifyTransaction(n,t),/Nonce/);});