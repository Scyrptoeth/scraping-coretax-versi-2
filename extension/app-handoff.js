function openDb() {
  return new Promise((resolve,reject) => {
    const req = indexedDB.open('scv2-handoff',1);
    req.onupgradeneeded = () => req.result.createObjectStore('packages');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const sealedType='application/x-scv2-handoff';
const transport=globalThis.chrome?.storage?.session;
function keyName(id) {return 'scv2-handoff-'+id;}
async function temporaryKey(id,value) {
  const name=keyName(id);
  if (value === undefined) return transport ? (await transport.get(name))[name] : JSON.parse(sessionStorage.getItem(name));
  if (value === null) {
    if (transport) await transport.remove(name);
    else if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(name);
  } else if (transport) await transport.set({[name]:value});
  else sessionStorage.setItem(name,JSON.stringify(value));
}
async function importTransportKey(raw,usage) {
  return crypto.subtle.importKey('raw',new Uint8Array(raw),'AES-GCM',false,[usage]);
}
export async function putHandoff(id,blob) {
  const db = await openDb();
  try {
    let encrypted;
    if (blob) {
      const raw=crypto.getRandomValues(new Uint8Array(32)), iv=crypto.getRandomValues(new Uint8Array(12));
      const key=await importTransportKey(raw,'encrypt');
      const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,await blob.arrayBuffer());
      encrypted=new File([iv,bytes],'handoff.bin',{type:sealedType});
      await temporaryKey(id,[...raw]);
    }
    await new Promise((resolve,reject) => {
      const tx = db.transaction('packages','readwrite');
      const store = tx.objectStore('packages');
      if (blob) store.put(encrypted,id);
      else store.delete(id);
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    if (!blob) await temporaryKey(id,null);
  } catch (err) { if (blob) await temporaryKey(id,null); throw err; }
  finally {db.close();}
}
export async function readHandoff(id) {
  const db=await openDb();
  let result;
  try {
    result=await new Promise((resolve,reject) => {
      const r=db.transaction('packages').objectStore('packages').get(id);
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    });
  } finally {db.close();}
  if (!result) return null;
  if (result.type !== sealedType) return result;
  const raw=await temporaryKey(id);
  if (!raw || result.lastModified < Date.now()-10*60000) {
    await putHandoff(id,null);
    throw new Error('Waktu untuk membuka paket telah habis. Buka kembali dari halaman penarik.');
  }
  const key=await importTransportKey(raw,'decrypt'), bytes=new Uint8Array(await result.arrayBuffer());
  return new Blob([await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},key,bytes.slice(12))],{type:'application/zip'});
}
export async function removeExpiredHandoffs() {
  const db = await openDb();
  const expired=[];
  try {
    await new Promise((resolve,reject) => {
      const tx = db.transaction('packages','readwrite');
      const req = tx.objectStore('packages').openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        if (!cur.value.lastModified || cur.value.lastModified < Date.now()-10*60000) {
          expired.push(cur.key); cur.delete();
        }
        cur.continue();
      };
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    await Promise.all(expired.map(id => temporaryKey(id,null)));
  } finally { db.close(); }
}
