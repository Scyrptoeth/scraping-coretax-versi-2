import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createPackage} from '../extension/archive/package.js';
import {decodeText,readZip} from '../extension/archive/zip.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const extension=resolve(process.env.EXTENSION_DIR||'extension');
const profile=await mkdtemp(join(tmpdir(),'coretax-ts-'));
const nativeDemo=process.env.VERITAX_FIXTURES;
const reference=nativeDemo?318790109:500;
let browser;
try{
  browser=await chromium.launchPersistentContext(profile,{offline:true,headless:true,channel:'chromium',acceptDownloads:true,
    executablePath:process.env.CHROMIUM_PATH||undefined,
    args:['--disable-background-networking','--disable-extensions-except='+extension,'--load-extension='+extension]});
  const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker'),p=await browser.newPage();
  p.setDefaultTimeout(6500);const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(new URL('analisis/index.html',worker.url()).href);
  if(nativeDemo)await p.locator('#filePkg').setInputFiles(resolve(nativeDemo,'CONTOH-paket-DEMO-FIKTIF.zip'));
  else{
    const owner='0000000000000010',entries=Array.from({length:12},(_,i)=>({
      path:'spt/PPN/2025-'+String(i+1).padStart(2,'0')+'/p00_fiktif/induk.json',
      pages:[{Payload:{FormData:JSON.stringify({OutputTaxMustBeSelfCollected:{VAT:reference}})}}],
      cap:{lengkap:true,konteks:{npwp:owner}}}));
    const zip=await createPackage({meta:{wp:{npwp:owner,nama:'WP Fiktif TS'}},entries});
    await p.locator('#filePkg').setInputFiles({name:'contoh-ts.zip',mimeType:'application/zip',buffer:Buffer.from(await zip.arrayBuffer())});
  }
  await p.getByText('Konsisten · Seluruh sidik jari yang diperiksa cocok.').waitFor();
  const btn=name=>p.getByRole('button',{name,exact:true});
  const download=async(name,evidence)=>{
    const [file]=await Promise.all([p.waitForEvent('download'),btn(name).click()]);
    const bytes=await readFile(await file.path());
    if(evidence&&process.env.TS_QA_OUTPUT)await writeFile(join(process.env.TS_QA_OUTPUT,evidence),bytes,{mode:0o600});
    return readZip(bytes);
  };
  const menu=btn('TS · Daftar temuan sementara');
  await p.getByRole('navigation').getByRole('button',{name:'Kertas Kerja',exact:true}).click();
  await btn('KKP').click();await p.getByLabel('Tahun pajak',{exact:true}).selectOption('2025');await menu.click();
  const heading=p.getByRole('heading',{name:'Daftar temuan sementara',exact:true});
  await heading.waitFor();assert.ok(await heading.evaluate(el=>el===document.activeElement));
  const indicator=p.getByRole('heading',{name:'Temuan indikatif',exact:true}),scope=p.getByLabel('Temuan yang dimasukkan',{exact:true});
  assert.equal(await indicator.count(),0);await scope.selectOption('all');await indicator.waitFor();await scope.selectOption('verified');
  const first=p.getByRole('table',{name:'Perbandingan angka dan hasil uji indeks',exact:true});
  if(nativeDemo)assert.equal(await first.getByRole('row').count(),5);
  if(process.env.TS_QA_OUTPUT)await download('Excel daftar temuan sementara','v2-awal.xlsx');
  const back=btn('Kembali ke daftar indeks');
  await back.click();await p.getByLabel('Pilih indeks KKP').selectOption('PPN/N.3.1');
  const jan=p.getByRole('table',{name:'Pengujian per indeks'}).getByRole('row').filter({has:p.getByRole('cell',{name:'2025-01',exact:true})});
  await jan.getByRole('button',{name:'Buka'}).click();
  const dialog=p.getByRole('dialog');
  await dialog.getByLabel('Dokumen atau rujukan bukti').fill('BUKTI-FIKTIF-TS');
  await dialog.getByLabel('Nilai setelah pengujian').fill(String(reference+12345));
  await dialog.getByLabel('Nama penguji').fill('Tim Fiktif');
  await dialog.getByLabel('Penjelasan hasil uji').fill('Hasil pencocokan fiktif.');
  await dialog.getByLabel('Klasifikasi hasil yang berbeda').selectOption('verified');
  await dialog.getByRole('button',{name:'Simpan hasil uji'}).click();await menu.click();
  const row=first.getByRole('row').filter({has:p.getByRole('cell',{name:'N.3.1',exact:true})});
  await heading.waitFor();await row.waitFor();
  assert.equal(await row.count(),1);assert.ok(await row.getByRole('cell',{name:'12.345',exact:true}).isVisible());
  const file=await download('Excel daftar temuan sementara','v2-setelah-uji.xlsx');
  const xml=decodeText(file.get('xl/worksheets/sheet1.xml').data);
  assert.match(xml,/<v>12345<\/v>/);assert.match(xml,/BUKTI-FIKTIF-TS/);
  if(nativeDemo){assert.match(xml,/5\.990\.065\.213/);assert.match(xml,/5\.990\.077\.558/);assert.match(xml,/<v>3617538972<\/v>/);}
  await p.evaluate(()=>{window.open=()=>{const d=document.implementation.createHTMLDocument();
    return {document:d,focus(){},addEventListener(){},print(){window.__tsPrint=d.body.textContent;}};};});
  await btn('Cetak / PDF').click();assert.match(await p.evaluate(()=>window.__tsPrint),/BUKTI-FIKTIF-TS/);
  await back.click();const book=await download('Excel semua KKP');
  const metadata=decodeText(book.get('xl/workbook.xml').data);
  assert.match(metadata,/name="Temuan Sementara"/);assert.match(metadata,/name="Daftar TS"/);
  assert.deepEqual(errors,[]);console.log('TS lulus melalui KKP, lingkup, pengujian Januari, Excel khusus dan lengkap, serta cetak.');
}finally{await browser?.close();await rm(profile,{recursive:true,force:true});}
