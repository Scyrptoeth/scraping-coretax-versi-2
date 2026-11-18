import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {readPackage} from '../extension/archive/package.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const extension=fileURLToPath(new URL('../extension/',import.meta.url));
const tmp=await mkdtemp(path.join(tmpdir(),'scv2-overlap-'));
const owner='0000000000000001';
const row=(name,value) => ({'ID SPT':'DOC-DEMO','Masa Pajak':'2025-01',Pembetulan:0,'Bagian SPT':'Lampiran A1',
  NPWP:owner,Barang:name,Jumlah:value});
const first=row('A',7),second=row('B',9),changed=row('A',10);
const inputs=[['a.json',[first]],['b.json',[first,second]],['c.json',[changed,second]]];
const fixture='https://coretax.intranet.pajak.go.id/__synthetic__/lampiran';
const header=Object.keys(first).map(key=>'<th>'+key+'</th>').join('');
const cells=Object.values(first).map(value=>'<td>'+value+'</td>').join('');
const sample='<div class="p-datatable"><table id="annex"><caption>Lampiran A1</caption><thead><tr>'+header+
  '</tr></thead><tbody><tr>'+cells+'</tr></tbody></table><div class="p-paginator">'+
  '<button aria-controls="annex" aria-label="Berikutnya" type="button" onclick="document.querySelector(\'tr:last-child td:nth-last-child(2)\').innerText=\'B\';document.querySelector(\'tbody tr td:last-child\').innerText=\'9\';this.disabled=true">Berikutnya</button></div></div>';
