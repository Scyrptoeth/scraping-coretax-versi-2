import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createPackage} from '../extension/archive/package.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=new URL('../extension/',import.meta.url);
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname;const file=new URL('.'+path,base);
    if(!file.href.startsWith(base.href))throw Error('Unexpected path');
    res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');
    res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
const source=(id,version,amount)=>({path:'spt/PPN/2025-03/p'+version+'_'+id+'/induk.json',cap:{sumber:'sptisi',lengkap:true},pages:[{Payload:{FormData:JSON.stringify({VATUnderOrOverPaid:{VAT:amount}})}}]});
const content={meta:{wp:{npwp:'0000000000000007',nama:'WP Fiktif Uji'},opsi:{periode:{from:{y:2025},to:{y:2025}}}},entries:[
  source('contoh','00',100),source('contoh-P1','01',50),
  {path:'profil/informasi-umum.json',cap:{sumber:'info',label:'Informasi profil',lengkap:true},pages:[{Payload:{GeneralInformation:{Name:'WP Fiktif Uji'}}}]},
  {path:'spt/daftar.json',cap:{sumber:'sptdaftar',lengkap:true},pages:[{Payload:{Data:[{RecordId:'contoh',ReturnDate:'2025-05-01',ExpectedReturnDate:'2025-04-30'}]}}]}]};
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined});const errors=[];
try{
  const page=await browser.newPage({viewport:{width:1366,height:850},acceptDownloads:true});
  page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/analisis/index.html');
  const nav=name=>page.getByRole('navigation').getByRole('button',{name,exact:true});
  const pick=blob=>blob.arrayBuffer().then(buffer=>page.locator('#filePkg').setInputFiles({name:'uji.zip',mimeType:'application/zip',buffer:Buffer.from(buffer)}));
  assert.equal(await nav('SPT').isDisabled(),true);
  await nav('Bantuan').click();await page.getByRole('heading',{name:'Bantuan'}).waitFor();await nav('Muat paket').click();
  await pick(await createPackage(content));await page.getByText('Konsisten · Seluruh sidik jari yang diperiksa cocok.').waitFor();
  await nav('Profil WP').click();await page.getByRole('cell',{name:'GeneralInformation.Name',exact:true}).waitFor();
  await nav('SPT').click();await page.getByLabel('Versi terakhir').check();
  await page.getByRole('button',{name:'Buka',exact:true}).click();await page.getByRole('dialog').getByRole('cell',{name:'50',exact:true}).waitFor();
  await page.getByRole('button',{name:'Bandingkan versi'}).click();await page.getByRole('dialog').getByRole('cell',{name:'100',exact:true}).waitFor();await page.keyboard.press('Escape');
  await nav('Kertas Kerja').click();await page.getByRole('button',{name:'Tambah butir',exact:true}).click();await page.getByLabel('Butir pengujian').fill('Uji selisih fiktif');await page.getByLabel('Menurut WP').fill('0');await page.getByLabel('Menurut petugas').fill('50');await page.getByRole('button',{name:'Simpan butir'}).click();
  await page.getByRole('cell',{name:'Uji selisih fiktif'}).waitFor();
  const exported=page.waitForEvent('download');await page.getByRole('button',{name:'Excel kertas kerja'}).click();assert.match((await exported).suggestedFilename(),/\.xlsx$/);
  const save=page.waitForEvent('download');await page.getByRole('button',{name:'Unduh berkas kerja'}).click();const data=JSON.parse(await readFile(await(await save).path(),'utf8'));assert.equal(data.rows[0].menurutWp,0);
  await nav('Dasbor').click();await page.getByRole('button',{name:'PPN & lawan',exact:true}).click();await page.getByRole('heading',{name:'Induk PPN per masa'}).waitFor();
  await page.keyboard.press('Control+k');await page.getByRole('searchbox',{name:'Kata kunci pencarian cepat'}).fill('keuangan');await page.keyboard.press('Enter');await page.getByRole('heading',{name:'Angka pada SPT tahunan'}).waitFor();
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');
  await nav('Muat paket').click();await pick(await createPackage({...content,password:'kata-sandi-fiktif'}));await page.getByRole('dialog').locator('input[type=password]').fill('kata-sandi-fiktif');await page.getByRole('button',{name:'Buka paket',exact:true}).click();await page.getByText(/berkas diperiksa. Paket terenkripsi./).waitFor();
  if(process.env.VERITAX_FIXTURES){
    const folder=process.env.VERITAX_FIXTURES;
    const files=(await readdir(folder)).filter(n=>/^CONTOH.*FIKTIF.*\.zip$/.test(n));
    assert.equal(files.length,4);await page.locator('#filePkg').setInputFiles(files.map(name=>folder+'/'+name));await page.getByRole('status').filter({hasText:'4 paket dibuka.'}).waitFor();
    for(const id of await page.locator('#taxpayer option').evaluateAll(items=>items.map(o=>o.value).slice(-4))){
      await page.locator('#taxpayer').selectOption(id);await nav('SPT').click();await page.getByRole('heading',{name:'Daftar dan isi SPT'}).waitFor();await nav('Muat paket').click();
      await page.getByText('Konsisten · Seluruh sidik jari yang diperiksa cocok.').waitFor();
    }
  }
  assert.deepEqual(errors,[]);console.log('Viewer browser passed: package import, integrity, role navigation, profile, annual filter, SPT version diff, Excel workpaper, JSON save, dashboard, quick search, mobile, encrypted ZIP and optional four examples.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
