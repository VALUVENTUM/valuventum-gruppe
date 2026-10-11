/**
 * CometBFT-oriented deterministic, per-transaction execution for a synthetic
 * VALU demo chain. No socket protocol here; no production assets.
 */
import {CHAIN_ID, hash, total, txHash, verifyTransaction} from './core.mjs';
import {stateHash} from './deterministic-state.mjs';

export const MAX_BLOCK_TX = 1000;
export const MAX_TX_BYTES = 65536;

function validContext(previous, transactions, context) {
  if (!previous || previous.chainId !== CHAIN_ID || !Array.isArray(transactions) || transactions.length > MAX_BLOCK_TX) {
    throw Error('Invalid chain or transaction count');
  }
  if (!context || !Number.isSafeInteger(context.height) || context.height !== previous.height + 1 ||
      !Number.isSafeInteger(context.blockTime) || context.blockTime < 0) {
    throw Error('Invalid consensus height or time');
  }
}

function parseWireTx(wire) {
  if (!Buffer.isBuffer(wire) || wire.length === 0 || wire.length > MAX_TX_BYTES) throw Error('Invalid encoded transaction length');
  const str = new TextDecoder('utf-8', {fatal:true}).decode(wire);
  const tx = JSON.parse(str);
  if (!tx || Array.isArray(tx) || Object.keys(tx).sort().join(',') !== 'payload,signature') {
    throw Error('Invalid transaction envelope');
  }
  return tx;
}

export function encodeTx(tx) {
  const data = Buffer.from(JSON.stringify(tx), 'utf8');
  if (data.length > MAX_TX_BYTES) throw Error('Transaction too large');
  return data;
}

/**
 * A consensus block can include invalid transactions. Each rejected tx must
 * yield a nonzero result without invalidating the other valid transactions.
 * Deterministic tx failure messages depend only on the block and old state.
 */
export function executeConsensusBlock(previousState, wireTxs, context) {
  validContext(previousState, wireTxs, context);
  const previousTotal = total(previousState);
  const next = structuredClone(previousState);
  const results = [];
  const acceptedIds = [];
  for (let index = 0; index < wireTxs.length; index++) {
    try {
      const tx = parseWireTx(wireTxs[index]);
      const split = verifyTransaction(next, tx, context.blockTime);
      const {payload: p} = tx;
      const id = txHash(tx);
      next.accounts[p.from].balanceUnits = (BigInt(next.accounts[p.from].balanceUnits) - BigInt(split.grossUnits)).toString();
      next.accounts[p.to].balanceUnits = (BigInt(next.accounts[p.to].balanceUnits) + BigInt(split.receiverUnits)).toString();
      next.accounts[p.from].nonce = p.nonce;
      next.poolUnits = (BigInt(next.poolUnits) + BigInt(split.poolUnits)).toString();
      next.seenTxIds.push(id);
      next.receipts.push({
        id, height: context.height, index, from: p.from, to: p.to,
        grossUnits: split.grossUnits, receiverUnits: split.receiverUnits, poolUnits: split.poolUnits
      });
      acceptedIds.push(id);
      results.push({code:0, log:'VALU demo transaction accepted'});
    } catch (err) {
      results.push({code:1, log: String(err?.message ?? 'Invalid transaction').slice(0,180)});
    }
  }
  next.height = context.height;
  next.head = hash({
    chainId:CHAIN_ID, previousHead:previousState.head, height:context.height,
    blockTime:context.blockTime, transactionIds:acceptedIds
  });
  if (total(next) !== previousTotal) throw Error('Supply invariant violated');
  return {state:next, appHash:stateHash(next), results, acceptedIds};
}

/** Select only currently valid transactions in order, respecting maxBytes. */
export function prepareConsensusProposal(previous, wireTxs, context, maxBytes) {
  validContext(previous, [], context);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw Error('Invalid maxBytes');
  const selected = [];
  let usedBytes = 0;
  for (const wire of wireTxs) {
    if (!Buffer.isBuffer(wire) || wire.length > MAX_TX_BYTES || selected.length >= MAX_BLOCK_TX) continue;
    if (usedBytes + wire.length > maxBytes) continue;
    const candidate = executeConsensusBlock(previous, [...selected,wire],context);
    if (candidate.results.at(-1)?.code !== 0) continue;
    selected.push(wire);
    usedBytes += wire.length;
  }
  return selected;
}

/** Mempool check is advisory and may use local time; FinalizeBlock never does. */
export function checkConsensusTx(committed, wire, mempoolTime) {
  try {
    const tx=parseWireTx(wire);
    verifyTransaction(committed,tx,mempoolTime);
    return {code:0,log:'VALU demo transaction valid'};
  } catch(err) { return {code:1,log:String(err?.message ?? 'Invalid transaction').slice(0,180)}; }
}