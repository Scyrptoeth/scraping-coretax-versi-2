import assert from 'node:assert/strict';
import test from 'node:test';
import {kkaFigures} from '../extension/analisis/kka-figures.js';
import {ledgerPageCountProven,monthIsComplete} from '../extension/analisis/temporary-findings-installments.js';

const owner='0000000000000027',year='2025',month='11',code='11112025';
function payment(id,amount=15,overrides={}){
  return {RecordId:id,AccountingTypeCode:'Payment',IsCancelled:false,PostingDate:'2025-11-19',
    Amount:amount,PeriodCode:code,TIN:owner,...overrides};
}
function ledger(pageRows,{total=null,reported=100,limit=100,annual=false}={}){
  const rows=pageRows.flat(),period=annual?'01122025':code;
  return {path:'bukubesar/2025-'+(annual?'setahun':'11')+'.json',
    cap:{lengkap:true,total,baris:rows.length,halaman:pageRows.length,konteks:{npwp:owner,tahun:year,...!annual&&{masa:11}},
      payload:{First:0,Rows:limit,Filters:[{PropertyName:'PeriodCode',MatchMode:'equals',Value:period}]}},
    pages:pageRows.map(Data=>({IsSuccessful:true,Payload:{Data,TotalRecords:reported}}))};
}
function report(entries,failed=[]){
  const pkg={entries,forms:[],manifest:{wp:{npwp:owner},dibuat:'2026-11-18T20:00:00Z',gagal:failed}};
  const result=kkaFigures(pkg,'2026');
  const rows=result.tables.find(t=>t.key==='5.3').rows;
  const full=rows.find(r=>r[0].startsWith('Pembayaran tercatat')),observed=rows.find(r=>r[0].startsWith('Subtotal pembayaran'));
  if(observed)assert.ok(result.sheet.rows.includes(observed));
  return {full,observed};
}

test('two short pages with the same server limit allow a traceable subtotal without asserting completeness',()=>{
  const e=ledger([[payment('a'),payment('old',7,{PostingDate:'2025-11-18'})],
    [payment('b',20,{PostingDate:'2026-11-18'}),payment('c',99,{IsCancelled:true}),payment('d',8,{PostingDate:'2026-11-19'})]]);
  const duplicate=ledger([[payment('b',20,{PostingDate:'2026-11-18'})]],{annual:true,total:1,reported:1});
  const {full,observed}=report([e,duplicate]);
  assert.equal(full[1],null);assert.match(full[3],/1\/2 berkas/);assert.equal(observed[1],35);
  assert.match(observed[3],/2 transaksi pembayaran unik/);
});

test('matching exact counts, including zero and a local export without TotalRecords, prove totals for the files present',()=>{
  const e=ledger([[payment('a')]],{total:1,reported:null});
  assert.equal(report([e]).full[1],15);
  assert.equal(report([ledger([[]],{total:0,reported:0})]).full[1],0);
  const empty=report([ledger([[]])]);assert.equal(empty.full[1],null);assert.equal(empty.observed,undefined);
  const explicit=report([ledger([[payment('0',0)]])]);assert.equal(explicit.full[1],null);assert.equal(explicit.observed[1],0);
  // A request may be exactly full by coincidence.
  const sentinel=ledger([[payment('one')]],{total:1,reported:1,limit:1});
  assert.equal(report([sentinel]).full[1],null);
  assert.equal(monthIsComplete({manifest:{}},sentinel,owner,year,month,code),true); // Existing installment contract.
});

test('a page-size sentinel needs contiguous offsets and an explicit end',()=>{
  const e=ledger([[payment('a')],[payment('b',4)]]);
  Object.assign(e.pages[0].Payload,{First:0,HasMore:true});
  Object.assign(e.pages[1].Payload,{First:1,HasMore:false});
  assert.equal(report([e]).full[1],19);
  for(const [key,bad] of [['First',2],['HasMore',true],['HasMore',null]]){
    const copy=structuredClone(e);copy.pages[1].Payload[key]=bad;
    assert.equal(report([copy]).full[1],null);assert.equal(report([copy]).observed[1],19);
  }
  e.pages[1].Payload.TotalRecords=6;
  assert.equal(report([e]).full[1],null);
});

test('duplicates cannot manufacture coverage, and conflicts in identity or payment data suppress even the subtotal',()=>{
  const a=payment('a');
  assert.equal(report([ledger([[a],[a]],{total:2,reported:2})]).observed[1],15);
  const valid=ledger([[a]],{total:1,reported:1});
  for(const extra of [{Amount:17},{PeriodCode:'ZA002025'},{CurrencyCode:'USD'},{TaxpayerTin:'0000000000000040'},{IsCancelled:null}]){
    const other=ledger([[{...a,...extra}]],{annual:true});
    const {full,observed}=report([valid,other]);assert.equal(full[1],null);assert.equal(observed,undefined);
  }
  const {full,observed}=report([valid],['data/bukubesar/2025-10.json']);
  assert.equal(full[1],null);assert.equal(observed[1],15);assert.match(full[3],/1 berkas gagal/);
});

test('source explicitly indicating an uncollected page or a narrower selection stays partial',()=>{
  const e=ledger([[payment('a')]],{total:1,reported:1});
  e.cap.halamanSumber=[{pencocokan:{morePagesAvailable:true}}];assert.equal(report([e]).observed[1],15);
  e.cap.halamanSumber=[{pemilihanBukuBesar:{filterLainPadaSumber:true,filterPembatalanSumber:'aktif'}}];
  assert.equal(report([e]).observed[1],15);
  for(const data of [[1,2],{rows:[1,2]}])
    assert.equal(ledgerPageCountProven({cap:{total:2,lengkap:true},pages:[{Payload:data}]},2),true);
});
