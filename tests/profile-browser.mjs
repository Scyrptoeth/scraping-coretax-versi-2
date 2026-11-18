// Run with VERITAX_FIXTURES pointing to the four local fictitious reference packages.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readZip, decodeText} from '../extension/archive/zip.js';

const fixtureDir=process.env.VERITAX_FIXTURES;
if(!fixtureDir)throw Error('Set VERITAX_FIXTURES to the reference fixture directory.');
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=new URL('../extension/',import.meta.url);
const server=createServer(async(req,res)=>{
  try{const file=new URL('.'+new URL(req.url,'http://localhost').pathname,base);
    if(!file.href.startsWith(base.href)) throw Error('Unexpected path');
    res.setHeader('Content-Type',file.pathname.endsWith('.js')?'text/javascript':file.pathname.endsWith('.css')?'text/css':'text/html');
    res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined});
try{
  const page=await browser.newPage({viewport:{width:1280,height:850},acceptDownloads:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/analisis/index.html');
  const nav=t=>page.getByRole('navigation').getByRole('button',{name:t,exact:true});
  const load=async stem=>{
    await nav('Muat paket').click();await page.locator('#filePkg').setInputFiles(resolve(fixtureDir,'CONTOH-paket-DEMO-FIKTIF'+stem+'.zip'));
    await page.getByText('Konsisten · Seluruh sidik jari yang diperiksa cocok.').waitFor();
    await nav('Profil WP').click();await page.getByRole('heading',{name:'Profil utama'}).waitFor();
  };
  await load('');
  await page.getByRole('button',{name:'Pemegang saham (3)',exact:true}).click();
  const table=page.getByRole('table',{name:'Pemegang saham'});await table.waitFor();assert.equal(await table.locator('tbody tr').count(),3);
  await table.getByText('Hanya di registrasi',{exact:true}).waitFor();
  await table.getByText('Hanya di SPT Badan',{exact:true}).waitFor();
  const received=page.waitForEvent('download');await page.getByRole('button',{name:'Excel semua bagian'}).click();
  const d=await received;assert.equal(d.suggestedFilename(),'RAHASIA-Profil-WP.xlsx');
  const files=await readZip(await readFile(await d.path()));
  assert.match(decodeText(files.get('xl/workbook.xml').data),/Pemegang saham/);
  assert.ok([...files.keys()].some(key=>key.startsWith('xl/worksheets/')&&decodeText(files.get(key).data).includes('Hanya di registrasi')));
  await load('-BADAN-MIGRASI');
  await page.getByRole('button',{name:'Pemegang saham (1)',exact:true}).click();await page.getByRole('cell',{name:'Cocok',exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});
  for(const stem of ['-OP','-OP-PEKERJAAN-BEBAS']){
    await load(stem);await page.getByRole('combobox',{name:'Bagian profil WP'}).selectOption('op-harta');
    await page.getByRole('table',{name:'Harta dan utang'}).waitFor();
    assert.equal(await page.getByRole('combobox',{name:'Bagian profil WP'}).locator('option[value="saham"]').count(),0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  assert.deepEqual(errors,[]);
  console.log('Profile UI passed: four fictitious packages, corporate shares and workbook, OP assets and mobile menus.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
