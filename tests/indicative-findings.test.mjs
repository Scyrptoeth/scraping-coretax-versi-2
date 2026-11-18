import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {readPackage} from '../extension/archive/package.js';
import {buildIndex} from '../extension/analisis/kkp-index.js';
import {indexPackage} from '../extension/analisis/model.js';
import {indicativeFindings} from '../extension/analisis/indicative-findings.js';

const year='2025',owner='0000000000000007';
const work={simulation:{end:'2026-11-18'},indicationLoanRate:{percent:8,source:'Asumsi contoh simulasi 8%'}};
function entry(path,records){
  return {path,cap:{lengkap:true,total:records.length,baris:records.length,konteks:{npwp:owner}},
    pages:[{Payload:{Data:records,TotalRecords:records.length}}]};
}
function fixture(){
  const forms=[],entries=[];
  const form=(type,period,tables,meta={})=>{
    const parts=new Map(Object.entries(tables).map(([part,records])=>[part,entry('spt/'+type+'/'+period+'/p00_contoh/'+part+'.json',records)]));
    const f={id:'contoh',year,type,period,version:0,parts,meta};forms.push(f);entries.push(...parts.values());return f;
  };
  const main={TaxYear:2025,TaxableIncome:100000000,IncomeTaxInAYear:22000000,AccountingPeriodStart:1,AccountingPeriodEnd:12,IsTransactionWithRelated:1};
  const account=(code,amount)=>({Data:{AccountCode:code,Amount:amount},Children:[]});
  const annual={MainFormData:main,L1cFormData:{L1cTreeData:[account('4020',60000000000),account('5311',16000000),
    account('5312',1000000),account('5315',5000000),account('5316',300000)],L1cAssets:{AC1125:10000000}},
    L11BFormData:{TotalDebtBalanceAverage:6000000,TotalEquityBalanceAverage:1000000,DebtToEquityRatio:6}};
  form('BADAN',year,{induk:[annual]},{TaxPeriodCode:'01122025'});
  const facility={DocumentNumber:'0700-FIKTIF',DocumentDate:'2025-01-08',TIN:'0000000000000022',TaxBase:1200000,
    OtherTaxBase:1100000,VAT:0,STLG:0};
  const late={DocumentNumber:'0100-OLD',DocumentDate:'2025-01-04',TIN:'0000000000000033',TaxBase:100000,VAT:11000};
  const rental={WithholdingSlipsNumber:'FIKTIF-SEWA',TaxArticle:'Pasal 4 ayat (2)',TaxObjectCode:'28-403-02',TaxBase:1000000};
  for(let m=1;m<=12;m++){
    const period=year+'-'+String(m).padStart(2,'0');
    form('PPN',period,{a2:m===1?[facility]:[],b2:m===6?[late]:[]});
    form('PPH2126',period,{induk:[{TaxPeriodYear:2025,TaxPeriodMonth:m,Form1A:{GrossIncome:1000000},A21IncomeTaxWithheld:50000}]});
    form('UNIFIKASI',period,{'d1-bpu':m===4?[rental]:[]});
  }
  const profile=entry('profil/alamat.json',[{LocationIsRented:true,RentStartDate:'2023-03-01'}]);entries.push(profile);
  const pkg={forms,entries,manifest:{wp:{npwp:owner},opsi:{periode:{from:{y:2025,m:1},to:{y:2025,m:12}},jenisSpt:['ICT_WTR']}}};
  return {pkg,annual,main,facility,late,rental,profile,run:(settings=work)=>indicativeFindings(pkg,year,settings)};
}
function table(report,title){return report.tables.find(t=>t.title===title).rows;}
const risks=r=>table(r,'Analisis indikatif');

test('six scenarios use document amounts and unique filing periods; annual payroll and rent gaps lack monthly interest anchors',()=>{
  const r=fixture().run(),rows=risks(r);
  assert.deepEqual(rows.map(row=>row.slice(2,4)),[[1200000,132000],[100000,11000],[100000,22000],[5000000,250000],[4000000,400000],[800000,176000]]);
  assert.deepEqual(rows.map(row=>row[4]!==null),[true,true,true,false,false,true]);
  assert.equal(rows[1][8],'2025-06');
  assert.ok(rows.every(row=>row[10]&&row[11]&&row[12]));
  assert.ok(rows[5][10].includes(work.indicationLoanRate.source));
  assert.deepEqual(r.totals.map(t=>t.value),[991000,rows.reduce((s,r)=>s+(r[4]??0),0),rows.reduce((s,r)=>s+(r[5]??0),0)]);
  assert.deepEqual(r.facts.map(f=>f.status),Array(6).fill('indikatif'));
  assert.equal(table(r,'Nilai awal kertas kerja').every(r=>r[4]===null),true);
  assert.equal(table(r,'Pembanding benchmark')[0][3],null);
});