let ctx;
try {
  ctx=await chromium.launchPersistentContext(tmp,{channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,
    args:['--disable-extensions-except='+extension,'--load-extension='+extension],acceptDownloads:true});
  await ctx.route(/^https?:\/\//,route=>route.request().url()===fixture?route.fulfill({contentType:'text/html',body:sample}):route.abort());
  const worker=ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const sourcePage=await ctx.newPage();await sourcePage.goto(fixture);
  const ui=await ctx.newPage();await ui.goto(new URL('app.html',worker.url()).href);
  await ui.locator('#ids').fill(owner);await ui.locator('#officer').fill('Penguji');
  await ui.locator('#year-start').selectOption('2025');await ui.locator('#year-end').selectOption('2025');
  await ui.locator('#source').selectOption('sptisi');await ui.locator('#spt').selectOption('VAT_VATR');
  await ui.locator('#scope-ok').check();
  await ui.locator('#source-files').setInputFiles(inputs.map(([name,rows])=>({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(rows))})));
  await ui.waitForFunction(()=>document.querySelectorAll('#queue .item').length===3);
  await ui.locator('#consent').check();await ui.locator('#start').click();
  await ui.getByRole('button',{name:'Unduh paket'}).first().click();
  const downloaded=ui.waitForEvent('download');await ui.locator('#package-dialog button[value=ok]').click();
  const bytes=await readFile(await (await downloaded).path());
  const result=await readPackage(bytes);assert.ok(result.report.valid);
  const primary=result.entries.find(e=>e.path==='spt/PPN/2025-01/p00_DOC-DEMO/a1.json');
  assert.ok(primary);
  console.log('Jumlah anggota bagian',result.entries.length,'halaman kanonis',primary.pages.length,
    'baris kanonis',primary.cap.baris,'baris asli tiap sumber',inputs.map(([,rows])=>rows.length).join(','),
    'keterangan hasil',result.manifest.cek.length);
  assert.equal(primary.pages.length,1,'Independent snapshots with overlapping or changed rows must not be counted as successive pages.');
  assert.deepEqual(primary.pages[0].Payload.Data,[first]);
  assert.equal(primary.cap.lengkap,false);
  assert.equal(result.manifest.cek.filter(c=>c.kode==='CUPLIKAN-SPT').length,1);
  assert.equal(result.entries.filter(e=>e.path.startsWith('spt/')).length,1);
  for(const [i,ref] of primary.cap.cuplikanSpt.pembanding.entries()){
    const sample=result.entries.find(e=>e.path===ref);
    assert.deepEqual(sample.pages[0].Payload.Data,inputs[i+1][1]);
    assert.equal(sample.cap.asal,inputs[i+1][0]);
    assert.equal(sample.cap.cuplikanSpt.utama,primary.path);
  }
  const newViewer=ctx.waitForEvent('page');
  await ui.getByRole('button',{name:'Buka di Analisis'}).first().click();const viewer=await newViewer;
  await viewer.waitForFunction(owner=>document.querySelector('#taxpayer option:checked')?.textContent.includes(owner),owner);
  await viewer.getByRole('button',{name:'SPT',exact:true}).first().click();
  await viewer.getByRole('table',{name:'Daftar SPT',exact:true}).getByRole('button',{name:'Buka',exact:true}).click();
  const dialog=viewer.getByRole('dialog');
  assert.equal(await dialog.getByRole('combobox',{name:'Versi',exact:true}).locator('option').count(),1);
  for(const [,entry] of primary.cap.cuplikanSpt.pembanding.entries()) {
    const source=result.entries.find(e=>e.path===entry);
    await dialog.locator('summary').getByText(source.cap.label,{exact:true}).click();
    const table=dialog.getByRole('table',{name:source.cap.label,exact:true});
    await table.waitFor();assert.equal(await table.locator('tbody tr').count(),2);
  }
  await viewer.close();
  await ui.locator('#scope-ok').check();await ui.locator('#list-tables').click();
  await ui.locator('#pagination-options summary').click();await ui.locator('#page-limit').fill('2');await ui.locator('#collect-pages').click();
  await ui.waitForFunction(()=>document.querySelectorAll('#queue .item').length===2);
  await ui.locator('#start').click();await ui.waitForFunction(()=>!document.querySelector('#queue .item'));
  await ui.getByRole('button',{name:'Unduh paket'}).first().click();
  const serialDownload=ui.waitForEvent('download');await ui.locator('#package-dialog button[value=ok]').click();
  const serial=await readPackage(await readFile(await (await serialDownload).path()));
  assert.ok(serial.report.valid);
  const section=serial.entries.find(e=>e.path===primary.path);
  assert.equal(serial.entries.length,1);assert.equal(section.pages.length,2);
  assert.deepEqual(section.pages.flatMap(p=>p.Payload.Data.map(r=>r.Barang)),['A','B']);
  assert.deepEqual(section.cap.halamanSumber.map(p=>p.pencocokan.urutan.halaman),[1,2]);
  assert.equal(serial.manifest.cek.filter(c=>c.kode==='CUPLIKAN-SPT').length,0);
  if(process.env.VERITAX_STUDIO) {
    const ref=await ctx.newPage();await ref.goto(pathToFileURL(path.resolve(process.env.VERITAX_STUDIO)).href);
    const welcome=ref.getByRole('dialog').getByRole('button',{name:'Mulai',exact:true});
    if(await welcome.isVisible())await welcome.click();
    await ref.locator('#filePkg').setInputFiles({name:'fiktif.zip',mimeType:'application/zip',buffer:bytes});
    await ref.waitForFunction(()=>Boolean(document.querySelector('#wpSel')?.value));
    const note=await ref.locator('#pkgList').innerText();assert.ok(note.includes(result.report.manifestHash));assert.match(note,/Konsisten: 3 file/);
    await ref.locator('#tabs [data-tab=tabel]').click();
    const raw=ref.locator('#v-tabel');
    await raw.getByRole('button',{name:/^PPN · A1/}).click();
    await raw.getByRole('cell',{name:'A',exact:true}).waitFor();
    assert.equal(await raw.getByRole('cell',{name:'B',exact:true}).count(),0);
    await ref.locator('#tabs [data-tab=spt]').click();
    const returns=ref.locator('#v-spt table').filter({has:ref.getByRole('columnheader',{name:'Jenis SPT',exact:true})});
    assert.equal(await returns.locator(':scope > tbody > tr').filter({hasText:'Jan 2025'}).count(),1);
    await ref.close();
  }
} finally {
  await ctx?.close();await rm(tmp,{recursive:true,force:true});
}
