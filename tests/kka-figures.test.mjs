import assert from 'node:assert/strict';
import test from 'node:test';
import {kkaFigures} from '../extension/analisis/kka-figures.js';

const owner='0000000000000021',other='0000000000000089';
const row=(out,key,needle)=>out.tables.find(t=>t.key===key).rows.find(r=>r[0].includes(needle));
const pkg=()=>({forms:[],entries:[],manifest:{wp:{npwp:owner},dibuat:'2026-01-31T15:00:00Z'},report:{valid:true}});
function add(p,type,period,version,body,part='induk',id=type+'-'+period+'-'+version){
  const year=period.slice(0,4),key='spt/'+type+'/'+period+'/p0'+version+'_'+id;
  const e={path:key+'/'+part+'.json',cap:{lengkap:true,konteks:{npwp:owner,bagian:part},...Array.isArray(body)&&{total:body.length}},
    pages:[{Payload:Array.isArray(body)?{Data:body,TotalRecords:body.length}:body}]};
  let f=p.forms.find(f=>f.id===id);
  if(!f){f={key,id,period,year,type,version,parts:new Map(),meta:{}};p.forms.push(f);}
  f.parts.set(part,e);p.entries.push(e);return e;
}
function company(p,y,v=0){
  const nodes=[['4020',200],['5020',80],['4300',120],['5400',70],['4500',50],['5001',60],['5314',9]];
  const body={MainFormData:{IncomeTaxInAYear:10,FiscalNetIncomeAfterTax:51},L1aFormData:{
    L1aTreeData:nodes.map(([code,n])=>({Data:{AccountCode:code,Amount:n}})),L1aTreeTotalRow:{Amount:40},
    L1aAssets:{AC1101:12,AC1122:30,AC1401:15,AC1500:70,AC1699:30,AC1700:100},
    L1aLiabilitiesAndEquity:{AC2102:13,AC2229:20,AC2999:45,AC3299:55}}};
  add(p,'BADAN',y,v,body);return body;
}
function ledger(p,period,records,annual=false){
  const [year,month]=period.split('-');
  const e={path:'bukubesar/'+(annual?year+'-setahun':period)+'.json',cap:{lengkap:true,konteks:{npwp:owner,tahun:year,...!annual&&{masa:Number(month)}},
    total:records.length},pages:[{Payload:{TotalRecords:records.length,Data:records}}]};
  p.entries.push(e);return e;
}
const payment=(id,date,amount,extra={})=>({RecordId:id,PostingDate:date,Amount:amount,IsCancelled:false,PeriodCode:'01012025',AccountingTypeCode:'Payment',...extra});

test('compares latest corporate statements, keeps signs, exposes ratio inputs and reconciles six cash-flow components',()=>{
  const p=pkg();company(p,'2024');const b=company(p,'2025',1);company(p,'2025',0);
  b.L1aFormData.L1aAssets.AC1122=33;b.L1aFormData.L1aAssets.AC1401=13;
  b.L1aFormData.L1aLiabilitiesAndEquity.AC2102=15;
  const o=kkaFigures(p,'2025',{principal:6});
  assert.deepEqual(o.tables.map(t=>[t.key,t.rows.length-1]),[['4.1',11],['4.2',8],['5.3',12]]);
  assert.deepEqual(row(o,'4.1','Peredaran usaha').slice(1,5),[200,200,0,0]);
  assert.match(row(o,'4.1','Peredaran usaha').at(-1),/p01.*4020/);
  assert.equal(row(o,'4.2','setelah PPh')[3],15);
  assert.equal(row(o,'5.3','Perkiraan arus kas operasi')[1],40);
  assert.equal(row(o,'5.3','Kas terhadap potensi')[1],2);
  assert.ok(o.sheet.rows.some(r=>r[0]==='Perubahan piutang usaha'&&r[1]===-3));
  assert.equal(o.sheet.name,'L-13');
  for(const t of o.tables)assert.ok(o.sheet.rows.some(r=>r[0]===t.title));
  assert.equal(row(kkaFigures(p,2025,{principal:0}),'5.3','Kas terhadap potensi')[1],null);
  delete b.L1aFormData.L1aAssets.AC1122;
  assert.equal(row(kkaFigures(p,2025),'5.3','Perkiraan arus kas operasi')[1],null);
});

