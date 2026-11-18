import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {readPackage} from '../extension/archive/package.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const temp=await mkdtemp(path.join(tmpdir(),'scv2-spt-nav-'));
const extension=fileURLToPath(new URL('../extension/',import.meta.url));
const base='https://coretax.intranet.pajak.go.id',wp='0000000000000001';
const submitted=base+'/returnsheets/id-ID/submitted-returnsheets/00000000-0000-4000-8000-000000000001';
const detailAddress=base+'/__synthetic__/read-spt';
const sidebar='<aside><div><b>'+wp+'</b><div>Perusahaan Fiktif</div></div><ul><li><a href="'+submitted+'">SPT Dilaporkan</a></li>'+
  '<li><a href="/registration/id-ID/general-information/00000000-0000-4000-8000-000000000001">Informasi Umum Wajib Pajak</a></li>'+
  '<li><a href="/returnsheets/id-ID/taxpayer-search">Pilih Wajib Pajak Lain</a></li></ul></aside>';
const headings=['','Jenis Pajak','Jenis Surat Pemberitahuan Pajak','Masa Pajak','Model SPT','Status SPT','ID SPT','Nomor Bukti Penerimaan'];
const values=['PPN','SPT Masa PPN','Januari 2025','Normal','Dilaporkan','test-document','TEST-RECEIPT'];
const identity='<dl>'+[['NPWP Wajib Pajak',wp],['Jenis SPT','SPT Masa PPN'],['Masa Pajak','Januari 2025'],['Model SPT','Normal'],
  ['ID SPT','test-document'],['Nomor Bukti Penerimaan','TEST-RECEIPT']]
  .map(([k,v])=>'<dt>'+k+'</dt><dd>'+v+'</dd>').join('')+'</dl>';
const detail='<main>'+identity+'<section aria-label="Induk SPT"><dl><dt>Keterangan</dt><dd>Contoh fiktif</dd></dl></section>'+
  '<button type="button" role="tab" aria-controls="a1" onclick="document.getElementById(\'a1\').hidden=false">Lampiran A1</button>'+
  '<section id="a1" role="tabpanel" hidden aria-label="Lampiran A1"><table><thead><tr><th>Jenis barang</th><th>Jumlah</th></tr></thead>'+
  '<tbody><tr><td>Contoh fiktif</td><td>7</td></tr></tbody></table></section></main>';
