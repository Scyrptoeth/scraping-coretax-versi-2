import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launchHomeFixture,list,wp} from './scraper-home-fixture.mjs';
import {readPackage} from '../extension/archive/package.js';

const fixture=await launchHomeFixture();
try {
  const {ctx,routes}=fixture, base=routes.get(list), sidebar=base.slice(0,base.indexOf('<div class="p-datatable">'));
  const headers=['Jenis Pajak','Jenis Surat Pemberitahuan Pajak','Masa Pajak','Model SPT','Status SPT'];
  routes.set(list,sidebar+'<div class="p-datatable"><table id="index"><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+
    '</tr></thead><tbody><tr><td>PPN</td><td>SPT Masa PPN</td><td>Januari 2025</td><td>Normal</td><td>Dilaporkan</td></tr></tbody></table>'+
    '<div class="p-paginator"><span class="p-paginator-current">Menampilkan 1 sampai 1 dari 2 baris</span>'+
    '<button type="button" aria-controls="index" aria-label="Halaman berikutnya" onclick="advanceIndex(this)">Berikutnya</button></div></div>'+
    '<script>function advanceIndex(button) {setTimeout(()=>{'+
      'button.disabled=true;document.querySelector(".p-paginator-current").textContent="Menampilkan 2 sampai 2 dari 2 baris";'+
      'if(!window.staleRows){const body=document.querySelector("#index tbody");body.replaceWith(body.cloneNode(true));}'+
    '},window.delayMs||0);}</script>');
  const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
  const source=await ctx.newPage();await source.goto(list);
  const ui=await ctx.newPage();await ui.goto(new URL('/app.html',worker.url()).href);
  const preview=(workTab=false)=>ui.evaluate(async({wp,list,workTab})=>{
    const {readSubmittedPreview}=await import('./app-spt-preview.js');
    const tab=(await chrome.tabs.query({url:list}))[0],slices=[];
    let loading=0;
    const report=await readSubmittedPreview(chrome,tab,wp,{limit:10,workTab,checkpoint:()=>{},onLoading:()=>loading++,
      onPage:page=>slices.push([page.range.first,page.rows])});
    return {report,slices,loading};
  },{wp,list,workTab});
  const {slices,report}=await preview();
  assert.equal(report.note,'');assert.equal(report.toLast,true);assert.equal(report.rows,2);
  assert.deepEqual(slices.map(([first])=>first),[1,2]);assert.deepEqual(slices[0][1],slices[1][1]);
  await source.reload();
  await source.evaluate(()=>{window.staleRows=true;});
  const stale=await preview();
  assert.match(stale.report.note,/Halaman daftar belum berubah/);
  assert.equal(stale.report.toLast,false);
  assert.deepEqual(stale.slices,slices.slice(0,1));
  await source.reload();
  await source.evaluate(()=>{window.delayMs=5600;});
  const delayed=await preview(true);
  assert.equal(delayed.report.toLast,true);
  assert.deepEqual(delayed.slices,slices);
  assert.ok(delayed.loading>=1);
  await source.reload();
  await ui.locator('#ids').fill(wp);await ui.locator('#officer').fill('Penguji fiktif');
  for(const id of ['year-start','year-end'])await ui.locator('#'+id).selectOption('2025');
  for(const field of await ui.locator('#sources input').all())await field.setChecked(await field.inputValue()==='sptdaftar');
  for(const field of await ui.locator('#forms input').all())await field.check();
  await ui.locator('#consent').check();
  await ui.getByRole('button',{name:'Mulai tarik',exact:true}).click();
  await ui.getByRole('button',{name:'Unduh paket',exact:true}).click();
  const [file]=await Promise.all([ui.waitForEvent('download'),ui.locator('#package-dialog button[value=ok]').click()]);
  const pkg=await readPackage(await readFile(await file.path()));
  const entry=pkg.entries.find(e=>e.cap.sumber==='sptdaftar');
  assert.deepEqual(entry.pages.map(p=>p.Payload.Data),slices.map(([,rows])=>rows));
  assert.deepEqual(entry.cap.halamanSumber.map(h=>h.pencocokan.rentangDaftar.first),[1,2]);
  console.log('Baris identik diterima saat tabel diperbarui dan ditolak saat hanya nomor halaman berubah.');
} finally {await fixture.close();}
