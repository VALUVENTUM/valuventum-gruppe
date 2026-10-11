/** Browser-side Ed25519 signing for synthetic VALU test wallets only.
 * Never sends or stores PEM material. NOT production key management.
 */
export const TEST_CHAIN = 'VALUVENTUM-LOCAL-DEMO-7';

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function fromBase64(text) {
  if (typeof text !== 'string' || text.length > 10000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4)
    throw Error('Ungueltiger Base64-Inhalt');
  return Uint8Array.from(atob(text),char=>char.charCodeAt(0));
}
function toBase64(data) {
  let value=''; for(const part of data)value+=String.fromCharCode(part);
  return btoa(value);
}
function fromPEM(pem) {
  if(typeof pem !== 'string' || pem.length>5000)throw Error('Ungueltige Testschluessel-Datei');
  const m=/^\s*-----BEGIN PRIVATE KEY-----\s*([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----\s*$/.exec(pem);
  if(!m)throw Error('Nur eine Ed25519-PKCS8-PEM-Testdatei ist erlaubt');
  const data=fromBase64(m[1].replace(/\s/g,''));
  if(data.length<32 || data.length>200)throw Error('Ungueltige Testschluessel-Laenge');
  return data;
}
function hex(data){return Array.from(data,b=>b.toString(16).padStart(2,'0')).join('');}
export async function accountAddress(publicDER,subtle=globalThis.crypto?.subtle) {
  if(!subtle)throw Error('WebCrypto nicht verfuegbar');
  const bytes=fromBase64(publicDER);
  if(bytes.length<30 || bytes.length>200)throw Error('Ungueltiger oeffentlicher Schluessel');
  const digest=await subtle.digest('SHA-256',new TextEncoder().encode(hex(bytes)));
  const raw=hex(new Uint8Array(digest)).slice(0,24).toUpperCase();
  return 'VALU-'+raw.match(/.{4}/g).join('-');
}
export function unitsFromValu(value){
  if(typeof value!=='string' || !/^(0|[1-9][0-9]*)(\.[0-9]{1,3})?$/.test(value))throw Error('Ungueltiger VALU-Betrag');
  const [whole,decimal='']=value.split('.');
  const units=BigInt(whole)*1000n+BigInt((decimal+'000').slice(0,3));
  if(units<10n || units%10n!==0n)throw Error('Betrag muss ein Vielfaches von 0,010 Test-VALU sein');
  return units.toString();
}
export async function signDemoPayment({privatePEM,senderPublicDER,to,valu,nonce,memo='TEST',now=Math.floor(Date.now()/1000),subtle=globalThis.crypto?.subtle}) {
  if(!subtle)throw Error('Dieser Browser unterstuetzt Ed25519-WebCrypto nicht');
  if(!Number.isSafeInteger(nonce)||nonce<1)throw Error('Ungueltige Kontofolge-Nummer');
  if(!Number.isSafeInteger(now)||now<0)throw Error('Ungueltige Uhrzeit');
  if(typeof memo!=='string'||memo.length>120||/[\x00-\x08\x0e-\x1f]/.test(memo))throw Error('Ungueltiger Verwendungszweck');
  const from=await accountAddress(senderPublicDER,subtle);
  if(!/^VALU-(?:[0-9A-F]{4}-){5}[0-9A-F]{4}$/.test(to) || to===from)throw Error('Ungueltige Test-Empfaengeradresse');
  const payload={
    chainId:TEST_CHAIN,from,to,senderPub:senderPublicDER,
    amountUnits:unitsFromValu(valu),nonce,memo,
    issuedAt:now,expiresAt:now+1200
  };
  let privateKey,publicKey;
  try {
    privateKey=await subtle.importKey('pkcs8',fromPEM(privatePEM),{name:'Ed25519'},false,['sign']);
    publicKey=await subtle.importKey('spki',fromBase64(senderPublicDER),{name:'Ed25519'},false,['verify']);
  }catch{throw Error('Testschluessel oder oeffentliche Kontodaten sind ungueltig');}
  const data=new TextEncoder().encode(canonical(payload));
  const signatureBytes=new Uint8Array(await subtle.sign('Ed25519',privateKey,data));
  const matches=await subtle.verify('Ed25519',publicKey,signatureBytes,data);
  if(!matches)throw Error('Die Testschluessel-Datei gehoert nicht zum ausgewaehlten Konto');
  return {payload,signature:toBase64(signatureBytes)};
}