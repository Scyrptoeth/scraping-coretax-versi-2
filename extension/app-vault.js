const utf8 = new TextEncoder();
const decode = new TextDecoder();
const LOCK = 'scv2-capture-vault';
const DAY = 86400000;
let opened;
let sessionKey;
let sessionSalt;

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function database() {
  if (!opened) {
    const req = indexedDB.open(LOCK, 1);
    req.onupgradeneeded = () => {
      for (const name of ['items', 'audit', 'settings']) req.result.createObjectStore(name, {keyPath:'id'});
    };
    opened = request(req);
  }
  return opened;
}
async function read(store, id) {
  const collection = (await database()).transaction(store).objectStore(store);
  return request(id === undefined ? collection.getAll() : collection.get(id));
}
async function commit(changes) {
  const stores = [...new Set(changes.map(c => c.store))];
  if (!stores.length) return;
  const tx = (await database()).transaction(stores, 'readwrite');
  const complete = new Promise((resolve,reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error('Simpanan gagal diperbarui.'));
  });
  for (const c of changes) {
    const store = tx.objectStore(c.store);
    if ('value' in c) store.put(c.value);
    else store.delete(c.id);
  }
  return complete;
}
export async function digest(text) {
  const bytes = await crypto.subtle.digest('SHA-256', utf8.encode(text));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2,'0')).join('');
}
export async function settings() {
  return (await read('settings','config')) || {id:'config', retention:90};
}
async function derive(pass, salt) {
  const base = await crypto.subtle.importKey('raw', utf8.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',iterations:600000,hash:'SHA-256',salt:new Uint8Array(salt)},base,
    {name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function seal(value, key) {
  if (!key) return {plain:value};
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({name:'AES-GCM',iv},key,utf8.encode(JSON.stringify(value)));
  return {iv:[...iv], data};
}
async function unseal(envelope, key) {
  if ('plain' in envelope) return envelope.plain;
  if (!key) throw new Error('Buka simpanan menggunakan kata sandi.');
  const bytes = await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(envelope.iv)},key,envelope.data);
  return JSON.parse(decode.decode(bytes));
}
function keyFor(config) {
  if (!config.salt) return null;
  if (sessionSalt !== JSON.stringify(config.salt) || !sessionKey) throw new Error('Simpanan terkunci. Buka kembali halaman dengan kata sandi.');
  return sessionKey;
}
export async function unlock(pass) {
  const config = await settings();
  if (!config.salt) return;
  const candidate = await derive(pass, config.salt);
  try { await unseal(config.check,candidate); }
  catch { throw new Error('Kata sandi tidak cocok atau simpanan rusak.'); }
  sessionKey = candidate;
  sessionSalt = JSON.stringify(config.salt);
}
export function lock() { sessionKey = undefined; sessionSalt = undefined; }
export async function enableEncryption(pass) {
  if (pass.length < 10) throw new Error('Gunakan sedikitnya 10 karakter.');
  await navigator.locks.request(LOCK, async () => {
    const config = await settings();
    if (config.salt) throw new Error('Enkripsi sudah aktif.');
    const salt = [...crypto.getRandomValues(new Uint8Array(16))];
    const key = await derive(pass,salt);
    const changes = [];
    for (const store of ['items','audit']) {
      for (const row of await read(store)) {
        row.content = await seal(await unseal(row.content,null),key);
        changes.push({store,value:row});
      }
    }
    changes.push({store:'settings',value:{...config,salt,check:await seal('SCV2',key)}});
    await commit(changes);
    sessionKey = key; sessionSalt = JSON.stringify(salt);
  });
}
export async function setRetention(days) {
  if (!Number.isInteger(days) || days < 7 || days > 730) throw new Error('Masukkan 7 sampai 730 hari.');
  await navigator.locks.request(LOCK,async () => {
    await commit([{store:'settings',value:{...await settings(),retention:days}}]);
  });
}
export async function items() {
  const key = keyFor(await settings());
  return Promise.all((await read('items')).map(async row => ({id:row.id,when:row.when,...await unseal(row.content,key)})));
}
async function appendAudit(event,details,key) {
  const last = (await read('settings','audit-head')) || {number:0, hash:''};
  const id = last.number + 1;
  const when = new Date().toISOString();
  const hash = await digest(JSON.stringify([id,when,event,last.hash,details]));
  const row = {id,when,event,prev:last.hash,hash,content:await seal(details,key)};
  return [{store:'audit',value:row},{store:'settings',value:{id:'audit-head',number:id,hash}}];
}
export async function save(changes, event, details = {}) {
  await navigator.locks.request(LOCK,async () => {
    const key = keyFor(await settings());
    const writes = [];
    for (const change of changes) {
      if (change.remove) writes.push({store:'items',id:change.id});
      else writes.push({store:'items',value:{id:change.id,when:Date.now(),content:await seal(change.value,key)}});
    }
    if (event) writes.push(...await appendAudit(event,details,key));
    await commit(writes);
  });
}
export async function prune() {
  await navigator.locks.request(LOCK,async () => {
    const config = await settings();
    const expired = (await read('items')).filter(r => r.when < Date.now() - config.retention * DAY);
    if (!expired.length) return;
    const changes = expired.map(r => ({store:'items',id:r.id}));
    changes.push(...await appendAudit('Retensi otomatis',{jumlah:expired.length},null));
    await commit(changes);
  });
}
export async function auditRows() {
  const key = keyFor(await settings());
  const rows = await read('audit');
  const head = await read('settings','audit-head');
  let previous = '';
  const result = [];
  for (const row of rows) {
    const details = await unseal(row.content,key);
    const actual = await digest(JSON.stringify([row.id,row.when,row.event,row.prev,details]));
    const intact = row.prev === previous && row.hash === actual && row.id === result.length+1;
    result.push({id:row.id,when:row.when,event:row.event,details,hash:row.hash,intact});
    previous = actual;
  }
  if ((head?.number || 0) !== rows.length || (head?.hash || '') !== previous) throw new Error('Kepala rantai log tidak cocok.');
  return result;
}
