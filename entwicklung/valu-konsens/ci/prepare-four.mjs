/** Four synthetic CometBFT validator identities with one shared test genesis. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {CHAIN_ID} from '../src/core.mjs';
const data = process.argv[2];
if (!data) throw Error('Usage: prepare-four.mjs <fresh test dir>');
const bin = join(data,'cometbft');
const nodes = Array.from({length:4},(_,i)=>({
  i, home:join(data,`validator${i}`), rpc:28057+10*i,
  p2p:28056+10*i, abci:28058+10*i
}));
for (const n of nodes) {
  execFileSync(bin,['init','--home',n.home],{timeout:25000});
  n.id = execFileSync(bin,['show-node-id','--home',n.home],{encoding:'utf8',timeout:25000}).trim();
  const key=JSON.parse(readFileSync(join(n.home,'config','priv_validator_key.json'),'utf8'));
  n.validator={address:key.address,pub_key:key.pub_key,power:'10',name:`validator${n.i}`};
}
assert.equal(new Set(nodes.map(n=>n.id)).size,4);
assert.equal(new Set(nodes.map(n=>n.validator.address)).size,4);
const genesis=JSON.parse(readFileSync(join(nodes[0].home,'config','genesis.json'),'utf8'));
genesis.chain_id=CHAIN_ID;
genesis.initial_height='1';
genesis.validators=nodes.map(n=>n.validator);
const shared=JSON.stringify(genesis,null,2)+'\n';
for(const n of nodes){
  writeFileSync(join(n.home,'config','genesis.json'),shared);
  const file=join(n.home,'config','config.toml');
  let config=readFileSync(file,'utf8');
  const peers=nodes.filter(m=>m!==n).map(m=>`${m.id}@127.0.0.1:${m.p2p}`).join(',');
  for(const [name,val] of [['persistent_peers',JSON.stringify(peers)],['allow_duplicate_ip','true'],['addr_book_strict','false']]){
    const match=new RegExp(`^${name}\\s*=.*$`,'gm');
    assert.equal([...config.matchAll(match)].length,1,`Config setting ${name} missing/duplicated`);
    config=config.replace(match,`${name} = ${val}`);
  }
  writeFileSync(file,config);
}
console.log('FOUR_VALIDATOR_IDENTITIES_AND_SHARED_GENESIS_OK');