test('review suppresses the selected risks, restores candidates, and does not turn a retained indication into an assessed amount',()=>{
  const f=fixture(),r=f.run({...work,indicationReviews:{'rent-gap':'explained','vat-facility':'inapplicable','payroll-gap':'retained',depreciation:'explained'}});
  assert.equal(r.candidates.length,8);assert.equal(risks(r).length,4);
  assert.equal(table(r,'Nilai awal kertas kerja').length,1);
  assert.ok(r.facts.every(f=>!['rent-gap','vat-facility','depreciation'].includes(f.ruleId)));
  assert.equal(r.totals[0].value,459000);
  assert.deepEqual(r.facts.filter(f=>f.ruleId==='payroll-gap').map(f=>[f.status,f.classification]),[['indikatif','Dipertahankan untuk pengujian']]);
  assert.equal(f.run().candidates.length,8);
});

test('personal returns, an empty package, missing years and conflicting annual types do not offer company analyses',()=>{
  const f=fixture(),different=indicativeFindings(f.pkg,'2024',work);
  assert.deepEqual(different.candidates,[]);assert.deepEqual(different.tables.map(t=>t.title),['Analisis indikatif']);
  const op={...f.pkg.forms[0],type:'OP'};
  f.pkg.forms.push(op);
  assert.deepEqual(f.run().candidates.map(c=>c.ruleId),['vat-facility','vat-input-late']);
  assert.match(f.run().notes.join(' '),/Periksa identitas/);
  f.pkg.forms=[op];
  assert.deepEqual(f.run().candidates,[]);assert.equal(f.run().totals[0].value,null);
  f.pkg.forms=[];assert.deepEqual(f.run().facts,[]);assert.equal(f.run().tables.length,1);
});

test('selected rate, currency, taxable year and end date constrain the estimates independently',()=>{
  const f=fixture();
  for(const rate of [null,{percent:8,source:''},{percent:-1,source:'contoh'}]){
    const r=f.run({...work,indicationLoanRate:rate});
    assert.equal(risks(r)[5][3],null);assert.equal(r.facts.find(v=>v.ruleId==='related-loan').amount,'');
  }
  const zero=f.run({...work,indicationLoanRate:{percent:0,source:'Perjanjian fiktif'}});
  assert.deepEqual(risks(zero)[5].slice(2,6),[0,0,0,0]);
  f.main.IsTransactionWithRelated=0;
  assert.ok(!f.run({}).facts.some(v=>v.ruleId==='related-loan'));
  assert.ok(risks(f.run({...work,simulation:{end:'2024-01-15'}})).every(r=>r[4]===null));
  f.main.AccountingPeriodStart=7;
  assert.deepEqual(risks(f.run()).slice(3,6).map(r=>r[2]),[null,null,null]);
  f.main.MataUang='USD';
  assert.ok(risks(f.run()).slice(2).every(r=>r[3]===null));
});

test('benchmark comparisons use an explicit cited KLU scenario and stay outside all subtotals',()=>{
  const f=fixture(),klu=entry('profil/klu.json',[{IsMainEconomicCode:true,TradeClassificationCode:'25111',ValidFrom:'2020-01-01'}]);
  f.pkg.entries.push(klu);
  const ref={name:'Contoh acuan petugas',source:'Data fiktif 2025',year:2025,klu:'25',metric:'CTTOR',target:1};
  const r=f.run({...work,benchmark:[ref]});
  assert.equal(table(r,'Pembanding benchmark')[0][3],578000000);
  assert.deepEqual(r.totals,f.run().totals);
  klu.cap.konteks.npwp='0000000000000020';
  assert.equal(table(f.run({...work,benchmark:[ref]}),'Pembanding benchmark')[0][3],null);
});

test('VAT excludes cancelled slips, rejects ambiguous duplicates, and selects the last complete revision only',()=>{
  const f=fixture(),june=f.pkg.forms.find(v=>v.type==='PPN'&&v.period==='2025-06');
  f.late.IsCancelled=true;assert.equal(risks(f.run())[1][3],0);delete f.late.IsCancelled;
  f.late.InvoiceStatus='REPLACED';assert.equal(risks(f.run())[1][3],null);delete f.late.InvoiceStatus;
  const march=f.pkg.forms.find(v=>v.type==='PPN'&&v.period==='2025-03');
  march.parts.set('b2',entry('spt/ppn/march/b2.json',[{...f.late}]));
  assert.equal(risks(f.run())[1][3],null);
  march.parts.set('b2',entry('spt/ppn/march/b2.json',[]));
  const latest={...june,id:'a1',version:1,parts:new Map(june.parts)};latest.parts.set('b2',entry('spt/ppn/june/a1/b2.json',[]));
  f.pkg.forms.push(latest);assert.equal(risks(f.run())[1][3],0);
  latest.parts.get('b2').cap.lengkap=false;assert.equal(risks(f.run())[1][3],null);
  latest.parts.get('b2').cap.lengkap=true;
  f.pkg.entries.push(entry('spt/daftar.json',[{ReturnSheetTypeCode:'VAT_VATR',TaxPeriodCode:'06062025',RecordId:'a2',
    ReturnSheetStatusCode:'SUBMITTED',ReturnSheetModel:'Amendment 2'}]));
  assert.equal(risks(f.run())[1][3],null);
  const shifted=fixture();shifted.facility.DocumentDate='2025-02-01';
  assert.deepEqual(risks(shifted.run())[0].slice(2,5),[1200000,132000,null]);
});

