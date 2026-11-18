import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const ext=resolve(process.env.EXTENSION_DIR||fileURLToPath(new URL('../extension/',import.meta.url)));
const dir=await mkdtemp(join(tmpdir(),'preview-wp-'));
let ctx;
try{
  ctx=await chromium.launchPersistentContext(dir,{executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,channel:'chromium',offline:true,
    args:['--disable-background-networking','--disable-extensions-except='+ext,'--load-extension='+ext]});
  const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker'),p=await ctx.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(10000);
  await p.goto(new URL('app.html',worker.url()).href);
  const wp='0000000000000016';await p.locator('#ids').fill(wp);await p.locator('#officer').fill('Penguji Fiktif');
  await p.locator('#year-start').selectOption('2024');await p.locator('#month-start').selectOption('01');
  await p.locator('#year-end').selectOption('2025');await p.locator('#month-end').selectOption('12');
  const choice=(id,value)=>p.locator('#'+id+' input[value="'+value+'"]');
  for(const input of await p.locator('#sources input').all())await input.setChecked(['info','sptdaftar'].includes(await input.inputValue()));
  for(const input of await p.locator('#forms input').all())await input.setChecked(['VAT_VATR','ICT_RCITR'].includes(await input.inputValue()));
  await p.locator('#consent').check();
  const summary=p.getByRole('table',{name:'Pratinjau penarikan',exact:true}),versions=p.getByRole('table',{name:'Rincian SPT dilaporkan per tahun dan jenis'});
  const cells=()=>summary.locator('tbody tr > *').allTextContents();
  await p.locator('#preview').click();await summary.waitFor();
  assert.equal((await cells())[5],'Belum diketahui');
  async function add(source,records,expected){
    await p.locator('#source').selectOption(source);await p.locator('#scope-ok').check();
    await p.locator('#source-files').setInputFiles({name:source+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({Payload:{Data:records,TotalRecords:records.length}}))});
    await p.locator('#queue .item').nth(expected-1).waitFor();
  }
  await add('info',[{GeneralInformation:{UniqueIdentificationNumber:wp,Name:'Contoh Pratinjau',TaxpayerType:'TA002',TaxpayerStatus:'ACTIVE'},MainEconomicCode:{TradeClassificationCode:'01234'}}],1);
  const annual={ReturnSheetTypeCode:'ICT_RCITR',TaxPeriodCode:'01122024',ReturnSheetModel:'Normal',RecordId:'badan-1'};
  const normal={ReturnSheetTypeCode:'VAT_VATR',TaxPeriodCode:'01012025',ReturnSheetModel:'Normal',RecordId:'ppn-n'};
  await add('sptdaftar',[annual,normal,{...normal,ReturnSheetModel:'Amendment 1',RecordId:'ppn-a'},{...normal}],2);
  await p.locator('#preview').click();await versions.waitFor();
  assert.deepEqual((await cells()).slice(0,6),[wp,'Contoh Pratinjau','Badan','Aktif','01234','3']);
  assert.deepEqual(await versions.locator('tbody tr').allTextContents(),['2025Masa PPN112','2024Tahunan PPh Badan101']);
  await p.setViewportSize({width:390,height:820});
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await versions.locator('..').focus();assert.equal(await versions.locator('..').evaluate(e=>e===document.activeElement),true);
  await choice('sources','info').uncheck();await choice('forms','ICT_RCITR').uncheck();await p.locator('#preview').click();await versions.waitFor();
  const filtered=await cells();
  assert.deepEqual(filtered.slice(1,6),['Contoh Pratinjau','Badan','Aktif','01234','2']);assert.equal(filtered.at(-2),'1');
  assert.equal(await versions.locator('tbody tr').count(),1);
  await p.locator('#preview-box').getByText('Rincian sumber terpilih',{exact:true}).click();
  assert.equal(await p.getByRole('table',{name:'Sumber yang akan dirakit'}).locator('tbody tr').count(),1);
  await choice('sources','info').check();await p.locator('#start').click();
  await p.locator('#results').getByRole('button',{name:'Unduh paket',exact:true}).waitFor();
  await p.locator('#preview').click();await summary.waitFor();
  assert.deepEqual((await cells()).slice(1,6),['Contoh Pratinjau','Badan','Aktif','01234','Belum diketahui']);
  await p.locator('#preview-box').getByText(/Profil berasal dari hasil tersimpan/).waitFor();
  await p.locator('#officer').fill('Penugasan berbeda');await p.locator('#preview').click();await summary.waitFor();
  assert.equal((await cells())[1],'Belum tercantum');
  assert.deepEqual(errors,[]);
  console.log('Pratinjau terpasang lulus untuk sumber kosong, dua tahun, pembetulan, pilihan jenis dan sumber, serta layar seluler.');
}finally{await ctx?.close();await rm(dir,{recursive:true,force:true});}
