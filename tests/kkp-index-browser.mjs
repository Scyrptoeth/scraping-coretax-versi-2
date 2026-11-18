import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {readPackage} from '../extension/archive/package.js';
import {decodeText,readZip} from '../extension/archive/zip.js';
import {indexPackage} from '../extension/analisis/model.js';
import {buildIndex} from '../extension/analisis/kkp-index.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixtures=process.env.VERITAX_FIXTURES;
if(!fixtures)throw Error('Set VERITAX_FIXTURES to the local fictitious reference directory.');
const profile=await mkdtemp(join(tmpdir(),'coretax-kkp-test-')), extension=resolve('extension');
let browser;
try{
  browser=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,
    args:['--disable-extensions-except='+extension,'--load-extension='+extension],acceptDownloads:true});
  const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const url=worker.url().slice(0,worker.url().lastIndexOf('/'))+'/analisis/index.html';
  await page.goto(url);
  const names=(await readdir(fixtures)).filter(n=>n.startsWith('CONTOH-')&&n.endsWith('.zip'));assert.equal(names.length,4);
  const checks=new Set();
  for(const name of names){
    const bytes=await readFile(join(fixtures,name)),pkg=indexPackage(await readPackage(bytes));
    const op=pkg.forms.some(f=>f.type==='OP'),year=pkg.forms.find(f=>f.type===(op?'OP':'BADAN')).year;
    const index=buildIndex(pkg,year), group=index.groups.find(g=>g.ref===(op?'B-17':'B.1'));
    assert.ok(group, 'Expected an applicable workpaper in each fictitious package');
    await page.getByRole('navigation').getByRole('button',{name:'Muat paket',exact:true}).click();
    await page.locator('#filePkg').setInputFiles({name,mimeType:'application/zip',buffer:bytes});
    await page.waitForFunction(hash=>document.getElementById('taxpayer')?.value===hash,pkg.report.manifestHash);
    await page.getByText('Konsisten · Seluruh sidik jari yang diperiksa cocok.').waitFor();
    await page.getByRole('navigation').getByRole('button',{name:'Kertas Kerja',exact:true}).click();
    await page.getByRole('button',{name:'KKP',exact:true}).click();
    await page.getByLabel('Tahun pajak',{exact:true}).selectOption(year);
    await page.getByLabel('Pilih indeks KKP').selectOption(group.key);
    const table=page.getByRole('table',{name:'Pengujian per indeks'});
    await table.getByText(group.lines[0].topic,{exact:true}).first().waitFor();
    for(const g of index.groups)checks.add(g.key);
    if(op||checks.has('runtime-review'))continue;
    checks.add('runtime-review');
    const download=async title=>{
      const [file]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:title,exact:true}).click()]);
      return readFile(await file.path());
    };
    const line=group.lines[0], tested=line.amount+123;assert.ok(Number.isFinite(line.amount));
    await page.getByRole('button',{name:'Tambah permintaan dokumen'}).click();
    const dialog=page.getByRole('dialog');
    await dialog.getByLabel('Jenis dokumen').fill('Perincian uji');
    await dialog.getByLabel('Status dokumen').selectOption('Diterima');
    await dialog.getByLabel('Tanggal permintaan').fill('2025-11-01');
    await dialog.getByLabel('Tenggat menurut surat').fill('2025-12-01');
    await dialog.getByLabel('Nomor atau lokasi bukti').fill('EVID-FIKTIF-025');
    await dialog.getByRole('button',{name:'Simpan dokumen'}).click();
    await page.getByRole('table',{name:'Dokumen indeks terpilih'}).getByText('DOK.1').waitFor();
    await table.getByRole('button',{name:'Buka'}).first().click();
    await dialog.getByLabel('Nilai setelah pengujian').fill(String(tested));
    await dialog.getByLabel('Gunakan rujukan dokumen terkait').selectOption('1');
    await dialog.getByLabel('Penjelasan hasil uji').fill('Selisih pengujian fiktif.');
    await dialog.getByLabel('Nama penguji').fill('Petugas Fiktif');
    await dialog.getByLabel('Klasifikasi hasil yang berbeda').selectOption('verified');
    await dialog.getByRole('button',{name:'Simpan hasil uji'}).click();
    await table.getByText(/DOK.1 · Perincian uji · EVID-FIKTIF-025/).waitFor();
    await page.getByLabel('Ditelaah oleh').fill('Penelaah Fiktif');
    await page.getByRole('button',{name:'Buat revisi P1'}).click();
    await page.getByRole('button',{name:'Buat revisi P2'}).waitFor();
    const single=await readZip(await download('Excel KKP ini'));
    assert.match(decodeText(single.get('xl/worksheets/sheet1.xml').data),/EVID-FIKTIF-025/);
    const all=await readZip(await download('Excel semua KKP'));
    assert.match(decodeText(all.get('xl/worksheets/sheet3.xml').data),/EVID-FIKTIF-025/);
    assert.match(decodeText(all.get('xl/worksheets/sheet4.xml').data),/EVID-FIKTIF-025/);
    assert.match(decodeText(all.get('xl/worksheets/sheet5.xml').data),/2025-12-01/);
    const save=await download('Unduh berkas kerja'),parsed=JSON.parse(save);
    const saved=parsed.rows.find(r=>r.kkpLine===line.id);assert.equal(saved.menurutPetugas,tested);
    assert.equal(parsed.indexNotes[group.key].revision,1);assert.equal(parsed.indexDocuments[0].number,1);
    await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'Uji-indeks.json',mimeType:'application/json',buffer:save});
    await page.getByRole('button',{name:'Ganti isi sesi ini'}).click();
    await table.getByText(/DOK.1 · Perincian uji · EVID-FIKTIF-025/).waitFor();
    const refund=index.groups.find(g=>g.key==='BADAN/B').lines.find(l=>Object.hasOwn(l,'refundCode'));
    const legacy={...saved,kkpLine:refund.id,kkpPeriod:refund.period,topik:'B · PPh lebih bayar · '+refund.period,
      sumber:refund.source+' · ARSIP-KODE-002',document:'ARSIP-KODE-002',kkpNote:'Pengujian lama pada isian kode.',
      menurutWp:refund.legacyCodeAmount,menurutPetugas:2,principal:100,evidence:'verified'};
    await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'Berkas-lama.json',mimeType:'application/json',
      buffer:Buffer.from(JSON.stringify({...parsed,rows:[...parsed.rows,legacy]}))});
    await page.getByRole('button',{name:'Ganti isi sesi ini'}).click();
    await page.getByLabel('Pilih indeks KKP').selectOption('BADAN/B');
    const refundRow=table.getByRole('row').filter({hasText:'Kode pilihan pengembalian'}).filter({hasText:'ARSIP-KODE-002'});
    await refundRow.getByRole('button',{name:'Buka'}).click();
    await dialog.getByRole('table',{name:'Riwayat pengujian kode pilihan'}).waitFor();
    assert.equal(await dialog.locator('input[type=number]').count(),0);
    await dialog.getByLabel('Catatan penelaahan kode').fill('Arsip telah dicek pada induk.');
    await dialog.getByRole('button',{name:'Simpan telaah kode'}).click();
    const revised=JSON.parse(await download('Unduh berkas kerja')).rows.find(r=>r.kkpLine===refund.id);
    assert.equal(revised.status,'Selesai');assert.equal(revised.principal,null);assert.equal(revised.evidence,'none');
    assert.equal(revised.legacyOptionReview.principal,100);assert.equal(revised.legacyOptionReview.document,'ARSIP-KODE-002');
    await page.getByRole('button',{name:'KKA',exact:true}).click();
    await page.getByRole('heading',{name:'Kertas Kerja Analisis',exact:true}).waitFor();
    await page.getByRole('searchbox',{name:'Cari di tabel Daftar temuan'}).fill('EVID-FIKTIF-025');
    await page.getByRole('table',{name:'Daftar temuan'}).getByRole('button',{name:'Buka',exact:true}).click();
    await dialog.getByText(saved.sumber,{exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Tutup',exact:true}).click();
    await page.locator('#role').selectOption('AR');await page.getByRole('button',{name:'Berita acara',exact:true}).click();
    await page.getByRole('button',{name:'SP2DK baru'}).click();
    const withDraft=JSON.parse(await download('Unduh berkas kerja'));
    assert.ok(withDraft.drafts.some(d=>d.findings.some(f=>f.source===saved.sumber&&f.amount==='')));
    await page.locator('#role').selectOption('Pemeriksa');
  }
  assert.ok(checks.has('runtime-review'));assert.ok(checks.has('UNIFIKASI/G'));assert.ok(checks.has('UNIFIKASI/K'));
  assert.deepEqual(errors,[]);
  console.log('PASS: four fictitious packages in the installed V2 extension, '+(checks.size-1)+' index families, documented correction, revision, Excel, workfile, KKA and SP2DK.');
}finally{
  if(browser)await browser.close();
  await rm(profile,{recursive:true,force:true});
}