test('facility VAT uses the face amount, estimates only qualifying zero amounts and labels partial years and disputed dates',()=>{
  const f=fixture(),get=()=>table(f.run(),'Pembanding N.5 · PPN fasilitas')[0];
  f.facility.VAT=144000;f.facility.OtherTaxBase=1200000;
  assert.deepEqual(risks(f.run())[0].slice(2,4),[1200000,144000]);assert.equal(get()[5],1);
  const january=f.pkg.forms.find(v=>v.type==='PPN'&&v.period==='2025-01'),other={...f.facility,DocumentNumber:'0800-FIKTIF',VAT:0,OtherTaxBase:1100000};
  january.parts.set('a2',entry('spt/PPN/2025-01/p00_contoh/a2.json',[f.facility,other]));
  assert.deepEqual(get().slice(3,7),[2400000,144000,1,276000]);assert.equal(get()[11],1);
  f.pkg.forms=f.pkg.forms.filter(v=>v.type!=='PPN'||v.period<'2025-10');
  assert.equal(get()[1],9);assert.equal(get()[10].split(', ').length,3);assert.equal(risks(f.run())[0][3],276000);
  other.DocumentDate='2025-02-01';assert.equal(get()[9],1);assert.equal(risks(f.run())[0][4],null);assert.ok(get()[7]>0);
  other.OtherTaxBase=0;assert.equal(risks(f.run())[0][3],null);assert.equal(get()[6],276000);
  january.parts.get('a2').cap.lengkap=false;assert.ok(!f.run().tables.some(t=>t.title.startsWith('Pembanding N.5')));
});

test('coverage, sector evidence, filters, aggregate identifiers and alternative currencies constrain the rental comparison',()=>{
  const f=fixture(),annualRent=()=>risks(f.run())[4];
  const september=f.pkg.forms.findIndex(v=>v.type==='UNIFIKASI'&&v.period==='2025-09');f.pkg.forms.splice(september,1);
  assert.equal(annualRent()[2],null);
  const records=f.pkg.forms.filter(v=>v.type==='UNIFIKASI').map(v=>({ReturnSheetTypeCode:'ICT_WTR',TaxPeriodCode:v.period.slice(5).repeat(2)+year,
    RecordId:v.id,ReturnSheetStatusCode:'SUBMITTED',ReturnSheetModel:'Normal'}));
  const dir=entry('spt/daftar.json',records);dir.cap.payload={First:0,TaxpayerAggregateIdentifier:'synthetic',Filters:[],isArchieved:false};
  f.pkg.entries.push(dir);assert.equal(annualRent()[3],400000);
  dir.cap.payload.Filters=['filter'];assert.equal(annualRent()[2],null);dir.cap.payload.Filters=[];
  records[0].RecordId='wrong';assert.equal(annualRent()[2],null);records[0].RecordId='contoh';
  const range=f.pkg.manifest.opsi.periode;delete range.from.y;assert.equal(annualRent()[2],null);range.from.y=2025;
  f.profile.cap.konteks.npwp='0000000000000012';assert.deepEqual(annualRent().slice(2,4),[4000000,null]);
  f.rental.IncomeTaxCurrencyCode='USD';assert.equal(annualRent()[2],null);
});

test('fictitious Studio controls reproduce six bases, six principals, four dated interest amounts, both prefills and the baseline comparison',async t=>{
  if(!process.env.VERITAX_FIXTURES)return t.skip('Optional local fictitious reference package');
  const bytes=await readFile(join(process.env.VERITAX_FIXTURES,'CONTOH-paket-DEMO-FIKTIF.zip'));
  const pkg=indexPackage(await readPackage(bytes)),index=buildIndex(pkg,year);
  const run=end=>indicativeFindings(pkg,year,{...work,simulation:{end}},index);
  const r=run('2027-02-20');
  assert.deepEqual(risks(r).map(row=>row.slice(2,5)),[[37029438177,4073238199,1294749476],[553950116,60934513,19633100],
    [382583440,84168260,20856894],[5659169120,331097211,null],[1880426471,188042647,null],[120000000,26400000,6541920]]);
  assert.deepEqual(table(r,'Nilai awal kertas kerja').map(row=>row.slice(3,6)),[[0,2294283089,2294283089],[586627942,1173255883,586627941]]);
  assert.equal(r.totals[0].value,4763880830);
  const earlier=run('2026-11-18');
  assert.deepEqual(risks(earlier).map(row=>row[4]),[1078441127,16360916,16387560,null,null,5140080]);
  const baseline=table(earlier,'Pembanding ketetapan dari nilai awal')[0];
  assert.deepEqual(baseline.slice(1,4),[554009240,107865599,661874839]);
  assert.ok(baseline[6]&&baseline[7]);assert.equal(earlier.totals[0].value,r.totals[0].value);
});
