import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kkaPartnersTable} from '../extension/analisis/kka-partners.js';
import {indexPackage} from '../extension/analisis/model.js';

const owner='0000000000000021',first='0000000000000045',second='0000000000000055';
function packageWith(entries,options={}){
  return indexPackage({manifest:{wp:{npwp:owner},opsi:options},report:{valid:true},entries});
}

function vat(part,month,revision,rows){
  return {path:'spt/PPN/2025-'+month+'/p0'+revision+'_fiktif-'+month+'-'+revision+'/'+part+'.json',
    cap:{sumber:'sptisi',lengkap:true,total:rows.length,konteks:{npwp:owner,bagian:part}},
    pages:[{IsSuccessful:true,Payload:{Data:rows,TotalRecords:rows.length}}]};
}

function slip(kind,rows,reported=rows.length){
  return {path:'bukti-potong-lawan/2025/'+kind+'.json',
    cap:{sumber:'bplawan',lengkap:true,konteks:{npwp:owner,tahun:2025,jenis:kind},
      payload:{First:0,Rows:10000,Filters:[],IncomeRecipientTin:owner,TaxYear:'2025-01-01',WithholdingSlipsType:kind}},
    pages:[{IsSuccessful:true,Payload:{Data:rows,TotalRecords:reported}}]};
}

const invoice=(id,name,number,base,extra={})=>({TIN:id,Name:name,DocumentNumber:number,TaxBase:base,...extra});
const ranking=(out,prefix)=>out.workbook.rows.filter(r=>r[0].startsWith(prefix)&&Number.isInteger(r[1]));
const summary=(out,prefix)=>out.rows.find(r=>r[0].startsWith(prefix));

test('latest VAT forms rank exact NPWP and preserve observed DPP for documents with placeholder NPWP',()=>{
  const revisedRows=[
    invoice(first,'PT Fiktif 1','FIK-001',120),
    invoice(second,'PT Fiktif 2','FIK-002',45),
    invoice(first,'PT Fiktif 1','FIK-003',30),
    invoice('0000000000000000','Pembeli A','FIK-004',30),
    invoice('0000000000000000','Pembeli B','FIK-005',25),
    invoice(first,'PT Fiktif 1','FIK-006',400,{InvoiceStatus:'CANCELLED'}),
    invoice(first,'PT Fiktif 1','FIK-007',null),
    invoice(second,'PT Fiktif 2','FIK-002',45)
  ];
  const pkg=packageWith([
    vat('a2','01',0,[invoice(first,'PT Fiktif 1','FIK-NORMAL',999)]),
    vat('a2','01',1,revisedRows),
    vat('b2','01',1,[]),
  ]);
  const out=kkaPartnersTable(pkg,'2025');
  assert.deepEqual(summary(out,'Pembeli').slice(1,4),[2,5,250]);
  const [[,rank,,id,count,base,share,status,path],runnerUp]=ranking(out,'Pembeli');
  assert.deepEqual([rank,id,count,base,share],[1,first,2,150,60]);
  assert.deepEqual(runnerUp.slice(3,7),[second,1,45,18]);
  assert.match(path,/p01_/);
  assert.match(status,/Sebagian.*1\/12.*2 dokumen tanpa NPWP.*1 baris/);
  assert.deepEqual(out.workbook.rows.find(r=>r[2]==='NPWP belum terkonfirmasi').slice(4,7),[2,55,22]);
  assert.equal(summary(out,'Pemasok')[2],null);
});

test('newer filings in the directory and capture boundaries prevent stale VAT totals',()=>{
  const rows=[invoice(first,'PT Fiktif 1','FIK-001',120)];
  const directory={path:'spt/daftar.json',cap:{sumber:'sptdaftar',konteks:{npwp:owner}},pages:[
    {Payload:{Data:[{ReturnSheetTypeCode:'VAT_VATR',TaxPeriodCode:'01012025',ReturnSheetModel:'Amendment 1',RecordId:'newer'}]}}
  ]};
  const opts={periode:{from:{y:2025,m:1},to:{y:2025,m:1}}};
  const out=kkaPartnersTable(packageWith([vat('a2','01',0,rows),vat('a2','02',0,rows),directory],opts),2025);
  assert.deepEqual(summary(out,'Pembeli').slice(1,4),[null,null,null]);
  assert.match(summary(out,'Pembeli')[4],/0\/12.*2025-01/);
  assert.doesNotMatch(summary(out,'Pembeli')[4],/2025-02/);
});

test('withholding identifies the recipient, excludes NPMP and distinguishes verified empty populations',()=>{
  const row={WitholderTin:first,WitholderName:'Pemotong fiktif',WithholdingSlipsNumber:'BP-FIK-001',
    WithholdingSlipsStatus:'NORMAL',EmployeeTin:owner,TaxPeriodCode:'01012025',TaxBase:70};
  const kinds=['BP21','BP26','BPA1','BPA2','BPCY','BPPU','BPSP'];
  const empty=kinds.map(kind=>slip(kind,[]));
  assert.deepEqual(summary(kkaPartnersTable(packageWith(empty),2025),'Pemotong').slice(1,4),[0,0,0]);
  const legacy=kinds.map(kind=>slip(kind,[],10000));
  assert.deepEqual(summary(kkaPartnersTable(packageWith(legacy),2025),'Pemotong').slice(1,4),[null,null,null]);
  const legacyBpu=slip('BPPU',[row,{...row,EmployeeTin:second,WithholdingSlipsNumber:'BP-LAIN',TaxBase:500}],10000);
  const out=kkaPartnersTable(packageWith([legacyBpu,slip('NPMP',[row]),...legacy.filter(e=>e!==legacy[5])]),2025);
  assert.deepEqual(summary(out,'Pemotong').slice(1,4),[1,1,70]);
  assert.match(summary(out,'Pemotong')[4],/Sebagian.*0\/7.*1 baris/);
  assert.deepEqual(ranking(out,'Pemotong')[0].slice(3,7),[first,1,70,100]);
});
