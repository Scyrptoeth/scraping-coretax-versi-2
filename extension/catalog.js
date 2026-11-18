import {kbli} from './catalog-data.js';
import {lookupKbliCorrespondence} from './kbli-correspondence.js';
import {publicGuide} from './probis-guide.js';
import {kluAttachment,kluZ} from './klu-z.js';
import {codeTitle,hierarchicalKlu,percentage} from './klu-calculator.js';
import {regulations} from './regulation-data.js';
import {regulationDetails} from './regulation-details.js';
import {emptyFilters,filterRegulations,prepareRegulations,regulationCells,regulationColumns,regulationTypes} from './regulation-filters.js';
import {rowsOf} from './analisis/model.js';
import {el, box, button, field, select, card, download, showDialog, toggleSet, notice} from './analisis/ui.js';
import {createXlsx} from './archive/table.js';
import {createDocx} from './archive/document.js';
import {activityResult,taxpayerKinds} from './analisis/business-work.js';
export {activityResult} from './analisis/business-work.js';

const sourceKBLI = 'https://klasifikasi.web.bps.go.id/app/kbli';
const sourceKLU = 'https://www.pajak.go.id/id/peraturan/klasifikasi-lapangan-usaha-wajib-pajak-2';
const levels = ['Semua tingkat','Kategori','Golongan pokok','Golongan','Subgolongan','Kelompok'];
const assigned = new WeakMap();
const normalize = text => String(text ?? '').toLocaleLowerCase('id').trim();

function link(label, url) {
  const a = el('a', label);
  a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  return a;
}

function exportBar(title, headings, items) {
  const rows = [headings, ...items];
  async function save(format) {
    try {
      const file = format === 'xlsx' ? await createXlsx({sheets:[{name:'Hasil',rows}]})
        : await createDocx({title,tables:[{title:'Hasil pencarian',rows}]});
      download(file, title + '.' + format);
    } catch (error) { notice(error.message, true); }
  }
  return box('toolbar',button('Excel',()=>save('xlsx')),button('Word',()=>save('docx')),
    button('Cetak / PDF',()=>{
      const table=el('table');
      for(const [index,values] of rows.entries()){
        const tr=el('tr');
        for(const text of values) tr.append(el(index ? 'td' : 'th',text));
        table.append(tr);
      }
      const body=box('print-catalog',el('h1',title),table);
      const dialog=document.getElementById('dialog'),wasOpen=dialog?.open;
      if(wasOpen)dialog.close();
      document.body.append(body); document.body.classList.add('print-catalog-active');
      try { window.print(); } finally { body.remove();document.body.classList.remove('print-catalog-active');if(wasOpen)dialog.showModal(); }
    }));
}

function registryList(container, config) {
  const search = el('input'); search.type='search';search.placeholder=config.placeholder;
  search.value=config.query || '';
  const results=box('card'), filters=box('toolbar',field('Kata kunci',search));
  const values=Object.fromEntries(config.filters.map(f=>[f.key,f.initial || '']));
  let page=0;
  for (const f of config.filters) filters.append(select(f.options,values[f.key],value=>{
    values[f.key]=value; page=0; render();
  },f.label));
  for (const f of config.dates || []) {
    const input=el('input'); input.type='date';
    input.oninput=()=>{values[f.key]=input.value;page=0;render();};
    filters.append(field(f.label,input));
  }
  function render() {
    const terms=normalize(search.value).split(/\s+/).filter(Boolean);
    const rows=config.rows.filter(row=>config.filter(row,values) && terms.every(term=>row.lookup.includes(term)));
    const size=30, last=Math.max(0,Math.ceil(rows.length/size)-1);
    page=Math.min(page,last);
    const table=el('table'), header=el('tr'), thead=el('thead'), tbody=el('tbody');
    for(const col of config.columns) header.append(el('th',col));
    thead.append(header); table.append(thead,tbody);
    for(const row of rows.slice(page*size,(page+1)*size)) {
      const tr=el('tr');
      row.cells.forEach((value,i)=>{const td=el('td');td.append(i===0?button(value,()=>config.open(row)):document.createTextNode(value));tr.append(td);});
      tbody.append(tr);
    }
    const prev=button('Sebelumnya',()=>{page--;render();});prev.disabled=page===0;
    const next=button('Berikutnya',()=>{page++;render();});next.disabled=page>=last;
    results.replaceChildren(el('p',rows.length.toLocaleString('id-ID')+' hasil'),
      ...(rows.length?[exportBar(config.title,config.columns,rows.map(r=>r.cells)),box('scroll',table),
        box('pager',prev,el('span',`Halaman ${page+1} dari ${last+1}`),next)]:[el('p','Coba kata kunci lain atau longgarkan filter.')]));
  }
  search.oninput=()=>{page=0;render();};
  container.append(filters,results);render();
}

