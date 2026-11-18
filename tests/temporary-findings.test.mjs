import assert from 'node:assert/strict';
import test from 'node:test';
import {findingFromWorkRow,findingKey,findingsFor} from '../extension/analisis/findings.js';
import {assessLine} from '../extension/analisis/kkp-index.js';
import {temporaryFindings,temporaryFindingsSheet} from '../extension/analisis/temporary-findings.js';
import {installmentComparison} from '../extension/analisis/temporary-findings-installments.js';
import {createXlsx} from '../extension/archive/table.js';
import {readZip,decodeText} from '../extension/archive/zip.js';

const pkg={manifest:{wp:{nama:'Badan Fiktif',npwp:'0000000000000001'}},forms:[],entries:[]};
const year='2025';
const line={id:'id-1',ref:'C',groupKey:'PPh/C',canonicalKey:'PPh/C.2.2',period:'2025-01',version:0,
  topic:'Jumlah dipotong',amount:100,tax:'PPh Pasal 21',source:'induk.json · A21IncomeTaxWithheld',partial:false};
const index={groups:[{key:'PPh/C',ref:'C',lines:[line]},{key:line.canonicalKey,ref:'C.2.2',lines:[line]}]};
const compare=(input,work={},i=index)=>temporaryFindings(input,year,work,i);
const tested=(l,changes={})=>assessLine(l,{value:125,document:'DOK-FIKTIF',note:'Pencocokan contoh',officer:'Penguji',
  classification:'verified',principal:5,...changes});
const objects=t=>t.rows.map(row=>Object.fromEntries(t.columns.map((c,i)=>[c,row[i]])));

test('a source amount alone is not a correction; a tested alias contributes only once',()=>{
  const before=compare(pkg);
  assert.equal(before.counts.untested,1);assert.equal(before.tables.length,2);assert.equal(before.tables[0].rows.length,0);
  const w={rows:[tested(line)]},after=compare(pkg,w),[r]=objects(after.tables[0]);
  assert.equal(after.counts.tested,1);assert.equal(after.tables[0].rows.length,1);
  assert.equal(r.Indeks,'C.2.2');assert.equal(r['Menurut SPT/WP'],100);assert.equal(r['Menurut petugas'],125);
  assert.equal(r['Koreksi berbukti'],25);assert.equal(r['Selisih indikatif'],null);
  assert.match(r['Sumber dan bukti'],/DOK-FIKTIF/);assert.equal(after.tables[1].rows.length,0);
  const unchanged=compare(pkg,{rows:[tested(line,{value:100})]});assert.equal(unchanged.tables[0].rows.length,0);
  assert.equal(unchanged.counts.untested,0);
});

test('partial, unresolved, or stale source comparisons never produce verified corrections',()=>{
  const base={...line,ref:'B',canonicalKey:undefined,groupKey:'B'};
  for(const [l,review,expected] of [
    [base,tested(base,{classification:'indicative'}),25],
    [{...base,partial:true},tested(base),null],
    [{...base,amount:null},tested(base),null],
    [base,{...tested(base),menurutWp:99},null]
  ]){
    const t=compare(pkg,{rows:[review]},{groups:[{key:'B',ref:'B',lines:[l]}]}).tables[0];
    const [r]=objects(t);assert.equal(r['Koreksi berbukti'],null);assert.equal(r['Selisih indikatif'],expected);
  }
  const zero={...base,withoutReturn:true,amount:0,prefill:35,explanation:'Pembanding nol berdasarkan daftar SPT.'};
  const i={groups:[{key:'B',ref:'B',lines:[zero]}]};
  const initial=objects(compare(pkg,{},i).tables[0])[0];
  assert.equal(initial['Menurut SPT/WP'],null);assert.equal(initial['Pembanding KKP tanpa SPT'],0);
  assert.equal(initial['Pembanding otomatis'],35);assert.equal(initial['Menurut petugas'],null);assert.equal(initial['Koreksi berbukti'],null);
});

