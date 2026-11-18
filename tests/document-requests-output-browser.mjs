import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createPackage} from '../extension/archive/package.js';
import {decodeText,readZip} from '../extension/archive/zip.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const extension=resolve(process.env.EXTENSION_DIR||'extension'),profile=await mkdtemp(join(tmpdir(),'coretax-dok-'));
async function fixture(npwp,nama){
  const entries=['2025','2026'].map(year=>({path:'spt/PPN/'+year+'-01/p00_demo/induk.json',
    pages:[{Payload:{FormData:JSON.stringify({TotalDeliveryOfGoodsAndServices:{SellingPrice:200}})}}],cap:{lengkap:true,konteks:{npwp}}}));
  return {name:nama+'.zip',mimeType:'application/zip',buffer:Buffer.from(await (await createPackage({meta:{wp:{npwp,nama}},entries})).arrayBuffer())};
}
let browser;
try{
  browser=await chromium.launchPersistentContext(profile,{offline:true,channel:'chromium',headless:true,
    executablePath:process.env.CHROMIUM_PATH||undefined,args:['--disable-background-networking','--disable-extensions-except='+extension,'--load-extension='+extension],acceptDownloads:true});
  const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker'),page=await browser.newPage();
  page.setDefaultTimeout(6000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(new URL('analisis/index.html',worker.url()).href);
  const button=name=>page.getByRole('button',{name,exact:true});
  const label=name=>page.getByLabel(name,{exact:true});
  const open=async()=>{
    await page.getByRole('navigation').getByRole('button',{name:'Kertas Kerja',exact:true}).click();
    await button('KKP').click();await button('DOK · Permintaan dokumen dan cakupan SP2').click();
  };
  const download=async name=>{
    const [dl]=await Promise.all([page.waitForEvent('download'),button(name).click()]);
    return readFile(await dl.path());
  };
  const workFile=async()=>JSON.parse(await download('Unduh berkas kerja'));
  const add=async name=>{
    await button('Tambah dokumen').click();await label('Nama dokumen').fill(name);
    await label('Indeks atau cakupan SP2').selectOption('SP2/F');await button('Simpan dokumen').click();
  };
  await page.locator('#filePkg').setInputFiles(await Promise.all([fixture('0000000000000017','Badan Contoh A'),fixture('0000000000000018','Badan Contoh B')]));
  await page.getByText('2 paket dibuka.').waitFor();await open();
  assert.ok(await page.locator('#document-requests-title').evaluate(h=>h===document.activeElement));
  await label('Tahun pajak').selectOption('2025');
  const period=await workFile();assert.equal(period.indexDocuments.length,0);assert.equal(period.documentScope,undefined);
  assert.ok(await label('PPh Badan').isDisabled());assert.ok(await label('PPh Badan').isChecked());
  await label('Jenis pemeriksaan pada SP2').selectOption('terfokus');await label('PPh Badan').uncheck();
  await add('Rincian pengangkutan');
  const table=page.getByRole('table',{name:'Daftar permintaan dokumen',exact:true});await table.waitFor();
  await add('  Rincian   pengangkutan');await page.getByRole('alert').filter({hasText:/sudah tercatat sebagai DOK.1/}).waitFor();
  await page.keyboard.press('Escape');
  await button('Ubah DOK.1').click();await label('Status permintaan').selectOption('Diterima sebagian');
  await label('Tanggal diminta').fill('2026-02-12');await label('Tanggal diterima').fill('2026-02-18');
  await label('Catatan dokumen').fill('Sebagian dokumen telah diterima.');await label('Rujukan bukti').fill('Berkas A');
  await button('Simpan perubahan').click();await label('PPh Pasal 15').uncheck();
  assert.ok(await table.getByText('Rincian pengangkutan').isVisible());
  await page.locator('summary').filter({hasText:/Saran dokumen/}).click();
  const suggestion=page.getByRole('checkbox',{name:/Rincian penyerahan dalam negeri dan faktur keluaran/});
  await suggestion.check();await button('Tambahkan saran yang dipilih').click();await button('Ubah DOK.2').click();
  await label('Nama dokumen').fill('Sampel faktur');await label('Indeks atau cakupan SP2').selectOption('SP2/N');await button('Simpan perubahan').click();
  await page.locator('summary').filter({hasText:/Saran dokumen/}).click();
  assert.ok(await suggestion.isDisabled());
  const saved=await workFile();
  assert.equal(saved.indexDocuments[1].origin.index,'PPN/N.3');
  assert.equal(saved.indexDocuments[0].received,'2026-02-18');assert.ok(!saved.documentScope.taxes.includes('F'));
  const xml=decodeText((await readZip(await download('Excel permintaan dokumen'))).get('xl/worksheets/sheet1.xml').data);
  for(const expected of [saved.npwp||'000000000000001','2025','DOK.1','DOK.2','2026-02-12','2026-02-18','Diterima sebagian','Sebagian dokumen telah diterima.','Saran KKP · N.3','Berkas A'])assert.ok(xml.includes(expected),expected);
  await page.evaluate(()=>{window.open=()=>{const d=document.implementation.createHTMLDocument('');return {document:d,focus(){},addEventListener(){},print(){window.__dokPrint=d.body.textContent;}};};});
  await button('Cetak / PDF').click();assert.match(await page.evaluate(()=>window.__dokPrint),/Sampel faktur/);
  await table.getByRole('row').filter({hasText:'Sampel faktur'}).getByRole('button',{name:'Hapus'}).click();
  await button('Batal').click();assert.ok(await button('Ubah DOK.2').isVisible());
  await table.getByRole('row').filter({hasText:'Sampel faktur'}).getByRole('button',{name:'Hapus'}).click();await button('Hapus DOK.2').click();
  await label('PPh Pasal 15').check();await add('Bukti lanjutan');await button('Ubah DOK.3').waitFor();
  const removed=await workFile();assert.deepEqual(removed.removedDocuments,[2]);assert.deepEqual(removed.indexDocuments.map(d=>d.number),[1,3]);
  await label('Jenis pemeriksaan pada SP2').selectOption('lengkap');assert.ok(await label('PPh Badan').isChecked());assert.ok(await label('PPh Badan').isDisabled());
  await label('Tahun pajak').selectOption('2026');assert.equal((await workFile()).indexDocuments.length,0);
  await label('Tahun pajak').selectOption('2025');assert.equal((await workFile()).indexDocuments.length,2);
  const owner=await page.locator('#taxpayer').inputValue(),other=await page.locator('#taxpayer option').evaluateAll(o=>o.map(i=>i.value));
  await page.locator('#taxpayer').selectOption(other.find(id=>id!==owner));await open();assert.equal((await workFile()).indexDocuments.length,0);
  await page.locator('#taxpayer').selectOption(owner);await open();await label('Tahun pajak').selectOption('2025');
  for(const width of [390,320]){
    await page.setViewportSize({width,height:840});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),'Lebar '+width);
  }
  await button('Kembali ke daftar indeks').click();assert.ok(await button('DOK · Permintaan dokumen dan cakupan SP2').evaluate(b=>b===document.activeElement));
  assert.deepEqual(errors,[]);console.log('DOK lulus melalui KKP, delapan cakupan, dua WP dan tahun, saran, revisi dokumen, tanggal, hapus, nomor stabil, Excel dan cetak.');
}finally{await browser?.close();await rm(profile,{recursive:true,force:true});}
