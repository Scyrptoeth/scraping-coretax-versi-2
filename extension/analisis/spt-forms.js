import {differences,flatten,payloads,receiptNumber,rowsOf,sptDay,submittedDay,typeNames,worksheet} from './model.js';
import {box,button,card,dataTable,detail,el,exportSheets,select,showDialog} from './ui.js';
import {linkedPaymentGroups,packageLedger} from './profile.js';
import {annualVat} from './annual-vat.js';
import {monthlyWithholding} from './monthly-withholding.js';

const fields={
  MainFormData:'Induk',IncomeTaxInAYear:'PPh terutang setahun',NetIncomeBeforeTax:'Laba sebelum pajak',UnderpaymentIncomeTax:'PPh kurang/(lebih) bayar',OverpaymentIncomeTax:'Kode pilihan pengembalian',
  TaxableIncome:'Penghasilan kena pajak',IncomeTaxPayable:'PPh terutang',AnnualNetIncome:'Penghasilan neto setahun',UnderOrOverPaymentTax:'PPh kurang atau lebih bayar',
  ListOfOwnership:'Kepemilikan dan penyertaan',ListOfShareholders:'Pemegang saham',InvestmentList:'Penyertaan',PitrL1Form:'Lampiran 1',PitrL2Form:'Lampiran 2',PitrL3BForm:'Lampiran 3B',
  TotalDeliveryOfGoodsAndServices:'Jumlah penyerahan',DeliveryOfTaxableGoodsSubjectToVAT:'Penyerahan yang terutang PPN',ExportTangibleTaxableGoods:'Ekspor barang kena pajak berwujud',
  DomesticDeliveriesUsingOtherValue:'Penyerahan dalam negeri dengan nilai lain',DomesticDeliveriesUncollectedVAT:'Penyerahan dalam negeri yang PPN-nya tidak dipungut',
  OutputTaxMustBeSelfCollected:'Pajak keluaran yang dipungut sendiri',InputTaxCanBeCalculated:'Pajak masukan yang dapat diperhitungkan',
  CarryForwardOfInputTax:'Kompensasi pajak masukan',VATUnderOrOverPaid:'PPN kurang atau lebih bayar',SellingPrice:'Harga jual',TaxBase:'Dasar pengenaan pajak',OtherTaxBase:'DPP nilai lain',VAT:'PPN',
  TaxPeriodMonth:'Bulan pajak',TaxPeriodYear:'Tahun pajak',TaxYear:'Tahun pajak',Form1A:'Formulir 1A',GrossIncome:'Penghasilan bruto',A21IncomeTaxWithheld:'PPh 21 dipotong',A26IncomeTaxWithheld:'PPh 26 dipotong',
  A21IncomeTaxBorneByGovernment:'PPh 21 ditanggung pemerintah',TotalWithholding:'Jumlah dipotong atau dipungut',TotalIncomeTaxPaid:'Jumlah PPh disetor',IncomeTaxes:'Rincian PPh',
  AssetEndTaxYear:'Harta akhir tahun',DebtEndTaxYear:'Utang akhir tahun',Name:'Nama',TIN:'NPWP',IsDraft:'Konsep',DocumentNumber:'Nomor dokumen',DocumentDate:'Tanggal dokumen'
};
const numeric=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const versionName=f=>f.version?'Pembetulan '+f.version:'Normal';
const main=f=>rowsOf(f.parts.get('induk'))[0] || {};
const sortedParts=f=>[...f.parts.keys()].sort((a,b)=>a==='induk'?-1:b==='induk'?1:a.localeCompare(b,'id',{numeric:true}));

export function indicativeDates(forms,pkg) {
  const ledger=packageLedger(pkg);
  const dates=new Map();
  for(const f of forms){
    const available=new Set();
    for(const {payments} of linkedPaymentGroups(f,ledger))for(const p of payments){
      const match=/^(\d{4}-\d{2})-(\d{1,2})(?:T|$)/.exec(p.TransactionDate||p.PostingDate||'');
      if(match)available.add(match[1]+'-'+match[2].padStart(2,'0'));
    }
    if(available.size)dates.set(f,[...available].sort().join(', '));
  }
  return dates;
}

