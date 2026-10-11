import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

export const CHAIN_ID = 'VALUVENTUM-LOCAL-DEMO-7';
export const UNITS_PER_VALU = 1000n;
export const QUORUM = 3;

export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
export function hash(v) { return createHash('sha256').update(typeof v === 'string' ? v : canonical(v)).digest('hex'); }
export function publicDER(keyObject) { return keyObject.export({ type: 'spki', format: 'der' }).toString('base64'); }
export function addressFromPublicDER(key) {
  const h = hash(Buffer.from(key, 'base64').toString('hex')).slice(0, 24).toUpperCase();
  return 'VALU-' + h.match(/.{1,4}/g).join('-');
}
export function newPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicDER: publicDER(publicKey), privatePEM: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}
export function signText(privatePEM, obj) { return sign(null, Buffer.from(canonical(obj)), privatePEM).toString('base64'); }
export function verifyText(publicKeyBase64, obj, signature) {
  try {
    const publicKey = createPublicKey({ key: Buffer.from(publicKeyBase64, 'base64'), type: 'spki', format: 'der' });
    return verify(null, Buffer.from(canonical(obj)), publicKey, Buffer.from(signature, 'base64'));
  } catch { return false; }
}
export function toUnits(valu) {
  if (typeof valu !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,3})?$/.test(valu)) throw Error('Ungültiger Valu-Betrag');
  const [whole, decimals = ''] = valu.split('.');
  return (BigInt(whole) * UNITS_PER_VALU + BigInt((decimals + '000').slice(0, 3))).toString();
}
export function showValu(units) {
  const n = BigInt(units);
  return `${n / UNITS_PER_VALU}.${String(n % UNITS_PER_VALU).padStart(3,'0')}`;
}
export function calculateSplit(amountUnits) {
  if (typeof amountUnits !== 'string' || !/^[1-9]\d*$/.test(amountUnits)) throw Error('Ungültige Untereinheiten');
  const gross = BigInt(amountUnits);
  if (gross < 10n || gross % 10n !== 0n) throw Error('Demo-Zahlung erfordert ein Vielfaches von 0,010 VALU');
  const pool = gross / 10n;
  const receiver = gross - pool;
  return { grossUnits: gross.toString(), receiverUnits: receiver.toString(), poolUnits: pool.toString() };
}
export function genesis(wallets) {
  const accounts = {};
  for (const w of wallets) {
    const address = addressFromPublicDER(w.publicDER);
    if (accounts[address]) throw Error('Doppelte Wallet');
    accounts[address] = { publicDER: w.publicDER, balanceUnits: w.balanceUnits, nonce: 0 };
  }
  const g = { chainId: CHAIN_ID, accounts, poolUnits: '50000', note: 'TESTKONTEN, kein echter Bestand' };
  return { ...g, height: 0, head: hash(g), seenTxIds: [], receipts: [] };
}
export function signedTransaction({ privatePEM, publicDER: senderPub, to, amountUnits, nonce, memo = 'TEST' }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    chainId: CHAIN_ID,
    from: addressFromPublicDER(senderPub),
    to, senderPub, amountUnits,
    nonce,
    memo,
    issuedAt: now,
    expiresAt: now + 1200
  };
  const signature = signText(privatePEM, payload);
  return { payload, signature };
}
export function txHash(tx) { return hash(tx); }
export function verifyTransaction(state, tx, now = Math.floor(Date.now()/1000)) {
  if (!tx || !tx.payload || typeof tx.signature !== 'string') throw Error('Ungültiges Auftragsformat');
  const p = tx.payload;
  const exact = ['amountUnits','chainId','expiresAt','from','issuedAt','memo','nonce','senderPub','to'];
  if (Object.keys(p).sort().join(',') !== exact.sort().join(',')) throw Error('Felder des Auftrags unzulässig');
  if (p.chainId !== CHAIN_ID || state.chainId !== CHAIN_ID) throw Error('Falsches VALU-Testnetz');
  if (typeof p.from !== 'string' || p.from !== addressFromPublicDER(p.senderPub)) throw Error('Absenderkennung ungültig');
  if (!state.accounts[p.from] || state.accounts[p.from].publicDER !== p.senderPub) throw Error('Wallet nicht in Test-Genesis');
  if (!state.accounts[p.to] || p.to === p.from) throw Error('Empfänger ungültig');
  if (!Number.isSafeInteger(p.nonce) || p.nonce !== state.accounts[p.from].nonce + 1) throw Error('Nonce bereits vergeben oder falsch');
  if (typeof p.memo !== 'string' || p.memo.length > 120 || /[\x00-\x08\x0e-\x1f]/.test(p.memo)) throw Error('Zahlungszweck ungültig');
  if (!Number.isSafeInteger(p.issuedAt) || !Number.isSafeInteger(p.expiresAt) || p.issuedAt > now + 60 || p.expiresAt < now || p.expiresAt > p.issuedAt + 1200) throw Error('Zeitgrenze verletzt');
  const split = calculateSplit(p.amountUnits);
  if (BigInt(state.accounts[p.from].balanceUnits) < BigInt(split.grossUnits)) throw Error('Zu wenig TEST-VALU');
  if (!verifyText(p.senderPub, p, tx.signature)) throw Error('Wallet-Signatur ungültig');
  if (state.seenTxIds.includes(txHash(tx))) throw Error('Auftrag bereits verarbeitet');
  return split;
}
export function votePayload({ name, height, previousHead, txHash: txDigest }) {
  return { chainId: CHAIN_ID, name, height, previousHead, txHash: txDigest };
}
export function checkCertificate(validators, certificate, tx, state) {
  if (!Array.isArray(certificate) || certificate.length < QUORUM || certificate.length > validators.length) throw Error('Quorum fehlt');
  const known = new Map(validators.map(v => [v.name, v.publicDER]));
  const seen = new Set();
  const expectedTxHash = txHash(tx);
  const nextHeight = state.height + 1;
  for (const signedVote of certificate) {
    if (!signedVote || !known.has(signedVote.name) || seen.has(signedVote.name)) throw Error('Unbekannte oder doppelte Validator-Stimme');
    seen.add(signedVote.name);
    const payload = votePayload({ name: signedVote.name, height: nextHeight, previousHead: state.head, txHash: expectedTxHash });
    if (!verifyText(known.get(signedVote.name), payload, signedVote.signature)) throw Error('Validator-Unterschrift ungültig');
  }
  return true;
}
export function applyTransaction(state, tx, certificate, validators) {
  const split = verifyTransaction(state, tx);
  checkCertificate(validators, certificate, tx, state);
  const next = structuredClone(state);
  const p = tx.payload;
  next.accounts[p.from].balanceUnits = (BigInt(state.accounts[p.from].balanceUnits) - BigInt(split.grossUnits)).toString();
  next.accounts[p.to].balanceUnits = (BigInt(state.accounts[p.to].balanceUnits) + BigInt(split.receiverUnits)).toString();
  next.accounts[p.from].nonce = p.nonce;
  next.poolUnits = (BigInt(state.poolUnits) + BigInt(split.poolUnits)).toString();
  const id = txHash(tx);
  next.seenTxIds.push(id);
  const previousHead = state.head;
  next.height = state.height + 1;
  next.head = hash({ height: next.height, previousHead, txHash: id });
  next.receipts.push({ id, height: next.height, previousHead, head: next.head, from: p.from, to: p.to, ...split });
  return next;
}
export function total(state) {
  return (Object.values(state.accounts).reduce((n,a) => n+BigInt(a.balanceUnits), 0n) + BigInt(state.poolUnits)).toString();
}