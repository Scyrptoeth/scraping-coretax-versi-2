import {documentStatuses,validateIndexDocuments} from './kkp-index.js';
import {documentIndexLabel,documentTaxes,duplicateRequest,inspectionTypes,registeredDocumentBusiness,requestOutput,requestSource,
  suggestedRequests,targetOptions,validateDocumentScope} from './document-requests-output-model.js';
import {clearIndexDocument,markEdit,nextIndexDocumentNumber} from './team-work.js';
import {printOutput} from './drafts.js';
import {box,button,card,detail,el,exportSheets,field,notice,select,showDialog} from './ui.js';

export function renderDocumentRequestsOutput(target,state,work,index){
  const pkg=state.pkg,wp=pkg.manifest.wp||{},year=String(state.year);
  const registered=registeredDocumentBusiness(pkg,year);
  const scope=()=>validateDocumentScope(work.documentScope);
  const docs=()=>work.indexDocuments||[];
  const body=el('div'),records=el('section'),suggestions=el('section');
  const live=el('p',null,'hint');live.setAttribute('role','status');
  function checkContext(){
    if(state.pkg!==pkg||String(state.year)!==year)throw Error('WP atau tahun sudah berubah. Buka permintaan dokumen pada tahun yang sesuai.');
  }
  function commit(changes){
    checkContext();
    const previous=docs();
    const replaced=new Set(changes.map(d=>d.number));
    const next=validateIndexDocuments([...previous.filter(d=>!replaced.has(d.number)),...changes],index,year)
      .sort((a,b)=>a.number-b.number);
    for(const doc of next.filter(d=>replaced.has(d.number))){
      const before=previous.find(old=>old.number===doc.number);
      markEdit(work,'indexDocuments',String(doc.number),before,doc);
    }
    work.indexDocuments=next;
  }
  const type=select(inspectionTypes,scope().type,updateScope,'Jenis pemeriksaan pada SP2');
  const checks=new Map();
  const taxes=box('toolbar');
  for(const [key,label] of documentTaxes){
    const check=el('input');check.type='checkbox';check.checked=scope().taxes.includes(key);check.disabled=scope().type==='lengkap';checks.set(key,check);
    const control=el('label',null,'schedule-condition');control.append(check,document.createTextNode(label));taxes.append(control);
    check.addEventListener('change',updateScope);
  }
  function updateScope(){
    try{
      checkContext();
      const after=validateDocumentScope({type:type.querySelector('select').value,taxes:[...checks].filter(([,checkbox])=>checkbox.checked).map(([tax])=>tax)});
      for(const [tax,checkbox] of checks){checkbox.checked=after.taxes.includes(tax);checkbox.disabled=after.type==='lengkap';}
      const before=work.documentScope;
      if(JSON.stringify(scope())===JSON.stringify(after))return;
      work.documentScope=after;markEdit(work,'documentScope','sp2',before,after);
      live.textContent='Cakupan SP2 tersimpan dalam sesi.';drawSuggestions();
    }catch(e){notice(e.message,true);}
  }
  function edit(saved){
    const form=el('form'),inputs={},status=el('p',null,'error');
    status.setAttribute('role','alert');
    function control(key,label,type){
      const input=el(type==='textarea'?'textarea':'input');
      if(type!=='textarea')input.type=type;
      input.value=saved?.[key]||'';input.required=key==='name';inputs[key]=input;
      return field(label,input);
    }
    let chosen=saved?.index||'SP2/UMUM',docStatus=saved?.status||'Saran';
    const options=targetOptions(index,scope());
    if(!options.some(([key])=>key===chosen))options.push([chosen,documentIndexLabel(chosen,index,work.indexNotes)+' · di luar cakupan pilihan']);
    const save=el('button',saved?'Simpan perubahan':'Simpan dokumen');save.type='submit';
    form.append(box('formgrid',control('name','Nama dokumen','text'),select(options,chosen,v=>chosen=v,'Indeks atau cakupan SP2'),
      select(documentStatuses,docStatus,v=>docStatus=v,'Status permintaan'),control('date','Tanggal diminta','date'),
      control('received','Tanggal diterima','date'),control('due','Tenggat khusus dokumen','date'),
      control('reference','Rujukan bukti','text'),control('notes','Catatan dokumen','textarea')),status,save);
    if(saved)form.prepend(el('p','Asal dokumen · '+requestSource(saved),'hint'));
    form.onsubmit=event=>{
      event.preventDefault();
      try{
        checkContext();
        const values=Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value.trim()]));
        const candidate={...saved,...values,index:chosen,number:saved?.number??nextIndexDocumentNumber(work),status:docStatus};
        const existing=duplicateRequest(docs(),candidate);
        if(existing)throw Error('Dokumen ini sudah tercatat sebagai DOK.'+existing.number+'.');
        commit([candidate]);document.getElementById('dialog').close();refresh();
        live.textContent='DOK.'+candidate.number+' tersimpan dalam sesi. Pilih Unduh berkas kerja untuk menyimpannya ke berkas.';
      }catch(error){status.textContent=error.message;}
    };
    showDialog(saved?'Ubah DOK.'+saved.number:'Tambah dokumen',form);
  }
  function confirmRemoval(doc){
    const confirm=button('Hapus DOK.'+doc.number,()=>{
      try{
        checkContext();clearIndexDocument(work,doc.number);document.getElementById('dialog').close();
        refresh();live.textContent='DOK.'+doc.number+' dihapus dari daftar permintaan.';
      }catch(e){notice(e.message,true);}
    });
    showDialog('Hapus permintaan dokumen',box('',el('p','Hapus DOK.'+doc.number+' · '+doc.name+' dari berkas kerja ini?'),
      box('toolbar',button('Batal',()=>document.getElementById('dialog').close()),confirm)));
  }
  function addSuggestions(items){
    try{
      checkContext();const changes=[];let number=nextIndexDocumentNumber(work);
      for(const item of items){
        if(duplicateRequest([...docs(),...changes],item))continue;
        changes.push({...item,number:number++,status:'Saran',date:'',due:'',reference:''});
      }
      if(changes.length)commit(changes);
      refresh();live.textContent=changes.length+' saran ditambahkan ke daftar permintaan.';
    }catch(e){notice(e.message,true);}
  }
  function drawSuggestions(){
    const items=suggestedRequests(index,scope(),year,work.business,registered),selected=new Set();
    const choices=el('div');
    const add=button('Tambahkan saran yang dipilih',()=>addSuggestions([...selected]));add.disabled=true;
    const remaining=[];
    for(const item of items){
      const existing=duplicateRequest(docs(),item),check=el('input');check.type='checkbox';check.disabled=Boolean(existing);
      if(!existing)remaining.push(item);
      check.onchange=()=>{if(check.checked)selected.add(item);else selected.delete(item);add.disabled=!selected.size;};
      const label=el('label',null,'schedule-condition');
      label.append(check,document.createTextNode(item.name+' · '+requestSource(item)+(existing?' · DOK.'+existing.number:'')));
      choices.append(box('',label));
    }
    const all=button('Tambahkan semua saran yang tampil',()=>addSuggestions(remaining));all.disabled=!remaining.length;
    suggestions.replaceChildren(detail('Saran dokumen ('+items.length+')',box('',
      el('p','Saran mengikuti cakupan SP2 dan indeks KKP yang tersedia. Saran sektoral memakai pilihan KLU di ProBis atau satu KLU utama yang tercatat untuk tahun ini.','hint'),
      choices,box('toolbar',add,all))));
  }
  function drawRecords(){
    const {summary,rows}=requestOutput(wp,year,index,work),documents=[...docs()].sort((a,b)=>a.number-b.number);
    records.replaceChildren(el('h3','Dokumen tercatat ('+documents.length+')'),
      el('p','Batas pemenuhan menurut jadwal pemeriksaan · '+summary.at(-1)[1],'hint'),
      box('toolbar',button('Tambah dokumen',()=>edit()),
        button('Excel permintaan dokumen',()=>{
          const result=requestOutput(wp,year,index,work);
          exportSheets([{name:'Permintaan Dokumen',rows:[['Daftar permintaan dokumen'],...result.summary,[],...result.rows]}],'Permintaan-Dokumen-'+year,wp);
        }),button('Cetak / PDF',()=>{
          const result=requestOutput(wp,year,index,work);
          printOutput({title:'Daftar permintaan dokumen',paragraphs:result.summary.map(row=>row.join(' · ')),tables:[{title:'Dokumen tercatat',rows:result.rows}]});
        })));
    if(!documents.length){records.append(el('p','Belum ada dokumen yang dicatat untuk WP dan tahun ini.'));return;}
    const table=el('table'),thead=el('thead'),headers=el('tr'),tbody=el('tbody');
    table.setAttribute('aria-label','Daftar permintaan dokumen');
    for(const label of ['Tindakan',...rows[0]]){const th=el('th',label);th.scope='col';headers.append(th);}
    thead.append(headers);
    documents.forEach((doc,i)=>{
      const tr=el('tr'),actions=el('td');
      actions.append(button('Ubah DOK.'+doc.number,()=>edit(doc)),button('Hapus',()=>confirmRemoval(doc)));
      tr.append(actions,...rows[i+1].map(text=>el('td',text||'—')));tbody.append(tr);
    });
    table.append(thead,tbody);records.append(box('scroll',table));
  }
  function refresh(){drawRecords();drawSuggestions();}
  body.append(type,el('h3','Jenis pajak pada SP2'),taxes);
  const panel=card('Permintaan dokumen dan cakupan SP2',body,live,records,suggestions);
  const heading=panel.querySelector('h2');heading.id='document-requests-title';heading.tabIndex=-1;
  target.append(panel);refresh();
}
