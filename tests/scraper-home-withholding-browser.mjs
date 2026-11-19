import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readPackage} from '../extension/archive/package.js';
import {home,wp,other,origin,launchHomeFixture} from './scraper-home-fixture.mjs';

const title='Daftar Bukti Pemotongan atau Pemungutan yang Diterima Wajib Pajak';
const url=origin+'/report-native/id-ID/withholding-slips/withholding-report-008';
const names=['BPPU','Penyetoran Sendiri','BP 21 – Bukti Pemotongan Selain Pegawai Tetap','BP 26 – Bukti Pemotongan Wajib Pajak Luar Negeri',
  'BP A1 – Bukti Pemotongan A1 Masa Pajak Terakhir','BP A2 – Bukti Pemotongan A1 Masa Pajak Terakhir'];
const columns=['NPWP Penerima Penghasilan','Nama Penerima Penghasilan','Masa Pajak','Nomor Bukti Pemotongan/Pemungutan','NPWP Pemotong'];
const empty='<tr class="p-datatable-emptymessage"><td colspan="5">Tidak ada data yang ditemukan.</td></tr>';
const report='<h1>'+title+'</h1><input id="NpwpPenerimaPenghasilan"><input id="NpwpPemotong"><input id="NomorBuktiPotong">'+
  '<div formcontrolname="JenisBuktiPotong"><span class="p-dropdown-label">Pilih Jenis</span><button class="p-dropdown-trigger" onclick="opts.hidden=false">Pilih</button></div>'+
  '<div id="opts" role="listbox" hidden>'+names.map(n=>'<button role="option">'+n+'</button>').join('')+'</div>'+
  '<p-calendar><input readonly placeholder="Pilih Tahun Pajak"><button aria-label="Open calendar" onclick="yrs.hidden=false">Tahun</button></p-calendar>'+
  '<div id="yrs" hidden><button class="p-yearpicker-year">2025</button></div><button id="go" disabled>Cari</button>'+
  '<div class="p-datatable"><table id="hasil"><thead><tr>'+columns.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+empty+
  '</tbody></table><div class="p-paginator"><button id="first" aria-controls="hasil" aria-label="Halaman pertama" disabled>Awal</button>'+
  '<span class="p-paginator-current">Menampilkan 0 sampai 0 dari 0 baris</span><button id="next" aria-controls="hasil" aria-label="Halaman berikutnya" disabled>Berikut</button></div></div>'+
  '<script>const jenis=document.querySelector(".p-dropdown-label"),tahun=document.querySelector("[readonly]"),body=document.querySelector("tbody"),range=document.querySelector(".p-paginator-current");'+
  'function ready(){go.disabled=!(NpwpPenerimaPenghasilan.value&&tahun.value&&jenis.textContent!=="Pilih Jenis")};'+
  'opts.onclick=e=>{jenis.textContent=e.target.textContent;opts.hidden=true;ready()}; yrs.onclick=e=>{tahun.value=e.target.textContent;yrs.hidden=true;ready()};'+
  'function row(owner,month,n){return "<tr>"+[owner,"Nama simulasi",month+" 2025","BUKTI-"+n,"'+other+'"].map(x=>"<td>"+x+"</td>").join("")+"</tr>"};'+
  'function show(n){let month=n===1?"Januari":"Februari";body.innerHTML=row("'+wp+'",month,n);range.textContent="Menampilkan "+n+" sampai "+n+" dari 2 baris";first.disabled=n===1;next.disabled=n===2};'+
  'next.onclick=()=>show(2);first.onclick=()=>show(1);go.onclick=()=>setTimeout(()=>{if(jenis.textContent==="BPPU")show(1);'+
  'else if(jenis.textContent.startsWith("BP 21")){body.innerHTML=row("'+wp+'","Januari",1);range.textContent="Menampilkan 1 sampai 1 dari 1 baris";}'+
  'else if(jenis.textContent.startsWith("BP A2")){body.innerHTML=row("'+wp+'","Januari",3).replace("Januari 2025","Januari 2024");range.textContent="Menampilkan 1 sampai 1 dari 1 baris";}'+
  'else if(!jenis.textContent.startsWith("BP 26")){body.innerHTML='+JSON.stringify(empty)+';}},50);</script>';

