import {differenceCell,numericReference,sheetLink} from '../archive/table.js';
import {probisRequestKey,probisSourceFields,validatedProbisSource} from '../probis-guide.js';
import {compare, rowsOf, typeNames, worksheet} from './model.js';
import {filingAndPaymentRows} from './formal-compliance.js';
import {simulationTables} from './sanksi.js';
import {rateSourceLabel} from './rate-updates.js';
import {withoutReturnIndices} from './kkp-without-return.js';
import {workAuditRows} from './team-work.js';
import {findingKey,findingRows,findingsFor} from './findings.js';

// Each rule names an explicit value on the SPT. Empty or nonnumeric source cells stay empty.
const annualCompany=[
  ['B','Induk PPh Badan','Laba sebelum pajak','MainFormData.NetIncomeBeforeTax'],
  ['B','Induk PPh Badan','Penghasilan neto fiskal','MainFormData.FiscalNetIncomeAfterTax'],
  ['B','Induk PPh Badan','Penghasilan kena pajak','MainFormData.TaxableIncome'],
  ['B','Induk PPh Badan','PPh kurang/(lebih) bayar','MainFormData.UnderpaymentIncomeTax'],
  ['B.10','Kompensasi kerugian','Kompensasi tercantum','MainFormData.TotalCarriedForward'],
  ['B.11','PPh terutang','PPh terutang setahun','MainFormData.IncomeTaxInAYear'],
  ['B.13','Angsuran PPh','Angsuran PPh pada induk','MainFormData.InstallmentOfIncome']
];
const annualIndividual=[
  ['B','Induk PPh OP','Penghasilan neto setahun','AnnualNetIncome'],
  ['B','Induk PPh OP','Penghasilan kena pajak','TaxableIncome'],
  ['B','Induk PPh OP','Kurang atau lebih bayar','UnderOrOverPaymentTax'],
  ['B-7','Penghasilan dari pekerjaan','Neto dari pekerjaan','NetIncomeFromEmployment'],
  ['B-8','Penghasilan lainnya dalam negeri','Penghasilan lainnya dalam negeri','OtherDomesticIncome'],
  ['B-9','Penghasilan luar negeri','Penghasilan luar negeri','OtherForeignIncome'],
  ['B-10','Penghasilan final','Penghasilan final','IncomeFinal'],
  ['B-11','Penghasilan bukan objek','Penghasilan bukan objek','ExcludedIncomeFinal'],
  ['B-15','Penghasilan tidak kena pajak','PTKP pada induk','TaxExemptionAmountValue'],
  ['B-16','PPh terutang','PPh terutang pada induk','IncomeTaxPayable'],
  ['B-17','Kredit pajak','PPh dipotong atau dipungut pihak lain','IncomeTaxWhitheldOtherParty'],
  ['B-17','Kredit pajak','Angsuran PPh','InstallmentOfIncome']
];
const vat=[
  ['N','Induk PPN','Penyerahan barang dan jasa','TotalDeliveryOfGoodsAndServices.SellingPrice'],
  ['N','Induk PPN','Pajak masukan yang dapat diperhitungkan','InputTaxCanBeCalculated.VAT'],
  ['N','Induk PPN','PPN kurang atau lebih bayar','VATUnderOrOverPaid.VAT'],
  ['N.2','Ekspor','Ekspor BKP berwujud','ExportTangibleTaxableGoods.SellingPrice'],
  ['N.3.1','Pajak keluaran','Pajak keluaran yang dipungut sendiri','OutputTaxMustBeSelfCollected.VAT'],
  ['N.5','Penyerahan tidak dipungut','Penyerahan dengan PPN tidak dipungut','DomesticDeliveriesUncollectedVAT.SellingPrice']
];
const withholding=[
  ['C','Induk PPh Pasal 21','PPh Pasal 21 dipotong','A21IncomeTaxWithheld'],
  ['C.2.1','Objek PPh Pasal 21','Penghasilan bruto pada Form 1A','Form1A.GrossIncome']
];
const accounts={
  '4020':['B.1','Peredaran usaha'],'5020':['B.2','Harga pokok penjualan'],'5400':['B.3','Biaya usaha'],
  '4600':['B.4','Penghasilan dari luar usaha'],'5500':['B.5','Biaya dari luar usaha']
};
const formFields={BADAN:annualCompany,OP:annualIndividual,PPN:vat,PPH2126:withholding};
const readValue=(row,path)=>path.split('.').reduce((v,k)=>v?.[k],row);
const pathText=(path,field)=>path+' · '+field;

