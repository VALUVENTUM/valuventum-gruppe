'use strict';
const el=id=>document.getElementById(id);
const money=units=>{const n=BigInt(units),a=n/1000n,b=(n%1000n).toString().padStart(3,'0');return `${new Intl.NumberFormat('de-AT').format(a)},${b}`;};
function create(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function draw(data){
 el('height').textContent=String(data.height);
 el('chain').textContent=data.chainId;
 el('pool').textContent=money(data.poolUnits)+' VALU';
 el('hash').textContent=data.appHash;
 const accounts=el('accounts');accounts.replaceChildren();
 for(const [i,a] of data.accounts.entries()){
   const card=create('article',undefined,'account');
   card.append(create('div',`Testkonto ${i+1}`,'account-name'),create('div',money(a.balanceUnits)+' VALU','amount'),create('code',a.address));
   accounts.append(card);
 }
 const tbody=el('receipts');tbody.replaceChildren();
 if(data.receipts.length===0){const tr=create('tr');const td=create('td','Noch keine bestätigten Testzahlungen.');td.colSpan=4;tr.append(td);tbody.append(tr);}
 for(const r of data.receipts){
   const tr=create('tr');
   for(const s of [String(r.height),money(r.grossUnits)+' VALU',money(r.receiverUnits)+' VALU',money(r.poolUnits)+' VALU'])tr.append(create('td',s));
   tbody.append(tr);
 }
 el('connection').textContent=`Testnetz verbunden · Block ${data.height}`;
 el('connection').className='connection online';
}
let busy=false;
async function update(){
 if(busy)return;busy=true;el('reload').disabled=true;
 try{
   const res=await fetch('/api/state',{cache:'no-store',signal:AbortSignal.timeout(6000)});
   if(!res.ok)throw Error('Testnetz offline');
   const data=await res.json();if(!data.demo||!data.readOnly)throw Error('Keine Testnetzdaten');
   draw(data);
 }catch(err){el('connection').textContent='Testnetz nicht erreichbar – keine Live-Daten';el('connection').className='connection offline';}
 finally{busy=false;el('reload').disabled=false;}
}
el('reload').addEventListener('click',update);
update();setInterval(update,8000);