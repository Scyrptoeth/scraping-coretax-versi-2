import {forms,catalogue,sources,readIds,filePage,rowsOf,checkIdentity,reportSource,taxpayerName,visibleTables,csvCell} from './app-data.js';
import * as vault from './app-vault.js';
import {putHandoff, removeExpiredHandoffs} from './app-handoff.js';
import {createPackage,sha256} from './archive/package.js';
import {batchCollector} from './app-batch.js';
import {appendPackageEntry,metaForSelection} from './app-package-entries.js';

const $ = id => document.getElementById(id);
const coretax = 'https://coretax.intranet.pajak.go.id';
const ext = globalThis.chrome?.runtime?.id ? globalThis.chrome : null;
const queue = [], messages = [];
let tables = [], tabUrl = '', job, stored = [], busy = false, paused = false, stop = false, noticeTimer;
let paging=false,pagingPaused=false,pagingStopped=false,batch;
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const checked = id => [...$(id).querySelectorAll('input:checked')].map(el => el.value);
const val = id => $(id).value.trim();
const formatDate = ts => new Date(ts).toLocaleString('id-ID');
function message(text,problem = false) {
  messages.push({text,problem,when:new Date().toLocaleTimeString('id-ID')});
  renderLog();
  if (problem) {
    $('notice').textContent = text; clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { $('notice').textContent = ''; },12000);
  }
}
function renderLog() {
  $('log').replaceChildren();
  for (const entry of messages.filter(m => !$('problems').checked || m.problem).slice(-150)) {
    const li = document.createElement('li');
    li.textContent = entry.when + ' · ' + entry.text;
    if (entry.problem) li.className = 'issue';
    $('log').append(li);
  }
}
function action(id,fn,event='click') {
  $(id).addEventListener(event,e => { Promise.resolve().then(() => fn(e)).catch(err => message(err.message,true)); });
}
function checkbox(parent,value,text,on) {
  const label = document.createElement('label'), input = document.createElement('input');
  label.className = 'check'; input.type = 'checkbox'; input.value = value; input.checked = on;
  label.append(input,document.createTextNode(text)); parent.append(label);
}
function button(label,handler) {
  const b = document.createElement('button'); b.textContent = label;
  b.onclick = () => Promise.resolve().then(handler).catch(e => message(e.message,true));
  return b;
}
function line(parent,text,buttons = []) {
  const row = document.createElement('div'), caption = document.createElement('span'), actions = document.createElement('div');
  row.className = 'item'; actions.className = 'actions'; caption.textContent = text;
  actions.append(...buttons); row.append(caption,actions); parent.append(row); return row;
}
function choices(select,values) {
  const before = select.value;
  select.replaceChildren(...values.map(([value,label]) => new Option(label,value)));
  if (values.some(([value]) => String(value) === before)) select.value = before;
}
function period() {
  const from = val('year-start')+'-'+val('month-start'), to = val('year-end')+'-'+val('month-end');
  if (from > to) throw new Error('Masa awal harus mendahului atau sama dengan masa akhir.');
  return from+' s.d. '+to;
}
function idsChanged() {
  let ids = [];
  try {
    ids = readIds(val('ids'));
    $('id-status').textContent = ids.length ? ids.length+' NPWP unik.' : 'Masukkan satu NPWP per baris.';
  } catch (e) { $('id-status').textContent = e.message; }
  choices($('owner'),ids.map(id => [id,id])); $('scope-ok').checked = false; scopeChanged();
}
function sourceChanged() {
  const allowed = checked('sources');
  choices($('source'),Object.entries(sources).filter(([id]) => allowed.includes(id)));
  choices($('spt'),forms.filter(([id]) => checked('forms').includes(id)));
  $('spt-field').hidden = !val('source').startsWith('spt');
  $('undated-field').hidden = val('source')!=='tabelumum';
  $('undated-general').checked=false;
  $('scope-ok').checked = false; scopeChanged();
}
function scopeChanged() {
  try { $('period-info').textContent = val('source')==='tabelumum' && $('undated-general').checked ?
    'Tabel umum yang ditambahkan akan disimpan tanpa masa pajak.' : 'Periode terpilih · '+period(); }
  catch(e) { $('period-info').textContent = e.message; }
  $('preview-box').replaceChildren();
  $('preview-box').dataset.key = '';
  renderQueue();
  $('start').disabled = !$('consent').checked || !!job || busy;
  $('preview').disabled = !$('consent').checked || !!job || busy;
}
function scope() {
  const wp = val('owner'), source = val('source');
  if (!wp || !readIds(val('ids')).includes(wp)) throw new Error('Pilih WP dari daftar penugasan.');
  if (!source) throw new Error('Pilih sumber data terlebih dahulu.');
  const spt = source.startsWith('spt') ? val('spt') : '';
  if (source.startsWith('spt') && !spt) throw new Error('Pilih jenis SPT untuk sumber ini.');
  if (!$('scope-ok').checked) throw new Error('Cocokkan dan centang pernyataan WP serta periode pada sumber.');
  const undated=source==='tabelumum' && $('undated-general').checked;
  return {wp,source,spt,period:undated?null:period()};
}
function addEntry(info,page,name,origin) {
  const rows = rowsOf(page);
  if(!rows.length) throw Error('Tabel kosong. Belum ada baris yang dapat ditambahkan.');
  checkIdentity(rows,info.wp);
  if(info.period===null && rows.some(row=>row && typeof row==='object' && Object.entries(row).some(([key,value])=>
    ['masapajak','periodepajak','taxperiod','taxperiodcode','tahunpajak','taxyear'].includes(key.toLowerCase().replace(/[^a-z]/g,'')) && value!=null && String(value).trim()!==''))) {
    throw Error('Sumber ini memuat masa atau tahun pajak. Lepaskan pilihan tanpa masa dan cocokkan periode.');
  }
  queue.push({...info,page,name,origin,...reportSource(page),id:crypto.randomUUID()});
}
function renderQueue() {
  const box = $('queue'); box.replaceChildren();
  queue.forEach(entry => line(box,entry.wp+' · '+sources[entry.source]+' · '+entry.name+' · '+entry.rows+' baris'+(entry.period===null?' · Masa tidak tercantum':''),[
    button('Keluarkan',() => { if (busy || job) throw new Error('Selesaikan tarikan aktif terlebih dahulu.'); queue.splice(queue.indexOf(entry),1); scopeChanged(); })
  ]));
}
async function checkTabs() {
  $('table-pick').hidden = true; tables = [];
  const tabs = ext ? await ext.tabs.query({url:coretax+'/*'}) : [];
  choices($('tab'),tabs.map((t,i) => [String(t.id),'Tab '+(i+1)+' · '+(t.title || 'Coretax')]));
  $('connection').textContent = tabs.length ? tabs.length+' tab Coretax tersedia' : 'Tab Coretax belum ditemukan';
  $('list-tables').disabled = !tabs.length; $('open-coretax').hidden = !!tabs.length || !ext;
}
async function tabNow() {
  if (!ext || !val('tab')) throw new Error('Pilih tab Coretax terlebih dahulu.');
  const tab = await ext.tabs.get(Number(val('tab')));
  if (!tab.url || new URL(tab.url).origin !== coretax) throw new Error('Tab berpindah alamat. Periksa ulang.');
  return tab;
}
async function tableList() {
  const tab = await tabNow();
  const [frame] = await ext.scripting.executeScript({target:{tabId:tab.id},func:visibleTables,args:[null]});
  tables = frame?.result || []; tabUrl = tab.url;
  choices($('table'),tables.map(t => [String(t.index),t.title+' · '+t.rows+' baris · '+t.labels.slice(0,3).join(', ')]));
  $('table-pick').hidden = !tables.length;
  pageOptions();
  if (!tables.length) throw new Error('Tidak ditemukan tabel yang terlihat pada halaman ini.');
}
function pageOptions() {
  const entry=tables.find(t=>String(t.index)===val('table'));
  $('pagination-options').hidden=!entry?.canAdvance;
}
async function addTable() {
  if (busy || job || paging || batch.active) throw new Error('Selesaikan tarikan aktif terlebih dahulu.');
  const info = scope(), tab = await tabNow(), entry = tables.find(x => String(x.index) === val('table'));
  if (!entry) throw new Error('Pilih tabel terlebih dahulu.');
  if (!entry.rows) throw new Error('Tabel kosong. Belum ada baris yang dapat ditambahkan.');
  const [frame] = await ext.scripting.executeScript({target:{tabId:tab.id},func:visibleTables,args:[{...entry,url:tabUrl}]});
  if (!Array.isArray(frame?.result)) throw new Error('Tabel tidak dapat dibaca. Periksa ulang halaman.');
  addEntry(info,{Payload:{Data:frame.result}},entry.title,'Tabel tampak');
  $('scope-ok').checked = false; scopeChanged(); message('Tabel ditambahkan ke antrean.');
}
async function collectPages() {
  if (busy || job || paging || batch.active) throw new Error('Selesaikan tarikan aktif terlebih dahulu.');
  const limit=Number(val('page-limit'));
  if(!Number.isInteger(limit) || limit<1 || limit>100) throw new Error('Pilih batas antara 1 dan 100 halaman.');
  const info=scope(),tab=await tabNow(),entry=tables.find(t=>String(t.index)===val('table'));
  if (!entry || !entry.canAdvance) throw new Error('Pilih tabel dengan kontrol halaman berikut yang dapat dikenali.');
  const selector={...entry,url:tabUrl}, seen=new Set();
  async function read(options) {
    const [result]=await ext.scripting.executeScript({target:{tabId:tab.id},func:visibleTables,args:[options]});
    if(!result || result.result==null) throw new Error('Tabel tidak dapat dibaca. Periksa kembali tab dan posisi halaman.');
    return result.result;
  }
  paging=true;pagingPaused=false;pagingStopped=false;
  for(const id of ['list-tables','add-table','collect-pages','tab','table','start']) $(id).disabled=true;
  $('pause-pages').hidden=false;$('pause-pages').textContent='Jeda pembacaan';$('stop-pages').hidden=false;
  let added=0;
  try {
    let page=await read(selector);
    if(!Array.isArray(page) || !page.length) throw new Error('Tabel kosong atau halaman pertama tidak tersedia.');
    while(added<limit && !pagingStopped) {
      const serialized=JSON.stringify(page),hash=await vault.digest(serialized);
      if(seen.has(hash)) throw new Error('Halaman berulang. Periksa paginator Coretax sebelum melanjutkan.');
      seen.add(hash);
      addEntry(info,{Payload:{Data:page}},entry.title+' · halaman pengambilan '+(added+1),'Tabel tampak');
      added++;renderQueue();$('page-status').textContent=added+' halaman masuk antrean.';
      if(added>=limit) break;
      await sleep(150);
      while(pagingPaused && !pagingStopped) await sleep(100);
      if(pagingStopped) break;
      const next=await read({...selector,rows:page.length,advance:true,owner:info.wp,expected:serialized});
      if(next.end) break;
      page=next.rows;
    }
    message(added+' halaman ditambahkan ke antrean.');
  } finally {
    paging=false;pagingPaused=false;$('scope-ok').checked=false;
    for(const id of ['list-tables','add-table','collect-pages','tab','table']) $(id).disabled=false;
    $('pause-pages').hidden=true;$('stop-pages').hidden=true;
    $('page-status').textContent=added+' halaman masuk antrean. Periksa ulang tabel untuk pengambilan berikut.';
    tables=[];scopeChanged();$('table-pick').hidden=true;
  }
}
async function importFiles() {
  const files = [...$('source-files').files]; $('source-files').value = '';
  if (!files.length) return;
  if (busy || job || batch.active) throw new Error('Selesaikan tarikan aktif terlebih dahulu.');
  const info = scope();
  for (const file of files) {
    try { addEntry(info,filePage(file.name,await file.text()),file.name,'Ekspor lokal'); }
    catch(e) { message(file.name+' · '+e.message,true); }
  }
  $('scope-ok').checked = false; scopeChanged();
}
function prepare() {
  const ids = readIds(val('ids')), allowed = checked('sources'), types = checked('forms');
  if (!ids.length || !val('officer')) throw new Error('Isi daftar NPWP dan nama penarik.');
  if (val('letter') && val('basis') !== 'RUTIN' && (val('letter').length < 6 || !/\d/.test(val('letter')))) throw new Error('Nomor dasar penugasan harus memuat angka dan sedikitnya 6 karakter.');
  if (!$('consent').checked) throw new Error('Centang pernyataan kerahasiaan terlebih dahulu.');
  const matching = queue.filter(e => ids.includes(e.wp) && allowed.includes(e.source) && (!e.spt || types.includes(e.spt)));
  const range=matching.some(e=>e.period!==null)?period():null;
  const relevant=matching.filter(e=>e.period===range || (e.source==='tabelumum' && e.period===null));
  if (!relevant.length) throw new Error('Tambahkan tabel atau berkas yang sesuai dengan WP, periode, dan sumber terpilih.');
  const plans = ids.map(wp => ({wp, entries:relevant.filter(e => e.wp === wp)}));
  const meta = {penugasan:{peran:val('role'),jenis:val('basis'),nomor:val('letter'),tanggal:val('date')},penarik:{nama:val('officer'),nip:val('nip')},periode:range,
    opsi:{metode:'Tabel yang terlihat atau ekspor lokal',jenisSpt:types,sumber:allowed,lewatiDuplikat:$('dedupe').checked,
      periode:{from:{y:Number(val('year-start')),m:Number(val('month-start'))},to:{y:Number(val('year-end')),m:Number(val('month-end'))}}}};
  return {plans,meta,excluded:queue.length-relevant.length};
}
function showPreview() {
  const {plans,excluded} = prepare(), box = $('preview-box');
  box.replaceChildren();
  for (const wp of plans) {
    const name=taxpayerName(wp.entries);
    checkbox(box,wp.wp,wp.wp+(name?' · '+name:'')+' · '+wp.entries.length+' sumber · '+wp.entries.reduce((sum,e) => sum+e.rows,0)+' baris',!!wp.entries.length);
    if (!wp.entries.length) box.lastChild.querySelector('input').disabled = true;
  }
  box.dataset.key = 'current';
  $('status').textContent = excluded+' item antrean di luar pilihan WP, periode, atau sumber.';
}
function jobButtons() {
  const active = busy && !!job;
  $('start').disabled = !$('consent').checked || !!job || busy;
  $('preview').disabled = !$('consent').checked || !!job || busy;
  $('pause').hidden = !active; $('pause').textContent = paused ? 'Lanjutkan' : 'Jeda';
  $('stop').hidden = !active; $('resume').hidden = !job || active;
  $('progress').hidden = !job;
  if (job) { $('progress').max = job.plans.length; $('progress').value = job.cursor; }
}
async function run(fresh) {
  if (busy || paging || batch.active) return;
  await navigator.locks.request('scv2-capture-job',{ifAvailable:true},async lock => {
    if (!lock) throw new Error('Tarikan sedang berjalan pada tab penarik lainnya.');
    if (busy) return;
    busy = true; paused = false; stop = false;
    try {
      await refresh();
      if (fresh) {
        if (job) throw new Error('Lanjutkan atau hapus antrean yang masih tersimpan.');
        const prepared = prepare();
        const selected = $('preview-box').dataset.key ? checked('preview-box') : prepared.plans.map(p => p.wp);
        const plans = prepared.plans.filter(p => p.entries.length && selected.includes(p.wp));
        if (!plans.length) throw new Error('Pilih setidaknya satu WP yang memiliki data.');
        const draft = {id:'pending-job',kind:'job',plans,meta:metaForSelection(prepared.meta,plans.flatMap(p=>p.entries)),cursor:0,runId:crypto.randomUUID()};
        await vault.save([{id:draft.id,value:draft}],'Mulai tarik',{jumlahWP:plans.length,penarik:draft.meta.penarik.nama,dasar:draft.meta.penugasan.nomor});
        job = draft;
      }
      if (!job) throw new Error('Antrean belum tersedia.');
      jobButtons();
      while (job.cursor < job.plans.length) {
        while (paused && !stop) await sleep(100);
        if (stop) break;
        const plan = job.plans[job.cursor], seen = new Set(), grouped = new Map(), checks=[];
        for (const source of plan.entries) {
          const key = await vault.digest(JSON.stringify([source.source,source.spt,source.page]));
          if (seen.has(key) && job.meta.opsi.lewatiDuplikat) continue;
          seen.add(key);
          if(source.total!=null && source.total!==source.rows) {
            const issue={tingkat:'TINGGI',pesan:sources[source.source]+' melaporkan '+source.total+' baris. Yang tersimpan '+source.rows+'.'};
            checks.push(issue); message(plan.wp+' · '+issue.pesan,true);
          }
          appendPackageEntry(grouped,source,plan.wp);
        }
        const entries=[...grouped.values()];
        const id = crypto.randomUUID(), name=taxpayerName(plan.entries), meta = {...metaForSelection(job.meta,plan.entries),wp:{npwp:plan.wp,...(name?{nama:name}:{})},dibuat:new Date().toISOString(),cek:checks};
        const next = {...job,cursor:job.cursor+1};
        await vault.save([{id,value:{kind:'result',meta,entries}},{id:job.id,value:next}],'Tarikan WP',{npwp:plan.wp,berkas:entries.length,dasar:meta.penugasan.nomor,penarik:meta.penarik.nama});
        job = next; jobButtons(); message(plan.wp+' · '+entries.length+' sumber tersimpan.');
        $('status').textContent = job.cursor+' dari '+job.plans.length+' WP tersimpan.';
        await sleep(0);
      }
      if (job.cursor === job.plans.length) {
        await vault.save([{id:job.id,remove:true}],'Selesai tarik',{jumlahWP:job.cursor});
        job = null; queue.length = 0; renderQueue(); $('preview-box').replaceChildren();
      } else { await vault.save([],'Tarikan dihentikan',{selesai:job.cursor}); $('status').textContent += ' Antrean tersimpan dan dapat dilanjutkan.'; }
    } finally { busy = false; await refresh(); jobButtons(); }
  });
}
function download(blob,name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url),30000);
}
async function exportResult(rec,pass) {
  const blob = await createPackage({...rec,password:pass});
  const hash = await sha256(blob);
  download(blob,'CoretaxV2_'+rec.meta.wp.npwp+'_'+rec.meta.dibuat.slice(0,10)+(pass ? '.sedotax' : '.zip'));
  await vault.save([],'Unduh paket',{npwp:rec.meta.wp.npwp,sha256:hash});
  message('SHA-256 paket · '+hash);
}
function chooseExport(rec) {
  $('package-pass').value = ''; $('package-repeat').value = ''; $('package-error').textContent = '';
  const dialog = $('package-dialog');
  dialog.querySelector('form').onsubmit = e => {
    if (e.submitter?.value !== 'ok') return;
    const pass = $('package-pass').value;
    if ((pass && pass.length < 10) || pass !== $('package-repeat').value) {
      e.preventDefault(); $('package-error').textContent = 'Gunakan minimal 10 karakter dan ulangi kata sandi yang sama.'; return;
    }
    $('package-pass').value = ''; $('package-repeat').value = '';
    exportResult(rec,pass).catch(err => message(err.message,true));
  };
  dialog.showModal();
}
async function openAnalysis(rec) {
  const id = crypto.randomUUID(), target = 'analisis/index.html?paket='+id;
  await putHandoff(id,await createPackage(rec));
  try {
    if (ext) { await ext.alarms.create('scv2-handoff-'+id,{delayInMinutes:11}); await ext.tabs.create({url:ext.runtime.getURL(target)}); }
    else location.assign(target);
  } catch (e) { await putHandoff(id,null); throw e; }
}
async function refresh() {
  stored = await vault.items();
  job = stored.find(x => x.kind === 'job') || null;
  const results = stored.filter(x => x.kind === 'result').sort((a,b) => b.when-a.when);
  const box = $('results'); box.replaceChildren();
  if (!results.length) box.textContent = 'Belum ada hasil penarikan.';
  const groups=new Map();
  for(const record of results) {
    const id=record.meta.wp.npwp;
    if(!groups.has(id)) groups.set(id,[]);
    groups.get(id).push(record);
  }
  for (const [wp,group] of groups) {
    const [rec,...history]=group;
    line(box,rec.meta.wp.npwp+' · '+rec.meta.periode+' · '+rec.entries.length+' sumber · '+formatDate(rec.when),[
      button('Unduh paket',() => chooseExport(rec)),button('Buka di Analisis',() => openAnalysis(rec)),button('Hapus',async () => {
        if (busy || !confirm('Hapus seluruh '+group.length+' tarikan tersimpan untuk '+wp+'?')) return;
        await vault.save(group.map(r=>({id:r.id,remove:true})),'Hapus WP',{npwp:wp,jumlah:group.length}); await refresh();
      })]);
    for (const check of rec.meta.cek || []) line(box,check.tingkat+' · '+check.pesan);
    if(history.length) {
      const detail=document.createElement('details'), summary=document.createElement('summary');
      summary.textContent='Tarikan sebelumnya ('+history.length+')';detail.append(summary);box.append(detail);
      for(const old of history) line(detail,old.meta.periode+' · '+formatDate(old.when),[button('Unduh paket',()=>chooseExport(old)),button('Buka di Analisis',()=>openAnalysis(old))]);
    }
  }
  jobButtons();
}
async function secureState(unlocked=false) {
  const config = await vault.settings();
  $('encryption').hidden = !!config.salt; $('lock').hidden = !config.salt;
  $('security').textContent = config.salt ? 'Enkripsi AES-256 aktif. Kata sandi diperlukan setiap kali halaman dibuka.' : 'Simpanan lokal menggunakan penyimpanan browser. Aktifkan enkripsi untuk menguncinya dengan kata sandi.';
  $('retention').value = config.retention;
  const locked = !!config.salt && !unlocked;
  $('unlock-panel').hidden = !locked; $('workspace').hidden = locked;
  if (!locked) await refresh();
}
function init() {
  const y = new Date().getFullYear(), years = Array.from({length:Math.max(1,y-2021)},(_,i) => [String(y+1-i),String(y+1-i)]);
  const months = Array.from({length:12},(_,i) => [String(i+1).padStart(2,'0'),new Intl.DateTimeFormat('id-ID',{month:'long'}).format(new Date(2000,i,1))]);
  for (const end of ['start','end']) { choices($('month-'+end),months); choices($('year-'+end),years); $('year-'+end).value=String(y-1); }
  $('month-end').value='12';
  forms.forEach(([id,label]) => checkbox($('forms'),id,label,true));
  for (const [group,entries] of catalogue) {
    const div = document.createElement('div'), title = document.createElement('strong');
    div.className='group'; title.textContent=group; div.append(title);
    entries.forEach(([id,label,on=true]) => checkbox(div,id,label,on)); $('sources').append(div);
  }
  const preferenceKey='scv2.capture.preferences';
  const preferenceFields=['role','basis','month-start','month-end','year-start','year-end'];
  let preferences;
  try {preferences=JSON.parse(localStorage.getItem(preferenceKey)||'{}');} catch {preferences={};}
  for(const id of preferenceFields) {
    if([...$(id).options].some(o=>o.value===preferences[id])) $(id).value=preferences[id];
  }
  for(const id of ['sources','forms']) if(Array.isArray(preferences[id])) {
    for(const input of $(id).querySelectorAll('input')) input.checked=preferences[id].includes(input.value);
  }
  if(typeof preferences.dedupe==='boolean') $('dedupe').checked=preferences.dedupe;
  function savePreferences() {
    const prefs=Object.fromEntries(preferenceFields.map(id=>[id,val(id)]));
    localStorage.setItem(preferenceKey,JSON.stringify({...prefs,sources:checked('sources'),forms:checked('forms'),dedupe:$('dedupe').checked}));
  }
  for(const id of [...preferenceFields,'sources','forms','dedupe']) action(id,savePreferences,'change');
  action('ids',idsChanged,'input');
  action('id-file',async () => { const [file]=$('id-file').files; if(file){const ids=readIds(await file.text()); $('ids').value=ids.join('\n'); idsChanged();} $('id-file').value=''; },'change');
  for (const id of ['sources','forms','source']) action(id,sourceChanged,'change');
  for (const id of ['owner','spt','month-start','month-end','year-start','year-end']) action(id,() => {$('scope-ok').checked=false; scopeChanged();},'change');
  action('undated-general',()=>{$('scope-ok').checked=false;scopeChanged();},'change');
  for (const id of ['consent','dedupe']) action(id,scopeChanged,'change');
  action('tab',() => {tables=[]; $('table-pick').hidden=true; $('scope-ok').checked=false;},'change');
  action('recheck',checkTabs); action('open-coretax',() => ext.tabs.create({url:coretax+'/'}));
  action('list-tables',tableList); action('add-table',addTable); action('source-files',importFiles,'change');
  batch=batchCollector({ext,origin:coretax,isBusy:()=>Boolean(busy || job || paging),enqueue:addEntry,refresh:scopeChanged,log:message,context:()=>{
    const wp=val('owner'), range=period();
    if(!wp || !readIds(val('ids')).includes(wp)) throw Error('Pilih WP dari daftar penugasan terlebih dahulu.');
    if(!$('scope-ok').checked) throw Error('Cocokkan dan centang pernyataan WP serta periode pada sumber.');
    const [from,to]=range.split(' s.d. ');
    return {wp,period:range,from,to,allowed:checked('sources'),types:checked('forms')};
  }});
  action('table',pageOptions,'change'); action('collect-pages',collectPages);
  action('pause-pages',()=>{pagingPaused=!pagingPaused;$('pause-pages').textContent=pagingPaused?'Lanjutkan pembacaan':'Jeda pembacaan';});
  action('stop-pages',()=>{pagingStopped=true;pagingPaused=false;});
  action('preview',showPreview); action('start',() => run(true)); action('resume',() => run(false));
  action('pause',() => {paused=!paused; jobButtons(); $('status').textContent=paused ? 'Tarikan dijeda setelah WP berjalan.' : 'Tarikan dilanjutkan.';});
  action('stop',() => {stop=true; paused=false;}); action('problems',renderLog,'change');
  action('encrypt',async () => {
    if (busy) throw new Error('Tunggu tarikan selesai.');
    const pass=$('new-pass').value;
    if(pass !== $('repeat-pass').value) throw new Error('Kata sandi belum sama.');
    await vault.enableEncryption(pass); $('new-pass').value=''; $('repeat-pass').value=''; await secureState(true);
  });
  action('lock',() => {if(busy) throw new Error('Jeda dan hentikan tarikan dahulu.'); vault.lock(); location.reload();});
  $('unlock-form').addEventListener('submit',e => {e.preventDefault(); const pass=$('unlock-pass').value; $('unlock-pass').value=''; vault.unlock(pass).then(() => secureState(true)).catch(err => message(err.message,true));});
  action('save-retention',async () => {await vault.setRetention(Number(val('retention'))); await vault.prune(); await refresh(); message('Masa retensi disimpan.');});
  action('wipe',async () => {
    if(busy || !confirm('Hapus semua hasil WP dan antrean tersimpan? Log penarikan akan dipertahankan.')) return;
    const rows=await vault.items(); await vault.save(rows.map(r => ({id:r.id,remove:true})),'Hapus semua WP',{jumlah:rows.length});
    queue.length=0; renderQueue(); await refresh();
  });
  action('audit',async () => {
    const log=await vault.auditRows();
    const lines=[['Urutan','Waktu','Kegiatan','Rincian','SHA-256','Rantai'],...log.map(r => [r.id,r.when,r.event,JSON.stringify(r.details),r.hash,r.intact?'Utuh':'Putus'])];
    download(new Blob(['\uFEFF'+lines.map(row => row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'Log-penarikan.csv');
  });
  idsChanged(); sourceChanged();
}
init();
Promise.all([checkTabs(),vault.prune().then(() => secureState()),removeExpiredHandoffs()]).catch(err => message(err.message,true));
