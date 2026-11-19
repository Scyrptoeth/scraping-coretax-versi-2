import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readHomeMenu,searchTaxpayer,submittedLink} from '../extension/app-home-navigation.js';
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

const {ctx,blocked,visited,close} = await launchHomeFixture();
try {
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
  assert.equal(source.url(),home);
  assert.deepEqual(await source.evaluate(readHomeMenu),{hasMenu:true});
  assert.equal(await source.locator('nav').isHidden(),true);
  await source.goto(search);
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
  await app.getByRole('button',{name:'Mulai tarik',exact:true}).click();
  await downloadButton.waitFor({timeout:40000});
  await downloadButton.click();
  const [download]=await Promise.all([app.waitForEvent('download'),app.locator('#package-dialog button[value=ok]').click()]);
  const pkg=await readPackage(await readFile(await download.path()));
  assert.equal(pkg.report.valid,true);
  assert.equal(pkg.manifest.wp.npwp,wp);
  const entry=pkg.entries.find(e=>e.cap.sumber==='sptdaftar');
  assert.deepEqual(entry.pages.flatMap(p=>p.Payload.Data.map(row=>row['ID SPT'])),['INDEX-JAN','INDEX-FEB']);
  assert.ok(visited.some(url=>url.endsWith('/simulasi-spt/INDEX-JAN')));
  assert.ok(!visited.some(url=>url.endsWith('/simulasi-spt/INDEX-FEB')));
  const details=pkg.entries.filter(e=>e.cap.sumber==='sptisi');
  assert.ok(details.length>0);
  assert.match(JSON.stringify(details),/Induk INDEX-JAN/);
  assert.doesNotMatch(JSON.stringify(details),/INDEX-FEB/);
  const [viewer]=await Promise.all([ctx.waitForEvent('page'),app.getByRole('button',{name:'Buka di Analisis',exact:true}).click()]);
  await viewer.waitForFunction(owner=>document.querySelector('#taxpayer option:checked')?.textContent.includes(owner),wp);
  await viewer.locator('#navigation').getByRole('button',{name:'SPT',exact:true}).click();
  await viewer.locator('summary').getByText('Tabel SPT hasil tarikan',{exact:true}).click();
  await viewer.locator('summary').getByText('Daftar SPT dilaporkan',{exact:true}).click();
  const index=viewer.getByRole('table',{name:'Daftar SPT dilaporkan',exact:true});
  await index.getByRole('cell',{name:'INDEX-JAN',exact:true}).waitFor();
  assert.equal(await index.locator('tbody tr').count(),2);
  await index.getByRole('cell',{name:'INDEX-FEB',exact:true}).waitFor();
  const forms=viewer.getByRole('table',{name:'Daftar SPT',exact:true});
  await forms.getByRole('row').filter({hasText:/Januari 2025|2025-01/}).getByRole('button',{name:'Buka',exact:true}).click();
  await viewer.getByRole('dialog').getByText('Induk INDEX-JAN',{exact:true}).waitFor();
  assert.equal(source.url(),home);
  const preview=await ctx.newPage();
  await preview.goto(app.url());
  await configure(preview,wp);
  await preview.getByRole('button',{name:'Pratinjau WP',exact:true}).click();
  const plan=preview.getByRole('table',{name:'SPT dalam periode terpilih',exact:true});
  await plan.waitFor();
  assert.deepEqual((await plan.locator('tbody tr > *').allInnerTexts()).slice(0,2),['1','1']);
  await preview.locator('#preview-box').getByText(/1 baris di luar periode/).waitFor();
  await preview.waitForFunction(async url=>(await chrome.tabs.query({url:'https://coretax.intranet.pajak.go.id/*'})).every(tab=>tab.url===url),home);
  assert.equal(source.url(),home);
  assert.deepEqual(blocked,[]);
  console.log('Mulai tarik dan Pratinjau WP berjalan dari beranda. Dua baris daftar dan satu isi SPT Januari terverifikasi di ZIP dan Analisis. Detail Februari tidak dikunjungi. NPWP yang tidak ditemukan tidak menghasilkan paket.');
} finally {
  await close();
}
