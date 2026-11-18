import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createPackage} from '../extension/archive/package.js';
import {decodeText,readZip} from '../extension/archive/zip.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const profile=await mkdtemp(join(tmpdir(),'coretax-jadwal-'));
const extension=resolve(process.env.EXTENSION_DIR||'extension');
const officerRoles=['Pemeriksa','AR','Penelaah'];
async function fixture(owner,label){
  const entries=['2025','2026'].map(y=>({path:'spt/PPN/'+y+'-01/p00_demo/induk.json',
    pages:[{Payload:{FormData:JSON.stringify({TotalDeliveryOfGoodsAndServices:{SellingPrice:120}})}}],
    cap:{lengkap:true,konteks:{npwp:owner}}}));
  const zip=await createPackage({meta:{wp:{npwp:owner,nama:label}},entries});
  return {name:label+'.zip',mimeType:'application/zip',buffer:Buffer.from(await zip.arrayBuffer())};
}
let browser;
try{
  browser=await chromium.launchPersistentContext(profile,{offline:true,channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,
    args:['--disable-background-networking','--disable-extensions-except='+extension,'--load-extension='+extension],acceptDownloads:true});
  const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
  const page=await browser.newPage();page.setDefaultTimeout(6000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-02-10T05:00:00Z'));
  await page.goto(new URL('analisis/index.html',worker.url()).href);
  const files=await Promise.all([fixture('0000000000000017','Badan Uji A'),fixture('0000000000000018','Badan Uji B')]);
  await page.locator('#filePkg').setInputFiles(files);
  await page.getByText('2 paket dibuka.').waitFor();
  const workTab=page.getByRole('navigation').getByRole('button',{name:'Kertas Kerja',exact:true});
  const button=name=>page.getByRole('button',{name,exact:true});
  const open=async()=>{
    await workTab.click();await button('KKP').click();await button('JD · Jadwal pemeriksaan').click();
    await page.getByRole('heading',{name:'Jadwal pemeriksaan',exact:true}).waitFor();
  };
  const download=async name=>{
    const [file]=await Promise.all([page.waitForEvent('download'),button(name).click()]);
    return readFile(await file.path());
  };
  const exportWork=async()=>JSON.parse(await download('Unduh berkas kerja'));
  await open();assert.equal(await page.locator('#inspection-schedule-title').evaluate(el=>el===document.activeElement),true);
  await page.getByLabel('Tahun pajak',{exact:true}).selectOption('2025');
  const before=await exportWork();assert.ok(!before.auditLog?.some(e=>e.key==='["schedule","jadwal"]'));
  const scheduleDate=page.getByLabel('Tanggal penyampaian SPP',{exact:true});
  await scheduleDate.fill('2025-02-13');
  await page.getByText(/mengikuti ketentuan peralihan Pasal 30/).waitFor();
  assert.equal(await page.getByRole('cell',{name:'Batas pengujian dan penyampaian SPHP',exact:true}).count(),0);
  await scheduleDate.fill('2026-01-30');await button('Simpan jadwal').click();
  await page.getByRole('table',{name:'Jadwal pemeriksaan'}).waitFor();
  const originalSize=page.viewportSize();
  for(const width of [390,320]){
    await page.setViewportSize({width,height:840});
    const selector=await page.getByLabel('Dasar perpanjangan',{exact:true}).boundingBox();
    assert.ok(selector.x>=0 && selector.x+selector.width<=width+1);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
  }
  await page.setViewportSize(originalSize);
  const saved=await exportWork();assert.ok(saved.auditLog?.some(e=>e.key==='["schedule","jadwal"]'));
  assert.ok(Object.values(saved.schedule).includes('2026-01-30'));
  const examType=page.getByLabel('Jenis pemeriksaan',{exact:true}),extensionInput=page.getByLabel('Lama perpanjangan (bulan, 0–4)');
  await extensionInput.fill('5');assert.ok(await button('Simpan jadwal').isDisabled());assert.ok(await button('Excel jadwal').isDisabled());
  await extensionInput.fill('0');await examType.selectOption('konkret');
  await page.getByLabel('Tanggal penyampaian SPHP').fill('2026-02-13');
  await page.getByLabel('Tanggal SPHP diterima Wajib Pajak').fill('2026-02-18');
  await page.getByLabel('Tanggal risalah pembahasan ditandatangani WP dan pemeriksa').fill('2026-02-20');
  const holidays=page.getByLabel('Hari libur dan cuti bersama (satu tanggal YYYY-MM-DD per baris)');
  await holidays.fill('2026-02-16\n2026-02-17');
  const qa=page.getByLabel(/Semua syarat permohonan pembahasan/);await qa.check();
  const times=await page.getByRole('table',{name:'Jadwal pemeriksaan'}).locator('time').evaluateAll(t=>t.map(x=>x.dateTime));
  assert.ok(times.includes('2026-02-25'));assert.ok(times.includes('2026-03-03'));
  assert.equal((await exportWork()).schedule.type,saved.schedule.type);
  await page.getByLabel('Tahun pajak',{exact:true}).selectOption('2026');assert.equal(await scheduleDate.inputValue(),'');
  const legacy=await exportWork();delete legacy.schedule;
  await page.locator('#screen input[type=file][accept=".json"]').setInputFiles({name:'Berkas-lama.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});
  await page.getByText('Berkas kerja berhasil dimuat.').waitFor();assert.equal(await scheduleDate.inputValue(),'');
  await page.getByLabel('Tahun pajak',{exact:true}).selectOption('2025');assert.equal(await scheduleDate.inputValue(),'2026-01-30');
  const owners=await page.locator('#taxpayer option').evaluateAll(o=>o.map(i=>i.value)),active=await page.locator('#taxpayer').inputValue();
  await page.locator('#taxpayer').selectOption(owners.find(s=>s!==active));await open();await page.getByLabel('Tahun pajak',{exact:true}).selectOption('2025');
  assert.equal(await scheduleDate.inputValue(),'');
  await page.locator('#taxpayer').selectOption(active);await open();await page.getByLabel('Tahun pajak',{exact:true}).selectOption('2025');
  assert.equal(await scheduleDate.inputValue(),'2026-01-30');
  for(const role of officerRoles){
    await page.locator('#role').selectOption(role);await open();assert.ok(await scheduleDate.isEditable());
  }
  await scheduleDate.fill('2026-02-04');
  const workbook=await readZip(await download('Excel jadwal'));
  const xml=decodeText(workbook.get('xl/worksheets/sheet1.xml').data);
  assert.ok(xml.includes('2026-02-04'));assert.match(xml,/Tahun pajak berkas kerja 2025/);assert.match(xml,/jdih\.kemenkeu\.go\.id/);
  assert.doesNotMatch(xml,/<f>/);
  const unsaved=await exportWork();assert.deepEqual(unsaved.schedule,saved.schedule);
  await page.evaluate(()=>{window.open=()=>{const d=document.implementation.createHTMLDocument('');
    return {document:d,opener:null,focus(){},addEventListener(){},print(){window.__jdPrint=d.body.textContent;}};};});
  await button('Cetak / PDF').click();assert.match(await page.evaluate(()=>window.__jdPrint),/Jadwal pemeriksaan/i);
  await button('Kembali ke daftar indeks').click();assert.ok(await button('JD · Jadwal pemeriksaan').evaluate(b=>b===document.activeElement));
  assert.deepEqual(errors,[]);console.log('JD lulus melalui KKP, penyimpanan WP/tahun, audit, tiga peran, pratinjau, Excel dan cetak.');
}finally{await browser?.close();await rm(profile,{recursive:true,force:true});}
