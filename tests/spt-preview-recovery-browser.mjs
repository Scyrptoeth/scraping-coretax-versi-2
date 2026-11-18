import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPackage} from '../extension/archive/package.js';
import {listPage,site,wp,other,route,pages} from './spt-preview-browser.mjs';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const extension=process.env.EXTENSION_DIR||fileURLToPath(new URL('../extension/',import.meta.url));
const expired=site+'/uji-sesi-habis',pass='uji-fiktif-kemajuan';
async function raw(page){
  return page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('scv2-capture-vault');r.onsuccess=()=>resolve(r.result);});
    const rows=await new Promise(resolve=>{const r=db.transaction('items').objectStore('items').getAll();r.onsuccess=()=>resolve(r.result);});
    db.close();return rows.map(({id,content})=>({id,sealed:Boolean(content.iv && content.data),plain:content.plain?.kind}));
  });
}
async function identify(ui,id){
  await ui.locator('#ids').fill(id);await ui.locator('#officer').fill('Penguji fiktif');
  for(const field of ['start','end'])await ui.locator('#year-'+field).selectOption('2025');
  await ui.locator('#month-start').selectOption('01');await ui.locator('#month-end').selectOption('03');
  await ui.locator('#sources input[value=sptdaftar]').check();await ui.locator('#consent').check();
}
async function verify(encrypted){
  const profile=await mkdtemp(path.join(tmpdir(),'scv2-recovery-'));let ctx;
  try{
    ctx=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,acceptDownloads:true,
      args:['--disable-background-networking','--disable-extensions-except='+extension,'--load-extension='+extension]});
    let mode='expire',owner=wp;const unexpected=[];
    await ctx.route(/^https?:\/\//,r=>{
      const url=r.request().url();
      if([route(1),route(2)].includes(url)){
        const extra=mode==='expire'?'location.assign("'+expired+'")':mode==='pending'?'console.log("waiting-for-source-page")':'';
        return r.fulfill({contentType:'text/html; charset=utf-8',body:listPage(url,owner,'normal')+(extra?'<script>next.onclick=()=>{'+extra+'}</script>':'')});
      }
      if(url===expired)return r.fulfill({contentType:'text/html',body:'<title>Sesi uji habis</title><h1>Sesi uji habis</h1>'});
      if(url!==site+'/favicon.ico')unexpected.push(r.request().method());return r.abort();
    });
    const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker'),source=await ctx.newPage();await source.goto(route(1));
    const open=async()=>{const page=await ctx.newPage();page.setDefaultTimeout(8000);await page.goto(new URL('app.html',worker.url()).href);return page;};
    let ui=await open();await identify(ui,wp);assert.equal(await ui.locator('#preview-save').isChecked(),false);
    await ui.locator('#preview').click();await source.waitForURL(expired);
    await ui.locator('#preview-box').getByText(/1 halaman daftar dan 2 baris sumber terbaca.*Cakupan sebagian/).waitFor();
    assert.deepEqual(await raw(ui),[]);await ui.reload();await ui.locator('#security').getByText(/Simpanan lokal/).waitFor();
    if(encrypted){
      await ui.locator('#new-pass').fill(pass);await ui.locator('#repeat-pass').fill(pass);await ui.locator('#encrypt').click();
      await ui.locator('#security').getByText(/Enkripsi AES-256 aktif/).waitFor();
    }
    mode='pending';await source.goto(route(1));await identify(ui,other);await ui.locator('#preview-save').check();
    await ui.locator('#preview').click();await ui.locator('#notice').getByText(/belum cocok/).waitFor();assert.deepEqual(await raw(ui),[]);
    await ui.locator('#ids').fill(wp);assert.equal(await ui.locator('#preview-save').isChecked(),false);await ui.locator('#preview-save').check();
    const next=source.waitForEvent('console',{predicate:m=>m.text()==='waiting-for-source-page'});await ui.locator('#preview').click();await next;
    await ui.locator('#preview-read-status').getByText(/Kemajuan tersimpan di perangkat/).waitFor();await ui.close();
    ui=await open();const items=await raw(ui);assert.equal(items.length,2);assert.ok(items.every(it=>!it.id.includes(wp)&&it.sealed===encrypted));
    if(encrypted){
      await ui.locator('#unlock-panel').waitFor();assert.equal(await ui.locator('#workspace').isVisible(),false);assert.equal(await ui.locator('#preview-recovery').innerText(),'');
      await ui.locator('#unlock-pass').fill(pass);await ui.locator('#unlock-form button').click();await ui.locator('#workspace').waitFor();
    }
    const saved=ui.locator('#preview-recovery'),use=saved.getByRole('button',{name:'Gunakan halaman tersimpan'}),resume=saved.getByRole('button',{name:'Lanjutkan dari tab Coretax'});
    await saved.getByText(/Ada pratinjau tersimpan/).waitFor();assert.equal(await ui.locator('#consent').isChecked(),false);
    assert.equal(await ui.locator('#ids').inputValue(),'');assert.equal(await ui.locator('#preview-save').isChecked(),false);
    await identify(ui,other);assert.equal(await use.count(),0);
    await ui.locator('#ids').fill(wp);await ui.locator('#month-end').selectOption('04');assert.equal(await use.count(),0);
    await ui.locator('#month-end').selectOption('03');await use.waitFor();
    await ui.locator('#letter').fill('Surat fiktif berbeda');assert.equal(await use.count(),0);await ui.locator('#letter').fill('');await use.waitFor();
    await ui.locator('#officer').fill('Petugas lain');assert.equal(await use.count(),0);assert.equal(await saved.getByRole('button',{name:'Hapus pratinjau tersimpan'}).count(),0);
    await ui.locator('#officer').fill('');assert.equal(await use.count(),0);await ui.locator('#officer').fill(' Penguji fiktif ');await use.waitFor();
    await ui.locator('#nip').fill('UJI-02');assert.equal(await use.count(),0);await ui.locator('#nip').fill('');await use.waitFor();
    mode='normal';owner=other;await source.goto(route(1));await resume.click();await ui.locator('#notice').getByText(/belum cocok/).waitFor();
    assert.equal(await ui.locator('#queue .item').count(),0);
    owner=wp;await source.goto(route(2));await resume.click();await ui.locator('#notice').getByText(/alamat daftar/).waitFor();assert.equal(await ui.locator('#queue .item').count(),0);
    await source.goto(expired);await use.click();await ui.locator('#preview-box').getByText(/1 halaman daftar dan 2 baris sumber terbaca.*Cakupan sebagian/).waitFor();
    assert.equal(await ui.locator('#queue .item').count(),1);
    await ui.locator('#officer').fill('Petugas lain');await ui.locator('#start').click();
    await ui.locator('#notice').getByText(/Penugasan atau pilihan SPT berbeda/).waitFor();
    assert.equal(await ui.locator('#results').getByRole('button',{name:'Unduh paket'}).count(),0);
    await ui.locator('#officer').fill('Penguji fiktif');await use.waitFor();
    await source.goto(route(1));await resume.click();
    const full=ui.locator('#preview-box').getByText(/2 halaman daftar dan 4 baris sumber terbaca.*Awal dan akhir/);
    await full.waitFor();await saved.getByText(/1 halaman daftar dan 2 baris sumber terbaca/).waitFor();
    await ui.locator('#preview-save').check();await resume.click();
    const durable=saved.getByText(/2 halaman daftar dan 4 baris sumber terbaca.*Awal dan akhir/);await durable.waitFor();assert.equal((await raw(ui)).length,3);
    await ui.locator('#preview-index-limit').fill('1');await resume.click();await ui.locator('#preview-read-status').getByText(/sebelumnya tetap digunakan/).waitFor();
    await full.waitFor();await durable.waitFor();
    await ui.locator('#start').click();await ui.getByRole('button',{name:'Unduh paket'}).first().click();
    const [download]=await Promise.all([ui.waitForEvent('download'),ui.locator('#package-dialog button[value=ok]').click()]);
    const pkg=await readPackage(await readFile(await download.path()));assert.ok(pkg.report.valid);assert.equal(pkg.manifest.wp.npwp,wp);
    const entry=pkg.entries.find(e=>e.path==='spt/daftar.json');assert.equal(entry.cap.lengkap,false);
    assert.deepEqual(entry.pages.flatMap(p=>p.Payload.Data.map(r=>r['ID SPT'])),pages.flat().map(r=>r.at(-1)));
    const handoff=ctx.waitForEvent('page');await ui.getByRole('button',{name:'Buka di Analisis'}).first().click();
    const viewer=await handoff;await viewer.getByText(/1 berkas diperiksa/).first().waitFor();
    await viewer.locator('#navigation').getByRole('button',{name:'SPT',exact:true}).click();await viewer.locator('summary').getByText('Daftar SPT dilaporkan',{exact:true}).click();
    await viewer.getByRole('table',{name:'Daftar SPT dilaporkan',exact:true}).getByRole('cell',{name:'JAN-BETUL',exact:true}).waitFor();
    ui.once('dialog',d=>d.accept());await saved.getByRole('button',{name:'Hapus pratinjau tersimpan'}).click();
    await durable.waitFor({state:'detached'});assert.equal((await raw(ui)).length,1);assert.deepEqual(unexpected,[]);
  }finally{await ctx?.close();await rm(profile,{recursive:true,force:true});}
}
await verify(false);await verify(true);
console.log('PASS: recovery of verified directory pages after tab closure, opt-in, scope checks, encrypted storage, partial coverage, deduplication, archive and viewer.');
