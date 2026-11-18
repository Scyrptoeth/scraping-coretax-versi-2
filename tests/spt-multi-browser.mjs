import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPackage} from '../extension/archive/package.js';

const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const extension = process.env.EXTENSION_DIR || fileURLToPath(new URL('../extension/',import.meta.url));
const site = 'https://coretax.intranet.pajak.go.id';
const scopeId = '00000000-0000-4000-8000-000000000001';
const listing = site+'/returnsheets/id-ID/submitted-returnsheets/'+scopeId;
const detailBase = site+'/__synthetic__/form/';
const owner = '0000000000000001';
const docs = [
  {id:'jan-normal',month:'Januari',revision:0},
  {id:'jan-revision',month:'Januari',revision:1},
  {id:'feb-normal',month:'Februari',revision:0},
  {id:'mar-normal',month:'Maret',revision:0},
  {id:'apr-normal',month:'April',revision:0},
  {id:'may-other',month:'Mei',revision:0},
  {id:'jun-other',month:'Juni',revision:0},
];
const [normal, revision, unavailable, newTab, unselected,otherPage,lastPage] = docs;
const model = doc => doc.revision ? 'Pembetulan '+doc.revision : 'Normal';
const receipt = doc => 'BPE-UJI-'+doc.id;
const headings = ['','Jenis Pajak','Jenis Surat Pemberitahuan Pajak','Masa Pajak','Model SPT','Status SPT','ID SPT','Nomor Bukti Penerimaan'];

