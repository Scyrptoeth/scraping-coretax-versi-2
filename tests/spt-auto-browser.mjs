import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readPackage} from '../extension/archive/package.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const extension=process.env.EXTENSION_DIR || fileURLToPath(new URL('../extension/',import.meta.url));
const site='https://coretax.intranet.pajak.go.id',wp='0000000000000001';
const submitted=site+'/returnsheets/id-ID/submitted-returnsheets/00000000-0000-4000-8000-000000000001';
const detailUrl=site+'/__synthetic__/detail-spt';
const headings=['','Jenis Pajak','Jenis Surat Pemberitahuan Pajak','Masa Pajak','Model SPT','Status SPT','ID SPT','Nomor Bukti Penerimaan'];
const list='<aside><div><b>'+wp+'</b><div>Perusahaan Fiktif</div></div><ul><li><a href="'+submitted+'">SPT Dilaporkan</a></li>'+
  '<li><a href="/registration/id-ID/general-information/00000000-0000-4000-8000-000000000001">Informasi Umum Wajib Pajak</a></li>'+
  '<li><a href="/returnsheets/id-ID/taxpayer-search">Pilih Wajib Pajak Lain</a></li></ul></aside><table id="index"><thead><tr>'+
  headings.map(s=>'<th>'+s+'</th>').join('')+'</tr></thead><tbody><tr><td><a href="'+detailUrl+'">Lihat SPT</a></td>'+
  ['PPN','SPT Masa PPN','Januari 2025','Normal','Dilaporkan','DOC-UJI','BPE-UJI'].map(s=>'<td>'+s+'</td>').join('')+
  '</tr></tbody></table>';
