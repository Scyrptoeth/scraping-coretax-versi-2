import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createPackage} from '../extension/archive/package.js';
import {decodeText,readZip} from '../extension/archive/zip.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const profile=await mkdtemp(join(tmpdir(),'coretax-team-test-')),extension=resolve('extension');
let browser;
try{
  browser=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,
    args:['--disable-extensions-except='+extension,'--load-extension='+extension],acceptDownloads:true});
  const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
  const page=await browser.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(6000);
  await page.goto(worker.url().slice(0,worker.url().lastIndexOf('/'))+'/analisis/index.html');
  const pkg=await createPackage({meta:{wp:{npwp:'0000000000000001',nama:'Uji tim fiktif'},opsi:{periode:{from:{y:2025},to:{y:2025}}}},entries:[
    {path:'spt/PPN/2025-01/p00_fiktif/induk.json',cap:{lengkap:true},pages:[{Payload:{Data:[{VATUnderOrOverPaid:{VAT:0}}]}}]}]});
  await page.locator('#filePkg').setInputFiles({name:'Tim-fiktif.zip',mimeType:'application/zip',buffer:Buffer.from(await pkg.arrayBuffer())});
  await page.getByText('Konsisten · Seluruh sidik jari yang diperiksa cocok.').waitFor();
  await page.getByRole('navigation').getByRole('button',{name:'Kertas Kerja',exact:true}).click();
  await page.getByRole('button',{name:'Tambah butir',exact:true}).click();
  const modal=page.getByRole('dialog');
  await modal.getByLabel('Butir pengujian').fill('Pengujian A');
  await modal.getByLabel('Fakta yang ditemukan').fill('Pengujian awal');
  await modal.getByRole('combobox',{name:'Status',exact:true}).selectOption('Sedang diuji');
  await modal.getByRole('button',{name:'Simpan butir'}).click();
  const download=async name=>{
    const [d]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name,exact:true}).click()]);
    return readFile(await d.path());
  };
  const save=async()=>JSON.parse(await download('Unduh berkas kerja'));
  const importWork=json=>page.locator('input[type=file][accept=".json"]').setInputFiles({name:'Tim-kerja.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(json))});
  const original=await save(),id=original.rows[0].teamId,key=JSON.stringify(['rows',id]);
  assert.match(id,/^manual\//);const clock=Date.parse(original.editTimes[key]);assert.ok(Number.isFinite(clock));
  const incoming=structuredClone(original);
  incoming.rows[0].fakta='Hasil kedua';incoming.editTimes[key]=new Date(clock+1000).toISOString();
  const secondId='manual/00000000-0000-4000-8000-000000000099';
  incoming.rows.push({...incoming.rows[0],teamId:secondId,topik:'Pengujian B',fakta:'Hasil lain'});
  await importWork(incoming);
  await modal.getByText('1 isian baru, 1 versi berkas lebih baru, 0 versi lokal lebih baru, 0 sama dan 0 perlu dipilih.').waitFor();
  await modal.getByRole('button',{name:'Gabungkan isian'}).click();
  let after=await save();assert.equal(after.rows.length,2);assert.equal(after.rows[0].fakta,'Hasil kedua');
  const legacy=structuredClone(original);delete legacy.rows[0].teamId;delete legacy.editTimes;
  legacy.rows[0].fakta='Isian berkas lama';
  await importWork(legacy);await modal.getByText('Salah satu atau kedua versi belum memiliki waktu perubahan.').waitFor();
  const merge=modal.getByRole('button',{name:'Gabungkan isian'});assert.ok(await merge.isDisabled());
  await modal.getByRole('combobox',{name:'Versi untuk Butir pengujian · Pengujian A'}).selectOption('berkas');await merge.click();
  after=await save();assert.equal(after.rows.length,2);assert.equal(after.rows[0].fakta,'Isian berkas lama');
  assert.equal(after.rows[0].teamId,id);assert.equal(after.editTimes[key],undefined);
  const workbook=await readZip(await download('Excel laporan progres'));
  assert.match(decodeText(workbook.get('xl/workbook.xml').data),/Status butir paket/);
  const sheet=decodeText(workbook.get('xl/worksheets/sheet3.xml').data);assert.match(sheet,/Pengujian A/);assert.match(sheet,/Pengujian B/);
  await importWork(original);await modal.getByRole('button',{name:'Ganti isi sesi ini'}).click();
  after=await save();assert.equal(after.rows.length,1);assert.equal(after.rows[0].fakta,'Pengujian awal');
  assert.deepEqual(errors,[]);
  console.log('PASS: real local MV3 extension merged independent and newer work, required a legacy conflict choice, kept stamps and identity, exported progress and restored the original.');
}finally{
  if(browser)await browser.close();
  await rm(profile,{recursive:true,force:true});
}