const allCodes=Object.entries(kbli).flatMap(([year,records])=>Object.entries(records).map(([code,title])=>({
  year,code,title,cells:[code,title,year,levels[code.length]],lookup:normalize(code+' '+title+' '+year)
}))).sort((a,b)=>b.year.localeCompare(a.year)||a.code.localeCompare(b.code));
const zEdition='KLU Z';
const zRecords=Object.fromEntries(Object.values(kluZ).map(r=>[r.code,{...r,year:zEdition,
  cells:[r.code,r.title,zEdition,levels[r.code.length]],lookup:normalize(r.code+' '+r.title+' '+zEdition+' PER-12/PJ/2022')}]));
const businessCodes=[...allCodes,...Object.values(zRecords)];
const allRegs=prepareRegulations(regulations,regulationDetails);

function calculator(scope) {
  const previous=scope?.business?.activity;
  const entries=box(''),kind=select(taxpayerKinds,previous?.kind||taxpayerKinds[0],()=>{out.textContent='';},'Jenis WP');
  const edition=select([['auto','Otomatis dari kode dan uraian'],['2020','KBLI 2020'],['2025','KBLI 2025']],previous?.edition||'auto',()=>{out.textContent='';},'Edisi KBLI untuk uji');
  const out=box('stack');out.setAttribute('role','status');
  function add(initial={}) {
    const code=el('input'),name=el('input'),amount=el('input');amount.inputMode='numeric';
    code.value=initial.code||'';name.value=initial.name||'';amount.value=initial.amount||'';
    code.maxLength=5;code.placeholder='Misalnya 28221';
    const row=box('toolbar',field('Kode kelompok',code),field('Nama kegiatan (opsional)',name),field('Peredaran bruto atau penghasilan (Rp)',amount));
    row.append(button('Hapus baris',()=>{row.remove();out.textContent='';}));entries.append(row);
  }
  function readActivities(){
    return [...entries.children].map(row=>{
      const [code,name,amount]=row.querySelectorAll('input');
      return {code:code.value.trim().toUpperCase(),name:name.value.trim(),amount:amount.value.trim()};
    }).filter(r=>r.code||r.name||r.amount);
  }
  function run(){
    const activities=readActivities();
    const taxpayerKind=kind.querySelector('select').value;
    if(taxpayerKind!=='WP dengan beberapa kegiatan'){
      out.replaceChildren(el('p',activityResult([],taxpayerKind)));return;
    }
    if(activities.length && activities.every(a=>!a.code && a.name)){
      out.replaceChildren(el('p',activityResult(activities,taxpayerKind)),
        el('p','Lengkapi kode kelompok setiap kegiatan untuk menghitung KLU secara berjenjang.'));return;
    }
    const result=hierarchicalKlu(activities,edition.querySelector('select').value);
    out.replaceChildren(el('p',result.message));
    if(result.edition&&result.steps.length)out.append(el('p','Edisi perhitungan · KBLI '+result.edition));
    if(!result.steps.length)return;
    out.append(el('p','Total nilai kegiatan · Rp'+result.total.toLocaleString('id-ID')));
    for(const step of result.steps){
      const node=el('details');node.open=true;
      node.append(el('summary',step.title+(step.winner?' · '+step.winner:'')));
      if(step.note)node.append(el('p',step.note));
      const table=el('table'),head=el('tr');
      for(const label of ['Kode atau cabang','Nilai (Rp)',step.divisionShare?'Persen dari golongan pokok':'Persen dari total'])head.append(el('th',label));
      table.append(head);
      for(const {code,amount} of step.candidates){
        const tr=el('tr'),title=codeTitle(code,result.edition);
        for(const value of [title?code+' · '+title:code,amount.toLocaleString('id-ID'),percentage(amount,step.base)])tr.append(el('td',value));
        table.append(tr);
      }
      node.append(box('scroll',table));out.append(node);
    }
  }
  if(previous?.activities.length)previous.activities.forEach(add);else{add();add();}
  entries.oninput=()=>{out.textContent='';};
  const saveControls=[],evidence=el('input'),conclusion=el('textarea');
  function saveResult(){
    try{
      scope.saveBusiness('activity',{kind:kind.querySelector('select').value,edition:edition.querySelector('select').value,
        activities:readActivities(),evidence:evidence.value.trim(),conclusion:conclusion.value.trim()});
      return true;
    }catch(e){notice(e.message,true);return false;}
  }
  if(scope){
    evidence.value=previous?.evidence||'';conclusion.value=previous?.conclusion||'';
    saveControls.push(field('Rujukan bukti kegiatan',evidence),field('Simpulan petugas atas KLU',conclusion),
      button('Simpan uji KLU ke kertas kerja',()=>{
        if(saveResult()){run();notice('Uji KLU tersimpan pada kertas kerja tahun '+scope.year+'.');}
      }));
    if(previous)run();
  }
  return card('Uji KLU utama',el('p','Masukkan kode kelompok KBLI atau KLU Z dan nilai bruto tiap kegiatan pada tahun sebelumnya. Gabungkan tahap kegiatan yang terintegrasi. Periksa ketentuan keluarga serta pusat dan cabang.'),
    ...(scope?[select(scope.years,scope.year,scope.changeYear,'Tahun pajak untuk uji KLU'),el('p','Tahun nilai kegiatan · '+(Number(scope.year)-1))]:[]),kind,edition,entries,
    box('toolbar',button('Tambah kegiatan',()=>{add();out.textContent='';}),button('Hitung',()=>{run();if(scope)saveResult();})),
    out,...saveControls,link('Contoh perhitungan berjenjang dalam lampiran DJP',kluAttachment+'#page=6'),link('Baca Pasal 4 dan 5 PER-12/PJ/2022',sourceKLU));
}


