import {assessLine,completeIndexBook,documentRows,documentStatuses,indexSheets,indexStatus,reviewDecisions,reviewRefundCode,validateIndexDocuments} from './kkp-index.js';
import {probisSourceFields} from '../probis-guide.js';
import {button,box,card,dataTable,el,exportSheets,field,notice,select,showDialog} from './ui.js';
import {count} from './model.js';
import {clearIndexReview,markEdit,rowIdentity} from './team-work.js';
import {companyProvisionalSupport} from './kkp-company-without-return.js';

function outputSection(go){
  const section=el('section'),schedule=button('JD · Jadwal pemeriksaan',()=>go('kerja','jadwal'));
  section.setAttribute('aria-label','Keluaran');schedule.id='kkp-open-schedule';
  section.append(el('h3','Keluaran'),schedule);
  return section;
}

function indexDirectory(groups,current,reviewed,open,go){
  const directory=el('section',null,'card index-directory');
  directory.setAttribute('aria-label','Daftar indeks KKP');
  directory.append(el('h2','Daftar indeks KKP'));
  const families=new Map();
  for(const group of groups){
    const family=group.tax==='PPh 21/26'&&/^C(?:\.|$)/.test(group.ref)?'PPh Pasal 21':group.tax;
    if(!families.has(family))families.set(family,[]);
    families.get(family).push(group);
  }
  const preferred=['PPh Badan','PPh Orang Pribadi','PPN','PPN non-PKP / Pemungut','PPh Pasal 21','PPh Pasal 22','PPh Pasal 23','PPh Pasal 4 ayat (2)'];
  for(const family of new Set([...preferred,...families.keys()])){
    if(!families.has(family))continue;
    const section=el('section'),tiles=box('index-choices');
    section.setAttribute('aria-label',family);
    section.append(el('h3',family),tiles);
    for(const group of families.get(family)){
      const status=indexStatus(group,reviewed);
      const choice=button('',()=>open(group.key),'index-choice');
      choice.setAttribute('aria-pressed',String(group.key===current.key));
      choice.setAttribute('aria-controls','kkp-current');
      choice.append(el('strong',group.ref),el('span',group.title),el('small',status.state+' · '+status.tested+'/'+group.lines.length));
      tiles.append(choice);
    }
    directory.append(section);
  }
  directory.append(outputSection(go));
  return directory;
}

function editRefundCode(line,work,repaint,wp){
  const i=work.rows.findIndex(r=>r.kkpLine===line.id),saved=work.rows[i];
  const form=el('form'),reference=el('input'),note=el('textarea'),officer=el('input'),status=el('p',null,'error');
  status.setAttribute('role','alert');
  reference.value=saved?.document||'';note.value=saved?.kkpNote||'';officer.value=saved?.petugas||'';
  form.append(el('p','Kode pada induk · '+(line.refundCode??'Tidak tercantum')),el('p','Sumber · '+line.source));
  const old=saved?.legacyOptionReview;
  if(old){
    form.append(el('h3','Riwayat pengujian dari berkas lama'),el('p',saved.simpulan),
      el('p','Angka berikut hanya menunjukkan isian pada berkas lama. Periksa kembali draf yang sudah disimpan apabila memakai pengujian ini.'),
      dataTable([{'Butir lama':old.topik,'Menurut WP (lama)':old.menurutWp,'Menurut petugas (lama)':old.menurutPetugas,
        'Pokok (lama)':old.principal,'Klasifikasi lama':old.evidence,'Status lama':old.status,'Telaah lama':old.review,
        'Rujukan bukti':old.document,Sumber:old.sumber,Catatan:old.kkpNote,Petugas:old.petugas,Fakta:old.fakta,Simpulan:old.simpulan}],
      {wp,name:'Riwayat pengujian kode pilihan'}));
  }
  const save=el('button','Simpan telaah kode');save.type='submit';
  form.append(field('Dokumen atau rujukan bukti',reference),field('Catatan penelaahan kode',note),field('Nama penelaah',officer),status,save);
  form.onsubmit=e=>{
    e.preventDefault();
    try{
      const row=reviewRefundCode(line,{document:reference.value,note:note.value,officer:officer.value},old);
      markEdit(work,'rows',rowIdentity(row),saved,row);
      if(i<0)work.rows.push(row);else work.rows[i]=row;
      document.getElementById('dialog').close();repaint();notice('Telaah kode pilihan tersimpan.');
    }catch(error){status.textContent=error.message;}
  };
  showDialog('Telaah kode pilihan pengembalian',form);
}

