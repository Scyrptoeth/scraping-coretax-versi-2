import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
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
function entry(kind,period,version,id,data){
  return {path:'spt/'+kind+'/'+period+'/p0'+version+'_'+id+'/induk.json',cap:{sumber:'sptisi',lengkap:true},pages:[{Payload:{FormData:JSON.stringify(data)}}]};
}
async function archive(name,npwp,entries){
  const blob=await createPackage({meta:{wp:{npwp,nama:name}},entries});
  return {name:name+'.zip',mimeType:'application/zip',buffer:Buffer.from(await blob.arrayBuffer())};
}
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined});
try{
  const page=await browser.newPage({acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const origin='http://127.0.0.1:'+server.address().port+'/analisis/index.html';
  const first=await archive('Alpha','0000000000000015',[
    entry('PPN','2025-03',0,'old',{CurrencyCode:'IDR',TotalDeliveryOfGoodsAndServices:{SellingPrice:300}}),
    entry('PPN','2025-03',1,'new',{CurrencyCode:'IDR',TotalDeliveryOfGoodsAndServices:{SellingPrice:0},VATUnderOrOverPaid:{VAT:50}}),
    entry('PPN','2025-02',0,'no-unit',{TotalDeliveryOfGoodsAndServices:{SellingPrice:123}}),
    entry('PPN','2025-01',1,'duplicate-1',{CurrencyCode:'IDR',TotalDeliveryOfGoodsAndServices:{SellingPrice:99}}),
    entry('PPN','2025-01',1,'duplicate-2',{CurrencyCode:'IDR',TotalDeliveryOfGoodsAndServices:{SellingPrice:98}})]);
  const second=await archive('Beta','0000000000000016',['01','02','03','04'].map(month=>entry('PPN','2025-'+month,0,'beta-'+month,
    {CurrencyCode:'IDR',TotalDeliveryOfGoodsAndServices:{SellingPrice:200},InputTaxCanBeCalculated:{VAT:9},VATUnderOrOverPaid:{VAT:0}})));
  const same=await archive('Alpha salinan','000000000000015',[entry('PPN','2025-03',0,'same',{})]);
  const other=await archive('Gamma','0000000000000017',[entry('OP','2025',0,'op',{AnnualNetIncome:100})]);
  const nav=n=>page.getByRole('navigation').getByRole('button',{name:n,exact:true});
  await page.goto(origin);await page.locator('#filePkg').setInputFiles(first);await page.getByText('Konsisten · Seluruh sidik jari yang diperiksa cocok.').waitFor();
  await nav('Dasbor').click();await page.getByRole('button',{name:'Perbandingan antar-WP'}).click();await page.getByText('Muat paket dengan NPWP berbeda untuk membandingkan SPT.').waitFor();
  await nav('Muat paket').click();await page.locator('#filePkg').setInputFiles([same,second,other]);await page.getByRole('status').filter({hasText:'3 paket dibuka.'}).waitFor();
  await page.locator('#taxpayer').selectOption({label:'Alpha · 0000000000000015'});
  await page.keyboard.press('Control+k');const search=page.getByRole('searchbox',{name:'Kata kunci pencarian cepat'});await search.fill('antar wp');await search.press('Enter');
  const peer=page.getByRole('combobox',{name:'Paket WP pembanding'});await peer.waitFor();assert.equal(await peer.locator('option').count(),3);
  const beta=await peer.locator('option').filter({hasText:'Beta'}).getAttribute('value');await peer.selectOption(beta);
  const period=page.getByRole('combobox',{name:'Masa atau tahun SPT'});assert.equal(await period.locator('option').count(),3);
  const table=page.getByRole('table',{name:'Angka perbandingan'}),basis=page.getByRole('table',{name:'Sumber kedua WP'});
  const row=key=>table.getByRole('row').filter({has:page.getByRole('cell',{name:key,exact:true})});
  await table.waitFor();assert.deepEqual(await row('Penyerahan').getByRole('cell').allTextContents(),['Penyerahan','0','200','-200','-100','TotalDeliveryOfGoodsAndServices.SellingPrice']);
  assert.deepEqual(await row('PPN masukan').getByRole('cell').allTextContents(),['PPN masukan','—','9','—','—','InputTaxCanBeCalculated.VAT']);
  assert.deepEqual(await row('KB/(LB)').getByRole('cell').allTextContents(),['KB/(LB)','50','0','50','—','VATUnderOrOverPaid.VAT']);
  await basis.getByRole('cell',{name:'Pembetulan 1',exact:true}).waitFor();await basis.getByRole('cell',{name:'Normal',exact:true}).waitFor();
  const capture=page.waitForEvent('download');await page.getByRole('button',{name:'Excel perbandingan'}).click();const file=await capture;
  const workbook=await readZip(await readFile(await file.path()));
  assert.match(decodeText(workbook.get('xl/workbook.xml').data),/Sumber kedua WP/);
  assert.match(decodeText(workbook.get('xl/worksheets/sheet1.xml').data),/2025-03\/p01_new\/induk.json/);
  await period.selectOption('2025-02');assert.deepEqual(await row('Penyerahan').getByRole('cell').allTextContents(),['Penyerahan','123','200','—','—','TotalDeliveryOfGoodsAndServices.SellingPrice']);
  await period.selectOption('2025-01');await basis.getByText('Nomor versi terakhir ganda pada sumber',{exact:true}).waitFor();
  assert.deepEqual(await row('Penyerahan').getByRole('cell').allTextContents(),['Penyerahan','—','200','—','—','TotalDeliveryOfGoodsAndServices.SellingPrice']);
  const gamma=await peer.locator('option').filter({hasText:'Gamma'}).getAttribute('value');await peer.selectOption(gamma);await page.getByText('Kedua paket belum memuat jenis dan masa SPT yang sama pada tahun yang dipilih.').waitFor();
  assert.equal(new URL(page.url()).hash,'#/ringkas/banding');
  if(process.env.VERITAX_FIXTURES){
    await page.goto(origin);const dir=process.env.VERITAX_FIXTURES;
    await page.locator('#filePkg').setInputFiles(['','-BADAN-MIGRASI'].map(s=>resolve(dir,'CONTOH-paket-DEMO-FIKTIF'+s+'.zip')));
    await page.getByRole('status').filter({hasText:'2 paket dibuka.'}).waitFor();
    await nav('Dasbor').click();await page.getByRole('button',{name:'Perbandingan antar-WP'}).click();
    await page.getByRole('combobox',{name:'Tahun pajak'}).selectOption('2025');
    await peer.selectOption({index:1});await page.getByRole('combobox',{name:'Jenis SPT pembanding'}).selectOption('BADAN');
    assert.equal(await period.inputValue(),'2025');await row('PPh terutang').waitFor();
    assert.equal((await row('PPh terutang').getByRole('cell').allTextContents()).slice(1,3).every(v=>v!=='—'),true);
    assert.equal(await basis.getByRole('row').count(),3);
  }
  assert.deepEqual(errors,[]);console.log('Taxpayer comparison passed: exact type/period, distinct identities, revisions and ambiguous versions, missing or zero amounts, currency, traceable XLSX and optional corporate fixtures.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