function requestPanel(row,scope){
  const guide=publicGuide(row.code),status=el('p');status.setAttribute('role','status');
  const years=select(scope.years,scope.year,scope.changeYear,'Tahun pajak untuk dokumen');
  const panel=card('Dokumen untuk penelusuran',years,el('p',guide.code+' · '+guide.check));
  if(!scope.groups.length){
    panel.append(el('p','Pada tahun ini belum ada indeks KKP yang dapat menerima dokumen.'));
    return panel;
  }
  let target='';
  const picker=select([['','Pilih indeks'],...scope.groups.map(g=>[g.key,g.ref+' · '+g.title])],'',v=>{target=v;update();},'Indeks KKP tujuan');
  const choices=guide.documents.map(([id,label])=>{
    const input=el('input');input.type='checkbox';input.addEventListener('change',update);
    return {id,input,control:field(label,input)};
  });
  const add=button('Tambahkan ke permintaan dokumen',()=>{
    try{
      const result=scope.add(row,target,choices.filter(c=>c.input.checked).map(c=>c.id));
      status.textContent=result.added.length+' saran ditambahkan. '+result.numbers.map(n=>'DOK.'+n).join(', ')+'.';
      if(!result.added.length)status.textContent='Saran sudah tercatat sebagai '+result.numbers.map(n=>'DOK.'+n).join(', ')+'.';
      open.hidden=false;
    }catch(e){status.textContent=e.message;}
  });
  const open=button('Buka indeks tujuan di KKP',()=>scope.open(target));
  function update(){add.disabled=!target || !choices.some(c=>c.input.checked);open.hidden=true;status.textContent='';}
  update();panel.append(picker,...choices.map(c=>c.control),add,status,open);
  return panel;
}

