import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPackage,sha256} from '../extension/archive/package.js';
import {createXlsx} from '../extension/archive/table.js';
import {decodeText,readZip,writeZip} from '../extension/archive/zip.js';
import {annexDoc,headers,owner,portalEntry,portalRow} from './appportal-fixture.mjs';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=await mkdtemp(join(tmpdir(),'appportal-')),ext=resolve('extension');
const ctx=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,offline:true,acceptDownloads:true,
  executablePath:process.env.CHROMIUM_PATH||undefined,args:['--disable-extensions-except='+ext,'--load-extension='+ext]});
try{
  const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
  const page=await ctx.newPage(),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));ctx.on('request',req=>{if(/^https?:/.test(req.url()))external.push(req.url());});
  await page.goto(new URL('analisis/index.html',worker.url()).href);await page.locator('#role').selectOption('AR');
  const button=(s,root=page)=>root.getByRole('button',{name:s,exact:true});
  assert.equal(await button('Impor appportal').count(),0);await button('Mode pengembang').click();
  assert.equal(await button('Impor appportal').isDisabled(),true);
  const parts={PK:'a2',PM:'b2',PIB:'b1',PEB:'a1'},files={};
  const docs=Object.keys(parts).map((_,i)=>'040000000000000'+String(i+1));
  const entries=Object.entries(parts).map(([type,part],i)=>portalEntry(part,[annexDoc(docs[i])],{period:type==='PM'?'2025-02':'2025-01'}));
  entries.push(portalEntry('b3',[]),portalEntry('a2',[],{period:'2024-01'}));
  async function fixture(id,src){return {name:'Paket-uji.zip',mimeType:'application/zip',buffer:Buffer.from(await (await createPackage({meta:{wp:{npwp:id,nama:'Badan uji'}},entries:src})).arrayBuffer())};}
  const zip=await fixture(owner,entries);await page.locator('#filePkg').setInputFiles(zip);await button('Impor appportal').click();
  const input=()=>page.getByLabel('Pilih berkas appportal'),panel=n=>page.getByRole('heading',{name:n,exact:true}).locator('..');
  const upload=(name,text)=>({name,mimeType:'text/plain',buffer:Buffer.from(text)});
  for(const [i,type] of Object.keys(parts).entries()){
    const h=headers.slice();h[0]=['Nomor Faktur','Nomor Faktur','Nomor PIB','Nomor PEB'][i];h[3]=['NPWP Penjual','NPWP Pembeli','NPWP Importir','NPWP Eksportir'][i];
    h[4]=['DPP','DPP','Nilai pabean','Nilai ekspor'][i];
    const rows=[h,portalRow(docs[i])];const name=type+'-uji.csv',source=upload(name,rows.map(r=>r.join(';')).join('\n'));
    files[type]=source;await input().setInputFiles(source);const p=panel(name);
    await p.getByText('1 baris appportal dalam cakupan · 1 baris lampiran SPT · '+(type==='PM'?'B2 + B3':parts[type].toUpperCase()),{exact:true}).waitFor();
    const waiting=page.waitForEvent('download');await button('Excel rekonsiliasi',p).click();const download=await waiting;
    assert.equal(download.suggestedFilename(),'Rekonsiliasi-'+type+'-2025-'+owner+'.xlsx');
    const sheets=await page.evaluate(async(bytes)=>{
      const {readXlsx}=await import('../archive/read-table.js');return readXlsx(Uint8Array.from(bytes));
    },Array.from(await readFile(await download.path())));
    assert.deepEqual(sheets.map(s=>s.name),['Daftar Isi',...['Info','Ringkasan','Per masa','Rincian'].map(s=>s+' '+type)]);
    const sheet=key=>sheets.find(s=>s.name===key+' '+type);
    const info=Object.fromEntries(sheet('Info').rows);assert.equal(info.WP,owner);assert.equal(info.Peran,'AR');
    assert.equal(info['SHA-256 appportal'],await sha256(source.buffer));assert.match(info['Waktu ekspor'],/^\d{4}-\d{2}-\d{2}T/);
    assert.equal(sheet('Ringkasan').rows[1][1],1);assert.ok(sheet('Rincian').rows[1].includes(docs[i]));assert.ok(sheet('Rincian').rows[1].includes('Cocok'));
  }
  const pk=panel('PK-uji.csv');
  await pk.getByText('Pengaturan berkas dan pemetaan kolom',{exact:true}).click();await button('Simpan pemetaan',pk).click();
  await page.getByText('Pemetaan tersimpan untuk susunan kolom ini.').waitFor();
  await page.getByLabel('Tahun pajak appportal').selectOption('2024');await pk.getByText(/0 baris appportal dalam cakupan · 0 baris lampiran SPT/).waitFor();
  await page.getByLabel('Tahun pajak appportal').selectOption('2025');
  const workbook=await createXlsx({sheets:[{name:'Catatan',rows:[['Catatan contoh']]},{name:'Data',rows:[['Laporan'],headers,portalRow(docs[0])]}]});
  await input().setInputFiles({name:'PK-uji.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await workbook.arrayBuffer())});
  const x=panel('PK-uji.xlsx');await x.getByText('Pengaturan berkas dan pemetaan kolom',{exact:true}).click();await x.getByLabel('Lembar sumber').selectOption('1');
  assert.equal(await x.getByLabel('Baris judul kolom').inputValue(),'2');await button('Excel rekonsiliasi',x).waitFor();
  const serial=(Date.UTC(2025,0,5)-Date.UTC(1904,0,1))/86400000;
  const legacy=await createXlsx({sheets:[{name:'Data',rows:[['Nomor faktur','Tanggal','NPWP pemilik','DPP','PPN'],[docs[0],serial,owner,100,11]]}]});
  const entries1904=[];
  for(const [name,part] of await readZip(legacy)){
    let data=part.data;
    if(name==='xl/workbook.xml')data=decodeText(data).replace('<sheets>','<workbookPr date1904="1"/><sheets>');
    if(name==='xl/worksheets/sheet1.xml')data=decodeText(data).replace(/r="([A-Z]*)([12])"/g,(_,letters,n)=>'r="'+letters+(Number(n)*4)+'"');
    entries1904.push({name,data});
  }
  await input().setInputFiles({name:'PK-calendrier-1904.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer:Buffer.from(await (await writeZip(entries1904)).arrayBuffer())});
  const old=panel('PK-calendrier-1904.xlsx');await old.getByText('Pengaturan berkas dan pemetaan kolom',{exact:true}).click();
  assert.equal(await old.getByLabel('Baris judul kolom').inputValue(),'4');await button('Excel rekonsiliasi',old).waitFor();
  assert.equal(await old.getByRole('cell',{name:'8',exact:true}).count(),1);
  const foreign=upload('PK-campur.csv',[headers,portalRow(docs[0]),portalRow('X','0','0','2024','01','0000000000000042')].map(r=>r.join(';')).join('\n'));
  await input().setInputFiles(foreign);const rejected=panel(foreign.name);await rejected.getByText(/NPWP pemilik berbeda/).waitFor();
  assert.equal(await button('Excel rekonsiliasi',rejected).count(),0);
  const html=upload('PM-lama.xls','<img src="https://image.invalid/not-loaded"><iframe src="https://frame.invalid/not-loaded"></iframe><script>window.portalUnsafe=true</script>'+
    '<table><tr><th>Nomor dokumen</th><th>Masa</th><th>Tahun</th><th>DPP</th><th>PPN</th></tr><tr><td>'+docs[1]+'</td><td>01</td><td>2025</td><td>100</td><td>11</td></tr></table>');
  await input().setInputFiles(html);const h=panel(html.name);await h.getByText(/Cocokkan WP pemilik berkas/).waitFor();
  await h.getByRole('checkbox',{name:/Saya sudah/}).check();await button('Excel rekonsiliasi',h).waitFor();
  await button('Hapus berkas appportal',h).click();assert.equal(await h.count(),0);
  await button('Muat paket').click();const other='0000000000000042';
  await page.locator('#filePkg').setInputFiles(await fixture(other,[portalEntry('a2',[],{npwp:other})]));
  await page.waitForFunction(id=>document.querySelector('#taxpayer option:checked')?.textContent.includes(id),other);await button('Impor appportal').click();
  await page.getByText('Belum ada berkas appportal untuk paket ini.').waitFor();
  assert.equal(await pk.count(),0);
  await page.locator('#taxpayer').selectOption({index:0});await button('Excel rekonsiliasi',pk).waitFor();
  await button('Muat paket').click();await button('Mode pengembang').click();assert.equal(await button('Impor appportal').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(await page.evaluate(()=>window.portalUnsafe),undefined);
  if(process.env.VERITAX_STUDIO){
    const ref=await ctx.newPage(),url=pathToFileURL(resolve(process.env.VERITAX_STUDIO)).href;
    await ref.goto(url);const start=ref.getByRole('dialog').getByRole('button',{name:'Mulai',exact:true});if(await start.isVisible())await start.click();
    const tab=ref.locator('#tabs [data-tab=impor]');assert.equal(await tab.isVisible(),false);
    await ref.goto(url+'#pengembang');assert.equal(await tab.isVisible(),true);assert.equal(await tab.isEnabled(),false);
    await ref.locator('#peranSel').selectOption('ar');await ref.locator('#filePkg').setInputFiles(zip);await tab.click();
    for(const type of Object.keys(parts)){
      await ref.locator('#v-impor #fileImp').setInputFiles(files[type]);
      const refPanel=ref.locator('#v-impor'),exportButton=refPanel.getByRole('button',{name:'Excel rekonsiliasi',exact:true});
      await ref.locator('#v-impor').getByText(new RegExp(type+'-uji\\.csv')).last().waitFor();
      const settings=refPanel.getByText('Pengaturan berkas & pemetaan kolom',{exact:true}),typeInput=refPanel.locator('select[data-k=type]');
      if(!await typeInput.isVisible())await settings.click();
      if(await typeInput.inputValue()!==type)await typeInput.selectOption(type);
      const baseField=({PIB:'nilaiPabean',PEB:'nilaiEkspor'})[type]||'dpp';
      for(const [key,index] of [['nomor','0'],[baseField,'4'],['ppn','5']]){
        const column=refPanel.locator('select[data-f='+key+']');
        if(!await column.count())continue;
        if(!await column.isVisible())await settings.click();
        if(await column.inputValue()!==index)await column.selectOption(index);
      }
      const waiting=ref.waitForEvent('download');await exportButton.click();const file=await waiting;
      const sheets=await page.evaluate(async bytes=>(await import('../archive/read-table.js')).readXlsx(Uint8Array.from(bytes)),Array.from(await readFile(await file.path())));
      assert.deepEqual(sheets.map(s=>s.name),['Info','Ringkasan','Per masa','Rincian'].map(s=>s+' '+type));
      assert.ok(sheets[3].rows.some(r=>r.includes(docs[Object.keys(parts).indexOf(type)])&&r.some(v=>String(v).toLowerCase()==='cocok')),type+' document matches');
      ref.once('dialog',dialog=>dialog.accept());await refPanel.getByRole('button',{name:'Hapus',exact:true}).click();
      await exportButton.waitFor({state:'hidden'});
    }
    console.log('Studio 1.32.0 offline: developer gate, four worksheet names, matching record for each of PK/PM/PIB/PEB.');
  }
  console.log('V2 offline: four types, 16 exported sheets, taxpayer isolation, years, XLSX/CSV/HTML, source hashes, currency and text identifiers.');
}finally{await ctx.close();await rm(dir,{recursive:true,force:true});}
