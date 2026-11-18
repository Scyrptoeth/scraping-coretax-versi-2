import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPackage} from '../extension/archive/package.js';
import {rowsOf} from '../extension/analisis/model.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const extension=fileURLToPath(new URL('../extension/',import.meta.url));
const temp=await mkdtemp(path.join(tmpdir(),'scv2-spt-fixture-'));
const fixtureUrl='https://coretax.intranet.pajak.go.id/__local_synthetic_fixture__/spt';
const owner='0000000000000001';
const headings=['','Jenis Pajak','Jenis Surat Pemberitahuan Pajak','Masa Pajak','NOP','Nama Objek Pajak','Model SPT','Tanggal Jatuh Tempo',
  'Tanggal Dibuat','Status SPT','Kanal','Tanggal Penerimaan','Nomor Bukti Penerimaan','Tanggal Resi Pos','Tanggal Submit SPT','Nama Pegawai','ID Petugas'];
const types=['SPT Masa PPN','SPT PPh Badan Rupiah','VAT_VATTRNTEVATC','ICT_WITR','ICT_WTR','ICT_PITR','FIKTIF-JENIS-LAIN'];
const codes=['VAT_VATR','ICT_RCITR','VAT_VATTRNTEVATC','ICT_WITR','ICT_WTR','ICT_PITR'];
function makeRow(type,index) {
  const annual=[types[1],types[5]].includes(type),period=annual?'2025':'Januari 2025';
  return ['',type===types[0]?'PPN':'Pajak Fiktif',type,period,'','',index===3?'Pembetulan 1':'Normal',
    '28-02-2025','20-02-2025',index===3?'Diproses':'Diterima','Kanal Fiktif','20-02-2025','0000'+index,'',
    '20-02-2025','Petugas Uji','00'+index];
}
const small=[types[0],types[0],types[1],types[0],types[1]].map(makeRow);
const combined=[...types,types[0]].map(makeRow);
let fixtureRows=small;
let paginated=false;
function mockPage(){
  if(paginated) return '<!DOCTYPE html><html lang="id"><meta charset="utf-8"><title>Halaman SPT · Fiktif</title>'+
    '<table id="list"><caption>SPT dilaporkan</caption><thead><tr><th>Status SPT</th><th>NPWP</th><th>Jenis SPT</th><th>Masa Pajak</th></tr></thead>'+
    '<tbody><tr><td>Normal</td><td>'+owner+'</td><td>SPT PPh Badan Rupiah</td><td>2025</td></tr></tbody></table>'+
    '<button type="button" aria-controls="list" aria-label="Berikutnya" onclick="document.querySelector(\'tbody td\').textContent=\'Pembetulan\';this.disabled=true">Berikutnya</button></html>';
  return '<!DOCTYPE html><html lang="id"><meta charset="utf-8"><title>SPT Dilaporkan · Fiktif</title><h1>SPT Dilaporkan</h1>'+
    '<p>NPWP yang ditugaskan '+owner+'</p><table><caption>SPT Dilaporkan</caption><thead><tr>'+
    headings.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+
    fixtureRows.map(row=>'<tr>'+row.map((v,i)=>'<td>'+(i===0?'<button type="button" aria-label="Rincian"><svg width="12" height="12" aria-hidden="true"></svg></button>':v)+'</td>').join('')+'</tr>').join('')+
    '</tbody></table></html>';
}
let context;
try{
  context=await chromium.launchPersistentContext(temp,{channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,
    args:['--disable-extensions-except='+extension,'--load-extension='+extension],acceptDownloads:true});
  let fixtureHits=0;
  await context.route(/^https?:\/\//,async route=>{
    if(route.request().url()!==fixtureUrl) return route.abort();
    fixtureHits++;return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:mockPage()});
  });
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extOrigin=new URL(worker.url()).href.replace(/\/[^/]*$/,'');
  const source=await context.newPage(),capture=await context.newPage();
  await source.goto(fixtureUrl);
  await capture.goto(extOrigin+'/app.html');
  await capture.getByText('1 tab Coretax tersedia').waitFor();
  await capture.locator('#ids').fill(owner);await capture.locator('#officer').fill('Penguji Fiktif');
  await capture.locator('#year-start').selectOption('2025');await capture.locator('#year-end').selectOption('2025');
  await capture.locator('#month-start').selectOption('01');await capture.locator('#month-end').selectOption('12');
  await capture.locator('#source').selectOption('sptdaftar');
  assert.equal(await capture.locator('#spt-field').isVisible(),false);
  await capture.locator('#consent').check();
  async function captureTable(expected,byType,unknown,omitted) {
    const sourceMatrix=await source.locator('table tbody tr').evaluateAll(rs=>rs.map(r=>[...r.cells].map(c=>c.innerText)));
    const headers=await source.locator('table th').allTextContents();headers[0]='Kolom 1';
    assert.deepEqual(headers.slice(1),headings.slice(1));
    const values=sourceMatrix.filter((_,index)=>expected.includes(index));
    await capture.locator('#scope-ok').check();
    await capture.locator('#list-tables').click();
    await capture.locator('#table-pick').waitFor();
    assert.match(await capture.locator('#table option:checked').textContent(),new RegExp(fixtureRows.length+' baris'));
    await capture.locator('#add-table').click();
    await capture.locator('#queue .item').waitFor();
    await capture.locator('#preview').click();
    const preview=capture.getByRole('table',{name:'Pratinjau penarikan',exact:true});
    await preview.waitFor();
    assert.equal(await preview.locator('tbody tr td').last().innerText(),String(values.length));
    if(omitted)assert.match(await capture.locator('#status').textContent(),new RegExp(omitted+' baris di luar'));
    await capture.locator('#start').click();
    await capture.waitForFunction(()=>!document.querySelector('#queue .item'));
    const result=capture.getByRole('table',{name:'Tarikan terakhir per WP',exact:true}).locator('tbody tr').first();
    await result.getByRole('button',{name:'Unduh paket'}).click();
    const download=capture.waitForEvent('download');
    await capture.locator('#package-dialog button[value=ok]').click();
    const archive=await readPackage(await readFile(await (await download).path()));
    assert.equal(archive.report.valid,true);assert.equal(archive.manifest.wp.npwp,owner);assert.equal(archive.entries.length,1);
    const entry=archive.entries[0];
    assert.equal(entry.path,'spt/daftar.json');assert.equal(entry.cap.baris,values.length);assert.equal(entry.cap.konteks.jenisSpt,undefined);
    assert.deepEqual(rowsOf(entry),values.map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i]]))));
    assert.deepEqual(Object.keys(rowsOf(entry)[0]),headers);
    const selection=entry.cap.halamanSumber[0].klasifikasiSpt;
    assert.deepEqual(selection.perJenisPadaSumber,byType);assert.equal(selection.jenisBelumDikenali,unknown);
    assert.equal(selection.barisSumber,sourceMatrix.length);assert.equal(selection.barisDilewati,omitted);
    const opening=context.waitForEvent('page');
    await result.getByRole('button',{name:'Buka di Analisis'}).click();
    const viewer=await opening;
    await viewer.waitForFunction(owner=>document.querySelector('#taxpayer option:checked')?.textContent.includes(owner),owner);
    await viewer.getByRole('button',{name:'SPT',exact:true}).first().click();
    await viewer.locator('summary').getByText('Daftar SPT dilaporkan',{exact:true}).click();
    const table=viewer.getByRole('table',{name:'Daftar SPT dilaporkan',exact:true});
    assert.deepEqual(await table.locator('thead th').allInnerTexts(),headers);
    const display=await table.locator('tbody tr').evaluateAll(rs=>rs.map(r=>[...r.cells].map(c=>c.innerText)));
    assert.deepEqual(display,values.map(row=>row.map(v=>v || '—')));
    await viewer.close();
  }
  await captureTable([0,1,2,3,4],{VAT_VATR:3,ICT_RCITR:2},0,0);
  fixtureRows=combined;await source.reload();
  const counts=Object.fromEntries(codes.map(c=>[c,c==='VAT_VATR'?2:1]));
  await captureTable(combined.map((_,i)=>i),counts,1,0);
  for(const code of codes.filter(c=>c!=='ICT_RCITR' && c!=='ICT_PITR'))await capture.locator('#forms input[value="'+code+'"]').uncheck();
  await captureTable([1,5],counts,1,6);
  paginated=true;await source.reload();
  await capture.locator('#scope-ok').check();await capture.locator('#list-tables').click();
  await capture.locator('#pagination-options summary').click();await capture.locator('#page-limit').fill('2');
  await capture.locator('#collect-pages').click();
  await capture.waitForFunction(()=>document.querySelector('#page-status').textContent.startsWith('2 halaman masuk antrean. Periksa ulang tabel'));
  assert.equal(await capture.locator('#queue .item').count(),2);
  await capture.locator('#start').click();await capture.waitForFunction(()=>!document.querySelector('#queue .item'));
  await capture.getByRole('table',{name:'Tarikan terakhir per WP',exact:true}).getByRole('button',{name:'Unduh paket'}).click();
  const lastFile=capture.waitForEvent('download');await capture.locator('#package-dialog button[value=ok]').click();
  const paged=await readPackage(await readFile(await (await lastFile).path()));
  assert.equal(paged.report.valid,true);assert.equal(paged.entries.length,1);
  assert.deepEqual(rowsOf(paged.entries[0]).map(r=>r['Status SPT']),['Normal','Pembetulan']);
  await capture.locator('#results > details > summary').click();
  const history=capture.getByRole('table',{name:'Riwayat untuk NPWP '+owner,exact:true}).locator('tbody tr');
  assert.equal(await history.count(),3);
  const historicFile=capture.waitForEvent('download');
  await history.last().getByRole('button',{name:'Unduh paket'}).click();
  await capture.locator('#package-dialog button[value=ok]').click();
  const original=await readPackage(await readFile(await (await historicFile).path()));
  assert.equal(original.report.valid,true);assert.equal(rowsOf(original.entries[0]).length,5);
  assert.equal(fixtureHits,3);
  console.log('PASS: installed MV3 capture to viewer, synthetic 5 × 17 SPT table, six supported types, unknown and filtered rows, source order, native pagination, ZIP and every visible cell.');
}finally{if(context)await context.close();await rm(temp,{recursive:true,force:true});}