export function buildIndex(pkg,year) {
  const groups=new Map(), byId=new Map(), warnings=[];
  const periods=new Map();
  for(const form of pkg.forms.filter(f=>f.year===String(year))){
    const period=form.type+'/'+form.period;
    if(!periods.has(period))periods.set(period,[]);
    periods.get(period).push(form);
  }
  for(const versions of periods.values()){
    const mostRecent=Math.max(...versions.map(f=>f.version));
    const latest=versions.filter(f=>f.version===mostRecent);
    const form=latest[0], kind=typeNames[form.type]||form.type;
    if(latest.length!==1){warnings.push(kind+' '+form.period+' memiliki lebih dari satu rekaman versi P'+mostRecent+'.');continue;}
    function add(ref,title,topic,entry,field,amount,tax=kind){
      const key=form.type+'/'+ref;
      if(!groups.has(key))groups.set(key,{key,ref,title,tax,lines:[]});
      const id=entry.path+'#'+field;
      const line={id,ref,groupKey:key,period:form.period,version:form.version,topic,tax,source:pathText(entry.path,field),
        amount:Number.isFinite(amount)?amount:null,partial:entry.cap?.lengkap===false};
      groups.get(key).lines.push(line);byId.set(id,line);return line;
    }
    const entry=form.parts.get('induk'), parents=entry?rowsOf(entry):[], row=parents.length===1?parents[0]:null;
    if(parents.length>1)warnings.push(kind+' '+form.period+' memuat beberapa baris induk. Periksa berkas sumber.');
    if(row){
      for(const [ref,title,topic,field] of formFields[form.type]||[])add(ref,title,topic,entry,field,readValue(row,field));
      if(form.type==='BADAN'){
        const optionField='MainFormData.OverpaymentIncomeTax',option=readValue(row,optionField);
        const line=add('B','Induk PPh Badan','Kode pilihan pengembalian',entry,optionField,null);
        line.refundCode=(typeof option==='string'||Number.isFinite(option))?String(option):null;
        line.legacyCodeAmount=Number.isFinite(option)?option:null;
        const matches=new Map();
        const visit=(nodes,prefix)=>{
          if(!Array.isArray(nodes))return;
          nodes.forEach((node,i)=>{
            const path=prefix+'['+i+']',data=node?.Data,code=String(data?.AccountCode??'');
            if(Object.hasOwn(accounts,code)){
              if(!matches.has(code))matches.set(code,[]);
              matches.get(code).push({field:path+'.Data.Amount',data});
            }
            if(node?.Children)visit(node.Children,path+'.Children');
          });
        };
        for(const [key,values] of Object.entries(row)){
          if(!/^L1[a-z]FormData$/i.test(key)||!values||typeof values!=='object')continue;
          for(const [tree,nodes] of Object.entries(values))if(/TreeData$/.test(tree))visit(nodes,key+'.'+tree);
        }
        for(const [code,items] of matches){
          const [ref,title]=accounts[code];
          if(items.length!==1){warnings.push('Akun '+code+' muncul beberapa kali di '+kind+' '+form.period+'.');continue;}
          const item=items[0];
          add(ref,title,code+' · '+(item.data.Description||title),entry,item.field,item.data.Amount);
        }
      }
      if(form.type==='UNIFIKASI'&&Array.isArray(row.IncomeTaxes)){
        row.IncomeTaxes.forEach((item,i)=>{
          const data=item?.data;
          if(data?.Type!=='Tax Article')return;
          const ref={'Article 23':'G','Article 4 Section 2':'K'}[data.Name];
          if(!ref)return;
          const tax=ref==='G'?'PPh Pasal 23':'PPh Pasal 4 ayat (2)';
          for(const [field,topic] of [['TotalWithholding','Jumlah dipotong atau dipungut'],['TotalIncomeTaxPaid','Jumlah disetor']]){
            add(ref,'Induk '+tax,topic,entry,'IncomeTaxes['+i+'].data.'+field,data[field],tax);
          }
        });
      }
    }
    if(form.type==='PPN'){
      for(const [part,ref,title] of [['b1','N.8.1','Pajak masukan impor'],['b2','N.10','Pajak masukan dalam negeri']]){
        const annex=form.parts.get(part);
        if(!annex)continue;
        rowsOf(annex).forEach((doc,i)=>{
          if(doc.IsCancelled===true||!Object.hasOwn(doc,'VAT'))return;
          add(ref,title,'PPN · '+(doc.DocumentNumber||'baris '+(i+1)),annex,'baris['+(i+1)+'].VAT',doc.VAT);
        });
      }
    }
  }
  const provisional=withoutReturnIndices(pkg,year);
  for(const group of provisional.groups){
    groups.set(group.key,group);
    for(const line of group.lines)byId.set(line.id,line);
  }
  return {groups:[...groups.values()].sort((a,b)=>compare(a.ref,b.ref)||compare(a.tax,b.tax)),byId,warnings:[...warnings,...provisional.warnings]};
}

