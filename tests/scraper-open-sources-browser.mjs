import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPackage} from '../extension/archive/package.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const extension=process.env.EXTENSION_DIR||fileURLToPath(new URL('../extension/',import.meta.url));
const origin='https://coretax.intranet.pajak.go.id',wp='0000000000000017',other='0000000000000018';
const addr=k=>origin+'/simulasi-lokal-'+k;
function table(id,title,labels,rows,extra=''){
  return '<section class="p-datatable">'+extra+'<table id="'+id+'"><caption>'+title+'</caption><thead><tr>'+labels.map(h=>'<th>'+h+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></section>';
}
const bank=table('bank','Rekening bank',['NPWP Wajib Pajak','BankCode','BankAccountNumber'],[[wp,'BANK-UJI','000912']]);
const taxFlags=table('flag','Penanda WP',['NPWP Wajib Pajak','FlagType','FlagValue'],[[wp,'DUMMY',1]]);
const classes=table('klu','Klasifikasi lapangan usaha',['NPWP Wajib Pajak','TradeClassificationCode','ActivityDescription'],[[wp,'01111','Usaha fiktif']],
  '<input type="search" value="contoh" aria-label="Cari klasifikasi">');
const ledgerLabels=['NPWP Wajib Pajak','PeriodCode','PostingDate','Amount','ReferenceNumber'];
const journal=table('bb','Buku besar',ledgerLabels,[[wp,'01012025','2025-01-22','5','TRANS-01'],[wp,'02022025','2025-02-19','7','TRANS-02']]);
const variants=[
  bank+classes+journal,
  bank+table('foreign','Rekening bank',['NPWP Wajib Pajak','BankAccountNumber'],[[other,'WRONG-OWNER']])+
    table('unclear','Alamat dan tempat kegiatan usaha',['NPWP pihak terkait','AddressDetail'],[[wp,'WRONG-FIELD']])+
    table('unrelated','Rekening bank',['NPWP Wajib Pajak','Uraian'],[[wp,'WRONG-SHAPE']])+
    table('old','Buku besar',ledgerLabels,[[wp,'01012024','2024-01-01','2','WRONG-YEAR']])+
    table('conflictingyear','Buku besar',[...ledgerLabels,'Tahun pajak'],[[wp,'02022025','2025-01-01','3','WRONG-MONTH-YEAR','2024']])+taxFlags,
  table('flag2','Penanda WP',['NPWP Wajib Pajak','FlagType','FlagValue'],[[wp,'DUMMY',2]])
];
const catalogueRows=[
  ['info','Informasi umum WP',['TaxpayerName','TaxpayerType'],['Badan simulasi','CORPORATE']],
  ['pihak','Pihak terkait',['PersonName','BusinessRoleType'],['Pihak simulasi','SIM']],
  ['bank','Rekening bank',['BankAccountNumber'],['000912']],
  ['flag','Penanda WP',['FlagType','FlagValue'],['SIM','true']],
  ['jenispajak','Registrasi jenis pajak',['TaxTypeCode','RegistrationDate'],['SIM','2020-01-01']],
  ['alamat','Alamat dan tempat kegiatan usaha',['AddressDetail','TypeOfAddress'],['Alamat simulasi','SIM']],
  ['klu','Klasifikasi lapangan usaha',['TradeClassificationCode','ActivityDescription'],['01111','Simulasi']],
  ['nomorlain','Nomor identitas lain',['IdentificationNumberType','IdentificationNumber'],['SIM','0003']],
  ['sertel','Sertifikat elektronik',['CertificateNumber','ValidFrom'],['SIM-4','2023-05-05']],
  ['pbb','Objek tanah dan bangunan',['TaxObjectNumber','LandArea'],['SIM-5','5']],
  ['dokumen','Daftar dokumen WP',['DocumentTitle','DocumentNumber'],['Dokumen simulasi','SIM-6']],
  ['bb','Buku besar per masa',['Amount','PostingDate','TaxPeriodCode','Tahun pajak'],['10','2025-03-02','03032025','2025']],
  ['bbtotal','Total pembanding buku besar',['Debit','Credit','Balance','PeriodCode'],['10','3','7','03032025']]
];
const catalogueHtml=catalogueRows.map(([id,title,columns,values])=>table(id,title,['NPWP pemilik',...columns],[[wp,...values]])).join('');
const profile=await mkdtemp(path.join(tmpdir(),'scv2-previewsources-'));let ctx;
try{
  ctx=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,acceptDownloads:true,
    args:['--disable-background-networking','--disable-extensions-except='+extension,'--load-extension='+extension]});
  const unexpected=[];await ctx.route(/^https?:\/\//,r=>{
    const url=r.request().url(),ix=variants.findIndex((_,i)=>url===addr(i));
    if(ix>=0)return r.fulfill({contentType:'text/html; charset=utf-8',body:variants[ix]});
    if(url===addr('catalogue'))return r.fulfill({contentType:'text/html; charset=utf-8',body:catalogueHtml});
    if(url!==origin+'/favicon.ico')unexpected.push(r.request().method());return r.abort();
  });
  const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker'),tabs=[];
  for(const [i] of variants.entries()){const t=await ctx.newPage();await t.goto(addr(i));tabs.push(t);}
  const ui=await ctx.newPage();ui.setDefaultTimeout(8000);await ui.goto(new URL('app.html',worker.url()).href);
  await ui.locator('#ids').fill(wp);await ui.locator('#officer').fill('Penguji fiktif');
  for(const id of ['start','end'])await ui.locator('#year-'+id).selectOption('2025');
  await ui.locator('#month-start').selectOption('01');await ui.locator('#month-end').selectOption('03');
  for(const input of await ui.locator('#sources input').all())await input.setChecked(['bank','klu','alamat','bb','flag'].includes(await input.inputValue()));
  await ui.locator('#consent').check();await ui.locator('#preview').click();
  if(process.env.EXPECT_0110){
    await ui.locator('#notice').getByText(/Tambahkan tabel atau berkas/).waitFor();assert.equal(await ui.locator('#queue .item').count(),0);
    console.log('Reproduced 0.11.0 with three synthetic source tabs open: preview requested manual table or export.');
  }else{
    const box=ui.locator('#other-preview'),add=box.getByRole('button',{name:'Tambahkan sumber terverifikasi'});await add.waitFor();
    assert.equal(await ui.locator('#queue .item').count(),0);await box.getByText(/Salinan identik/).first().waitFor();
    await box.getByText(/beberapa tampilan berbeda/i).first().waitFor();await box.getByText(/filter aktif/i).first().waitFor();
    await tabs[0].locator('#klu tbody tr td').last().evaluate(el=>el.textContent='Berubah setelah pratinjau');
    await tabs[1].locator('#bank tbody tr td').last().evaluate(el=>el.textContent='REPLACED');
    await add.click();await ui.locator('#preview-box').getByRole('table',{name:'Pratinjau penarikan'}).waitFor();
    await box.getByText(/berubah/i).first().waitFor();assert.equal(await ui.locator('#queue .item').count(),2);
    await tabs[1].locator('#bank tbody tr td').last().evaluate(el=>el.textContent='000912');
    await ui.locator('#preview').click();await add.waitFor();await add.click();
    await ui.waitForFunction(()=>document.querySelectorAll('#queue .item').length===4);
    await ui.locator('#preview').click();await box.getByText(/Sudah ada di antrean/i).first().waitFor();assert.equal(await ui.locator('#queue .item').count(),4);
    await ui.locator('#start').click();await ui.getByRole('button',{name:'Unduh paket'}).first().click();
    const [download]=await Promise.all([ui.waitForEvent('download'),ui.locator('#package-dialog button[value=ok]').click()]);
    const pkg=await readPackage(await readFile(await download.path()));assert.ok(pkg.report.valid);assert.equal(pkg.manifest.wp.npwp,wp);
    const byPath=new Map(pkg.entries.map(e=>[e.path,e]));assert.deepEqual([...byPath.keys()].sort(),['bukubesar/2025-01.json','bukubesar/2025-02.json','profil/klu.json','profil/rekening-bank.json']);
    for(const e of byPath.values()){assert.equal(e.cap.lengkap,false);assert.equal(e.pages.length,1);}
    assert.equal(byPath.get('profil/rekening-bank.json').pages[0].Payload.Data[0].BankAccountNumber,'000912');
    assert.equal(byPath.get('profil/klu.json').cap.halamanSumber[0].pencocokan.pratinjauSumber.filterAktif,true);
    assert.equal(byPath.get('bukubesar/2025-02.json').pages[0].Payload.Data[0].ReferenceNumber,'TRANS-02');
    assert.ok(!JSON.stringify(pkg.entries).includes('WRONG-'));
    const handoff=ctx.waitForEvent('page');await ui.getByRole('button',{name:'Buka di Analisis'}).first().click();
    const viewer=await handoff;await viewer.getByText(/4 berkas diperiksa/).first().waitFor();
    await viewer.locator('#navigation').getByRole('button',{name:'Profil WP',exact:true}).click();
    await viewer.getByRole('button',{name:'Rekening bank (1)',exact:true}).click();
    await viewer.getByRole('cell',{name:'000912',exact:true}).first().waitFor();
    await viewer.getByRole('button',{name:'Klasifikasi lapangan usaha (1)',exact:true}).click();
    await viewer.getByRole('cell',{name:'Berubah setelah pratinjau',exact:true}).first().waitFor();
    await viewer.locator('#navigation').getByRole('button',{name:'Data mentah',exact:true}).click();
    await viewer.getByRole('button',{name:'Buku besar gabungan',exact:true}).click();
    await viewer.getByRole('cell',{name:'TRANS-01',exact:true}).first().waitFor();
    await viewer.getByRole('cell',{name:'TRANS-02',exact:true}).first().waitFor();
    for(const t of tabs)await t.close();
    const full=await ctx.newPage();await full.goto(addr('catalogue'));
    await ui.reload();await ui.locator('#officer').fill('Penguji fiktif');
    await ui.locator('#ids').fill(wp);
    for(const id of ['start','end'])await ui.locator('#year-'+id).selectOption('2025');
    await ui.locator('#month-start').selectOption('01');await ui.locator('#month-end').selectOption('03');
    const wanted=new Set(catalogueRows.map(([source])=>source));
    for(const input of await ui.locator('#sources input').all())await input.setChecked(wanted.has(await input.inputValue()));
    await ui.locator('#consent').check();await ui.locator('#preview').click();await add.click();
    await ui.waitForFunction(()=>document.querySelectorAll('#queue .item').length===13);
    await ui.locator('#start').click();await ui.getByRole('button',{name:'Unduh paket'}).first().click();
    const [allDownload]=await Promise.all([ui.waitForEvent('download'),ui.locator('#package-dialog button[value=ok]').click()]);
    const all=await readPackage(await readFile(await allDownload.path()));
    assert.ok(all.report.valid);assert.equal(all.entries.length,13);assert.deepEqual(new Set(all.entries.map(e=>e.cap.sumber)),wanted);
    for(const e of all.entries){
      const [, ,fields,values]=catalogueRows.find(([source])=>source===e.cap.sumber);
      assert.equal(e.cap.lengkap,false);assert.equal(e.cap.baris,1);assert.equal(e.pages.length,1);
      assert.deepEqual(e.pages[0].Payload.Data,[Object.fromEntries(['NPWP pemilik',...fields].map((k,i)=>[k,[wp,...values][i]]))]);
    }
    assert.ok(all.entries.some(e=>e.path==='bukubesar/2025-03.json'));assert.ok(all.entries.some(e=>e.path==='bukubesar-total/2025-03.json'));
    const allHandoff=ctx.waitForEvent('page');await ui.getByRole('button',{name:'Buka di Analisis'}).first().click();
    const allViewer=await allHandoff;await allViewer.getByText(/13 berkas diperiksa/).first().waitFor();
    console.log('PASS: one-WP multi-source preview, owner/month/shape validation, copies, conflicts and changed rows; 4-file and 13-category archives verified in the viewer.');
  }
  assert.deepEqual(unexpected,[]);
}finally{await ctx?.close();await rm(profile,{recursive:true,force:true});}
