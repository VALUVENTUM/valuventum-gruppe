/**
 * Experimental deterministic VALU application state transition.
 * CometBFT is NOT integrated here. This is a pure state machine intended
 * to be wrapped by a future consensus adapter.
 * No network, issuance, identities, private keys, or production funds.
 */
import { CHAIN_ID, hash, total, txHash, verifyTransaction } from './core.mjs';

const MAX_TX_PER_BLOCK = 1000;

function assertBlockContext(previousState, transactions, context) {
  if (!previousState || previousState.chainId !== CHAIN_ID) throw Error('Falscher oder fehlender Testnetz-Zustand');
  if (!Array.isArray(transactions) || transactions.length > MAX_TX_PER_BLOCK) throw Error('Ungültige Transaktionsliste');
  if (!context || !Number.isSafeInteger(context.height) || context.height !== previousState.height + 1) {
    throw Error('Blockhöhe nicht fortlaufend');
  }
  if (!Number.isSafeInteger(context.blockTime) || context.blockTime < 0) {
    throw Error('Konsens-Zeit fehlt oder ist ungültig');
  }
}

/** Hash of the full application state (including synthetic test history). */
export function stateHash(state) {
  return hash({
    chainId: state.chainId,
    height: state.height,
    head: state.head,
    accounts: state.accounts,
    poolUnits: state.poolUnits,
    seenTxIds: state.seenTxIds,
    receipts: state.receipts,
    note: state.note
  });
}

/**
 * Execute an already consensus-ordered block without changing input state.
 * All replicas MUST receive the same blockTime from the consensus header.
 * Throws atomically on any invalid transfer: no partial block is returned.
 */
export function executeBlock(previousState, transactions, context) {
  assertBlockContext(previousState, transactions, context);
  const before = total(previousState);
  const next = structuredClone(previousState);
  const ids = [];
  for (const [index, transaction] of transactions.entries()) {
    const split = verifyTransaction(next, transaction, context.blockTime);
    const p = transaction.payload;
    const id = txHash(transaction);
    next.accounts[p.from].balanceUnits = (BigInt(next.accounts[p.from].balanceUnits) - BigInt(split.grossUnits)).toString();
    next.accounts[p.to].balanceUnits = (BigInt(next.accounts[p.to].balanceUnits) + BigInt(split.receiverUnits)).toString();
    next.accounts[p.from].nonce = p.nonce;
    next.poolUnits = (BigInt(next.poolUnits) + BigInt(split.poolUnits)).toString();
    next.seenTxIds.push(id);
    next.receipts.push({
      id, height: context.height, index, from: p.from, to: p.to,
      grossUnits: split.grossUnits,
      receiverUnits: split.receiverUnits,
      poolUnits: split.poolUnits
    });
    ids.push(id);
  }
  next.height = context.height;
  next.head = hash({chainId: CHAIN_ID, previousHead: previousState.head, height: context.height,
    blockTime: context.blockTime, transactionIds: ids});
  if (total(next) !== before) throw Error('Mengeninvariante verletzt');
  return {state: next, appHash: stateHash(next), transactionIds: ids};
}