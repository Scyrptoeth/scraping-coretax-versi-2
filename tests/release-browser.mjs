import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const {version}=JSON.parse(await readFile(path.join(root,'extension/manifest.json'),'utf8'));
const temporary=await mkdtemp(path.join(tmpdir(),'coretax-v2-release-'));
const extension=path.join(temporary,'extension');
let context;
try {
  await mkdir(extension);
  execFileSync('unzip',['-q',path.join(root,'dist/site/download',`scraping-coretax-v2-${version}.zip`),'-d',extension]);
  context=await chromium.launchPersistentContext(path.join(temporary,'profile'),{
    channel:'chromium',executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,
    args:['--disable-extensions-except='+extension,'--load-extension='+extension],
    viewport:{width:1240,height:860}
  });
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const manifest=await worker.evaluate(()=>chrome.runtime.getManifest());
  assert.equal(manifest.name,'Scraping Coretax Versi 2');assert.equal(manifest.version,version);
  const origin=worker.url().slice(0,worker.url().lastIndexOf('/'));
  const page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/app.html');
  await page.getByText('Belum ada hasil penarikan.').waitFor();
  await page.getByRole('link',{name:'Buka Analisis'}).click();
  await page.getByRole('button',{name:'Peraturan',exact:true}).first().click();
  await page.getByPlaceholder('Nomor, judul, atau kata kunci').fill('PER-12/PJ/2022');
  await page.getByRole('button',{name:'PER-12/PJ/2022',exact:true}).click();
  await page.getByRole('link',{name:'Buka naskah di situs DJP'}).waitFor();
  await page.getByRole('button',{name:'Tutup',exact:true}).click();
  await page.getByRole('button',{name:'Probis',exact:true}).first().click();
  await page.getByRole('button',{name:'Cari KLU/KBLI'}).click();
  await page.getByPlaceholder('Kode atau nama kegiatan').fill('01111');
  await page.getByRole('button',{name:'01111',exact:true}).click();
  await page.getByRole('heading',{name:/01111.*PERTANIAN JAGUNG/}).waitFor();
  assert.deepEqual(errors,[]);
  console.log(`Chrome for Testing loaded v${version} from the ZIP, started the MV3 worker, opened both pages and queried both catalogs.`);
} finally {
  if(context) await context.close();
  await rm(temporary,{recursive:true,force:true});
}
