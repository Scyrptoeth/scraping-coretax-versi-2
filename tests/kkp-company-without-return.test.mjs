import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexPackage} from '../extension/analisis/model.js';
import {buildIndex,indexStatus,indexSheets,completeIndexBook} from '../extension/analisis/kkp-index.js';
import {companyProvisionalSupport} from '../extension/analisis/kkp-company-without-return.js';
import {createXlsx} from '../extension/archive/table.js';
import {readZip,decodeText} from '../extension/archive/zip.js';

const owner='0000000000000017',aggregate='badan-fiktif',year='2026';
const field=n=>({SellingPrice:n});
function file(path,sumber,body,cap={}){
  return {path,cap:{lengkap:true,halaman:1,sumber,konteks:{npwp:owner},...cap},pages:[{IsSuccessful:true,Payload:body}]};
}
function vatRecord(month,revision=0){
  const mm=String(month).padStart(2,'0');
  return {RecordId:'spt-'+mm+'-'+revision,TaxpayerAggregateIdentifier:aggregate,ReturnSheetTypeCode:'VAT_VATR',
    TaxPeriodCode:mm+mm+year,ReturnSheetModel:revision?'Amendment '+revision:'Normal'};
}
function source(row,amount=100){
  const period=year+'-'+row.TaxPeriodCode.slice(0,2),ver=Number(row.RecordId.split('-').at(-1));
  const body={CurrencyCode:'IDR',TotalDeliveryOfGoodsAndServices:field(amount),ExportTangibleTaxableGoods:field(10),
    DomesticDeliveriesCollectedByVATCollector:field(25),DomesticDeliveriesUncollectedVAT:field(2),DomesticDeliveriesExemptedVAT:field(0),
    DeliveriesOfGoodsNoVAT:field(0),DomesticDeliveriesOtherThanOtherValue:field(0),DomesticDeliveriesUsingOtherValue:field(0),
    DomesticDeliveriesToTourist:field(0),DomesticDeliveriesSelfCollected:field(0),DeliveryOfTaxableGoodsSubjectToVAT:field(100)};
  return file('spt/PPN/'+period+'/p0'+ver+'_'+row.RecordId+'/induk.json','sptisi',{FormData:JSON.stringify(body)},
    {konteks:{npwp:owner,bagian:'induk',spt:{jenis:'VAT_VATR',npwp:owner,tahun:year,masa:row.TaxPeriodCode,pemb:ver,recordId:row.RecordId}}});
}
function fixture(count=9){
  const profile=file('profil/informasi-umum.json','info',{GeneralInformation:{TaxpayerType:'TA002',TaxpayerCategory:'C_LC',UniqueIdentificationNumber:owner,AggregateIdentifier:aggregate}});
  const records=Array.from({length:count},(_,i)=>vatRecord(i+1)),amended=vatRecord(1,1);
  records.push(amended,{RecordId:'spop',TaxpayerAggregateIdentifier:aggregate,ReturnSheetTypeCode:'LBT_LBTR',TaxTypeCode:'LBT_LBT',TaxPeriodCode:'01122026'});
  const directory=file('spt/daftar.json','sptdaftar',{Data:records,TotalRecords:records.length},
    {total:records.length,baris:records.length,payload:{TaxpayerAggregateIdentifier:aggregate,First:0,Filters:[],isArchieved:false}});
  const src=records.filter(r=>r.ReturnSheetTypeCode==='VAT_VATR').map(r=>source(r,r===amended?40:100));
  return {entries:[profile,directory,...src],report:{valid:true},manifest:{wp:{npwp:owner},gagal:[],
    opsi:{periode:{from:{y:2026,m:1},to:{y:2026,m:12}},jenisSpt:['VAT_VATR','ICT_RCITR']}}};
}
const result=p=>buildIndex(indexPackage(p),year);
const get=p=>result(p).groups.find(g=>g.key==='BADAN/B');
const d=p=>p.entries[1],items=p=>d(p).pages[0].Payload.Data;
test('nine periods, latest VAT revision and eight comparison positions stay apart from any officer assessment',()=>{
  const p=fixture(),g=get(p),line=g.lines[0];
  assert.equal(g.lines.length,8);assert.ok(g.lines.every(l=>l.withoutReturn&&l.amount===0));
  assert.equal(line.prefill,null);assert.equal(line.observedPrefill.amount,840);assert.equal(line.observedPrefill.periods.length,9);
  assert.equal(line.details[0].Pembetulan,1);assert.equal(line.details[0]['Dipungut sendiri menurut empat komponen'],0);
  assert.equal(line.details[0]['Pembanding enam kelompok'],127);assert.equal(g.support[1].Nilai,1143);assert.equal(g.support[2].Nilai,303);
  assert.ok(g.lines.slice(1).every(l=>l.prefill===null&&l.observedPrefill===null));
  const book=completeIndexBook(indexPackage(p),year,result(p),new Map(),{});
  assert.equal(book.find(s=>s.name==='Temuan Sementara').rows.length,1);
  assert.equal(book.find(s=>s.name==='INDUK').rows.length,1);assert.equal(indexStatus(g,new Map()).tested,0);
  assert.equal(get(fixture(12)).lines[0].prefill,1140);
});
test('identity, explicit SPT, uncertain document type, selection, failures and conflicting directory prevent the index',()=>{
  for(const change of [
    p=>{p.report.valid=false;},p=>{p.entries[0].pages[0].Payload.GeneralInformation.TaxpayerType='TA001';},
    p=>{p.entries[0].pages[0].Payload.GeneralInformation.UniqueIdentificationNumber='0000000000000018';},
    p=>{p.entries[0].cap.konteks.npwp='0000000000000018';},p=>{p.entries[0].cap.lengkap=false;},
    p=>{p.manifest.opsi.periode.from.m=2;},p=>{p.manifest.opsi.jenisSpt=['VAT_VATR'];},
    p=>{d(p).cap.lengkap=false;},p=>{d(p).cap.payload.Filters=[{}];},p=>{p.manifest.gagal=['spt/daftar.json'];},
    p=>{items(p)[0].RecordId='spop';},p=>{items(p)[0].TaxpayerAggregateIdentifier='wp-lain';},
    p=>{items(p).at(-1).ReturnSheetTypeCode='TIDAK_DIKENAL';},p=>{items(p)[0].ReturnSheetTypeCode='ICT_RCITR';},
    p=>{p.entries.push(structuredClone(d(p)));},
  ]){const p=fixture();change(p);assert.equal(get(p),undefined);}
});
test('missing latest detail, conflicting currency and invalid amount withhold the quick-copy subtotal',()=>{
  for(const mutate of [
    p=>{p.entries.pop();},p=>{p.entries.at(-1).cap.konteks.npwp='0000000000000018';},
    p=>{p.entries[3].cap.lengkap=false;},p=>{items(p)[0].ReturnSheetModel='Amendment 1';},
    p=>{const b=JSON.parse(p.entries[3].pages[0].Payload.FormData);b.CurrencyCode='USD';p.entries[3].pages[0].Payload.FormData=JSON.stringify(b);},
    p=>{const b=JSON.parse(p.entries[3].pages[0].Payload.FormData);b.TotalDeliveryOfGoodsAndServices.SellingPrice=null;p.entries[3].pages[0].Payload.FormData=JSON.stringify(b);}
  ]){const p=fixture();mutate(p);const g=get(p);assert.ok(g);assert.equal(g.lines[0].observedPrefill,null);assert.equal(g.support[1].Nilai,null);}
  const p=fixture(),entry=p.entries[3],b=JSON.parse(entry.pages[0].Payload.FormData);
  b.DomesticDeliveriesUncollectedVAT.SellingPrice=null;entry.pages[0].Payload.FormData=JSON.stringify(b);
  const g=get(p);assert.ok(g.lines[0].observedPrefill);assert.equal(g.support[1].Nilai,null);assert.notEqual(g.support[0].Nilai,null);
});
test('separate net and balance calculations consume reviewed amounts and never set an officer result on derived positions',async()=>{
  const g=get(fixture()),reviewed=new Map(),numbers=[150,60,30,null,null,8,3,null];
  g.lines.forEach((line,i)=>{if(numbers[i]!==null)reviewed.set(line.id,{menurutPetugas:numbers[i]});});
  const rows=companyProvisionalSupport(g,reviewed);
  assert.equal(rows.find(r=>r.Uraian.startsWith('Penghasilan neto berdasarkan')).Nilai,60);
  assert.equal(rows.find(r=>r.Uraian.startsWith('PPh kurang/(lebih) bayar berdasarkan')).Nilai,5);
  assert.equal(rows.find(r=>r.Uraian==='Penghasilan kena pajak').Nilai,null);assert.ok(!reviewed.has(g.lines[3].id));
  const sheet=indexSheets(g,reviewed),zip=await readZip(await createXlsx({sheets:[sheet]}));
  const xml=decodeText(zip.get('xl/worksheets/sheet1.xml').data);
  assert.match(xml,/COUNT\(E7,E8,E9\)=3,E7-E8-E9/);assert.match(xml,/COUNT\(E12,E13\)=2,E12-E13/);
});
