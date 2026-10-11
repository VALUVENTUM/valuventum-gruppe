/** Creates NEW, INSECURE test-only local accounts. Never import old wallet. */
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {newPair,toUnits,CHAIN_ID,addressFromPublicDER} from '../src/core.mjs';
const dir=process.argv[2];if(!dir)throw Error('usage: node tools/demo-genesis.mjs <test-data-directory>');
await mkdir(dir,{recursive:true,mode:0o700});
const a=newPair(),b=newPair();
const wallets=[{publicDER:a.publicDER,balanceUnits:toUnits('2000')},{publicDER:b.publicDER,balanceUnits:'0'}];
await writeFile(join(dir,'demo-genesis.json'),JSON.stringify({version:1,chainId:CHAIN_ID,wallets},null,2),{flag:'wx',mode:0o600});
await writeFile(join(dir,'sender-demo.pem'),a.privatePEM,{flag:'wx',mode:0o600});
await writeFile(join(dir,'receiver-demo.pem'),b.privatePEM,{flag:'wx',mode:0o600});
console.log('Created synthetic test chain',CHAIN_ID);
console.log('Sender:',addressFromPublicDER(a.publicDER),'Recipient:',addressFromPublicDER(b.publicDER));
console.log('TEST-ONLY keys kept in',dir);