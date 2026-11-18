import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createPackage} from '../extension/archive/package.js';
import {decodeText,readZip} from '../extension/archive/zip.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const ext=resolve(process.env.EXTENSION_DIR||'extension'),profile=await mkdtemp(join(tmpdir(),'v2-simulasi-'));
let browser;
try{
  browser=await chromium.launchPersistentContext(profile,{offline:true,headless:true,channel:'chromium',
    executablePath:process.env.CHROMIUM_PATH||undefined,args:['--disable-extensions-except='+ext,'--load-extension='+ext]});
  const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker'),p=await browser.newPage();
  const errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(8000);
  await p.goto(new URL('analisis/index.html',worker.url()).href);
  const wp={npwp:'0000000000000017',nama:'Contoh simulasi'};
  const entries=[['01',7000,10000,0,-3000],['02',13000,9000,3000,1000]].map(([m,pk,pm,carry,net])=>({
    path:'spt/PPN/2025-'+m+'/p00_sample-'+m+'/induk.json',cap:{lengkap:true,konteks:{npwp:wp.npwp}},pages:[{Payload:{FormData:JSON.stringify({
      OutputTaxMustBeSelfCollected:{VAT:pk},InputTaxCanBeCalculated:{VAT:pm+carry},CarryForwardOfInputTax:{VAT:carry},
      VATUnderOrOverPaid:{VAT:net},VATIsDepositedInAdvance:{VAT:0}})}}]}));
  const zip=await createPackage({meta:{wp},entries});
  await p.locator('#filePkg').setInputFiles({name:'contoh.zip',mimeType:'application/zip',buffer:Buffer.from(await zip.arrayBuffer())});
  await p.getByText('Konsisten · Seluruh sidik jari yang diperiksa cocok.').waitFor();
  const button=name=>p.getByRole('button',{name,exact:true}),menu=button('SIM · Simulasi ketetapan');
  await p.getByRole('navigation').getByRole('button',{name:'Kertas Kerja',exact:true}).click();
  await button('KKP').click();await p.getByLabel('Pilih indeks KKP').selectOption('PPN/N.3.1');
  await p.getByRole('row').filter({has:p.getByRole('cell',{name:'2025-01',exact:true})}).getByRole('button',{name:'Buka'}).click();
  const dialog=p.getByRole('dialog');
  await dialog.getByLabel('Nilai setelah pengujian').fill('9000');await dialog.getByLabel('Dokumen atau rujukan bukti').fill('UJI-PPN');
  await dialog.getByLabel('Nama penguji').fill('Penguji fiktif');await dialog.getByLabel('Penjelasan hasil uji').fill('Selisih contoh Januari');
  await dialog.getByRole('button',{name:'Simpan hasil uji'}).click();await menu.click();
  const title=p.getByRole('heading',{name:'Simulasi ketetapan',exact:true});
  assert.ok(await title.evaluate(h=>h===document.activeElement));
  await p.getByLabel('Tanggal rencana ketetapan').fill('2025-04-01');await p.getByLabel('Tanggal rencana ketetapan').press('Tab');
  const sum=p.getByRole('table',{name:'Ringkasan simulasi ketetapan'});
  await sum.getByRole('cell',{name:'3.500',exact:true}).waitFor();
  const [file]=await Promise.all([p.waitForEvent('download'),button('Excel simulasi').click()]);
  const book=await readZip(await readFile(await file.path()));
  assert.match(decodeText(book.get('xl/workbook.xml').data),/name="Kaskade PPN"/);
  assert.match(decodeText(book.get('xl/worksheets/sheet1.xml').data),/<v>3500<\/v>/);
  assert.match(decodeText(book.get('xl/worksheets/sheet2.xml').data),/UJI-PPN/);
  await button('Buka simulasi sanksi manual').click();await p.getByRole('heading',{name:'Simulasi SKPKB'}).waitFor();
  assert.equal(await p.getByLabel('Tanggal rencana ketetapan').inputValue(),'2025-04-01');
  await button('KKP').click();await menu.click();
  await p.setViewportSize({width:375,height:780});
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);
  console.log('SIM lulus dari pengujian Januari sampai dampak Februari, Excel dan simulasi manual.');
}finally{await browser?.close();await rm(profile,{recursive:true,force:true});}