export function assessLine(line,{value,document,note='',officer,classification='indicative',principal=null}){
  if(line&&Object.hasOwn(line,'refundCode'))throw Error('Kode pilihan hanya dapat ditelaah sebagai keterangan.');
  if(!line||!Number.isFinite(value)||!document?.trim()||!officer?.trim())throw Error('Isi nilai hasil uji, rujukan bukti dan nama penguji.');
  if(!['verified','indicative'].includes(classification))throw Error('Pilih klasifikasi pengujian.');
  const delta=line.amount===null?null:value-line.amount;
  if(principal!==null&&(!Number.isFinite(principal)||principal<0))throw Error('Periksa nilai pokok hasil pengujian.');
  if((delta!==0||line.withoutReturn)&&!note?.trim())throw Error('Tuliskan penjelasan hasil pengujian.');
  const conclusion=line.withoutReturn?(delta===0?'Hasil uji sama dengan pembanding nol.':'Terdapat selisih hasil uji terhadap pembanding nol.') :
    delta===0?'Sesuai dengan SPT.':delta===null?'Nilai SPT untuk pembandingan belum tersedia.':'Terdapat selisih terhadap SPT.';
  return {kkpLine:line.id,kkpPeriod:line.period,document:document.trim(),kkpNote:note.trim(),
    topik:line.ref+' · '+line.topic+' · '+line.period,
    sumber:(line.withoutReturn?line.explanation+' ':'')+line.source+' · Bukti pengujian '+document.trim(),
    fakta:note.trim()||'Nilai telah dicocokkan dengan bukti pengujian.',simpulan:conclusion,
    menurutWp:line.amount,menurutPetugas:value,petugas:officer.trim(),tax:line.tax,
    status:'Selesai',principal:delta===0?null:principal,evidence:delta===0?'none':classification,review:'Dalam pengujian'};
}

function historicalOptionReview(old,line){
  const fields=['topik','sumber','fakta','simpulan','status','petugas','document','kkpNote','review','evidence'];
  if(!old||fields.some(field=>typeof old[field]!=='string')||old.menurutWp!==line.legacyCodeAmount||
    !Number.isFinite(old.menurutPetugas)||old.principal!==null&&(!Number.isFinite(old.principal)||old.principal<0))
    throw Error('Riwayat pengujian kode pilihan tidak sesuai dengan berkas sumber.');
  return Object.fromEntries([...fields,'menurutWp','menurutPetugas','principal'].map(field=>[field,old[field]]));
}

export function reviewRefundCode(line,{document,note,officer},previous=null){
  if(!line||!Object.hasOwn(line,'refundCode')||!document?.trim()||!note?.trim()||!officer?.trim())
    throw Error('Isi rujukan, catatan telaah kode dan nama petugas.');
  return {kkpLine:line.id,kkpPeriod:line.period,refundCode:line.refundCode,document:document.trim(),kkpNote:note.trim(),
    topik:line.ref+' · '+line.topic+' · '+line.period,sumber:line.source+' · '+document.trim(),
    fakta:note.trim(),simpulan:'Kode pilihan telah ditelaah.',menurutWp:null,menurutPetugas:null,
    petugas:officer.trim(),tax:line.tax,status:'Selesai',principal:null,evidence:'none',review:'Dalam pengujian',
    ...(previous?{legacyOptionReview:historicalOptionReview(previous,line)}:{})};
}

