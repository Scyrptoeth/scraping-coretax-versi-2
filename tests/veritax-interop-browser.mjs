import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readPackage} from '../extension/archive/package.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const studio=process.env.VERITAX_STUDIO;
if(!studio)throw Error('Set VERITAX_STUDIO to the locally supplied VERITAX Studio 1.32.0 HTML file.');
const dir=await mkdtemp(path.join(tmpdir(),'v2-studio-interop-')),extension=path.resolve(process.env.EXTENSION_DIR||'extension');
const wp='0000000000000001',month='01012025',id='DOKUMEN-FIKTIF-016';
const spt={RecordId:id,ReturnSheetTypeCode:'VAT_VATR',TaxPeriodCode:month,ReturnSheetModel:'Normal',
  ReturnSheetStatusCode:'SUBMITTED',BpsNo:'BPE-FIKTIF-016',ReturnDate:'2025-02-15',ExpectedReturnDate:'2025-02-28'};
const fixture=[
  ['bank',[{BankCode:'BANK-FIKTIF',BankAccountNumber:'000000176',Name:'REKENING-INTEROP-UJI'}]],
  ['sptdaftar',[spt]],['sptarsip',[{...spt,RecordId:'ARSIP-FIKTIF-019',TaxPeriodCode:'02022025',BpsNo:'BPE-ARSIP-FIKTIF'}]],
  ['bbsaldo',[{Keterangan:'SALDO-INTEROP-UJI',DebitLeft:17,CreditLeft:0}],'saldo'],
  ['sptisi',{'ID SPT':id,'Masa Pajak':'Januari 2025',Pembetulan:0,'Bagian SPT':'Induk',
    FormData:JSON.stringify({VATUnderOrOverPaid:{VAT:121}})},'induk'],
  ['sptisi',[{'ID SPT':id,'Masa Pajak':'Januari 2025',Pembetulan:0,'Bagian SPT':'A2',
    DocumentNumber:'LAMPIRAN-INTEROP-UJI',Name:'Rekan fiktif',TaxBase:1100,VAT:121}]],
];
const contexts=[];
try{
  const capture=await chromium.launchPersistentContext(path.join(dir,'profile'),{
    channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,
    args:['--load-extension='+extension,'--disable-extensions-except='+extension],offline:true,acceptDownloads:true});
  contexts.push(capture);
  const worker=capture.serviceWorkers()[0] || await capture.waitForEvent('serviceworker');
  const page=await capture.newPage();
  await page.goto(worker.url().replace(/[^/]+$/,'app.html'));await page.locator('#officer').fill('Penguji Fiktif');
  await page.locator('#ids').fill(wp);await page.locator('#year-start').selectOption('2025');await page.locator('#year-end').selectOption('2025');
  await page.locator('#month-start').selectOption('01');await page.locator('#month-end').selectOption('12');
  for(const [source] of fixture)await page.locator('#sources input[value="'+source+'"]').check();
  for(const [i,[source,rows,native]] of fixture.entries()){
    await page.locator('#source').selectOption(source);if(source==='sptisi')await page.locator('#spt').selectOption('VAT_VATR');
    await page.locator('#scope-ok').check();
    await page.locator('#source-files').setInputFiles({name:source+'-'+i+'.json',mimeType:'application/json',
      buffer:Buffer.from(JSON.stringify({IsSuccessful:true,Payload:native?rows:{Data:rows,TotalRecords:rows.length}}))});
    await page.locator('#queue .item').nth(i).waitFor();
  }
  await page.locator('#consent').check();await page.locator('#start').click();
  await page.locator('#results').getByRole('button',{name:'Unduh paket'}).click();
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#package-dialog button[value=ok]').click()]);
  const output=path.join(dir,'contoh.zip');await download.saveAs(output);
  const archive=await readPackage(await readFile(output));assert.equal(archive.report.valid,true);
  assert.equal(archive.report.checked,fixture.length);assert.equal(archive.manifest.wp.npwp,wp);

  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined});
  contexts.push(browser);
  const offline=await browser.newContext({offline:true,serviceWorkers:'block'});
  const reference=await offline.newPage();await reference.goto(pathToFileURL(path.resolve(studio)).href);
  const welcome=reference.getByRole('dialog').getByRole('button',{name:'Mulai',exact:true});
  if(await welcome.isVisible())await welcome.click();
  await reference.locator('#filePkg').setInputFiles(output);
  await reference.waitForFunction(()=>Boolean(document.querySelector('#wpSel')?.value));
  assert.equal((await reference.locator('#wpSel option:checked').innerText()).replace(/\D/g,''),wp);
  const integrity=await reference.locator('#pkgList').innerText();
  assert.match(integrity,/Konsisten: 6 file dihitung ulang SHA-256/);assert.ok(integrity.includes(archive.report.manifestHash));
  await reference.locator('#tabs [data-tab=tabel]').click();await reference.locator('#v-tabel').waitFor();
  const raw=reference.locator('#v-tabel');
  await raw.getByRole('button',{name:/^PPN · A2/}).click();
  await raw.getByRole('cell',{name:'LAMPIRAN-INTEROP-UJI',exact:true}).waitFor();
  await raw.getByRole('button',{name:/^Rekening bank/}).click();
  await raw.getByRole('cell',{name:'000000176',exact:true}).waitFor();
  await raw.getByRole('cell',{name:'REKENING-INTEROP-UJI',exact:true}).waitFor();
  await raw.getByRole('button',{name:/^Buku besar: saldo seluruh periode/}).click();
  await raw.getByRole('cell',{name:'SALDO-INTEROP-UJI',exact:true}).waitFor();
  await raw.getByRole('button',{name:/^Daftar SPT dilaporkan.*2 baris/}).click();
  await raw.getByRole('cell',{name:'BPE-ARSIP-FIKTIF',exact:true}).waitFor();
  await reference.locator('#tabs [data-tab=spt]').click();
  const returnRow=reference.locator('#v-spt table tbody tr').filter({hasText:'BPE-FIKTIF-016'});
  for(const label of ['Jan 2025','Normal','Kurang bayar','121','15-02-2025'])
    await returnRow.getByRole('cell',{name:label,exact:true}).waitFor();
  console.log('PASS: V2 capture exported six synthetic data files. Offline VERITAX Studio verified hashes, taxpayer, bank, balance, archived list, SPT with value, and appendix A2.');
}finally{
  for(const c of contexts.reverse())await c.close();
  await rm(dir,{recursive:true,force:true});
}
