import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {visibleTables} from '../extension/app-data.js';
import {readPackage} from '../extension/archive/package.js';
import {indexPackage,rowsOf} from '../extension/analisis/model.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=new URL('../extension/',import.meta.url);
const server=createServer(async(req,res)=>{
  try{
    const url=new URL('.'+new URL(req.url,'http://localhost').pathname,base);
    if(!url.href.startsWith(base.href))throw Error('Invalid path');
    const body=await readFile(url);
    res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html');
    res.end(body);
  }catch{res.statusCode=404;res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const local='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined});
try{
  const wp='0000000000000001',other='0000000000000002';
  function table(title,columns,rows,id){
    return '<table id="'+id+'"><caption>'+title+'</caption><thead><tr>'+columns.map(c=>'<th>'+c+'</th>').join('')+
      '</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
  }
  const first=await browser.newPage(),second=await browser.newPage(),client=await browser.newPage();
  const placeholder='<table id="empty"><thead><tr>'+
    Array.from({length:18},(_,i)=>'<th>'+(i===0?'':'Kolom '+i)+'</th>').join('')+'</tr></thead><tbody><tr class="ng-star-inserted"><td colspan="18">Tidak ada data yang ditemukan.</td></tr></tbody></table>';
  const cases='<table id="cases"><caption>Daftar kasus aktif</caption><thead>'+
    '<tr><th rowspan="2">Nomor Kasus</th><th colspan="2">Wajib Pajak</th><th rowspan="2">Ditangguhkan</th><th rowspan="2">Diterima</th><th rowspan="2"></th></tr>'+
    '<tr><th>NPWP Wajib Pajak Pusat</th><th>Status</th></tr>'+
    '<tr><th><input aria-label="Cari"></th><th><input></th><th><select><option>Semua</option></select></th><th></th><th></th><th></th></tr></thead>'+
    '<tbody><tr><td>FIKTIF-001</td><td>'+wp+'</td><td>Aktif<input type="checkbox" disabled></td><td><input type="checkbox" disabled></td>'+
    '<td><span style="display:inline-block;width:12px;height:12px" role="checkbox" aria-checked="true"></span></td><td><input type="checkbox"></td></tr></tbody></table>';
  await first.setContent(table('Rekening bank',['NPWP','Kode rekening'],[[wp,'00012']],'bank')+
    table('KLU',['NPWP','TradeClassificationCode'],[[wp,'01111']],'klu')+placeholder+cases);
  const ledgerRows=[[wp,'2025-01','0'],[wp,'2025-01','Tidak ada data yang ditemukan.']];
  await second.setContent(table('Buku besar',['NPWP','Masa Pajak','Nilai'],ledgerRows,'ledger')+
    table('Buku besar',['NPWP','Masa Pajak','Nilai'],[[wp,'2024-01','10']],'old')+
    table('Rekening bank',['NPWP','Kode rekening'],[[wp,'1'],[other,'2']],'mixed')+
    table('Buku besar',['NPWP','Masa Pajak','Nilai'],[[wp,'2025-01','OMIT-ME']],'shiftperiod')+
    '<button aria-controls="ledger" aria-label="Halaman berikutnya">Berikutnya</button>'+
    '<button aria-controls="shiftperiod" aria-label="Halaman berikutnya">Berikutnya</button>');
  await second.evaluate(()=>{
    for(const button of document.querySelectorAll('button[aria-controls]')) {
      const id=button.getAttribute('aria-controls');
      button.onclick=()=>{
        const row=document.querySelector('#'+id+' tbody tr');
        if(id==='shiftperiod') {row.cells[1].textContent='2023-01';button.disabled=true;}
        else {row.cells[2].textContent='200';row.parentElement.lastElementChild.remove();}
      };
    }
  });
  const pages=new Map([[1,first],[2,second]]);
  const countries={1:'https://coretax.intranet.pajak.go.id/fiktif-profil',2:'https://coretax.intranet.pajak.go.id/fiktif-buku-besar'};
  await client.exposeFunction('readTab',({tabId,request})=>{
    const p=pages.get(tabId);return p.evaluate(visibleTables,request?{...request,url:p.url()}:null);
  });
  await client.addInitScript(({urls})=>{
    const tabs=Object.entries(urls).map(([id,url])=>({id:Number(id),url,title:'Fiktif'}));
    window.chrome={runtime:{id:'pengujian'},tabs:{query:async()=>tabs,get:async id=>tabs.find(tab=>tab.id===id)},
      scripting:{executeScript:async spec=>[{result:await window.readTab({tabId:spec.target.tabId,request:spec.args[0]})}]}};
  },{urls:countries});
  await client.goto(local+'/app.html');
  await client.getByText('Belum ada hasil penarikan.').waitFor();
  await client.locator('#ids').fill(wp);await client.locator('#officer').fill('Petugas Fiktif');
  await client.locator('#year-start').selectOption('2025');await client.locator('#year-end').selectOption('2025');
  await client.locator('#scope-ok').check();await client.locator('#batch summary').click();await client.locator('#batch-scan').click();
  await client.locator('#batch-status').filter({hasText:'7 tabel berisi data'}).waitFor();
  await client.locator('#batch-page-limit').fill('2');
  await client.getByRole('combobox',{name:'Sumber Tab 1 · Daftar kasus aktif · 1 baris',exact:true}).selectOption('tabelumum');
  await client.locator('#batch-rows .batch-row').filter({hasText:'Daftar kasus aktif'}).locator('input[type=checkbox]').check();
  await client.locator('#batch-add').click();await client.locator('#batch-status').filter({hasText:'4 tabel masuk antrean, 3 dilewati'}).waitFor();
  await client.locator('#batch-rows').getByText('Masuk antrean · 2 halaman · 3 baris · masih ada halaman berikutnya').waitFor();
  assert.equal(await client.locator('#queue .item').count(),4);
  assert.equal(await client.locator('#batch-rows').getByText('Identitas WP di setiap baris belum cocok.').count(),1);
  assert.equal(await client.locator('#batch-rows').getByText('Masa pada baris belum tersedia atau di luar pilihan.').count(),2);
  await client.locator('#list-tables').click();await client.locator('#table').selectOption('2');await client.locator('#add-table').click();
  await client.locator('#notice').getByText('Tabel kosong. Belum ada baris yang dapat ditambahkan.').waitFor();
  await client.locator('#consent').check();await client.locator('#start').click();await client.locator('#results').getByText('Unduh paket').click();
  const next=client.waitForEvent('download');await client.locator('#package-dialog button[value=ok]').click();
  const pkg=await readPackage(await readFile(await (await next).path()));
  assert.ok(pkg.report.valid);assert.deepEqual(pkg.entries.filter(e=>!e.path.startsWith('tabel/')).map(e=>e.path).sort(),['bukubesar/2025-01.json','profil/klu.json','profil/rekening-bank.json']);
  const generic=pkg.entries.find(e=>e.path.startsWith('tabel/'));
  assert.deepEqual(rowsOf(generic),[{'Nomor Kasus':'FIKTIF-001','NPWP Wajib Pajak Pusat':wp,Status:'Aktif',Ditangguhkan:'false',Diterima:'true','Kolom 6':''}]);
  assert.equal(generic.cap.konteks.periode,null);
  assert.ok(pkg.manifest.opsi.periode.from.y===2025);
  const ledger=pkg.entries.find(e=>e.path.startsWith('bukubesar/'));
  const lastPage=await second.locator('#ledger tbody tr').evaluateAll(rows=>rows.map(r=>[...r.cells].map(c=>c.innerText)));
  const original=[...ledgerRows,...lastPage];
  assert.deepEqual(rowsOf(ledger).map(r=>Object.values(r)),original);
  assert.deepEqual(ledger.cap.halamanSumber[0].pencocokan.columns,['NPWP','Masa Pajak','Nilai']);
  assert.deepEqual(ledger.cap.halamanSumber[0].pencocokan.pageRows,[2,1]);
  assert.equal(ledger.cap.halamanSumber[0].pencocokan.morePagesAvailable,true);
  assert.equal(JSON.stringify(pkg.entries).includes('OMIT-ME'),false);
  assert.equal(JSON.stringify(pkg.entries).includes(other),false);
  const admin=await browser.newPage();
  await admin.goto(local+'/app.html');await admin.getByText('Belum ada hasil penarikan.').waitFor();
  await admin.locator('#ids').fill(wp);await admin.locator('#officer').fill('Petugas Fiktif');
  await admin.locator('#source').selectOption('tabelumum');
  await admin.locator('#undated-general').check();await admin.locator('#scope-ok').check();
  const upload=(name,contents)=>admin.locator('#source-files').setInputFiles({name,mimeType:'text/csv',buffer:Buffer.from(contents)});
  await upload('kosong.csv','NPWP,Masa Pajak\n');
  await admin.locator('#notice').getByText(/Tabel kosong/).waitFor();
  assert.equal(await admin.locator('#queue .item').count(),0);
  await admin.locator('#scope-ok').check();
  await upload('bermasa.csv','NPWP,Masa Pajak\n'+wp+',2025-02');
  await admin.locator('#notice').getByText(/Sumber ini memuat masa atau tahun pajak/).waitFor();
  assert.equal(await admin.locator('#queue .item').count(),0);
  await admin.locator('#scope-ok').check();
  const header=['[object Object]','','CaseNumber','MainTaxpayerTIN','MainTaxpayerName','CaseTypeName','CaseStatus','CaseSource','CreatedDate','CreatedByUser','IsSuspended','WorkflowStep','TopDueDate','EndDate','TaxRegion','TaxOffice'];
  const values=['0003',wp,'Fiktif','A','Aktif','X','2025-01-20','Contoh','false','C','','','01','02'];
  await upload('kasus.csv',header.join(',')+'\r\n'+values.join(','));
  await admin.locator('#queue .item').getByText(/Masa tidak tercantum/).waitFor();
  await admin.locator('#consent').check();await admin.locator('#start').click();await admin.locator('#results').getByText('Unduh paket').click();
  const downloaded=admin.waitForEvent('download');await admin.locator('#package-dialog button[value=ok]').click();
  const casePackage=await readPackage(await readFile(await (await downloaded).path()));
  assert.ok(casePackage.report.valid);
  assert.equal(casePackage.manifest.periode,'Tidak tercantum pada sumber');assert.equal(casePackage.manifest.opsi.periode,null);
  assert.equal(casePackage.entries[0].cap.konteks.periode,null);assert.deepEqual(indexPackage(casePackage).years,[]);
  assert.deepEqual(Object.values(rowsOf(casePackage.entries[0])[0]),values);
  console.log('PASS: batch over two tabs, multi-level headers and filters, data and action checkboxes, empty-state handling, source matching and ledger cells. Native administrative CSV and explicitly absent tax period survive the full download and viewer reader.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