function listPage(mode) {
  const open=' onclick="document.body.innerHTML=document.querySelector(\'template\').innerHTML"';
  const other=['SendEmailButton','ViewReceiptButton','SubmittedDownloadPdfButton','RequestDownloadPdfButton']
    .map(id=>'<button id="'+id+'" type="button" aria-label="'+id+'" onclick="document.body.dataset.wrong=1"></button>').join('');
  const options={
    id:'<button type="button" id="ViewButton"'+open+'><i></i></button>',
    labelled:'<button type="button" aria-labelledby="read-name"'+open+'></button>',
    icon:'<button type="button"'+open+'><svg><title>ViewButton</title></svg></button>',
    title:'<button type="button" title="ViewButton"'+open+'></button>',
    native:'<input type="button" value="ViewButton"'+open+'>',
    standardized:'<button type="button" aria-label="ViewButton"'+open+'></button>',
    blocked:'<button id="ViewReceiptButton" type="button" aria-label="ViewButton" onclick="document.body.dataset.wrong=1"></button>',
    misleading:'<button id="ViewButton" type="button" aria-label="RequestDownloadPdfButton" onclick="document.body.dataset.wrong=1"></button>',
    ambiguous:'<button type="button" aria-label="Lihat SPT"'+open+'></button><button type="button" title="ViewButton"'+open+'></button>',
    disabled:'<button type="button" aria-disabled="true" aria-label="ViewButton"'+open+'></button>',
    submit:'<button type="submit" aria-label="ViewButton" onclick="document.body.dataset.wrong=1"></button>',
    onlyOther:''
  };
  const action=Object.hasOwn(options,mode)?options[mode]+other:['link','self'].includes(mode)?
    '<a href="'+detailAddress+'" target="'+(mode==='link'?'_blank':'_self')+'" aria-label="Lihat SPT">Lihat SPT</a>':
    '<button type="button" '+(mode==='anonymous'?'':'aria-label="Lihat SPT"')+open+'><i></i></button>';
  return '<title>Daftar fiktif</title>'+sidebar+'<table id="idx"><thead><tr>'+headings.map(v=>'<th>'+v+'</th>').join('')+
    '</tr></thead><tbody><tr><td>'+action+'</td>'+values.map(v=>'<td>'+v+'</td>').join('')+'</tr></tbody></table>'+
    '<span hidden id="read-name">ViewButton</span><template>'+detail+'</template>';
}
let context;
try {
  context=await chromium.launchPersistentContext(temp,{channel:'chromium',headless:true,
    executablePath:process.env.CHROMIUM_PATH || undefined,args:['--disable-extensions-except='+extension,'--load-extension='+extension],acceptDownloads:true});
  let mode='link';
  await context.route(/^https?:\/\//,route=>{
    const url=route.request().url();
    if(url===submitted || url===detailAddress) return route.fulfill({contentType:'text/html; charset=utf-8',body:url===submitted?listPage(mode):detail});
    return route.abort();
  });
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const appOrigin=new URL(worker.url()).href.replace(/\/[^/]*$/,'');
  const source=await context.newPage(),ui=await context.newPage();
  await source.goto(submitted);await ui.goto(appOrigin+'/app.html');
  await ui.getByText('1 tab Coretax tersedia').waitFor();
  await ui.locator('#ids').fill(wp);await ui.locator('#officer').fill('Penguji Fiktif');
  await ui.locator('#year-start').selectOption('2025');await ui.locator('#year-end').selectOption('2025');
  await ui.locator('#month-start').selectOption('01');await ui.locator('#month-end').selectOption('12');
  await ui.locator('#sources input[value=sptdaftar]').check();await ui.locator('#sources input[value=sptisi]').check();
  await ui.locator('#source').selectOption('sptdaftar');await ui.locator('#scope-ok').check();
  await ui.locator('#list-tables').click();await ui.locator('#add-table').click();
  await ui.locator('#consent').check();await ui.locator('#preview').click();
  await ui.getByText('Rincian versi SPT dan bagian yang tersedia').click();
  const open=ui.getByRole('button',{name:'Cari tampilan SPT'}),save=ui.getByRole('button',{name:'Tambahkan bagian tampak'});
  const newTab=context.waitForEvent('page');await open.click();const detailTab=await newTab;
  await save.waitFor();await ui.getByLabel('Bagian SPT pada sumber').selectOption('a1');await save.click();
  await ui.getByText('1 baris ditambahkan sebagai cuplikan satu halaman.').waitFor();
  await save.click();await ui.getByText('Cuplikan yang sama sudah ada dalam antrean.').waitFor();
  const tbody=detailTab.locator('#a1 tbody');
  await tbody.evaluate(el=>el.insertAdjacentHTML('beforeend','<tr><td>Baris kedua fiktif</td><td>9</td></tr>'));
  await save.click();await ui.getByText(/Isi bagian berubah/).waitFor();
  await tbody.locator('tr').last().evaluate(el=>el.remove());
  await tbody.locator('td').last().evaluate(el=>el.textContent='99');
  const expectedQueueSize=await ui.locator('#queue .item').count()+1;
  await save.click();await ui.getByText(/Isi bagian berubah/).waitFor();
  await ui.waitForFunction(size=>document.querySelectorAll('#queue .item').length===size,expectedQueueSize);
  await detailTab.locator('dd').first().evaluate(el=>el.innerText='0000000000000002');
  await save.click();await ui.getByText(/Identitas WP atau dokumen berubah/).waitFor();
  await detailTab.close();
  for(mode of ['anonymous','onlyOther','blocked','misleading','ambiguous','disabled','submit']){
    await source.reload();await open.click();
    await ui.getByText(/belum memiliki satu tombol lihat/).waitFor();
    assert.equal(await source.locator('#idx').count(),1);
    assert.equal(await source.locator('body').getAttribute('data-wrong'),null);
  }
  for(mode of ['id','labelled','icon','title','native','standardized']){
    await source.reload();await open.click();await source.locator('main dl').first().waitFor();
    await save.waitFor();assert.equal(await source.locator('body').getAttribute('data-wrong'),null);
  }
  mode='spa';await source.reload();await open.click();await save.waitFor();await save.click();
  await ui.getByText('1 baris ditambahkan sebagai cuplikan satu halaman.').waitFor();
  mode='self';await source.goto(submitted);await open.click();await save.waitFor();
  assert.equal(source.url(),detailAddress);
  await ui.locator('#start').click();
  const downloadControl=ui.getByRole('button',{name:'Unduh paket'}).first();
  await downloadControl.waitFor();await downloadControl.click();
  const event=ui.waitForEvent('download');await ui.locator('#package-dialog').getByRole('button',{name:/^Unduh/}).click();
  const file=await event;
  const pkg=await readPackage(await readFile(await file.path()));
  assert.ok(pkg.report.valid);
  const saved=pkg.entries.filter(e=>e.cap.sumber==='sptisi');
  assert.equal(saved.length,4);
  assert.ok(saved.every(e=>!e.cap.lengkap && e.cap.konteks.cuplikanTampilan && e.cap.konteks.spt.recordId==='test-document'));
  const primary=saved.find(e=>e.path.startsWith('spt/') && e.path.endsWith('/a1.json'));
  assert.deepEqual(primary.pages[0].Payload.Data,[{'Jenis barang':'Contoh fiktif',Jumlah:'7'}]);
  assert.deepEqual(primary.cap.cuplikanSpt.pembanding.map(path=>saved.find(e=>e.path===path).cap.baris),[2,1]);
  assert.deepEqual(saved.find(e=>e.path.endsWith('/induk.json')).pages[0].Payload.Data,[{Keterangan:'Contoh fiktif'}]);
  console.log('PASS: one assigned taxpayer, normal link opening a new tab, same-tab detail, document revalidation, named form tabs, partial capture and matching archive rows.');
} finally {
  await context?.close();await rm(temp,{recursive:true,force:true});
}
