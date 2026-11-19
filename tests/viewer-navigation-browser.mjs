import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createPackage} from '../extension/archive/package.js';
import {decodeText,readZip} from '../extension/archive/zip.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=new URL('../extension/',import.meta.url);
const server=createServer(async(req,res)=>{
  try{
    const file=new URL('.'+new URL(req.url,'http://localhost').pathname,base);
    if(!file.href.startsWith(base.href))throw Error('Invalid path');
    res.setHeader('Content-Type',file.pathname.endsWith('.js')?'text/javascript':file.pathname.endsWith('.css')?'text/css':'text/html');
    res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
async function archive(npwp,id,surname,amount){
  const forms=[['2025-01',0,1],['2024-03',0,21],['2024-03',1,amount]];
  const entries=forms.map(([period,version,value],i)=>({path:'spt/PPN/'+period+'/p0'+version+'_'+id+i+'/induk.json',
    cap:{sumber:'sptisi',lengkap:true},pages:[{Payload:{FormData:JSON.stringify({VATUnderOrOverPaid:{VAT:value}})}}]}));
  const receipts=[{DocumentReceiptNumber:'BPE-'+id+'0'},{BpsNo:'00000000123',DocumentReceiptNumber:'00000000789'},
    {BpsNo:'BPE-'+id+'2',DocumentReceiptNumber:'DOC-FIKTIF-'+id}];
  entries.push({path:'spt/daftar.json',cap:{sumber:'sptdaftar'},pages:[{Payload:{Data:forms.map((_,i)=>({RecordId:id+i,...receipts[i]}))}}]},
    {path:'profil/alamat.json',cap:{sumber:'alamat',label:'Registrasi alamat'},pages:[{Payload:{Data:[{Description:'Alamat contoh '+surname}]}}]});
  const blob=await createPackage({meta:{wp:{npwp,nama:'Contoh '+surname}},entries});
  return {name:surname+'.zip',mimeType:'application/zip',buffer:Buffer.from(await blob.arrayBuffer())};
}
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined});
try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  const url='http://127.0.0.1:'+server.address().port+'/analisis/index.html';
  const primary=await archive('0000000000000015','privat-a','Alpha',55);
  const second=await archive('0000000000000016','privat-b','Beta',86);
  const dialog=page.getByRole('dialog');
  const quick=async(text,button)=>{
    await page.keyboard.press('Control+k');
    const field=dialog.getByRole('searchbox',{name:'Kata kunci pencarian cepat'});await field.fill(text);
    if(button)await dialog.getByRole('button',{name:button,exact:true}).click();else await field.press('Enter');
  };
  await page.goto(url);
  await page.getByRole('button',{name:'Bantuan',exact:true}).click();
  await page.getByRole('button',{name:'Program pengujian',exact:true}).click();
  const programs=page.getByRole('table',{name:'Program pengujian',exact:true});
  const programSearch=page.getByRole('searchbox',{name:'Cari prosedur'});
  const coretaxOnly=page.getByRole('checkbox',{name:'Dapat dilakukan dengan data Coretax saja'});
  await programs.waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile program table should scroll within its panel');
  await page.setViewportSize({width:1280,height:800});
  const programCount=await programs.locator('tbody tr').count();
  await coretaxOnly.check();
  const available=await programs.locator('tbody tr').count();
  assert.ok(available>0&&available<programCount);
  await programSearch.fill('faktur pembetulan');
  assert.equal(await programs.locator('tbody tr').count(),1);
  const [programFile]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Unduh hasil ke Excel'}).click()]);
  const sheetData=await readZip(await readFile(await programFile.path()));
  const programSheet=decodeText(sheetData.get('xl/worksheets/sheet1.xml').data);
  assert.match(programSheet,/PPN-FAKTUR/);assert.doesNotMatch(programSheet,/PB-PANEN/);
  await programSearch.fill('PB-PANEN');
  await page.getByText('Tidak ada prosedur yang cocok.',{exact:false}).waitFor();
  assert.ok(await page.getByRole('button',{name:'Unduh hasil ke Excel'}).isDisabled());
  await coretaxOnly.uncheck();await programs.getByRole('cell',{name:'PB-PANEN',exact:true}).waitFor();
  await page.getByRole('button',{name:'Muat paket',exact:true}).click();
  await page.locator('#filePkg').waitFor({state:'attached'});
  await quick('program pengujian');await programs.waitFor();
  await page.getByRole('button',{name:'Muat paket',exact:true}).click();
  await page.locator('#filePkg').setInputFiles(primary);await page.getByText('Konsisten · Seluruh sidik jari yang diperiksa cocok.').waitFor();
  await quick('histori alamat');await page.getByRole('heading',{name:'Histori alamat'}).waitFor();
  assert.equal(new URL(page.url()).hash,'#/profil/alamat');await page.getByRole('cell',{name:'Alamat contoh Alpha'}).waitFor();
  await quick('p1 maret ppn 2024');await dialog.getByRole('cell',{name:'55',exact:true}).waitFor();
  const link=page.url();assert.match(new URL(link).hash,/^#\/spt\/form-[a-f0-9]{32}-\d+$/);
  assert.doesNotMatch(link,/privat|000000000000001[56]|Alpha|Beta|BPE/);
  await page.goBack();await page.getByRole('heading',{name:'Histori alamat'}).waitFor();assert.equal(await dialog.count(),0);
  await page.goForward();await dialog.getByRole('cell',{name:'55',exact:true}).waitFor();
  const version=dialog.getByRole('combobox',{name:'Versi',exact:true});await version.selectOption({label:'Normal'});
  await dialog.getByRole('cell',{name:'21',exact:true}).waitFor();assert.notEqual(page.url(),link);
  await page.keyboard.press('Escape');await page.waitForURL(u=>u.hash==='#/spt');
  assert.equal(await page.getByRole('combobox',{name:'Tahun pajak'}).inputValue(),'2024');
  await page.getByRole('checkbox',{name:'Versi terakhir'}).uncheck();
  await page.getByRole('checkbox',{name:'Tampilkan semua kolom'}).check();
  await page.getByRole('searchbox',{name:'Cari di tabel Daftar SPT'}).fill('00000000123');
  const list=page.getByRole('table',{name:'Daftar SPT',exact:true});
  assert.equal(await list.locator('tbody tr').count(),1);
  await list.getByRole('cell',{name:'00000000123',exact:true}).waitFor();
  await list.getByRole('cell',{name:'00000000789',exact:true}).waitFor();
  await list.getByRole('button',{name:'Buka',exact:true}).click();
  await dialog.getByText('Nomor penerimaan dokumen',{exact:true}).waitFor();
  await dialog.getByText('00000000789',{exact:true}).waitFor();
  const [download]=await Promise.all([page.waitForEvent('download'),dialog.getByRole('button',{name:'Excel formulir',exact:true}).click()]);
  const wb=await readZip(await readFile(await download.path()));
  const sheet=decodeText(wb.get('xl/worksheets/sheet1.xml').data);
  assert.match(sheet,/<c [^>]*t="inlineStr"><is><t [^>]*>00000000123<\/t>/);
  assert.match(sheet,/<c [^>]*t="inlineStr"><is><t [^>]*>00000000789<\/t>/);
  await page.keyboard.press('Escape');
  await quick('bpe privat a2');await dialog.getByRole('cell',{name:'55',exact:true}).waitFor();assert.equal(page.url(),link);
  await dialog.getByText('DOC-FIKTIF-privat-a',{exact:true}).waitFor();
  await quick('DOC-FIKTIF-privat-a');await dialog.getByRole('cell',{name:'55',exact:true}).waitFor();
  await quick('00000000789');await dialog.getByRole('cell',{name:'21',exact:true}).waitFor();
  await quick('00000000123');await dialog.getByRole('cell',{name:'21',exact:true}).waitFor();
  await quick('registrasi alamat','Data mentah · Registrasi alamat');await page.getByRole('heading',{name:'Registrasi alamat'}).waitFor();assert.equal(new URL(page.url()).hash,'#/tabel');
  await page.goto(link);await page.reload();await page.getByRole('heading',{name:'Buka formulir tertaut'}).waitFor();
  await page.locator('#filePkg').setInputFiles(second);await page.getByRole('heading',{name:'Formulir belum tersedia'}).waitFor();
  assert.equal(await dialog.count(),0);
  await page.locator('#filePkg').setInputFiles(primary);await dialog.getByRole('cell',{name:'55',exact:true}).waitFor();
  await page.getByRole('button',{name:'Tutup',exact:true}).click();await page.waitForURL(u=>u.hash==='#/spt');
  await page.locator('#taxpayer').selectOption({label:'Contoh Beta · 0000000000000016'});await quick('p1 maret ppn 2024');
  await dialog.getByRole('cell',{name:'86',exact:true}).waitFor();assert.notEqual(page.url(),link);
  await page.goto(link);await dialog.getByRole('cell',{name:'55',exact:true}).waitFor();
  assert.deepEqual(errors,[]);console.log('Viewer navigation passed: cross-menu search, exact form and version, history, raw and profile destinations, private links, reload and two-package isolation.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
