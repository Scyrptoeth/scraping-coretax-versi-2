import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {createPackage,readPackage} from '../extension/archive/package.js';
import {decodeText,readZip} from '../extension/archive/zip.js';
import {indexPackage,rowsOf} from '../extension/analisis/model.js';
import {periodTitle} from '../extension/analisis/spt-forms.js';

const dir=process.env.VERITAX_FIXTURES;
if(!dir)throw Error('Set VERITAX_FIXTURES to the directory containing the four fictitious packages.');
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=new URL('../extension/',import.meta.url);
const server=createServer(async(req,res)=>{
  try{
    const file=new URL('.'+new URL(req.url,'http://localhost').pathname,base);
    if(!file.href.startsWith(base.href))throw Error('Unexpected path');
    res.setHeader('Content-Type',file.pathname.endsWith('.js')?'text/javascript':file.pathname.endsWith('.css')?'text/css':'text/html');
    res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined});
try{
  const names=(await readdir(dir)).filter(n=>/^CONTOH.*FIKTIF.*\.zip$/.test(n)).sort();
  assert.equal(names.length,4);
  const seen=new Set(),errors=[];let revised=0;
  for(const name of names){
    const file=resolve(dir,name),pkg=indexPackage(await readPackage(await readFile(file)));
    const page=await browser.newPage({viewport:{width:1300,height:850},acceptDownloads:true});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/analisis/index.html');
    await page.locator('#filePkg').setInputFiles(file);
    await page.getByText('Konsisten · Seluruh sidik jari yang diperiksa cocok.').waitFor();
    await page.getByRole('navigation').getByRole('button',{name:'SPT',exact:true}).click();
    const latest=page.getByRole('checkbox',{name:'Versi terakhir'});
    assert.equal(await latest.isChecked(),true);
    await latest.uncheck();
    const kinds=new Set(pkg.forms.map(f=>f.type));
    for(const kind of kinds){
      const form=pkg.forms.find(f=>f.type===kind&&f.amended)||pkg.forms.find(f=>f.type===kind);
      await page.getByRole('combobox',{name:'Tahun pajak'}).selectOption(form.year);
      await page.getByRole('combobox',{name:'Jenis',exact:true}).selectOption(kind);
      const table=page.getByRole('table',{name:'Daftar SPT',exact:true});
      await table.getByRole('row').filter({has:page.getByRole('button',{name:periodTitle(form.period),exact:true})})
        .filter({has:page.getByRole('cell',{name:form.version?'Pembetulan '+form.version:'Normal',exact:true})}).getByRole('button',{name:'Buka'}).click();
      const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'Induk',exact:true}).waitFor();
      const part=dialog.getByRole('combobox',{name:'Induk / lampiran'});assert.equal(await part.locator('option').count(),form.parts.size);
      if(kind==='PPN'){
        const summary=dialog.getByRole('table',{name:'Ringkasan induk PPN',exact:true});
        const parent=rowsOf(form.parts.get('induk'))[0],amount=parent.VATUnderOrOverPaid?.VAT;
        if(typeof amount==='number'){
          const line=summary.getByRole('row').filter({has:page.getByRole('cell',{name:'PPN kurang atau lebih bayar',exact:true})});
          await line.getByRole('cell',{name:amount.toLocaleString('id-ID'),exact:true}).waitFor();
          await line.getByRole('button',{name:'Lihat isian'}).click();
          await dialog.getByRole('table',{name:'Induk',exact:true}).waitFor();
          await dialog.getByRole('button',{name:'Kembali ke ringkasan induk PPN'}).click();
        }
      }
      const empty=dialog.locator('details').filter({has:page.locator('summary').filter({hasText:/^\d+ lampiran kosong$/})});
      if(await empty.count()){
        await empty.locator('summary').click();await empty.getByRole('button').first().click();
        assert.notEqual(await part.inputValue(),'induk');await part.selectOption('induk');
      }
      if(kind==='PPH2126'||kind==='UNIFIKASI'){
        const parent=rowsOf(form.parts.get('induk'))[0],unified=kind==='UNIFIKASI';
        const main=dialog.getByRole('table',{name:'Ringkasan induk',exact:true});
        const key=unified?'TotalWithholding':'A21IncomeTaxWithheld';
        const amount=main.getByRole('row').filter({has:page.getByRole('cell',{name:unified?'Jumlah dipotong':'PPh 21 · Dipotong',exact:true})});
        assert.equal(await main.getByRole('cell',{name:key,exact:true}).count(),0);
        await amount.getByRole('cell',{name:parent[key].toLocaleString('id-ID'),exact:true}).waitFor();
        const name=unified?'PPh per pasal dan rincian objek':'Bruto dan PPh menurut lampiran pada induk';
        const detail=dialog.getByRole('table',{name,exact:true});
        const value=unified?parent.IncomeTaxes[0].data.TotalIncomeTaxPaid:parent.Form1A.GrossIncome;
        await detail.getByRole('cell',{name:value.toLocaleString('id-ID'),exact:true}).first().waitFor();
        const annex=unified?'d1-bpu':'l1a',evidence=dialog.getByRole('table',{name:'Bukti pada lampiran versi ini'});
        await evidence.getByRole('row').filter({has:page.getByRole('cell',{name:annex,exact:true})}).getByRole('button',{name:'Buka'}).click();
        assert.equal(await part.inputValue(),annex);await part.selectOption('induk');
        const [download]=await Promise.all([page.waitForEvent('download'),dialog.getByRole('button',{name:'Excel formulir',exact:true}).click()]);
        const workbook=await readZip(await readFile(await download.path())),sheet=decodeText(workbook.get('xl/worksheets/sheet1.xml').data);
        assert.ok(sheet.includes(name));assert.ok(sheet.includes('<v>'+value+'</v>'));assert.ok(sheet.includes('<v>'+parent[key]+'</v>'));
      }
      const keyword={PPN:'VATUnderOrOverPaid',PPH2126:'A21IncomeTaxWithheld',UNIFIKASI:'TotalWithholding',BADAN:'MainFormData',OP:'UnderOrOverPaymentTax'}[kind];
      await dialog.getByRole('searchbox',{name:'Cari di seluruh bagian SPT'}).fill(keyword);
      const hits=dialog.getByRole('table',{name:'Hasil pencarian formulir'});await hits.getByRole('button',{name:'Buka'}).first().click();
      await dialog.getByRole('table',{name:'Induk'}).waitFor();
      const annex=[...form.parts.keys()].find(k=>k!=='induk');
      assert.ok(annex);await part.selectOption(annex);
      await dialog.getByRole('button',{name:'Lihat data asli'}).click();
      assert.equal(await part.inputValue(),annex);
      const selected=page.waitForEvent('download');await dialog.getByRole('button',{name:'Excel data mentah'}).click();
      const download=await selected;const wb=await readZip(await readFile(await download.path()));
      const sheets=decodeText(wb.get('xl/workbook.xml').data);
      assert.equal((sheets.match(/<sheet name="(?!Daftar Isi")/g)||[]).length,form.parts.size);
      assert.ok(decodeText(wb.get('xl/worksheets/sheet1.xml').data).includes(form.parts.get('induk').path));
      if(form.amended && pkg.forms.filter(f=>f.type===kind&&f.period===form.period).length>1){
        await dialog.getByRole('button',{name:'Bandingkan versi'}).click();await dialog.getByRole('combobox',{name:'Versi pembanding'}).waitFor();
        await dialog.getByRole('combobox',{name:'Bagian yang dibandingkan'}).selectOption('induk');
        assert.ok(await dialog.getByRole('table',{name:'Perubahan'}).count()||await dialog.getByText('Tidak ada perubahan isian pada dua versi ini.').count());revised++;
      }
      await page.keyboard.press('Escape');seen.add(kind);
    }
    const kind=[...kinds].at(-1),year=await page.getByRole('combobox',{name:'Tahun pajak'}).inputValue();
    const selectedForms=pkg.forms.filter(f=>f.year===year&&f.type===kind);
    await page.evaluate(()=>{window.print=()=>{window.testPrinted=[document.querySelectorAll('.print-catalog h1').length,document.querySelectorAll('.print-catalog h2').length]};});
    await page.getByRole('button',{name:'Cetak gabungan (PDF)'}).click();
    assert.deepEqual(await page.evaluate(()=>window.testPrinted),[selectedForms.length,selectedForms.reduce((n,f)=>n+f.parts.size,0)]);
    const combined=page.waitForEvent('download');await page.getByRole('button',{name:'Excel gabungan'}).click();
    assert.equal((await combined).suggestedFilename(),'RAHASIA-SPT-gabungan-'+pkg.manifest.wp.npwp+'.xlsx');
    await page.getByRole('button',{name:'Ringkasan SPT',exact:true}).click();
    await page.getByRole('table',{name:'Kalender pelaporan',exact:true}).waitFor();
    if(kinds.has('PPN')){
      const vat=page.getByRole('table',{name:'PPN per masa',exact:true});
      await vat.waitFor();assert.equal(await vat.getByRole('columnheader').count(),16);
      const annual=page.getByRole('table',{name:'Rekap PPN tahunan',exact:true});
      assert.equal(await annual.getByRole('columnheader').count(),18);
      assert.equal(await annual.locator('tbody tr').count(),13);
      await page.getByRole('table',{name:'Potong pungut'}).waitFor();
    }
    await page.close();
  }
  assert.equal(seen.size,5);assert.ok(revised>=1);assert.deepEqual(errors,[]);
  const page=await browser.newPage({acceptDownloads:true});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/analisis/index.html');
  const first={DocumentNumber:'FAK-A',TIN:'00001',TaxBase:1000,VAT:110},second={DocumentNumber:'FAK-B',TIN:'00002',TaxBase:2000,VAT:220};
  const sections=[];
  for(const [i,docs] of [[0,[first,second]],[1,[{...second,VAT:225},first]]]){
    const base='spt/PPN/2025-01/p0'+i+'_uji'+i+'/';
    sections.push({path:base+'induk.json',cap:{sumber:'sptisi',lengkap:true},pages:[{Payload:{FormData:'{"VAT":70}'}}]},
      {path:base+'a2.json',cap:{sumber:'sptisi',lengkap:true,konteks:{jenisBagian:'grid'}},pages:[{Payload:{Data:docs,TotalRecords:2}}]});
  }
  const pkg=await createPackage({meta:{wp:{npwp:'0000000000000091',nama:'WP fiktif urutan faktur'}},entries:sections});
  await page.locator('#filePkg').setInputFiles({name:'uji-urutan.zip',mimeType:'application/zip',buffer:Buffer.from(await pkg.arrayBuffer())});
  await page.getByText('Konsisten · Seluruh sidik jari yang diperiksa cocok.').waitFor();
  await page.getByRole('navigation').getByRole('button',{name:'SPT',exact:true}).click();
  await page.getByRole('table',{name:'Daftar SPT',exact:true}).getByRole('button',{name:'Buka'}).first().click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Bandingkan versi'}).click();
  await dialog.getByLabel('Bagian yang dibandingkan').selectOption('a2');
  const changes=dialog.getByRole('table',{name:'Perubahan',exact:true}),row=changes.locator('tbody tr');
  assert.equal(await row.count(),1);
  for(const v of ['FAK-B','PPN','220','225'])await row.getByRole('cell',{name:v,exact:true}).waitFor();
  const totals=dialog.getByRole('table',{name:'Nominal lampiran'}).getByRole('row').filter({has:page.getByRole('cell',{name:'PPN',exact:true})});
  for(const v of ['330','335','5'])await totals.getByRole('cell',{name:v,exact:true}).waitFor();
  const [download]=await Promise.all([page.waitForEvent('download'),dialog.getByRole('button',{name:'Excel perbandingan lampiran'}).click()]);
  const saved=await readZip(await readFile(await download.path())),sheet=decodeText(saved.get('xl/worksheets/sheet2.xml').data);
  assert.match(sheet,/FAK-B/);assert.match(sheet,/<v>220<\/v>/);assert.match(sheet,/<v>225<\/v>/);assert.doesNotMatch(sheet,/FAK-A/);
  assert.deepEqual(errors,[]);await page.close();
  const coveragePage=await browser.newPage({acceptDownloads:true});
  coveragePage.on('pageerror',e=>errors.push(e.message));
  await coveragePage.goto('http://127.0.0.1:'+server.address().port+'/analisis/index.html');
  await coveragePage.locator('#filePkg').setInputFiles(resolve(dir,'CONTOH-paket-DEMO-FIKTIF.zip'));
  await coveragePage.getByText('Konsisten · Seluruh sidik jari yang diperiksa cocok.').waitFor();
  for(const role of ['AR','Pemeriksa','Penelaah']){
    await coveragePage.locator('#role').selectOption(role);
    await coveragePage.getByRole('navigation').getByRole('button',{name:'SPT',exact:true}).click();
    await coveragePage.getByRole('combobox',{name:'Tahun pajak'}).selectOption('2025');
    await coveragePage.getByRole('combobox',{name:'Jenis',exact:true}).selectOption('PPN');
    await coveragePage.getByRole('table',{name:'Daftar SPT',exact:true}).getByRole('button',{name:'Buka'}).first().click();
    const drawer=coveragePage.getByRole('dialog');
    await drawer.locator('summary').filter({hasText:/Cakupan SPT PPN · 8 dari 8 berkas diterima/}).click();
    const table=drawer.getByRole('table',{name:'Cakupan delapan bagian PPN'});
    assert.equal(await table.locator('tbody tr').count(),8);
    const total=table.getByRole('row').filter({has:coveragePage.getByRole('cell',{name:'Total C',exact:true})});
    await total.getByRole('cell',{name:'Kosong terverifikasi',exact:true}).waitFor();
    await total.getByText('Total C diterima tanpa isian. Lampiran C terbukti 0 baris.').waitFor();
    if(role==='AR'){
      const [download]=await Promise.all([coveragePage.waitForEvent('download'),drawer.getByRole('button',{name:'Excel cakupan PPN'}).click()]);
      const book=await readZip(await readFile(await download.path()));
      const sheet=decodeText(book.get('xl/worksheets/sheet1.xml').data);
      assert.match(sheet,/ID rekaman/);assert.match(sheet,/Total C diterima tanpa isian/);assert.match(sheet,/Berkas diterima/);
    }
    await drawer.getByRole('button',{name:'Tutup',exact:true}).click();
  }
  await coveragePage.close();assert.deepEqual(errors,[]);
  const withholdingPage=await browser.newPage({acceptDownloads:true});
  withholdingPage.on('pageerror',e=>errors.push(e.message));
  const nested='TotalGrossIncomeAndIncomeTaxBorneByGovernmentAndIncomeTaxWithheld';
  const revisions=[];
  for(const [i,gross,tax] of [[0,140,14],[1,110,11]]){
    const path='spt/PPH2126/2025-02/p0'+i+'_pphuji'+i+'/';
    const parent={Form1A:{[nested]:{GrossIncome:gross,IncomeTax:tax}},A21IncomeTaxWithheld:tax};
    if(i)parent.A21IncomeTaxUnderpaidOverpaidDueToAmendment=-3;
    revisions.push({path:path+'induk.json',cap:{sumber:'sptisi',lengkap:true},pages:[{Payload:{FormData:JSON.stringify(parent)}}]},
      {path:path+'l1a.json',cap:{sumber:'sptisi',lengkap:true},pages:[{Payload:{Data:[{WithholdingSlipsNumber:'BUKTI-UJI',GrossIncome:gross,IncomeTax:tax}],TotalRecords:1}}]});
  }
  const demo=await createPackage({meta:{wp:{npwp:'0000000000000092',nama:'WP fiktif bukti potong'}},entries:revisions});
  await withholdingPage.goto('http://127.0.0.1:'+server.address().port+'/analisis/index.html');
  await withholdingPage.locator('#filePkg').setInputFiles({name:'uji-pembetulan-potong.zip',mimeType:'application/zip',buffer:Buffer.from(await demo.arrayBuffer())});
  await withholdingPage.getByText('Konsisten · Seluruh sidik jari yang diperiksa cocok.').waitFor();
  await withholdingPage.getByRole('navigation').getByRole('button',{name:'SPT',exact:true}).click();
  await withholdingPage.getByRole('table',{name:'Daftar SPT',exact:true}).getByRole('button',{name:'Buka'}).first().click();
  const drawer=withholdingPage.getByRole('dialog'),root=drawer.getByRole('table',{name:'Ringkasan induk',exact:true});
  await root.getByRole('cell',{name:'-3',exact:true}).waitFor();
  const slips=drawer.getByRole('table',{name:'Bukti pada lampiran versi ini'});
  await slips.getByRole('row').filter({has:withholdingPage.getByRole('cell',{name:'l1a',exact:true})}).getByRole('cell',{name:'110',exact:true}).waitFor();
  await drawer.getByRole('combobox',{name:'Versi',exact:true}).selectOption({label:'Normal'});
  await slips.getByRole('row').filter({has:withholdingPage.getByRole('cell',{name:'l1a',exact:true})}).getByRole('cell',{name:'140',exact:true}).waitFor();
  await drawer.getByRole('button',{name:'Tutup',exact:true}).click();
  await withholdingPage.getByRole('button',{name:'Ringkasan SPT',exact:true}).click();
  const monthly=withholdingPage.getByRole('table',{name:'Potong pungut',exact:true});
  await monthly.waitFor();
  assert.equal(await monthly.locator('tbody tr').count(),1);await monthly.getByRole('cell',{name:'110',exact:true}).waitFor();
  await monthly.getByRole('cell',{name:'Pembetulan 1',exact:true}).waitFor();
  const downloads=withholdingPage.waitForEvent('download');
  await monthly.locator('xpath=ancestor::*[contains(@class,"table-panel")][1]').getByRole('button',{name:'Excel bagian ini'}).click();
  const exportFile=await downloads,exportBook=await readZip(await readFile(await exportFile.path()));
  const financialSheet=decodeText(exportBook.get('xl/worksheets/sheet1.xml').data);
  assert.match(financialSheet,/<v>110<\/v>/);assert.doesNotMatch(financialSheet,/<v>140<\/v>/);assert.ok(financialSheet.includes(nested));
  await withholdingPage.close();assert.deepEqual(errors,[]);
  console.log('SPT UI passed: 4 fictitious archives, 5 form types, annexes, content search, selected and combined export, print, revisions, reporting calendar and 16 VAT columns.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