export function editIndexLine(line,work,repaint,wp){
  if(Object.hasOwn(line,'refundCode'))return editRefundCode(line,work,repaint,wp);
  const saved=work.rows.find(r=>r.kkpLine===line.id), form=el('form'), value=el('input');
  const evidence=el('input'), explanation=el('textarea'), officer=el('input'), principal=el('input'), feedback=el('p',null,'hint');
  const status=el('p',null,'error');status.setAttribute('role','alert');
  value.type=principal.type='number';value.step=principal.step='any';principal.min='0';
  value.value=saved?.menurutPetugas??'';principal.value=saved?.principal??'';
  evidence.value=saved?.document||'';explanation.value=saved?.kkpNote||'';officer.value=saved?.petugas||'';
  let prefillBasis=saved?.kkpPrefill;
  let classification=saved?.evidence==='verified'?'verified':'indicative';
  const choose=select([['indicative','Indikatif'],['verified','Berbukti berdasarkan dokumen']],classification,v=>{classification=v;},'Klasifikasi hasil yang berbeda');
  function preview(){
    const delta=value.value===''||line.amount===null?null:value.valueAsNumber-line.amount;
    feedback.textContent=delta===null?'Koreksi belum dapat dihitung.':(line.withoutReturn?'Selisih terhadap pembanding nol ':'Koreksi terhadap SPT ')+count(delta)+'.';
  }
  value.oninput=()=>{prefillBasis=undefined;preview();};preview();
  const linked=work.indexDocuments.filter(d=>(d.index===line.groupKey||d.index===line.canonicalKey)&&['Diterima','Diterima sebagian'].includes(d.status));
  if(line.withoutReturn){
    form.append(el('p',line.explanation),el('p',(line.prefillLabel||'Nilai awal dari bukti potong')+' · '+(line.prefill===null?'Belum tersedia':count(line.prefill))));
    if(line.observedPrefill){
      const observed=line.observedPrefill;
      form.append(el('p','Subtotal menurut induk SPT Masa PPN · '+count(observed.amount)+' · '+observed.periods.join(', ')),
        button('Salin subtotal '+observed.periods.length+' masa yang tersedia',()=>{
          value.value=String(observed.amount);prefillBasis='observed';preview();
        }));
    }else if(line.prefill!==null)form.append(button('Salin nilai awal ke isian pengujian',()=>{value.value=line.prefill;preview();}));
  }
  form.append(el('p','Masa '+line.period+' · '+(line.withoutReturn?'Tanpa SPT pada daftar':'P'+line.version)+' · '+line.topic),
    el('p','Sumber · '+line.source),el('p',(line.withoutReturn?'Pembanding KKP':'Menurut SPT/WP')+' · '+(line.amount===null?'Tidak tersedia':count(line.amount))),
    field('Nilai setelah pengujian',value),feedback,field('Dokumen atau rujukan bukti',evidence),field('Penjelasan hasil uji',explanation),
    field('Nama penguji',officer),choose,field('Pokok berdasarkan pengujian (Rp, opsional)',principal),status);
  if(linked.length)form.append(select([['','Pilih dokumen'],...linked.map(d=>[String(d.number),'DOK.'+d.number+' · '+d.name+' · '+d.status])],'',v=>{
    const d=linked.find(doc=>String(doc.number)===v);
    if(d)evidence.value=['DOK.'+d.number,d.name,d.reference].filter(Boolean).join(' · ');
  },'Gunakan rujukan dokumen terkait'));
  const apply=amount=>{
    try{
      const row=assessLine(line,{value:amount,document:evidence.value,note:explanation.value,officer:officer.value,classification,prefillBasis,
        principal:principal.value===''?null:principal.valueAsNumber});
      const i=work.rows.findIndex(r=>r.kkpLine===line.id);
      markEdit(work,'rows',rowIdentity(row),i<0?null:work.rows[i],row);
      if(i<0)work.rows.push(row);else work.rows[i]=row;
      document.getElementById('dialog').close();repaint();notice('Hasil uji indeks tersimpan dalam sesi ini.');
    }catch(e){status.textContent=e.message;}
  };
  const save=el('button','Simpan hasil uji');save.type='submit';
  const confirm=button(line.withoutReturn?'Catat hasil uji nol':'Konfirmasi sesuai SPT (sudah diuji)',()=>{prefillBasis=undefined;apply(line.amount);});confirm.disabled=line.amount===null;
  form.append(box('toolbar',save,confirm));form.onsubmit=e=>{e.preventDefault();apply(value.valueAsNumber);};
  if(saved)form.append(button('Kembalikan ke belum diuji',()=>{
    const cancel=button('Pertahankan hasil uji',()=>showDialog('Pengujian '+line.ref,form));
    const clear=button('Kembalikan baris',()=>{
      clearIndexReview(work,line);document.getElementById('dialog').close();repaint();notice('Baris kembali berstatus belum diuji.');
    });
    showDialog('Kembalikan hasil uji baris ini?',box('',
      el('p',line.ref+' · '+line.period+' · '+line.topic),
      el('p','Isian penguji dan koreksi pada baris ini akan dihapus dari sesi. Tindakan tercatat di jejak audit.'),
      box('toolbar',cancel,clear)));
  }));
  showDialog('Pengujian '+line.ref,form);
}