const {ctx,routes,close}=await launchHomeFixture();
try{
  routes.set(home,routes.get(home)+'<button onclick="reports.hidden=false">Laporan</button><nav id="reports" hidden><a href="'+url+'">'+title+'</a></nav>');
  routes.set(url,report);
  const source=await ctx.newPage();await source.goto(home);
  const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
  const app=await ctx.newPage();await app.goto(new URL('/app.html',worker.url()).href);
  const result=await app.evaluate(async({home,wp})=>{
    const {collectHomeWithholding}=await import('./app-home-withholding.js');
    const [homeTab]=await chrome.tabs.query({url:home}),tabs=[],entries=[];
    try{
      const result=await collectHomeWithholding({ext:chrome,homeTab,wp,period:'2025-06 s.d. 2025-06',onTab:id=>tabs.push(id),
        enqueue:(info,page)=>entries.push({info,page})});
      return {entries,result};
    }finally{for(const tab of tabs)await chrome.tabs.remove(tab);}
  },{home,wp});
  const byKind=new Map(result.entries.map(e=>[e.info.proof.dariBeranda.buktiPotong.jenis,e]));
  assert.deepEqual([...byKind.keys()].sort(),['BP21','BPA1','BPPU','BPSP'],JSON.stringify(result.result.issues));
  const bppu=byKind.get('BPPU');
  assert.deepEqual(bppu.page.Payload.Data.map(r=>r['Nomor Bukti Pemotongan/Pemungutan']),['BUKTI-1','BUKTI-2']);
  assert.equal(bppu.info.proof.dariBeranda.jumlahHalaman,2);
  assert.equal(bppu.info.proof.dariBeranda.cakupanTahun,'2025');
  assert.equal(byKind.get('BPSP').page.Payload.TotalRecords,0);
  for(const [kind,note] of [['BP26','diperbarui'],['BPA2','tahun'],['BPCY','Pilihan jenis'],['NPMP','NPWP pemotong']]){
    assert.ok(result.result.issues.some(s=>s.includes(kind+' 2025')&&s.includes(note)),JSON.stringify(result.result.issues));
  }
  const recovered=await app.evaluate(async({home,wp,bppu})=>{
    const {collectHomeWithholding}=await import('./app-home-withholding.js');
    const [homeTab]=await chrome.tabs.query({url:home}),tabs=[];
    const partial={...bppu.info,page:{Payload:{Data:bppu.page.Payload.Data.slice(0,1)}}};
    partial.proof.morePagesAvailable=true;partial.proof.dariBeranda.rentangUtuh=false;
    const items=[partial,...['BPSP','BP21','BP26','BPA1','BPA2','BPCY','NPMP'].map(jenis=>({source:'bplawan',wp,period:partial.period,
      proof:{dariBeranda:{buktiPotong:{tahun:'2025',jenis},rentangUtuh:true}}}))];
    const replaced=[];
    try{
      await collectHomeWithholding({ext:chrome,homeTab,wp,period:partial.period,items,onTab:id=>tabs.push(id),
        enqueue:()=>{throw Error('Unexpected new group');},
        replace:(old,info,page)=>{if(old.length===1&&old[0]===partial)replaced.push([info.proof.dariBeranda.rentangUtuh,page.Payload.Data.length]);}});
    }finally{for(const id of tabs)await chrome.tabs.remove(id);}
    return replaced;
  },{home,wp,bppu});
  assert.deepEqual(recovered,[[true,2]]);
  routes.set(url,report.replace('body.innerHTML=row("'+wp+'","Januari",1)','body.innerHTML=row("'+other+'","Januari",1)'));
  const unsafe=await app.evaluate(async({home,wp})=>{
    const {collectHomeWithholding}=await import('./app-home-withholding.js');
    const [homeTab]=await chrome.tabs.query({url:home}),period='2025-01 s.d. 2025-01',tabs=[];
    const items=['BPPU','BPSP'].map(jenis=>({source:'bplawan',wp,period,proof:{dariBeranda:{buktiPotong:{tahun:'2025',jenis},rentangUtuh:true}}}));
    try{
      await collectHomeWithholding({ext:chrome,homeTab,wp,period,items,onTab:id=>tabs.push(id),enqueue:()=>{throw Error('Unexpected entry');}});
    }catch(error){return error.code;}finally{for(const id of tabs)await chrome.tabs.remove(id);}
  },{home,wp});
  assert.equal(unsafe,'IDENTITY');
  routes.set(url,report);
  await app.locator('#ids').fill(wp);await app.locator('#officer').fill('Petugas simulasi');
  for(const f of ['year-start','year-end'])await app.locator('#'+f).selectOption('2025');
  for(const f of ['month-start','month-end'])await app.locator('#'+f).selectOption('06');
  for(const el of await app.locator('#sources input').all())await el.setChecked((await el.inputValue())==='bplawan');
  await app.locator('#consent').check();await app.locator('#start').click();
  const download=app.getByRole('button',{name:'Unduh paket',exact:true});
  await download.waitFor({timeout:85000});await download.click();
  const [file]=await Promise.all([app.waitForEvent('download'),app.locator('#package-dialog button[value=ok]').click()]);
  const pkg=await readPackage(await readFile(await file.path()));
  assert.ok(pkg.report.valid);
  const paths=pkg.entries.map(e=>e.path).sort();
  assert.deepEqual(paths,['BP21','BPA1','BPPU','BPSP'].map(k=>'bukti-potong-lawan/2025/'+k+'.json'));
  const payload=kind=>pkg.entries.find(e=>e.path.endsWith('/'+kind+'.json')).pages[0].Payload;
  assert.equal(payload('BPPU').Data.length,2);
  assert.equal(payload('BPSP').TotalRecords,0);
  assert.ok(pkg.manifest.cek.some(item=>item.pesan?.includes('BP26 2025')));
  assert.equal(source.url(),home);
  console.log('Laporan bukti potong: enam pilihan bernama, identitas penerima, dua halaman lintas bulan untuk tahun terpilih, konfirmasi nol dan empat alasan sumber tidak masuk paket teruji.');
}finally{await close();}
