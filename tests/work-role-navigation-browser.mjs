import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createPackage} from '../extension/archive/package.js';
import {draftTitles} from '../extension/analisis/draft-model.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const extension=resolve(process.env.EXTENSION_DIR||'extension');
const profile=await mkdtemp(join(tmpdir(),'work-roles-'));
let browser;
try{
  browser=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,offline:true,executablePath:process.env.CHROMIUM_PATH||undefined,
    args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
  const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.name));
  await page.goto(new URL('analisis/index.html',worker.url()).href);
  const button=name=>page.getByRole('button',{name,exact:true});
  const heading=name=>page.getByRole('heading',{name,exact:true});
  const pkg=await createPackage({meta:{wp:{npwp:'0000000000000001',nama:'WP fiktif'},opsi:{periode:{from:{y:2025,m:1},to:{y:2025,m:12}}}},
    entries:[{path:'bukubesar/2025-01.json',cap:{sumber:'bbdetil',lengkap:true},pages:[{Payload:{Data:[{
      RecordId:'contoh',AccountingTypeCode:'TaxReturn',IsCancelled:false,Amount:-2500,AmountLeft:-500} ]}}]}]});
  await page.locator('#filePkg').setInputFiles({name:'contoh.zip',mimeType:'application/zip',buffer:Buffer.from(await pkg.arrayBuffer())});
  await page.getByText('Konsisten · Seluruh sidik jari yang diperiksa cocok.').waitFor();
  const nav=page.getByRole('navigation',{name:'Bagian aplikasi'}),role=page.locator('#role');
  const groups={Pemeriksa:['Susun BAPK'],AR:['Susun SP2DK','Susun BAP2DK'],Penelaah:['Telaah temuan KKA']};
  for(const [name,labels] of Object.entries(groups)){
    await role.selectOption(name);await nav.getByRole('button',{name:'Kertas Kerja'}).click();
    await page.waitForURL(url=>url.hash==='#/kerja');
    const group=page.getByRole('group',{name:'Pintasan '+name});
    await group.waitFor();assert.deepEqual(await group.getByRole('button').allTextContents(),labels);
    await page.getByRole('button',{name:name==='Pemeriksa'?'KKP':'KKA',exact:true,pressed:true}).waitFor();
    for(const label of labels){
      await group.getByRole('button',{name:label,exact:true}).click();
      if(name==='Penelaah'){
        await heading('Rincian dan penelaahan temuan').waitFor();
        assert.equal(new URL(page.url()).hash,'#/kerja/telaah');
        const findings=page.getByRole('table',{name:'Daftar temuan',exact:true});
        await findings.getByRole('button',{name:'Buka'}).first().click();
        await page.getByLabel('Hasil penelaahan').selectOption('Terjelaskan');
        await findings.getByRole('cell',{name:'Terjelaskan',exact:true}).first().waitFor();
        await button('KKA').click();
        await page.getByRole('table',{name:'Daftar temuan',exact:true}).getByRole('cell',{name:'Terjelaskan',exact:true}).first().waitFor();
      }else{
        const type=label.split(' ')[1];await heading(draftTitles[type]).waitFor();
        assert.equal(new URL(page.url()).hash,'#/kerja/ba');
        assert.equal(await button(type).getAttribute('aria-pressed'),'true');
      }
    }
    assert.equal(await page.getByRole('button',{name:/SE-08|ND-306/}).count(),0);
  }
  const base=page.url().split('#')[0];
  for(const mode of ['kkp','kka','sim','ba']){
    await page.goto(base+'#/kerja/'+mode);
    if(mode==='ba')await page.getByText('Pilih peran AR atau Pemeriksa untuk menyiapkan konsep.').waitFor();
    else await page.getByRole('button',{name:{kkp:'KKP',kka:'KKA',sim:'Simulasi sanksi'}[mode],exact:true,pressed:true}).waitFor();
    assert.equal(new URL(page.url()).hash,'#/kerja/'+mode);
  }
  assert.deepEqual(errors,[]);console.log('Role shortcuts passed for all three roles, all three draft types, shared review edits and four existing work routes.');
}finally{await browser?.close();await rm(profile,{recursive:true,force:true});}
