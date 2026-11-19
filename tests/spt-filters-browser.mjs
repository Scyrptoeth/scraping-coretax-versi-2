import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createPackage,readPackage} from '../extension/archive/package.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixtureDir=process.env.VERITAX_FIXTURES;
if(!fixtureDir)throw Error('Set VERITAX_FIXTURES to the directory containing the fictitious Badan ZIP.');
const demo=await readFile(join(fixtureDir,'CONTOH-paket-DEMO-FIKTIF.zip'));
const example=await readPackage(demo);
const list=example.entries.find(e=>e.path==='spt/daftar.json');
const fixture=async entries=>Buffer.from(await (await createPackage({meta:example.manifest,entries})).arrayBuffer());
const listOnly=await fixture([list]);
const noList=await fixture(example.entries.filter(e=>e!==list));
const original=['asli',demo],listed=['daftar-saja',listOnly],captured=['tanpa-daftar',noList];
const normalise=s=>s.replace(/\s+/g,' ').trim();
async function launch(dir,run){
  const profile=await mkdtemp(join(tmpdir(),'uji-filter-spt-'));let browser;
  try{
    browser=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,offline:true,
      executablePath:process.env.CHROMIUM_PATH||undefined,args:['--disable-background-networking','--disable-extensions-except='+dir,'--load-extension='+dir]});
    const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
    await run(browser,new URL('analisis/index.html',worker.url()).href);
  }finally{await browser?.close();await rm(profile,{recursive:true,force:true});}
}
async function load(page,url,entry,studio){
  await page.goto(url);const start=page.getByRole('button',{name:'Mulai',exact:true});
  if(studio&&await start.isVisible())await start.click();
  await page.locator('#filePkg').setInputFiles({name:entry[0]+'.zip',mimeType:'application/zip',buffer:entry[1]});
  if(studio)await page.waitForFunction(()=>!!document.querySelector('#wpSel')?.value);
  else await page.getByText('Konsisten · Seluruh sidik jari yang diperiksa cocok.').waitFor();
}
async function studioEvidence(browser,url){
  for(const entry of [original,listed,captured]){
    const page=await browser.newPage();page.setDefaultTimeout(5000);await load(page,url,entry,true);
    const tab=page.locator('#tabs button').filter({hasText:/^SPT/});
    const navigation=normalise(await tab.innerText());await tab.click();
    const buttons=page.locator('button:visible');
    const read=async()=> (await buttons.allInnerTexts()).map(normalise).filter(s=>/^(?:Semua(?:\s+\d+)?|SPT (?:Masa|Tahunan).+? \d+|20\d\d(?: \d+)?)$/.test(s));
    const scope=await read();
    assert.equal(navigation,entry===captured?'SPT':'SPT76');
    if(entry===listed)assert.deepEqual(scope,[]);
    else for(const choice of ['Semua 73','2025 36','2024 37','SPT Masa PPN 24'])assert.ok(scope.includes(choice),choice);
    if(entry===original){
      await buttons.filter({hasText:/^2025/}).click();
      assert.ok((await read()).includes('Semua 36'));
      await buttons.filter({hasText:/SPT Masa PPN/}).click();
      assert.ok((await read()).includes('2024 12'));
      await buttons.filter({hasText:/Hanya versi terakhir/}).click();
      const all=await read();for(const choice of ['Semua 38','SPT Masa PPN 14','2025 14','2024 13'])assert.ok(all.includes(choice),choice);
    }
    await page.close();
  }
}
async function v2Evidence(browser,url){
  const page=await browser.newPage({viewport:{width:1240,height:800}});page.setDefaultTimeout(6000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const nav=page.getByRole('navigation',{name:'Bagian aplikasi'}),tab=nav.getByRole('button',{name:'SPT',exact:true});
  const years=page.getByRole('group',{name:'Filter tahun pajak SPT'}),kinds=page.getByRole('group',{name:'Filter jenis SPT'});
  const year=page.getByRole('combobox',{name:'Tahun pajak',exact:true}),kind=page.getByRole('combobox',{name:'Jenis',exact:true});
  const latest=page.getByRole('checkbox',{name:'Versi terakhir',exact:true}),amended=page.getByRole('checkbox',{name:'Pembetulan',exact:true});
  const chip=(group,name,n)=>group.getByRole('button',{name:name+', '+n+' formulir SPT',exact:true});
  const table=page.getByRole('table',{name:'Daftar SPT',exact:true});
  const rows=async n=>{await table.waitFor();assert.equal(await table.locator('tbody tr').count(),n);};
  await load(page,url,original,false);
  assert.equal(await tab.locator('.spt-count').innerText(),'76');await tab.click();
  await chip(years,'2025',36).waitFor();assert.equal(await year.inputValue(),'');await rows(50);
  await page.evaluate(()=>{window.print=()=>{const view=document.querySelector('.spt-print-list');window.printedSpt={rows:view?.querySelectorAll('table tr').length-1,text:view?.innerText};};});
  const print=page.getByRole('button',{name:'Cetak daftar ini (PDF)',exact:true});
  await print.click();assert.equal(await page.evaluate(()=>window.printedSpt.rows),73);
  const selected=page.getByRole('region',{name:'Formulir SPT pilihan'}),second=table.locator('.spt-period').nth(1);
  await second.focus();await page.keyboard.press('Enter');
  assert.equal(await second.getAttribute('aria-pressed'),'true');assert.ok(await selected.getByRole('combobox',{name:'Induk / lampiran'}).count());
  await chip(years,'2025',36).click();await rows(36);
  await chip(years,'Semua tahun',73).click();assert.equal(await year.inputValue(),'');await chip(kinds,'PPN',24).waitFor();
  const ppn=chip(kinds,'PPN',24);await ppn.focus();await page.keyboard.press('Enter');
  assert.equal(await ppn.evaluate(b=>document.activeElement===b),true);assert.equal(await kind.inputValue(),'PPN');await rows(24);
  const search=page.getByRole('searchbox',{name:'Cari di tabel Daftar SPT',exact:true});
  await search.fill('2024-07');const found=await table.locator('tbody tr').count();assert.ok(found>0&&found<24);
  await print.click();assert.equal(await page.evaluate(()=>window.printedSpt.rows),found);
  assert.match(await page.evaluate(()=>window.printedSpt.text),/Juli 2024/);await search.fill('');
  await chip(years,'2024',12).waitFor();await chip(years,'2025',12).click();await rows(12);await chip(kinds,'Semua jenis',36).waitFor();
  await latest.uncheck();await rows(14);await chip(years,'2024',13).waitFor();await chip(kinds,'Semua jenis',38).waitFor();
  await amended.check();await rows(2);await chip(years,'2024',1).waitFor();await chip(years,'2025',2).waitFor();
  await chip(years,'Semua tahun',3).click();await rows(3);
  await table.getByRole('button',{name:'Buka'}).first().click();await page.getByRole('dialog').getByRole('heading',{name:'Induk',exact:true}).waitFor();
  await page.getByRole('button',{name:'Tutup',exact:true}).click();
  await amended.uncheck();await year.selectOption('2024');await rows(13);assert.equal(await chip(years,'2024',13).getAttribute('aria-pressed'),'true');
  await kind.selectOption('BADAN');await rows(1);assert.equal(await chip(kinds,'PPh Badan',1).getAttribute('aria-pressed'),'true');
  await page.setViewportSize({width:390,height:844});await chip(years,'Semua tahun',2).click();await rows(2);
  for(const b of [...await years.getByRole('button').all(),...await kinds.getByRole('button').all()]){
    const bounds=await b.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=391);
  }
  await nav.getByRole('button',{name:'Kertas Kerja',exact:true}).click();await page.getByRole('button',{name:'KKP',exact:true}).click();
  assert.equal(await year.inputValue(),'2024');
  const active=page.getByLabel('WP aktif',{exact:true}),first=await active.inputValue();
  await nav.getByRole('button',{name:'Muat paket',exact:true}).click();
  await page.locator('#filePkg').setInputFiles(join(fixtureDir,'CONTOH-paket-DEMO-FIKTIF-BADAN-MIGRASI.zip'));
  await page.waitForFunction(()=>document.querySelector('#taxpayer').options.length===2);
  assert.equal(await tab.locator('.spt-count').innerText(),'105');await active.selectOption(first);
  assert.equal(await tab.locator('.spt-count').innerText(),'76');
  await page.close();
  for(const entry of [listed,captured]){
    const p=await browser.newPage();p.setDefaultTimeout(6000);await load(p,url,entry,false);
    const t=p.getByRole('navigation').getByRole('button',{name:'SPT',exact:true});
    assert.equal(await t.locator('.spt-count').count(),entry===listed?1:0);await t.click();
    if(entry===listed){
      assert.equal(await t.locator('.spt-count').innerText(),'76');
      await p.getByText('Paket ini belum memuat induk atau lampiran SPT yang bisa dibuka.').waitFor();
      assert.equal(await p.getByRole('group',{name:'Filter jenis SPT'}).count(),0);
    }else await p.getByRole('button',{name:'Semua tahun, 73 formulir SPT',exact:true}).waitFor();
    await p.close();
  }
  assert.deepEqual(errors,[]);
}
if(process.env.VERITAX_STUDIO_DIR){
  await launch(resolve(process.env.VERITAX_STUDIO_DIR),studioEvidence);
  console.log('Studio: 76 listed, 73 latest forms, 2025/2024 VAT 14/13 all versions; list-only and form-only confirmed.');
}
await launch(resolve(process.env.EXTENSION_DIR||'extension'),v2Evidence);
console.log('V2: full flow, yearly and cross-year counts, versions, scope, mobile controls and keyboard verified.');
