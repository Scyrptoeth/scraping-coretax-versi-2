import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPackage} from '../extension/archive/package.js';
import {decodeText,readZip} from '../extension/archive/zip.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const ext=fileURLToPath(new URL('../extension/',import.meta.url)),dir=await mkdtemp(join(tmpdir(),'v2-probis-'));
const ctx=await chromium.launchPersistentContext(dir,{channel:'chromium',offline:true,executablePath:process.env.CHROMIUM_PATH||undefined,
  headless:true,args:['--disable-extensions-except='+ext,'--load-extension='+ext]});
const wps=[{npwp:'0000000000000011',nama:'WP A Fiktif'},{npwp:'0000000000000012',nama:'WP B Fiktif'}];
async function archive(wp){
  const entries=['2024','2025'].map(y=>({path:'spt/PPN/'+y+'-02/p00_fiktif/induk.json',cap:{sumber:'sptisi',lengkap:true},
    pages:[{Payload:{FormData:JSON.stringify({VATUnderOrOverPaid:{VAT:1}})}}]}));
  const zip=await createPackage({meta:{wp},entries});
  return {name:wp.npwp+'.zip',mimeType:'application/zip',buffer:Buffer.from(await zip.arrayBuffer())};
}
try{
  const w=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker'),p=await ctx.newPage(),errors=[];
  p.setDefaultTimeout(8000);p.on('pageerror',e=>errors.push(e.message));
  await p.goto(new URL('analisis/index.html',w.url()).href);
  await p.locator('#role').selectOption('AR');
  const nav=n=>p.getByRole('navigation').getByRole('button',{name:n,exact:true}).click();
  const b=n=>p.getByRole('button',{name:n,exact:true});
  const selectWp=wp=>p.locator('#taxpayer').selectOption({label:wp.nama+' · '+wp.npwp});
  const files=await Promise.all(wps.map(archive));
  const load=async()=>{await nav('Muat paket');await p.locator('#filePkg').setInputFiles(files);await p.getByText('2 paket dibuka.').waitFor();};
  async function chooseKlu(){
    await nav('Probis');await b('Pilih acuan dari katalog').click();
    await p.getByPlaceholder('Kode atau nama kegiatan').fill('01111');
    await p.locator('#screen table tbody tr').first().getByRole('button').first().click();
    await b('Jadikan acuan WP pada sesi ini').click();
    await p.getByRole('heading',{name:'Dokumen untuk penelusuran'}).waitFor();
  }
  const doc='Rekap panen per komoditas';
  async function request(){
    await p.getByRole('combobox',{name:'Indeks KKP tujuan'}).selectOption({index:1});
    await p.getByRole('checkbox',{name:doc}).check();await b('Tambahkan ke permintaan dokumen').click();
  }
  const list=p.getByRole('table',{name:'Dokumen indeks terpilih',exact:true});
  const download=async name=>{const [d]=await Promise.all([p.waitForEvent('download'),b(name).click()]);return readFile(await d.path());};
  await nav('Probis');assert.equal(await b('Tambahkan ke permintaan dokumen').count(),0);
  await load();await selectWp(wps[0]);await chooseKlu();await request();
  await p.getByText('1 saran ditambahkan. DOK.1.',{exact:true}).waitFor();await b('Tambahkan ke permintaan dokumen').click();
  await p.getByText('Saran sudah tercatat sebagai DOK.1.',{exact:true}).waitFor();await b('Buka indeks tujuan di KKP').click();
  await list.getByRole('cell',{name:'PB-PANEN',exact:true}).waitFor();assert.equal(await list.locator('tbody tr').count(),1);
  await list.getByRole('button',{name:'Buka',exact:true}).click();
  await p.getByRole('combobox',{name:'Status dokumen'}).selectOption('Diterima');await b('Simpan dokumen').click();
  await list.getByRole('cell',{name:'Diterima'}).waitFor();
  const workbook=await readZip(await download('Excel daftar dokumen'));
  const sheet=decodeText(workbook.get('xl/worksheets/sheet1.xml').data);
  for(const expected of [doc,'PB-PANEN','01111','Tahun pajak','Edisi klasifikasi','2025','Diterima'])assert.ok(sheet.includes(expected));
  assert.equal((sheet.match(/DOK\.1</g)||[]).length,1);
  const saved=await download('Unduh berkas kerja');assert.equal(JSON.parse(saved).indexDocuments[0].probis.klu,'01111');
  await nav('Probis');await p.getByRole('combobox',{name:'Tahun pajak untuk dokumen'}).selectOption('2024');
  await request();await p.getByText('1 saran ditambahkan. DOK.1.',{exact:true}).waitFor();
  await selectWp(wps[1]);await chooseKlu();await request();await p.getByText('1 saran ditambahkan. DOK.1.',{exact:true}).waitFor();
  await p.reload();await load();await selectWp(wps[0]);await nav('Kertas Kerja');await b('KKP').click();
  await p.locator('#screen input[type=file][accept=".json"]').setInputFiles({name:'kerja-fiktif.json',mimeType:'application/json',buffer:saved});
  await list.getByRole('cell',{name:'Diterima'}).waitFor();await list.getByRole('cell',{name:'01111',exact:true}).waitFor();
  await chooseKlu();await request();await p.getByText('Saran sudah tercatat sebagai DOK.1.',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);console.log('PASS: Probis suggestions, KKP and Excel DOK, idempotence, workfile restore, two taxpayers and two years.');
}finally{await ctx.close();await rm(dir,{recursive:true,force:true});}
