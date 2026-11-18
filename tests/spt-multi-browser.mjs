import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
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

function listRow(doc) {
  const action = doc===unavailable ? '<button type="button" onclick="location.href=\'/__synthetic__/unsafe\'">Hapus SPT</button>' :
    '<a href="'+detailBase+doc.id+'"'+(doc===newTab?' target="_blank"':'')+'>Lihat SPT</a>';
  const cells=['PPN','SPT Masa PPN',doc.month+' 2025',model(doc),'Dilaporkan',doc.id,receipt(doc)];
  return '<tr><td>'+action+'</td>'+cells.map(v=>'<td>'+v+'</td>').join('')+'</tr>';
}
function indexPage(mode,afterVisit) {
  let pages = [[normal,revision]];
  if(mode==='lanjut'){
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
  const tables = pages.map(page=>page.map(listRow).join(''));
  const startPage = mode==='pertama' && afterVisit ? 1 : 0;
  const firstButton=mode==='pertama' ?
    '<button type="button" id="first" aria-label="Halaman pertama" aria-controls="index"'+(startPage?'':' disabled')+'>Halaman pertama</button>' : '';
  const destructive=mode==='pertama' ?
    '<button type="button" class="p-paginator-next" aria-label="Hapus SPT" aria-controls="index" onclick="location.href=\'/__synthetic__/unsafe\'">Hapus SPT</button>' : '';
  return '<!doctype html><aside><div><b>'+owner+'</b><div>Perusahaan Fiktif</div></div><ul>'+
    '<li><a href="'+listing+'">SPT Dilaporkan</a></li>'+
    '<li><a href="/registration/id-ID/general-information/'+scopeId+'">Informasi Umum Wajib Pajak</a></li>'+
    '<li><a href="/returnsheets/id-ID/taxpayer-search">Pilih Wajib Pajak Lain</a></li></ul></aside>'+
    '<div class="p-datatable"><table id="index"><thead><tr>'+headings.map(s=>'<th>'+s+'</th>').join('')+'</tr></thead><tbody>'+tables[startPage]+'</tbody></table>'+
    '<div class="p-paginator">'+firstButton+'<button id="next" type="button" aria-label="Halaman berikutnya" aria-controls="index"'+
    (startPage===tables.length-1?' disabled':'')+'>Berikutnya</button>'+destructive+'</div></div>'+
    '<script>const pages='+JSON.stringify(tables)+';let page='+startPage+';const next=document.getElementById("next"),first=document.getElementById("first");'+
    'const show=()=>{document.querySelector("tbody").innerHTML=pages[page];if(first)first.disabled=page===0;next.disabled=!'+repeat+' && page===pages.length-1;};'+
    'if(first)first.onclick=()=>{page=0;show();console.log("fixture:first-page");};'+
    'next.onclick=()=>{page=(page+1)%pages.length;show();console.log("fixture:index-page");};</script>';
}
function detailPage(doc,mode) {
  const changed = mode==='ganti' && doc===revision;
  const pairs = [['NPWP Wajib Pajak',changed?'0000000000000002':owner],['Jenis SPT','SPT Masa PPN'],
    ['Masa Pajak',doc.month+' 2025'],['Model SPT',model(doc)],['ID SPT',doc.id],['Nomor Bukti Penerimaan',receipt(doc)]];
  const pageForStop = mode==='henti' && doc===normal ?
    '<section aria-label="Lampiran A1"><table id="a1"><thead><tr><th>Uraian</th></tr></thead>'+
    '<tbody><tr><td>HALAMAN-SATU</td></tr></tbody></table><button type="button" aria-controls="a1" '+
    'aria-label="Berikutnya" onclick="console.log(\'fixture:detail-page\')">Berikutnya</button></section>' : '';
  return '<!doctype html><main><dl>'+pairs.map(([k,v])=>'<dt>'+k+'</dt><dd>'+v+'</dd>').join('')+'</dl>'+
    '<section aria-label="Induk SPT"><dl><dt>Keterangan</dt><dd>'+(changed?'WP-LAIN':'INDUK-'+doc.id)+'</dd></dl></section>'+
    pageForStop+(mode==='isian'?'<label>Catatan fiktif <input id="note" value="Awal"></label>'+
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
async function downloadPackage(ui) {
  await ui.locator('#start').click();
  await ui.getByRole('button',{name:'Unduh paket'}).first().click();
  const [download] = await Promise.all([
    ui.waitForEvent('download'),
    ui.locator('#package-dialog button[value=ok]').click()
  ]);
  return readPackage(await readFile(await download.path()));
}
async function run(mode) {
  const profile = await mkdtemp(path.join(tmpdir(),'scv2-antrean-'));
  let ctx;
  try {
    ctx=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,
      executablePath:process.env.CHROMIUM_PATH || undefined,acceptDownloads:true,
      args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
    const opened=[],blocked=[],listVisits=[],pageErrors=[];
    let nextClicks=0,firstClicks=0;
    ctx.on('console',event=>{
      if(event.text()==='fixture:index-page')nextClicks++;
      if(event.text()==='fixture:first-page')firstClicks++;
    });
    ctx.on('weberror',event=>pageErrors.push(event.error().message));
    await ctx.route(/^https?:\/\//,route=>{
      const request=route.request(),url=request.url();
      if(request.method()==='GET' && url===listing){
        listVisits.push(opened.length);
        return route.fulfill({contentType:'text/html; charset=utf-8',body:indexPage(mode,opened.length>0)});
      }
      const doc=docs.find(d=>url===detailBase+d.id);
      if(request.method()==='GET' && doc){
        opened.push(doc.id);
        return route.fulfill({contentType:'text/html; charset=utf-8',body:detailPage(doc,mode)});
      }
      if(url!==site+'/favicon.ico')blocked.push([request.method(),url]);
      return route.abort();
    });
    const worker=ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    const source=await ctx.newPage();await source.goto(listing);
    const ui=await ctx.newPage();await ui.goto(new URL('app.html',worker.url()).href);
    await prepare(ui);
    const choices=ui.getByRole('checkbox',{name:/^Pilih .*pembetulan \d+$/i});
    await choices.first().waitFor();
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
for(const mode of ['lanjut','berulang','ganti','henti','pertama','isian'])await run(mode);
console.log('PASS: selected SPT versions, reordered index, first and next page, partial navigation, repeating list, changed WP, stop and verified ZIP.');