function editDocument(group,index,work,repaint,existing){
  const number=existing?.number??work.indexDocuments.reduce((n,d)=>Math.max(n,d.number),0)+1;
  const form=el('form'),name=el('input'),date=el('input'),due=el('input'),source=el('input'),error=el('p',null,'error');
  date.type=due.type='date';error.setAttribute('role','alert');
  name.value=existing?.name||'';name.required=true;date.value=existing?.date||'';due.value=existing?.due||'';source.value=existing?.reference||'';
  let state=existing?.status||documentStatuses[0];
  const submit=el('button','Simpan dokumen');submit.type='submit';
  form.append(el('p','Indeks '+group.ref+' · '+group.title),field('Jenis dokumen',name),
    select(documentStatuses,state,v=>{state=v;},'Status dokumen'),field('Tanggal permintaan',date),field('Tenggat menurut surat',due),
    field('Nomor atau lokasi bukti',source),error,submit);
  form.onsubmit=e=>{
    e.preventDefault();
    const item={...existing,number,index:group.key,name:name.value,status:state,date:date.value,due:due.value,reference:source.value};
    const next=existing?work.indexDocuments.map(d=>d.number===number?item:d):[...work.indexDocuments,item];
    try{work.indexDocuments=validateIndexDocuments(next,index);markEdit(work,'indexDocuments',String(number),existing,item);document.getElementById('dialog').close();repaint();}
    catch(err){error.textContent=err.message;}
  };
  showDialog('Permintaan DOK.'+number,form);
}