function formAmount(value) {
  if(typeof value==='string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))return numeric(Number(value));
  return numeric(value);
}

function withholdingAmount(data) {
  const groups=[
    {fields:[['A21IncomeTaxUnderpaidOverpaid','KB/LB PPh 21'],['A26IncomeTaxUnderpaidOverpaid','KB/LB PPh 26']]},
    {fields:[['A21IncomeTaxWithheld','potongan PPh 21'],['A26IncomeTaxWithheld','potongan PPh 26']],deduction:'A21IncomeTaxBorneByGovernment'}
  ];
  for(const {fields,deduction} of groups){
    const terms=fields.map(([key,label])=>({value:formAmount(data[key]),label})).filter(term=>term.value!==null);
    if(!terms.length)continue;
    let amount=terms.reduce((sum,term)=>sum+term.value,0);
    let basis=terms.map(term=>term.label).join(' + ');
    const borne=deduction?formAmount(data[deduction]):null;
    if(borne!==null){
      amount-=borne;
      basis+=' − PPh 21 ditanggung pemerintah';
    }
    return {amount,basis};
  }
  return {amount:null,basis:null};
}

export function financialPosition(f) {
  const data=main(f);
  let amount=null,basis=null;
  switch(f.type){
    case 'PPN': amount=formAmount(data.VATUnderOrOverPaid?.VAT);basis='PPN kurang/(lebih) bayar';break;
    case 'OP': amount=formAmount(data.UnderOrOverPaymentTax);basis='PPh OP kurang/(lebih) bayar';break;
    // The corporate overpayment field is a refund option, not a monetary credit.
    case 'BADAN': amount=formAmount(data.MainFormData?.UnderpaymentIncomeTax);basis='PPh Badan kurang/(lebih) bayar';break;
    case 'UNIFIKASI': amount=formAmount(data.TotalIncomeTaxPaid);basis='Jumlah PPh disetor pada induk';break;
    case 'PPH2126': ({amount,basis}=withholdingAmount(data));break;
  }
  return {amount,basis:amount===null?null:basis,status:amount===null?'Belum tersedia':amount===0?'Nihil':amount>0?'Kurang bayar':'Lebih bayar'};
}

function labelPart(form,part){
  if(part==='induk')return 'Induk';
  const name=form.parts.get(part)?.cap?.label?.split(' · ').at(-1);
  return name && name.length<160 && !name.startsWith('SPT ') && name.toLowerCase()!==part?part.toUpperCase()+' · '+name:part.toUpperCase();
}
function fieldCaption(path){
  return path.split('.').map(s=>fields[s]||s).join(' › ');
}
function display(value,path){
  if(typeof value==='boolean')return value?'Ya':'Tidak';
  if(typeof value==='number' && /(?:year|month|code|number|nomor|periode|(^|\.)tin)$/i.test(path))return String(value);
  return value;
}
export function findFields(form,query) {
  const term=query.trim().toLocaleLowerCase('id');
  if(!term)return [];
  const results=[];
  for(const part of sortedParts(form))for(const [index,row] of rowsOf(form.parts.get(part)).entries()){
    for(const [path,value] of flatten(row)){
      const caption=fieldCaption(path),text=[path,caption,String(value??''),String(display(value,path)??'')].join(' ').toLocaleLowerCase('id');
      if(text.includes(term))results.push({Bagian:part,Baris:index+1,Isian:caption,'Kode isian':path,Nilai:display(value,path)});
    }
  }
  return results;
}
export function partRows(f,part,raw=false) {
  const source=rowsOf(f.parts.get(part));
  if(part==='induk')return source.flatMap(r=>[...flatten(r)].map(([path,v])=>raw?{'Kode isian':path,Nilai:v}:{Isian:fieldCaption(path),'Kode isian':path,Nilai:display(v,path)}));
  if(raw)return source;
  return source.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[fields[k]?fields[k]+' ('+k+')':k,display(v,k)])));
}
function header(f,pkg){
  return [['Jenis',typeNames[f.type]||f.type],['Masa / tahun',f.period],['Versi',versionName(f)],
    ['WP',pkg.manifest.wp?.nama??''],['NPWP',pkg.manifest.wp?.npwp??''],['BPE',receiptNumber(f.meta)],['Tanggal lapor',f.reportDate??submittedDay(f.meta)]];
}
export function formSheets(forms,pkg,raw=false) {
  const sheets=[];
  for(const f of forms){
    const prefix=f.type+' '+f.period+' P'+f.version;
    for(const part of sortedParts(f))sheets.push({name:prefix+' '+part,rows:[...header(f,pkg),['Bagian',labelPart(f,part)],['Sumber',f.parts.get(part).path],[],...worksheet(partRows(f,part,raw))]});
  }
  return sheets;
}
function plainTable(rows){
  const table=el('table');
  for(const [i,values] of rows.entries()){
    const tr=el('tr');for(const v of values)tr.append(el(i===0?'th':'td',v??''));table.append(tr);
  }
  return table;
}
function printForms(forms,pkg) {
  const view=box('print-catalog');
  for(const f of forms){
    view.append(el('h1',(typeNames[f.type]||f.type)+' · '+f.period+' · '+versionName(f)),plainTable(header(f,pkg)));
    for(const part of sortedParts(f)){
      const rows=partRows(f,part);
      view.append(el('h2',labelPart(f,part)),rows.length?plainTable(worksheet(rows)):el('p','Bagian ini tidak memuat baris.'));
    }
  }
  const dialog=document.getElementById('dialog'),wasOpen=dialog.open;
  if(wasOpen)dialog.close();
  document.body.append(view);document.body.classList.add('print-catalog-active');
  try{window.print();}finally{view.remove();document.body.classList.remove('print-catalog-active');if(wasOpen)dialog.showModal();}
}
export function exportControls(forms,pkg){
  const buttons=[button('Excel gabungan',()=>exportSheets(formSheets(forms,pkg),'RAHASIA-SPT-gabungan',pkg.manifest.wp)),
    button('Cetak gabungan (PDF)',()=>printForms(forms,pkg))];
  buttons.forEach(b=>b.disabled=!forms.length);
  return box('toolbar',...buttons);
}
export function openForm(form,pkg,onVersionChange){
  const wp=pkg.manifest.wp;
  const content=box('form-body'),versions=pkg.forms.filter(f=>f.type===form.type&&f.period===form.period).sort((a,b)=>b.version-a.version);
  let part=sortedParts(form)[0],raw=false,locate='';
  function paint(){
    const version=select(versions.map(f=>[f.key,versionName(f)]),form.key,key=>{
      form=versions.find(f=>f.key===key);if(!form.parts.has(part))part=sortedParts(form)[0];locate='';onVersionChange?.(form);paint();
    },'Versi');
    const parts=select(sortedParts(form).map(p=>[p,labelPart(form,p)]),part,p=>{part=p;locate='';paint();},'Induk / lampiran');
    const controls=box('toolbar',version,parts,button(raw?'Tampilan formulir':'Kode field & lampiran lengkap',()=>{raw=!raw;paint();}),
      button(raw?'Excel data mentah':'Excel formulir',()=>exportSheets(formSheets([form],pkg,raw),'RAHASIA-SPT-'+form.type+'-'+form.period+'-P'+form.version,wp)),
      button('Cetak / PDF',()=>printForms([form],pkg)));
    if(versions.length>1) controls.append(button('Bandingkan versi',()=>{
      let other=versions.find(f=>f.version<form.version)||versions.find(f=>f.key!==form.key);
      const panel=box('');let selected=part;
      function diff(){
        const all=[...new Set([...sortedParts(form),...sortedParts(other)])];
        const rows=differences(payloads(other.parts.get(selected)),payloads(form.parts.get(selected)));
        panel.replaceChildren(select(versions.filter(f=>f.key!==form.key).map(f=>[f.key,versionName(f)]),other.key,k=>{other=versions.find(f=>f.key===k);diff();},'Versi pembanding'),
          select(all,selected,v=>{selected=v;diff();},'Bagian yang dibandingkan'),
          el('p',versionName(other)+' → '+versionName(form)+' · '+selected),dataTable(rows,{wp,name:'Perubahan',empty:'Tidak ada perubahan isian pada dua versi ini.'}));
      }
      diff();content.replaceChildren(panel,button('Kembali ke formulir',paint));
    }));
    const keyword=el('input');keyword.type='search';keyword.placeholder='Nama isian, kode, atau nilai';keyword.setAttribute('aria-label','Cari di seluruh bagian SPT');
    const hits=box('');
    keyword.oninput=()=>{
      const q=keyword.value.trim().toLocaleLowerCase('id');hits.replaceChildren();if(!q)return;
      const matched=findFields(form,q);
      hits.append(dataTable(matched,{wp,name:'Hasil pencarian formulir',empty:'Tidak ditemukan pada formulir ini.',openRow:row=>{
        part=row.Bagian;locate=part==='induk'?row['Kode isian']:String(row.Nilai??'');paint();
      }}));
    };
    const rows=partRows(form,part,raw);
    const table=dataTable(rows,{wp,name:labelPart(form,part)});
    const search=table.querySelector('input[type=search]');
    if(search&&locate){search.value=locate;search.dispatchEvent(new Event('input'));}
    content.replaceChildren(el('p',[pkg.manifest.wp?.nama,pkg.manifest.wp?.npwp,form.period,versionName(form)].filter(Boolean).join(' · ')),
      controls,keyword,hits,el('h3',labelPart(form,part)),el('p',form.parts.get(part).path,'hint'),
      table);
  }
  paint();showDialog((typeNames[form.type]||form.type)+' · '+form.period,content);
}
const vatAxes=[
  ['Penyerahan','TotalDeliveryOfGoodsAndServices.SellingPrice'],['PPN penyerahan','TotalDeliveryOfGoodsAndServices.VAT'],
  ['Penyerahan terutang','DeliveryOfTaxableGoodsSubjectToVAT.SellingPrice'],['PPN terutang','DeliveryOfTaxableGoodsSubjectToVAT.VAT'],
  ['Ekspor BKP berwujud','ExportTangibleTaxableGoods.SellingPrice'],['Penyerahan nilai lain','DomesticDeliveriesUsingOtherValue.SellingPrice'],
  ['DPP nilai lain','DomesticDeliveriesUsingOtherValue.OtherTaxBase'],['PPN nilai lain','DomesticDeliveriesUsingOtherValue.VAT'],
  ['Penyerahan PPN tidak dipungut','DomesticDeliveriesUncollectedVAT.SellingPrice'],['PPN tidak dipungut','DomesticDeliveriesUncollectedVAT.VAT'],
  ['Pajak keluaran','OutputTaxMustBeSelfCollected.VAT'],['Kompensasi masukan','CarryForwardOfInputTax.VAT'],
  ['Pajak masukan diperhitungkan','InputTaxCanBeCalculated.VAT'],['Kurang/(lebih) bayar','VATUnderOrOverPaid.VAT']
];
export function summaryPanels(forms,year,wp) {
  const current=forms.filter(f=>f.latest);
  const vats=current.filter(f=>f.type==='PPN').map(f=>{
    const source=main(f),row={Masa:f.period,Versi:versionName(f)};
    for(const [label,path] of vatAxes){const [key,sub]=path.split('.');row[label]=numeric(source[key]?.[sub]);}
    return row;
  });
  const payments=current.filter(f=>['PPH2126','UNIFIKASI'].includes(f.type)).map(f=>{
    const r=main(f);return {Masa:f.period,Jenis:typeNames[f.type],Versi:versionName(f),'Bruto':numeric(r.Form1A?.GrossIncome),'PPh 21':numeric(r.A21IncomeTaxWithheld),
      'PPh 26':numeric(r.A26IncomeTaxWithheld),'PPh 21 DTP':numeric(r.A21IncomeTaxBorneByGovernment),'Potong/pungut Unifikasi':numeric(r.TotalWithholding),'Setor Unifikasi':numeric(r.TotalIncomeTaxPaid)};
  });
  const calendar=forms.map(f=>({Masa:f.period,Jenis:typeNames[f.type]||f.type,Versi:versionName(f),'Batas pada sumber':f.dueDate??sptDay(f.meta.ExpectedReturnDate),
    'Batas setelah akhir pekan':f.filingDueDate,'Tanggal lapor':f.reportDate??submittedDay(f.meta),Ketepatan:f.filingLate==null?'Belum dinilai':f.filingLate?'Lewat batas':'Tepat'}));
  const annual=annualVat(forms,year);
  const withholding=monthlyWithholding(forms,year);
  const annualPanel=annual?card('Rekap PPN tahunan',
    el('p',annual.available+' dari 12 masa mempunyai versi SPT terakhir. Kompensasi dan posisi kurang/lebih bayar dibaca per masa. Kolom lainnya dijumlahkan untuk masa yang tersedia.','hint'),
    dataTable(annual.rows,{wp,name:'Rekap PPN tahunan',filename:'Rekap-PPN-'+year}),
    annual.notes.length?detail('Sumber angka PK',dataTable(annual.notes,{wp,name:'Sumber angka PK'})):null):null;
  const withholdingPanel=withholding.columns.length>1 || withholding.warnings.length?card('Rekap PPh potong/pungut',
    el('p','Nilai memakai versi terakhir per jenis dan masa. Buka sumber per pasal untuk melihat isian asal dan perhitungannya.','hint'),
    withholding.unreportedColumns.length?el('p','Kolom tanpa angka pada seluruh masa: '+withholding.unreportedColumns.join(', ')+'. Jumlah nilai tersedia pada kolom tersebut adalah 0.','hint'):null,
    ...withholding.warnings.map(text=>el('p',text,'notice')),
    withholding.columns.length>1?dataTable([...withholding.rows,withholding.total],{wp,name:'Rekap PPh potong/pungut',filename:'Rekap-PPh-'+year}):null,
    withholding.sources.length?detail('Sumber per pasal',dataTable(withholding.sources,{wp,name:'Sumber per pasal'})):null):null;
  return [annualPanel,card('PPN per masa',dataTable(vats,{wp,name:'PPN per masa'})),withholdingPanel,card('Potong dan pungut per masa',dataTable(payments,{wp,name:'Potong pungut'})),
    card('Kalender pelaporan',el('p','Untuk SPT normal, batas yang jatuh pada Sabtu atau Minggu digeser ke Senin. Periksa hari libur lain dan relaksasi sebelum menilai kepatuhan.','hint'),dataTable(calendar,{wp,name:'Kalender pelaporan'}))];
}