test('scope and review remove closed items consistently for formal observations and manual work',()=>{
  const late={year,period:'2025-01',type:'PPN',key:'spt-fiktif',late:true,reportDate:'2025-03-01',dueDate:'2025-02-28'};
  const fixture={...pkg,forms:[late]};
  const manual={tax:'PPh Badan',topik:'Objek fiktif',sumber:'Lampiran fiktif',fakta:'Ada selisih',review:'Dalam pengujian',evidence:'indicative',principal:0};
  const review=tested(line),data={rows:[review,manual],scopes:{kkp:'all'}};
  const open=compare(fixture,data);
  assert.equal(open.tables[0].rows.length,1);assert.equal(open.tables[1].rows.length,1);assert.equal(open.tables[2].rows[0][3],0);
  assert.equal(open.tables[1].rows[0][3],null);
  const source=findingsFor(fixture,year,[])[0];
  const closed=compare(fixture,{...data,dispositions:{[findingKey(source)]:'Tidak relevan',[findingKey(findingFromWorkRow(review,year))]:'Terjelaskan'}});
  assert.equal(closed.counts.closed,1);assert.equal(closed.tables[0].rows.length,0);assert.equal(closed.tables[1].rows.length,0);
  assert.equal(compare(fixture,{rows:[manual]}).tables.length,2);
});

test('B.7 compares complete L9 and an explicitly empty nominative list without asserting an officer assessment',()=>{
  const parts=new Map(),owner=pkg.manifest.wp.npwp;
  function entry(part,records) {
    const e={path:'spt/BADAN/2025/p00_fiktif/'+part+'.json',cap:{lengkap:true,total:records.length,konteks:{npwp:owner}},
      pages:[{Payload:{Data:records,TotalRecords:records.length}}]};
    parts.set(part,e);return e;
  }
  entry('induk',[{}]);entry('l11a-2',[]);
  for(const [group,n] of [[1,5],[2,2],[3,5]])for(let k=1;k<=n;k++)entry('l9-'+group+'-'+k,[]);
  const dep=entry('l9-1-2',[{FiscalYearValue:90}]);
  const form={type:'BADAN',id:'fiktif',period:year,year,version:0,parts};
  const fixture={...pkg,forms:[form]};
  const lines=[['5314',0],['5321',60]].map(([code,amount])=>({...line,id:'fiktif/B.7/account-'+code,canonicalKey:null,
    groupKey:'BADAN/B.7',ref:'B.7',tax:'PPh Badan',period:year,amount}));
  const support=['5314','5321'].map(code=>({Uraian:'Biaya komersial · '+code,Nilai:150,Sumber:'induk.json · '+code+'.Amount'}));
  const i={groups:[{key:'BADAN/B.7',ref:'B.7',support,lines},{key:'BADAN/B',ref:'B',lines:[],support:[{Kode:'A4020',Satuan:'IDR'}]}]};
  const actual=()=>objects(compare(fixture,{},i).tables[0]);
  assert.deepEqual(actual().map(r=>r['Pembanding otomatis']),[60,150]);
  assert.deepEqual(actual().map(r=>r['Selisih indikatif']),[60,90]);
  assert.ok(actual().every(r=>r['Koreksi berbukti']===null&&r['Menurut petugas']===null));
  support.push({Uraian:'Jumlah koreksi positif menurut SPT',Nilai:70,Sumber:'induk.json · total L1'});
  assert.deepEqual([actual()[0].Indeks,actual()[0]['Menurut SPT/WP'],actual()[0]['Pembanding otomatis']],['B',70,220]);
  assert.equal(actual()[0]['Selisih indikatif'],null);assert.equal(actual()[0]['Koreksi berbukti'],null);
  support.pop();
  dep.cap.lengkap=false;assert.equal(actual().length,1);
  dep.cap.lengkap=true;dep.pages[0].Payload.Data[0].FiscalYearValue=null;assert.equal(actual().length,1);
  entry('l11a-2',[{Expense:5}]);assert.equal(actual().length,0);
  entry('l9-1-2',[{FiscalYearValue:0}]);entry('l11a-2',[]);
  i.groups[1].support[0].Satuan='Bertentangan atau tidak dikenali';assert.equal(actual().length,0);
});

test('annual VAT projection keeps untested monthly values, checks full coverage, and never counts an extra correction',()=>{
  const lines=Array.from({length:12},(_,i)=>({...line,id:'vat-'+i,groupKey:'PPN/N.3.1',canonicalKey:undefined,ref:'N.3.1',
    period:year+'-'+String(i+1).padStart(2,'0'),amount:100}));
  const g={key:'PPN/N.3.1',ref:'N.3.1',lines},work={rows:[tested(lines[0],{value:80})]};
  const report=compare(pkg,work,{groups:[g]});
  const [r]=objects(report.tables[0]);assert.equal(report.tables[0].rows.length,1);assert.equal(r['Koreksi berbukti'],-20);
  assert.match(r.Keterangan,/12 masa 1\.200/);assert.match(r.Keterangan,/1 masa diuji 1\.180/);
  assert.doesNotMatch(objects(compare(pkg,work,{groups:[{...g,lines:lines.slice(0,-1)}]}).tables[0])[0].Keterangan,/Proyeksi/);
});