function restoreRefundCode(raw,row,line){
  if(!Object.hasOwn(raw,'refundCode')){
    const history=historicalOptionReview({...row,document:raw.document,kkpNote:raw.kkpNote},line);
    return {...row,kkpLine:line.id,kkpPeriod:line.period,refundCode:line.refundCode,document:history.document,kkpNote:history.kkpNote,
      topik:line.ref+' · '+line.topic+' · '+line.period,simpulan:'Perlu telaah ulang. Berkas lama memperlakukan kode pilihan sebagai nominal.',
      menurutWp:null,menurutPetugas:null,principal:null,evidence:'none',status:'Perlu tindak lanjut',legacyOptionReview:history};
  }
  if(raw.refundCode!==line.refundCode||row.menurutWp!==null||row.menurutPetugas!==null||row.principal!==null||row.evidence!=='none'||
    typeof raw.document!=='string'||typeof raw.kkpNote!=='string')
    throw Error('Telaah kode pilihan berbeda dari sumber atau memuat nominal.');
  return {...row,kkpLine:line.id,kkpPeriod:line.period,refundCode:line.refundCode,document:raw.document,kkpNote:raw.kkpNote,
    ...(raw.legacyOptionReview?{legacyOptionReview:historicalOptionReview(raw.legacyOptionReview,line)}:{})};
}

export function restoreIndexedRows(rawRows,rows,index){
  const seen=new Set();
  return rows.map((row,i)=>{
    const raw=rawRows[i];
    if(raw.kkpLine===undefined)return row;
    const line=index.byId.get(raw.kkpLine);
    if(!line||seen.has(raw.kkpLine)||raw.kkpPeriod!==line.period)
      throw Error('Indeks atau nilai SPT pada berkas kerja berbeda dari sumber.');
    seen.add(raw.kkpLine);
    if(Object.hasOwn(line,'refundCode'))return restoreRefundCode(raw,row,line);
    if(row.menurutWp!==line.amount)throw Error('Indeks atau nilai SPT pada berkas kerja berbeda dari sumber.');
    const result=assessLine(line,{value:row.menurutPetugas,document:raw.document,note:raw.kkpNote,officer:row.petugas,
      classification:row.evidence==='none'?'indicative':row.evidence,principal:row.principal});
    return {...result,review:row.review};
  });
}

export const reviewDecisions=['','Setuju','Revisi','Tolak'];
export function restoreNotes(notes,index){
  if(notes===undefined)return {};
  const valid=new Set(index.groups.map(g=>g.key));
  if(!notes||typeof notes!=='object'||Array.isArray(notes))throw Error('Format penelaahan indeks tidak dikenali.');
  for(const [key,n] of Object.entries(notes)){
    if(!valid.has(key)||!n||!Number.isSafeInteger(n.revision)||n.revision<0||
      !['unit','preparer','reviewer'].every(k=>typeof n[k]==='string')||
      (n.decision!==undefined&&!reviewDecisions.includes(n.decision))||
      (n.reviewNote!==undefined&&typeof n.reviewNote!=='string'))throw Error('Isian penelaahan indeks tidak sah.');
  }
  return notes;
}

export const documentStatuses=['Saran','Diminta','Diterima sebagian','Diterima','Tidak diberikan'];
export function validateIndexDocuments(documents,index,year){
  if(documents===undefined)return [];
  if(!Array.isArray(documents))throw Error('Daftar permintaan dokumen tidak sah.');
  const groups=new Set(index.groups.map(g=>g.key)),numbers=new Set(),sources=new Set();
  return documents.map(d=>{
    if(!d||!Number.isSafeInteger(d.number)||d.number<1||numbers.has(d.number)||!groups.has(d.index)||
      typeof d.name!=='string'||!d.name.trim()||!documentStatuses.includes(d.status)||
      typeof d.date!=='string'||typeof d.due!=='string'||typeof d.reference!=='string')throw Error('Periksa nomor, indeks, nama dan status dokumen.');
    for(const date of [d.date,d.due].filter(Boolean)){
      const parsed=new Date(date+'T00:00:00Z');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)throw Error('Tanggal dokumen tidak sah.');
    }
    if(d.date&&d.due&&d.date>d.due)throw Error('Tenggat mendahului tanggal permintaan.');
    numbers.add(d.number);
    const result={number:d.number,index:d.index,name:d.name.trim(),status:d.status,date:d.date,due:d.due,reference:d.reference.trim()};
    if(d.probis!==undefined){
      result.probis=validatedProbisSource(d.probis,year);
      const key=probisRequestKey(d.index,result.probis);
      if(sources.has(key))throw Error('Saran Probis yang sama muncul dua kali pada indeks ini.');
      sources.add(key);
    }
    return result;
  });
}
export function documentRows(documents){
  const source=documents.find(d=>d.probis)?.probis, extra=Object.keys(probisSourceFields(source));
  return [['Nomor','Jenis dokumen','Indeks','Status','Tanggal permintaan','Tenggat tercatat','Rujukan',...extra],
    ...documents.map(d=>{
      const fields=probisSourceFields(d.probis);
      return ['DOK.'+d.number,d.name,d.index.split('/')[1],d.status,d.date,d.due,d.reference,...extra.map(k=>fields[k]??'')];
    })];
}

