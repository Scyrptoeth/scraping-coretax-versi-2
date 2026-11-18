import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {decodeText,readZip} from '../extension/archive/zip.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const ext=resolve(process.env.EXTENSION_DIR||'extension');
const sample=join(process.env.VERITAX_FIXTURES||'01-VERITAX_v1.32.0','CONTOH-paket-DEMO-FIKTIF.zip');
const profile=await mkdtemp(join(tmpdir(),'temuan-v2-'));
let browser;
try{
  browser=await chromium.launchPersistentContext(profile,{offline:true,headless:true,channel:'chromium',executablePath:process.env.CHROMIUM_PATH||undefined,
    args:['--disable-background-networking','--disable-extensions-except='+ext,'--load-extension='+ext]});
  const sw=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
  const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(12000);
  const button=name=>p.getByRole('button',{name,exact:true}),nav=name=>p.getByRole('navigation').getByRole('button',{name,exact:true});
  const table=name=>p.getByRole('table',{name,exact:true});
  async function open(){
    await p.goto(new URL('analisis/index.html',sw.url()).href);
    await p.locator('#role').selectOption('Pemeriksa');
    await p.locator('#filePkg').setInputFiles(sample);await p.getByText(/Konsisten · Seluruh sidik jari/).waitFor();
    await nav('Kertas Kerja').click();await button('KKP').click();await p.getByLabel('Tahun pajak',{exact:true}).selectOption('2025');
  }
  async function download(label){
    const [file]=await Promise.all([p.waitForEvent('download'),button(label).click()]);
    return readFile(await file.path());
  }
  const ti='TI · Temuan indikatif',tl='TL · Temuan berbukti langsung dan sanksi';
  await open();await button(tl).click();
  const dt=p.getByLabel('Tanggal rencana ketetapan');await dt.fill('2026-11-18');await dt.press('Tab');
  const direct=await readZip(await download('Excel temuan langsung'));
  assert.match(decodeText(direct.get('xl/workbook.xml').data),/name="Temuan Langsung"/);
  assert.match(decodeText(direct.get('xl/worksheets/sheet1.xml').data),/2026-11-18/);
  await button('KKP').click();await button(ti).click();assert.equal(await dt.inputValue(),'2026-11-18');
  await p.getByText('Acuan bunga untuk piutang afiliasi',{exact:true}).click();await button('Gunakan contoh 8%').click();
  const indicative=await readZip(await download('Excel temuan indikatif'));
  const sheet=decodeText(indicative.get('xl/worksheets/sheet1.xml').data);
  for(const value of [554009240,107865599,661874839])assert.ok(sheet.includes('<v>'+value+'</v>'));
  const rows=table('Analisis indikatif').locator('tbody tr');
  assert.equal(await rows.count(),6);
  await nav('Dasbor').click();await button('Semua butir').click();
  await p.locator('#review-vat-facility').selectOption('explained');
  await button('Buka laporan temuan indikatif').click();await table('Analisis indikatif').waitFor();
  assert.equal(await rows.count(),5);assert.equal(await p.locator('#review-vat-facility').inputValue(),'explained');
  assert.equal(await table('Nilai awal kertas kerja').locator('tbody tr').count(),2);
  const saved=await download('Unduh berkas kerja'),work=JSON.parse(saved);
  assert.equal(work.indicationReviews['vat-facility'],'explained');assert.equal(work.indicationLoanRate.percent,8);
  await p.reload();await open();
  const [picker]=await Promise.all([p.waitForEvent('filechooser'),button('Buka berkas kerja').click()]);
  await picker.setFiles({name:'contoh.json',mimeType:'application/json',buffer:saved});
  await p.getByText('Berkas kerja berhasil dimuat.').waitFor();
  await button(ti).click();assert.equal(await dt.inputValue(),'2026-11-18');
  assert.equal(await p.locator('#review-vat-facility').inputValue(),'explained');
  await p.locator('#review-vat-facility').selectOption('retained');await table('Analisis indikatif').waitFor();assert.equal(await rows.count(),6);
  // Route the native print request to Playwright's PDF writer in this headless profile.
  await p.evaluate(()=>{
    const open=window.open.bind(window);
    window.open=(...args)=>{const win=open(...args);win.print=()=>win.document.body.dataset.printRequested='true';return win;};
  });
  const [preview]=await Promise.all([p.waitForEvent('popup'),button('Cetak / PDF').click()]);
  await preview.locator('body[data-print-requested=true]').waitFor();
  await preview.getByRole('heading',{name:'Analisis indikatif'}).waitFor();
  const printed=await browser.newPage();await printed.setContent(await preview.content());
  const pdf=await printed.pdf({format:'A4'});assert.equal(pdf.subarray(0,4).toString(),'%PDF');await printed.close();await preview.close();
  await p.setViewportSize({width:390,height:800});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);console.log('Alur TL/TI, Excel, PDF, telaah di dasbor, dan pemulihan berkas kerja lulus.');
}finally{await browser?.close();await rm(profile,{recursive:true,force:true});}
