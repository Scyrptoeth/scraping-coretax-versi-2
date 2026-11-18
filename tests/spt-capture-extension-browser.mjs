import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPackage} from '../extension/archive/package.js';
import {rowsOf} from '../extension/analisis/model.js';
import {visibleTables} from '../extension/app-data.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const extension=fileURLToPath(new URL('../extension/',import.meta.url));
const temp=await mkdtemp(path.join(tmpdir(),'scv2-spt-fixture-'));
const fixtureUrl='https://coretax.intranet.pajak.go.id/__local_synthetic_fixture__/spt';
const owner='0000000000000001';
const officialUrl='https://coretax.intranet.pajak.go.id/returnsheets/id-ID/submitted-returnsheets/00000000-0000-4000-8000-000000000001';
function submittedPage(){
  const id=new URL(officialUrl).pathname.split('/').at(-1);
  return '<!doctype html><html lang="id"><meta charset="utf-8"><header>Petugas '+owner+'</header>'+
    '<aside><div><b id="owner">'+owner+'</b><div>Nama perusahaan fiktif</div></div><ul>'+
    '<li><a href="'+officialUrl+'">SPT Dilaporkan</a></li><li><a href="/registration/id-ID/general-information/'+id+'">Informasi Umum Wajib Pajak</a></li>'+
    '<li><a href="/returnsheets/id-ID/taxpayer-search">Pilih Wajib Pajak Lain</a></li></ul></aside>'+
    '<div class="p-datatable"><table id="sptlist"><thead><tr>'+
    ['Jenis Pajak','Jenis Surat Pemberitahuan Pajak','Masa Pajak','Model SPT','Status SPT'].map(s=>'<th>'+s+'</th>').join('')+
    '</tr></thead><tbody><tr><td>PPN</td><td>SPT Masa PPN</td><td>Januari 2016</td><td>Normal</td><td>Dilaporkan</td></tr></tbody></table>'+
    '<div class="p-paginator"><button class="p-paginator-prev" type="button" disabled>‹</button><button type="button">1</button>'+
    '<button class="p-paginator-next" type="button" onclick="document.querySelector(\'tbody tr\').cells[2].textContent=\'Januari 2025\';this.classList.add(\'p-disabled\')"><i aria-hidden="true">›</i></button></div></div></html>';
}
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
    if(route.request().url()===officialUrl)return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:submittedPage()});
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
    if(fixtureRows===small) {
      const plan=capture.getByRole('table',{name:'SPT dalam periode terpilih',exact:true});
      assert.deepEqual(await plan.locator('tbody tr > *').allInnerTexts(),['1','1','0','1','0']);
      await capture.getByText('Rincian versi SPT dan bagian yang tersedia',{exact:true}).click();
      const version=capture.getByRole('table',{name:'Versi SPT yang ditemukan',exact:true});
      await version.locator('tbody tr').first().waitFor();
      assert.deepEqual(await version.locator('tbody tr > *').allInnerTexts(),['Masa PPN','2025-01','1','—','induk','—','Cari tampilan SPT']);
    }
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
    await viewer.waitForFunction(owner=>document.querySelector('#taxpayer option:checked')?.textContent.includes(owner),owner)
      .catch(async error=>{throw new Error('Pemutar fiktif: '+await viewer.locator('#status').innerText(),{cause:error});});
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
  await source.goto(officialUrl);
  for(const code of codes)await capture.locator('#forms input[value="'+code+'"]').check();
  await capture.locator('#scope-ok').check();await capture.locator('#batch summary').click();await capture.locator('#batch-scan').click();
  const resultRow=capture.locator('#batch-rows .batch-row');
  await resultRow.first().waitFor();assert.equal(await resultRow.locator('select').first().inputValue(),'sptdaftar');
  await capture.locator('#batch-page-limit').fill('5');await capture.locator('#batch-add').click();
  await capture.locator('#batch-status').filter({hasText:'1 tabel masuk antrean, 0 dilewati'}).waitFor();
  await capture.locator('#start').click();await capture.waitForFunction(()=>!document.querySelector('#queue .item'));
  await capture.getByRole('table',{name:'Tarikan terakhir per WP',exact:true}).getByRole('button',{name:'Unduh paket'}).click();
  const newFile=capture.waitForEvent('download');await capture.locator('#package-dialog button[value=ok]').click();
  const indexPkg=await readPackage(await readFile(await (await newFile).path()));
  assert.deepEqual(rowsOf(indexPkg.entries[0]).map(r=>r['Masa Pajak']),['Januari 2016','Januari 2025']);
  const proof=indexPkg.entries[0].cap.halamanSumber[0].pencocokan;
  assert.deepEqual(proof.pageRows,[1,1]);assert.equal(proof.morePagesAvailable,false);
  assert.equal(proof.ownerEvidence,'Panel WP pada SPT Dilaporkan');assert.equal(proof.indexScope,'Daftar SPT lintas masa');
  const scope={source:'sptdaftar',wp:owner,from:'2025-01',to:'2025-12',periodRequired:true};
  await source.reload();
  const [listed]=await source.evaluate(visibleTables,null),selector={...listed,url:officialUrl,scope};
  assert.equal(listed.canAdvance,true);
  const other=await source.evaluate(visibleTables,{...selector,scope:{...scope,source:'bb'}});
  assert.match(other.skip,/Kategori sumber/);
  const before=await source.evaluate(visibleTables,selector);
  await source.locator('.p-paginator-next').evaluate(b=>b.addEventListener('click',()=>{document.querySelector('#owner').textContent='0000000000000002';}));
  await assert.rejects(source.evaluate(visibleTables,{...selector,advance:true,expected:JSON.stringify(before.rows)}),/NPWP tampilan berubah/);
  const wrong=await source.evaluate(visibleTables,selector);assert.match(wrong.skip,/Panel WP/);
  await source.reload();await source.locator('#owner').evaluate(el=>el.parentElement.remove());
  const absent=await source.evaluate(visibleTables,selector);assert.match(absent.skip,/Panel WP/);
  await source.reload();await source.locator('a[href*="general-information"]').evaluate(el=>el.href=el.href.slice(0,-1)+'2');
  const inconsistent=await source.evaluate(visibleTables,selector);assert.match(inconsistent.skip,/Panel WP/);
  await source.reload();await source.locator('.p-paginator-next').evaluate(b=>b.addEventListener('click',()=>document.querySelector('th').textContent='Tabel lain'));
  await assert.rejects(source.evaluate(visibleTables,{...selector,advance:true,expected:JSON.stringify(before.rows)}),/Kolom tabel sumber berubah/);
  await source.reload();await source.locator('.p-paginator-next').evaluate(b=>b.addEventListener('click',()=>history.replaceState({},'','?different-source')));
  await assert.rejects(source.evaluate(visibleTables,{...selector,advance:true,expected:JSON.stringify(before.rows)}),/Alamat halaman berubah/);
  await source.goto(officialUrl);
  await source.locator('.p-paginator-next').evaluate(b=>b.setAttribute('aria-disabled','true'));
  assert.equal((await source.evaluate(visibleTables,null))[0].canAdvance,false);
  console.log('PASS: installed MV3 capture to viewer, synthetic 5 × 17 SPT table, mixed types, native pagination, cross-year index, WP-panel checks, disabled icon and changed source, columns or URL.');
}finally{if(context)await context.close();await rm(temp,{recursive:true,force:true});}
