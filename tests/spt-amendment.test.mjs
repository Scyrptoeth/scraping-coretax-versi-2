import assert from 'node:assert/strict';
import {test} from 'node:test';
import {amendmentSheets,compareSptPart} from '../extension/analisis/spt-amendment.js';

const a={DocumentNumber:'FAK-A',Name:'A',TIN:'00001',TaxBase:1000,VAT:110};
const b={DocumentNumber:'FAK-B',Name:'B',TIN:'00002',TaxBase:2000,VAT:220};
const grid=(path,...tables)=>({path,cap:{lengkap:true,konteks:{jenisBagian:'grid'}},pages:tables.map(rows=>({Payload:{Data:rows}}))});
const compare=(left,right)=>compareSptPart('a2',left,right);

test('a reordered annex across different pages changes only the value on the same document',()=>{
  const previous=grid('lama',[a],[b]);
  const same=compare(previous,grid('baru',[b,a]));
  assert.deepEqual(same.changes,[]);assert.equal(same.summary['Dokumen berpasangan'],2);
  const changed=compare(previous,grid('baru',[{...b,VAT:225},a]));
  assert.equal(changed.changes.length,1);
  assert.deepEqual(changed.changes[0],{Status:'Berubah',Dokumen:'FAK-B',Isian:'VAT',Sebelumnya:220,Sekarang:225,
    'Sumber sebelumnya':'lama · halaman 2, baris 1','Sumber sekarang':'baru · halaman 1, baris 1'});
  assert.equal(changed.totals.find(t=>t.Isian==='VAT').Selisih,5);
  assert.deepEqual(changed.unmatched,[]);
  const sheets=amendmentSheets(changed,'Normal → P1');
  assert.equal(sheets.find(s=>s.name==='Perubahan').rows[1][1],'FAK-B');
});
test('additions, removals, empty grids and zero remain distinct from an absent part or missing amount',()=>{
  const added=compare(grid('lama',[]),grid('baru',[{...a,VAT:0}]));
  assert.equal(added.summary['Dokumen baru'],1);assert.equal(added.totals.find(t=>t.Isian==='VAT').Selisih,0);
  const replaced=compare(grid('lama',[a]),grid('baru',[b]));
  assert.deepEqual(replaced.changes.map(r=>[r.Status,r.Dokumen]),[['Hilang','FAK-A'],['Baru','FAK-B']]);
  const absent=compare(undefined,grid('baru',[b]));
  assert.equal(absent.summary['Dokumen baru'],0);assert.equal(absent.unmatched.length,1);
  assert.equal(absent.totals[0].Selisih,null);
  const incomplete=grid('baru',[{...b,VAT:null}]);incomplete.cap.total=3;
  const uncertain=compare(grid('lama',[a]),incomplete);
  assert.equal(uncertain.summary['Dokumen hilang'],0);assert.equal(uncertain.totals.find(t=>t.Isian==='VAT').Sekarang,null);
});
test('ambiguous keys stay linked to their source rows, and identity-free rows never match by position',()=>{
  const previous=grid('lama',[a,b,{DocumentNumber:'',VAT:8}]);
  const current=grid('baru',[a,{...b,VAT:1},b,{DocumentNumber:'C',VAT:9},{DocumentNumber:'0',VAT:4}]);
  const result=compare(previous,current);
  assert.equal(result.summary['Dokumen berpasangan'],1);assert.deepEqual(result.changes,[]);
  assert.equal(result.unmatched.length,6);assert.ok(result.unmatched.every(x=>x.Sumber));
  assert.ok(amendmentSheets(result,'Uji').some(s=>s.name==='Perlu dicocokkan'));
  const other=compare(grid('a',[{WithholdingSlipNumber:'00001',IncomeTax:3}]),grid('b',[{WithholdingSlipNumber:'00001',IncomeTax:4}]));
  assert.equal(other.changes[0].Dokumen,'00001');assert.equal(other.changes[0].Isian,'IncomeTax');
});
test('the parent form and non-tabular sections retain field comparisons',()=>{
  const before={pages:[{Payload:{FormData:JSON.stringify({VAT:300})}}]},after={pages:[{Payload:{FormData:JSON.stringify({VAT:305})}}]};
  const result=compareSptPart('induk',before,after);assert.equal(result.kind,'fields');
  assert.deepEqual(result.changes,[{Isian:'0.VAT',Sebelumnya:300,Sekarang:305}]);
  assert.equal(compareSptPart('rekap-total',grid('a',[a]),grid('b',[b])).kind,'fields');
});