test('uncertain owner, duplicate last revision, unsupported currency and missing years never produce corporate amounts',()=>{
  for(const issue of ['owner','revision','currency','invalid']){
    const p=pkg(),body=company(p,'2025');
    if(issue==='owner')p.entries[0].cap.konteks.npwp=other;
    if(issue==='currency')body.CurrencyCode='USD';
    if(issue==='revision')add(p,'BADAN','2025',0,body,'induk','other-copy');
    if(issue==='invalid')p.report.valid=false;
    const data=kkaFigures(p,2025);
    assert.equal(row(data,'4.1','Peredaran usaha')[2],null,issue);
    assert.equal(row(data,'4.2','GPM')[3],null,issue);
  }
  const o=kkaFigures({},'2025');assert.equal(row(o,'4.1','Peredaran usaha')[2],null);
  assert.ok(o.notes.some(n=>n.includes('Rasio Badan')));
});

test('uses distinct recipients, signed VAT, three most recent consecutive tax periods and withholds an incomplete annual sum',()=>{
  const p=pkg();
  for(let m=1;m<=12;m++){
    const period='2025-'+String(m).padStart(2,'0');
    add(p,'PPH2126',period,0,{Form1A:{GrossIncome:0}});add(p,'PPH2126',period,0,[{TIN:owner},{TIN:other}],'l1a');
    add(p,'PPN',period,0,{TotalDeliveryOfGoodsAndServices:{SellingPrice:10},VATUnderOrOverPaid:{VAT:-1}});
  }
  add(p,'PPN','2026-01',0,{TotalDeliveryOfGoodsAndServices:{SellingPrice:22}});
  add(p,'PPN','2025-12',1,{TotalDeliveryOfGoodsAndServices:{SellingPrice:20},VATUnderOrOverPaid:{VAT:0}});
  const o=kkaFigures(p,2025);assert.equal(row(o,'4.1','kurang atau lebih bayar')[2],-11);
  assert.equal(row(o,'4.1','Penghasilan bruto PPh 21')[2],0);assert.equal(row(o,'4.1','Penerima penghasilan')[2],2);
  assert.equal(row(o,'5.3','tiga masa PPN')[1],52);
  assert.match(row(o,'5.3','tiga masa PPN')[3],/2026-01/);
  p.forms.find(f=>f.type==='PPN'&&f.period==='2025-12'&&f.version===1).parts.get('induk').cap.lengkap=false;
  p.forms.find(f=>f.type==='PPH2126'&&f.period==='2025-03').parts.get('l1a').pages[0].Payload.Data[0].TIN='';
  const bad=kkaFigures(p,2025);
  assert.equal(row(bad,'4.1','Penerima penghasilan')[2],null);
  assert.equal(row(bad,'4.1','Penyerahan PPN')[2],null);assert.equal(row(bad,'5.3','tiga masa PPN')[1],null);
});

test('rolling book-date window combines fiscal-year and monthly files once; zero, absence, cancellations and conflicts stay distinct',()=>{
  const p=pkg();const active=payment('a','2025-2-1',40),old=payment('b','2025-01-31',33);
  const cancelled=payment('c','2025-02-05',10,{IsCancelled:true});
  const annual=payment('d','2026-01-31',4,{PeriodCode:'01122025'});
  ledger(p,'2025-01',[active,old,cancelled]);const e=ledger(p,'2025-01',[active,annual],true);
  assert.equal(row(kkaFigures(p,2024),'5.3','Pembayaran tercatat')[1],44);
  e.pages[0].Payload.Data[0]={...active,Amount:4};
  assert.equal(row(kkaFigures(p,2025),'5.3','Pembayaran tercatat')[1],null);
  const empty=pkg();assert.equal(row(kkaFigures(empty,2025),'5.3','Pembayaran tercatat')[1],null);
  ledger(empty,'2025-01',[]);assert.equal(row(kkaFigures(empty,2025),'5.3','Pembayaran tercatat')[1],0);
});

