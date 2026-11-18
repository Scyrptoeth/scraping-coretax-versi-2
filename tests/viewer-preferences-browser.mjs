import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPackage} from '../extension/archive/package.js';
import {decodeText,readZip} from '../extension/archive/zip.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const ext=path.resolve('extension'),dir=await mkdtemp(path.join(tmpdir(),'v2-preferences-'));
const context=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,offline:true,
  executablePath:process.env.CHROMIUM_PATH||undefined,args:['--disable-extensions-except='+ext,'--load-extension='+ext]});
const a={npwp:'0000000000000021',nama:'PT Alpha / Uji:*?'},b={npwp:'0000000000000022',nama:'PT Beta Uji'};
async function archive(wp){
  const file=await createPackage({meta:{wp},entries:[{path:'spt/PPN/2025-01/p00_fiktif/induk.json',cap:{sumber:'sptisi',lengkap:true},
    pages:[{Payload:{FormData:JSON.stringify({CurrencyCode:'IDR',VATUnderOrOverPaid:{VAT:5}})}}]}]});
  return {name:wp.npwp+'.zip',mimeType:'application/zip',buffer:Buffer.from(await file.arrayBuffer())};
}
try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const p=await context.newPage();p.setDefaultTimeout(7000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(new URL('analisis/index.html',worker.url()).href);
  const dialog=p.getByRole('dialog'),button=name=>p.getByRole('button',{name,exact:true});
  const prefs=()=>button('Tampilan').click(), nav=name=>p.getByRole('navigation').getByRole('button',{name,exact:true}).click();
  const download=async label=>{const [d]=await Promise.all([p.waitForEvent('download'),button(label).click()]);return d;};
  const mode=dialog.getByRole('combobox',{name:'Identitas WP pada nama berkas'});
  const choose=wp=>p.locator('#taxpayer').selectOption({label:wp.nama+' · '+wp.npwp});
  const importFiles=async()=>{await p.locator('#filePkg').setInputFiles(await Promise.all([archive(a),archive(b)]));await p.getByText('2 paket dibuka.').waitFor();};
  await importFiles();await choose(a);await p.locator('#role').selectOption('AR');await nav('Kertas Kerja');
  assert.equal((await download('Excel kertas kerja')).suggestedFilename(),'KKA-2025-'+a.npwp+'.xlsx');
  await prefs();assert.equal(await mode.inputValue(),'npwp');
  await mode.selectOption('npwp-nama');await dialog.getByRole('combobox',{name:'Tema',exact:true}).selectOption('Grafit Zamrud');
  await dialog.getByRole('combobox',{name:'Ukuran',exact:true}).selectOption('Nyaman');await dialog.getByRole('checkbox',{name:'Kontras tinggi'}).check();
  await button('Tutup').click();await p.reload();await prefs();
  assert.equal(await mode.inputValue(),'npwp-nama');assert.ok(await dialog.getByRole('checkbox',{name:'Kontras tinggi'}).isChecked());await button('Tutup').click();
  await nav('Muat paket');await importFiles();await choose(a);await nav('Kertas Kerja');
  const json=await download('Unduh berkas kerja');assert.equal(json.suggestedFilename(),'Berkas-kerja-2025-'+a.npwp+'-PT-Alpha-Uji.json');
  const changed=p.waitForEvent('download');
  await button('Word').evaluate((element,label)=>{
    element.click();
    const picker=document.querySelector('#taxpayer');
    picker.value=[...picker.options].find(o=>o.textContent===label).value;picker.dispatchEvent(new Event('change'));
  },b.nama+' · '+b.npwp);
  const previous=await changed;assert.equal(previous.suggestedFilename(),'KKA-2025-'+a.npwp+'-PT-Alpha-Uji.docx');
  const xml=decodeText((await readZip(await readFile(await previous.path()))).get('word/document.xml').data);
  assert.ok(xml.includes(a.npwp));assert.ok(!xml.includes(b.npwp));
  assert.equal((await download('Excel kertas kerja')).suggestedFilename(),'KKA-2025-'+b.npwp+'-PT-Beta-Uji.xlsx');
  await button('KKP').click();
  assert.equal((await download('Excel semua KKP')).suggestedFilename(),'KKP-Indeks-2025-'+b.npwp+'-PT-Beta-Uji.xlsx');
  await nav('SPT');assert.equal((await download('Excel gabungan')).suggestedFilename(),'RAHASIA-SPT-gabungan-'+b.npwp+'-PT-Beta-Uji.xlsx');
  await nav('Dasbor');await button('Perbandingan antar-WP').click();await p.getByRole('combobox',{name:'Paket WP pembanding'}).selectOption({index:1});
  assert.equal((await download('Excel perbandingan')).suggestedFilename(),'RAHASIA-Perbandingan-WP.xlsx');
  await prefs();await button('Kembali ke bawaan').click();
  assert.equal(await mode.inputValue(),'npwp');assert.equal(await dialog.getByRole('combobox',{name:'Ukuran',exact:true}).inputValue(),'Otomatis');
  assert.equal(await dialog.getByRole('combobox',{name:'Tema',exact:true}).inputValue(),'Terang');
  assert.equal(await dialog.getByRole('checkbox',{name:'Kontras tinggi'}).isChecked(),false);
  assert.ok(await button('Kembali ke bawaan').evaluate(el=>document.activeElement===el));
  await button('Tutup').click();assert.equal(await p.locator('#role').inputValue(),'AR');
  await nav('Kertas Kerja');assert.equal((await download('Unduh berkas kerja')).suggestedFilename(),'Berkas-kerja-2025-'+b.npwp+'.json');
  assert.deepEqual(errors,[]);console.log('PASS: private default, persistence, reset, two taxpayers, concurrent Word export, scoped names and unscoped comparison.');
}finally{await context.close();await rm(dir,{recursive:true,force:true});}
