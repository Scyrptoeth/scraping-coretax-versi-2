import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessmentOutput,assessmentSheets,vatCascade} from '../extension/analisis/assessment-simulation.js';
import {assessLine,buildIndex} from '../extension/analisis/kkp-index.js';
import {indexPackage} from '../extension/analisis/model.js';

const wp='0000000000000017';
function month(month,pk,pm,carry,net,{version=0,id='sample-'+month,body={},complete=true}={}){
  const period='2025-'+month;
  const form={OutputTaxMustBeSelfCollected:{VAT:pk},InputTaxCanBeCalculated:{VAT:pm+carry},
    VATIsDepositedInAdvance:{VAT:0},CarryForwardOfInputTax:{VAT:carry},VATUnderOrOverPaid:{VAT:net},...body};
  return {path:'spt/PPN/'+period+'/p'+String(version).padStart(2,'0')+'_'+id+'/induk.json',
    cap:{lengkap:complete,halaman:1,konteks:{npwp:wp,bagian:'induk',spt:{recordId:id,tahun:'2025',pemb:version,masa:period,jenis:'VAT_VATR'}}},
    pages:[{IsSuccessful:true,Payload:{FormData:JSON.stringify(form)}}]};
}
const pack=entries=>indexPackage({manifest:{wp:{npwp:wp}},entries,report:{valid:true}});
function reviewed(index,period,value){
  const line=index.groups.find(g=>g.ref==='N.3.1').lines.find(l=>l.period===period);
  return assessLine(line,{value,document:'Berita acara fiktif',officer:'Penguji',note:'Uji pembanding.',classification:'verified'});
}
test('VAT adjustments move a verified full credit forward and interest competes with the increase only once',()=>{
  const pkg=pack([month('01',7000,10000,0,-3000),month('02',13000,9000,3000,1000)]);
  const index=buildIndex(pkg,'2025'),work={simulation:{end:'2025-04-01'},rows:[reviewed(index,'2025-01',9000),reviewed(index,'2025-02',14000)]};
  const [jan,feb]=vatCascade(pkg,'2025',work,index);
  assert.deepEqual([jan.delta,jan.revised,feb.revisedCarry,feb.revised,feb.delta,feb.increaseBase],[0,-1000,1000,4000,3000,2000]);
  assert.equal(feb.impact.increase,1500);assert.ok(feb.impact.interest>0);assert.equal(feb.impact.sanction,1500);assert.equal(feb.impact.total,4500);
  const output=assessmentOutput(pkg,'2025',work,index);assert.equal(output.lines[0].Jumlah,4500);
  assert.deepEqual(assessmentSheets(output).map(s=>s.name),['Simulasi','Kaskade PPN']);
  assert.equal(vatCascade(pkg,'2025',{rows:work.rows},index)[1].impact.total,undefined);
  const closed=work.rows.map(r=>({...r,review:'Terjelaskan'}));assert.equal(vatCascade(pkg,'2025',{rows:closed},index)[1].delta,0);
});
test('baseline differences, gaps, ambiguous latest versions, missing values and genuine zeros remain distinguishable',()=>{
  const pkg=pack([month('01',0,60,0,-60,{body:{DeliveryOfTaxableGoodsSubjectToVAT:{VAT:20}}}),
    month('02',100,50,60,-10),month('04',100,20,15,65),month('05',0,0,0,0),
    month('06',10,0,0,10,{body:{InputTaxCanBeCalculated:{}}}),month('07',1,0,0,1),month('07',2,0,0,2,{id:'second'}),
    month('08',1,0,0,1,{complete:false})]);
  const index=buildIndex(pkg,'2025'),[jan,feb,apr,may,jun,jul,aug]=vatCascade(pkg,'2025',{},index);
  assert.deepEqual([jan.primaryPk,jan.pk,jan.declared,jan.baseline,jan.delta],[0,20,-60,-40,0]);
  assert.deepEqual([feb.carry,feb.revisedCarry,feb.baseline,feb.delta],[60,40,10,0]);
  assert.equal(apr.revisedCarry,15);assert.match(apr.notes.join(' '),/terputus/);assert.equal(may.revised,0);
  for(const row of [jun,jul,aug]){assert.equal(row.valid,false);assert.equal(row.delta,undefined);}
  assert.equal(assessmentOutput(pkg,'2025',{},index).lines[0].Pokok,null);
});
test('filtered sources, conflicting identity and stale reviews cannot produce a monetary result',()=>{
  for(const change of [entry=>entry.cap.payload={Filters:[{}]},entry=>entry.pages[0].Payload.TIN='0000000000000022',
    entry=>entry.pages[0].Payload.PeriodCode='02022025',entry=>entry.pages[0].Payload.CurrencyCode='USD']){
    const entry=month('01',20,10,0,10);change(entry);const pkg=pack([entry]);
    assert.equal(vatCascade(pkg,'2025',{},buildIndex(pkg,'2025'))[0].valid,false);
  }
  const pkg=pack([month('01',20,10,0,10)]),index=buildIndex(pkg,'2025');
  const stale={...reviewed(index,'2025-01',25),menurutWp:19};
  assert.equal(vatCascade(pkg,'2025',{rows:[stale]},index)[0].valid,false);
});
test('reviewed annual balances require a matching return; an unknown fiscal end keeps interest pending',()=>{
  function sample({data={},code='01122025',cap={}}={}){
    const entry={path:'spt/BADAN/2025/p00_badan/induk.json',cap:{lengkap:true,halaman:1,konteks:{npwp:wp,bagian:'induk',
      spt:{npwp:wp,recordId:'badan',tahun:'2025',pemb:0,masa:code,jenis:'ICT_RCITR'}},...cap},pages:[{IsSuccessful:true,Payload:{
      FormData:JSON.stringify({MainFormData:{UnderpaymentIncomeTax:100,AccountingPeriodStart:1,AccountingPeriodEnd:12,...data}})}}]};
    const pkg=pack([entry]),index=buildIndex(pkg,'2025'),line=index.groups.find(g=>g.ref==='B').lines.find(l=>l.topic.includes('kurang/(lebih)'));
    const row=assessLine(line,{value:200,document:'Bukti fiktif',note:'Pengujian saldo akhir',officer:'Penguji'});
    return assessmentOutput(pkg,'2025',{rows:[row],simulation:{end:'2026-11-18'}},index).lines.find(r=>r.Indeks==='B');
  }
  const matched=sample();assert.equal(matched.Pokok,100);assert.ok(matched.Jumlah>100);
  const uncertain=sample({code:'2025',data:{AccountingPeriodEnd:null}});assert.equal(uncertain.Pokok,100);assert.equal(uncertain.Jumlah,undefined);
  assert.match(uncertain.Keterangan,/Akhir tahun buku/);
  for(const bad of [{cap:{lengkap:false}},{data:{Currency:'USD'}},{cap:{payload:{First:20}}}])assert.equal(sample(bad).Pokok,null);
});