function listRow(doc,dualNumbers=false) {
  const action = doc===unavailable ? '<button type="button" onclick="location.href=\'/__synthetic__/unsafe\'">Hapus SPT</button>' :
    '<a href="'+detailBase+doc.id+'"'+(doc===newTab?' target="_blank"':'')+'>Lihat SPT</a>';
  const cells=['PPN','SPT Masa PPN',doc.month+' 2025',model(doc),'Dilaporkan',doc.id,receipt(doc)];
  if(dualNumbers)cells.push('00012-'+doc.id,receipt(doc));
  return '<tr><td>'+action+'</td>'+cells.map(v=>'<td>'+v+'</td>').join('')+'</tr>';
}
function indexPage(mode,afterVisit) {
  const dualNumbers=mode==='paket';
  if(dualNumbers)mode='tindaklanjut';
  let pages = [[normal,revision]];
  if(mode==='seratus')pages=[Array.from({length:103},(_,revision)=>({id:'versi-'+revision,month:'Januari',revision}))];
  else if(mode==='tindaklanjut')pages=afterVisit?[[normal,revision]]:[[normal]];
  else if(mode==='lanjut'){
    pages = afterVisit ? [[unselected,unavailable,normal],[newTab,revision,unavailable]] :
      [[normal,revision,unavailable,newTab,unselected]];
  }else if(mode==='ganti'){
    pages = [[normal,revision,newTab]];
  }else if(mode==='pertama' && afterVisit){
    pages = [[revision],[otherPage]];
  }else if(mode==='berulang' && afterVisit){
    pages = [[otherPage],[lastPage]];
  }
  const repeat = mode==='berulang' && afterVisit;
  const tables = pages.map(page=>page.map(doc=>listRow(doc,dualNumbers)).join(''));
  const startPage = mode==='pertama' && afterVisit ? 1 : 0;
  const firstButton=mode==='pertama' ?
    '<button type="button" id="first" aria-label="Halaman pertama" aria-controls="index"'+(startPage?'':' disabled')+'>Halaman pertama</button>' : '';
  const destructive=mode==='pertama' ?
    '<button type="button" class="p-paginator-next" aria-label="Hapus SPT" aria-controls="index" onclick="location.href=\'/__synthetic__/unsafe\'">Hapus SPT</button>' : '';
  return '<!doctype html><aside><div><b>'+owner+'</b><div>Perusahaan Fiktif</div></div><ul>'+
    '<li><a href="'+listing+'">SPT Dilaporkan</a></li>'+
    '<li><a href="/registration/id-ID/general-information/'+scopeId+'">Informasi Umum Wajib Pajak</a></li>'+
    '<li><a href="/returnsheets/id-ID/taxpayer-search">Pilih Wajib Pajak Lain</a></li></ul></aside>'+
    '<div class="p-datatable"><table id="index"><thead><tr>'+(dualNumbers?[...headings,'DocumentReceiptNumber','BpsNo']:headings).map(s=>'<th>'+s+'</th>').join('')+'</tr></thead><tbody>'+tables[startPage]+'</tbody></table>'+
    '<div class="p-paginator">'+firstButton+'<button id="next" type="button" aria-label="Halaman berikutnya" aria-controls="index"'+
    (startPage===tables.length-1?' disabled':'')+'>Berikutnya</button>'+destructive+'</div></div>'+
    '<script>const pages='+JSON.stringify(tables)+';let page='+startPage+';const next=document.getElementById("next"),first=document.getElementById("first");'+
    'const show=()=>{document.querySelector("tbody").innerHTML=pages[page];if(first)first.disabled=page===0;next.disabled=!'+repeat+' && page===pages.length-1;};'+
    'if(first)first.onclick=()=>{page=0;show();console.log("fixture:first-page");};'+
    'next.onclick=()=>{page=(page+1)%pages.length;show();console.log("fixture:index-page");};</script>';
}
function detailPage(doc,mode,visit) {
  const changed = mode==='ganti' && doc===revision;
  const pairs = [['NPWP Wajib Pajak',changed?'0000000000000002':owner],['Jenis SPT','SPT Masa PPN'],
    ['Masa Pajak',doc.month+' 2025'],['Model SPT',model(doc)],['ID SPT',doc.id],['Nomor Bukti Penerimaan',receipt(doc)]];
  const pageForStop = mode==='henti' && doc===normal ?
    '<section aria-label="Lampiran A1"><table id="a1"><thead><tr><th>Uraian</th></tr></thead>'+
    '<tbody><tr><td>HALAMAN-SATU</td></tr></tbody></table><button type="button" aria-controls="a1" '+
    'aria-label="Berikutnya" onclick="console.log(\'fixture:detail-page\')">Berikutnya</button></section>' : '';
  let followup='';
  if(mode==='tindaklanjut'){
    followup='<section aria-label="Lampiran A1"><table id="pages"><thead><tr><th>Uraian</th></tr></thead><tbody><tr><td id="cell">'+doc.id+'-satu</td></tr></tbody></table>'+
      '<div id="range" role="status">Menampilkan 1 sampai 1 dari 2 baris</div><button type="button" aria-controls="pages" aria-label="Berikutnya" onclick="this.disabled=true;document.getElementById(\'range\').textContent=\'Menampilkan 2 sampai 2 dari 2 baris\';document.getElementById(\'cell\').textContent=\''+doc.id+'-dua\'">Berikutnya</button></section>'+
      '<button type="button" role="tab" aria-controls="b" onclick="console.log(\'fixture:b1:'+doc.id+'\');document.getElementById(\'b\').hidden=false">Lampiran B1</button>'+
      '<section role="tabpanel" id="b" aria-label="Lampiran B1" hidden><dl><dt>Rincian</dt><dd>'+doc.id+'-b1</dd></dl></section>'+
      '<section aria-label="Lampiran B2">'+(doc!==normal || visit>1?'<dl><dt>Rincian</dt><dd>'+doc.id+'-b2</dd></dl>':'Belum tampil')+'</section>'+
      '<section aria-label="Lampiran C1"><table id="tail"><thead><tr><th>Uraian</th></tr></thead><tbody><tr><td>Halaman terakhir</td></tr></tbody></table>'+
      '<button type="button" aria-controls="tail" aria-label="Halaman pertama">Pertama</button><button type="button" aria-controls="tail" aria-label="Berikutnya" disabled>Berikutnya</button></section>'+
      '<section aria-label="Lampiran C2"><input type="search" aria-label="Cari baris" value="terpilih"><table><thead><tr><th>Uraian</th></tr></thead>'+
      '<tbody><tr><td>Hasil filter</td></tr></tbody></table><div role="status">Menampilkan 1 sampai 1 dari 1 baris</div></section>';
  }
  return '<!doctype html><main><dl>'+pairs.map(([k,v])=>'<dt>'+k+'</dt><dd>'+v+'</dd>').join('')+'</dl>'+
    '<section aria-label="Induk SPT"><dl><dt>Keterangan</dt><dd>'+(changed?'WP-LAIN':'INDUK-'+doc.id)+'</dd></dl></section>'+
    pageForStop+followup+(mode==='isian'?'<label>Catatan fiktif <input id="note" value="Awal"></label>'+
      '<script>document.getElementById("note").value="Diubah";</script>':'')+'</main>';
}
async function prepare(ui) {
  await ui.locator('#ids').fill(owner);
  await ui.locator('#officer').fill('Penguji fiktif');
  await ui.locator('#year-start').selectOption('2025');
  await ui.locator('#year-end').selectOption('2025');
  await ui.locator('#month-start').selectOption('01');
  await ui.locator('#month-end').selectOption('12');
  await ui.locator('#sources input[value=sptdaftar]').check();
  await ui.locator('#sources input[value=sptisi]').check();
  await ui.locator('#source').selectOption('sptdaftar');
  await ui.locator('#scope-ok').check();
  await ui.locator('#list-tables').click();
  await ui.locator('#add-table').click();
  await ui.locator('#consent').check();
  await ui.locator('#preview').click();
  await ui.getByText('Rincian versi SPT dan bagian yang tersedia',{exact:true}).click();
}
async function downloadPackage(ui,receive) {
  await ui.locator('#start').click();
  await ui.getByRole('button',{name:'Unduh paket'}).first().click();
  const [download] = await Promise.all([
    ui.waitForEvent('download'),
    ui.locator('#package-dialog button[value=ok]').click()
  ]);
  const bytes=await readFile(await download.path());if(receive)await receive(bytes);
  return readPackage(bytes);
}
async function exerciseSavedFollowup(ctx,ui,opened,activations,fromFile){
  const plan=()=>ui.getByRole('table',{name:'Versi SPT yang ditemukan'});
  const action=ui.getByRole('button',{name:'Gunakan bagian SPT dari hasil tersimpan',exact:true});
  async function preview(){
    await ui.locator('#preview').click();await ui.getByText('Rincian versi SPT dan bagian yang tersedia',{exact:true}).click();await plan().waitFor();
  }
  async function read(){
    await ui.getByRole('button',{name:'Ambil versi SPT terpilih',exact:true}).click();
    const status=ui.getByRole('status',{name:'Proses versi SPT terpilih'});
    await status.filter({hasText:/versi diproses/}).waitFor();return status.innerText();
  }
  await ui.getByLabel('Halaman maksimal per bagian SPT').fill('1');
  await read();assert.deepEqual(activations,[normal.id]);
  let bytes;const original=await downloadPackage(ui,b=>{bytes=b;});assert.ok(original.report.valid);
  if(process.env.SPT_EXPECT_0120 && process.env.SPT_WRITE_DEMO_ZIP)await writeFile(process.env.SPT_WRITE_DEMO_ZIP,bytes,{mode:0o600,flag:'wx'});
  if(fromFile && process.env.SPT_PREVIOUS_DEMO_ZIP)bytes=await readFile(process.env.SPT_PREVIOUS_DEMO_ZIP);
  const input=await readPackage(bytes);
  const firstA=original.entries.find(e=>e.path.endsWith('/a1.json'));assert.equal(firstA.pages.length,1);
  assert.ok(!original.entries.some(e=>e.path.endsWith('/b2.json')));
  const secret='sandi-fiktif-013';
  if(!process.env.SPT_EXPECT_0120){
    await ui.locator('#new-pass').fill(secret);await ui.locator('#repeat-pass').fill(secret);await ui.locator('#encrypt').click();await ui.locator('#lock').waitFor();
  }
  await ui.reload();
  if(!process.env.SPT_EXPECT_0120){
    await ui.locator('#unlock-panel').waitFor();assert.equal(await ui.locator('#workspace').isVisible(),false);assert.equal(await action.count(),0);
    await ui.locator('#unlock-pass').fill(secret);await ui.locator('#unlock-form button').click();await ui.locator('#workspace').waitFor();
  }
  await prepare(ui);await plan().waitFor();
  const rows=plan().locator('tbody tr');
  assert.equal(await rows.count(),2);assert.equal(await rows.first().locator('th,td').nth(3).innerText(),'—');
  if(process.env.SPT_EXPECT_0120){
    assert.equal(await action.count(),0);assert.deepEqual(opened,[normal.id]);assert.equal(await ui.getByRole('button',{name:'Unduh paket'}).count(),1);
    console.log('REPRO: 0.12.0 stores the partial result, then an empty queue has zero ready sections after rereading the same directory.');return;
  }
  await action.waitFor();
  await ui.locator('#officer').fill('Petugas berbeda');await preview();assert.equal(await action.count(),0);
  async function useFile(){
    await ui.getByText('Gunakan paket SPT dari berkas',{exact:true}).click();
    await ui.getByLabel('Paket Versi 2 untuk penugasan ini').setInputFiles({name:'simulasi.zip',mimeType:'application/zip',buffer:bytes});
    await ui.getByRole('button',{name:'Gunakan bagian SPT dari berkas'}).click();
  }
  if(fromFile){await useFile();await ui.locator('#notice').filter({hasText:/penugasan yang sama/}).waitFor();assert.equal(await ui.locator('#queue .item').count(),1);}
  await ui.locator('#officer').fill('Penguji fiktif');await preview();
  if(!fromFile){
    const card=ctx.pages().find(p=>p.url()===listing).locator('aside b');
    await card.evaluate(el=>el.textContent='0000000000000028');await action.click();
    await ui.locator('#notice').filter({hasText:/daftar.*belum cocok/i}).waitFor();assert.equal(await ui.locator('#queue .item').count(),1);
    await card.evaluate((el,id)=>el.textContent=id,owner);
    await ui.evaluate(()=>{
      const box=document.getElementById('preview-read-actions');
      const observer=new MutationObserver(()=>{
        const stop=[...box.querySelectorAll('button')].find(b=>b.textContent==='Hentikan pembacaan SPT');
        if(stop){observer.disconnect();stop.click();}
      });observer.observe(box,{childList:true});
    });
    await action.click();await ui.locator('#preview-read-status').filter({hasText:/dihentikan/i}).waitFor();
    assert.equal(await ui.locator('#queue .item').count(),1);
  }
  if(fromFile)await useFile();else await action.click();
  await ui.getByText(/Bagian dari hasil tersimpan sudah dicocokkan/).waitFor();
  if(!fromFile){
    await ui.locator('#officer').fill('Petugas lain');await ui.locator('#start').click();
    await ui.locator('#notice').filter({hasText:/Penugasan untuk bagian SPT di antrean berbeda/}).waitFor();
    assert.equal(await ui.getByRole('button',{name:'Unduh paket'}).count(),1);
    await ui.locator('#officer').fill('Penguji fiktif');await preview();
  }else{
    await ui.getByText('Rincian versi SPT dan bagian yang tersedia',{exact:true}).click();await plan().waitFor();
  }
  assert.match(await rows.first().locator('th,td').nth(3).innerText(),/induk.*b1/);
  if(fromFile && !input.entries.some(e=>e.cap.bagianSptTeramati?.length))await ui.getByText(/catatan lama tanpa identitas bagian/).waitFor();
  else assert.match(await rows.first().locator('th,td').nth(5).innerText(),/b2/);
  assert.equal(await rows.nth(1).locator('th,td').nth(3).innerText(),'—');
  const check=ui.getByRole('checkbox',{name:/^Pilih .*pembetulan 1$/});await check.uncheck();
  assert.match(await read(),/2 bagian dari antrean dipakai kembali/);assert.deepEqual(opened,[normal.id,normal.id]);
  assert.deepEqual(activations,[normal.id]);
  const final=await downloadPackage(ui);assert.ok(final.report.valid);
  const unresolved=final.manifest.cek.filter(c=>c.kode==='SPT-BAGIAN-BELUM-PULIH');
  assert.equal(unresolved.length,1);assert.match(unresolved[0].pesan,/c1, c2/);assert.doesNotMatch(unresolved[0].pesan,/b2/);
  const a1=final.entries.find(e=>e.path.startsWith('spt/') && e.path.endsWith('/a1.json'));
  assert.deepEqual(a1.pages.flatMap(p=>p.Payload.Data.map(r=>r.Uraian)),[normal.id+'-satu',normal.id+'-dua']);
  assert.equal(final.entries.find(e=>e.path.startsWith('spt/') && e.path.endsWith('/b2.json')).pages.length,1);
  const origin=final.entries.find(e=>e.path.startsWith('spt/') && e.path.endsWith('/b1.json')).cap.halamanSumber[0].pencocokan.hasilSebelumnya;
  assert.equal(origin.waktu,fromFile?input.manifest.dibuat:original.manifest.dibuat);
  if(fromFile)assert.equal(origin.shaManifest,input.report.manifestHash);
  const originalButton=ui.getByText('Tarikan sebelumnya',{exact:false}).first();await originalButton.click();
  await ui.getByRole('table',{name:/Riwayat untuk NPWP/}).getByRole('button',{name:'Unduh paket'}).click();
  const [copy]=await Promise.all([ui.waitForEvent('download'),ui.locator('#package-dialog button[value=ok]').click()]);
  const retained=await readPackage(await readFile(await copy.path()));assert.deepEqual(retained.manifest,original.manifest);
  const handoff=ctx.waitForEvent('page');await ui.getByRole('button',{name:'Buka di Analisis'}).first().click();const viewer=await handoff;
  await viewer.getByRole('button',{name:'SPT',exact:true}).first().click();
  await viewer.getByRole('table',{name:'Daftar SPT',exact:true}).getByRole('button',{name:'Buka',exact:true}).first().click();
  const dialog=viewer.getByRole('dialog');await dialog.getByRole('combobox',{name:'Induk / lampiran'}).selectOption('a1');
  await dialog.getByText(normal.id+'-dua',{exact:true}).first().waitFor();
}
async function exerciseFollowup(ctx,ui,opened,activations){
  const choices=ui.getByRole('checkbox',{name:/^Pilih .*pembetulan \d+$/i});
  const execute=async()=>{
    await ui.getByRole('button',{name:'Ambil versi SPT terpilih',exact:true}).click();
    const status=ui.getByRole('status',{name:'Proses versi SPT terpilih'});
    await status.filter({hasText:/versi diproses/}).waitFor();
    return status.innerText();
  };
  const preview=async()=>{
    await ui.locator('#preview').click();await ui.getByText('Rincian versi SPT dan bagian yang tersedia',{exact:true}).click();await choices.first().waitFor();
  };
  await ui.getByLabel('Halaman maksimal per bagian SPT').fill('1');
  assert.equal(await choices.count(),1);await execute();
  assert.deepEqual(opened,[normal.id]);assert.deepEqual(activations,[normal.id]);
  await ui.locator('#scope-ok').check();await ui.locator('#list-tables').click();await ui.locator('#add-table').click();await preview();
  assert.equal(await choices.count(),2);
  const row=ui.getByRole('row').filter({has:choices.first()});
  assert.match(await row.locator('th,td').nth(3).innerText(),/induk.*b1/);
  assert.match(await row.locator('th,td').nth(4).innerText(),/c1.*c2/);
  assert.match(await row.locator('th,td').nth(5).innerText(),/a1.*b2/);
  assert.deepEqual(await choices.evaluateAll(nodes=>nodes.map(n=>n.checked)),[true,true]);
  assert.match(await execute(),/2 bagian dari antrean dipakai kembali/);
  assert.deepEqual(activations,[normal.id,revision.id]);
  await preview();
  for(const item of await choices.all())await item.uncheck();
  await choices.first().check();await ui.getByRole('checkbox',{name:'Ambil ulang semua bagian versi yang dipilih'}).check();
  assert.doesNotMatch(await execute(),/dipakai kembali/);
  assert.deepEqual(activations,[normal.id,revision.id,normal.id]);
  const pkg=await downloadPackage(ui);assert.ok(pkg.report.valid);
  const primary=pkg.entries.filter(e=>e.path.startsWith('spt/PPN/'));
  for(const doc of [normal,revision]){
    const section=name=>primary.find(e=>e.cap.konteks.spt.recordId===doc.id && e.cap.konteks.bagian===name);
    const a=section('a1');assert.equal(a.cap.lengkap,false);
    assert.deepEqual(a.pages.flatMap(p=>p.Payload.Data.map(r=>r.Uraian)),[doc.id+'-satu',doc.id+'-dua']);
    assert.equal(a.cap.halamanSumber[0].pencocokan.awalTampilan,true);
    assert.equal(a.cap.halamanSumber.at(-1).pencocokan.akhirTampilan,true);
    assert.equal(section('c1').cap.halamanSumber[0].pencocokan.awalTampilan,undefined);
    assert.equal(section('c2').cap.halamanSumber[0].pencocokan.filterTampilan,true);
    assert.equal(section('c2').cap.halamanSumber[0].pencocokan.awalTampilan,undefined);
    assert.equal(section('b2').pages[0].Payload.Data[0].Rincian,doc.id+'-b2');
  }
  const handoff=ctx.waitForEvent('page');await ui.getByRole('button',{name:'Buka di Analisis'}).first().click();
  const viewer=await handoff;await viewer.waitForFunction(wp=>document.querySelector('#taxpayer option:checked')?.textContent.includes(wp),owner);
  await viewer.getByRole('button',{name:'SPT',exact:true}).first().click();
  await viewer.getByRole('table',{name:'Daftar SPT',exact:true}).getByRole('button',{name:'Buka',exact:true}).first().click();
  const dialog=viewer.getByRole('dialog'),version=dialog.getByRole('combobox',{name:'Versi',exact:true});
  assert.equal(await version.locator('option').count(),2);
  const read=[];
  for(const value of await version.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value))){
    await version.selectOption(value);await dialog.getByRole('combobox',{name:'Induk / lampiran'}).selectOption('a1');
    read.push(await dialog.getByRole('cell',{name:/jan-(?:normal|revision)-dua/}).innerText());
  }
  assert.deepEqual(read.sort(),[normal.id+'-dua',revision.id+'-dua'].sort());
}
async function run(mode) {
  const profile = await mkdtemp(path.join(tmpdir(),'scv2-antrean-'));
  let ctx;
  try {
    ctx=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,
      executablePath:process.env.CHROMIUM_PATH || undefined,acceptDownloads:true,
      args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
    const opened=[],blocked=[],listVisits=[],pageErrors=[],activations=[];
    let nextClicks=0,firstClicks=0;
    ctx.on('console',event=>{
      if(event.text().startsWith('fixture:b1:'))activations.push(event.text().slice('fixture:b1:'.length));
      if(event.text()==='fixture:index-page')nextClicks++;
      if(event.text()==='fixture:first-page')firstClicks++;
    });
    ctx.on('weberror',event=>pageErrors.push(event.error().message));
    await ctx.route(/^https?:\/\//,route=>{
      const request=route.request(),url=request.url();
      if(request.method()==='GET' && url===listing){
        listVisits.push(opened.length);
        return route.fulfill({contentType:'text/html; charset=utf-8',body:indexPage(mode==='tersimpan'?'tindaklanjut':mode,opened.length>0)});
      }
      const doc=docs.find(d=>url===detailBase+d.id);
      if(request.method()==='GET' && doc){
        opened.push(doc.id);
        return route.fulfill({contentType:'text/html; charset=utf-8',body:detailPage(doc,['tersimpan','paket'].includes(mode)?'tindaklanjut':mode,opened.filter(id=>id===doc.id).length)});
      }
      if(url!==site+'/favicon.ico')blocked.push([request.method(),url]);
      return route.abort();
    });
    const worker=ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    const source=await ctx.newPage();await source.goto(listing);
    const ui=await ctx.newPage();await ui.goto(new URL('app.html',worker.url()).href);
    await prepare(ui);
    if(['tersimpan','paket'].includes(mode)){
      await exerciseSavedFollowup(ctx,ui,opened,activations,mode==='paket');assert.deepEqual(blocked,[]);assert.deepEqual(pageErrors,[]);return;
    }
    if(mode==='tindaklanjut'){
      await exerciseFollowup(ctx,ui,opened,activations);assert.deepEqual(blocked,[]);assert.deepEqual(pageErrors,[]);return;
    }
    const choices=ui.getByRole('checkbox',{name:/^Pilih .*pembetulan \d+$/i});
    await choices.first().waitFor();
    if(mode==='seratus'){
      assert.equal(await choices.count(),100);await ui.getByText('103 dari 103 versi dipilih. 100 versi ditampilkan.').waitFor();
      await choices.first().uncheck();await ui.getByText('102 dari 103 versi dipilih. 100 versi ditampilkan.').waitFor();
      await ui.getByRole('button',{name:'Tampilkan versi berikutnya'}).click();assert.equal(await choices.count(),103);
      await ui.getByText('102 dari 103 versi dipilih. 103 versi ditampilkan.').waitFor();
      assert.equal(await choices.first().isChecked(),false);assert.equal(await choices.last().isChecked(),true);assert.deepEqual(opened,[]);return;
    }
    assert.equal(await choices.count(),mode==='lanjut'?5:mode==='ganti'?3:2);
    for(const choice of await choices.all())assert.equal(await choice.isChecked(),true);
    if(mode==='lanjut')await ui.getByRole('checkbox',{name:/^Pilih .*2025-04.*pembetulan 0$/i}).uncheck();
    const startedDetail = mode==='henti' ? ctx.waitForEvent('console',{predicate:e=>e.text()==='fixture:detail-page'}) : null;
    await ui.getByRole('button',{name:'Ambil versi SPT terpilih',exact:true}).click();
    if(startedDetail){
      await startedDetail;
      await ui.getByRole('button',{name:/^Hentikan .*SPT/i}).click();
    }
    await ui.locator('#preview-box [role=status]').filter({hasText:/versi diproses/i}).last().waitFor({timeout:30000});
    const pkg=await downloadPackage(ui);
    assert.ok(pkg.report.valid);
    assert.equal(pkg.manifest.wp.npwp,owner);
    const parts=pkg.entries.filter(e=>e.cap.sumber==='sptisi');
    const parents=parts.filter(e=>e.path.endsWith('/induk.json'));
    const expected=mode==='lanjut'?[normal,revision,newTab]:mode==='pertama'?[normal,revision]:[normal];
    const checks=pkg.manifest.cek.filter(c=>c.kode==='SPT-TAMPILAN');
    assert.deepEqual(parents.map(e=>e.cap.konteks.spt.recordId).sort(),expected.map(d=>d.id).sort(),
      JSON.stringify({mode,opened,listVisits,nextClicks,checks:checks.map(c=>c.pesan),pageErrors}));
    for(const doc of expected){
      const entry=parents.find(e=>e.cap.konteks.spt.recordId===doc.id);
      assert.equal(entry.cap.lengkap,false);
      assert.ok(entry.path.includes('/p0'+doc.revision+'_'));
      assert.deepEqual(entry.pages.flatMap(p=>p.Payload.Data),[{Keterangan:'INDUK-'+doc.id}]);
    }
    const expectedIssue={lanjut:/tombol lihat/i,berulang:/berulang/i,ganti:/identitas|WP/i,henti:/dihentikan/i,isian:/isian pada formulir berubah/i};
    if(mode==='pertama')assert.equal(checks.length,0);
    else assert.ok(checks.some(check=>expectedIssue[mode].test(check.pesan)),mode);
    assert.deepEqual(blocked,[],mode);
    const expectedVisits=mode==='ganti'?[normal.id,revision.id]:expected.map(doc=>doc.id);
    assert.deepEqual(opened.toSorted(),expectedVisits.toSorted(),mode);
    if(mode==='lanjut'){
      assert.ok(listVisits.some(v=>v>0),'index reloaded after the first form');
      assert.ok(nextClicks>0,'revision moved to the next page');
      assert.ok(!ctx.pages().some(page=>page.url()===detailBase+newTab.id),'the verified secondary tab was released');
    }
    if(mode==='berulang')assert.ok(nextClicks>=2 && nextClicks<=4,'the page cycle must stop');
    if(mode==='pertama')assert.deepEqual([firstClicks,nextClicks],[1,0]);
    if(mode==='ganti')assert.ok(!JSON.stringify(parts).includes('WP-LAIN'));
    if(mode==='henti')assert.equal(parts.find(e=>e.path.endsWith('/a1.json')).cap.baris,1);
    if(mode==='isian')assert.equal(await source.locator('#note').inputValue(),'Diubah');
  }finally{
    await ctx?.close();
    await rm(profile,{recursive:true,force:true});
  }
}
for(const mode of process.env.SPT_TEST_MODE?[process.env.SPT_TEST_MODE]:['tersimpan','paket','tindaklanjut','seratus','lanjut','berulang','ganti','henti','pertama','isian'])await run(mode);
if(!process.env.SPT_EXPECT_0120)console.log('PASS: SPT capture, versions and viewer ('+(process.env.SPT_TEST_MODE||'10 scenarios')+').');
