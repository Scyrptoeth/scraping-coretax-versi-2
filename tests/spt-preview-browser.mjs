import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPackage} from '../extension/archive/package.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const extension=process.env.EXTENSION_DIR||fileURLToPath(new URL('../extension/',import.meta.url));
const site='https://coretax.intranet.pajak.go.id',wp='0000000000000017',other='0000000000000081';
const route=n=>site+'/returnsheets/id-ID/submitted-returnsheets/00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const headings=['Jenis Pajak','Jenis Surat Pemberitahuan Pajak','Masa Pajak','Model SPT','Status SPT','ID SPT'];
const row=(period,model,id)=>['PPN','SPT Masa PPN',period,model,'Dilaporkan',id];
const pages=[[row('Desember 2024','Normal','DI-LUAR'),row('Januari 2025','Normal','JAN-NORMAL')],
  [row('Januari 2025','Amendment 001','JAN-BETUL'),row('Maret 2025','Normal','MAR-NORMAL')]];

function listPage(url,owner,mode){
  const id=new URL(url).pathname.split('/').at(-1),data=['kosong','muat'].includes(mode)?[[]]:mode==='ulang'?[pages[0],[pages[0][1],pages[1][0]]]:pages;
  return '<title>Daftar fiktif</title><aside><div><b id="owner">'+owner+'</b><div>Usaha fiktif</div></div><ul><li><a href="'+url+'">SPT Dilaporkan</a></li>'+
    '<li><a href="/registration/id-ID/general-information/'+id+'">Informasi Umum Wajib Pajak</a></li><li><a href="/returnsheets/id-ID/taxpayer-search">Pilih Wajib Pajak Lain</a></li></ul></aside>'+
    '<div class="p-datatable" aria-busy="'+(mode==='muat')+'">'+(['filter','filter-ganti'].includes(mode)?'<input type="search" value="Filter fiktif">':'')+
    '<table id="list"><thead><tr>'+headings.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody></tbody></table>'+
    '<div class="p-paginator"><button id="first" '+(mode==='tengah'?'hidden ':'')+'type="button" aria-controls="list" aria-label="Halaman pertama">«</button><span class="p-paginator-current"></span>'+
    '<button id="next" type="button" aria-controls="list" aria-label="Halaman berikutnya">›</button></div></div>'+
    '<script>const pages='+JSON.stringify(data)+', mode='+JSON.stringify(mode)+';let ix=["utuh","tengah"].includes(mode)?1:0;window.clicks=[];'+
    'function draw(){const rs=pages[ix];document.querySelector("tbody").innerHTML=rs.length?rs.map(r=>"<tr>"+r.map(v=>"<td>"+v+"</td>").join("")+"</tr>").join(""):"<tr><td colspan=6>Tidak ada data</td></tr>";'+
    'document.querySelector(".p-paginator-current").textContent=rs.length?"Menampilkan "+(2*ix+1)+" sampai "+(2*ix+2)+" dari "+(mode==="jumlah"&&ix===1?5:4)+" baris":"Menampilkan 0 sampai 0 dari 0 baris";first.disabled=ix===0;next.disabled=ix===pages.length-1;}'+
    'first.onclick=()=>{window.clicks.push("first");ix=0;draw()};next.onclick=()=>{window.clicks.push("next");console.log("preview:next");setTimeout(()=>{ix++;if(mode==="ganti")document.querySelector("#owner").textContent="'+other+'";if(mode==="filter-ganti")document.querySelector("input").value="Kriteria berbeda";draw()},mode==="henti"?700:10)};draw()</script>';
}

