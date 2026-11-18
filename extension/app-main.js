import {forms,catalogue,sources,readCaptureId,filePage,rowsOf,rowsInColumnOrder,checkIdentity,reportSource,taxpayerName,visibleTables,csvCell} from './app-data.js';
import * as vault from './app-vault.js';
import {putHandoff, removeExpiredHandoffs} from './app-handoff.js';
import {createPackage,sha256} from './archive/package.js';
import {batchCollector} from './app-batch.js';
import {appendPackageEntry,isSptList,metaForSelection,selectSptListRows} from './app-package-entries.js';
import {planSptDetails} from './app-spt-plan.js';
import {stageSptSource,finishSptSources} from './app-spt-snapshots.js';
import {sptNavigation} from './app-spt-navigation.js';
import {collectSptQueue,sptDirectory} from './app-spt-directory.js';
import {findSubmittedTab,readSubmittedPreview} from './app-spt-preview.js';
import {previewKind,sameScope,wholePreview,coversRows,savedPages,removePreview,previewWriter} from './app-spt-progress.js';
import {openSourcePreview} from './app-open-sources.js';
import {resultAssignment,sameSptAssignment,verifiedIndexItems,recoverSptResult,remainingSptChecks,readPreviousSptPackage} from './app-spt-results.js';

const $ = id => document.getElementById(id);
const coretax = 'https://coretax.intranet.pajak.go.id';
const ext = globalThis.chrome?.runtime?.id ? globalThis.chrome : null;
const queue = [], messages = [];
let tables = [], tabUrl = '', stored = [], busy = false, paused = false, stop = false, noticeTimer;
let paging=false,pagingPaused=false,pagingStopped=false,batch,autoSpt=false;
let chosenPreviewTab=null;
let otherSources;
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
function captureTable(parent,title,columns) {
  const region=document.createElement('div'),table=document.createElement('table');
  region.className='capture-table';region.tabIndex=0;region.setAttribute('role','region');region.setAttribute('aria-label',title);
  table.createCaption().textContent=title;
  const head=table.createTHead().insertRow();
  for(const label of columns){const th=document.createElement('th');th.scope='col';th.textContent=label;head.append(th);}
  const body=table.createTBody();
  region.append(table);parent.append(region);return body;
}
function captureRow(body,values) {
  const row=body.insertRow();
  values.forEach((value,index)=>{
    const cell=document.createElement(index===0?'th':'td');
    if(index===0)cell.scope='row';
    if(value instanceof Node)cell.append(value);else cell.textContent=value ?? 'Belum tercantum';
    row.append(cell);
  });
}
function disclosure(title) {
  const panel=document.createElement('details'),label=document.createElement('summary');
  label.textContent=title;panel.append(label);return panel;
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
  const field = $('ids');
  field.setCustomValidity('');
  try {
    const wp = readCaptureId(val('ids'));
    $('id-status').textContent = wp ? 'NPWP untuk tarikan ini · '+wp : 'Satu NPWP untuk setiap tarikan. NPWP 15 digit memperoleh awalan nol.';
  } catch (e) { field.setCustomValidity(e.message); $('id-status').textContent = e.message; }
  $('scope-ok').checked = false; scopeChanged();
}
function captureOwner() {
  const wp = readCaptureId(val('ids'));
  if (!wp) throw Error('Isi NPWP yang ditarik pada bagian Penugasan.');
  return wp;
}
function sourceChanged() {
  const allowed = checked('sources');
  choices($('source'),Object.entries(sources).filter(([id]) => allowed.includes(id)));
  choices($('spt'),forms.filter(([id]) => checked('forms').includes(id)));
  $('spt-field').hidden = val('source')!=='sptisi';
  $('list-types-hint').hidden=!isSptList(val('source'));
  $('preview-index-options').hidden=!allowed.includes('sptdaftar') || !ext;
  $('undated-field').hidden = val('source')!=='tabelumum';
  $('undated-general').checked=false;
  $('scope-ok').checked = false; scopeChanged();
}
function scopeChanged() {
  otherSources?.invalidate();
  try { $('period-info').textContent = val('source')==='tabelumum' && $('undated-general').checked ?
    'Tabel umum yang ditambahkan akan disimpan tanpa masa pajak.' : 'Periode terpilih · '+period(); }
  catch(e) { $('period-info').textContent = e.message; }
  $('preview-box').replaceChildren();
  if(!autoSpt)$('preview-read-status').textContent='';
  renderPreviewRecovery();
  renderQueue();
  jobButtons();
}
function requireSourceConfirmation() {
  const checkbox=$('scope-ok');
  if(checkbox.checked)return;
  $('scope-help').hidden=false;
  checkbox.setAttribute('aria-invalid','true');
  checkbox.focus();
  throw Error('Cocokkan dan centang pernyataan WP serta periode pada sumber.');
}
function scope() {
  if(otherSources?.active)throw Error('Tunggu sampai sumber pada pratinjau selesai ditambahkan.');
  const wp = captureOwner(), source = val('source');
  if (!source) throw new Error('Pilih sumber data terlebih dahulu.');
  const spt = source==='sptisi' ? val('spt') : '';
  if (source==='sptisi' && !spt) throw new Error('Pilih jenis SPT untuk induk atau lampiran.');
  if (isSptList(source) && !checked('forms').length) throw Error('Pilih sedikitnya satu jenis SPT pada bagian Data yang ditarik.');
  requireSourceConfirmation();
  const undated=source==='tabelumum' && $('undated-general').checked;
  return {wp,source,spt,period:undated?null:period()};
}
function addEntry(info,page,name,origin) {
  if(busy) throw Error('Selesaikan tarikan aktif sebelum menambahkan sumber.');
  if (info.wp !== captureOwner() || queue.some(entry => entry.wp !== info.wp)) throw Error('NPWP berubah saat membaca sumber. Periksa kembali WP dan ulangi pembacaan.');
  const rows = rowsOf(page);
  if(!rows.length && !((info.detailProof || info.source==='sptdaftar' && info.proof?.daftarPratinjau) && info.proof?.nolPadaSumber && page.Payload?.TotalRecords===0))
    throw Error('Tabel kosong. Belum ada baris yang dapat ditambahkan.');
  checkIdentity(rows,info.wp);
  if(info.period===null && rows.some(row=>row && typeof row==='object' && Object.entries(row).some(([key,value])=>
    ['masapajak','periodepajak','taxperiod','taxperiodcode','tahunpajak','taxyear'].includes(key.toLowerCase().replace(/[^a-z]/g,'')) && value!=null && String(value).trim()!==''))) {
    throw Error('Sumber ini memuat masa atau tahun pajak. Lepaskan pilihan tanpa masa dan cocokkan periode.');
  }
  queue.push({...info,...(info.detailProof?{sptAssignment:info.sptAssignment||previewScope()}:{}),page,name,origin,...reportSource(page),id:crypto.randomUUID()});
}
function renderQueue() {
  $('ids').readOnly = queue.length>0 || busy;
  $('id-file').disabled = queue.length>0 || busy;
  const box = $('queue'); box.replaceChildren();
  queue.forEach(entry => line(box,entry.wp+' · '+sources[entry.source]+' · '+entry.name+' · '+entry.rows+' baris'+(entry.period===null?' · Masa tidak tercantum':''),[
    button('Keluarkan',() => {
      if(busy || autoSpt || paging || batch.active || otherSources?.active)throw Error('Selesaikan pembacaan yang sedang berjalan.');
      queue.splice(queue.indexOf(entry),1);
      const prior=entry.proof?.daftarPratinjau;
      if(prior){
        const remaining=queue.filter(e=>e.proof?.daftarPratinjau?.id===prior.id);
        const report={...prior,pages:remaining.length,rows:remaining.reduce((sum,e)=>sum+e.rows,0),
          fromFirst:false,toLast:false,note:'Satu atau beberapa halaman daftar telah dikeluarkan dari antrean.'};
        for(const item of remaining)item.proof.daftarPratinjau=report;
      }
      scopeChanged();
    })
  ]));
  if(queue.length) {
    const hint=document.createElement('small');hint.textContent='Untuk mengganti NPWP, selesaikan tarikan atau keluarkan semua sumber dari antrean.';box.append(hint);
  }
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
  if (busy || paging || autoSpt || batch.active) throw new Error('Selesaikan tarikan aktif terlebih dahulu.');
  const info = scope(), tab = await tabNow(), entry = tables.find(x => String(x.index) === val('table'));
  if (!entry) throw new Error('Pilih tabel terlebih dahulu.');
  if (!entry.rows) throw new Error('Tabel kosong. Belum ada baris yang dapat ditambahkan.');
  const [frame] = await ext.scripting.executeScript({target:{tabId:tab.id},func:visibleTables,
    args:[{...entry,url:tabUrl,scope:{wp:info.wp,source:info.source,manual:true}}]});
  const result=frame?.result;
  if (!Array.isArray(result?.rows)) throw new Error(result?.skip || 'Tabel tidak dapat dibaca. Periksa ulang halaman.');
  const proof={columns:entry.labels,morePagesAvailable:result.canAdvance};
  if(result.indexScope)Object.assign(proof,{indexScope:result.indexScope,ownerEvidence:result.ownerEvidence});
  addEntry({...info,proof},{Payload:{Data:rowsInColumnOrder(result.rows,entry.labels)}},entry.title,'Tabel tampak');
  $('scope-ok').checked = false; scopeChanged(); message('Tabel ditambahkan ke antrean.');
}
async function collectPages() {
  if (busy || paging || autoSpt || batch.active) throw new Error('Selesaikan tarikan aktif terlebih dahulu.');
  const limit=Number(val('page-limit'));
  if(!Number.isInteger(limit) || limit<1 || limit>100) throw new Error('Pilih batas antara 1 dan 100 halaman.');
  const info=scope(),tab=await tabNow(),entry=tables.find(t=>String(t.index)===val('table'));
  if (!entry || !entry.canAdvance) throw new Error('Pilih tabel dengan kontrol halaman berikut yang dapat dikenali.');
  const selector={...entry,url:tabUrl,scope:{wp:info.wp,source:info.source,
    from:val('year-start')+'-'+val('month-start'),to:val('year-end')+'-'+val('month-end'),
    periodRequired:info.source.startsWith('spt') || ['bb','bbtotal','bplawan'].includes(info.source)}},seen=new Set();
  async function read(options) {
    const [result]=await ext.scripting.executeScript({target:{tabId:tab.id},func:visibleTables,args:[options]});
    if(!result || result.result==null) throw new Error('Tabel tidak dapat dibaca. Periksa kembali tab dan posisi halaman.');
    return result.result;
  }
  paging=true;pagingPaused=false;pagingStopped=false;
  for(const id of ['list-tables','add-table','collect-pages','tab','table','start']) $(id).disabled=true;
  $('pause-pages').hidden=false;$('pause-pages').textContent='Jeda pembacaan';$('stop-pages').hidden=false;
  const captureId=crypto.randomUUID();
  let added=0;
  try {
    let result=await read(selector),previousProof;
    while(added<limit && !pagingStopped) {
      if(JSON.stringify(scope())!==JSON.stringify(info))throw Error('Cakupan penugasan berubah. Pilih ulang tabel.');
      if(!result.rows?.length)throw new Error(result.skip || 'Tabel kosong atau halaman tidak tersedia.');
      const page=rowsInColumnOrder(result.rows,entry.labels);
      const serialized=JSON.stringify(page),hash=await vault.digest(serialized);
      if(seen.has(hash)) throw new Error('Halaman berulang. Periksa paginator Coretax sebelum melanjutkan.');
      seen.add(hash);
      const proof={columns:entry.labels,owner:result.ownerColumns,period:result.periodColumns,morePagesAvailable:result.canAdvance};
      if(info.source==='sptisi')proof.urutan={id:captureId,halaman:added+1};
      if(result.indexScope)Object.assign(proof,{indexScope:result.indexScope,ownerEvidence:result.ownerEvidence});
      addEntry({...info,proof},{Payload:{Data:page}},entry.title+' · halaman pengambilan '+(added+1),'Tabel tampak');
      if(previousProof)delete previousProof.morePagesAvailable;
      previousProof=proof;
      added++;renderQueue();$('page-status').textContent=added+' halaman masuk antrean.';
      if(added>=limit || !result.canAdvance) break;
      await sleep(150);
      while(pagingPaused && !pagingStopped) await sleep(100);
      if(pagingStopped) break;
      const next=await read({...selector,rows:page.length,advance:true,owner:info.wp,expected:serialized});
      if(next.end) break;
      if(next.skip)throw new Error(next.skip.startsWith('Identitas WP')?'NPWP tampilan berubah. Halaman berikut tidak ditambahkan.':next.skip);
      result=next;
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
  if (busy || paging || autoSpt || batch.active) throw new Error('Selesaikan tarikan aktif terlebih dahulu.');
  const info = scope();
  for (const file of files) {
    try { addEntry(info,filePage(file.name,await file.text()),file.name,'Ekspor lokal'); }
    catch(e) { message(file.name+' · '+e.message,true); }
  }
  $('scope-ok').checked = false; scopeChanged();
}
function prepare({preview=false,allowEmpty=false}={}) {
  const wp = captureOwner(), allowed = checked('sources'), types = checked('forms');
  if (!val('officer')) throw new Error('Isi nama penarik pada bagian Penugasan.');
  if (val('letter') && val('basis') !== 'RUTIN' && (val('letter').length < 6 || !/\d/.test(val('letter')))) throw new Error('Nomor dasar penugasan harus memuat angka dan sedikitnya 6 karakter.');
  if (!$('consent').checked) throw new Error('Centang pernyataan kerahasiaan terlebih dahulu.');
  if (queue.some(e => e.wp !== wp)) throw new Error('Antrean berisi sumber untuk WP lain. Keluarkan sumber itu sebelum menarik data.');
  const matching = queue.filter(e => allowed.includes(e.source) && (!e.spt || types.includes(e.spt)));
  const range=matching.some(e=>e.period!==null)?period():null;
  const inPeriod=matching.filter(e=>e.period===range || (e.source==='tabelumum' && e.period===null));
  if(inPeriod.some(e=>e.previewBinding && !sameScope(e.previewBinding.scope,previewScope())))
    throw Error('Penugasan atau pilihan SPT berbeda dari pratinjau tersimpan yang ada di antrean. Pulihkan pilihan semula atau keluarkan daftar itu.');
  if(inPeriod.some(e=>e.sptAssignment && !sameSptAssignment(e.sptAssignment,previewScope())))
    throw Error('Penugasan untuk bagian SPT di antrean berbeda. Pulihkan penugasan semula atau keluarkan sumber terkait.');
  const relevant=inPeriod.map(e=>selectSptListRows(e,types)).filter(Boolean);
  if (!allowEmpty && !relevant.length && !(preview && inPeriod.some(item=>isSptList(item.source)))) {
    if(inPeriod.length) throw Error('Tidak ada baris untuk jenis SPT terpilih. Pilih semua jenis untuk menyertakan baris yang belum dikenali.');
    throw new Error('Tambahkan tabel atau berkas yang sesuai dengan WP, periode, dan sumber terpilih.');
  }
  const meta = {penugasan:{peran:val('role'),jenis:val('basis'),nomor:val('letter'),tanggal:val('date')},penarik:{nama:val('officer'),nip:val('nip')},periode:range,
    opsi:{metode:'Tabel yang terlihat atau ekspor lokal',jenisSpt:types,sumber:allowed,lewatiDuplikat:$('dedupe').checked,
      periode:{from:{y:Number(val('year-start')),m:Number(val('month-start'))},to:{y:Number(val('year-end')),m:Number(val('month-end'))}}}};
  const omittedRows=inPeriod.reduce((sum,e)=>sum+e.rows,0)-relevant.reduce((sum,e)=>sum+e.rows,0);
  return {plan:{wp,entries:relevant},meta:metaForSelection(meta,relevant),inPeriod,excluded:queue.length-relevant.length,omittedRows};
}
function showPreview() {
  const {plan,meta,inPeriod,excluded,omittedRows}=prepare({preview:true}), box=$('preview-box');
  box.replaceChildren();
  const rows=plan.entries.reduce((sum,entry)=>sum+entry.rows,0);
  const body=captureTable(box,'Pratinjau penarikan',['NPWP','Nama WP','Periode','Sumber dalam antrean','Baris terpilih']);
  captureRow(body,[plan.wp,taxpayerName(plan.entries) || null,meta.periode,plan.entries.length,rows]);
  const details=disclosure('Rincian sumber terpilih');
  const sourceBody=captureTable(details,'Sumber yang akan dirakit',['Sumber','Tabel atau berkas','Cara pengambilan','Baris']);
  for(const entry of plan.entries)captureRow(sourceBody,[sources[entry.source],entry.name,entry.origin,entry.rows]);
  if(meta.opsi.lewatiDuplikat){
    const hint=document.createElement('p');hint.className='hint';hint.textContent='Jumlah pada pratinjau dihitung sebelum salinan identik dilewati.';details.append(hint);
  }
  box.append(details);
  if(inPeriod.some(item=>isSptList(item.source))) {
    const planned=planSptDetails({wp:plan.wp,period:meta.opsi.periode,types:meta.opsi.jenisSpt,items:inPeriod});
    if(planned.documents.length)showPreviousSpt(box,inPeriod);
    showSptPlan(box,planned);
  }
  const auto=inPeriod.find(e=>e.proof?.daftarPratinjau)?.proof.daftarPratinjau;
  if(auto){
    const note=document.createElement('p');note.textContent=describeSubmitted(auto);box.append(note);
    box.append(button('Baca ulang daftar dari tab Coretax',()=>previewFromTab(true)));
  }
  const summary=excluded ? excluded+' sumber di luar pilihan.' : 'Semua sumber dalam antrean masuk dalam tarikan.';
  $('status').textContent=summary+(omittedRows?' '+omittedRows+' baris di luar pilihan jenis SPT.':'');
}
function describeSubmitted(report){
  return report.pages+' halaman daftar dan '+report.rows+' baris sumber terbaca.'+(report.total===null?'':' Total pada tampilan sumber '+report.total+' baris.')+
    (report.filtered?' Filter pada tabel sumber aktif.':'')+(report.note?' Cakupan sebagian. '+report.note:
      report.filtered?' Yang terbaca hanya hasil filter, dari halaman awal sampai akhir.':' Awal dan akhir tampilan terkonfirmasi.');
}
function previewScope(){
  return {wp:captureOwner(),period:period(),types:checked('forms').join('|'),role:val('role'),basis:val('basis'),letter:val('letter'),date:val('date'),
    officer:val('officer'),nip:val('nip')};
}
function showPreviousSpt(box,items){
  if(!ext || !checked('sources').includes('sptisi') || !verifiedIndexItems(items).length)return;
  const scope=previewScope();
  const records=stored.filter(r=>r.kind==='result' && sameSptAssignment(resultAssignment(r.meta),scope) &&
    r.entries?.some(e=>e.cap?.sumber==='sptisi' || e.cap?.bagianSptTeramati?.length)).sort((a,b)=>b.when-a.when);
  if(items.some(e=>e.sptResultId)){
    const note=document.createElement('p');note.textContent='Bagian dari hasil tersimpan sudah dicocokkan dengan daftar untuk penugasan ini.'+
      (items.some(e=>e.sptLegacyNotes)?' Ada catatan lama tanpa identitas bagian. Periksa catatan pada hasil sebelumnya dan pilih versi yang perlu dibaca kembali.':'');
    box.append(note);return;
  }
  const note=document.createElement('p');note.textContent='Gunakan hasil penugasan ini untuk melanjutkan pembacaan. Penarik mencocokkan versi dengan daftar Coretax yang terbuka, lalu memeriksa cakupan setiap bagian.';
  async function loadPrevious(restore,pick,load){
    const selected=pick(),status=$('preview-read-status'),actions=$('preview-read-actions');
    restore.disabled=true;autoSpt=true;jobButtons();
    function check(){
      if(!restore.isConnected || !sameScope(scope,previewScope()) || !$('consent').checked || !checked('sources').includes('sptisi') ||
          pick()!==selected || busy || paging || batch.active || otherSources.active)throw Error('Pilihan atau penugasan berubah. Buka kembali Pratinjau WP.');
    }
    const checkpoint=sptPlayback(actions,status,check);
    try{
      await checkpoint();const record=await load(selected);await checkpoint();
      if(!record || !sameSptAssignment(resultAssignment(record.meta),scope))throw Error('Hasil yang dipilih sudah tidak tersedia untuk penugasan ini.');
      const tab=await findSubmittedTab(ext,scope.wp,chosenPreviewTab,checkpoint);
      if(!tab)throw Error('Buka daftar SPT Dilaporkan untuk WP yang dipilih.');
      const limit=Number(val('preview-index-limit'));if(!Number.isInteger(limit) || limit<1 || limit>100)throw Error('Pilih batas 1–100 halaman untuk pratinjau daftar.');
      const live=[];
      const report=await readSubmittedPreview(ext,tab,scope.wp,{checkpoint,limit,onPage(data){
        live.push({source:'sptdaftar',wp:scope.wp,page:{Payload:{Data:data.rows}}});
        status.textContent=live.length+' halaman daftar diperiksa untuk mencocokkan bagian SPT sebelumnya.';
      }});
      await checkpoint();await sptDirectory(ext,tab.id,scope.wp,{previewIndex:true,expectedUrl:tab.url});await checkpoint();
      const {inPeriod,meta}=prepare({preview:true});
      if(inPeriod.some(e=>e.sptResultId))throw Error('Bagian hasil sebelumnya sudah ditambahkan pada antrean.');
      const index=verifiedIndexItems(inPeriod)[0];
      if(!index)throw Error('Tambahkan kembali daftar SPT Dilaporkan yang telah dicocokkan dengan WP.');
      const {pages,observed,legacyNotes,skippedFiles}=recoverSptResult(record,scope,meta.opsi,inPeriod,live);
      if(!pages.length && !observed.length)throw Error('Belum ada bagian dari hasil tersebut yang dapat dicocokkan dengan versi pada daftar yang terbaca.');
      index.sptResultId=record.id;index.sptAssignment=scope;index.sptLegacyNotes=legacyNotes;
      (index.sptObservedParts ||= []).push(...observed);
      for(const page of pages)queue.push(page);
      renderQueue();showPreview();
      status.textContent=pages.length+' halaman dari hasil sebelumnya masuk antrean. '+report.pages+' halaman daftar diperiksa.'+
        (skippedFiles?' '+skippedFiles+' berkas rincian dari hasil lama tidak digunakan.':'')+
        (report.note?' '+report.note:'')+' Buka rincian versi untuk mengambil bagian yang masih diperlukan.';
    }catch(e){status.textContent=e.message;throw e;}
    finally{restore.disabled=false;actions.replaceChildren();autoSpt=false;jobButtons();}
  }
  function control(text,pick,load){
    const restore=button(text,()=>withPreviewLock(()=>loadPrevious(restore,pick,load)));
    return restore;
  }
  if(records.length){
    const select=document.createElement('select'),label=document.createElement('label');label.append('Hasil tarikan sebelumnya',select);
    choices(select,records.map(r=>[r.id,formatDate(r.when)+' · '+r.entries.length+' berkas']));
    box.append(note,label,control('Gunakan bagian SPT dari hasil tersimpan',()=>select.value,async id=>(await vault.items()).find(r=>r.id===id && r.kind==='result')));
  }
  const panel=disclosure('Gunakan paket SPT dari berkas');
  const choose=document.createElement('input');choose.type='file';choose.accept='.zip,.sedotax';
  const fileLabel=document.createElement('label');fileLabel.append('Paket Versi 2 untuk penugasan ini',choose);
  const secret=document.createElement('input');secret.type='password';secret.autocomplete='off';
  const secretLabel=document.createElement('label');secretLabel.append('Kata sandi paket',secret);secretLabel.hidden=true;
  choose.onchange=()=>{secret.value='';secretLabel.hidden=!choose.files[0]?.name.toLowerCase().endsWith('.sedotax');};
  const use=control('Gunakan bagian SPT dari berkas',()=>choose.files[0],async file=>{
    if(!file)throw Error('Pilih berkas paket terlebih dahulu.');
    try{return await readPreviousSptPackage(file,secret.value,scope);}
    catch(e){if(e.code==='PASSWORD_REQUIRED' || e.code==='DECRYPT_FAILED'){secretLabel.hidden=false;secret.focus();}throw e;}
    finally{secret.value='';}
  });
  if(!records.length)panel.append(note);
  panel.append(fileLabel,secretLabel,use);box.append(panel);
}
function renderPreviewRecovery(){
  const box=$('preview-recovery');box.replaceChildren();
  const drafts=stored.filter(r=>r.kind===previewKind);
  if(!drafts.length || !ext || !checked('sources').includes('sptdaftar'))return;
  if(!$('consent').checked || !val('ids') || !val('officer')){
    box.textContent='Ada pratinjau tersimpan di perangkat. Isi penugasan dan NPWP, pilih periode serta jenis SPT, lalu centang pernyataan kerahasiaan untuk memeriksanya.';return;
  }
  let scope;try{scope=previewScope();}catch{return;}
  const draft=drafts.find(r=>sameScope(r.scope,scope));
  if(!draft)return;
  const use=button('Gunakan halaman tersimpan',()=>restorePreview(draft.id));
  const resume=button('Lanjutkan dari tab Coretax',()=>previewFromTab(true,draft.id));
  const drop=button('Hapus pratinjau tersimpan',()=>withPreviewLock(async()=>{
    if(!sameScope(previewScope(),scope)||!$('consent').checked)throw Error('Periksa kembali penugasan dan WP.');
    if(!confirm('Hapus kemajuan pratinjau tersimpan untuk penugasan ini?'))return;
    const records=await vault.items(),saved=records.find(r=>r.id===draft.id && r.kind===previewKind && sameScope(r.scope,scope));
    if(saved)await vault.save(removePreview(saved,records),'Hapus pratinjau SPT',{npwp:scope.wp});
    $('preview-save').checked=false;
    await refresh();
  }));
  const row=line(box,'Pratinjau tersimpan · '+describeSubmitted(draft.report),[use,resume,drop]);
  row.querySelectorAll('button').forEach(b=>b.disabled=busy||autoSpt);
}
async function withPreviewLock(fn){
  if(busy || autoSpt || paging || batch.active || otherSources.active)throw Error('Selesaikan pembacaan yang sedang berjalan.');
  return navigator.locks.request('scv2-spt-navigation',{ifAvailable:true},lock=>{
    if(!lock)throw Error('Pembacaan SPT sedang berjalan di tab lain.');return fn();
  });
}
function stagePreview(wp,range,fresh,report,old,binding=null){
  if(old.length && (binding || report.note || report.filtered) &&
      (old.some(e=>{const prior=e.proof.daftarPratinjau;return wholePreview(prior)&&!wholePreview(report) ||
        prior.fromFirst&&!report.fromFirst || !prior.filtered&&report.filtered;}) ||
       !coversRows(old.map(e=>rowsOf(e.page)),fresh.map(d=>d.rows))))return false;
  const batchId=crypto.randomUUID();
  for(const [i,data] of fresh.entries()){
    const zero=data.range?.total===0 && !data.rows.length;
    const proof={daftarPratinjau:{...report,id:batchId},indexScope:data.indexScope,ownerEvidence:data.ownerEvidence,columns:data.columns,
      halamanDaftar:i+1,...(data.range?{rentangDaftar:data.range}:{}),...(zero?{nolPadaSumber:true}:{}),
      ...(i===fresh.length-1 && data.canAdvance?{morePagesAvailable:true}:{})};
    addEntry({wp,source:'sptdaftar',spt:'',period:range,proof,...(binding?{previewBinding:binding}:{})},{Payload:{Data:data.rows,...(zero?{TotalRecords:0}:{})}},'Daftar SPT Dilaporkan · halaman pratinjau '+(i+1),'Tabel tampak');
  }
  const first=queue[queue.length-fresh.length];
  for(const prior of old){
    if(prior.sptObservedParts)(first.sptObservedParts ||= []).push(...prior.sptObservedParts);
    if(prior.sptAutoChecks)(first.sptAutoChecks ||= []).push(...prior.sptAutoChecks);
    if(prior.sptResultId)first.sptResultId=prior.sptResultId;
    if(prior.sptLegacyNotes)first.sptLegacyNotes=prior.sptLegacyNotes;
    if(prior.sptAssignment)first.sptAssignment=prior.sptAssignment;
    queue.splice(queue.indexOf(prior),1);
  }
  return true;
}
async function restorePreview(id){
  await withPreviewLock(async()=>{
    prepare({preview:true,allowEmpty:true});
    const records=await vault.items(),scope=previewScope(),draft=records.find(r=>r.kind===previewKind && r.id===id && sameScope(r.scope,scope));
    if(!draft || !$('consent').checked || !checked('sources').includes('sptdaftar'))throw Error('Pratinjau tersimpan tidak cocok dengan penugasan dan sumber yang dipilih.');
    const pages=savedPages(records,draft),old=queue.filter(e=>e.period===scope.period && e.wp===scope.wp && e.proof?.daftarPratinjau);
    const used=stagePreview(scope.wp,scope.period,pages,draft.report,old,{scope,route:draft.route});
    renderQueue();showPreview();$('preview-read-status').textContent=used?
      'Halaman tersimpan dimuat ke antrean. Periksa cakupannya sebelum memilih Mulai tarik.':'Daftar di antrean tetap digunakan karena cakupannya lebih lengkap.';
  });
}
async function previewFromTab(force=false,resumeId=null){
  if(busy || autoSpt || paging || batch.active || otherSources.active)throw Error('Selesaikan pembacaan yang sedang berjalan.');
  const {plan}=prepare({preview:true,allowEmpty:true});
  if(!ext || !checked('sources').includes('sptdaftar'))return showPreview();
  const wp=plan.wp,range=period(),types=checked('forms').join('|');
  if(!types)throw Error('Pilih sedikitnya satu jenis SPT pada bagian Data yang ditarik.');
  const matching=queue.filter(e=>e.wp===wp && e.period===range && e.source==='sptdaftar');
  const saveProgress=$('preview-save').checked;
  if(matching.length && !force && !(saveProgress && matching.some(e=>e.proof?.daftarPratinjau && !e.previewBinding)))return showPreview();
  const limit=Number(val('preview-index-limit'));
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Pilih batas 1–100 halaman untuk pratinjau daftar.');
  const status=$('preview-read-status'),actions=$('preview-read-actions'),selectedAtStart=val('tab');
  const scope=previewScope();
  const check=()=>{
    if(!sameScope(scope,previewScope()) || !$('consent').checked || !checked('sources').includes('sptdaftar') || saveProgress&&!$('preview-save').checked)
      throw Error('WP, pernyataan kerahasiaan atau pilihan data berubah. Buka kembali pratinjau.');
  };
  await navigator.locks.request('scv2-spt-navigation',{ifAvailable:true},async lock=>{
    if(!lock || autoSpt)throw Error('Tunggu sampai pembacaan SPT yang sedang berjalan selesai.');
    check();autoSpt=true;jobButtons();renderPreviewRecovery();const checkpoint=sptPlayback(actions,status,check),fresh=[];
    let writer=null,storageError='',keptSaved=false;
    try{
      status.textContent='Mencari daftar SPT Dilaporkan untuk WP yang dipilih…';
      const tab=await findSubmittedTab(ext,wp,chosenPreviewTab,checkpoint);
      if(!tab){status.textContent='';if(force)throw Error('Tab daftar SPT Dilaporkan belum ditemukan.');return showPreview();}
      const route=new URL(tab.url).pathname;
      if(matching.some(e=>e.previewBinding && e.previewBinding.route!==route))throw Error('Alamat daftar berbeda dari sumber pratinjau tersimpan di antrean.');
      if(resumeId || saveProgress){
        const records=await vault.items();check();
        if(resumeId){
          const draft=records.find(r=>r.id===resumeId && r.kind===previewKind && sameScope(r.scope,scope) && r.route===route);
          if(!draft)throw Error('Pratinjau tersimpan berbeda dari WP, penugasan atau alamat daftar yang dipilih.');
          stagePreview(wp,range,savedPages(records,draft),draft.report,matching.filter(e=>e.proof?.daftarPratinjau),{scope,route});
          renderQueue();showPreview();
        }
        if(saveProgress)writer=previewWriter(records,scope,route,vault.save);
      }
      const report=await readSubmittedPreview(ext,tab,wp,{limit,checkpoint,async onPage(data,progress){
        fresh.push(data);let persisted=false;
        if(writer && !storageError){try{check();persisted=await writer.page(data,progress);}catch(error){storageError=error.message;}}
        status.textContent=progress.pages+' halaman dan '+progress.rows+' baris daftar sudah dibaca.'+(persisted?' Kemajuan tersimpan di perangkat.':'');
      }});
      check();if(val('tab')!==selectedAtStart)throw Error('Tab yang dipilih berubah. Buka kembali pratinjau.');
      if(writer && !storageError){try{keptSaved=!await writer.finish(report);}catch(error){storageError=error.message;}}
      const old=queue.filter(e=>e.wp===wp && e.period===range && e.proof?.daftarPratinjau);
      const bound=resumeId || writer || old.some(e=>e.previewBinding);
      if(!stagePreview(wp,range,fresh,report,old,bound?{scope,route}:null)){
        showPreview();status.textContent=describeSubmitted(report)+' Daftar sebelumnya tetap digunakan karena cakupannya lebih lengkap.';return;
      }
      if(![...$('tab').options].some(o=>o.value===String(tab.id)))$('tab').add(new Option('Tab daftar SPT Dilaporkan',String(tab.id)));
      $('tab').value=String(tab.id);tables=[];$('table-pick').hidden=true;
      renderQueue();showPreview();
      status.textContent=keptSaved?'Cakupan simpanan sebelumnya lebih lengkap atau berbeda. Simpanan itu tetap tersedia.':
        report.note?'Pembacaan terhenti atau hanya mencakup sebagian daftar. Buka kembali daftar WP yang sama untuk membaca ulang.':'';
    }catch(error){
      status.textContent=error.message;
      if(error.code==='MULTIPLE'){
        const choose=button('Gunakan tab yang sedang dipilih untuk pratinjau',()=>{chosenPreviewTab=Number(val('tab'));return previewFromTab(true,resumeId);});
        if(plan.entries.length)showPreview();else $('preview-box').replaceChildren();
        $('preview-box').append(choose);return;
      }
      if(plan.entries.length){showPreview();message(error.message,true);}else throw error;
    }finally{
      actions.replaceChildren();autoSpt=false;jobButtons();
      if(writer){try{await refresh();}catch(error){storageError=error.message;}}
      renderPreviewRecovery();
      if(storageError){status.textContent='Kemajuan terakhir belum tersimpan di perangkat. '+storageError;message(status.textContent,true);}
    }
  });
}
async function previewSelectedSources(){
  if(busy || autoSpt || paging || batch.active || otherSources.active)throw Error('Selesaikan pembacaan yang sedang berjalan.');
  const {inPeriod}=prepare({preview:true,allowEmpty:true});
  const shown=await otherSources.scan();
  if(shown && !inPeriod.length && !checked('sources').includes('sptdaftar'))return;
  try{await previewFromTab();}
  catch(error){
    if(!shown || inPeriod.length || !error.message.startsWith('Tambahkan tabel atau berkas'))throw error;
  }
}
function showSptPlan(box,{counts,documents}) {
  const summary=captureTable(box,'SPT dalam periode terpilih',['Jenis dan masa berbeda','Versi SPT','Bagian tersedia','Bagian perlu diambil','Bagian perlu diulang']);
  captureRow(summary,[counts.periods,counts.versions,counts.readyParts,counts.pendingParts,counts.retryParts]);
  const notes=[
    [counts.outside,'baris di luar periode'],[counts.excludedType,'baris di luar pilihan jenis'],
    [counts.unknown,'baris dengan jenis belum dikenali'],[counts.conflicts,'konflik identitas atau versi'],
    [counts.duplicateRows,'baris daftar berulang'],[counts.missing,'baris dengan keterangan belum lengkap'],
    [counts.drafts,'baris pada daftar SPT belum dilaporkan'],[counts.failedIndexPages,'halaman daftar gagal dibaca'],
    [counts.unmatchedParts,'bagian tanpa pasangan pada daftar']
  ].filter(([count])=>count>0);
  if(notes.length) {
    const note=document.createElement('p');
    note.textContent=notes.map(([count,label])=>count+' '+label).join(' · ');
    box.append(note);
  }
  if(!documents.length)return;
  const panel=disclosure('Rincian versi SPT dan bagian yang tersedia');
  box.append(panel);
  panel.addEventListener('toggle',()=>{
    if(!panel.open || panel.querySelector('table'))return;
    const hint=document.createElement('p');
    hint.textContent='Setiap versi memerlukan induk. Lampiran ikut dihitung jika namanya tersedia di sumber yang ditambahkan.';
    panel.append(hint);
    const navigate=Boolean(ext && checked('sources').includes('sptisi'));
    const pageLimit=document.createElement('input'),reread=document.createElement('input');
    if(navigate){
      pageLimit.type='number';pageLimit.min='1';pageLimit.max='100';pageLimit.value='100';
      const label=document.createElement('label');label.append('Halaman maksimal per bagian SPT',pageLimit);panel.append(label);
      const pagingHint=document.createElement('p');
      pagingHint.textContent='Pembacaan dimulai dari halaman yang tampil. Penarik dapat memakai kembali cuplikan yang mencakup awal hingga akhir tampilan atau ekspor dengan jumlah baris terverifikasi.';
      reread.type='checkbox';const fullLabel=document.createElement('label');fullLabel.append(reread,' Ambil ulang semua bagian versi yang dipilih');
      panel.append(pagingHint,fullLabel);
    }
    if(ext && !navigate){
      const instructions=document.createElement('p');
      instructions.textContent='Untuk mencari induk atau lampiran di Coretax, centang Induk dan lampiran SPT lalu buka kembali pratinjau.';
      panel.append(instructions);
    }
    const labels=new Map(forms),selected=new Map();
    const picked=document.createElement('span');
    const updatePicked=()=>{picked.textContent=selected.size+' versi dipilih dari '+cursor+' versi yang ditampilkan. Jumlah versi dalam daftar: '+documents.length+'.';};
    if(navigate){
      const directoryLimit=document.createElement('input');
      directoryLimit.type='number';directoryLimit.min='1';directoryLimit.max='100';directoryLimit.value='100';
      const label=document.createElement('label');label.append('Halaman maksimal untuk mencari versi di daftar',directoryLimit);
      const hint=document.createElement('p');
      hint.textContent='Versi yang ditampilkan dengan bagian belum siap sudah dicentang. Tampilkan versi berikutnya untuk menambah pilihan.';
      panel.append(label,hint,picked,batchSptControls(selected,pageLimit,directoryLimit,reread));
    }
    const body=captureTable(panel,'Versi SPT yang ditemukan',['Jenis SPT','Masa atau tahun','Pembetulan','Bagian tersedia','Perlu diambil','Perlu diulang',...(navigate?['Pilih','Tampilan Coretax']:[])]);
    let cursor=0;
    const more=button('Tampilkan versi berikutnya',appendRows);
    function appendRows() {
      const end=Math.min(cursor+100,documents.length);
      for(;cursor<end;cursor++) {
        const doc=documents[cursor];
        const parts=status=>doc.parts.filter(part=>part.status===status).map(part=>part.name).join(', ') || '—';
        const nav=navigate?sptViewControls(doc,pageLimit,reread):null;
        let choice;
        if(nav){
          choice=document.createElement('input');choice.type='checkbox';
          choice.setAttribute('aria-label','Pilih '+(labels.get(doc.type)||doc.type)+' · '+doc.period+' · pembetulan '+doc.revision);
          choice.checked=doc.parts.some(p=>p.status!=='ready');
          if(choice.checked)selected.set(doc.key,doc);
          choice.onchange=()=>{if(choice.checked)selected.set(doc.key,doc);else selected.delete(doc.key);updatePicked();};
        }
        captureRow(body,[labels.get(doc.type) || doc.type,doc.period,doc.revision,parts('ready'),parts('pending'),parts('retry'),
          ...(navigate?[choice,nav]:[])]);
      }
      updatePicked();
      more.hidden=cursor===documents.length;
    }
    panel.append(more);
    appendRows();
  });
}
function sptErrorText(error) {
  return /chrome|tab id|https?:\/\/|frame/i.test(error.message)?
    'Tab Coretax berubah. Pilih ulang tab dan periksa tampilan SPT.':error.message;
}
function sptProof(doc,result){
  return {recordId:result.recordId,receipt:result.receipt,period:doc.period,revision:doc.revision,
    part:result.part,label:result.label,docKey:doc.key};
}
function sptPlayback(actions,status,check){
  let paused=false,stopped=false;
  const startTab=val('tab');
  const pause=button('Jeda pembacaan SPT',()=>{paused=!paused;pause.textContent=paused?'Lanjutkan pembacaan SPT':'Jeda pembacaan SPT';
    status.textContent=paused?'Pembacaan dijeda pada batas langkah.':'Pembacaan dilanjutkan.';});
  const halt=button('Hentikan pembacaan SPT',()=>{stopped=true;halt.disabled=true;});
  actions.replaceChildren(pause,halt);
  return async()=>{
    do{
      check();
      if(val('tab')!==startTab)throw Object.assign(Error('Tab sumber yang dipilih berubah.'),{code:'SCOPE'});
      if(stopped)throw Object.assign(Error('Pembacaan dihentikan.'),{code:'STOP'});
      if(paused)await sleep(100);
    }while(paused);
  };
}
function sptPageSink(doc,wp,range,status){
  let pages=0,previous=null,first=null,reused=0;
  const observed=new Set(),issues=[];
  const index=queue.find(e=>isSptList(e.source) && e.wp===wp && e.period===range);
  const assignment=previewScope();
  function remember(part,failed){
    if(!index || !part)return;
    index.sptAssignment=assignment;
    const notes=index.sptObservedParts ||= [];
    const existing=notes.find(n=>n.docKey===doc.key && n.cap.konteks.spt.recordId===doc.recordId && n.cap.konteks.spt.nomor===doc.receipt && n.cap.konteks.bagian===part);
    if(existing){if(failed)existing.failed=true;return;}
    notes.push({docKey:doc.key,failed,cap:{konteks:{npwp:wp,bagian:part,spt:{recordId:doc.recordId,nomor:doc.receipt,jenis:doc.type,masa:doc.period,pemb:doc.revision}}}});
  }
  return {
    onSections(sections){for(const s of sections)remember(s.part,false);},
    onReuse(){reused++;},
    onCovered(pass){if(previous?.proof.urutan.id===pass)previous.proof.akhirTampilan=true;},
    onPage(result){
      const proof={urutan:{id:result.pass,halaman:result.page},columns:result.columns,
        morePagesAvailable:result.paging==='next',...(result.zero?{nolPadaSumber:true}:{}),...(result.page===1 && result.atStart?{awalTampilan:true}:{}),
        ...(result.filtered?{filterTampilan:true}:{})};
      const info={wp,source:'sptisi',spt:doc.type,period:range,sptAssignment:assignment,detailProof:sptProof(doc,result),proof};
      const page={Payload:{Data:result.rows,...(result.zero?{TotalRecords:0}:{})}};
      addEntry(info,page,result.label+' · halaman pengambilan '+result.page,'Tabel tampak');
      const entry=queue.at(-1);first ||= entry;
      if(previous?.proof.urutan.id===result.pass)delete previous.proof.morePagesAvailable;
      previous=entry;pages++;observed.add(result.part);renderQueue();
      status.textContent=result.label+' · halaman '+result.page+' tersimpan.';
    },
    onIssue(section,error){remember(section.part,true);issues.push(section.label+' · '+sptErrorText(error));},
    finish(error){
      if(error)issues.push(sptErrorText(error));
      const note=[observed.size+' bagian dan '+pages+' halaman terbaca.',...(reused?[reused+' bagian dari antrean dipakai kembali.']:[]),...issues].join(' ');
      if(issues.length){
        const source=first || queue.find(e=>isSptList(e.source) && e.wp===wp && e.period===range);
        const text=doc.period+' · pembetulan '+doc.revision+' · '+note;
        if(source)(source.sptAutoChecks ||= []).push({type:doc.type,pesan:text});
        message(text,true);
      }
      return {note,pages,issues,reused};
    }
  };
}
function currentSptParts(docs,reread){
  const {plan,meta,inPeriod}=prepare({preview:true});
  const current=planSptDetails({wp:plan.wp,period:meta.opsi.periode,types:meta.opsi.jenisSpt,items:inPeriod});
  return new Map(docs.map(doc=>{
    const match=current.documents.find(d=>d.key===doc.key && d.recordId===doc.recordId && d.receipt===doc.receipt);
    if(!match)throw Error('Versi atau identitas pada daftar berubah. Buka kembali pratinjau.');
    return [doc.key,new Set(reread?[]:match.parts.filter(p=>p.status==='ready').map(p=>p.name))];
  }));
}
function batchSptControls(selected,pageLimit,directoryLimit,reread){
  const block=document.createElement('div'),actions=document.createElement('div'),status=document.createElement('span');
  status.setAttribute('role','status');status.setAttribute('aria-label','Proses versi SPT terpilih');
  const run=button('Ambil versi SPT terpilih',async()=>{
    const docs=[...selected.values()],wp=captureOwner(),range=period();
    const limit=Number(pageLimit.value),indexLimit=Number(directoryLimit.value);
    if(!docs.length)throw Error('Pilih sedikitnya satu versi SPT pada daftar.');
    if([limit,indexLimit].some(n=>!Number.isInteger(n)||n<1||n>100))throw Error('Pilih batas 1–100 halaman untuk daftar dan bagian SPT.');
    const bounds={from:{y:Number(val('year-start')),m:Number(val('month-start'))},to:{y:Number(val('year-end')),m:Number(val('month-end'))}};
    function check(){
      if(!block.isConnected || busy || paging || batch.active || wp!==captureOwner() || range!==period() ||
          !checked('sources').includes('sptisi') || !$('consent').checked || selected.size!==docs.length ||
          docs.some(d=>!selected.has(d.key) || !checked('forms').includes(d.type)))
        throw Object.assign(Error('Pilihan WP, periode atau versi berubah. Buka kembali pratinjau.'),{code:'SCOPE'});
    }
    await navigator.locks.request('scv2-spt-navigation',{ifAvailable:true},async lock=>{
      if(!lock || autoSpt)throw Error('Tunggu sampai pembacaan SPT yang sedang berjalan selesai.');
      check();const parts=currentSptParts(docs,reread.checked);autoSpt=true;run.disabled=reread.disabled=true;jobButtons();
      const checkpoint=sptPlayback(actions,status,check);
      try{
        const tab=await tabNow(),directory=await sptDirectory(ext,tab.id,wp);
        const candidates=docs.map(doc=>({doc,navigation:sptNavigation({ext,wp,period:bounds,doc})}));
        const result=await collectSptQueue({directory,candidates,tabId:tab.id,limit,indexLimit,checkpoint,
          createSink:c=>({...sptPageSink(c.doc,wp,range,status),skipParts:parts.get(c.doc.key)}),
          onOpen:c=>{status.textContent='Membuka SPT '+c.doc.period+' · pembetulan '+c.doc.revision+'…';}});
        status.textContent=result.attempted+' dari '+docs.length+' versi diproses. '+result.withPages+' versi menghasilkan '+result.pages+' halaman.'+
          (result.reused?' '+result.reused+' bagian dari antrean dipakai kembali.':'')+
          (result.problem?' '+sptErrorText(result.problem):'');
      }catch(error){
        for(const doc of docs)sptPageSink(doc,wp,range,status).finish(error);
        status.textContent='0 dari '+docs.length+' versi diproses. '+sptErrorText(error);
      }finally{
        actions.replaceChildren();autoSpt=false;run.disabled=reread.disabled=false;jobButtons();
      }
    });
  });
  block.append(run,status,actions);return block;
}
function sptViewControls(doc,pageLimit,reread) {
  const block=document.createElement('div'),actions=document.createElement('div'),status=document.createElement('span');
  status.setAttribute('role','status');
  const wp=captureOwner(),range=period(),periodStart={y:Number(val('year-start')),m:Number(val('month-start'))},
    periodEnd={y:Number(val('year-end')),m:Number(val('month-end'))};
  const navigation=sptNavigation({ext,wp,period:{from:periodStart,to:periodEnd},doc});
  const errorText=sptErrorText;
  function check() {
    if (!block.isConnected || busy || paging || batch.active || otherSources.active || wp!==captureOwner() || range!==period() ||
        !checked('forms').includes(doc.type) || !checked('sources').includes('sptisi') || !$('consent').checked)
      throw Object.assign(Error('Cakupan berubah. Buka kembali pratinjau WP.'),{code:'SCOPE'});
  }
  const withSptLock=run=>navigator.locks.request('scv2-spt-navigation',{ifAvailable:true},lock=>{
    if(!lock)throw Error('Tunggu sampai pembacaan SPT yang sedang berjalan selesai.');
    check();return run();
  });
  const open=button('Cari tampilan SPT',async()=>{
    if(autoSpt)throw Error('Tunggu sampai pembacaan SPT selesai.');
    check();open.disabled=true;actions.replaceChildren();status.textContent='Mencocokkan daftar dan tampilan SPT…';
    try {
      const view=await withSptLock(async()=>{
        const tab=await tabNow();
        return await navigation.inspect(tab.id) || await navigation.open(tab.id);
      });
      check();
      if(!view.sections.length){status.textContent='Identitas SPT cocok. Nama induk atau lampiran belum terbaca pada tampilan ini.';return;}
      status.textContent='Identitas SPT cocok. Pilih bagian yang ingin disimpan dari halaman ini.';
      const select=document.createElement('select');select.setAttribute('aria-label','Bagian SPT pada sumber');
      choices(select,view.sections.map(s=>[s.part,s.label]));
      const save=button('Tambahkan bagian tampak',async()=>{
        if(autoSpt)throw Error('Tunggu sampai pembacaan SPT selesai.');
        check(); save.disabled=true;status.textContent='Membaca bagian SPT…';
        try {
          const result=await withSptLock(()=>navigation.capture(view,select.value));
          check();
          const proof=sptProof(doc,result);
          const page={Payload:{Data:result.rows,...(result.zero?{TotalRecords:0}:{})}};
          const existing=queue.filter(e=>e.detailProof?.docKey===doc.key && e.detailProof.part===result.part &&
            (e.detailProof.recordId && proof.recordId ? e.detailProof.recordId===proof.recordId : e.detailProof.receipt && e.detailProof.receipt===proof.receipt));
          if(existing.some(e=>JSON.stringify(e.page)===JSON.stringify(page))) {
            status.textContent='Cuplikan yang sama sudah ada dalam antrean.';return;
          }
          addEntry({wp,source:'sptisi',spt:doc.type,period:range,detailProof:proof,...(result.zero?{proof:{nolPadaSumber:true}}:{})},page,result.label,'Satu halaman tampilan SPT');
          renderQueue();status.textContent=existing.length?'Isi bagian berubah. Cuplikan baru dan cuplikan sebelumnya disimpan terpisah untuk dibandingkan.':
            result.rows.length+' baris ditambahkan sebagai cuplikan satu halaman.';
        } catch(error){status.textContent=errorText(error);} finally {save.disabled=false;}
      });
      actions.append(select,save);
    } catch(error) {
      status.textContent=errorText(error);
    } finally {open.disabled=false;}
  });
  const auto=button('Ambil induk dan lampiran',async()=>{
    check();
    const limit=Number(pageLimit.value);
    if(!Number.isInteger(limit) || limit<1 || limit>100)throw Error('Pilih batas 1–100 halaman per bagian.');
    if(autoSpt)throw Error('Pembacaan SPT masih berjalan.');
    await withSptLock(async()=>{
      const skipParts=currentSptParts([doc],reread.checked).get(doc.key);
      autoSpt=true;auto.disabled=open.disabled=reread.disabled=true;jobButtons();actions.replaceChildren();
      const checkpoint=sptPlayback(actions,status,check),sink=sptPageSink(doc,wp,range,status);
      let failure;
      try {
        status.textContent='Mencocokkan WP dan versi SPT…';
        const tab=await tabNow(),view=await navigation.inspect(tab.id) || await navigation.open(tab.id);
        await navigation.collect(view,{limit,checkpoint,skipParts,...sink});
      } catch(error){failure=error;}
      finally {
        status.textContent=sink.finish(failure).note;
        actions.replaceChildren();autoSpt=false;auto.disabled=open.disabled=reread.disabled=false;jobButtons();
      }
    });
  });
  block.append(open,auto,status,actions);
  return block;
}
function jobButtons() {
  const disabled=busy || autoSpt || !$('consent').checked || !val('ids') || !$('ids').validity.valid;
  $('start').disabled = disabled; $('preview').disabled = disabled;
  $('pause').hidden = !busy; $('pause').textContent = paused ? 'Lanjutkan' : 'Jeda';
  $('stop').hidden = !busy; $('progress').hidden = !busy;
  for (const b of $('pending-jobs').querySelectorAll('button')) b.disabled=busy;
}
// Earlier versions kept one plan per WP and advanced a cursor after saving each result.
function pendingPlans(record) {
  return record.plan ? [record.plan] : record.plans.slice(record.cursor);
}
async function run(resume) {
  if (busy || paging || autoSpt || batch.active || otherSources.active) return;
  await navigator.locks.request('scv2-capture-job',{ifAvailable:true},async lock => {
    if (!lock) throw new Error('Tarikan sedang berjalan pada tab penarik lainnya.');
    if (busy || paging || autoSpt || batch.active || otherSources.active) return;
    otherSources.invalidate();
    busy = true; paused = false; stop = false;
    try {
      renderQueue();
      await refresh();
      let job,plan;
      if (resume) {
        job=stored.find(r=>r.kind==='job' && r.id===resume.id && r.runId===resume.runId);
        plan=job && pendingPlans(job).find(p=>p.wp===resume.wp);
        if(!plan) throw Error('Tarikan ini sudah diselesaikan atau dihapus pada tab lain.');
      } else {
        const prepared = prepare();
        plan=prepared.plan;
        if(stored.some(r=>r.kind==='job' && pendingPlans(r).some(p=>p.wp===plan.wp))) throw Error('Ada tarikan tersimpan untuk NPWP ini. Pilih Lanjutkan pada tarikan tersebut.');
        const id=crypto.randomUUID();
        job={id,runId:id,kind:'job',plan,meta:prepared.meta};
        await vault.save([{id,value:job}],'Mulai tarik',{jumlahWP:1,penarik:job.meta.penarik.nama,dasar:job.meta.penugasan.nomor,npwp:plan.wp});
      }
      jobButtons();
      const seen = new Set(), grouped = new Map(), sections=new Map(), checks=[],indexReports=new Set();
      const progress=$('progress'); progress.max=plan.entries.length; progress.value=0;
      for (const queued of plan.entries) {
        while (paused && !stop) await sleep(100);
        if(stop) break;
        if(queued.wp!==plan.wp) throw Error('Antrean tersimpan memuat sumber untuk WP yang berbeda.');
        const source=selectSptListRows(queued,queued.spt?[queued.spt]:job.meta.opsi.jenisSpt || forms.map(([code])=>code));
        const indexReport=queued.proof?.daftarPratinjau;
        if(indexReport && !indexReports.has(indexReport.id)){
          checks.push({tingkat:indexReport.note || indexReport.filtered?'SEDANG':'INFO',kode:'DAFTAR-SPT-PRATINJAU',pesan:describeSubmitted(indexReport)});
          indexReports.add(indexReport.id);
        }
        for(const note of queued.sptAutoChecks || [])if(job.meta.opsi.jenisSpt?.includes(note.type))
          checks.push({tingkat:'SEDANG',kode:'SPT-TAMPILAN',pesan:note.pesan});
        progress.value++;
        if(!source) continue;
        checkIdentity(rowsOf(source.page),plan.wp);
        const sptTracked=stageSptSource(sections,source,plan.wp);
        if(!sptTracked) {
          const key=await vault.digest(JSON.stringify([source.source,source.spt,source.detailProof?.docKey,source.detailProof?.part,source.page]));
          if(seen.has(key) && job.meta.opsi.lewatiDuplikat) continue;
          seen.add(key);
        }
        const reported=source.sptSelection?.totalDilaporkanSumber ?? source.total;
        const received=source.sptSelection?.barisSumber ?? source.rows;
        if(reported!=null && reported!==received) {
          const issue={tingkat:'TINGGI',pesan:sources[source.source]+' melaporkan '+reported+' baris. Yang diterima '+received+'.'};
          checks.push(issue); message(plan.wp+' · '+issue.pesan,true);
        }
        if(!sptTracked){
          const entry=appendPackageEntry(grouped,source,plan.wp);
          if(source.source==='sptdaftar' && source.sptObservedParts?.length){
            const observations=source.sptObservedParts.filter(n=>job.meta.opsi.jenisSpt.includes(n.cap.konteks.spt.jenis));
            if(observations.length)(entry.cap.bagianSptTeramati ||= []).push(...observations);
          }
        }
        await sleep(0);
      }
      if(stop) {
        await vault.save([],'Tarikan dihentikan',{npwp:plan.wp});
        $('status').textContent='Antrean NPWP '+plan.wp+' tersimpan dan dapat dilanjutkan.'; return;
      }
      finishSptSources(sections,grouped,checks,job.meta.opsi.lewatiDuplikat);
      checks.push(...remainingSptChecks(plan.entries,plan.wp,job.meta.opsi));
      if(plan.entries.some(e=>e.sptLegacyNotes))checks.push({tingkat:'INFO',kode:'SPT-CATATAN-LAMA',
        pesan:'Hasil sebelumnya memuat catatan pengambilan SPT tanpa identitas bagian terstruktur. Periksa catatan pada hasil semula.'});
      if(!grouped.size)throw Error('Antrean ini tidak memuat baris untuk jenis SPT yang dipilih. Ambil kembali daftar dengan pilihan jenis yang sesuai.');
      const entries=[...grouped.values()], name=taxpayerName(plan.entries);
      const meta={...metaForSelection(job.meta,plan.entries),wp:{npwp:plan.wp,...(name?{nama:name}:{})},dibuat:new Date().toISOString(),cek:checks};
      const remaining=pendingPlans(job).filter(p=>p!==plan);
      const pendingUpdate=remaining.length ? {id:job.id,value:{...job,plans:remaining,cursor:0}} : {id:job.id,remove:true};
      await vault.save([{id:crypto.randomUUID(),value:{kind:'result',meta,entries}},pendingUpdate],'Tarikan WP',{npwp:plan.wp,berkas:entries.length,dasar:meta.penugasan.nomor,penarik:meta.penarik.nama});
      const completed=new Set(plan.entries.map(e=>e.id));
      for(let index=queue.length-1;index>=0;index--) {
        if(completed.has(queue[index].id)) queue.splice(index,1);
      }
      $('preview-box').replaceChildren();
      $('status').textContent='Tarikan selesai untuk NPWP '+plan.wp+' · '+entries.length+' sumber tersimpan.';
      message($('status').textContent);
    } finally { busy = false; renderQueue(); await refresh(); }
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
const resultColumns=['NPWP','Nama WP','Periode','Waktu simpan','Berkas data','Baris tersimpan','Catatan pemeriksaan','Tindakan'];
function resultRow(body,rec,remove) {
  const controls=document.createElement('div');controls.className='result-actions';
  controls.append(button('Unduh paket',()=>chooseExport(rec)),button('Buka di Analisis',()=>openAnalysis(rec)));
  if(remove)controls.append(remove);
  let notes=Array.isArray(rec.meta.cek)?'Tidak ada catatan':'Belum tercatat';
  if(rec.meta.cek?.length){
    notes=disclosure(rec.meta.cek.length+' catatan');
    const list=document.createElement('ul');
    for(const check of rec.meta.cek){
      const item=document.createElement('li');item.textContent=[check.tingkat,check.pesan].filter(Boolean).join(' · ');list.append(item);
    }
    notes.append(list);
  }
  const count=rec.entries.every(e=>Number.isSafeInteger(e.cap?.baris) && e.cap.baris>=0)
    ? rec.entries.reduce((sum,e)=>sum+e.cap.baris,0) : null;
  captureRow(body,[rec.meta.wp.npwp,rec.meta.wp.nama || null,rec.meta.periode,formatDate(rec.when),rec.entries.length,count,notes,controls]);
}
async function refresh() {
  stored = await vault.items();
  renderPreviewRecovery();
  const pending=$('pending-jobs');
  pending.replaceChildren();
  for(const record of stored.filter(r=>r.kind==='job')) {
    for(const plan of pendingPlans(record)) {
      line(pending,'Tarikan tersimpan · NPWP '+plan.wp+' · '+plan.entries.length+' sumber',[
        button('Lanjutkan NPWP '+plan.wp,()=>run({id:record.id,runId:record.runId,wp:plan.wp}))
      ]);
    }
  }
  const results = stored.filter(x => x.kind === 'result').sort((a,b) => b.when-a.when);
  const box = $('results'); box.replaceChildren();
  if (!results.length) {box.textContent='Belum ada hasil penarikan.';jobButtons();return;}
  const groups=new Map();
  for(const record of results) {
    const id=record.meta.wp.npwp;
    if(!groups.has(id)) groups.set(id,[]);
    groups.get(id).push(record);
  }
  const latest=captureTable(box,'Tarikan terakhir per WP',resultColumns);
  for (const [wp,group] of groups) {
    const [rec,...history]=group;
    resultRow(latest,rec,button(history.length?'Hapus riwayat WP':'Hapus',async()=>{
      await withPreviewLock(async()=>{
        if(!confirm('Hapus seluruh '+group.length+' tarikan dan pratinjau tersimpan untuk '+wp+'?'))return;
        const records=await vault.items(),drafts=records.filter(r=>r.kind===previewKind && r.scope.wp===wp);
        await vault.save([...group.map(r=>({id:r.id,remove:true})),...drafts.flatMap(d=>removePreview(d,records))],'Hapus WP',{npwp:wp,jumlah:group.length});await refresh();
      });
    }));
    if(history.length) {
      const detail=disclosure('Tarikan sebelumnya · '+wp+' ('+history.length+')');box.append(detail);
      const prior=captureTable(detail,'Riwayat untuk NPWP '+wp,resultColumns);
      for(const old of history)resultRow(prior,old);
    }
  }
  jobButtons();
}
async function secureState(unlocked=false) {
  const config = await vault.settings();
  $('encryption').hidden = !!config.salt; $('lock').hidden = !config.salt;
  $('security').textContent = config.salt ? 'Enkripsi AES-256 aktif. Kata sandi diperlukan setiap kali halaman dibuka.' : 'Simpanan lokal menggunakan penyimpanan browser. Aktifkan enkripsi untuk menguncinya dengan kata sandi.';
  $('preview-save-hint').textContent=config.salt?'Halaman tersimpan mengikuti enkripsi dan masa retensi simpanan lokal.':
    'Halaman yang disetujui tersimpan di Chrome tanpa enkripsi tambahan. Enkripsi dan masa retensi tersedia di Keamanan simpanan.';
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
  for(const id of ['ids','id-file','role','basis','letter','date','officer','nip','sources','forms','month-start','month-end','year-start','year-end']){
    const event=['ids','letter','date','officer','nip'].includes(id)?'input':'change';
    $(id).addEventListener(event,()=>{
      $('preview-save').checked=false;
      if(['officer','nip','letter','date','role','basis'].includes(id)){$('preview-box').replaceChildren();otherSources?.invalidate();}
      renderPreviewRecovery();
    });
  }
  $('consent').addEventListener('change',()=>{if(!$('consent').checked)$('preview-save').checked=false;});
  action('ids',idsChanged,'input');
  action('id-file',async () => {
    const [file]=$('id-file').files; $('id-file').value='';
    if(!file) return;
    const text=await file.text();
    if(queue.length || busy) throw Error('Selesaikan tarikan atau keluarkan semua sumber untuk mengganti NPWP.');
    try {
      const id=readCaptureId(text);
      if(!id) throw Error('Berkas belum memuat NPWP.');
      $('ids').value=id; idsChanged();
    } catch(error) {
      $('ids').value=''; idsChanged(); $('id-status').textContent=error.message; throw error;
    }
  },'change');
  for (const id of ['sources','forms','source']) action(id,sourceChanged,'change');
  for (const id of ['spt','month-start','month-end','year-start','year-end']) action(id,() => {$('scope-ok').checked=false; scopeChanged();},'change');
  action('undated-general',()=>{$('scope-ok').checked=false;scopeChanged();},'change');
  for (const id of ['consent','dedupe']) action(id,scopeChanged,'change');
  action('tab',() => {chosenPreviewTab=Number(val('tab'));tables=[]; $('table-pick').hidden=true; $('scope-ok').checked=false;},'change');
  action('recheck',checkTabs); action('open-coretax',() => ext.tabs.create({url:coretax+'/'}));
  action('list-tables',tableList); action('add-table',addTable); action('source-files',importFiles,'change');
  $('scope-ok').addEventListener('change',()=>{
    $('scope-help').hidden=true;
    $('scope-ok').removeAttribute('aria-invalid');
  });
  $('source-files').addEventListener('click',event=>{
    try{requireSourceConfirmation();}
    catch(error){event.preventDefault();message(error.message,true);}
  });
  batch=batchCollector({ext,origin:coretax,isBusy:()=>Boolean(busy || paging || autoSpt || otherSources?.active),enqueue:addEntry,refresh:scopeChanged,log:message,context:()=>{
    const wp=captureOwner(), range=period();
    requireSourceConfirmation();
    const [from,to]=range.split(' s.d. ');
    return {wp,period:range,from,to,allowed:checked('sources'),types:checked('forms')};
  }});
  action('table',pageOptions,'change'); action('collect-pages',collectPages);
  action('pause-pages',()=>{pagingPaused=!pagingPaused;$('pause-pages').textContent=pagingPaused?'Lanjutkan pembacaan':'Jeda pembacaan';});
  action('stop-pages',()=>{pagingStopped=true;pagingPaused=false;});
  otherSources=openSourcePreview({ext,origin:coretax,box:$('other-preview'),queued:queue,enqueue:addEntry,notice:message,
    context:()=>{
      if(!$('consent').checked || !val('officer') || busy || autoSpt || paging || batch.active)throw Error('Periksa penugasan dan tunggu pembacaan yang sedang berjalan.');
      return {wp:captureOwner(),period:period(),sources:checked('sources'),assignment:['role','basis','letter','date','officer','nip'].map(val)};
    },render:()=>{renderQueue();showPreview();}});
  action('preview',previewSelectedSources); action('start',() => run());
  action('pause',() => {paused=!paused; jobButtons(); $('status').textContent=paused ? 'Tarikan dijeda setelah sumber yang sedang dibaca.' : 'Tarikan dilanjutkan.';});
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
  action('wipe',()=>withPreviewLock(async () => {
    if(!confirm('Hapus semua hasil WP, antrean dan pratinjau tersimpan? Log penarikan akan dipertahankan.')) return;
    const rows=await vault.items(); await vault.save(rows.map(r => ({id:r.id,remove:true})),'Hapus semua WP',{jumlah:rows.length});
    queue.length=0; renderQueue(); await refresh();
  }));
  action('audit',async () => {
    const log=await vault.auditRows();
    const lines=[['Urutan','Waktu','Kegiatan','Rincian','SHA-256','Rantai'],...log.map(r => [r.id,r.when,r.event,JSON.stringify(r.details),r.hash,r.intact?'Utuh':'Putus'])];
    download(new Blob(['\uFEFF'+lines.map(row => row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'Log-penarikan.csv');
  });
  idsChanged(); sourceChanged();
}
init();
Promise.all([checkTabs(),vault.prune().then(() => secureState()),removeExpiredHandoffs()]).catch(err => message(err.message,true));