export function indexStatus(group,reviewed){
  let tested=0,changed=0;
  for(const line of group.lines){
    const row=reviewed.get(line.id);
    if(!row||row.legacyOptionReview&&row.status==='Perlu tindak lanjut')continue;
    tested++;
    if(line.amount!==null&&row.menurutPetugas!==line.amount)changed++;
  }
  return {tested,changed,state:changed?'Ada koreksi':tested===group.lines.length?'Selesai':tested?'Sebagian diuji':'Belum diuji'};
}

export function indexSheets(group,reviewed,notes={},documents=[]){
  const meta=notes[group.key]||{}, version=meta.revision?' (P'+meta.revision+')':'';
  const rows=[['Indeks',group.ref+version],['Kertas kerja',group.title],['UP2',meta.unit],['Dibuat oleh',meta.preparer],
    ['Ditelaah oleh',meta.reviewer],['Masa','P SPT','Uraian','Menurut SPT/WP','Menurut petugas','Koreksi','Status','Sumber SPT','Rujukan bukti','Penguji','Penjelasan']];
  const history=[];
  if(group.lines.some(l=>Object.hasOwn(l,'refundCode')))rows.at(-1).push('Kode pilihan pengembalian');
  if(group.lines.some(l=>l.withoutReturn)){
    const header=rows.at(-1);header[3]='Pembanding KKP';header[7]='Sumber daftar dan bukti potong';
    header.push('Nilai awal dari bukti potong','Dasar pembanding','Cakupan bukti');
  }
  for(const line of group.lines){
    const row=reviewed.get(line.id), value=row?.menurutPetugas??null;
    const delta=line.amount===null||value===null?null:value-line.amount;
    const isCode=Object.hasOwn(line,'refundCode');
    rows.push([line.period,line.version,line.topic,line.amount,value,isCode?null:differenceCell(rows.length+1,4,5,delta),
      row?row.simpulan:'Belum diuji',line.source,row?.document,row?.petugas,row?.kkpNote]);
    if(line.withoutReturn)rows.at(-1).push(line.prefill,line.explanation,line.coverage.join('\n')||'Sumber tahun terpilih telah diperiksa.');
    if(isCode){
      rows.at(-1).push(line.refundCode);
      const old=row?.legacyOptionReview;
      if(old)history.push([line.period,old.topik,old.status,old.review,old.sumber,old.document,old.petugas,old.kkpNote,
        old.menurutWp,old.menurutPetugas,old.principal,old.evidence,old.fakta,old.simpulan]);
    }
  }
  for(const line of group.lines.filter(l=>l.withoutReturn))rows.push([],['Rincian bukti potong'],...worksheet(line.details));
  if(history.length)rows.push([],['Riwayat pengujian kode pada berkas lama. Angka disimpan untuk penelusuran.'],
    ['Masa','Butir lama','Status lama','Telaah lama','Sumber lama','Rujukan lama','Penguji','Catatan lama','Isian WP lama',
      'Isian petugas lama','Pokok lama','Klasifikasi lama','Fakta lama','Simpulan lama'],...history);
  const linked=documents.filter(d=>d.index===group.key);
  if(linked.length)rows.push([],['Dokumen pendukung'],...documentRows(linked));
  return {name:group.ref+' '+group.title,rows};
}

