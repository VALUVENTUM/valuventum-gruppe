/**
 * ABCI++ LIFECYCLE PROTOTYPE ONLY. No CometBFT socket/gRPC transport.
 * The methods mirror the FinalizeBlock -> Commit separation, but this
 * class is not a CometBFT Application until an actual ABCI adapter exists.
 */
import {verifyTransaction} from './core.mjs';
import {executeBlock, stateHash} from './deterministic-state.mjs';
import {PersistentState} from './persistent-state.mjs';

export class ValuLifecycle {
  static async open(directory, syntheticGenesis) {
    const disk = new PersistentState(directory, syntheticGenesis);
    const committed = await disk.load();
    return new ValuLifecycle(disk, committed);
  }
  constructor(disk, committed) {
    this.disk = disk;
    this.committed = committed;
    this.pending = undefined;
  }
  info() { return {height:this.committed.height, appHash:stateHash(this.committed)}; }
  checkTx(tx, blockTime) {
    try { verifyTransaction(this.committed, tx, blockTime); return {ok:true}; }
    catch (error) { return {ok:false, reason:error.message}; }
  }
  processProposal(transactions, context) {
    try { executeBlock(this.committed, transactions, context); return {accept:true}; }
    catch (error) { return {accept:false, reason:error.message}; }
  }
  finalizeBlock(transactions, context) {
    if (this.pending) throw Error('Pending block must be committed or discarded first');
    const result = executeBlock(this.committed, transactions, context);
    this.pending = result;
    return {height:result.state.height, appHash:result.appHash, transactionIds:result.transactionIds};
  }
  /** Stage a deterministic consensus candidate with individual tx results. */
  setPendingConsensus(candidate) {
    if (this.pending) throw Error('Pending block must be committed or discarded first');
    if (candidate?.state?.height !== this.committed.height + 1) throw Error('Invalid pending height');
    this.pending = candidate;
  }
  async commit() {
    if (!this.pending) throw Error('No finalized block waiting for Commit');
    const candidate = this.pending;
    const hash = await this.disk.commit(this.committed, candidate.state);
    this.committed = candidate.state;
    this.pending = undefined;
    return {height:this.committed.height, appHash:hash};
  }
  discardPending() { this.pending = undefined; }
  snapshot() { return structuredClone(this.committed); }
}