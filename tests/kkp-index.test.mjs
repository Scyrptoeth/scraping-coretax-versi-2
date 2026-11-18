import assert from 'node:assert/strict';
import {test} from 'node:test';
import {indexPackage} from '../extension/analisis/model.js';
import {assessLine,buildIndex,completeIndexBook,indexStatus,restoreIndexedRows,restoreNotes} from '../extension/analisis/kkp-index.js';
import {workpaper} from '../extension/analisis/findings.js';
import {newDraft} from '../extension/analisis/draft-model.js';
import {createXlsx} from '../extension/archive/table.js';
import {decodeText,readZip} from '../extension/archive/zip.js';

const part=(type,period,id,body,part='induk')=>({path:'spt/'+type+'/'+period+'/'+id+'/'+part+'.json',cap:{lengkap:true},pages:[{Payload:{Data:[body]}}]});
const pkg=indexPackage({manifest:{wp:{nama:'Contoh',npwp:'0000000000000001'}},report:{manifestHash:'fixture'},entries:[
  part('PPN','2025-01','p00_lama',{OutputTaxMustBeSelfCollected:{VAT:95}}),
  part('PPN','2025-01','p01_baru',{OutputTaxMustBeSelfCollected:{VAT:0}}),
  part('PPN','2025-02','p00_satu',{OutputTaxMustBeSelfCollected:{VAT:42}}),
  part('PPN','2025-02','p00_dua',{OutputTaxMustBeSelfCollected:{VAT:42}}),
  part('BADAN','2025','p00_tahun',{L1cFormData:{L1cTreeData:[{Data:{AccountCode:'4020',Amount:100,Description:'Penjualan'},Children:[]}]}}),
  part('UNIFIKASI','2025-01','p00_uf',{IncomeTaxes:[{data:{Type:'Tax Article',Name:'Article 23',TotalWithholding:15}}]})]});
const index=buildIndex(pkg,'2025');
const vat=index.groups.find(g=>g.ref==='N.3.1'), line=vat.lines[0];
const evidence={value:25,document:'Bukti sintetik 001',officer:'Penguji fiktif',note:'Dasar pengujian sintetis',classification:'verified'};
test('workpaper positions honor latest and ambiguous returns, missing values and account-specific source references',()=>{
  assert.equal(vat.lines.length,1);assert.equal(line.version,1);assert.equal(line.amount,0);assert.equal(index.warnings.length,1);
  assert.match(line.source,/p01_baru\/induk\.json · OutputTaxMustBeSelfCollected\.VAT/);
  assert.equal(index.groups.find(g=>g.ref==='N.2').lines[0].amount,null);
  const sales=index.groups.find(g=>g.ref==='B.1').lines[0];assert.equal(sales.amount,100);
  assert.match(sales.source,/L1cTreeData\[0\]\.Data\.Amount/);
  const unified=index.groups.find(g=>g.ref==='G');assert.equal(unified.lines[0].amount,15);
  assert.equal(unified.lines[1].amount,null);
});
test('confirmation and corrections preserve evidence and period through KKA and SP2DK; absence of a principal remains explicit',()=>{
  const verified=assessLine(line,evidence), equal=assessLine(line,{...evidence,value:0});
  assert.equal(equal.evidence,'none');assert.equal(verified.principal,null);
  assert.equal(indexStatus(vat,new Map([[line.id,verified]])).changed,1);
  const kka=workpaper(pkg,'2025',{rows:[verified],scopes:{kka:'verified'}},'kka','AR');
  assert.equal(kka.selected.length,1);assert.equal(kka.selected[0].period,'2025-01');assert.equal(kka.selected[0].amount,'');
  assert.match(kka.selected[0].source,/Bukti sintetik 001/);
  const draft=newDraft('SP2DK',pkg,'2025',null,[verified,equal]);
  const linked=draft.findings.filter(f=>f.source.includes('Bukti sintetik 001'));assert.equal(linked.length,1);assert.equal(linked[0].period,'2025-01');
  assert.throws(()=>assessLine(line,{...evidence,document:''}),/rujukan bukti/);
  assert.throws(()=>assessLine(line,{...evidence,note:''}),/penjelasan/);
  assert.deepEqual(restoreIndexedRows([verified],[verified],index),[verified]);
  assert.throws(()=>restoreIndexedRows([verified],[{...verified,menurutWp:2}],index),/berbeda/);
  assert.throws(()=>restoreIndexedRows([verified,verified],[verified,verified],index),/berbeda/);
  assert.deepEqual(restoreNotes(undefined,index),{});
  assert.throws(()=>restoreNotes({'BADAN/X':{revision:0}},index),/tidak sah/);
});
test('annual Excel carries source, signs, explicit zero, reviewed corrections and revision independently of tax principal',async()=>{
  const row=assessLine(line,evidence);
  const sheets=completeIndexBook(pkg,'2025',index,new Map([[line.id,row]]),{[vat.key]:{preparer:'A',reviewer:'B',revision:1}});
  const zip=await readZip(await createXlsx({sheets}));
  const workbook=decodeText(zip.get('xl/workbook.xml').data);assert.match(workbook,/Temuan Sementara/);assert.match(workbook,/Daftar Indeks/);
  const sheet=decodeText(zip.get('xl/worksheets/sheet'+(sheets.findIndex(s=>s.name.startsWith('N.3.1 '))+1)+'.xml').data);
  assert.match(sheet,/N\.3\.1 \(P1\)/);assert.match(sheet,/E7-D7/);assert.match(sheet,/<v>25<\/v>/);assert.match(sheet,/OutputTaxMustBeSelfCollected.VAT/);
  const ts=decodeText(zip.get('xl/worksheets/sheet3.xml').data);
  assert.match(ts,/E2-D2/);assert.match(ts,/Bukti sintetik 001/);assert.equal((ts.match(/<row /g)||[]).length,2);
});
