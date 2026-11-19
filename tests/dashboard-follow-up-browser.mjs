import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createPackage} from '../extension/archive/package.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const extension=resolve(process.env.EXTENSION_DIR||'extension'),wp='0000000000000017';
const sample=await createPackage({meta:{wp:{nama:'Badan fiktif',npwp:wp},opsi:{periode:{from:{y:2025,m:1},to:{y:2026,m:12}}}},
  entries:[{path:'profil/informasi-umum.json',cap:{sumber:'info',lengkap:true,baris:1,konteks:{npwp:wp}},pages:[{Payload:{
    GeneralInformation:{UniqueIdentificationNumber:wp},MainEconomicCode:{TradeClassificationCode:'01262',ActivityDescription:'Kegiatan uji',
      IsMainEconomicCode:true,ValidFrom:'2025-01-01',ValidTo:'2025-12-31'}}}]}]});
const profile=await mkdtemp(join(tmpdir(),'scv2-dashboard-'));
let browser;
try{
  browser=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,offline:true,executablePath:process.env.CHROMIUM_PATH||undefined,
    args:['--disable-background-networking','--disable-extensions-except='+extension,'--load-extension='+extension]});
  const sw=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker'),p=await browser.newPage();
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(new URL('analisis/index.html',sw.url()).href);
  await p.locator('#filePkg').setInputFiles({name:'fiktif.zip',mimeType:'application/zip',buffer:Buffer.from(await sample.arrayBuffer())});
  await p.getByText(/Konsisten · Seluruh sidik jari/).waitFor();
  const button=name=>p.getByRole('button',{name,exact:true}),nav=p.getByRole('navigation',{name:'Bagian aplikasi'});
  const dashboard=async()=>{await nav.getByRole('button',{name:'Dasbor',exact:true}).click();await p.getByRole('heading',{name:'Tindak lanjut',exact:true}).waitFor();};
  await dashboard();
  await p.getByText('KLU utama untuk tahun ini belum dapat dipastikan dari paket.').waitFor();
  await p.getByLabel('Tahun pajak',{exact:true}).selectOption('2025');
  await p.getByRole('heading',{name:'Kegiatan uji',exact:true}).waitFor();
  await button('Telusuri KLU di Probis').click();await p.waitForURL(url=>url.hash==='#/probis/klu');await button('01262').first().waitFor();
  for(const [label,destination,ready] of [
    ['Buka laporan temuan langsung','kerja/tl','#direct-findings-title'],
    ['Buka laporan temuan indikatif','kerja/ti','#indicative-findings-title'],
    ['Periksa pelaporan SPT','profil/lapor','.profile-mobile'],
    ['Periksa mutu data','mutu','h2:text-is("Cakupan sumber penarikan")'],
    ['Buka simulasi sanksi','kerja/sim','h2:text-is("Penghitungan per masa")'],
  ]){
    await dashboard();await button(label).click();await p.waitForURL(url=>url.hash==='#/'+destination);
    await p.locator(ready).first().waitFor({state:'attached'});
  }
  await p.setViewportSize({width:390,height:844});await dashboard();
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);console.log('Dasbor menampilkan KLU tahun terpilih; keenam tindakan membuka tujuan yang diharapkan dan tidak ada luapan pada layar ponsel.');
}finally{await browser?.close();await rm(profile,{recursive:true,force:true});}
