import {flatten,payloads,receiptFields,rowsOf,sptDay,submittedDay,typeNames,worksheet} from './model.js';
import {amendmentSheets,compareSptPart} from './spt-amendment.js';
import {box,button,card,dataTable,detail,el,exportSheets,notice,select,showDialog} from './ui.js';
import {linkedPaymentGroups,packageLedger} from './profile.js';
import {annualVat} from './annual-vat.js';
import {monthlyWithholding} from './monthly-withholding.js';
import {vatCoverage} from './vat-coverage.js';
import {sourceAmount as formAmount,withholdingForm,withholdingPeriods,withholdingSections,withholdingSheetRows} from './withholding-forms.js';
import {fieldLabel,fieldValue,presentRows,sourceLabel} from './display-fields.js';
import {sptChoice,sptField} from './spt-labels.js';

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

export function partTitle(form,part){
  if(part==='induk')return 'Induk';
  const cap=form.parts.get(part)?.cap,name=cap?.konteks?.labelBagian||cap?.label?.split(' · ').at(-1);
  return name && name.length<160 && !name.startsWith('SPT ') && !name.endsWith('.json') && name.toLowerCase()!==part?name:part.toUpperCase();
}
const labelPart=partTitle;
export function emptyAnnexes(form){
  return sortedParts(form).filter(part=>{
    const entry=form.parts.get(part),pages=entry.pages||[],cap=entry.cap||{};
    if(part==='induk'||part.endsWith('-total')||!pages.length||cap.lengkap===false||[cap.total,cap.baris].some(n=>n!=null&&n!==0))return false;
    return pages.every(page=>{
      if(!page||page.IsSuccessful===false||page.Errors?.length)return false;
      const body=page.Payload??page,rows=Array.isArray(body)?body:body?.Data??body?.rows;
      return Array.isArray(rows)&&rows.length===0&&(body.TotalRecords===0||body.TotalRecords==null&&(cap.total===0||cap.lengkap===true&&cap.baris===0));
    });
  });
}
const vatAmountKeys=['SellingPrice','TaxBase','OtherTaxBase','VAT','STLG','SalesTaxLuxuryGoods'];
export function vatFormSummary(form){
  if(form.type!=='PPN')return [];
  const summary=[];
  for(const [section,fields] of Object.entries(main(form))){
    if(!fields||typeof fields!=='object'||Array.isArray(fields))continue;
    const row={Uraian:sptFieldLabel(section)};
    for(const key of vatAmountKeys){
      for(const field of [key,'Total'+key]){
        if(!Object.hasOwn(fields,field)||typeof fields[field]==='object'&&fields[field]!==null)continue;
        const label=sptFieldLabel(field);
        if(!Object.hasOwn(row,label))row[label]=fields[field];
        else row[label+' ('+sptFieldLabel(key)+')']=fields[field];
      }
    }
    if(Object.keys(row).length>1)summary.push(row);
  }
  return summary;
}
const monthNames=Array.from({length:12},(_,i)=>new Intl.DateTimeFormat('id-ID',{month:'long',timeZone:'UTC'}).format(Date.UTC(2000,i,1)));
export function periodTitle(period){
  const match=/^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  return match?monthNames[Number(match[2])-1]+' '+match[1]:period;
}
export function sptFieldLabel(path){
  return path.split('.').map(s=>/^\d+$/.test(s)?'Baris '+(Number(s)+1):(sptField(s,fields)||fieldLabel(s))).join(' › ');
}
export function sptFieldValue(path,value){
  if(typeof value==='boolean')return value?'Ya':'Tidak';
  if(typeof value==='number' && /(?:year|month|code|number|nomor|periode|(^|\.)tin)$/i.test(path))return String(value);
  const key=path.split('.').at(-1);
  return sptChoice(key,value)??fieldValue(key,value);
}
export function findFields(form,query) {
  const term=query.trim().toLocaleLowerCase('id');
  if(!term)return [];
  const results=[];
  for(const part of sortedParts(form))for(const [index,row] of rowsOf(form.parts.get(part)).entries()){
    for(const [path,value] of flatten(row)){
      const caption=sptFieldLabel(path),text=[path,caption,String(value??''),String(sptFieldValue(path,value)??'')].join(' ').toLocaleLowerCase('id');
      if(text.includes(term))results.push({Bagian:part,Baris:index+1,Isian:caption,'Kode isian':path,Nilai:sptFieldValue(path,value)});
    }
  }
  return results;
}
export function partRows(f,part,raw=false) {
  const source=rowsOf(f.parts.get(part));
  if(part==='induk')return source.flatMap(r=>[...flatten(r)].map(([path,v])=>{
    if(raw)return {'Kode isian':path,Nilai:v};
    const row={Isian:sptFieldLabel(path),Nilai:sptFieldValue(path,v)};
    Object.defineProperty(row,'Kode isian',{value:path});
    return row;
  }));
  if(raw)return source;
  return presentRows(source,{label:sptFieldLabel,value:sptFieldValue});
}
export function formReceipts(meta){
  const info=receiptFields(meta);
  if(Object.hasOwn(info,'Nomor pada BpsNo')){
    info['Nomor bukti penerimaan surat']=info['Nomor pada BpsNo'];
    delete info['Nomor pada BpsNo'];
  }
  return info;
}
function comparisonRows(rows){
  return rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>{
    if(typeof value==='string'&&key.startsWith('Sumber')){
      const [path,...location]=value.split(' · ');
      return [key,[sourceLabel(path),...location].join(' · ')];
    }
    if(key==='Kolom nomor dokumen'&&value)return [key,value.split(', ').map(sptFieldLabel).join(', ')];
    if(key==='Isian'&&value)return [key,sptFieldLabel(value)];
    if((key==='Sebelumnya'||key==='Sekarang')&&row.Isian)return [key,sptFieldValue(row.Isian,value)];
    return [key,value];
  })));
}
function header(f,pkg){
  return [['Jenis',typeNames[f.type]||f.type],['Masa / tahun',f.period],['Versi',versionName(f)],
    ['WP',pkg.manifest.wp?.nama??''],['NPWP',pkg.manifest.wp?.npwp??''],...Object.entries(formReceipts(f.meta)),['Tanggal lapor',f.reportDate??submittedDay(f.meta)]];
}
export function formSheets(forms,pkg,raw=false) {
  const sheets=[];
  for(const f of forms){
    const prefix=f.type+' '+f.period+' P'+f.version;
    const potput=raw?null:withholdingForm(f,pkg.manifest.wp);
    for(const part of sortedParts(f)){
      const content=potput&&part==='induk'?withholdingSheetRows(potput):worksheet(partRows(f,part,raw));
      sheets.push({name:prefix+' '+part,rows:[...header(f,pkg),['Bagian',labelPart(f,part)],['Sumber',f.parts.get(part).path],[],...content]});
    }
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
export function printSptList(rows,wp){
  const title='Daftar SPT',view=box('print-catalog spt-print-list',el('h1',title),
    el('p',[wp?.nama,wp?.npwp].filter(Boolean).join(' · ')),el('p',rows.length+' SPT pada pilihan ini'));
  if(rows.length){
    const keys=['Masa','Jenis','Versi','Nomor penerimaan dokumen','BPE','Nomor bukti penerimaan surat','Status nilai','Nilai pada induk','Tanggal lapor','Ketepatan'].filter(k=>rows.some(r=>Object.hasOwn(r,k)));
    const data=rows.map(row=>keys.map(k=>{
      const value=row[k];
      if(k==='Masa')return periodTitle(value);
      return typeof value==='number'?value.toLocaleString('id-ID'):value??'—';
    }));
    view.append(plainTable([keys,...data]));
  }
  printCatalog(view);
}
function printCatalog(view){
  const dialog=document.getElementById('dialog'),wasOpen=dialog.open;
  if(wasOpen)dialog.close();
  document.body.append(view);document.body.classList.add('print-catalog-active');
  try{window.print();}finally{view.remove();document.body.classList.remove('print-catalog-active');if(wasOpen)dialog.showModal();}
}
function printForms(forms,pkg) {
  const view=box('print-catalog');
  for(const f of forms){
    view.append(el('h1',(typeNames[f.type]||f.type)+' · '+f.period+' · '+versionName(f)),plainTable(header(f,pkg)));
    for(const part of sortedParts(f)){
      const potput=part==='induk'?withholdingForm(f,pkg.manifest.wp):null;
      if(potput){
        view.append(el('h2',labelPart(f,part)),plainTable(withholdingSheetRows(potput)));continue;
      }
      const rows=partRows(f,part);
      view.append(el('h2',labelPart(f,part)),rows.length?plainTable(worksheet(rows)):el('p','Bagian ini tidak memuat baris.'));
    }
  }
  printCatalog(view);
}
export function exportControls(forms,pkg){
  const buttons=[button('Excel gabungan',()=>exportSheets(formSheets(forms,pkg),'RAHASIA-SPT-gabungan',pkg.manifest.wp)),
    button('Cetak gabungan (PDF)',()=>printForms(forms,pkg))];
  buttons.forEach(b=>b.disabled=!forms.length);
  return box('toolbar',...buttons);
}
export function formPanel(form,pkg,onVersionChange){
  const wp=pkg.manifest.wp;
  const coverageByForm=new Map();
  const withholdingByForm=new Map();
  const content=box('form-body'),versions=pkg.forms.filter(f=>f.type===form.type&&f.period===form.period).sort((a,b)=>b.version-a.version);
  let part=sortedParts(form)[0],raw=false,locate='';
  function paint(){
    paintForm();
    const main=form.parts.get(part), comparison=main.cap?.cuplikanSpt;
    if(!Array.isArray(comparison?.pembanding))return;
    const alternatives=new Set(comparison.pembanding);
    const sources=pkg.entries.filter(e=>alternatives.has(e.path) && e.cap?.cuplikanSpt?.utama===main.path);
    if(!sources.length)return;
    content.append(el('p','Sumber formulir · '+main.cap.asal+'. '+comparison.alasan));
    for(const source of sources){
      const body=box(''),panel=detail(source.cap.label,body);
      panel.addEventListener('toggle',()=>{
        if(panel.open && !body.childNodes.length){
          const rows=rowsOf(source);
          body.append(dataTable(raw?rows:presentRows(rows,{label:sptFieldLabel,value:sptFieldValue}),{wp,name:source.cap.label,incremental:true}));
        }
      });
      content.append(panel);
    }
  }
  function paintForm(){
    const version=select(versions.map(f=>[f.key,versionName(f)]),form.key,key=>{
      form=versions.find(f=>f.key===key);if(!form.parts.has(part))part=sortedParts(form)[0];locate='';onVersionChange?.(form);paint();
    },'Versi');
    const parts=select(sortedParts(form).map(p=>[p,labelPart(form,p)]),part,p=>{part=p;locate='';paint();},'Induk / lampiran');
    const empty=emptyAnnexes(form),picker=parts.querySelector('select');
    if(empty.length){
      const group=el('optgroup');group.label='Lampiran kosong';
      for(const option of [...picker.options])if(empty.includes(option.value))group.append(option);
      picker.append(group);picker.value=part;
    }
    const controls=box('toolbar',version,parts,button(raw?'Tampilan formulir':'Lihat data asli',()=>{raw=!raw;paint();}),
      button(raw?'Excel data mentah':'Excel formulir',()=>exportSheets(formSheets([form],pkg,raw),'RAHASIA-SPT-'+form.type+'-'+form.period+'-P'+form.version,wp)),
      button('Cetak / PDF',()=>printForms([form],pkg)));
    if(versions.length>1) controls.append(button('Bandingkan versi',()=>{
      let other=versions.find(f=>f.version<form.version)||versions.find(f=>f.key!==form.key);
      const panel=box('');let selected=part;
      function diff(){
        const all=[...new Set([...sortedParts(form),...sortedParts(other)])];
        const comparison=compareSptPart(selected,other.parts.get(selected),form.parts.get(selected));
        const partName=key=>partTitle(form.parts.has(key)?form:other,key);
        const title=versionName(other)+' → '+versionName(form)+' · '+partName(selected);
        const display=rows=>raw?rows:comparisonRows(rows);
        panel.replaceChildren(select(versions.filter(f=>f.key!==form.key).map(f=>[f.key,versionName(f)]),other.key,k=>{other=versions.find(f=>f.key===k);diff();},'Versi pembanding'),
          select(all.map(key=>[key,partName(key)]),selected,v=>{selected=v;diff();},'Bagian yang dibandingkan'),
          el('p',title));
        if(comparison.kind==='fields'){
          panel.append(dataTable(display(comparison.changes),{wp,name:'Perubahan',empty:'Tidak ada perubahan isian pada dua versi ini.'}));return;
        }
        panel.append(button('Excel perbandingan lampiran',()=>exportSheets(amendmentSheets(comparison,title),
          'Perbandingan-'+form.type+'-'+form.period+'-'+selected+'-P'+other.version+'-P'+form.version,wp)),
          dataTable(display([comparison.summary]),{wp,name:'Ringkasan perbandingan lampiran'}),
          ...comparison.notes.map(note=>el('p',note,'hint')),
          dataTable(display(comparison.changes),{wp,name:'Perubahan',incremental:true,filename:'Perubahan-'+selected,
            empty:comparison.unmatched.length||comparison.notes.length?'Belum ditemukan perubahan pada dokumen yang dapat dicocokkan.':'Tidak ada perubahan dokumen pada kedua versi.'}));
        if(comparison.totals.length)panel.append(dataTable(display(comparison.totals),{wp,name:'Nominal lampiran'}));
        if(comparison.unmatched.length)panel.append(dataTable(display(comparison.unmatched),{wp,name:'Baris yang perlu dicocokkan',incremental:true}));
      }
      diff();content.replaceChildren(panel,button('Kembali ke formulir',paint));
    }));
    const keyword=el('input');keyword.type='search';keyword.placeholder='Nama isian, kode, atau nilai';keyword.setAttribute('aria-label','Cari di seluruh bagian SPT');
    const hits=box('');
    keyword.oninput=()=>{
      const q=keyword.value.trim().toLocaleLowerCase('id');hits.replaceChildren();if(!q)return;
      const matched=findFields(form,q),links=new Map();
      const shown=matched.map(row=>{
        const item=raw?row:{Bagian:labelPart(form,row.Bagian),Baris:row.Baris,Isian:row.Isian,Nilai:row.Nilai};
        links.set(item,row);return item;
      });
      hits.append(dataTable(shown,{wp,name:'Hasil pencarian formulir',empty:'Tidak ditemukan pada formulir ini.',openRow:item=>{
        const row=links.get(item);part=row.Bagian;locate=part==='induk'?(raw?row['Kode isian']:row.Isian):String(row.Nilai??'');paint();
      }}));
    };
    const rows=partRows(form,part,raw);
    const table=dataTable(rows,{wp,name:labelPart(form,part)});
    const search=table.querySelector('input[type=search]');
    if(search&&locate){search.value=locate;search.dispatchEvent(new Event('input'));}
    const info=el('dl',null,'spt-form-info'),meta=form.meta||{};
    for(const [name,value] of [...header(form,pkg),['Status pelaporan',fieldValue('ReturnSheetStatusCode',meta.ReturnSheetStatusCode)],['Kanal',fieldValue('ChannelCode',meta.ChannelCode)]])
      if(value!==null&&value!==undefined&&value!=='')info.append(box('spt-form-pair',el('dt',name),el('dd',name==='Masa / tahun'?periodTitle(value):value)));
    content.replaceChildren(info,controls);
    if(empty.length){
      const shortcuts=empty.map(key=>button(labelPart(form,key),()=>{part=key;locate='';paint();}));
      content.append(detail(empty.length+' lampiran kosong',box('spt-empty-annexes',...shortcuts)));
    }
    if(!coverageByForm.has(form))coverageByForm.set(form,vatCoverage(form,pkg));
    const coverage=coverageByForm.get(form);
    if(coverage){
      const summary=coverage.received+' dari 8 berkas diterima · '+coverage.verified+' dari 8 bagian terverifikasi';
      content.append(detail('Cakupan SPT PPN · '+summary,box('',
        dataTable(coverage.rows,{wp,name:'Cakupan delapan bagian PPN'}),
        button('Excel cakupan PPN',()=>exportSheets([{name:'Cakupan PPN',rows:[...header(form,pkg),['ID rekaman',form.id],
          ['Berkas diterima',coverage.received],['Bagian terverifikasi',coverage.verified],[],...worksheet(coverage.rows)]}],
          'Cakupan-PPN-'+form.period+'-P'+form.version,wp)))));
    }
    content.append(keyword,hits,el('h3',labelPart(form,part)));
    if(raw)content.append(el('p',form.parts.get(part).path,'hint'));
    if(!withholdingByForm.has(form))withholdingByForm.set(form,withholdingForm(form,wp));
    const potput=withholdingByForm.get(form);
    if(part==='induk'&&potput&&!raw&&!locate){
      for(const [name,items] of withholdingSections(potput)){
        const openRow=items===potput.attachments?r=>{
          if(!form.parts.has(r.Kode)){notice('Lampiran ini belum tersedia dalam versi yang dipilih.');return;}
          part=r.Kode;locate='';paint();
        }:undefined;
        const visible=items.map(({Isian,Sumber,...row})=>{
          if(row.Jenis)row.Jenis=sptFieldValue('Type',row.Jenis);
          return row;
        });
        content.append(el('h4',name),dataTable(visible,{wp,name,openRow,incremental:true,filename:name+'-'+form.period+'-P'+form.version}));
      }
      content.append(...potput.notes.map(note=>el('p',note,'hint')));
    }else if(part==='induk'&&form.type==='PPN'&&!raw&&!locate){
      const summary=vatFormSummary(form);
      if(!summary.length){content.append(table);return;}
      content.append(el('h4','Ringkasan induk PPN'),
        el('p','Angka berasal dari induk PPN '+periodTitle(form.period)+' · '+versionName(form)+'.','hint'),
        dataTable(summary,{wp,name:'Ringkasan induk PPN',filename:'Ringkasan-induk-PPN-'+form.period+'-P'+form.version,
          rowAction:{title:'Sumber',control:row=>button('Lihat isian',()=>{locate=row.Uraian;paint();})}}),
        detail('Seluruh isian induk PPN',table));
    }else{
      if(part==='induk'&&form.type==='PPN'&&!raw&&locate)content.append(button('Kembali ke ringkasan induk PPN',()=>{locate='';paint();}));
      content.append(table);
    }
  }
  paint();return content;
}
export function openForm(form,pkg,onVersionChange){
  showDialog((typeNames[form.type]||form.type)+' · '+periodTitle(form.period),formPanel(form,pkg,onVersionChange));
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
  const payments=withholdingPeriods(forms,year,wp);
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
  return [annualPanel,card('PPN per masa',dataTable(vats,{wp,name:'PPN per masa'})),withholdingPanel,
    card('Potong dan pungut per masa',dataTable(payments.rows,{wp,name:'Potong pungut',filename:'Induk-potong-pungut-'+year}),
      ...payments.notes.map(note=>el('p',note,'hint'))),
    card('Kalender pelaporan',el('p','Untuk SPT normal, batas yang jatuh pada Sabtu atau Minggu digeser ke Senin. Periksa hari libur lain dan relaksasi sebelum menilai kepatuhan.','hint'),dataTable(calendar,{wp,name:'Kalender pelaporan'}))];
}