function business(container, options) {
  const preferenceKey=options.manifest?'scv2-probis-package-mode':'scv2-probis-catalog-mode';
  let preference='';try{preference=localStorage.getItem(preferenceKey);}catch{}
  let mode=options.openBusinessSearch || options.query?'search':['wp','search'].includes(preference)?preference:options.manifest?'wp':'search';
  function switchMode(next){mode=next;try{localStorage.setItem(preferenceKey,mode);}catch{}draw();}
  function showRecord(row) {
    const isZ=row.year===zEdition;
    const editScope=options.requests?.();
    const rows=[[isZ?'Acuan':'Edisi KBLI',isZ?'PER-12/PJ/2022, Lampiran bagian A':row.year],['Kode',row.code],['Nama',row.title]];
    for(let n=isZ?1:2;n<row.code.length;n++){
      const code=row.code.slice(0,n);
      const title=isZ?kluZ[code]?.title:kbli[row.year][code];
      if(title)rows.push([levels[n],code+' · '+title]);
    }
    if(isZ)rows.push(['Halaman lampiran',row.first===row.last?String(row.first):row.first+'–'+row.last]);
    const content=box('stack',...rows.map(([a,b])=>el('p',a+' · '+b)));
    if(!isZ&&row.code.length===5){
      const lookup=lookupKbliCorrespondence(row.year,row.code);
      if(lookup.known){
        const heading='Padanan KBLI '+lookup.toEdition,targets=lookup.matches;
        rows.push([heading,targets.map(item=>item.code+' · '+item.title+' · hlm. '+item.page).join('\n')]);
        content.append(card(heading,...targets.map(item=>button(item.code+' · '+item.title,()=>{
          const other=businessCodes.find(r=>r.year===lookup.toEdition&&r.code===item.code);
          if(other){document.getElementById('dialog').close();showRecord(other);}
        })),el('p','Lampiran '+lookup.appendix+' · halaman '+[...new Set(targets.map(item=>item.page))].join(', ')),link('Tabel kesesuaian BPS',lookup.sourceUrl)));
      }
    }
    if(!isZ && row.code.length>=2) {
      const {flow,check}=publicGuide(row.code);
      content.append(card('Panduan penelusuran awal',el('p',flow),el('p',check),el('small','Sesuaikan langkah ini dengan kegiatan dan bukti yang benar-benar tersedia.')));
    }
    if(options.manifest && row.code.length===5) content.append(button('Jadikan acuan WP pada sesi ini',()=>{
      if(editScope){try{editScope.saveBusiness('reference',{code:row.code,edition:row.year});}catch(e){notice(e.message,true);return;}}
      assigned.set(options.manifest,row);
      document.getElementById('dialog').close();switchMode('wp');
    }));
    content.append(exportBar(isZ?'Rincian KLU Z':'Rincian KBLI',['Keterangan','Nilai'],rows),
      isZ?link('Buka lampiran resmi DJP',kluAttachment+'#page='+row.first):link('Kamus klasifikasi BPS',sourceKBLI));
    showDialog(row.code+' · '+row.title,content);
  }
  function draw(){
    const panel=box('');container.replaceChildren(el('h1','Proses bisnis dan KLU'),
      toggleSet([['wp','Untuk WP ini'],['search','Cari KLU/KBLI']],mode,switchMode),panel);
    if(mode==='search') {
      registryList(panel,{title:'Hasil pencarian KLU dan KBLI',placeholder:'Kode atau nama kegiatan',query:options.query,rows:businessCodes,
        columns:['Kode','Nama kegiatan','Acuan','Tingkat'],filters:[
          {key:'year',label:'Acuan klasifikasi',initial:'current',options:[['current','KBLI 2025 dan KLU Z'],['','Semua acuan'],['2025','KBLI 2025'],['2020','KBLI 2020'],[zEdition,'KLU Z · PER-12/PJ/2022']]},
          {key:'level',label:'Tingkat',initial:kluZ[String(options.query||'').toUpperCase()]?String(options.query.length):'5',options:levels.map((v,i)=>[i?String(i):'',v])}],
        filter:(r,v)=>(v.year==='current'?r.year==='2025'||r.year===zEdition:!v.year||r.year===v.year)&&(!v.level||r.code.length===Number(v.level)),open:showRecord});
      return;
    }
    const entries=(options.entries||[]).filter(e=>/(?:^|\/)klu\.json$/i.test(e.path));
    const items=entries.flatMap(rowsOf).filter(r=>r.TradeClassificationCode);
    const scope=options.requests?.(),reference=scope?.business?.reference;
    const picked=reference?businessCodes.find(r=>r.code===reference.code&&r.year===reference.edition):options.manifest&&assigned.get(options.manifest);
    const detail=card('KLU di paket',el('p',options.manifest?(items.length?'Kode dan periode berikut berasal dari registrasi dalam paket.':'Paket ini belum memuat daftar KLU registrasi.'):'Buka paket untuk melihat KLU WP.'));
    for(const r of items) {
      detail.append(el('p',[r.TradeClassificationCode,r.ActivityDescription,r.IsMainEconomicCode===true?'Utama sesuai registrasi':'',r.ValidFrom?.slice(0,10),r.ValidTo?.slice(0,10)].filter(Boolean).join(' · ')));
      const z=zRecords[String(r.TradeClassificationCode).trim().toUpperCase()];
      if(z)detail.append(button('Lihat '+z.code+' di katalog DJP',()=>showRecord(z)));
    }
    if(picked)detail.append(button('Acuan sesi ini · '+picked.code+' '+picked.title,()=>showRecord(picked)));
    detail.append(button('Pilih acuan dari katalog',()=>switchMode('search')));
    panel.append(detail);
    if(picked && scope)panel.append(requestPanel(picked,scope));
    panel.append(calculator(scope));
  }
  draw();
}

