/**
 * Local crash-aware storage for synthetic VALU test state.
 * Files are NOT a distributed ledger. Do not use with real assets.
 * Single-writer local directory with compare-and-swap and fsync/rename.
 */
import {mkdir, open, readFile, rename, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {CHAIN_ID, total} from './core.mjs';
import {stateHash} from './deterministic-state.mjs';

function verifyEnvelope(envelope, genesisState) {
  if (!envelope || envelope.version !== 1 || envelope.chainId !== CHAIN_ID ||
      envelope.genesisHash !== stateHash(genesisState)) {
    throw Error('Unknown state format, chain or genesis');
  }
  const s = envelope.state;
  if (!s || s.chainId !== CHAIN_ID || !Number.isSafeInteger(s.height) || s.height < 1 ||
      envelope.height !== s.height || envelope.appHash !== stateHash(s)) {
    throw Error('Corrupt persisted state or hash mismatch');
  }
  if (total(s) !== total(genesisState)) throw Error('Supply mismatch after restart');
  return s;
}

export class PersistentState {
  constructor(directory, genesisState) {
    if (genesisState?.chainId !== CHAIN_ID || genesisState?.height !== 0) throw Error('Invalid synthetic genesis');
    this.directory = directory;
    this.genesis = structuredClone(genesisState);
    this.statePath = join(directory, 'valu-state.json');
    this.lockPath = join(directory, 'valu-state.lock');
  }

  async load() {
    let serialized;
    try { serialized = await readFile(this.statePath, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return structuredClone(this.genesis);
      throw error;
    }
    let envelope;
    try { envelope = JSON.parse(serialized); } catch { throw Error('Invalid persisted JSON'); }
    return structuredClone(verifyEnvelope(envelope, this.genesis));
  }

  /**
   * Store only a finalized state, guarded by the preceding committed hash.
   * An uncertain I/O failure is NOT reported as a successful commit.
   */
  async commit(expectedPrevious, nextState) {
    if (nextState?.height !== expectedPrevious?.height + 1 ||
        nextState?.chainId !== CHAIN_ID ||
        total(nextState) !== total(expectedPrevious)) throw Error('Invalid next state');
    await mkdir(this.directory, {recursive:true, mode:0o700});
    let lock;
    try { lock = await open(this.lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw Error('State locked by another writer; inspect before recovery');
      throw error;
    }
    let tmpPath;
    try {
      const current = await this.load();
      if (stateHash(current) !== stateHash(expectedPrevious)) throw Error('Stale committed state; refusing overwrite');
      const envelope = {
        version:1, chainId:CHAIN_ID, genesisHash:stateHash(this.genesis),
        height:nextState.height, appHash:stateHash(nextState), state:nextState
      };
      tmpPath = join(this.directory, `.valu-state-${process.pid}-${randomBytes(8).toString('hex')}.tmp`);
      const file = await open(tmpPath, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(envelope)); await file.sync(); }
      finally { await file.close(); }
      await rename(tmpPath, this.statePath);
      tmpPath = undefined;
      const dir = await open(this.directory, 'r');
      try { await dir.sync(); } finally { await dir.close(); }
      return envelope.appHash;
    } finally {
      if (tmpPath) await unlink(tmpPath).catch(() => {});
      await lock.close();
      await unlink(this.lockPath).catch(() => {});
    }
  }
}