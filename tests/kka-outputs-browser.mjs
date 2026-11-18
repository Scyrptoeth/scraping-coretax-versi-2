import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {readZip,decodeText} from '../extension/archive/zip.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const extension=resolve(process.env.EXTENSION_DIR||'extension');
const fixture=join(process.env.VERITAX_FIXTURES||'01-VERITAX_v1.32.0','CONTOH-paket-DEMO-FIKTIF.zip');
const profile=await mkdtemp(join(tmpdir(),'kka-outputs-'));
let browser;
try{
  browser=await chromium.launchPersistentContext(profile,{headless:true,offline:true,channel:'chromium',executablePath:process.env.CHROMIUM_PATH||undefined,
    args:['--disable-background-networking','--disable-extensions-except='+extension,'--load-extension='+extension]});
  const sw=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker'),p=await browser.newPage(),errors=[];
  p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(e.message));
  const btn=name=>p.getByRole('button',{name,exact:true});
  const download=async(label)=>{
    const [handle]=await Promise.all([p.waitForEvent('download'),btn(label).click()]);
    return {file:handle.suggestedFilename(),bytes:await readFile(await handle.path())};
  };
  async function exportFile(label){
    const {file,bytes}=await download(label);return {file,zip:await readZip(bytes)};
  }
  const nav=name=>p.getByRole('navigation').getByRole('button',{name,exact:true});
  async function openKka(){
    await p.goto(new URL('analisis/index.html',sw.url()).href);await p.locator('#role').selectOption('AR');
    await p.locator('#filePkg').setInputFiles(fixture);await p.getByText(/Konsisten · Seluruh sidik jari/).waitFor();
    await nav('Kertas Kerja').click();await btn('KKA').click();
    await p.getByLabel('Tahun pajak',{exact:true}).selectOption('2025');
  }
  await openKka();
  const panel=p.locator('.card').filter({has:p.getByRole('heading',{name:'Dasar angka KKA · L-13',exact:true})});
  for(const key of ['4.1','4.2','5.3']){
    const toggle=panel.locator('summary').filter({hasText:'Tabel '+key});await toggle.click();
    const table=panel.getByRole('table',{name:new RegExp('Tabel '+key.replace('.','\\.')+'\\.')});
    await table.waitFor();assert.ok(await table.locator('tbody tr').count()>1);
  }
  const xlsx=await exportFile('Excel kertas kerja'),docx=await exportFile('Word');
  const main=decodeText(docx.zip.get('word/document.xml').data),rels=decodeText(docx.zip.get('word/_rels/document.xml.rels').data);
  const workbook=decodeText(xlsx.zip.get('xl/workbook.xml').data);
  const worksheets=[...xlsx.zip].filter(([n])=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n)).map(([,e])=>decodeText(e.data));
  for(const anchor of ['KKA_L13_4_1','KKA_L13_4_2','KKA_L13_5_3','KKA_L7_5','KKA_L7_5_1']){
    assert.ok(rels.includes(encodeURIComponent(xlsx.file)+'#'+anchor));
    assert.ok(workbook.includes('name="'+anchor+'"'));
  }
  assert.equal((main.match(/<w:hyperlink /g)||[]).length,5);
  assert.equal(worksheets.filter(xml=>xml.includes('Buka rincian L-13')).length,3);
  assert.equal(worksheets.filter(xml=>xml.includes('Buka rincian L-7')).length,2);
  assert.ok(worksheets.some(xml=>xml.includes('IF(ISNUMBER(')&&xml.includes('L-13')));
  await p.setViewportSize({width:390,height:820});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await p.setViewportSize({width:1280,height:820});
  const scope=p.getByLabel('Temuan yang dimasukkan',{exact:true});
  const number=text=>Number(text.replaceAll('.',''));
  async function denominator(){
    const details=panel.locator('details').filter({has:p.locator('summary').filter({hasText:'Tabel 5.3'})});
    if(await details.getAttribute('open')===null)await details.locator('summary').click();
    return number(await details.getByRole('row').filter({hasText:'Potensi pokok pajak'}).locator('td').nth(1).innerText());
  }
  const audit=p.getByRole('table',{name:'Daftar temuan',exact:true});
  const item=label=>audit.getByRole('row').filter({hasText:label});
  const fac='Fasilitas PPN pada faktur kode 07 atau 08';
  const baseline=await denominator();assert.equal(baseline,5354535550);
  await scope.selectOption('verified');assert.equal(await denominator(),63045480);
  await scope.selectOption('all');
  const amountColumn=(await audit.locator('thead th').allTextContents()).indexOf('Potensi pokok (Rp)');
  assert.ok(amountColumn>=0);const facilityAmount=number(await item(fac).locator('td').nth(amountColumn).innerText());
  assert.ok(facilityAmount>0);
  await item(fac).getByRole('button',{name:'Buka',exact:true}).click();
  await p.getByLabel('Hasil penelaahan',{exact:true}).selectOption('Terjelaskan');
  assert.equal(await item(fac).count(),0);assert.equal(await denominator(),baseline-facilityAmount);
  const saved=(await download('Unduh berkas kerja')).bytes;
  assert.equal(JSON.parse(saved).indicationReviews['vat-facility'],'explained');
  await p.reload();await openKka();
  const [picker]=await Promise.all([p.waitForEvent('filechooser'),btn('Buka berkas kerja').click()]);
  await picker.setFiles({name:'uji.json',mimeType:'application/json',buffer:saved});
  await p.getByText('Berkas kerja berhasil dimuat.').waitFor();
  assert.equal(await denominator(),baseline-facilityAmount);
  await btn('KKP').click();await btn('TI · Temuan indikatif').click();
  const review=p.locator('#review-vat-facility');assert.equal(await review.inputValue(),'explained');
  await review.selectOption('retained');await btn('KKA').click();assert.equal(await denominator(),baseline);
  for(const [label,value] of [['Uji pokok nol','0'],['Uji pokok kosong','']]){
    await btn('Tambah butir').click();await p.getByLabel('Butir pengujian',{exact:true}).fill(label);
    await p.getByLabel('Klasifikasi butir').selectOption('indicative');
    await p.getByLabel('Potensi pokok berdasarkan pengujian (Rp)',{exact:true}).fill(value);await btn('Simpan butir').click();
    await p.getByRole('searchbox',{name:'Cari di tabel Daftar temuan'}).fill(label);
    assert.equal(await item(label).locator('td').nth(amountColumn).innerText(),value||'—');
  }
  assert.equal(await denominator(),baseline);
  assert.deepEqual(errors,[]);console.log('KKA AR: lima tautan Word dan Excel L-7/L-13, lingkup, penelaahan TI/KKA, pemulihan sesi, pokok nol dan nominal kosong lulus.');
}finally{await browser?.close();await rm(profile,{recursive:true,force:true});}
