import assert from 'node:assert/strict';
import {launchHomeFixture,list,origin,wp,other} from './scraper-home-fixture.mjs';
import {appendPackageEntry} from '../extension/app-package-entries.js';
import {finishHomeTable} from '../extension/app-home-coverage.js';
import {reportSource} from '../extension/app-data.js';

const {ctx,routes,blocked,close}=await launchHomeFixture();
const id=list.split('/').at(-1);
const route=(module,page)=>origin+'/'+module+'/id-ID/'+page+'/'+id;
const profile=route('registration','general-information'),address=route('registration','address');
const place=route('registration','place-of-business-activity'),archive=route('returnsheets','archieved-returnsheets');
const ledger=route('accounting','balancesheet');
const link=(name,url)=>'<li><a href="'+url+'">'+name+'</a></li>';
const grid=(key,value)=>'<div class="grid ct-center-label"><div class="col-4"><span class="ct-label">'+key+'</span></div><div class="col-8 d-flex">: '+value+'</div></div>';
const table=(cols,body,pager='')=>'<div class="p-datatable"><table><thead><tr>'+cols.map(c=>'<th>'+c+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table>'+pager+'</div>';
const row=(...values)=>'<tr>'+values.map(s=>'<td>'+s+'</td>').join('')+'</tr>';
const count=(n)=>'<span class="p-paginator-current">Menampilkan 1 sampai '+n+' dari '+n+' baris</span>';
const archivedCols=['Jenis SPT','Masa Pajak','Nomor SPT'];
const ledgerCols=['Tanggal Posting','Jumlah','Nomor Transaksi','Tanggal Transaksi','Masa Pajak'];
const years=[['Januari 2025','TX-JAN'],['Januari - Desember 2025','TX-TAHUN'],['Maret - Juli 2025','TX-KHUSUS']];
const picker='<div class="p-dropdown"><input role="combobox" readonly placeholder="Pilih Masa Pajak"><span class="p-dropdown-label">Pilih Masa Pajak</span>'+
  '<button class="p-dropdown-trigger" onclick="const panel=document.querySelector(\'#period-panel\');if(panel.hidden){setTimeout(()=>panel.hidden=false,350)}else{panel.hidden=true}">▾</button></div>';
try{
  routes.set(list,routes.get(list).replace('</ul>',link('Informasi Umum Wajib Pajak',profile)+link('Archieved Return Sheets',archive)+'</ul>'));
  const taxTypes=route('registration','tax-types');
  const status=['Pendaftaran Tertunda','Terdaftar untuk Jenis Pajak Berikut','Permohonan yang Ditolak untuk Jenis Pajak Berikut','Penarikan selama Proses Permintaan untuk Jenis Pajak Berikut','Tidak Terdaftar untuk Jenis Pajak Berikut'];
  const sections=[
    ['pihak','Pihak Terkait','related-parties',['NIK / NPWP Orang','Nama PJ','Jenis Orang Terkait'],[other,'Fiktif','Pengurus']],
    ['klu','Klasifikasi Lapangan Usaha (KLU)','economic-code',['Kode KLU','Deskripsi TKU','Tanggal Mulai'],['00000','Usaha fiktif','2024-01-01']],
    ['nomorlain','Nomor Identifikasi Eksternal','external-identification-number',['Tipe','Nomor Identifikasi','Tanggal Mulai'],['Lain','ID-UJI','2024-01-01']],
    ['pbb','Objek Pajak PBB P5L','land-and-building-tax-objects',['NOP','Nama Objek Pajak','Sektor','Luas Objek Pajak'],[]],
    ['dokumen','Dokumen','documents',['NOMOR DOKUMEN','TANGGAL DOKUMEN','JUDUL DOKUMEN','JENIS DOKUMEN'],['UJI','2025-01-02','Berkas Contoh','Contoh']]
  ];
  for(const [,,path,cols,values] of sections)routes.set(route('registration',path),table(cols,
    values.length?row(...values):'<tr><td colspan="4">Tidak ada data</td></tr>',values.length?count(1):''));
  routes.set(taxTypes,'<style>reg-tax-type-grid,ui-grid{display:block}</style><reg-tax-type-grid>'+status.map((label,i)=>'<h3>'+label+'</h3><ui-grid>'+
    table(['Jenis Pajak','Tanggal Pendaftaran','Tanggal Permohonan'],row('Contoh '+i,'2024-01-02','2024-01-01'),count(1))+'</ui-grid>').join('')+'</reg-tax-type-grid>');
  routes.set(profile,'<main>'+grid('Nama','Badan Simulasi')+grid('Nomor Pokok Wajib Pajak',wp)+grid('Login Terakhir / Aktif','4 Januari 2025')+'</main><ul>'+
    link('Alamat',address)+link('Tempat Kegiatan Usaha/Sub Unit',place)+link('Jenis Pajak',taxTypes)+
    sections.map(([,label,path])=>link(label,route('registration',path))).join('')+'</ul>'+
    '<button role="tab" aria-selected="false" onclick="this.setAttribute(\'aria-selected\',\'true\');document.getElementById(\'flags\').hidden=false">Penanda Wajib Pajak</button>'+
    '<section id="flags" hidden>'+table(['Jenis Bendera','Jenis Surat Pemberitahuan Pajak','Tanggal Penunjukan','Nomor Penunjukan'],row('Contoh','SPT Masa PPN','2025-01-01','UJI'),count(1))+'</section>');
  routes.set(address,table(['Jenis Alamat','Detail Alamat','Kode Pos'],row('Kantor','Fiktif A','00000'),count(1)));
  routes.set(place,table(['Nama Tempat Kegiatan Usaha','Alamat'],row('Unit B','Fiktif B'),count(1)));
  routes.set(archive,table(archivedCols,row('SPT Masa PPN','Januari 2024','A-2024'),
    '<div class="p-paginator"><button class="p-paginator-first" disabled>«</button><button class="p-paginator-page p-highlight">1</button>'+
    '<button aria-label="Halaman berikutnya" class="p-paginator-next" onclick="this.disabled=true;document.querySelector(\'.p-paginator-page\').textContent=2;document.querySelector(\'tbody\').innerHTML=\''+
    row('SPT Masa PPN','Januari 2025','A-2025')+'\'">›</button></div>'));
  const total=(key,debit='7')=>row(key,debit,'8','9','10','11');
  const cancelPicker='<label for="ShowCancelledTransaction">Tampilkan Transaksi yang Dibatalkan</label><div id="ShowCancelledTransaction"><span class="p-dropdown-label">Please Select</span>'+
    '<button class="p-dropdown-trigger" onclick="document.querySelector(\'#cancel-panel\').hidden=false">▾</button></div><div id="cancel-panel" class="p-dropdown-panel" hidden>'+
    ['Yes','No'].map(label=>'<button role="option" aria-label="'+label+'" onclick="document.querySelector(\'#ShowCancelledTransaction span\').textContent=this.innerText;this.parentElement.hidden=true;">'+label+'</button>').join('')+'</div>';
  const dateFilter='<input id="TransactionDate" readonly value="19-10-2026 - 19-11-2026">'+
    '<button type="button" aria-label="Clear date" onclick="document.querySelector(\'#TransactionDate\').value=\'\'"></button>';
  routes.set(ledger,'<shared-left-menu><p class="ct-title-white">'+wp+'</p></shared-left-menu>'+cancelPicker+
    '<button id="submit" onclick="document.getElementById(\'result\').hidden=false;if(!document.getElementById(\'TransactionDate\').value){window.dateCleared=true;document.querySelector(\'.p-datatable tbody\').replaceChildren();document.querySelector(\'#summary thead tr:last-child\').cells[1].textContent=\'7\';}">Cari</button><div hidden id="result">'+
    '<div class="p-datatable"><table><thead><tr>'+ledgerCols.map(c=>'<th>'+c+'</th>').join('')+'</tr><tr><th></th><th></th><th></th><th>'+dateFilter+'</th><th>'+picker+
    '</th></tr></thead><tbody>'+row('2024-01-04','999','LAMA','2024-01-03','Januari 2024')+'</tbody></table>'+count(1)+'</div>'+
    '<table id="summary"><thead><tr><th></th>'+['Debit','Kredit','Debit Tersisa','Kredit Tersisa','Saldo'].map(h=>'<th>'+h+'</th>').join('')+'</tr>'+total('Total')+total('Filtered','19')+'</thead></table>'+
    '<div style="opacity:0"><div class="p-dropdown-panel"><input class="p-dropdown-filter"></div>'+
    '<div class="p-dropdown-panel" id="period-panel" hidden><input class="p-dropdown-filter">'+years.map(([label,key])=>'<button role="option" aria-label="'+label+
    '" onclick="document.querySelector(\'#period-panel\').hidden=true;document.querySelector(\'.p-dropdown-label:not(#ShowCancelledTransaction span)\').textContent=this.innerText;if(!window.dateCleared)return;document.querySelector(\'tbody\').innerHTML=\''+
    row('2025-01-04','700',key,'2025-01-03',label)+'\';document.querySelector(\'#summary thead tr:last-child\').cells[1].textContent=\'7\';">'+label+'</button>').join('')+'</div></div></div>');
  const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
  const tab=await ctx.newPage();await tab.goto(list);
  const app=await ctx.newPage();await app.goto(new URL('/app.html',worker.url()).href);
  const collect=async(sources,includeCancelled=false,pageLimit=null,prior=[])=>app.evaluate(async({sources,wp,list,includeCancelled,pageLimit,prior})=>{
    const {collectHomeSources}=await import('./app-home-sources.js');
    const [source]=await chrome.tabs.query({url:list}),items=[...prior];
    let replacements=0;
    const output=await collectHomeSources({ext:chrome,tabId:source.id,wp,period:'2025-01 s.d. 2025-01',sources,types:['VAT_VATR'],items,includeCancelled,
      ...(pageLimit?{pageLimit}:{}),enqueue:async(info,page)=>items.push({...info,page}),
      replace:async(old,info,page)=>{items.splice(items.indexOf(old[0]),old.length,{...info,page});replacements++;}});
    return {items,output,replacements};
  },{sources,wp,list,includeCancelled,pageLimit,prior});
  const {items,output}=await collect(['info','login','alamat','jenispajak','flag',...sections.map(s=>s[0]),'sptarsip','bb','bbtotal','bbsaldo','sptbelum']);
  const by=s=>items.filter(i=>i.source===s);
  assert.equal(by('info')[0]?.page.Payload.Data[0].Nama,'Badan Simulasi',JSON.stringify(output));
  assert.equal(by('alamat').length,2,JSON.stringify(output));
  assert.equal(by('login')[0]?.page.Payload.Data[0]['Login Terakhir / Aktif'],'4 Januari 2025');
  assert.deepEqual(by('jenispajak').map(i=>i.page.Payload.Data[0]['Kelompok pendaftaran']),status);
  for(const [key] of sections)assert.equal(by(key).length,1,JSON.stringify(output));
  assert.equal(by('pihak')[0].page.Payload.Data[0]['NIK / NPWP Orang'],other);
  assert.equal(by('pbb')[0].proof.dariBeranda.kosongPadaSumber,true);
  assert.equal(by('pbb')[0].page.Payload.TotalRecords,0);
  assert.equal(by('flag')[0]?.page.Payload.Data[0]['Jenis Bendera'],'Contoh',JSON.stringify(output));
  const packaged=new Map();
  for(const item of items)appendPackageEntry(packaged,{...item,origin:'Dari beranda Coretax',...reportSource(item.page)},wp);
  for(const entry of packaged.values())await finishHomeTable(entry);
  for(const source of ['pihak','klu','dokumen','nomorlain','pbb','alamat','jenispajak','flag']){
    const proof=[...packaged.values()].find(e=>e.cap.sumber===source);
    assert.equal(proof?.cap.lengkap,true,source);
    assert.equal(proof.cap.baris,proof.cap.total);
  }
  assert.equal([...packaged.values()].find(e=>e.cap.sumber==='sptarsip').cap.lengkap,false);
  const klu=route('registration','economic-code');
  routes.set(klu,'<input type="search" aria-label="Cari KLU" value="contoh">'+routes.get(klu));
  const withFilter=await collect(['klu']);
  const filtered=withFilter.items[0];
  const checked=appendPackageEntry(new Map(),{...filtered,origin:'Dari beranda Coretax',...reportSource(filtered.page)},wp);
  await finishHomeTable(checked);assert.equal(checked.cap.lengkap,false);
  const pbb=route('registration','land-and-building-tax-objects');
  const pbbColumns=['NOP','Nama Objek Pajak','Sektor','Luas Objek Pajak'],empty='<tr><td colspan="4">Tidak ada data</td></tr>';
  routes.set(pbb,table(pbbColumns,empty,'<div class="p-paginator"><button class="p-paginator-first" aria-label="Halaman pertama" onclick="this.disabled=true;document.querySelector(\'tbody\').innerHTML=\''+
    row('NOP-UJI','Objek contoh','Contoh','20')+'\'">«</button><button class="p-paginator-next" aria-label="Halaman berikutnya" disabled>›</button></div>'));
  const backAtStart=await collect(['pbb']);
  assert.equal(backAtStart.items[0]?.page.Payload.Data[0].NOP,'NOP-UJI',JSON.stringify(backAtStart.output));
  assert.equal(backAtStart.items[0].proof.dariBeranda.kosongPadaSumber,false);
  routes.set(pbb,table(pbbColumns,empty,'<div class="p-paginator"><button class="p-paginator-next" aria-label="Halaman berikutnya" disabled>›</button></div>'));
  const unknownStart=await collect(['pbb']);
  assert.equal(unknownStart.items.length,0);
  assert.ok(unknownStart.output.issues.length);
  assert.deepEqual(by('sptarsip')[0]?.page.Payload.Data.map(r=>r['Nomor SPT']),['A-2024','A-2025'],JSON.stringify(output));
  assert.equal(by('sptarsip')[0].proof.dariBeranda.indeksLintasMasa,true);
  assert.deepEqual(by('bb')[0]?.page.Payload.Data.map(r=>r['Nomor Transaksi']),['TX-JAN'],JSON.stringify(output));
  assert.equal(by('bb')[0].proof.dariBeranda.kodeMasa,'01012025');
  assert.deepEqual(by('bb').map(i=>i.proof.dariBeranda.kodeMasa),['01012025','01122025','03072025'],JSON.stringify(output));
  assert.deepEqual(by('bbtotal').map(i=>i.proof.dariBeranda.kodeMasa),['01012025','01122025','03072025'],JSON.stringify(output));
  assert.deepEqual(by('bbtotal')[0]?.page.Payload.Data.map(r=>r.Key),['Total','Filtered'],JSON.stringify(output));
  assert.deepEqual(by('bbsaldo')[0]?.page.Payload.Data.map(r=>[r.Key,r.Debit]),[['Total','7'],['Filtered','7']],JSON.stringify(output));
  assert.equal(by('bb')[0].proof.dariBeranda.transaksiDibatalkan,'No');
  const withCancelled=await collect(['bbsaldo'],true);
  assert.equal(withCancelled.items[0]?.proof.dariBeranda.transaksiDibatalkan,'Yes',JSON.stringify(withCancelled.output));
  const ledgerMarkup=routes.get(ledger);
  routes.set(ledger,ledgerMarkup.replace('<th>'+dateFilter,'<th><input value="Filter lain">'+dateFilter));
  const filteredBalance=await collect(['bbsaldo']);
  assert.deepEqual(filteredBalance.items[0]?.page.Payload.Data.map(r=>r.Key),['Total']);
  assert.ok(filteredBalance.output.issues.some(text=>/Baris saldo pembanding seluruh periode/.test(text)));
  const stalledLedger=ledgerMarkup.replaceAll("document.querySelector('#period-panel').hidden=true;document.querySelector",
    "document.querySelector('#period-panel').hidden=true;document.querySelector('.p-dropdown:has(input[role=combobox])').classList.add('p-dropdown-open');document.querySelector");
  assert.notEqual(stalledLedger,ledgerMarkup);
  routes.set(ledger,stalledLedger);
  const recoveredLedger=await collect(['bb','bbtotal']);
  for(const source of ['bb','bbtotal']){
    const captured=recoveredLedger.items.filter(entry=>entry.source===source);
    assert.deepEqual(captured.map(entry=>entry.proof.dariBeranda.kodeMasa),['01012025','01122025','03072025'],JSON.stringify(recoveredLedger.output));
  }
  routes.set(ledger,ledgerMarkup);
  const first=await collect(['sptarsip'],false,1);
  assert.equal(first.items[0].page.Payload.Data.length,1);
  assert.equal(first.items[0].proof.morePagesAvailable,true);
  const resumed=await collect(['sptarsip'],false,null,first.items);
  assert.equal(resumed.replacements,1);
  assert.equal(resumed.items.length,1);
  assert.equal(resumed.items[0].page.Payload.Data.length,2);
  assert.equal(resumed.items[0].proof.morePagesAvailable,false);
  const changed=routes.get(archive).replace('A-2024','X-NEW');
  routes.set(archive,changed);
  const conflict=await collect(['sptarsip'],false,null,first.items);
  assert.equal(conflict.replacements,0);
  assert.deepEqual(conflict.items,first.items);
  assert.ok(conflict.output.issues.some(text=>text.includes('Hasil sebelumnya')));
  routes.set(archive,table(archivedCols,row('SPT Masa PPN','Januari 2025','A-1'),
    '<div class="p-paginator"><button class="p-paginator-first" disabled>«</button><button class="p-paginator-page p-highlight">1</button>'+
    '<button aria-label="Halaman berikutnya" class="p-paginator-next" onclick="const p=document.querySelector(\'.p-paginator-page\'),n=Number(p.innerText)+1;'+
    'p.textContent=n;document.querySelector(\'tbody tr\').cells[2].textContent=\'A-\'+n;this.disabled=n===101">›</button></div>'));
  const long=await collect(['sptarsip']);
  assert.equal(long.items[0]?.page.Payload.Data.length,101,JSON.stringify(long.output));
  assert.ok(output.missing.includes('sptbelum'));
  routes.set(profile,grid('Nama','Profil berbeda')+grid('Nomor Pokok Wajib Pajak',other));
  await assert.rejects(collect(['info']),/NPWP pada halaman sumber berbeda/);
  assert.deepEqual(blocked,[]);
  console.log('Beranda ke profil, login terakhir, dua bagian alamat, lima kelompok jenis pajak, arsip, buku besar bulanan, setahun dan khusus, jumlah pembanding, saldo dan penolakan WP berbeda lulus.');
}finally{await close();}
