import assert from 'node:assert/strict';
import test from 'node:test';
import {companyAssessment} from '../extension/analisis/assessment-company.js';

const year='2025',owner='0000000000000010';
function fixture(){
  const main={TaxYear:2025,FiscalNetIncomeAfterTax:1000999,TaxableIncome:1000000,IncomeTaxInAYear:220000,
    TotalIncomeTaxOverseas:200,UnderpaymentIncomeTax:219800,AccountingPeriodStart:1,AccountingPeriodEnd:12};
  const parts=new Map();
  function annex(part,records) {
    const path='spt/BADAN/2025/p00_contoh/'+part+'.json',cap={lengkap:true,total:records.length,konteks:{npwp:owner}};
    parts.set(part,{path,cap,pages:[{Payload:{Data:records,TotalRecords:records.length}}]});
  }
  annex('induk',[{MainFormData:main}]);annex('l3',[]);annex('l11a-2',[]);
  for(const [group,max] of [[1,5],[2,2],[3,5]])for(let k=1;k<=max;k++)annex('l9-'+group+'-'+k,[]);
  annex('l9-1-2',[{FiscalYearValue:500}]);
  const form={id:'contoh',type:'BADAN',period:year,year,version:0,parts,meta:{TaxPeriodCode:'01122025'}};
  const slip={EmployeeTin:owner,WitholderTin:'0000000000000011',TaxArticle:'Pasal 22',TaxPeriodCode:'01012025',
    WithholdingSlipsStatus:'NORMAL',IncomeTax:70,WithholdingSlipsNumber:'FIKTIF-1'};
  const entry={path:'bukti-potong-lawan/2025/BPPU.json',cap:{lengkap:true,total:1,konteks:{npwp:owner,tahun:year,jenis:'BPPU'},
    payload:{First:0,TaxYear:'2025',WithholdingSlipsType:'BPPU',IncomeRecipientTin:owner,Filters:[]}},pages:[{Payload:{Data:[slip],TotalRecords:1}}]};
  const pkg={manifest:{wp:{npwp:owner}},forms:[form],entries:[entry]};
  const path=parts.get('induk').path,balance={id:path+'#balance',source:path+' · MainFormData.UnderpaymentIncomeTax'};
  const support=[{Kode:'A4020',Nilai:51000000000,Satuan:'IDR'},{Kode:'P25',Satuan:'IDR'}];
  const group={key:'BADAN/B.7',ref:'B.7',lines:[{id:'example/account-5314',amount:0},{id:'example/account-5321',amount:500}],
    support:[{Uraian:'Jumlah koreksi positif menurut SPT',Sumber:'contoh · L1 total',Nilai:500},
      {Uraian:'Biaya komersial · 5314',Sumber:'contoh · L1 5314',Nilai:2500},
      {Uraian:'Biaya komersial · 5321',Sumber:'contoh · L1 5321',Nilai:1000}]};
  const index={groups:[{key:'BADAN/B',support,lines:[balance]},group]};
  return {pkg,index,main,form,slip,entry,support,group,balance,run:(work={})=>companyAssessment(pkg,year,work,index)};
}

test('positive fiscal projections and observed domestic withholding stay separate from foreign-credit amounts and assessed principal',()=>{
  const f=fixture(),r=f.run();
  assert.equal(r.mode,'indikasi');assert.equal(r.principal,null);assert.equal(r.period,'2025-12');
  assert.deepEqual(r.components,{baseCorrection:500,projectedCorrection:3000,declaredTax:220000,projectedTax:220660,
    observedWithholding:70,overseasField:200});
  assert.match(r.notes.join(' '),/Lampiran 3 yang terbaca memuat 0 baris/);
  const changed=f.run({rows:[{kkpLine:f.group.lines[1].id,menurutWp:500,menurutPetugas:500,evidence:'none',review:'Dalam pengujian'}]});
  assert.equal(changed.components.projectedTax,220440);assert.equal(changed.principal,null);
  assert.equal(f.run({rows:[{kkpLine:f.balance.id}]}),null);
});

test('eligibility and monthly anchors are limited to the declared reporting period, currency and evidenced ordinary rate',()=>{
  const f=fixture();
  f.support.forEach(r=>r.Satuan='Belum dinyatakan');
  assert.match(f.run().notes[0],/Jika angka induk dalam rupiah/);
  delete f.main.AccountingPeriodEnd;assert.equal(f.run().period,null);
  const changes=[
    g=>g.main.IncomeTaxInAYear=199999,g=>g.main.TaxableIncome=900000,
    g=>g.support[0].Nilai=50000000000,g=>g.form.parts.get('l9-1-2').cap.lengkap=false,
  ];
  for(const change of changes){const g=fixture();change(g);assert.equal(g.run().components.projectedTax,undefined);assert.equal(g.run().principal,null);}
  const other=fixture();other.main.MataUang='USD';assert.equal(other.run().principal,null);assert.match(other.run().notes.join(' '),/mata uang/i);
});

test('a later listed amendment, an ambiguous filing, and cross-taxpayer sources cannot generate a corporate project',()=>{
  const f=fixture();
  f.pkg.entries.push({path:'spt/daftar.json',cap:{konteks:{npwp:owner}},pages:[{Payload:{Data:[{RecordId:'later',
    ReturnSheetTypeCode:'ICT_RCITR',TaxPeriodCode:'01122025',ReturnSheetModel:'Amendment 1',ReturnSheetStatusCode:'SUBMITTED'}]}}]});
  assert.equal(f.run(),null);f.pkg.entries.pop();f.pkg.forms.push({...f.form,id:'other'});assert.equal(f.run(),null);
  f.pkg.forms.pop();f.main.TIN='0000000000000033';assert.equal(f.run(),null);
});

test('recipient, slip status, identity, currency, filter and full coverage constrain withholding evidence',()=>{
  for(const change of [f=>f.slip.EmployeeTin='0000000000000022',f=>f.slip.WithholdingSlipsStatus='REVISED',
    f=>f.slip.IncomeTaxCurrencyCode='USD',f=>f.slip.WithholdingSlipsNumber='',f=>f.entry.cap.lengkap=false,
    f=>f.entry.cap.payload.WithholderTin='filter',f=>f.entry.cap.total=12,f=>f.slip.TaxPeriodCode='12122024',
    f=>{const p=f.entry.pages[0].Payload;p.Data.push({...f.slip});p.TotalRecords=f.entry.cap.total=2;}]) {
    const f=fixture();change(f);
    assert.equal(f.run().components.observedWithholding,undefined);assert.equal(f.run().principal,null);
  }
  const f=fixture();f.slip.WithholdingSlipsStatus='CANCELLED';assert.equal(f.run().components.observedWithholding,0);
});
