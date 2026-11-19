import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {searchTaxpayer,submittedLink} from '../extension/app-home-navigation.js';
import {readPackage} from '../extension/archive/package.js';
import {home,search,list,draft,wp,other,otherId,launchHomeFixture} from './scraper-home-fixture.mjs';

async function configure(app,identifier) {
  await app.locator('#ids').fill(identifier);
  await app.locator('#officer').fill('Penguji simulasi');
  for (const field of ['year-start','year-end']) await app.locator('#'+field).selectOption('2025');
  for (const field of ['month-start','month-end']) await app.locator('#'+field).selectOption('01');
  for (const input of await app.locator('#sources input').all()) await input.setChecked(['sptdaftar','sptisi'].includes(await input.inputValue()));
  for (const input of await app.locator('#forms input').all()) await input.setChecked((await input.inputValue())==='VAT_VATR');
  await app.locator('#consent').check();
}

const {ctx,routes,blocked,visited,close} = await launchHomeFixture();
try {
  // The search page is available even when the home dropdown stays collapsed in a background tab.
  routes.set(home,'<button type="button" aria-expanded="false" aria-haspopup="true" onclick="if(event.isTrusted)document.querySelector(\'nav\').hidden=false">SPT</button>'+
    '<nav hidden><a href="'+search+'">SPT per Wajib Pajak</a></nav>');
  const callback=new URL('auth-callback',search).href;
  const searchPage=routes.get(search);
  routes.set(search,'<script>if(!sessionStorage.getItem("ready"))location.replace('+JSON.stringify(callback)+');else document.write('+
    JSON.stringify(searchPage).replaceAll('<','\\u003c')+');</script>');
  routes.set(callback,'<p>Memeriksa sesi</p><script>sessionStorage.setItem("ready","1");location.replace('+JSON.stringify(search)+');</script>');
  const listed=routes.get(list).replace('<th>ID SPT</th>','').replace(/<td>INDEX-(?:JAN|FEB)<\/td>/g,'');
  const firstRows=listed.split('<tbody>')[1].split('</tbody>')[0];
  const historicalRow='<tr><td></td><td>PPN</td><td>SPT Masa PPN</td><td>Desember 2024</td><td>Normal</td><td>Dilaporkan</td><td></td></tr>';
  const history=historicalRow.repeat(2);
  routes.set(list,listed.split('<tbody>')[0].replace('class="p-datatable"','class="p-datatable" aria-busy="true"')+
    '<tbody></tbody></table><div class="p-paginator">'+
    '<button class="p-paginator-page" aria-current="page" id="currentPage">1</button>'+
    '<button aria-label="Halaman berikutnya" aria-controls="spt" id="next">Berikutnya</button></div></div><script>'+
    'const rows='+JSON.stringify([firstRows,history,history]).replaceAll('<','\\u003c')+';let page=Number(sessionStorage.getItem("listPage")||0);const body=document.querySelector("tbody");'+
    'function render(){body.innerHTML=rows[page];next.disabled=page===rows.length-1}'+
    'next.onclick=()=>{page++;sessionStorage.setItem("listPage",page);currentPage.textContent=page+1;setTimeout(render,450)};'+
    'setTimeout(()=>{render();currentPage.textContent=page+1;document.querySelector(".p-datatable").setAttribute("aria-busy","false")},1000);</script>');
  const jan=new URL('/simulasi-spt/INDEX-JAN',list).href;
  routes.set(jan,routes.get(jan).replace('<dt>ID SPT</dt><dd>INDEX-JAN</dd>','').replace('</main>',
    '<section aria-label="Lampiran A1"><table><thead><tr><th>No.</th><th>DPP</th></tr></thead>'+
    '<tbody><tr><td>1</td><td>777</td></tr></tbody></table></section></main>'));
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const source = await ctx.newPage();
  await source.goto(home);
  const app = await ctx.newPage();
  await app.goto(new URL('/app.html',worker.url()).href);
  const success = await app.evaluate(async({home,wp})=>{
    const {openHomeModule} = await import('./app-home-navigation.js');
    const [homeTab] = await chrome.tabs.query({url:home});
    const managed = [];
    try {
      const result = await openHomeModule({ext:chrome,homeTab,wp,module:'spt',onTab:id=>managed.push(id)});
      return {url:result.url,managed:managed.length===1 && result.tabId===managed[0] && homeTab.id!==result.tabId};
    } finally { for (const id of managed) await chrome.tabs.remove(id); }
  },{home,wp});
  assert.deepEqual(success,{url:list,managed:true});
  assert.ok(visited.includes(callback));
  assert.equal(source.url(),home);
  assert.equal(await source.locator('nav').isHidden(),true);
  await source.goto(search);
  await source.locator('#ObjectPermitNumber').waitFor();
  await source.evaluate(searchTaxpayer,{step:'enter',wp});
  await source.evaluate(()=>document.querySelector('tbody').append(document.querySelector('#match').cloneNode(true)));
  assert.match((await source.evaluate(searchTaxpayer,{step:'select',wp})).error,/beberapa baris/);
  await source.locator('#ObjectPermitNumber').fill(other);
  assert.equal(await source.evaluate(searchTaxpayer,{step:'select',wp}),null);
  assert.equal(await source.locator('#siteSearch').inputValue(),'');
  await source.goto(draft);
  await source.locator('a').evaluate((a,id)=>a.href=a.href.replace(/[^/]+$/,id),otherId);
  assert.equal(await source.evaluate(submittedLink),null);
  await source.goto(home);
  const downloadButton=app.getByRole('button',{name:'Unduh paket',exact:true});
  await configure(app,other);
  await app.getByRole('button',{name:'Mulai tarik',exact:true}).click();
  await app.locator('#log,#status,#notice').filter({hasText:/belum menampilkan satu hasil/}).first().waitFor({timeout:40000});
  assert.equal(await downloadButton.count(),0);
  assert.equal(await app.locator('#queue .item').count(),0);
  assert.equal(source.url(),home);
  assert.deepEqual(await app.evaluate(async()=> (await chrome.tabs.query({url:'https://coretax.intranet.pajak.go.id/*'})).map(t=>t.url)),[home]);
  await configure(app,wp);
  await app.getByRole('button',{name:'Pratinjau WP',exact:true}).click();
  await app.locator('#preview-box').getByText(/3 halaman daftar dan 6 baris sumber terbaca.*Awal dan akhir/).waitFor();
  await app.locator('#capture-progress').waitFor({state:'hidden'});
  await app.getByRole('button',{name:'Mulai tarik',exact:true}).click();
  await app.locator('#status').getByText(/Menunggu Coretax selesai memuat daftar SPT… Sisa batas tunggu 2 menit/).waitFor();
  const listProgress=app.getByRole('progressbar',{name:'Membaca daftar SPT dilaporkan',exact:true});
  assert.equal(await listProgress.getAttribute('value'),null);
  await app.locator('#progress-estimate').getByText(/1 dari 3 halaman daftar diproses.*Perkiraan sisa tahap ini/).waitFor();
  assert.equal(await listProgress.getAttribute('max'),'3');
  await app.getByRole('progressbar',{name:'Mengambil induk dan lampiran SPT',exact:true}).waitFor();
  await downloadButton.waitFor({timeout:40000}).catch(async error=>{
    throw Error(await app.locator('#log').innerText(),{cause:error});
  });
  assert.equal(await app.locator('#capture-progress').isHidden(),true);
  await downloadButton.click();
  const [download]=await Promise.all([app.waitForEvent('download'),app.locator('#package-dialog button[value=ok]').click()]);
  const pkg=await readPackage(await readFile(await download.path()));
  assert.equal(pkg.report.valid,true);
  assert.equal(pkg.manifest.wp.npwp,wp);
  const entry=pkg.entries.find(e=>e.cap.sumber==='sptdaftar');
  assert.deepEqual(entry.pages.flatMap(p=>p.Payload.Data.map(row=>row['Nomor Bukti Penerimaan'])),
    ['BPE-INDEX-JAN','BPE-INDEX-FEB','','','',''],JSON.stringify(pkg.manifest.cek));
  assert.deepEqual(entry.cap.halamanSumber.map(p=>p.pencocokan.nomorHalamanSumber),[1,2,3]);
  assert.ok(visited.filter(url=>url===list).length>=3,'The working list can restart from page one without a First button.');
  assert.ok(visited.some(url=>url.endsWith('/simulasi-spt/INDEX-JAN')));
  assert.ok(!visited.some(url=>url.endsWith('/simulasi-spt/INDEX-FEB')));
  const details=pkg.entries.filter(e=>e.cap.sumber==='sptisi');
  assert.deepEqual(details.map(e=>e.path.split('/').at(-1)).sort(),['a1.json','induk.json']);
  assert.equal(new Set(details.map(e=>e.path.split('/').slice(0,-1).join('/'))).size,1);
  assert.ok(details.every(e=>/\/p00_cuplikan-[a-f0-9]{64}\//.test(e.path) && !e.cap.konteks.spt.recordId));
  assert.match(JSON.stringify(details),/Induk INDEX-JAN/);
  assert.equal(details.find(e=>e.path.endsWith('/a1.json')).pages[0].Payload.Data[0].DPP,'777');
  assert.doesNotMatch(JSON.stringify(details),/INDEX-FEB/);
  const [viewer]=await Promise.all([ctx.waitForEvent('page'),app.getByRole('button',{name:'Buka di Analisis',exact:true}).click()]);
  await viewer.waitForFunction(owner=>document.querySelector('#taxpayer option:checked')?.textContent.includes(owner),wp);
  await viewer.locator('#navigation').getByRole('button',{name:'SPT',exact:true}).click();
  await viewer.locator('summary').getByText('Tabel SPT hasil tarikan',{exact:true}).click();
  await viewer.locator('summary').getByText('Daftar SPT dilaporkan',{exact:true}).click();
  const index=viewer.getByRole('table',{name:'Daftar SPT dilaporkan',exact:true});
  await index.getByRole('cell',{name:'BPE-INDEX-JAN',exact:true}).waitFor();
  assert.equal(await index.locator('tbody tr').count(),6);
  await index.getByRole('cell',{name:'BPE-INDEX-FEB',exact:true}).waitFor();
  const forms=viewer.getByRole('table',{name:'Daftar SPT',exact:true});
  await forms.getByRole('row').filter({hasText:/Januari 2025|2025-01/}).getByRole('button',{name:'Buka',exact:true}).click();
  const form=viewer.getByRole('dialog');
  await form.getByText('Induk INDEX-JAN',{exact:true}).waitFor();
  await form.getByText('BPE-INDEX-JAN',{exact:true}).waitFor();
  await form.getByRole('combobox',{name:'Induk / lampiran'}).selectOption('a1');
  await form.getByRole('cell',{name:'777',exact:true}).waitFor();
  assert.equal(source.url(),home);
  const preview=await ctx.newPage();
  await preview.goto(app.url());
  await configure(preview,wp);
  await preview.getByRole('button',{name:'Pratinjau WP',exact:true}).click();
  const plan=preview.getByRole('table',{name:'SPT dalam periode terpilih',exact:true});
  await plan.waitFor();
  assert.deepEqual((await plan.locator('tbody tr > *').allInnerTexts()).slice(0,2),['1','1']);
  await preview.locator('#preview-box').getByText(/5 baris di luar periode/).waitFor();
  await preview.waitForFunction(async url=>(await chrome.tabs.query({url:'https://coretax.intranet.pajak.go.id/*'})).every(tab=>tab.url===url),home);
  assert.equal(source.url(),home);
  const feb=new URL('/simulasi-spt/INDEX-FEB',list).href;
  routes.set(list,listed.replace('Februari 2025','Januari 2025')
    .replace('<td>Normal</td><td>Dilaporkan</td><td>BPE-INDEX-FEB','<td>Pembetulan 1</td><td>Dilaporkan</td><td>BPE-INDEX-FEB'));
  routes.set(feb,routes.get(jan).replaceAll('INDEX-JAN','INDEX-FEB').replace('>Normal<','>Pembetulan 1<'));
  routes.set(jan,'<main><h1>Formulir dengan tampilan belum dikenali</h1><p>Bagian ini belum dapat diperiksa.</p></main>');
  const retry=await ctx.newPage();
  await retry.goto(app.url());
  await configure(retry,wp);
  await retry.getByRole('button',{name:'Mulai tarik',exact:true}).click();
  await retry.locator('#results summary').getByText(/Tarikan sebelumnya/).waitFor({timeout:25000}).catch(async error=>{
    throw Error(await retry.locator('#log').innerText(),{cause:error});
  });
  await retry.getByRole('table',{name:'Tarikan terakhir per WP',exact:true}).getByRole('button',{name:'Unduh paket',exact:true}).click();
  const [recoveredFile]=await Promise.all([retry.waitForEvent('download'),retry.locator('#package-dialog button[value=ok]').click()]);
  const recovered=await readPackage(await readFile(await recoveredFile.path()));
  assert.equal(recovered.report.valid,true);
  const savedParts=recovered.entries.filter(e=>e.cap.sumber==='sptisi');
  assert.deepEqual(savedParts.map(e=>e.cap.konteks.spt.pemb),[1,1]);
  assert.ok(recovered.manifest.cek.some(note=>note.kode==='SPT-TAMPILAN'&&/Tampilan sudah dibuka/.test(note.pesan)));
  assert.equal(source.url(),home);
  await source.goto('about:blank');
  const disconnected=await ctx.newPage();
  await disconnected.goto(app.url());
  await configure(disconnected,wp);
  await disconnected.getByRole('button',{name:'Mulai tarik',exact:true}).click();
  await disconnected.locator('#log').getByText(/Buka beranda Coretax dan login dengan akun penugasan/).waitFor();
  await disconnected.waitForFunction(async()=>!(await chrome.tabs.query({url:'https://coretax.intranet.pajak.go.id/*'})).length);
  assert.deepEqual(blocked,[]);
  console.log('Mulai tarik dan Pratinjau WP berjalan dari beranda. ZIP memuat formulir terverifikasi berikutnya saat formulir pertama gagal dikenali.');
} finally {
  await close();
}
