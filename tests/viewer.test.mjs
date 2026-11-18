import assert from 'node:assert/strict';
import test from 'node:test';
import {indexPackage,periodFacts,issues,differences,selectRows,worksheet} from '../extension/analisis/model.js';

const entry=(path,payload,cap={})=>({path,cap,pages:[{IsSuccessful:true,Payload:payload}]});
const form=(version,id,n)=>entry('spt/PPN/2025-02/p'+version+'_'+id+'/induk.json',{FormData:JSON.stringify({TotalDeliveryOfGoodsAndServices:{SellingPrice:n},VATUnderOrOverPaid:{VAT:0}})});
test('SPT uses latest amendment, actual fields and date portions; missing values stay missing',()=>{
  const model=indexPackage({manifest:{opsi:{periode:{from:{y:2024},to:{y:2025}}}},entries:[
    form('00','A',10),form('01','B',12),entry('spt/daftar.json',{Data:[
      {RecordId:'A',ReturnDate:'2025-03-31T23:00:00',ExpectedReturnDate:'2025-03-31T00:00:00'},
      {RecordId:'B',ReturnDate:'2025-04-01',ExpectedReturnDate:'2025-03-31'}]})]});
  assert.deepEqual(model.years,['2025','2024']);assert.equal(model.forms.length,2);
  const [r]=periodFacts(model,'2025');assert.equal(r.Penyerahan,12);assert.equal(r['PPN masukan'],null);assert.equal(r['KB/(LB)'],0);
  assert.equal(model.forms.find(f=>f.id==='A').late,false);assert.equal(model.forms.find(f=>f.id==='B').late,null);
  assert.deepEqual(issues(model,'2025').map(x=>x.Butir),['Pembetulan SPT']);
});
test('preserve IDs, zeros, numeric ordering and field-level changes',()=>{
  const rows=[{Kode:'0003',Nilai:0},{Kode:'0012',Nilai:-2}];
  assert.equal(selectRows(rows,'',{key:'Nilai',dir:1})[0].Kode,'0012');assert.deepEqual(worksheet(rows)[1],['0003',0]);
  assert.deepEqual(differences({a:null,b:1},{a:0,b:1,c:'001'}).map(x=>x.Isian),['a','c']);
});
