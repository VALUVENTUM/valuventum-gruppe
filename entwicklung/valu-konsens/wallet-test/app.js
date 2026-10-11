'use strict';
import {signDemoPayment,unitsFromValu} from './sign.mjs';
const el=id=>document.getElementById(id);
const money=units=>{const n=BigInt(units),a=n/1000n,b=(n%1000n).toString().padStart(3,'0');return `${new Intl.NumberFormat('de-AT').format(a)},${b}`;};
function create(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
let current=null;
function fillAccounts(data){
 const selectedFrom=el('from').value,selectedTo=el('to').value;
 const sender=el('from'),recipient=el('to');sender.replaceChildren();recipient.replaceChildren();
 for(const [i,a]of data.accounts.entries()){
   const label=`Testkonto ${i+1}: ${a.address}`;
   const option=create('option',label);option.value=a.address;sender.add(option);
   const toOption=create('option',label);toOption.value=a.address;recipient.add(toOption);
 }
 sender.value=data.accounts.some(x=>x.address===selectedFrom)?selectedFrom:data.accounts[0].address;
 const preferred=data.accounts.find(x=>x.address===selectedTo && x.address!==sender.value)?.address;
 recipient.value=preferred||data.accounts.find(x=>x.address!==sender.value)?.address||'';
}
function draw(data){
 el('height').textContent=String(data.height);
 el('chain').textContent=data.chainId;
 el('pool').textContent=money(data.poolUnits)+' VALU';
 el('hash').textContent=data.appHash;
 const accounts=el('accounts');accounts.replaceChildren();
 for(const [i,a]of data.accounts.entries()){
   const card=create('article',undefined,'account');
   card.append(create('div',`Testkonto ${i+1}`,'account-name'),create('div',money(a.balanceUnits)+' VALU','amount'),create('code',a.address));
   accounts.append(card);
 }
 const tbody=el('receipts');tbody.replaceChildren();
 if(data.receipts.length===0){const tr=create('tr');const td=create('td','Noch keine bestaetigten Testzahlungen.');td.colSpan=4;tr.append(td);tbody.append(tr);}
 for(const r of data.receipts){
   const tr=create('tr');
   for(const s of [String(r.height),money(r.grossUnits)+' VALU',money(r.receiverUnits)+' VALU',money(r.poolUnits)+' VALU'])tr.append(create('td',s));
   tbody.append(tr);
 }
 fillAccounts(data);
 el('connection').textContent=`Testnetz verbunden - Block ${data.height}`;
 el('connection').className='connection online';
}
let refreshing=false,sending=false;
async function update(){
 if(refreshing||sending)return;refreshing=true;el('reload').disabled=true;
 try{
   const res=await fetch('/api/state',{cache:'no-store',signal:AbortSignal.timeout(6000)});
   if(!res.ok)throw Error('Testnetz offline');
   const data=await res.json();if(!data.demo||!data.readOnly||!Array.isArray(data.accounts))throw Error('Keine Testnetzdaten');
   current=data;draw(data);
 }catch(err){current=null;el('connection').textContent='Testnetz nicht erreichbar - keine Live-Daten';el('connection').className='connection offline';}
 finally{refreshing=false;el('reload').disabled=false;}
}
function sendMessage(message){el('send-status').textContent=message;}
el('reload').addEventListener('click',update);
el('from').addEventListener('change',()=>{if(current)fillAccounts(current);});
el('send-form').addEventListener('submit',async(event)=>{
 event.preventDefault();
 if(sending)return;
 if(!current){sendMessage('Testnetz nicht verbunden; nichts gesendet.');return;}
 const account=current.accounts.find(x=>x.address===el('from').value);
 const recipient=el('to').value,valu=el('valu').value.trim().replace(',','.');
 const keyfile=el('test-key').files?.[0];
 if(!account || !keyfile){sendMessage('Absender und Testschluessel-Datei fehlen.');return;}
 if(keyfile.size>5000){sendMessage('Ungueltige Testschluessel-Datei.');return;}
 try{
   const gross=BigInt(unitsFromValu(valu)),community=gross/10n,net=gross-community;
   if(!current.accounts.some(x=>x.address===recipient) || recipient===account.address)throw Error('Empfaenger ungueltig');
   if(gross>BigInt(account.balanceUnits))throw Error('Zu wenig TEST-VALU');
   const question=`Nur TEST-VALU: ${money(gross)} senden, ${money(net)} fuer den Empfaenger, ${money(community)} in den Gemeinschaftstopf. Bestaetigen?`;
   if(!window.confirm(question))return;
   sending=true;el('send-button').disabled=true;
   sendMessage('Testauftrag wird lokal signiert und zur Bestaetigung gesendet ...');
   const pem=await keyfile.text();
   const tx=await signDemoPayment({privatePEM:pem,senderPublicDER:account.publicDER,to:recipient,valu,nonce:account.nonce+1,memo:el('memo').value});
   el('test-key').value='';
   const result=await fetch('/api/submit',{method:'POST',headers:{'content-type':'application/json','x-valu-demo':'synthetic'},body:JSON.stringify(tx),signal:AbortSignal.timeout(55000)});
   const data=await result.json();
   if(!result.ok || data.status!=='confirmed')throw Error(data.reason||data.error||'Keine Buchungsbestaetigung');
   sendMessage(`Bestaetigt in Block ${data.height}. ${money(data.grossUnits)} Test-VALU gebucht. Quittung ${data.id.slice(0,12)}...`);
 }catch(e){sendMessage(`Nicht bestaetigt: ${String(e.message).slice(0,190)}. Vor erneuter Zahlung Kontostand pruefen.`);}
 finally{el('test-key').value='';sending=false;el('send-button').disabled=false;await update();}
});
update();setInterval(update,8000);