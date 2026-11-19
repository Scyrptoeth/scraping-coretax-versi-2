import {forms,catalogue,sources,readCaptureId,filePage,rowsOf,rowsInColumnOrder,checkIdentity,reportSource,taxpayerName,visibleTables,csvCell} from './app-data.js';
import * as vault from './app-vault.js';
import {putHandoff, removeExpiredHandoffs} from './app-handoff.js';
import {createPackage,sha256} from './archive/package.js';
import {batchCollector} from './app-batch.js';
import {appendPackageEntry,finishOpenTable,isSptList,metaForSelection,packagePath,selectSptListRows} from './app-package-entries.js';
import {checkLedgerScope,ledgerSelectionText,selectLedgerRows} from './ledger-status.js';
import {planSptDetails} from './app-spt-plan.js';
import {stageSptSource,finishSptSources} from './app-spt-snapshots.js';
import {sptNavigation} from './app-spt-navigation.js';
import {collectSptQueue,sptDirectory} from './app-spt-directory.js';
import {findSubmittedTab,readSubmittedPreview} from './app-spt-preview.js';
import {wpPreview,renderWpPreview} from './app-wp-preview.js';
import {previewKind,sameScope,wholePreview,coversRows,savedPages,removePreview,previewWriter} from './app-spt-progress.js';
import {openSourcePreview,supportedSources} from './app-open-sources.js';
import {openHomeModule} from './app-home-navigation.js';
import {planHomeCapture,verifyHomeRowOwners} from './app-home-plan.js';
import {collectHomeSources} from './app-home-sources.js';
import {readHomeAccount,watchHomeAccount} from './app-home-session.js';
import {collectHomeWithholding} from './app-home-withholding.js';
import {finishHomeTable} from './app-home-coverage.js';
import {resultAssignment,sameSptAssignment,verifiedIndexItems,recoverSptResult,remainingSptChecks,readPreviousSptPackage} from './app-spt-results.js';

