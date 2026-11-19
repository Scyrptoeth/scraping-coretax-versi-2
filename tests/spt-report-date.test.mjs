import assert from 'node:assert/strict';
import test from 'node:test';
import {indexPackage, issues, sptDay, submittedDay} from '../extension/analisis/model.js';
import {eventsFor} from '../extension/analisis/advanced-dashboard.js';
import {findingsFor} from '../extension/analisis/findings.js';
import {profileSections} from '../extension/analisis/profile.js';

test('select a valid calendar day from submission evidence in source order', () => {
  const row = {ReturnDate:'2025-08-01T23:30:00-05:00', ReceiptDate:'2025-08-02', EnteredDate:'2025-08-03', DateOfSubmit:'2025-08-04'};
  assert.equal(submittedDay(row), '2025-08-01');
  assert.equal(submittedDay({...row, ReturnDate:'0001-01-01T00:00:00'}), '2025-08-02');
  assert.equal(submittedDay({...row, ReturnDate:null, ReceiptDate:'2025-02-30'}), '2025-08-03');
  assert.equal(submittedDay({EnteredDate:'1900-01-01', DateOfSubmit:row.DateOfSubmit}), '2025-08-04');
  assert.equal(submittedDay({ReturnDate:'', ReceiptDate:null}), '');
  assert.equal(sptDay('2024-02-29'), '2024-02-29');
});

test('dates derived from lists or form metadata drive findings without rewriting the source', () => {
  const entry = (path, cap, payload) => ({path, cap, pages:[{Payload:payload}]});
  const form = (id, month, metadata) => entry('spt/PPN/2025-'+month+'/p00_'+id+'/induk.json', {konteks:{spt:metadata}}, {});
  const submitted = {RecordId:'demo-a', TaxPeriodCode:'02022025', ReturnSheetModel:'Normal',
    ReturnDate:'0001-01-01', ExpectedReturnDate:'2025-03-10', ReceiptDate:'2025-03-11'};
  const listed = entry('spt/daftar.json', {}, {Data:[submitted]});
  const captured = form('demo-b','03',{tanggal:'2025-04-12',batas:'2025-04-10'});
  const pkg = indexPackage({manifest:{}, entries:[listed, form('demo-a','02',{}), captured, form('demo-c','04',{})]});
  const [a,b,c] = ['demo-a','demo-b','demo-c'].map(id=>pkg.forms.find(f=>f.id===id));
  assert.equal(a.meta.ReturnDate, '0001-01-01');
  assert.deepEqual([a.reportDate,a.dueDate,a.late,a.reportSource],['2025-03-11','2025-03-10',true,listed.path]);
  assert.deepEqual([b.reportDate,b.dueDate,b.late,b.reportSource],['2025-04-12','2025-04-10',true,captured.path]);
  assert.deepEqual([c.reportDate,c.dueDate,c.late],['','',null]);
  assert.deepEqual(issues(pkg,'2025').filter(x=>x.Butir==='Pelaporan melewati tanggal pada sumber').map(x=>[x.Fakta,x.Sumber]),[
    ['2025-04-12 / batas 2025-04-10',captured.path],['2025-03-11 / batas 2025-03-10',listed.path]
  ]);
  const filing = eventsFor(pkg,'2025').find(event=>event.Kelompok==='SPT melewati tanggal pada sumber');
  assert.equal(filing.Tanggal, '2025-03-11');
  const profile = profileSections(pkg).find(section=>section.id==='lapor').rows;
  assert.equal(profile[0]['Tanggal lapor'], '2025-03-11');
  assert.match(findingsFor(pkg,'2025',[]).find(f=>f.period==='2025-02').detail, /2025-03-11/);
});

test('filing-list status adjusts weekends independently of the source date and does not presume statutory holidays', () => {
  const cases=[
    ['2025-07-20','2025-07-21','2025-07-21',true,false],
    ['2025-08-30','2025-09-01','2025-09-01',true,false],
    ['2025-08-31','2025-09-02','2025-09-01',true,true],
    ['2025-12-25','2025-12-26','2025-12-25',true,true],
    [null,'2025-06-01','',null,null],
    ['2025-07-20',null,'2025-07-21',null,null],
  ];
  for(const [due,received,effective,late,filingLate] of cases) {
    const entry=(path,payload)=>({path,cap:{},pages:[{Payload:payload}]});
    const rows=['normal','amended'].map(RecordId=>({RecordId,ExpectedReturnDate:due,ReceiptDate:received}));
    const indexed=indexPackage({manifest:{},entries:[entry('spt/daftar.json',{Data:rows}),
      entry('spt/PPN/2025-06/p00_normal/induk.json',{}),entry('spt/PPN/2025-06/p01_amended/induk.json',{})]});
    const normal=indexed.forms.find(f=>!f.amended);
    assert.deepEqual([normal.dueDate,normal.filingDueDate,normal.late,normal.filingLate],[due||'',effective,late,filingLate]);
    assert.equal(indexed.forms.find(f=>f.amended).filingLate,null);
  }
});

test('displayed return lists bind to snapshots by identity, receipt, period and revision', () => {
  const wp={npwp:'0000000000000017'},receipt='BPE-UJI-0002';
  const row={'Jenis Surat Pemberitahuan Pajak':'SPT Masa PPh Pasal 21/26','Masa Pajak':'Februari 2025',
    'Model SPT':'Pembetulan 1','Nomor Bukti Penerimaan':receipt,'Tanggal Penerimaan':'18-03-2025',
    'Tanggal Jatuh Tempo':'20-03-2025','Tanggal Submit SPT':'17-03-2025','Status SPT':'Dilaporkan',
    Kanal:'Portal Wajib Pajak'};
  const form={path:'spt/PPH2126/2025-02/p01_cuplikan-'+ 'a'.repeat(64)+'/induk.json',
    cap:{konteks:{cuplikanTampilan:true,bagian:'induk',npwp:wp.npwp,
      spt:{jenis:'ICT_WITR',masa:'02022025',pemb:1,nomor:receipt}}},pages:[{Payload:{Data:[]}}]};
  const directory={path:'spt/daftar.json',cap:{konteks:{npwp:wp.npwp}},pages:[{Payload:{Data:[row]}}]};
  const check=()=>indexPackage({manifest:{wp},entries:[form,directory]}).forms[0];
  const matched=check();
  assert.equal(matched.listedRow,row);
  assert.equal(matched.meta.BpsNo,receipt);
  assert.equal(matched.meta.ChannelCode,'Portal Wajib Pajak');
  assert.equal(matched.reportDate,'2025-03-18');
  assert.equal(matched.reportDateField,'Tanggal Penerimaan');
  assert.equal(matched.reportSource,directory.path);
  assert.equal(matched.dueDate,'2025-03-20');
  assert.equal(matched.latest,true);
  assert.equal(matched.meta.ReturnSheetTypeCode,'ICT_WITR');
  assert.equal(matched.meta.ReturnSheetModel,'Amendment 1');
  assert.equal(matched.meta.TaxPeriodCode,'02022025');
  assert.equal(Object.hasOwn(row,'BpsNo'),false);

  directory.pages[0].Payload.Data.push({...row,'Model SPT':'Pembetulan 2','Nomor Bukti Penerimaan':'BPE-UJI-0003'});
  assert.equal(check().latest,false);
  assert.equal(check().laterListed,true);
  directory.pages[0].Payload.Data.push({...row});
  assert.deepEqual(check().meta,{});
  directory.pages[0].Payload.Data.pop();
  form.cap.konteks.npwp='0000000000000028';
  assert.deepEqual(check().meta,{});
});