export function completeIndexBook(pkg,year,index,reviewed,notes,documents=[],simulation={cases:[],end:''},work={}){
  const wp=pkg.manifest.wp||{}, assignment=pkg.manifest.penugasan||{},officer=pkg.manifest.penarik||{};
  const list=[['Indeks','Uraian','Jenis pajak','Status','Baris diuji','Jumlah baris','Baris koreksi','Revisi']];
  const findings=[['Indeks','Masa','Uraian','Menurut SPT/WP','Menurut petugas','Koreksi','Rujukan bukti','Sumber SPT']];
  const source=[['Indeks','Jenis pajak','Masa','P SPT','Uraian','Menurut SPT/WP','Sumber','Berkas ditandai belum lengkap']];
  const sourceSheet={name:'SPT Data',rows:source}, groupSheets=[];
  const review=[['Indeks','Judul','Baris diuji','Baris koreksi','Pembuat','Penelaah','Catatan penelaah','Keputusan','Revisi']];
  const hasProvisional=index.groups.some(g=>g.lines.some(l=>l.withoutReturn));
  if(hasProvisional)source[0].push('Dasar pembanding KKP','Nilai awal dari bukti potong');
  const main=[['Jenis pajak','Indeks','Masa','Uraian','Menurut SPT/WP','Menurut petugas','Selisih yang diuji','Pokok hasil pengujian (Rp)','Rujukan']];
  for(const group of index.groups){
    const status=indexStatus(group,reviewed);
    const groupSheet=indexSheets(group,reviewed,notes,documents),meta=notes[group.key]||{};
    groupSheets.push(groupSheet);
    list.push([sheetLink(groupSheet,group.ref),group.title,group.tax,status.state,status.tested,group.lines.length,status.changed,meta.revision||0]);
    review.push([sheetLink(groupSheet,group.ref),group.title,status.tested,status.changed,meta.preparer,meta.reviewer,meta.reviewNote,meta.decision,meta.revision||0]);
    for(const [i,l] of group.lines.entries()){
      const row=i+7;
      source.push([group.ref,group.tax,l.period,l.version,l.topic,l.amount,l.source,l.partial]);
      if(l.withoutReturn)source.at(-1).push(l.explanation,l.prefill);
      if(!l.withoutReturn&&!Object.hasOwn(l,'refundCode'))groupSheet.rows[row-1][3]=numericReference(sourceSheet,source.length,6,l.amount);
      const r=reviewed.get(l.id);
      if(r&&!Object.hasOwn(l,'refundCode'))main.push([group.tax,sheetLink(groupSheet,group.ref,row),l.period,l.topic,
        numericReference(groupSheet,row,4,l.amount),numericReference(groupSheet,row,5,r.menurutPetugas),
        differenceCell(main.length+1,5,6,l.amount===null?null:r.menurutPetugas-l.amount),r.principal,r.document]);
      if(r&&l.amount!==null&&l.amount!==r.menurutPetugas)findings.push([sheetLink(groupSheet,group.ref,row),l.period,l.topic,
        numericReference(groupSheet,row,4,l.amount),numericReference(groupSheet,row,5,r.menurutPetugas),
        differenceCell(findings.length+1,4,5,r.menurutPetugas-l.amount),r.document,l.source]);
    }
  }
  const sim=simulationTables(simulation);
  if(sim.summary.length)main.push([],['Simulasi ketetapan per jenis pajak'],...worksheet(sim.summary));
  const formal=filingAndPaymentRows(pkg,year);
  const audit=workAuditRows(work);
  const direct=findingsFor(pkg,year,work.rows||[]).filter(f=>f.status==='berbukti'&&
    !['Terjelaskan','Tidak relevan'].includes(work.dispositions?.[findingKey(f)]));
  return [{name:'ID',rows:[['Isian','Nilai'],['Nama WP',wp.nama],['NPWP',wp.npwp],['Tahun',year],['Nomor penugasan',assignment.nomor],
    ['Jenis penugasan',assignment.jenis],['Tanggal penugasan',assignment.tanggal],['Peran',assignment.peran||officer.peran],['Penarik',officer.nama],
    ['Periode paket',pkg.manifest.periode],['Pemeriksaan paket',pkg.report.manifestHash],['Pilihan tarif bunga sesi',rateSourceLabel()]]},
    {name:'Daftar Indeks',rows:list},{name:'Temuan Sementara',rows:findings},{name:'INDUK',rows:main},
    {name:'Permintaan Dokumen',rows:documentRows(documents)},sourceSheet,{name:'Kepatuhan Formal',rows:formal},
    {name:'Review Sheet',rows:review},{name:'Jejak Audit',rows:audit.length?worksheet(audit):[['Belum ada perubahan tercatat.']]},
    {name:'Temuan Langsung',rows:findingRows(direct)},
    ...groupSheets];
}