const $ = id => document.getElementById(id);
const coretax = 'https://coretax.intranet.pajak.go.id';
const ext = globalThis.chrome?.runtime?.id ? globalThis.chrome : null;
const queue = [], messages = [];
let tables = [], tabUrl = '', stored = [], busy = false, paused = false, stop = false, noticeTimer;
let paging=false,pagingPaused=false,pagingStopped=false,batch,autoSpt=false;
let chosenPreviewTab=null;
let sptSelection=null;
let otherSources;
let suggestedOfficer='';
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
  $('ledger-options').hidden=!allowed.some(id=>id==='bb' || id==='bbtotal');
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
  appendCapture(queue,captureOwner(),info,page,name,origin);
}
function appendCapture(items,owner,info,page,name,origin) {
  if (info.wp !== owner || items.some(entry => entry.wp !== info.wp)) throw Error('NPWP berubah saat membaca sumber. Periksa kembali WP dan ulangi pembacaan.');
  const rows = rowsOf(page);
  if(!rows.length && !((info.detailProof || info.source==='sptdaftar' && info.proof?.daftarPratinjau || info.proof?.dariBeranda?.kosongPadaSumber) && info.proof?.nolPadaSumber && page.Payload?.TotalRecords===0))
    throw Error('Tabel kosong. Belum ada baris yang dapat ditambahkan.');
  if(info.proof?.dariBeranda)verifyHomeRowOwners(rows,{source:info.source,wp:info.wp});
  else checkIdentity(rows,info.wp);
  checkLedgerScope(info,page);
  if(info.period===null && rows.some(row=>row && typeof row==='object' && Object.entries(row).some(([key,value])=>
    ['masapajak','periodepajak','taxperiod','taxperiodcode','tahunpajak','taxyear'].includes(key.toLowerCase().replace(/[^a-z]/g,'')) && value!=null && String(value).trim()!==''))) {
    throw Error('Sumber ini memuat masa atau tahun pajak. Lepaskan pilihan tanpa masa dan cocokkan periode.');
  }
  items.push({...info,...(info.detailProof?{sptAssignment:info.sptAssignment||previewScope()}:{}),page,name,origin,...reportSource(page),id:crypto.randomUUID()});
}
function renderQueue() {
  $('ids').readOnly = queue.length>0 || busy;
  $('id-file').disabled = queue.length>0 || busy;
  $('pack-queue').hidden = !queue.length;
  const box = $('queue'); box.replaceChildren();
  const included=new Set(checked('sources'));
  queue.forEach(entry => {
    const selection=included.has(entry.source)?selectLedgerRows(entry,$('ledger-cancel').checked).ledgerSelection:null;
    line(box,entry.wp+' · '+sources[entry.source]+' · '+entry.name+' · '+entry.rows+' baris'+(entry.period===null?' · Masa tidak tercantum':'')+
      (selection?' · '+ledgerSelectionText(selection):''),[
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
    ]);
  });
  if(queue.length) {
    const hint=document.createElement('small');hint.textContent='Untuk mengganti NPWP, selesaikan tarikan atau keluarkan semua sumber dari antrean.';box.append(hint);
  }
}
async function checkTabs() {
  $('table-pick').hidden = true; tables = [];
  const tabs = ext ? await ext.tabs.query({url:coretax+'/*'}) : [];
  choices($('tab'),tabs.map((t,i) => [String(t.id),'Tab '+(i+1)+' · '+(t.title || 'Coretax')]));
  const home=tabs.some(isHomeTab);
  $('manual-sources').open=!home;
  $('connection').textContent = home ? 'Beranda Coretax terbuka' : tabs.length ? tabs.length+' tab Coretax tersedia' : 'Tab Coretax belum ditemukan';
  if(home){
    const account=await readHomeAccount(ext,(await findHomeTab())?.id);
    if(!val('officer')||val('officer')===suggestedOfficer){
      suggestedOfficer=account?.name||'';$('officer').value=suggestedOfficer;
    }
    if(account?.name)$('connection').textContent='Terhubung ke Coretax';
    else $('connection').textContent='Beranda terbuka · isi nama penarik';
  }
  $('list-tables').disabled = !tabs.length; $('open-coretax').hidden = !!tabs.length || !ext;
}
function isHomeTab(tab){
  return [coretax+'/home/id-ID/',coretax+'/home/id-ID'].includes(tab.url?.split(/[?#]/,1)[0]);
}
async function findHomeTab(){
  if(!ext)return null;
  const homes=(await ext.tabs.query({url:coretax+'/home/id-ID*'})).filter(isHomeTab);
  return homes.find(tab=>tab.id===Number(val('tab'))) || homes.find(tab=>tab.active) || homes[0] || null;
}
async function verifiedHomeDirectory(home,wp,checkpoint,owned){
  const result=await openHomeModule({ext,homeTab:home,wp,checkpoint,onTab:id=>owned.add(id)});
  return {id:result.tabId,url:result.url};
}
async function closeWorkTabs(owned){
  for(const id of owned){
    try{
      const tab=await ext.tabs.get(id);
      if(new URL(tab.url).origin===coretax)await ext.tabs.remove(id);
    }catch{}
  }
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
  const byType=inPeriod.map(e=>selectSptListRows(e,types)).filter(Boolean);
  const includeCancelled=$('ledger-cancel').checked;
  const relevant=byType.map(e=>selectLedgerRows(e,includeCancelled));
  if (!allowEmpty && !relevant.length && !(preview && inPeriod.some(item=>isSptList(item.source)))) {
    if(inPeriod.length) throw Error('Tidak ada baris untuk jenis SPT terpilih. Pilih semua jenis untuk menyertakan baris yang belum dikenali.');
    throw new Error('Tambahkan tabel atau berkas yang sesuai dengan WP, periode, dan sumber terpilih.');
  }
  const meta = {penugasan:{peran:val('role'),jenis:val('basis'),nomor:val('letter'),tanggal:val('date')},penarik:{nama:val('officer'),nip:val('nip')},periode:range,
    opsi:{metode:'Tabel yang terlihat atau ekspor lokal',jenisSpt:types,sumber:allowed,lewatiDuplikat:$('dedupe').checked,
      ...(allowed.some(id=>id==='bb' || id==='bbtotal')?{bbBatal:includeCancelled}:{}),
      periode:{from:{y:Number(val('year-start')),m:Number(val('month-start'))},to:{y:Number(val('year-end')),m:Number(val('month-end'))}}}};
  const omittedRows=inPeriod.reduce((sum,e)=>sum+e.rows,0)-byType.reduce((sum,e)=>sum+e.rows,0);
  return {plan:{wp,entries:relevant},meta:metaForSelection(meta,relevant),inPeriod,excluded:queue.length-relevant.length,omittedRows};
}
function showPreview(profileItems=[],fromHome=false) {
  const {plan,meta,inPeriod,excluded,omittedRows}=prepare({preview:true,allowEmpty:true}), box=$('preview-box');
  box.replaceChildren();
  const scope=previewScope();
  const previous=stored.filter(r=>r.kind==='result'&&sameSptAssignment(resultAssignment(r.meta),scope)&&
    r.entries?.some(e=>['info','klu','cari2'].includes(e.cap?.sumber))).sort((a,b)=>b.when-a.when)[0];
  const available=queue.filter(e=>e.wp===plan.wp&&e.period===scope.period&&
    (!e.previewBinding||sameScope(e.previewBinding.scope,scope))&&(!e.sptAssignment||sameSptAssignment(e.sptAssignment,scope)));
  const range=meta.opsi.periode||{from:{y:Number(val('year-start')),m:Number(val('month-start'))},to:{y:Number(val('year-end')),m:Number(val('month-end'))}};
  const summaryWp=wpPreview({wp:plan.wp,period:range,types:meta.opsi.jenisSpt,items:available.concat(profileItems),previous});
  const {profile,spt}=summaryWp;
  const rows=plan.entries.reduce((sum,entry)=>sum+entry.rows,0);
  const body=captureTable(box,'Pratinjau penarikan',['NPWP','Nama WP','Jenis WP','Status WP','KLU utama','SPT dalam periode','Periode','Sumber dalam antrean','Baris terpilih']);
  captureRow(body,[plan.wp,profile.name,profile.type,profile.status,profile.klu,spt.total===null?'Belum diketahui':
    spt.complete?spt.total:spt.total+' teridentifikasi',meta.periode||scope.period,plan.entries.length,rows]);
  renderWpPreview(box,summaryWp,captureTable,captureRow);
  if(!inPeriod.length){
    $('status').textContent=ext?'Klik Mulai tarik untuk mencari WP di Coretax dan membaca sumber pilihan.':
      'Tambahkan ekspor untuk WP dan periode pilihan.';
    return;
  }
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
    showSptPlan(box,planned,fromHome);
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
function captureSelection(){
  const key=JSON.stringify([previewScope(),checked('sources')]);
  if(sptSelection?.key!==key)sptSelection={key,overrides:{},limit:100,indexLimit:100,reread:false,manual:false};
  return sptSelection;
}
const chosenDocument=(selection,doc)=>selection.overrides[doc.key]??doc.parts.some(p=>p.status!=='ready');
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
function stagePreview(wp,range,fresh,report,old,binding=null,items=queue,append=addEntry){
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
    append({wp,source:'sptdaftar',spt:'',period:range,proof,sptAssignment:binding?.scope||previewScope(),...(binding?{previewBinding:binding}:{})},{Payload:{Data:data.rows,...(zero?{TotalRecords:0}:{})}},'Daftar SPT Dilaporkan · halaman pratinjau '+(i+1),'Tabel tampak');
  }
  const first=items[items.length-fresh.length];
  for(const prior of old){
    if(prior.sptObservedParts)(first.sptObservedParts ||= []).push(...prior.sptObservedParts);
    if(prior.sptAutoChecks)(first.sptAutoChecks ||= []).push(...prior.sptAutoChecks);
    if(prior.sptResultId)first.sptResultId=prior.sptResultId;
    if(prior.sptLegacyNotes)first.sptLegacyNotes=prior.sptLegacyNotes;
    if(prior.sptAssignment)first.sptAssignment=prior.sptAssignment;
    items.splice(items.indexOf(prior),1);
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
async function previewFromTab(force=false,resumeId=null,home=null){
  if(busy || autoSpt || paging || batch.active || otherSources.active)throw Error('Selesaikan pembacaan yang sedang berjalan.');
  const {plan}=prepare({preview:true,allowEmpty:true});
  home ||= await findHomeTab();
  if(!ext || !home && !checked('sources').includes('sptdaftar'))return showPreview();
  const wp=plan.wp,range=period(),types=checked('forms').join('|');
  const previewIndex=checked('sources').some(s=>s==='sptdaftar'||s==='sptisi');
  if(!types && previewIndex)throw Error('Pilih sedikitnya satu jenis SPT pada bagian Data yang ditarik.');
  const matching=queue.filter(e=>e.wp===wp && e.period===range && e.source==='sptdaftar');
  const saveProgress=$('preview-save').checked;
  if(!home && matching.length && !force && !(saveProgress && matching.some(e=>e.proof?.daftarPratinjau && !e.previewBinding)))return showPreview();
  const limit=Number(val('preview-index-limit'));
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Pilih batas 1–100 halaman untuk pratinjau daftar.');
  const status=$('preview-read-status'),actions=$('preview-read-actions'),selectedAtStart=val('tab');
  const scope=previewScope(),sourceSelection=checked('sources').join('|');
  const check=()=>{
    if(!sameScope(scope,previewScope()) || !$('consent').checked || sourceSelection!==checked('sources').join('|') || saveProgress&&!$('preview-save').checked)
      throw Error('WP, pernyataan kerahasiaan atau pilihan data berubah. Buka kembali pratinjau.');
  };
  await navigator.locks.request('scv2-spt-navigation',{ifAvailable:true},async lock=>{
    if(!lock || autoSpt)throw Error('Tunggu sampai pembacaan SPT yang sedang berjalan selesai.');
    check();autoSpt=true;jobButtons();renderPreviewRecovery();const checkpoint=sptPlayback(actions,status,check),fresh=[];
    let writer=null,storageError='',keptSaved=false;
    const owned=new Set(),profileItems=[];
    try{
      status.textContent='Mencari daftar SPT Dilaporkan untuk WP yang dipilih…';
      const tab=home?await verifiedHomeDirectory(home,wp,checkpoint,owned):await findSubmittedTab(ext,wp,chosenPreviewTab,checkpoint);
      if(!tab){status.textContent='';if(force)throw Error('Tab daftar SPT Dilaporkan belum ditemukan.');return showPreview();}
      if(home){
        await collectHomeSources({ext,origin:coretax,tabId:tab.id,wp,period:range,sources:['info','klu'],types:checked('forms'),items:profileItems,checkpoint,
          enqueue:(info,page,name,origin)=>appendCapture(profileItems,wp,info,page,name,origin)});
        if(!previewIndex){showPreview(profileItems);status.textContent='NPWP ditemukan. Klik Mulai tarik untuk membaca sumber pilihan.';return;}
      }
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
      if(!home){
        if(![...$('tab').options].some(o=>o.value===String(tab.id)))$('tab').add(new Option('Tab daftar SPT Dilaporkan',String(tab.id)));
        $('tab').value=String(tab.id);tables=[];$('table-pick').hidden=true;
      }
      renderQueue();showPreview(profileItems,Boolean(home));
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
      await closeWorkTabs(owned);
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
  Object.assign(captureSelection(),{limit:100,indexLimit:100,reread:false});
  const home=await findHomeTab();
  if(home){otherSources.invalidate();return previewFromTab(false,null,home);}
  const shown=await otherSources.scan();
  if(shown && !inPeriod.length && !checked('sources').includes('sptdaftar'))return;
  try{await previewFromTab();}
  catch(error){
    if(!shown || inPeriod.length || !error.message.startsWith('Tambahkan tabel atau berkas'))throw error;
  }
}
function showSptPlan(box,{counts,documents},fromHome=false) {
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
    const navigate=Boolean(ext && checked('sources').includes('sptisi')),selection=captureSelection();
    const pageLimit=document.createElement('input'),reread=document.createElement('input');
    if(navigate){
      pageLimit.type='number';pageLimit.min='1';pageLimit.max='100';pageLimit.value=selection.limit;
      if(fromHome&&!selection.customPartLimit){pageLimit.value='';pageLimit.placeholder='Semua halaman';}
      pageLimit.oninput=()=>{selection.customPartLimit=Boolean(pageLimit.value);selection.limit=pageLimit.value?Number(pageLimit.value):100;};
      const label=document.createElement('label');label.append('Halaman maksimal per bagian SPT'+(fromHome?' (opsional)':''),pageLimit);panel.append(label);
      const pagingHint=document.createElement('p');
      pagingHint.textContent='Pembacaan dimulai dari halaman yang tampil. Penarik dapat memakai kembali cuplikan yang mencakup awal hingga akhir tampilan atau ekspor dengan jumlah baris terverifikasi.';
      reread.type='checkbox';reread.checked=selection.reread;
      const fullLabel=document.createElement('label');fullLabel.append(reread,' Ambil ulang semua bagian versi yang dipilih');
      panel.append(pagingHint,fullLabel);
    }
    if(ext && !navigate){
      const instructions=document.createElement('p');
      instructions.textContent='Untuk mencari induk atau lampiran di Coretax, centang Induk dan lampiran SPT lalu buka kembali pratinjau.';
      panel.append(instructions);
    }
    const labels=new Map(forms),selected=new Map(),controls=new Map();
    function updateSelected(){
      selected.clear();
      for(const d of documents){
        const on=chosenDocument(selection,d);
        if(on)selected.set(d.key,d);
        if(controls.has(d.key))controls.get(d.key).checked=on;
      }
    }
    updateSelected();
    const picked=document.createElement('span');
    const updatePicked=()=>{picked.textContent=selected.size+' dari '+documents.length+' versi dipilih. '+cursor+' versi ditampilkan.';};
    if(navigate){
      const directoryLimit=document.createElement('input');
      directoryLimit.type='number';directoryLimit.min='1';directoryLimit.max='100';directoryLimit.value=selection.indexLimit;
      directoryLimit.oninput=()=>{selection.indexLimit=Number(directoryLimit.value);};
      reread.onchange=()=>{selection.reread=reread.checked;selection.manual=false;updateSelected();updatePicked();};
      const label=document.createElement('label');label.append('Halaman maksimal untuk mencari versi di daftar',directoryLimit);
      const hint=document.createElement('p');
      hint.textContent='Pilihan mencakup seluruh daftar dalam periode ini. Hapus centang pada versi yang ingin dilewati.';
      if(!fromHome)panel.append(label);
      panel.append(hint,picked);
      if(!fromHome)panel.append(batchSptControls(selected,pageLimit,directoryLimit,reread));
    }
    const body=captureTable(panel,'Versi SPT yang ditemukan',['Jenis SPT','Masa atau tahun','Pembetulan','Bagian tersedia','Perlu diambil','Perlu diulang',...(navigate?fromHome?['Pilih']:['Pilih','Tampilan Coretax']:[])]);
    let cursor=0;
    const more=button('Tampilkan versi berikutnya',appendRows);
    function appendRows() {
      const end=Math.min(cursor+100,documents.length);
      for(;cursor<end;cursor++) {
        const doc=documents[cursor];
        const parts=status=>doc.parts.filter(part=>part.status===status).map(part=>part.name).join(', ') || '—';
        const nav=navigate&&!fromHome?sptViewControls(doc,pageLimit,reread):null;
        let choice;
        if(navigate){
          choice=document.createElement('input');choice.type='checkbox';
          choice.setAttribute('aria-label','Pilih '+(labels.get(doc.type)||doc.type)+' · '+doc.period+' · pembetulan '+doc.revision);
          choice.checked=selected.has(doc.key);controls.set(doc.key,choice);
          choice.onchange=()=>{selection.overrides[doc.key]=choice.checked;selection.manual=false;
            if(choice.checked)selected.set(doc.key,doc);else selected.delete(doc.key);updatePicked();};
        }
        captureRow(body,[labels.get(doc.type) || doc.type,doc.period,doc.revision,parts('ready'),parts('pending'),parts('retry'),
          ...(navigate?nav?[choice,nav]:[choice]:[])]);
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
    part:result.part,label:result.label,docKey:doc.key,...(result.identityBasis?{dasarIdentitas:result.identityBasis}:{})};
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
function sptPageSink(doc,wp,range,status,{items=queue,append=addEntry,assignment=previewScope()}={}){
  let pages=0,previous=null,first=null,reused=0;
  const observed=new Set(),issues=[];
  const index=items.find(e=>e.source==='sptdaftar' && e.wp===wp && e.period===range);
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
      append(info,page,result.label+' · halaman pengambilan '+result.page,'Tabel tampak');
      const entry=items.at(-1);first ||= entry;
      if(previous?.proof.urutan.id===result.pass)delete previous.proof.morePagesAvailable;
      previous=entry;pages++;observed.add(result.part);if(items===queue)renderQueue();
      status.textContent=result.label+' · halaman '+result.page+' tersimpan.';
    },
    onIssue(section,error){remember(section.part,true);issues.push(section.label+' · '+sptErrorText(error));},
    finish(error){
      if(error)issues.push(sptErrorText(error));
      const note=[observed.size+' bagian dan '+pages+' halaman terbaca.',...(reused?[reused+' bagian dari antrean dipakai kembali.']:[]),...issues].join(' ');
      if(issues.length){
        const source=first || index;
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
async function collectVersions({tab,wp,bounds,docs,parts,limit,indexLimit,checkpoint,createSink,status,allowLinkedReturn=false}){
  const directory=await sptDirectory(ext,tab.id,wp,{expectedUrl:tab.url});
  const candidates=docs.map(doc=>({doc,navigation:sptNavigation({ext,wp,period:bounds,doc,allowLinkedReturn})}));
  return collectSptQueue({directory,candidates,tabId:tab.id,limit,indexLimit,checkpoint,
    createSink:c=>({...createSink(c.doc),skipParts:parts.get(c.doc.key)}),
    onOpen:c=>{status.textContent='Membuka SPT '+c.doc.period+' · pembetulan '+c.doc.revision+'…';}});
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
        captureSelection().manual=true;
        const tab=await tabNow();
        const result=await collectVersions({tab,wp,bounds,docs,parts,limit,indexLimit,checkpoint,status,
          createSink:doc=>sptPageSink(doc,wp,range,status)});
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
          captureSelection().manual=true;
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
      const skipParts=currentSptParts([doc],reread.checked).get(doc.key);captureSelection().manual=true;
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
  $('pack-queue').disabled = disabled || paging || batch.active || otherSources?.active;
  $('pause').hidden = !busy; $('pause').textContent = paused ? 'Lanjutkan' : 'Jeda';
  $('stop').hidden = !busy; $('progress').hidden = !busy;
  for (const b of $('pending-jobs').querySelectorAll('button')) b.disabled=busy;
}
// Earlier versions kept one plan per WP and advanced a cursor after saving each result.
function pendingPlans(record) {
  return record.plan ? [record.plan] : record.plans.slice(record.cursor);
}
function liveSettings(){
  return JSON.stringify([val('ids'),val('tab'),val('officer'),val('nip'),val('letter'),val('date'),val('basis'),val('role'),
    val('year-start'),val('year-end'),val('month-start'),val('month-end'),checked('sources'),checked('forms'),
    $('dedupe').checked,$('ledger-cancel').checked,sptSelection]);
}
function checkJobAssignment(job){
  if(!job.acquisition)return;
  if(!$('consent').checked)throw Error('Periksa penugasan dan centang pernyataan kerahasiaan sebelum melanjutkan.');
  const opts=job.meta.opsi;
  if(!val('ids') || !sameScope(previewScope(),job.acquisition.scope) ||
      JSON.stringify(checked('sources'))!==JSON.stringify(opts.sumber) ||
      opts.sumber.some(s=>s==='bb'||s==='bbtotal') && $('ledger-cancel').checked!==Boolean(opts.bbBatal) ||
      $('dedupe').checked!==opts.lewatiDuplikat)
    throw Error('Penugasan atau pilihan data berbeda dari tarikan tersimpan. Gunakan Muat penugasan tersimpan dan periksa kembali pilihan sebelum melanjutkan.');
}
async function acquireJob(job,persist){
  const owned=new Set();
  try{return await readJobSources(job,persist,owned);}
  finally{await closeWorkTabs(owned);}
}
async function readJobSources(job,persist,owned){
  const state=job.acquisition,{scope,selection}=state,{wp,entries}=job.plan;
  const {sumber,jenisSpt,periode}=job.meta.opsi,status=$('status');
  const initial=liveSettings();
  let session;
  const checkpoint=async(force=false)=>{
    do{
      if(initial!==liveSettings()||!$('consent').checked)throw Object.assign(Error('Penugasan atau pilihan sumber berubah. Buka kembali tarikan yang tersimpan.'),{code:'SCOPE'});
      if(stop)throw Object.assign(Error('Pembacaan dihentikan.'),{code:'STOP'});
      if(paused)await sleep(100);
    }while(paused);
    if(session){
      await session.checkpoint(force===true);
      if(session.fingerprint)state.homeAccountFingerprint=session.fingerprint;
    }
  };
  const append=(info,page,name,origin)=>appendCapture(entries,wp,info,page,name,origin);
  const savePage=async(...args)=>{await checkpoint();append(...args);await persist();};
  const replacePages=async(previous,...args)=>{
    await checkpoint();
    if(!previous.length||previous.some(item=>!entries.includes(item)))throw Error('Kemajuan tersimpan berubah ketika membaca ulang sumber.');
    const replacement=[];
    appendCapture(replacement,wp,...args);
    const before=entries.slice(),next=entries.flatMap(item=>item===previous[0]?replacement:previous.includes(item)?[]:[item]);
    entries.splice(0,entries.length,...next);
    try{await persist();}catch(error){entries.splice(0,entries.length,...before);throw error;}
  };
  await checkpoint();
  if(!ext||!state.route&&entries.length&&entries.every(e=>e.origin==='Ekspor lokal')&&!(await ext.tabs.query({url:coretax+'/*'})).length)return;
  const home=await findHomeTab();
  let homeDirectory=null;
  if(home || state.fromHome){
    if(!home)throw Error('Untuk melanjutkan, buka beranda Coretax dan login kembali dengan akun penugasan.');
    const plan=planHomeCapture({wp,period:periode,sources:sumber,types:jenisSpt});
    session=await watchHomeAccount({ext,homeTabId:home.id,expectedFingerprint:state.homeAccountFingerprint});
    await checkpoint(true);
    state.fromHome=true;
    job.meta.opsi.metode='Penarikan dari beranda Coretax';
    status.textContent='Mencari NPWP penugasan di Coretax…';
    homeDirectory=await verifiedHomeDirectory(home,plan.wp,checkpoint,owned);
    await checkpoint();
  }
  if(!state.otherDone || homeDirectory && state.retryOther){
    status.textContent=homeDirectory?'Membaca sumber pilihan untuk WP yang ditemukan…':'Mencocokkan sumber terpilih dengan tab Coretax yang terbuka…';
    const other=homeDirectory
      ? await collectHomeSources({ext,origin:coretax,tabId:homeDirectory.id,wp,period:scope.period,sources:sumber.filter(s=>s!=='bplawan'),types:jenisSpt,items:entries,checkpoint,enqueue:savePage,replace:replacePages,includeCancelled:job.meta.opsi.bbBatal})
      : await otherSources.collectSelected({scope:{wp,period:scope.period,sources:sumber,
        assignment:[scope.role,scope.basis,scope.letter,scope.date,scope.officer,scope.nip]},items:entries,checkpoint,enqueue:savePage});
    state.issues=other.issues||[];
    if(homeDirectory && sumber.includes('bplawan')){
      status.textContent='Membaca laporan bukti potong yang diterima WP…';
      const slips=await collectHomeWithholding({ext,homeTab:home,wp,period:scope.period,items:entries,checkpoint,enqueue:savePage,replace:replacePages,onTab:id=>owned.add(id)});
      state.issues.push(...slips.issues);
    }
    state.otherDone=true;state.retryOther=Boolean(homeDirectory && state.issues.length);
    otherSources.invalidate();
  }
  if(!selection.manual&&ext&&(sumber.includes('sptdaftar')||homeDirectory&&sumber.includes('sptisi'))){
    await navigator.locks.request('scv2-spt-navigation',{ifAvailable:true},async lock=>{
      if(!lock)throw Error('Pembacaan SPT sedang berjalan di tab lain.');
      await checkpoint();status.textContent='Mencari daftar SPT Dilaporkan untuk WP penugasan…';
      let tab;
      try{tab=homeDirectory||await findSubmittedTab(ext,wp,chosenPreviewTab,checkpoint);}
      catch(error){
        if(error.code||state.route||!entries.length||entries.some(e=>e.origin!=='Ekspor lokal'))throw error;
        state.issues.push('Daftar SPT pada tab terbuka belum cocok dengan WP penugasan. Berkas ekspor yang sudah ditambahkan tetap digunakan.');
        return;
      }
      if(!tab){
        if(state.route)throw Error('Buka kembali daftar SPT Dilaporkan untuk melanjutkan pembacaan yang tersimpan.');
        return;
      }
      const route=new URL(tab.url).pathname;
      const old=()=>entries.filter(e=>e.source==='sptdaftar'&&e.proof?.daftarPratinjau);
      if(state.route && state.route!==route || old().some(e=>e.previewBinding&&e.previewBinding.route!==route))
        throw Error('Alamat daftar berbeda dari sumber pada tarikan ini.');
      state.route=route;
      const stage=(pages,report)=>stagePreview(wp,scope.period,pages,report,old(),{scope,route},entries,append);
      if(entries.some(e=>e.source==='sptdaftar'&&!e.proof?.daftarPratinjau))state.indexDone=true;
      if(state.indexProgress?.pages.length){stage(state.indexProgress.pages,state.indexProgress.report);delete state.indexProgress;}
      if(!state.indexDone){
        const pages=[];
        const report=await readSubmittedPreview(ext,tab,wp,{limit:homeDirectory?Infinity:state.previewLimit,checkpoint,onPage:async(data,progress)=>{
          await checkpoint();pages.push(data);
          state.indexProgress={pages,report:{...progress,toLast:false,note:'Pembacaan daftar sedang berjalan.'}};
          await persist();status.textContent=progress.pages+' halaman daftar SPT telah dibaca.';
        }});
        if(pages.length){stage(pages,report);delete state.indexProgress;await persist();}
        await checkpoint();
        // Reconfirm ownership after partial pagination, before accepting the snapshot.
        await sptDirectory(ext,tab.id,wp,{expectedUrl:tab.url,previewIndex:true});
        state.indexDone=true;
      }
      if(!sumber.includes('sptisi'))return;
      const {documents}=planSptDetails({wp,period:periode,types:jenisSpt,items:entries,strictReceipts:true});
      const docs=documents.filter(doc=>chosenDocument(selection,doc));
      if(!docs.length)return;
      const parts=new Map(docs.map(d=>[d.key,new Set(selection.reread?[]:d.parts.filter(p=>p.status==='ready').map(p=>p.name))]));
      const result=await collectVersions({tab,wp,bounds:periode,docs,parts,limit:homeDirectory&&!selection.customPartLimit?Infinity:selection.limit,indexLimit:homeDirectory?Infinity:selection.indexLimit,checkpoint,status,allowLinkedReturn:Boolean(homeDirectory),
        createSink:doc=>{
          const sink=sptPageSink(doc,wp,scope.period,status,{items:entries,append,assignment:scope});
          return {...sink,onPage:async data=>{await checkpoint();sink.onPage(data);await persist();}};
        }});
      if(result.problem&&['IDENTITY','STOP','SCOPE','HOME_ACCOUNT'].includes(result.problem.code))throw result.problem;
      await checkpoint();
    }).catch(error=>{
      if(!homeDirectory||error.code||state.indexProgress?.pages?.length)throw error;
      state.issues.push('SPT · '+sptErrorText(error));
    });
  }
  await checkpoint(true);
  for(const id of sumber){
    if(supportedSources.includes(id)||entries.some(e=>e.source===id))continue;
    state.issues.push(sources[id]+' belum tersedia dalam hasil pembacaan untuk WP dan periode ini.');
  }
  job.liveChecks=[...new Set(state.issues)].map(pesan=>({tingkat:'SEDANG',kode:'SUMBER-TARIKAN',pesan}));
  if(state.fromHome&&!state.homeAccountFingerprint)job.liveChecks.push({tingkat:'INFO',kode:'AKUN',pesan:'Nama penarik diisi pada penugasan. Identitas akun pada beranda belum dapat dibaca.'});
}
async function run(resume,{queueOnly=false}={}) {
  if (busy || paging || autoSpt || batch.active || otherSources.active) return;
  await navigator.locks.request('scv2-capture-job',{ifAvailable:true},async lock => {
    if (!lock) throw new Error('Tarikan sedang berjalan pada tab penarik lainnya.');
    if (busy || paging || autoSpt || batch.active || otherSources.active) return;
    busy = true; paused = false; stop = false;
    try {
      renderQueue();
      await refresh();
      let job,plan,persisted=Boolean(resume);
      if (resume) {
        job=stored.find(r=>r.kind==='job' && r.id===resume.id && r.runId===resume.runId);
        plan=job && pendingPlans(job).find(p=>p.wp===resume.wp);
        if(!plan) throw Error('Tarikan ini sudah diselesaikan atau dihapus pada tab lain.');
      } else {
        const prepared=prepare({allowEmpty:!queueOnly}),scope=previewScope(),selection=structuredClone(captureSelection());
        if(!checked('sources').length)throw Error('Pilih sedikitnya satu sumber data.');
        const previewLimit=Number(val('preview-index-limit'));
        if(!queueOnly&&[selection.limit,selection.indexLimit,previewLimit].some(n=>!Number.isInteger(n)||n<1||n>100))
          throw Error('Pilih batas 1–100 halaman untuk daftar dan bagian SPT.');
        plan={wp:scope.wp,entries:structuredClone(prepared.inPeriod)};
        if(stored.some(r=>r.kind==='job' && pendingPlans(r).some(p=>p.wp===plan.wp))) throw Error('Ada tarikan tersimpan untuk NPWP ini. Pilih Lanjutkan pada tarikan tersebut.');
        const id=crypto.randomUUID();
        job={id,runId:id,kind:'job',plan,meta:{...prepared.meta,periode:scope.period,opsi:{...prepared.meta.opsi,
          periode:{from:{y:Number(val('year-start')),m:Number(val('month-start'))},to:{y:Number(val('year-end')),m:Number(val('month-end'))}}}},
          acquisition:{scope,selection,previewLimit,issues:[],complete:queueOnly}};
      }
      const persist=async()=>{
        if(!plan.entries.length&&!job.acquisition?.indexProgress?.pages.length)return;
        await vault.save([{id:job.id,value:job}],persisted?null:'Mulai tarik',{jumlahWP:1,penarik:job.meta.penarik.nama,dasar:job.meta.penugasan.nomor,npwp:plan.wp});
        persisted=true;
      };
      let packagingSession=null;
      if(job.acquisition){
        checkJobAssignment(job);
        try{if(!job.acquisition.complete)await acquireJob(job,persist);}
        catch(error){
          await persist();
          if(error.code==='STOP'){$('status').textContent=persisted?'Pembacaan dihentikan. Kemajuan tersimpan dan dapat dilanjutkan.':'Pembacaan dihentikan sebelum ada sumber yang tersimpan.';return;}
          throw error;
        }
        const selected=plan.entries.filter(e=>job.meta.opsi.sumber.includes(e.source));
        if(!selected.length)throw Error(job.acquisition.fromHome?
          (job.acquisition.issues.join(' ')||'Sumber pilihan belum menghasilkan data yang dapat diverifikasi di Coretax.'):
          'Tambahkan tabel atau berkas yang sesuai dengan WP, periode, dan sumber terpilih.');
        if(!selected.some(e=>selectSptListRows(e,job.meta.opsi.jenisSpt)))throw Error('Tidak ada baris untuk jenis SPT terpilih.');
        job.acquisition.complete=true;await persist();
        if(job.acquisition.fromHome && job.acquisition.homeAccountFingerprint){
          const home=await findHomeTab();
          if(!home)throw Error('Buka beranda Coretax dengan akun penugasan untuk melanjutkan tarikan.');
          packagingSession=await watchHomeAccount({ext,homeTabId:home.id,expectedFingerprint:job.acquisition.homeAccountFingerprint});
        }
      }
      jobButtons();
      const seen = new Set(), ledgerCopies=new Map(), ledgerNotes=new Map(), grouped = new Map(), sections=new Map(), checks=[...(job.liveChecks||[])],indexReports=new Set();
      const progress=$('progress'); progress.max=plan.entries.length; progress.value=0;
      for (const queued of plan.entries) {
        if(job.meta.opsi.sumber && !job.meta.opsi.sumber.includes(queued.source))continue;
        while (paused && !stop) {checkJobAssignment(job);await sleep(100);}
        if(stop) break;
        checkJobAssignment(job);
        if(queued.wp!==plan.wp) throw Error('Antrean tersimpan memuat sumber untuk WP yang berbeda.');
        if(queued.source==='bb' || queued.source==='bbtotal'){
          checkIdentity(rowsOf(queued.page),plan.wp);checkLedgerScope(queued,queued.page);
        }
        const source=selectLedgerRows(selectSptListRows(queued,queued.spt?[queued.spt]:job.meta.opsi.jenisSpt || forms.map(([code])=>code)),job.meta.opsi.bbBatal);
        const indexReport=queued.proof?.daftarPratinjau;
        if(indexReport && !indexReports.has(indexReport.id)){
          checks.push({tingkat:indexReport.note || indexReport.filtered?'SEDANG':'INFO',kode:'DAFTAR-SPT-PRATINJAU',pesan:describeSubmitted(indexReport)});
          indexReports.add(indexReport.id);
        }
        for(const note of queued.sptAutoChecks || [])if(job.meta.opsi.jenisSpt?.includes(note.type))
          checks.push({tingkat:'SEDANG',kode:'SPT-TAMPILAN',pesan:note.pesan});
        progress.value++;
        if(!source) continue;
        if(source.proof?.dariBeranda)verifyHomeRowOwners(rowsOf(source.page),{source:source.source,wp:plan.wp});
        else checkIdentity(rowsOf(source.page),plan.wp);
        const sptTracked=stageSptSource(sections,source,plan.wp);
        let ledgerKey;
        if(source.ledgerSelection){
          const selection=source.ledgerSelection;
          const insufficient=selection.cakupanOpsi!=='sesuai' && (selection.jenis==='total' || selection.ikutkanBatal || selection.filterPembatalanSumber==='batal');
          if(selection.tidakDiketahui || selection.konflikStatus || insufficient || selection.filterLainPadaSumber){
            const note=selection.jenis==='total'?'Periksa filter sumber total pembanding buku besar.':
              'Periksa status pembatalan dan filter pada rincian sumber buku besar.';
            ledgerNotes.set(note,{tingkat:'SEDANG',kode:'BUKU-BESAR-FILTER',pesan:note});
          }
          if(job.meta.opsi.lewatiDuplikat){
            const contents=rowsOf(source.page).map(r=>Object.entries(r||{}).sort(([a],[b])=>a<b?-1:a>b?1:0));
            ledgerKey=await vault.digest(JSON.stringify([packagePath(source),contents,source.page.IsSuccessful ?? null,source.page.Errors ?? null]));
          }
        }else if(!sptTracked) {
          const observed=source.proof?.dariBeranda;
          const key=await vault.digest(JSON.stringify([source.source,source.spt,source.detailProof?.docKey,source.detailProof?.part,
            ...(observed?[packagePath(source),observed.bagian]:[]),
            ...(source.proof?.daftarPratinjau&&source.proof.rentangDaftar?[source.proof.rentangDaftar]:[]),source.page]));
          if(seen.has(key) && job.meta.opsi.lewatiDuplikat) continue;
          seen.add(key);
        }
        const reported=source.ledgerSelection?.totalDilaporkanSumber ?? source.sptSelection?.totalDilaporkanSumber ?? source.total;
        const received=source.ledgerSelection?.barisSumber ?? source.sptSelection?.barisSumber ?? source.rows;
        if(reported!=null && reported!==received) {
          const issue={tingkat:'TINGGI',pesan:sources[source.source]+' melaporkan '+reported+' baris. Yang diterima '+received+'.'};
          checks.push(issue); message(plan.wp+' · '+issue.pesan,true);
        }
        if(!sptTracked){
          const previous=ledgerCopies.get(ledgerKey);
          if(previous){
            (previous.entry.cap.sumberSalinanIdentik ||= []).push({halamanAsal:previous.page,asal:source.name,metode:source.origin,pemilihanBukuBesar:source.ledgerSelection});
            continue;
          }
          const entry=appendPackageEntry(grouped,source,plan.wp);
          if(ledgerKey)ledgerCopies.set(ledgerKey,{entry,page:entry.pages.length});
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
      checkJobAssignment(job);
      checks.push(...ledgerNotes.values());
      finishSptSources(sections,grouped,checks,job.meta.opsi.lewatiDuplikat);
      checks.push(...remainingSptChecks(plan.entries,plan.wp,job.meta.opsi));
      if(plan.entries.some(e=>e.sptLegacyNotes))checks.push({tingkat:'INFO',kode:'SPT-CATATAN-LAMA',
        pesan:'Hasil sebelumnya memuat catatan pengambilan SPT tanpa identitas bagian terstruktur. Periksa catatan pada hasil semula.'});
      if(!grouped.size)throw Error('Antrean ini tidak memuat baris untuk jenis SPT yang dipilih. Ambil kembali daftar dengan pilihan jenis yang sesuai.');
      const entries=[...grouped.values()], name=taxpayerName(plan.entries);
      for(const entry of entries){
        finishOpenTable(entry);
        await finishHomeTable(entry);
      }
      const meta={...metaForSelection(job.meta,plan.entries),wp:{npwp:plan.wp,...(name?{nama:name}:{})},dibuat:new Date().toISOString(),cek:checks};
      const remaining=pendingPlans(job).filter(p=>p!==plan);
      const pendingUpdate=remaining.length ? {id:job.id,value:{...job,plans:remaining,cursor:0}} : {id:job.id,remove:true};
      await packagingSession?.checkpoint(true);
      await vault.save([{id:crypto.randomUUID(),value:{kind:'result',meta,entries}},pendingUpdate],'Tarikan WP',{npwp:plan.wp,berkas:entries.length,dasar:meta.penugasan.nomor,penarik:meta.penarik.nama});
      const completed=new Set(plan.entries.filter(e=>selectSptListRows(e,job.meta.opsi.jenisSpt||forms.map(([code])=>code))).map(e=>e.id));
      for(let index=queue.length-1;index>=0;index--) {
        if(completed.has(queue[index].id)) queue.splice(index,1);
      }
      $('preview-box').replaceChildren();
      sptSelection=null;
      const missing=(job.meta.opsi.sumber||[]).filter(id=>!entries.some(e=>e.cap.sumber===id));
      $('status').textContent='Tarikan selesai untuk NPWP '+plan.wp+' · '+entries.length+' berkas tersimpan.'+
        (missing.length?' Sumber yang belum menghasilkan berkas: '+missing.map(id=>sources[id]).join(', ')+'.':'');
      for(const issue of job.liveChecks||[])if(issue.tingkat!=='INFO')message(issue.pesan,true);
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
function restoreAssignment(record){
  if(busy||paging||autoSpt||batch.active||otherSources.active)throw Error('Tunggu pembacaan yang sedang berjalan.');
  const {scope}=record.acquisition,opts=record.meta.opsi;
  if(queue.some(e=>e.wp!==scope.wp||e.previewBinding&&!sameScope(e.previewBinding.scope,scope)||e.sptAssignment&&!sameSptAssignment(e.sptAssignment,scope)))
    throw Error('Antrean aktif berbeda dari penugasan tersimpan. Selesaikan atau keluarkan sumber di antrean dahulu.');
  for(const key of ['role','basis','officer','nip','letter','date'])$(key).value=scope[key];
  $('ids').value=scope.wp;
  for(const [field,k] of [['start','from'],['end','to']]){
    $('year-'+field).value=String(opts.periode[k].y);$('month-'+field).value=String(opts.periode[k].m).padStart(2,'0');
  }
  for(const [id,allowed] of [['sources',opts.sumber],['forms',opts.jenisSpt]]){
    for(const input of $(id).querySelectorAll('input'))input.checked=allowed.includes(input.value);
  }
  $('dedupe').checked=opts.lewatiDuplikat;$('ledger-cancel').checked=Boolean(opts.bbBatal);
  $('consent').checked=false;$('preview-save').checked=false;sptSelection=null;
  idsChanged();sourceChanged();
  $('status').textContent='Penugasan dan pilihan tarikan tersimpan sudah dimuat. Periksa kembali dan centang pernyataan kerahasiaan sebelum melanjutkan.';
}
async function refresh() {
  stored = await vault.items();
  renderPreviewRecovery();
  const pending=$('pending-jobs');
  pending.replaceChildren();
  for(const record of stored.filter(r=>r.kind==='job')) {
    for(const plan of pendingPlans(record)) {
      line(pending,'Tarikan tersimpan · NPWP '+plan.wp+' · '+plan.entries.length+' sumber',[
        ...(record.acquisition?[button('Muat penugasan tersimpan',()=>restoreAssignment(record))]:[]),
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
  $('ledger-cancel').checked=preferences.bbBatal===true;
  function savePreferences() {
    const prefs=Object.fromEntries(preferenceFields.map(id=>[id,val(id)]));
    localStorage.setItem(preferenceKey,JSON.stringify({...prefs,sources:checked('sources'),forms:checked('forms'),dedupe:$('dedupe').checked,bbBatal:$('ledger-cancel').checked}));
  }
  for(const id of [...preferenceFields,'sources','forms','dedupe','ledger-cancel']) action(id,savePreferences,'change');
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
  for (const id of ['consent','dedupe','ledger-cancel']) action(id,scopeChanged,'change');
  action('tab',() => {chosenPreviewTab=Number(val('tab'));tables=[]; $('table-pick').hidden=true; $('scope-ok').checked=false;},'change');
  action('recheck',checkTabs); action('open-coretax',() => ext.tabs.create({url:coretax+'/home/id-ID/'}));
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
  action('preview',previewSelectedSources); action('start',() => run()); action('pack-queue',()=>run(null,{queueOnly:true}));
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
