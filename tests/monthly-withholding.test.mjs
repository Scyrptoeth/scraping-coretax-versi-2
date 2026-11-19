import assert from 'node:assert/strict';
import {test} from 'node:test';
import {indexPackage} from '../extension/analisis/model.js';
import {monthlyWithholding} from '../extension/analisis/monthly-withholding.js';

const field=(article,key)=>'PPh Pasal '+article+' · '+key;
function form(type,period,revision,id,part,payload,complete=true){
  return {path:'spt/'+type+'/'+period+'/p0'+revision+'_'+id+'/'+part+'.json',cap:{lengkap:complete},pages:[{Payload:payload}]};
}
const forms=entries=>indexPackage({entries,manifest:{}}).forms;

test('12 months use only the final version and preserve documented zeros, missing fields and missing SPT',()=>{
  const type='PPH2126';
  const result=monthlyWithholding(forms([
    form(type,'2025-01',0,'a','induk',{FormData:{A21IncomeTaxWithheld:100}}),
    form(type,'2025-01',1,'b','induk',{FormData:{A21IncomeTaxWithheld:12,A26IncomeTaxWithheld:3,Form1A:{GrossIncome:0}}}),
    form(type,'2025-02',0,'c','induk',{FormData:{A21IncomeTaxWithheld:0,Form1B:{OtherField:2}}}),
    form(type,'2024-12',0,'e','induk',{FormData:{A21IncomeTaxWithheld:500}})
  ]),'2025');
  assert.equal(result.rows.length,12);assert.equal(result.rows[0].Masa,'Januari');assert.equal(result.rows[11].Masa,'Desember');
  assert.deepEqual(result.columns,['Masa',field('21','objek'),field('21','PPh')]);
  assert.deepEqual(result.rows.slice(0,3).map(row=>[row[field('21','objek')],row[field('21','PPh')]]),[[0,15],[null,0],['','']]);
  assert.equal(result.total[field('21','PPh')],15);assert.equal(result.total[field('21','objek')],0);
  assert.deepEqual(result.unreportedColumns,[]);assert.equal(result.total.Masa,'Jumlah nilai tersedia');
  assert.equal(result.sources.length,2);assert.match(result.sources[0]['Sumber pajak'],/p01_b/);
});

test('unified tax nodes and matching annex slips populate article columns independently',()=>{
  const unif='UNIFIKASI',period='2025-01',tax={Name:'Article 4 Section 2',TotalWithholding:2,TotalSelfPayment:3,TotalIncomeTaxByGovernment:4};
  const result=monthlyWithholding(forms([
    form(unif,period,0,'d','induk',{FormData:{IncomeTaxes:[{Data:tax},{data:{Name:'Article 22',TotalWithholding:0}},
      {Name:'Article 23',TotalWithholding:7},{Name:'Article 15',TotalWithholding:0}]}}),
    form(unif,period,0,'d','d1-bpu',{Data:[{TaxArticle:'Pasal 4 Ayat (2)',TaxBase:5},{TaxArticle:'Pasal 4 Ayat 2',TaxBase:5},
      {TaxArticle:'Pasal 22',TaxBase:0},{TaxArticle:'Pasal 23',TaxBase:null}]}),
    form(unif,'2025-02',0,'e','induk',{FormData:{TotalIncomeTaxPaid:0}})
  ]),'2025');
  const row=result.rows[0];
  assert.equal(row[field('4 ayat (2)','PPh')],9);assert.equal(row[field('4 ayat (2)','objek')],10);
  assert.equal(row[field('22','objek')],0);assert.equal(row[field('22','PPh')],0);assert.equal(row[field('23','objek')],null);
  assert.equal(result.total[field('23','objek')],null);assert.ok(result.unreportedColumns.includes(field('23','objek')));
  assert.ok(!result.columns.includes(field('15','PPh')));
  assert.equal(result.rows[1]['PPh Unifikasi · PPh'],0);assert.equal(result.rows[1]['PPh Unifikasi · objek'],null);
  assert.match(result.sources[0]['Sumber objek'],/d1-bpu\.json/);assert.match(result.sources[0]['Sumber pajak'],/IncomeTaxes\[0\]/);
});

test('an incomplete annex and an ambiguous final revision cannot inflate monthly totals',()=>{
  const unif='UNIFIKASI',monthly=()=>({FormData:{IncomeTaxes:[{Name:'Article 23',TotalWithholding:7}]}});
  const result=monthlyWithholding(forms([
    form(unif,'2025-01',0,'first','induk',monthly()),
    form(unif,'2025-01',0,'first','d1-bpu',{Data:[{TaxArticle:'Pasal 23',TaxBase:100}]},false),
    form(unif,'2025-02',1,'second','induk',monthly()),form(unif,'2025-02',1,'third','induk',monthly())
  ]),'2025');
  assert.equal(result.total[field('23','PPh')],7);assert.equal(result.total[field('23','objek')],null);
  assert.ok(result.unreportedColumns.includes(field('23','objek')));
  assert.equal(result.rows[1][field('23','PPh')],'');assert.equal(result.warnings.length,2);
});
