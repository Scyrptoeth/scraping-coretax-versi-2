import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {visibleTables} from '../extension/app-data.js';
import {readPackage} from '../extension/archive/package.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=new URL('../extension/',import.meta.url);
const server=createServer(async (req,res) => {
  try {
    const pathname=new URL(req.url,'http://localhost').pathname;
    const file=new URL('.'+pathname,base);
    if (!file.href.startsWith(base.href)) throw Error('Unexpected path');
    const body=await readFile(fileURLToPath(file));
    res.setHeader('Content-Type',pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(body);
  } catch {res.statusCode=404;res.end();}
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined});
try {
  const page=await browser.newPage({viewport:{width:1280,height:880},acceptDownloads:true});
  const errors=[];page.on('pageerror',e => errors.push(e.message));
  const origin='http://127.0.0.1:'+server.address().port;
  await page.goto(origin+'/app.html');
  await page.getByText('Belum ada hasil penarikan.').waitFor();
  assert.equal(await page.locator('fieldset section').count(),5);
  assert.equal(await page.locator('#sources input').count(),20);
  for (const width of [1280,390]) {
    await page.setViewportSize({width,height:880});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  }
  if(process.env.SCRAPER_SCREENSHOT) await page.screenshot({path:process.env.SCRAPER_SCREENSHOT});
  await page.locator('#ids').fill('0000000000000001\n0000000000000002');
  await page.locator('#officer').fill('Petugas Fiktif');
  await page.locator('#scope-ok').check();
  await page.locator('#source-files').setInputFiles({name:'keliru.csv',mimeType:'text/csv',buffer:Buffer.from('NPWP,Nilai\n0000000000000002,25')});
  await page.locator('#notice').filter({hasText:'NPWP pada sumber berbeda'}).waitFor();
  const input={name:'contoh.csv',mimeType:'text/csv',buffer:Buffer.from('NPWP,Keterangan,Nilai\n0000000000000001,Uji,0')};
  await page.locator('#scope-ok').check();
  await page.locator('#source-files').setInputFiles([input,{...input,name:'duplikat.csv'}]);
  await page.locator('#queue .item').nth(1).waitFor();
  assert.equal(await page.locator('#start').isEnabled(),false);
  await page.locator('#consent').check(); await page.locator('#preview').click();
  assert.equal(await page.locator('#preview-box input:checked').count(),1);
  assert.equal(await page.locator('#preview-box input:disabled').count(),1);
  await page.locator('#start').click();
  await page.locator('#results button').first().waitFor();
  await page.locator('#results').getByText('Unduh paket').click();
  const getDownload=page.waitForEvent('download');
  await page.locator('#package-dialog button[value="ok"]').click();
  const download=await getDownload;
  assert.match(download.suggestedFilename(),/0000000000000001.+zip$/);
  const parsed=await readPackage(await readFile(await download.path()));
  assert.equal(parsed.report.valid,true); assert.equal(parsed.entries.length,1);
  assert.equal(parsed.manifest.wp.npwp,'0000000000000001');
  assert.equal(parsed.entries[0].pages[0].Payload.Data[0].Nilai,'0');
  assert.equal(JSON.stringify(parsed.manifest).includes('0000000000000002'),false);
  await page.locator('#new-pass').fill('Password fiktif');
  await page.locator('#repeat-pass').fill('Password fiktif');
  await page.locator('#encrypt').click(); await page.locator('#lock').waitFor();
  const envelopes=await page.evaluate(async () => {
    const db=await new Promise(resolve => {const r=indexedDB.open('scv2-capture-vault');r.onsuccess=()=>resolve(r.result);});
    try{return await Promise.all(['items','audit'].map(name => new Promise(resolve => {
      const r=db.transaction(name).objectStore(name).getAll();r.onsuccess=()=>resolve(r.result.every(x=>x.content.data instanceof ArrayBuffer && !('plain' in x.content)));
    })));} finally{db.close();}
  });
  assert.deepEqual(envelopes,[true,true]);
  await page.locator('#lock').click(); await page.locator('#unlock-panel').waitFor();
  await page.locator('#unlock-pass').fill('wrong'); await page.locator('#unlock-form button').click();
  await page.locator('#notice').filter({hasText:'Kata sandi tidak cocok'}).waitFor();
  await page.locator('#unlock-pass').fill('Password fiktif'); await page.locator('#unlock-form button').click();
  await page.locator('#results .item').waitFor();
  await page.locator('#audit').evaluate(el=>el.closest('details').open=true);
  const auditDownload=page.waitForEvent('download');
  await page.locator('#audit').click();
  const csv=await readFile(await (await auditDownload).path(),'utf8');
  assert.match(csv,/Unduh paket/);assert.doesNotMatch(csv,/Putus/);
  const transfer=await page.evaluate(async () => {
    const {putHandoff,readHandoff}=await import('./app-handoff.js');
    const id=crypto.randomUUID(), text='PAKET FIKTIF', encoder=new TextEncoder();
    await putHandoff(id,new Blob([text]));
    const db=await new Promise(resolve=>{const req=indexedDB.open('scv2-handoff');req.onsuccess=()=>resolve(req.result);});
    const raw=await new Promise(resolve=>{const req=db.transaction('packages').objectStore('packages').get(id);req.onsuccess=()=>resolve(req.result);});
    db.close();
    const result={clear:await (await readHandoff(id)).text(),protected:raw.size>encoder.encode(text).length && raw.type==='application/x-scv2-handoff'};
    await putHandoff(id,null); result.consumed=!(await readHandoff(id)); return result;
  });
  assert.deepEqual(transfer,{clear:'PAKET FIKTIF',protected:true,consumed:true});
  await page.locator('#results').getByText('Buka di Analisis').click();
  await page.waitForFunction(()=>location.pathname.endsWith('/analisis/index.html') && !location.search &&
    document.querySelector('#taxpayer option:checked')?.textContent.includes('0000000000000001'));
  const remaining=await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('scv2-handoff');r.onsuccess=()=>resolve(r.result);});
    try{return await new Promise(resolve=>{const r=db.transaction('packages').objectStore('packages').count();r.onsuccess=()=>resolve(r.result);});}
    finally{db.close();}
  });
  assert.equal(remaining,0);
  await page.setContent('<table hidden><tr><td>Rahasia tersembunyi</td></tr></table><table aria-label="Contoh"><thead><tr><th>NPWP</th><th>Nilai</th></tr></thead><tbody><tr><td>0000000000000001</td><td>0<span hidden>hidden</span></td></tr></tbody></table>');
  const [table]=await page.evaluate(visibleTables,null);
  assert.equal(table.rows,1); assert.equal(table.title,'Contoh');
  const rows=await page.evaluate(visibleTables,{...table,url:page.url()});
  assert.deepEqual(rows,[{NPWP:'0000000000000001',Nilai:'0'}]);
  const fixture=await browser.newPage();
  await fixture.goto(origin+'/app.html');
  await fixture.setContent('<section class="p-datatable"><table id="ledger"><thead><tr><th>NPWP</th><th>Nomor</th></tr></thead><tbody><tr><td>0000000000000001</td><td>1</td></tr></tbody></table><div class="p-paginator"><button type="button" id="next" aria-label="Next Page">›</button></div></section><button id="unrelated" aria-label="Next Page">Keluar</button>');
  await fixture.evaluate(()=>{window.wrongButton=false;document.getElementById('unrelated').onclick=()=>{window.wrongButton=true;};const next=document.getElementById('next');next.onclick=()=>{const cell=document.querySelector('tbody td:last-child');cell.textContent=String(Number(cell.textContent)+1);next.disabled=cell.textContent==='3';};});
  const client=await browser.newPage();
  await client.exposeFunction('scv2FixtureRead',async arg=>fixture.evaluate(visibleTables,arg ? {...arg,url:fixture.url()} : null));
  await client.addInitScript(()=>{
    const testing={id:444,url:'https://coretax.intranet.pajak.go.id/fixture',title:'Tabel fiktif'};
    window.chrome={runtime:{id:'local-fixture'},tabs:{query:async()=>[testing],get:async()=>testing},scripting:{executeScript:async q=>[{result:await window.scv2FixtureRead(q.args[0])}]}};
  });
  await client.goto(origin+'/app.html');
  await client.locator('#ids').fill('0000000000000001');
  await client.locator('#scope-ok').check();await client.locator('#list-tables').click();
  await client.locator('#pagination-options summary').click();await client.locator('#page-limit').fill('2');
  await client.locator('#collect-pages').click();await client.locator('#queue .item').nth(1).waitFor();
  assert.equal(await fixture.locator('tbody td:last-child').textContent(),'2');
  await client.locator('#list-tables').click();
  await client.locator('#scope-ok').check();await client.locator('#page-limit').fill('5');
  await client.locator('#collect-pages').click();await client.locator('#queue .item').nth(3).waitFor();
  await client.locator('#table-pick').waitFor({state:'hidden'});
  assert.equal(await fixture.locator('tbody td:last-child').textContent(),'3'); assert.equal(await fixture.evaluate(()=>window.wrongButton),false);
  await fixture.evaluate(()=>{const next=document.getElementById('next');next.disabled=false;next.onclick=()=>{document.querySelector('tbody td').textContent='0000000000000002';};});
  await client.locator('#list-tables').click();await client.locator('#scope-ok').check();
  await client.locator('#collect-pages').click();
  await client.locator('#notice').filter({hasText:'NPWP tampilan berubah'}).waitFor();
  assert.equal(await client.locator('#queue .item').count(),5);
  await client.close(); await fixture.close();
  assert.deepEqual(errors,[]);
  console.log('Scraper browser passed: responsive form, mixed WP refusal, upload, preview, isolated WP, deduplication, ZIP, vault migration and lock, audit, encrypted handoff, visible DOM, scoped pagination and cross-WP interruption.');
} finally {await browser.close();await new Promise(resolve => server.close(resolve));}