async function scenario(mode){
  const temp=await mkdtemp(path.join(tmpdir(),'scv2-preview-'));let ctx;
  try{
    ctx=await chromium.launchPersistentContext(temp,{channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,acceptDownloads:true,
      args:['--disable-background-networking','--disable-extensions-except='+extension,'--load-extension='+extension]});
    const blocked=[];await ctx.route(/^https?:\/\//,r=>{
      const url=r.request().url();if([route(1),route(2)].includes(url))return r.fulfill({contentType:'text/html; charset=utf-8',body:listPage(url,url===route(2)&&mode!=='ganda'||mode==='asing'?other:wp,mode)});
      if(url!==site+'/favicon.ico')blocked.push(r.request().method());return r.abort();
    });
    const worker=ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    if(['utuh','ganda'].includes(mode)){const second=await ctx.newPage();await second.goto(route(2));}
    const source=await ctx.newPage();await source.goto(route(1));
    const ui=await ctx.newPage();await ui.goto(new URL('app.html',worker.url()).href);
    await ui.locator('#ids').fill(wp);await ui.locator('#officer').fill('Penguji fiktif');
    for(const field of ['start','end'])await ui.locator('#year-'+field).selectOption('2025');
    await ui.locator('#month-start').selectOption('01');await ui.locator('#month-end').selectOption('03');
    await ui.locator('#sources input[value=sptdaftar]').check();
    assert.equal(await ui.locator('#preview').isDisabled(),true);await ui.locator('#consent').check();
    if(mode==='batas')await ui.locator('#preview-index-limit').fill('1');
    const nextClick=mode==='henti'?source.waitForEvent('console',{predicate:m=>m.text()==='preview:next'}):null;
    await ui.locator('#preview').click();
    if(['asing','muat'].includes(mode)){
      const reason=mode==='asing'?'Daftar yang terbuka belum cocok':'Daftar SPT masih dimuat.';
      await ui.getByRole('status').filter({hasText:reason}).first().waitFor();assert.equal(await ui.locator('#queue .item').count(),0);assert.deepEqual(blocked,[]);return;
    }
    if(mode==='ganda'){
      await ui.getByRole('button',{name:'Gunakan tab yang sedang dipilih untuk pratinjau'}).waitFor();assert.equal(await ui.locator('#queue .item').count(),0);
      await ui.getByRole('button',{name:'Gunakan tab yang sedang dipilih untuk pratinjau'}).click();
    }
    if(nextClick){await nextClick;await ui.getByRole('button',{name:'Hentikan pembacaan SPT'}).click();}
    const plan=ui.getByRole('table',{name:'SPT dalam periode terpilih'});await plan.waitFor();
    const partial=['batas','ulang','jumlah','ganti','henti','tengah','filter-ganti'].includes(mode);
    let expected=mode==='kosong'?[]:mode==='tengah'?pages[1]:partial?pages[0]:pages.flat();
    const totals=mode==='kosong'?['0','0']:mode==='tengah'?['2','2']:partial?['1','1']:['2','3'];
    assert.deepEqual((await plan.locator('tbody tr > *').allInnerTexts()).slice(0,2),totals);
    if(partial)await ui.locator('#preview-box').getByText(/Cakupan sebagian/).waitFor();
    if(mode.startsWith('filter'))await ui.locator('#preview-box').getByText(/Filter pada tabel sumber aktif/).waitFor();
    if(mode==='utuh')assert.deepEqual(await source.evaluate(()=>window.clicks),['first','next']);
    if(mode==='batas'){
      await ui.locator('#preview-index-limit').fill('3');await ui.getByRole('button',{name:'Baca ulang daftar dari tab Coretax'}).click();
      await ui.locator('#preview-box').getByText(/2 halaman daftar dan 4 baris sumber terbaca/).waitFor();expected=pages.flat();
      await ui.locator('#queue').getByRole('button',{name:'Keluarkan'}).first().click();await ui.locator('#preview').click();
      await ui.locator('#preview-box').getByText(/1 halaman daftar dan 2 baris sumber terbaca.*dikeluarkan/).waitFor();
      await ui.getByRole('button',{name:'Baca ulang daftar dari tab Coretax'}).click();
      await ui.locator('#preview-box').getByText(/2 halaman daftar dan 4 baris sumber terbaca/).waitFor();
    }
    const count=await ui.locator('#queue .item').count();await ui.locator('#preview').click();await plan.waitFor();assert.equal(await ui.locator('#queue .item').count(),count);
    await ui.locator('#start').click();await ui.getByRole('button',{name:'Unduh paket'}).first().click();
    const [download]=await Promise.all([ui.waitForEvent('download'),ui.locator('#package-dialog button[value=ok]').click()]);
    const pkg=await readPackage(await readFile(await download.path()));assert.ok(pkg.report.valid);assert.equal(pkg.manifest.wp.npwp,wp);
    const index=pkg.entries.find(e=>e.path==='spt/daftar.json');assert.equal(index.cap.lengkap,false);
    assert.deepEqual(index.pages.flatMap(p=>p.Payload.Data.map(r=>r['ID SPT'])),expected.map(r=>r.at(-1)));
    const coverage=pkg.manifest.cek.filter(x=>x.kode==='DAFTAR-SPT-PRATINJAU');
    assert.equal(coverage.length,1);assert.equal(coverage[0].tingkat,mode!=='batas' && (partial || mode==='filter')?'SEDANG':'INFO');
    if(mode==='utuh'){
      const handoff=ctx.waitForEvent('page');await ui.getByRole('button',{name:'Buka di Analisis'}).first().click();const viewer=await handoff;
      await viewer.getByText(/1 berkas diperiksa/).first().waitFor();await viewer.locator('#navigation').getByRole('button',{name:'SPT',exact:true}).click();
      await viewer.locator('summary').getByText('Daftar SPT dilaporkan',{exact:true}).click();
      const table=viewer.getByRole('table',{name:'Daftar SPT dilaporkan',exact:true});assert.equal(await table.locator('tbody tr').count(),4);
      await table.getByRole('cell',{name:'DI-LUAR',exact:true}).waitFor();
    }
    assert.deepEqual(blocked,[]);
  }finally{await ctx?.close();await rm(temp,{recursive:true,force:true});}
}
for(const mode of ['utuh','batas','ulang','jumlah','ganti','henti','kosong','asing','ganda','filter','filter-ganti','tengah','muat'])await scenario(mode);
console.log('PASS: direct submitted-list preview, selected periods, scope checks, pagination, partial evidence, refresh, verified zero and ZIP playback.');
