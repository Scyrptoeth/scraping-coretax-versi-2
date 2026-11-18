import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {kluAttachment} from '../extension/klu-z.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined});
try{
  const page=await browser.newPage();
  const base=new URL('../extension/',import.meta.url);
  await page.route('http://klu.test/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const file=new URL('.'+path,base);
    if(!file.href.startsWith(base.href))return route.abort();
    try{
      const contentType=path.endsWith('.html')?'text/html':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'application/octet-stream';
      await route.fulfill({contentType,body:await readFile(file)});
    }catch{await route.fulfill({status:404,body:''});}
  });
  await page.goto('http://klu.test/analisis/index.html');
  await page.getByRole('button',{name:'Probis',exact:true}).first().click();
  await page.getByRole('button',{name:'Cari KLU/KBLI'}).click();
  const search=page.getByPlaceholder('Kode atau nama kegiatan');
  await page.getByRole('combobox',{name:'Acuan klasifikasi'}).selectOption('2020');
  await search.fill('01283');await page.getByRole('button',{name:'01283',exact:true}).click();
  const mapping=page.getByRole('dialog');
  await mapping.getByRole('heading',{name:'Padanan KBLI 2025',exact:true}).waitFor();
  await mapping.getByText(/Lampiran 5 · halaman/).waitFor();
  await mapping.getByRole('button',{name:/^01138 ·/}).click();
  await mapping.getByRole('heading',{name:'Padanan KBLI 2020',exact:true}).waitFor();
  await mapping.getByRole('button',{name:/^01283 ·/}).waitFor();
  await mapping.getByRole('button',{name:'Tutup',exact:true}).click();
  await page.getByRole('combobox',{name:'Acuan klasifikasi'}).selectOption('current');
  await search.fill('pegawai pemerintah perjanjian');
  await page.getByRole('button',{name:'Z2200',exact:true}).click();
  const dialog=page.getByRole('dialog');
  assert.match(await dialog.textContent(),/Golongan pokok · Z2 · APARATUR SIPIL NEGARA/);
  assert.match(await dialog.textContent(),/Halaman lampiran · 3–4/);
  assert.equal(await dialog.getByRole('link',{name:'Buka lampiran resmi DJP'}).getAttribute('href'),kluAttachment+'#page=3');
  assert.equal(await dialog.getByText('Panduan penelusuran awal').count(),0);
  await dialog.getByRole('button',{name:'Tutup',exact:true}).click();
  await page.getByRole('combobox',{name:'Acuan klasifikasi'}).selectOption('KLU Z');
  await search.fill('');await page.getByText('18 hasil',{exact:true}).waitFor();
  await page.getByRole('combobox',{name:'Tingkat'}).selectOption('');await page.getByText('60 hasil',{exact:true}).waitFor();
  await page.getByRole('combobox',{name:'Tingkat'}).selectOption('1');await page.getByRole('button',{name:'Z',exact:true}).waitFor();
  await page.evaluate(async()=>{
    const {renderCatalog}=await import('/catalog.js');
    const isolated=document.createElement('div');document.body.append(isolated);
    renderCatalog(isolated,'probis',{manifest:{},entries:[{path:'profil/klu.json',pages:[{Payload:{Data:[{TradeClassificationCode:'Z7100'}]}}]}]});
  });
  await page.getByRole('button',{name:'Lihat Z7100 di katalog DJP'}).click();
  assert.match(await dialog.textContent(),/Halaman lampiran · 4–5/);
  await dialog.getByRole('button',{name:'Jadikan acuan WP pada sesi ini'}).click();
  await page.getByRole('button',{name:/Acuan sesi ini · Z7100/}).waitFor();
  const calc=page.locator('.card').filter({has:page.getByRole('heading',{name:'Uji KLU utama',exact:true})}).last();
  await calc.getByRole('button',{name:'Tambah kegiatan'}).click();
  const codes=calc.getByLabel('Kode kelompok'),amounts=calc.getByLabel('Peredaran bruto atau penghasilan (Rp)');
  for(const [i,[code,amount]] of [['25120','56'],['28160','55'],['46591','100']].entries()){
    await codes.nth(i).fill(code);await amounts.nth(i).fill(amount);
  }
  await calc.getByRole('button',{name:'Hitung'}).click();
  await calc.getByText(/Kelompok hasil uji · 25120/).waitFor();
  assert.equal(await calc.locator('details').count(),5);
  await codes.first().fill('');await calc.getByRole('button',{name:'Hitung'}).click();
  await calc.getByText(/Baris 1 memerlukan kode/).waitFor();assert.equal(await calc.locator('details').count(),0);
  console.log('PASS: KLU Z search and detail, registered and session codes, hierarchical calculator, trace and incomplete input.');
}finally{await browser.close();}
