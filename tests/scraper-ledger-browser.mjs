import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPackage} from '../extension/archive/package.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const extension=process.env.EXTENSION_DIR||fileURLToPath(new URL('../extension/',import.meta.url));
const wp='0000000000000017',profile=await mkdtemp(join(tmpdir(),'scv2-ledger-'));
const origin='https://coretax.intranet.pajak.go.id';
const filters=x=>[{PropertyName:'IsCancelled',MatchMode:'equals',Value:x}];
const file=(name,period,data,filters)=>({name:name+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({
  Payload:{Data:data.map(r=>({TaxpayerTIN:wp,PeriodCode:period,...r})),TotalRecords:data.length},Request:{Filters:filters}}))});
const jan=file('fiktif-januari','01012025',[
  {ReferenceNumber:'DEMO-A',Amount:50,IsCancelled:false},{ReferenceNumber:'DEMO-B',Amount:9,IsCancelled:true},{ReferenceNumber:'DEMO-C',Amount:3}],[]);
const feb=file('fiktif-februari','02022025',[{ReferenceNumber:'DEMO-D',Amount:6}],filters('0'));
const march=file('fiktif-maret','03032025',[{ReferenceNumber:'DEMO-E',Amount:8}],filters('1'));
const totalRows=[{Key:'Filtered',Balance:53}];
const totals=[file('total-aktif','01012025',totalRows,filters('0')),file('total-semua','01012025',totalRows,[])];
const target=m=>origin+'/buku-besar-fiktif-'+m;
function ledgerTable(month,filter=''){
  const code=month+month+'2025';
  return '<section class="p-datatable">'+(filter?'<input type="search" aria-label="Cari" value="'+filter+'">':'')+
    '<table><caption>Buku besar</caption><thead><tr>'+['NPWP Wajib Pajak','PeriodCode','PostingDate','Amount','ReferenceNumber','IsCancelled'].map(k=>'<th>'+k+'</th>').join('')+
    '</tr></thead><tbody>'+['0','1'].map((flag,i)=>'<tr>'+[wp,code,'2025-'+month+'-10','5','DOM-'+month+'-'+i,flag].map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></section>';
}
let ctx;
try{
  ctx=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,
    acceptDownloads:true,args:['--disable-background-networking','--disable-extensions-except='+extension,'--load-extension='+extension]});
  const unexpected=[],pages=new Map([[target(1),ledgerTable('04')],[target(2),ledgerTable('05','satu')],[target(3),ledgerTable('05','dua')]]);
  await ctx.route(/^https?:\/\//,r=>{
    const url=r.request().url();
    if(pages.has(url))return r.fulfill({contentType:'text/html',body:pages.get(url)});
    if(url!==origin+'/favicon.ico')unexpected.push(r.request().method());
    return r.abort();
  });
  const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
  const ui=await ctx.newPage();ui.setDefaultTimeout(8000);
  await ui.goto(new URL('app.html',worker.url()).href);
  const input=ui.locator('#ledger-cancel');
  async function setup(){
    await ui.locator('#ids').fill(wp);await ui.locator('#officer').fill('Penguji fiktif');
    for(const side of ['start','end'])await ui.locator('#year-'+side).selectOption('2025');
    await ui.locator('#month-start').selectOption('01');await ui.locator('#month-end').selectOption('05');
    for(const el of await ui.locator('#sources input').all())await el.setChecked(['bb','bbtotal'].includes(await el.inputValue()));
    await ui.locator('#consent').check();
  }
  async function addFiles(source,files,count){
    await ui.locator('#source').selectOption(source);await ui.locator('#scope-ok').check();
    await ui.locator('#source-files').setInputFiles(files);await ui.waitForFunction(n=>document.querySelectorAll('#queue .item').length===n,count);
  }
  async function exportResult(){
    await ui.locator('#start').click();await ui.waitForFunction(()=>document.querySelectorAll('#queue .item').length===0);
    await ui.getByRole('button',{name:'Unduh paket'}).first().click();
    const [download]=await Promise.all([ui.waitForEvent('download'),ui.locator('#package-dialog button[value=ok]').click()]);
    const data=await readFile(await download.path()),pkg=await readPackage(data);
    assert.ok(pkg.report.valid);assert.equal(pkg.manifest.wp.npwp,wp);
    return {data,pkg};
  }
  await setup();
  if(process.env.EXPECT_LEDGER_0130){
    assert.equal(await input.count(),0);await addFiles('bb',[jan],1);
    const {pkg}=await exportResult();assert.equal(pkg.entries[0].pages[0].Payload.Data.length,3);
    assert.equal(pkg.manifest.opsi.bbBatal,undefined);
    console.log('0.13.0 reproduced: all three synthetic status cases stored, no cancellation option.');
  }else{
    for(const url of pages.keys())await (await ctx.newPage()).goto(url);
    for(const include of [false,true]){
      assert.equal(await input.isChecked(),include);
      await ui.locator('#preview').click();const other=ui.locator('#other-preview');
      await other.getByText(/beberapa tampilan berbeda/).first().waitFor();
      await other.getByRole('button',{name:'Tambahkan sumber terverifikasi'}).click();
      await ui.waitForFunction(()=>document.querySelectorAll('#queue .item').length===1);
      await ui.locator('#source').selectOption('bb');await ui.locator('#scope-ok').check();
      await ui.locator('#source-files').setInputFiles(file('asing','01012025',[{TaxpayerTIN:'0000000000000018',IsCancelled:true}],[]));
      await ui.locator('#notice').getByText(/NPWP pada sumber berbeda/).waitFor();assert.equal(await ui.locator('#queue .item').count(),1);
      await addFiles('bb',[jan,feb,march],4);await addFiles('bbtotal',totals,6);
      await ui.locator('#queue').getByText(new RegExp((include?'3':'2')+' dari 3 baris rincian dipilih')).waitFor();
      await ui.locator('#preview').click();
      const preview=ui.getByRole('table',{name:'Pratinjau penarikan',exact:true});
      await preview.waitFor();assert.equal(await preview.locator('tbody tr > *').last().innerText(),include?'9':'6');
      await input.setChecked(!include);assert.equal(await preview.count(),0);await input.setChecked(include);
      const {data,pkg}=await exportResult(),entries=new Map(pkg.entries.map(e=>[e.path,e]));
      assert.equal(pkg.manifest.opsi.bbBatal,include);assert.equal(entries.size,5);
      assert.ok(pkg.entries.every(e=>!e.cap.lengkap));assert.ok(!pkg.manifest.cek.some(c=>c.tingkat==='TINGGI'));
      const entry=m=>entries.get('bukubesar/2025-'+m+'.json');
      assert.deepEqual(['01','02','03','04'].map(m=>entry(m).cap.baris),include?[3,1,1,2]:[2,1,0,1]);
      const get=e=>e.cap.halamanSumber[0].pemilihanBukuBesar;
      assert.equal(get(entry('01')).tidakDiketahui,1);assert.equal(get(entry('02')).berdasarkanFilter,1);
      assert.equal(get(entry('03')).batalDilewati,include?0:1);assert.equal(get(entry('04')).filterPembatalanSumber,'tidak-diketahui');
      const total=entries.get('bukubesar-total/2025-01.json');
      assert.equal(total.pages.length,1);assert.equal(total.pages[0].Payload.Data[0].Balance,53);
      assert.equal(get(total).cakupanOpsi,include?'berbeda':'sesuai');
      assert.equal(total.cap.sumberSalinanIdentik[0].pemilihanBukuBesar.filterPembatalanSumber,'tanpa-filter-pembatalan');
      const viewer=await ctx.newPage();await viewer.goto(new URL('analisis/index.html',worker.url()).href);
      await viewer.locator('#filePkg').setInputFiles({name:'fiktif.zip',mimeType:'application/zip',buffer:data});
      await viewer.getByText(/5 berkas diperiksa/).first().waitFor();
      await viewer.locator('#navigation').getByRole('button',{name:'Data mentah',exact:true}).click();
      await viewer.getByRole('button',{name:'Buku besar gabungan',exact:true}).click();
      for(const id of ['DEMO-A','DEMO-C','DEMO-D','DOM-04-0'])await viewer.getByRole('cell',{name:id,exact:true}).first().waitFor();
      for(const id of ['DEMO-B','DEMO-E','DOM-04-1'])assert.equal(await viewer.getByRole('cell',{name:id,exact:true}).count(),include?1:0);
      await viewer.close();
      if(!include){await input.check();await ui.reload();await setup();}
    }
    console.log('Both options passed: 4 vs 7 ledger detail rows in the player, totals preserved, imported/visible filter evidence, one WP and persisted preference.');
  }
  assert.deepEqual(unexpected,[]);
}finally{await ctx?.close();await rm(profile,{force:true,recursive:true});}