export function renderCatalog(container, kind, options={}) {
  if(kind==='probis'){ business(container,options);return; }
  container.replaceChildren(el('h1','Peraturan'),el('p','Cari metadata yang tersimpan di perangkat. Buka naskah resmi untuk memeriksa isi dan riwayat aturan.'));
  regulationSearch(container,options.query);
}

const savedRegulationsKey='scv2-regulation-presets';
function regulationSearch(container,query) {
  let saved=[],active='';
  try{
    const stored=JSON.parse(localStorage.getItem(savedRegulationsKey)||'{}');
    if(Array.isArray(stored.presets))saved=stored.presets.filter(p=>typeof p?.name==='string' && p.name && p.filters && typeof p.filters==='object');
    if(!query && typeof stored.active==='string')active=stored.active;
  }catch{}
  const controls={},results=card('Hasil pencarian'),filters=box('toolbar');
  const initial=(saved.find(p=>p.name===active)?.filters)||{};
  const values={...emptyFilters};let page=0;
  for(const k of Object.keys(values))if(typeof initial[k]==='string')values[k]=initial[k];
  if(query)values.keyword=query;
  function changed(key,value){values[key]=value;page=0;render();}
  function input(key,label,type,placeholder='') {
    const control=el('input');control.type=type;control.value=values[key];control.placeholder=placeholder;
    control.oninput=()=>changed(key,control.value);
    controls[key]=control;filters.append(field(label,control));
  }
  function choice(key,label,items) {
    const item=select(items,values[key],v=>changed(key,v),label),control=item.querySelector('select');
    if(control.selectedIndex<0){control.selectedIndex=0;values[key]=control.value;}
    controls[key]=control;filters.append(item);
  }
  input('keyword','Kata kunci','search','Nomor, judul, atau kata kunci');
  input('number','Nomor peraturan','search','Misalnya 168/2023 atau PER-11');
  choice('type','Jenis',[['','Semua jenis ('+allRegs.length+')'],...regulationTypes(allRegs)]);
  choice('status','Status pada sumber',[['','Semua status'],['active','Aktif atau berlaku'],['changed','Diubah atau dicabut sebagian'],['ended','Dicabut, diganti, atau berakhir'],['other','Lainnya atau belum tercantum']]);
  input('start','Tanggal peraturan dari','date');input('end','Tanggal peraturan sampai','date');
  choice('sort','Urutan',[['newest','Terbaru'],['oldest','Terlama'],['type','Menurut jenis']]);

  function apply(next) {
    for(const [k,control] of Object.entries(controls)){
      control.value=typeof next[k]==='string'?next[k]:emptyFilters[k];
      if(control.tagName==='SELECT'&&control.selectedIndex<0)control.selectedIndex=0;
      values[k]=control.value;
    }
    page=0;render();
  }
  const presetName=el('input');presetName.maxLength=80;presetName.placeholder='Nama saringan';
  const presetSelect=el('select');presetSelect.setAttribute('aria-label','Saringan tersimpan');
  const info=el('p','','hint');info.setAttribute('role','status');
  function picker(){
    presetSelect.replaceChildren(new Option('Pilih saringan',''),...saved.map(p=>new Option(p.name,p.name)));
    presetSelect.value=active;presetName.value=active;
  }
  function store(){try{localStorage.setItem(savedRegulationsKey,JSON.stringify({presets:saved,active}));return true;}catch{info.textContent='Penyimpanan lokal tidak tersedia. Saringan hanya digunakan di tab ini.';return false;}}
  presetSelect.onchange=()=>{
    active=presetSelect.value;presetName.value=active;const item=saved.find(p=>p.name===active);
    if(item){apply(item.filters);if(store())info.textContent='Saringan '+active+' diterapkan.';}
    else {apply(emptyFilters);store();}
  };
  const presets=el('details');presets.append(el('summary','Saringan tersimpan'),box('toolbar',field('Buka saringan',presetSelect),field('Nama saringan',presetName),
    button('Simpan atau perbarui',()=>{
      const name=presetName.value.trim();if(!name){info.textContent='Isi nama saringan terlebih dahulu.';return;}
      saved=saved.filter(p=>p.name!==name).concat({name,filters:{...values}});active=name;picker();
      if(store())info.textContent='Saringan '+name+' tersimpan di perangkat ini.';
    }),button('Hapus saringan',()=>{
      if(!active)return;
      saved=saved.filter(p=>p.name!==active);active='';picker();if(store())info.textContent='Saringan terpilih sudah dihapus.';
    })),info);
  function details(r){
    const body=box('stack',el('h3',r.title),el('p',[r.type,r.date,r.status].join(' · ')),el('h4','Isi pokok'),
      el('p',r.summary||'Ringkasan isi belum tersedia untuk peraturan ini.'),link('Buka naskah di situs DJP',r.url));
    if(r.topics.length)body.append(el('p','Topik · '+r.topics.join(', ')));
    if(r.related.length){
      body.append(el('h4','Peraturan terkait'));
      for(const ref of r.related){
        const other=allRegs.find(item=>item.url===ref.url);
        body.append(other?button(ref.label,()=>details(other)):link(ref.label,ref.url));
      }
    }
    body.append(exportBar('Rincian peraturan',regulationColumns,[regulationCells(r)]));
    showDialog(r.number,body);
  }
  function render(){
    const rows=filterRegulations(allRegs,values),size=30,pages=Math.max(1,Math.ceil(rows.length/size));
    page=Math.min(page,pages-1);
    if(values.start&&values.end&&values.start>values.end){results.replaceChildren(el('p','Tanggal akhir mendahului tanggal awal. Periksa kembali rentang tanggal.'));return;}
    results.replaceChildren(el('p',rows.length+' hasil'));
    if(!rows.length){results.append(el('p','Coba kata kunci lain atau longgarkan saringan.'));return;}
    const table=el('table'),thead=el('thead'),tr=el('tr'),body=el('tbody');table.setAttribute('aria-label','Daftar peraturan');
    for(const col of ['Nomor','Tentang','Jenis','Tanggal peraturan','Status pada sumber','Isi pokok','Naskah'])tr.append(el('th',col));
    thead.append(tr);table.append(thead,body);
    for(const r of rows.slice(page*size,(page+1)*size)){
      const record=el('tr'),first=el('td'),source=el('td');first.append(button(r.number,()=>details(r)));
      source.append(link('Buka naskah',r.url));record.append(first,...[r.title,r.short,r.date,r.status,r.summary||'—'].map(t=>el('td',t)),source);
      record.onclick=e=>{if(!e.target.closest('a,button'))details(r);};body.append(record);
    }
    const prev=button('Sebelumnya',()=>{page--;render();}),next=button('Berikutnya',()=>{page++;render();});
    prev.disabled=page===0;next.disabled=page>=pages-1;
    results.append(exportBar('Hasil pencarian peraturan',regulationColumns,rows.map(regulationCells)),box('scroll',table),box('pager',prev,el('span','Halaman '+(page+1)+' dari '+pages),next));
  }
  picker();filters.append(button('Atur ulang',()=>{active='';picker();apply(emptyFilters);store();}));
  container.append(filters,presets,results);render();
}
