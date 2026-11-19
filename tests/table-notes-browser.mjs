import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createPackage} from '../extension/archive/package.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const extension=resolve(process.env.EXTENSION_DIR||'extension');
const temp=await mkdtemp(join(tmpdir(),'scv2-row-note-'));
const make=async id=>{
  const file=await createPackage({meta:{wp:{nama:'Contoh fiktif',npwp:id}},entries:[{
    path:'profil/rekening-bank.json',cap:{sumber:'bank',lengkap:true,baris:2},
    pages:[{Payload:{Data:[{BankAccountNumber:'002'},{BankAccountNumber:'001'}]}}]}]});
  return {name:'contoh.zip',mimeType:'application/zip',buffer:Buffer.from(await file.arrayBuffer())};
};
let browser;
try{
  const a=await make('0000000000000017'),b=await make('0000000000000026');
  browser=await chromium.launchPersistentContext(temp,{channel:'chromium',headless:true,offline:true,executablePath:process.env.CHROMIUM_PATH,
    args:['--disable-background-networking','--disable-extensions-except='+extension,'--load-extension='+extension]});
  const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker'),p=await browser.newPage();
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  const open=async file=>{
    await p.goto(new URL('analisis/index.html',worker.url()).href);await p.reload();
    await p.locator('#filePkg').setInputFiles(file);await p.getByText(/Konsisten · Seluruh sidik jari/).waitFor();
    await p.getByRole('navigation',{name:'Bagian aplikasi'}).getByRole('button',{name:'Data mentah'}).click();
    await p.getByRole('table',{name:'Rekening bank',exact:true}).waitFor();
  };
  const row=id=>p.getByRole('row').filter({has:p.getByRole('cell',{name:id,exact:true})});
  const act=(id,name)=>row(id).getByRole('button',{name,exact:true}).click();
  const note=p.getByLabel('Catatan Anda'),dialog=p.getByRole('dialog');
  await open(a);await act('001','Tambah catatan baris');await note.fill('Periksa bukti fiktif.');await dialog.getByText('Simpan',{exact:true}).click();
  await p.getByRole('button',{name:'Nomor rekening',exact:true}).click();
  await act('001','Ubah catatan baris');assert.equal(await note.inputValue(),'Periksa bukti fiktif.');
  await note.fill('Batal menyimpan');await dialog.getByText('Batal',{exact:true}).click();
  await open(b);assert.equal(await p.getByRole('button',{name:'Tambah catatan baris'}).count(),2);
  await open(a);await act('001','Ubah catatan baris');assert.equal(await note.inputValue(),'Periksa bukti fiktif.');
  await note.fill('');await dialog.getByText('Simpan',{exact:true}).click();
  await open(a);assert.equal(await p.getByRole('button',{name:'Tambah catatan baris'}).count(),2);
  assert.deepEqual(errors,[]);console.log('Catatan tetap pada rekaman yang sama sesudah pengurutan dan buka ulang. Batal, hapus dan pemisahan paket teruji.');
}finally{await browser?.close();await rm(temp,{recursive:true,force:true});}