function detail(mode){
  const positive=mode!=='berubah';
  const pairs=[['NPWP Wajib Pajak',wp],['Jenis SPT','SPT Masa PPN'],['Masa Pajak','Januari 2025'],['Model SPT','Normal'],
    ['ID SPT','DOC-UJI'],['Nomor Bukti Penerimaan','BPE-UJI']];
  const next=mode==='berulang'?"document.getElementById('late').hidden=false":mode==='henti'?'':positive?"document.querySelector('#value').textContent='BARIS-DUA'":
    "document.querySelector('dd').textContent='0000000000000002';document.querySelector('#value').textContent='BARIS-WP-LAIN'";
  return '<main><dl>'+pairs.map(([k,v])=>'<dt>'+k+'</dt><dd>'+v+'</dd>').join('')+'</dl>'+
    '<section aria-label="Induk SPT"><dl><dt>Keterangan</dt><dd>INDUK-UJI</dd></dl></section>'+
    '<a href="#a1" role="tab" aria-controls="a1" onclick="event.preventDefault();document.getElementById(\'a1\').hidden=false">Lampiran A.1</a>'+
    '<section role="tabpanel" id="a1" aria-label="Lampiran A1" hidden><table id="gridA"><thead><tr><th>Uraian</th></tr></thead>'+
    '<tbody><tr><td id="value">BARIS-SATU</td></tr></tbody></table><button type="button" aria-controls="gridA" aria-label="Halaman berikutnya" '+
    'onclick="window.nextClicks=(window.nextClicks||0)+1;this.disabled=true;'+next+'">›</button></section>'+
    '<button type="button" role="tab" aria-controls="b1" onclick="document.getElementById(\'b1\').hidden=false">Lampiran B1</button>'+
    '<section role="tabpanel" id="b1" aria-label="Lampiran B1" hidden><table id="gridB"><thead><tr><th>Kode</th></tr></thead>'+
    '<tbody><tr><td colspan="1">Tidak ada data</td></tr></tbody></table><div role="status">Menampilkan 0 sampai 0 dari 0 baris</div></section>'+
    (mode==='berulang'?'<section hidden id="late" aria-label="Lampiran 1A"><dl><dt>Kode</dt><dd>SATU-A</dd></dl></section>'+
      '<section aria-label="Lampiran C"><dl><dt>Kode</dt><dd>C-UJI</dd></dl></section>'+
      '<section aria-label="Lampiran C: Jumlah"><dl><dt>Jumlah fiktif</dt><dd>0</dd></dl></section>':'')+
    (mode==='batas'?'<button type="button" role="tab" aria-controls="b2" aria-label="Lampiran B2" onclick="window.unsafe=true">Hapus SPT</button>'+
      '<section hidden role="tabpanel" id="b2" aria-label="Lampiran B2"></section>':'')+'</main>';
}
async function run(mode) {
  const tmp=await mkdtemp(path.join(tmpdir(),'scv2-auto-'));
  let ctx;
  try{
    ctx=await chromium.launchPersistentContext(tmp,{channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,
      args:['--disable-extensions-except='+extension,'--load-extension='+extension],acceptDownloads:true});
    await ctx.route(/^https?:\/\//,r=>{
      const url=r.request().url();
      if(url===submitted || url===detailUrl)return r.fulfill({contentType:'text/html; charset=utf-8',body:url===submitted?list:detail(mode)});
      return r.abort();
    });
    const worker=ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    const src=await ctx.newPage();await src.goto(submitted);
    const ui=await ctx.newPage();await ui.goto(new URL('app.html',worker.url()).href);
    await ui.locator('#ids').fill(wp);await ui.locator('#officer').fill('Penguji fiktif');
    await ui.locator('#year-start').selectOption('2025');await ui.locator('#year-end').selectOption('2025');
    await ui.locator('#month-start').selectOption('01');await ui.locator('#month-end').selectOption('12');
    await ui.locator('#sources input[value=sptdaftar]').check();await ui.locator('#sources input[value=sptisi]').check();
    await ui.locator('#source').selectOption('sptdaftar');await ui.locator('#scope-ok').check();
    await ui.locator('#list-tables').click();await ui.locator('#add-table').click();await ui.locator('#consent').check();
    await ui.locator('#preview').click();await ui.getByText('Rincian versi SPT dan bagian yang tersedia',{exact:true}).click();
    if(mode==='batas')await ui.getByLabel('Halaman maksimal per bagian SPT').fill('1');
    const go=ui.getByRole('button',{name:'Ambil induk dan lampiran',exact:true});await go.click();
    if(mode==='cocok'){
      await ui.getByRole('button',{name:'Jeda pembacaan SPT'}).click();
      const resume=ui.getByRole('button',{name:'Lanjutkan pembacaan SPT'});
      await resume.waitFor();await ui.waitForTimeout(200);
      const held=await ui.locator('#queue .item').count();await ui.waitForTimeout(250);
      assert.equal(await ui.locator('#queue .item').count(),held);await resume.click();
    }
    if(mode==='henti'){
      await src.waitForURL(detailUrl);await src.waitForFunction(()=>window.nextClicks===1);
      await ui.getByRole('button',{name:'Hentikan pembacaan SPT'}).click();
    }
    const status=ui.locator('#preview-box [role=status]');
    await status.filter({hasText:/halaman terbaca\./}).waitFor();
    const message=await status.innerText();
    const source=ctx.pages().find(p=>p.url()===detailUrl);assert.ok(source);
    assert.equal(await source.evaluate(()=>Boolean(window.unsafe)),false);
    assert.equal(await source.evaluate(()=>window.nextClicks || 0),mode==='batas'?0:1);
    if(mode==='cocok')assert.match(message,/3 bagian dan 4 halaman/);
    if(mode==='berubah')assert.match(message,/Identitas WP atau dokumen berubah/);
    if(mode==='batas')assert.match(message,/Batas halaman tercapai/);
    if(mode==='berulang')assert.match(message,/Halaman berikut belum berubah atau data berulang/);
    if(mode==='henti')assert.match(message,/Pembacaan dihentikan/);
    await ui.locator('#start').click();
    await ui.getByRole('button',{name:'Unduh paket'}).first().click();
    const download=ui.waitForEvent('download');await ui.locator('#package-dialog button[value=ok]').click();
    const bytes=await readFile(await (await download).path()),pkg=await readPackage(bytes);
    assert.ok(pkg.report.valid);assert.equal(pkg.manifest.wp.npwp,wp);
    const part=name=>pkg.entries.find(e=>e.path.endsWith('/'+name+'.json'));
    assert.deepEqual(part('induk').pages[0].Payload.Data,[{Keterangan:'INDUK-UJI'}]);
    const annex=part('a1');assert.equal(annex.cap.lengkap,false);
    assert.deepEqual(annex.pages.flatMap(p=>p.Payload.Data.map(row=>row.Uraian)),mode==='cocok'?['BARIS-SATU','BARIS-DUA']:['BARIS-SATU']);
    if(mode!=='berubah' && mode!=='henti'){
      assert.equal(part('b1').cap.baris,0);assert.equal(part('b1').pages[0].Payload.TotalRecords,0);
      assert.ok(part('b1').cap.halamanSumber[0].pencocokan.nolPadaSumber);
    } else assert.equal(part('b1'),undefined);
    if(mode==='berulang'){
      for(const key of ['c','c-total','l1a'])assert.equal(part(key).cap.baris,1);
    }
    assert.equal(part('b2'),undefined);
    const issues=pkg.manifest.cek.filter(c=>c.kode==='SPT-TAMPILAN');
    assert.equal(issues.length,mode==='cocok'?0:1);
    assert.ok(!JSON.stringify(pkg.entries).includes('BARIS-WP-LAIN'));
    if(mode==='cocok'){
      const newViewer=ctx.waitForEvent('page');await ui.getByRole('button',{name:'Buka di Analisis'}).first().click();
      const viewer=await newViewer;await viewer.waitForFunction(wp=>document.querySelector('#taxpayer option:checked')?.textContent.includes(wp),wp);
      await viewer.getByRole('button',{name:'SPT',exact:true}).first().click();
      await viewer.getByRole('table',{name:'Daftar SPT',exact:true}).getByRole('button',{name:'Buka',exact:true}).click();
      const dialog=viewer.getByRole('dialog');
      assert.equal(await dialog.getByRole('combobox',{name:'Versi',exact:true}).locator('option').count(),1);
      await dialog.getByRole('combobox',{name:'Induk / lampiran'}).selectOption('a1');
      await dialog.getByRole('cell',{name:'BARIS-DUA',exact:true}).waitFor();
    }
  } finally {await ctx?.close();await rm(tmp,{recursive:true,force:true});}
}
for(const mode of ['cocok','berubah','batas','berulang','henti'])await run(mode);
console.log('PASS: five one-version extraction scenarios, sequential and repeated pages, late section, verified zero, pause, resume, stop, changed owner, archive and viewer.');
