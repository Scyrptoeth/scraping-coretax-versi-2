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
  await page.goto(origin);
  async function corporate(name,id,code,gross){
    const main={MainFormData:{IncomeTaxInAYear:5},L1cFormData:{
      L1cTreeData:[{Data:{AccountCode:'4020',Amount:100}},{Data:{AccountCode:'4300',Amount:gross}}],
      L1cTreeTotalRow:{Amount:10},L1cAssets:{AC1500:200},L1cLiabilitiesAndEquity:{AC2229:50}}};
    return archive(name,id,[{path:'profil/informasi-umum.json',cap:{lengkap:true},pages:[{Payload:{MainEconomicCode:{TradeClassificationCode:code},GeneralInformation:{RegistrationDate:'2015-01-01'}}}]},
      {path:'profil/pihak-terkait.json',cap:{lengkap:true},pages:[{Payload:{Data:[{PersonName:'Pihak contoh',PersonNIKTIN:'P1'}]}}]},
      entry('BADAN','2025',1,'annual',main)]);
  }
  await page.locator('#filePkg').setInputFiles(await Promise.all([
    corporate('Utama','0000000000000021','01111',60),corporate('Sektor Satu','0000000000000022','01111',10),
    corporate('Sektor Dua','0000000000000023','01111',30),corporate('Sektor Lain','0000000000000024','99999',100)]));
  await page.getByRole('status').filter({hasText:'4 paket dibuka.'}).waitFor();
  await page.locator('#taxpayer').selectOption({label:'Utama · 0000000000000021'});
  await nav('Dasbor').click();await page.getByRole('button',{name:'Perbandingan antar-WP',exact:true}).click();
  await page.getByText('Kelompok tahun 2025 mencakup 2 WP pembanding · KLU 01111.').waitFor();
  const group=page.getByRole('table',{name:'Median dan rentang kelompok'}),gross=group.getByRole('row').filter({hasText:'Margin laba kotor'});
  assert.deepEqual((await gross.getByRole('cell').allTextContents()).slice(2,9),['%','60','20','10','30','2','200']);
  const books=page.waitForEvent('download');await page.getByRole('button',{name:'Excel pembanding lintas paket'}).click();
  const groupXlsx=await readZip(await readFile(await (await books).path()));
  assert.match(decodeText(groupXlsx.get('xl/workbook.xml').data),/Sumber dan komponen/);
  assert.match(decodeText(groupXlsx.get('xl/worksheets/sheet3.xml').data),/4020/);
  await gross.getByRole('button',{name:'Buka'}).click();const dialog=page.getByRole('dialog');
  await dialog.getByRole('table',{name:'Komponen rasio per WP'}).waitFor();
  assert.equal(await dialog.getByRole('table').getByRole('row').count(),4);
  await dialog.getByRole('button',{name:'Buka induk · Sektor Dua'}).click();
  await page.getByRole('dialog').getByRole('heading',{name:'PPh Badan · 2025'}).waitFor();
  assert.match(await page.locator('#taxpayer').locator('option:checked').textContent(),/Sektor Dua/);
  await page.getByRole('button',{name:'Tutup',exact:true}).click();await nav('Dasbor').click();
  await page.getByRole('button',{name:'Keuangan',exact:true}).click();
  await page.getByRole('table',{name:'Rasio keuangan WP aktif'}).waitFor();
  await page.getByRole('button',{name:'Lanjutan',exact:true}).click();
  await page.getByRole('table',{name:'Kronologi peristiwa'}).getByText('2015-01-01').waitFor();
  await page.getByRole('group',{name:'Garis waktu per tahun'}).getByRole('button',{name:'2015 · 1 peristiwa'}).press('Enter');
  await page.getByRole('group',{name:'Garis waktu per bulan'}).getByRole('button',{name:'2015-01 · 1 peristiwa'}).press('Enter');
  await page.getByText('Peristiwa bulan 2015-01',{exact:true}).waitFor();
  await page.getByRole('group',{name:'Diagram hubungan WP'}).getByRole('button',{name:'Rincian Pihak contoh'}).press('Enter');
  await page.getByRole('dialog').getByRole('button',{name:'Buka profil/pihak-terkait.json'}).click();
  await page.getByRole('dialog').getByRole('table',{name:'Tabel sumber'}).getByText('Pihak contoh').waitFor();
  await page.getByRole('button',{name:'Tutup',exact:true}).click();
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
    await nav('Muat paket').click();await page.locator('#filePkg').setInputFiles(['-OP','-OP-PEKERJAAN-BEBAS'].map(s=>resolve(dir,'CONTOH-paket-DEMO-FIKTIF'+s+'.zip')));
    await page.getByRole('status').filter({hasText:'2 paket dibuka.'}).waitFor();
    const taxpayer=page.locator('#taxpayer');const packages=await taxpayer.locator('option').evaluateAll(opts=>opts.map(o=>o.value).filter(Boolean));
    assert.equal(packages.length,4);
    await nav('Dasbor').click();await page.getByRole('button',{name:'Lanjutan',exact:true}).click();
    for(const key of packages){
      await taxpayer.selectOption(key);await page.getByRole('table',{name:'Kronologi peristiwa'}).waitFor();
      await page.getByRole('group',{name:'Diagram hubungan WP'}).waitFor();
      assert.ok(await page.getByRole('table',{name:'Hubungan dan sumber'}).getByRole('row').count()>1);
    }
  }
  assert.deepEqual(errors,[]);console.log('Taxpayer comparison and advanced dashboard passed: KLU cohort, annual ratios, medians, timelines, relationship map, evidence links, traceable XLSX and optional four fictitious packages.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