test('installment comparison requires twelve attributable and complete ledger periods, uniquely traceable active payments, and compatible currency',()=>{
  const owner=pkg.manifest.wp.npwp;
  const types={PaymentCode:'100',RevenueCode:'411126',AccountingTypeCode:'Payment',IsCancelled:false};
  function fixture(){
    const entries=Array.from({length:12},(_,i)=>{
      const m=String(i+1).padStart(2,'0'),period=m+m+year;
      const data=i===0?[{...types,PeriodCode:period,RecordId:'p1',ReferenceNumber:'ref-1',Amount:50},
        {...types,PeriodCode:period,RecordId:'p2',ReferenceNumber:'ref-2',Amount:15,ReferenceType:'Balance Transfer In'},
        {...types,PeriodCode:period,RecordId:'p3',Amount:4,IsCancelled:true},
        {...types,PeriodCode:period,RecordId:'p4',Amount:11,PaymentCode:'200'}]:[];
      return {path:'bukubesar/'+year+'-'+m+'.json',pages:[{Payload:{Data:data,TotalRecords:data.length}}],
        cap:{lengkap:true,total:data.length,baris:data.length,konteks:{npwp:owner,tahun:year,masa:i+1},payload:{First:0,TaxpayerAggregateIdentifier:'id-owner',
          Filters:[{PropertyName:'PeriodCode',MatchMode:'equals',Value:period}]}}};
    });
    const parent={path:'induk.json',pages:[{Payload:{}}],cap:{lengkap:true,konteks:{npwp:owner}}};
    const form={type:'BADAN',period:year,year,id:'FIKTIF',version:0,parts:new Map([['induk',parent]])};
    return {...pkg,entries,forms:[form]};
  }
  const current={...line,groupKey:'BADAN/B.13',ref:'B.13',period:year,canonicalKey:null,source:'induk.json · MainFormData.InstallmentOfIncome',amount:60};
  const support={Kode:'P25',Satuan:'IDR'},i={groups:[{key:'BADAN/B.13',ref:'B.13',lines:[current]},{key:'BADAN/B',ref:'B',lines:[],support:[support]}]};
  assert.equal(installmentComparison(fixture(),year,i).value,65);
  const [r]=objects(compare(fixture(),{},i).tables[0]);
  assert.equal(r['Selisih indikatif'],5);assert.equal(r['Koreksi berbukti'],null);
  for(const change of [
    f=>f.entries.pop(),f=>f.entries[0].cap.lengkap=false,f=>f.entries[1].cap.konteks.npwp='0000000000009999',
    f=>f.forms[0].parts.get('induk').cap.konteks.npwp='0000000000009999',
    f=>f.entries[5].cap.payload.Filters.push({PropertyName:'PostingDate',Value:'a'}),
    f=>f.entries[5].cap.payload.TaxpayerAggregateIdentifier='other',f=>f.entries[0].cap.total=10,
    f=>f.entries[0].pages[0].Payload.Data[1].RecordId='p1',f=>f.entries[0].pages[0].Payload.Data[1].ReferenceNumber='ref-1',
    f=>f.entries[0].pages[0].Payload.Data[0].PeriodCode='12122024',f=>f.entries[0].pages[0].Payload.Data[0].CurrencyCode='USD',
    f=>f.entries[0].pages[0].Payload.Data[1].IsCancelled=undefined,f=>f.entries[0].pages[0].Payload.Data[1].Amount=-1,
  ]){const f=fixture();change(f);assert.equal(installmentComparison(f,year,i),null);}
  support.Satuan='USD';assert.equal(installmentComparison(fixture(),year,i),null);
});

test('XLSX retains numeric values and scope and distinguishes zero, missing amounts, and reported facts',async()=>{
  const result=temporaryFindingsSheet(pkg,year,{rows:[tested(line,{value:0})]},index);
  assert.equal(result.name,'Daftar TS');
  const numeric=result.rows.find(r=>r.includes('DOK-FIKTIF')||r.some(v=>typeof v==='string'&&v.includes('DOK-FIKTIF')));
  assert.equal(numeric[7],0);assert.equal(numeric[8],-100);assert.equal(numeric[9],null);
  const files=await readZip(await createXlsx({sheets:[result]}));
  const xml=decodeText(files.get('xl/worksheets/sheet1.xml').data);
  assert.match(xml,/<v>-100<\/v>/);assert.match(xml,/Sumber dan bukti/);
  assert.doesNotMatch(xml,/#REF!|<f>/);
});
