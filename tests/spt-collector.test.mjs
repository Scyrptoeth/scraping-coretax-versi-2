import assert from 'node:assert/strict';
import test from 'node:test';
import {appendPackageEntry,packagePath} from '../extension/app-package-entries.js';
import {createPackage,readPackage} from '../extension/archive/package.js';
import {createXlsx} from '../extension/archive/table.js';
import {readZip,decodeText} from '../extension/archive/zip.js';
import {indexPackage,periodFacts,typeNames} from '../extension/analisis/model.js';
import {financialPosition,formSheets} from '../extension/analisis/spt-forms.js';

// Locally constructed test rows. The distributed reference demos do not contain this SPT.
const npwp='0000000000000001', id='DEMO-KOLEKTOR';
function item(part){
  return {id:'local-test',source:'sptisi',spt:'VAT_VATTRNTEVATC',period:'2025-01 s.d. 2025-12',rows:1,total:null,
    name:'Tabel pengujian',origin:'Tabel tampak',page:{Payload:{Data:[{NPWP:npwp,'ID SPT':id,'Masa Pajak':'2025-03',Pembetulan:'01',
      'Bagian SPT':part,'Kode contoh':'0007','Nilai contoh':'0'}]}}};
}
test('round-trips the four known collector VAT parts, presents the type and exports unchanged source values',async()=>{
  const groups=new Map();
  for(const title of ['Induk SPT PPN Pemungut','Lampiran 1','Lampiran 2','Lampiran 2: Jumlah'])appendPackageEntry(groups,item(title),npwp);
  const pkg=indexPackage(await readPackage(await createPackage({meta:{wp:{npwp},periode:'Maret 2025'},entries:[...groups.values()]})));
  assert.equal(pkg.report.valid,true);assert.equal(pkg.forms.length,1);
  const [form]=pkg.forms;
  assert.deepEqual([form.type,form.period,form.id,form.version],['PPN-PEMUNGUT','2025-03',id,1]);
  assert.equal(typeNames[form.type],'PPN non-PKP / Pemungut');
  assert.deepEqual([...form.parts.keys()].sort(),['induk','l1','l2','l2-total']);
  assert.equal(financialPosition(form).amount,null);
  assert.deepEqual(periodFacts(pkg,'2025'),[{Jenis:typeNames[form.type],Periode:'2025-03',Versi:1}]);
  const sheets=formSheets([form],pkg,true);assert.equal(sheets.length,4);
  assert.ok(sheets.every(s=>s.rows.some(r=>r.includes('0007'))));
  const workbook=await readZip(new Uint8Array(await (await createXlsx({sheets})).arrayBuffer()));
  assert.equal([...workbook.keys()].filter(path=>/^xl\/worksheets\/sheet\d+\.xml$/.test(path)).length,5);
  assert.match(decodeText(workbook.get('xl/workbook.xml').data),/<sheets><sheet name="Daftar Isi"/);
  assert.match(decodeText(workbook.get('xl/worksheets/sheet1.xml').data),/0007/);
});
test('keeps a collector table without confirmed metadata or a recognized part as raw evidence',()=>{
  assert.equal(packagePath(item('A2')),'sptisi/local-test.json');
  for(const field of ['ID SPT','Masa Pajak','Pembetulan','Bagian SPT']){
    const source=item('l1');delete source.page.Payload.Data[0][field];
    assert.equal(packagePath(source),'sptisi/local-test.json');
  }
  const list={...item('l1'),source:'sptdaftar'};
  assert.equal(packagePath(list),'spt/daftar.json');
});