export function renderIndex(target,state,work,index){
  const wp=state.pkg.manifest.wp;
  const reviewed=new Map(work.rows.filter(r=>r.kkpLine).map(r=>[r.kkpLine,r]));
  const downloadBook=()=>exportSheets(completeIndexBook(state.pkg,state.year,index,reviewed,work.indexNotes,work.indexDocuments,work.simulation,work),'KKP-Indeks-'+state.year,wp);
  if(!index.groups.length){
    target.append(card('Indeks KKP',el('p','Belum ada isian SPT yang dapat dipetakan ke indeks pada tahun ini.'),
      button('Excel semua KKP',downloadBook),
      ...index.warnings.map(s=>el('p',s,'hint')),outputSection(state.go)));return;
  }
  const group=index.groups.find(g=>g.key===work.activeIndex)||index.groups[0];
  const openIndex=key=>{
    work.activeIndex=key;state.repaint();
    document.getElementById('kkp-current-title')?.focus();
  };
  const directory=indexDirectory(index.groups,group,reviewed,openIndex,state.go);
  const summary=g=>{
    const s=indexStatus(g,reviewed);
    return g.ref+' · '+g.title+' · '+s.state+' ('+s.tested+'/'+g.lines.length+')';
  };
  const selected=select(index.groups.map(g=>[g.key,summary(g)]),group.key,openIndex,'Pilih indeks KKP');
  const meta=work.indexNotes[group.key]||{unit:'',preparer:'',reviewer:'',revision:0};
  const fieldset=box('formgrid');
  for(const [key,title] of [['unit','Unit pemeriksaan (UP2)'],['preparer','Dibuat oleh'],['reviewer','Ditelaah oleh']]){
    const input=el('input');input.value=meta[key];input.oninput=()=>{meta[key]=input.value;work.indexNotes[group.key]=meta;};
    input.onchange=()=>markEdit(work,'indexNotes',group.key);
    fieldset.append(field(title,input));
  }
  const reviewNote=el('textarea');reviewNote.value=meta.reviewNote||'';
  reviewNote.oninput=()=>{meta.reviewNote=reviewNote.value;work.indexNotes[group.key]=meta;};
  reviewNote.onchange=()=>markEdit(work,'indexNotes',group.key);
  fieldset.append(field('Catatan penelaah',reviewNote),select(reviewDecisions.map(d=>[d,d||'Belum diputuskan']),meta.decision||'',value=>{
    meta.decision=value;work.indexNotes[group.key]=meta;markEdit(work,'indexNotes',group.key);
  },'Keputusan penelaah'));
  const rev=button('Buat revisi P'+(meta.revision+1),()=>{
    if(!meta.reviewer.trim()){notice('Isi nama penelaah sebelum menandai revisi.',true);return;}
    meta.revision++;work.indexNotes[group.key]=meta;markEdit(work,'indexNotes',group.key);state.repaint();
  });
  const rowList=group.lines.map(l=>{
    const r=reviewed.get(l.id);
    return {Masa:l.period,'Versi SPT':l.withoutReturn?'Tanpa SPT pada daftar':'P'+l.version,Uraian:l.topic,
      [l.withoutReturn?'Pembanding KKP':'Menurut SPT/WP']:l.amount,...(l.withoutReturn?{[l.prefillLabel||'Nilai awal dari bukti potong']:l.prefill}:{}),'Menurut petugas':r?.menurutPetugas??null,
      Koreksi:r&&l.amount!==null?r.menurutPetugas-l.amount:null,Status:r?.simpulan||'Belum diuji',Sumber:l.source,
      'Cakupan sumber':l.partial?'Ditandai belum lengkap':'','Rujukan bukti':r?.document||'',
      ...(Object.hasOwn(l,'refundCode')?{'Kode pilihan pengembalian':l.refundCode}:{})};
  });
  const documents=work.indexDocuments.filter(d=>d.index===group.key);
  const docRows=documents.map(d=>({Nomor:'DOK.'+d.number,Dokumen:d.name,Status:d.status,'Tanggal permintaan':d.date,Tenggat:d.due,Rujukan:d.reference,...probisSourceFields(d.probis)}));
  const heading=el('h2',group.ref+(meta.revision?' (P'+meta.revision+')':'')+' · '+group.title);
  heading.id='kkp-current-title';heading.tabIndex=-1;
  const back=button('Kembali ke daftar indeks',()=>directory.querySelector('[aria-pressed="true"]')?.focus());
  const support=companyProvisionalSupport(group,reviewed);
  const pane=card('',heading,box('toolbar',back,selected),
    dataTable(rowList,{wp,name:'Pengujian per indeks',openRow:r=>editIndexLine(group.lines[rowList.indexOf(r)],work,state.repaint,wp)}),
    ...(support?.length?[dataTable(support,{wp,name:'Rincian dan angka pembanding'})]:[]),
    ...group.lines.filter(l=>l.withoutReturn&&(l.details.length||!group.provisionalCompany)).flatMap(l=>[el('p',l.explanation),...l.coverage.map(s=>el('p',s,'hint')),
      ...(l.details.length?[dataTable(l.details,{wp,name:l.detailTitle||'Rincian bukti potong untuk '+l.ref,incremental:true})]:[])]),
    fieldset,box('toolbar',rev,button('Excel KKP ini',()=>exportSheets([indexSheets(group,reviewed,work.indexNotes,work.indexDocuments)],'KKP-'+group.ref+'-'+state.year,wp)),
      button('Excel semua KKP',downloadBook)),
    el('h3','Dokumen pendukung'),button('Tambah permintaan dokumen',()=>editDocument(group,index,work,state.repaint)),
    button('Excel daftar dokumen',()=>exportSheets([{name:'Permintaan Dokumen',rows:documentRows(work.indexDocuments)}],'Daftar-Dokumen-'+state.year,wp)),
    dataTable(docRows,{wp,name:'Dokumen indeks terpilih',empty:'Belum ada permintaan dokumen untuk indeks ini.',
      openRow:r=>editDocument(group,index,work,state.repaint,documents[docRows.indexOf(r)])}),
    ...index.warnings.filter(s=>!group.lines.some(l=>l.coverage?.includes(s))).map(s=>el('p',s,'hint')));
  pane.id='kkp-current';target.append(directory,pane);
}