test('counts a person once and uses December L1B A1 only when the latest December L1A is verifiably empty',()=>{
  const p=pkg(),dec='2025-12',extra='0000000000000075';
  for(let i=1;i<=12;i++){
    const period='2025-'+String(i).padStart(2,'0');
    add(p,'PPH2126',period,0,i===12?[]:[{TIN:owner}],'l1a');
    add(p,'PPH2126',period,0,i===12?[{TIN:owner},{TIN:other},{TIN:other}]:[{TIN:extra}],'l1b-a1');
  }
  add(p,'PPH2126',dec,0,[{TIN:extra}],'l1b-a2');
  const count=()=>row(kkaFigures(p,'2025'),'4.1','Penerima penghasilan');
  assert.equal(count()[2],2);assert.match(count().at(-1),/L1A Desember terverifikasi kosong.*l1b-a1/);
  const amended=add(p,'PPH2126',dec,1,[{TIN:owner}],'l1a');
  assert.equal(count()[2],1);
  amended.pages[0].Payload.Data=[];amended.pages[0].Payload.TotalRecords=0;amended.cap.total=0;
  assert.equal(count()[2],null);
  add(p,'PPH2126',dec,1,[],'l1b-a1');
  assert.equal(count()[2],1);
  amended.cap.lengkap=false;assert.equal(count()[2],null);
});

test('payroll compares direct gross fields or the verified monthly slips, applying the December A1 status rule',()=>{
  const p=pkg();
  for(let i=1;i<=12;i++){
    const period='2025-'+String(i).padStart(2,'0');
    add(p,'PPH2126',period,0,{Form1A:{GrossIncome:1}});
    add(p,'PPH2126',period,0,[],'l1a');
  }
  const form=period=>p.forms.find(f=>f.period===period).parts;
  const january=form('2025-01'),december=form('2025-12');
  january.get('induk').pages[0].Payload={Form1A:{GrossIncome:3},Form1B:{GrossIncome:10},Form2:{GrossIncome:1000},Form3:{GrossIncome:100}};
  // Nested totals in December do not count a second time alongside the attached slips.
  december.get('induk').pages[0].Payload={Form1A:{TotalGrossIncomeAndIncomeTaxBorneByGovernmentAndIncomeTaxWithheld:{GrossIncome:500}}};
  const a1=add(p,'PPH2126','2025-12',0,[{TIN:owner,GrossIncome:200,Status:'NORMAL'},{TIN:other,GrossIncome:8,Status:'AMENDMENT'}],'l1b-a1');
  const payroll=()=>kkaFigures(p,'2025');
  assert.equal(row(payroll(),'4.1','Penghasilan bruto PPh 21')[2],323);
  assert.equal(row(payroll(),'4.1','Penerima penghasilan')[2],1);
  january.get('induk').pages[0].Payload={Form1A:{}};
  add(p,'PPH2126','2025-01',0,[{TIN:other,GrossIncome:6,Status:'AMENDMENT'}],'l1a');
  assert.equal(row(payroll(),'4.1','Penghasilan bruto PPh 21')[2],216);
  assert.equal(row(payroll(),'4.1','Penerima penghasilan')[2],2);
  january.get('induk').pages[0].Payload={Form1A:{GrossIncome:0}};
  assert.equal(row(payroll(),'4.1','Penghasilan bruto PPh 21')[2],210);
  a1.cap.lengkap=false;
  const partial=payroll();
  assert.equal(row(partial,'4.1','Penghasilan bruto PPh 21')[2],null);
  assert.equal(row(partial,'4.1','Penerima penghasilan PPh 21')[2],null);
  const observed=row(partial,'4.1','Subtotal bruto PPh 21');
  assert.deepEqual(observed.slice(1,5),[null,10,null,null]);assert.match(observed.at(-1),/11\/12 masa/);
  assert.deepEqual(row(partial,'4.1','Penerima unik PPh 21').slice(1,5),[null,1,null,null]);
});

test('personal returns keep personal values, corporate measures stay empty, and mixed types do not cross-fill',()=>{
  const p=pkg();add(p,'OP','2025',0,{TIN:owner,TaxPeriodYear:2025,AnnualNetIncome:0,IncomeTaxPayable:10,AssetEndTaxYear:420});
  const result=kkaFigures(p,2025);assert.equal(row(result,'4.1','Penghasilan neto (SPT OP)')[2],0);
  assert.equal(row(result,'4.2','GPM')[3],null);assert.equal(row(result,'5.3','Kas dan setara kas')[1],null);
  company(p,'2025');assert.equal(row(kkaFigures(p,2025),'4.1','Penghasilan neto (SPT OP)')[2],null);
});
