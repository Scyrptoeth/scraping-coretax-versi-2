import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readPackage} from '../extension/archive/package.js';
import {decodeText,readZip} from '../extension/archive/zip.js';
import {indexPackage} from '../extension/analisis/model.js';

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
      await table.getByRole('row').filter({has:page.getByRole('cell',{name:form.period,exact:true})})
        .filter({has:page.getByRole('cell',{name:form.version?'Pembetulan '+form.version:'Normal',exact:true})}).getByRole('button',{name:'Buka'}).click();
      const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'Induk',exact:true}).waitFor();
      const part=dialog.getByRole('combobox',{name:'Induk / lampiran'});assert.equal(await part.locator('option').count(),form.parts.size);
      const keyword={PPN:'VATUnderOrOverPaid',PPH2126:'A21IncomeTaxWithheld',UNIFIKASI:'TotalWithholding',BADAN:'MainFormData',OP:'UnderOrOverPaymentTax'}[kind];
      await dialog.getByRole('searchbox',{name:'Cari di seluruh bagian SPT'}).fill(keyword);
      const hits=dialog.getByRole('table',{name:'Hasil pencarian formulir'});await hits.getByRole('button',{name:'Buka'}).first().click();
      await dialog.getByRole('table',{name:'Induk'}).waitFor();
      const annex=[...form.parts.keys()].find(k=>k!=='induk');
      assert.ok(annex);await part.selectOption(annex);
      await dialog.getByRole('button',{name:'Kode field & lampiran lengkap'}).click();
      assert.equal(await part.inputValue(),annex);
      const selected=page.waitForEvent('download');await dialog.getByRole('button',{name:'Excel data mentah'}).click();
      const download=await selected;const wb=await readZip(await readFile(await download.path()));
      const sheets=decodeText(wb.get('xl/workbook.xml').data);
      assert.equal((sheets.match(/<sheet /g)||[]).length,form.parts.size);
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
  console.log('SPT UI passed: 4 fictitious archives, 5 form types, annexes, content search, selected and combined export, print, revisions, reporting calendar and 16 VAT columns.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
