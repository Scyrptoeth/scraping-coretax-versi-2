import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {readPackage} from '../extension/archive/package.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const extension=resolve(process.env.EXTENSION_DIR||'extension');
const origin='https://coretax.intranet.pajak.go.id';
const aggregate='00000000-0000-4000-8000-000000000001';
const listing=origin+'/returnsheets/id-ID/submitted-returnsheets/'+aggregate;
const detailBase=origin+'/__synthetic__/start/';
const wp='0000000000000001',otherWp='0000000000000002';
const records=[
  {id:'start-original',month:'Januari',model:'Normal'},
  {id:'start-amended',month:'Januari',model:'Pembetulan 1'},
  {id:'outside-period',month:'Februari',model:'Normal'}
];
const headers=['','Jenis Pajak','Jenis Surat Pemberitahuan Pajak','Masa Pajak','Model SPT','Status SPT','ID SPT','Nomor Bukti Penerimaan'];
const cells=values=>values.map(v=>'<td>'+v+'</td>').join('');
const pairs=fields=>'<dl>'+fields.map(([k,v])=>'<dt>'+k+'</dt><dd>'+v+'</dd>').join('')+'</dl>';

function listPage(owner,missingAction){
  const action=r=>missingAction&&r===records[1]?'':('<a href="'+detailBase+r.id+'">Lihat SPT</a>');
  const row=r=>'<tr><td>'+action(r)+'</td>'+cells(['PPN','SPT Masa PPN',r.month+' 2025',r.model,
    'Dilaporkan',r.id,'BPE-'+r.id])+'</tr>';
  const pages=[[records[0]],[records[1],records[2]]].map(items=>items.map(row).join(''));
  return '<!doctype html><aside><div><b>'+owner+'</b><div>Perusahaan Fiktif</div></div><ul><li><a href="'+listing+'">SPT Dilaporkan</a></li>'+
    '<li><a href="/registration/id-ID/general-information/'+aggregate+'">Informasi Umum Wajib Pajak</a></li>'+
    '<li><a href="/returnsheets/id-ID/taxpayer-search">Pilih Wajib Pajak Lain</a></li></ul></aside>'+
    '<div class="p-datatable"><table id="index"><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+pages[0]+
    '</tbody></table><div class="p-paginator"><button id="first" type="button" aria-controls="index" aria-label="Halaman pertama" disabled>Halaman pertama</button>'+
    '<button id="next" type="button" aria-controls="index" aria-label="Halaman berikutnya">Berikutnya</button></div></div>'+
    '<script>const pages='+JSON.stringify(pages)+';function show(i){document.querySelector("tbody").innerHTML=pages[i];'+
    'first.disabled=i===0;next.disabled=i===1}first.onclick=()=>show(0);next.onclick=()=>show(1);</script>';
}

function detailPage(r,owner){
  const fields=[['NPWP Wajib Pajak',owner],['Jenis SPT','SPT Masa PPN'],['Masa Pajak',r.month+' 2025'],['Model SPT',r.model],
    ['ID SPT',r.id],['Nomor Bukti Penerimaan','BPE-'+r.id]];
  const label=owner===wp?r.id:'FOREIGN-DATA';
  return '<!doctype html><main>'+pairs(fields)+'<section aria-label="Induk SPT">'+pairs([['Keterangan','Induk '+label]])+'</section>'+
    '<button type="button" role="tab" aria-controls="a1" onclick="document.getElementById(\'a1\').hidden=false">Lampiran A1</button>'+
    '<section aria-label="Lampiran A1" id="a1" role="tabpanel" hidden><table id="lines"><thead><tr><th>Uraian</th></tr></thead>'+
    '<tbody><tr>'+cells(['Lampiran '+label])+'</tr></tbody></table><div role="status">Menampilkan 1 sampai 1 dari 1 baris</div></section></main>';
}

async function configure(page,{details=true}={}){
  await page.locator('#ids').fill(wp);await page.locator('#officer').fill('Penguji fiktif');
  await page.locator('#year-start').selectOption('2025');await page.locator('#year-end').selectOption('2025');
  await page.locator('#month-start').selectOption('01');await page.locator('#month-end').selectOption('01');
  for(const input of await page.locator('#sources input').all()){
    const type=await input.inputValue();await input.setChecked(type==='sptdaftar'||details&&type==='sptisi');
  }
  for(const input of await page.locator('#forms input').all())await input.setChecked((await input.inputValue())==='VAT_VATR');
  assert.deepEqual(await page.locator('#forms input:checked').evaluateAll(nodes=>nodes.map(n=>n.value)),['VAT_VATR']);
  await page.locator('#consent').check();
}

async function readResult(page){
  const button=page.getByRole('button',{name:'Unduh paket',exact:true});
  const emptyQueue=page.locator('#log li').filter({hasText:'Tambahkan tabel atau berkas yang sesuai'});
  const outcome=await Promise.race([button.waitFor().then(()=>'package'),emptyQueue.waitFor().then(()=>'empty-queue')]).catch(async error=>{
    throw Error('No result from Mulai tarik. '+await page.locator('#status').innerText()+' '+await page.locator('#log').innerText(),{cause:error});
  });
  assert.equal(outcome,'package','Mulai tarik must read the selected SPT list from an empty queue');
  await button.click();
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#package-dialog button[value=ok]').click()]);
  const pkg=await readPackage(await readFile(await download.path()));
  assert.ok(pkg.report.valid);assert.equal(pkg.manifest.wp.npwp,wp);
  return pkg;
}

async function verifyViewer(context,page,pkg,includeForms){
  const [viewer]=await Promise.all([context.waitForEvent('page'),page.getByRole('button',{name:'Buka di Analisis',exact:true}).click()]);
  await viewer.waitForFunction(owner=>document.querySelector('#taxpayer option:checked')?.textContent.includes(owner),wp);
  await viewer.getByRole('button',{name:'Rincian mutu data',exact:true}).click();
  const coverage=viewer.getByRole('table',{name:'Cakupan sumber penarikan',exact:true});
  const labels={sptdaftar:'Daftar SPT dilaporkan',sptisi:'Induk dan lampiran SPT',sptarsip:'Daftar SPT diarsipkan'};
  for(const code of pkg.manifest.opsi.sumber){
    const label=labels[code],entries=pkg.entries.filter(e=>e.cap.sumber===code),n=entries.length;
    const row=coverage.getByRole('row').filter({has:viewer.getByRole('cell',{name:label,exact:true})});
    await row.waitFor();
    const values=await row.getByRole('cell').allTextContents();
    assert.deepEqual(values.slice(0,5),[label,'Dipilih',String(n),String(n),String(entries.filter(e=>e.cap.lengkap).length)]);
    assert.ok(pkg.minutes.split(/\r?\n/).some(line=>line.startsWith(label)&&line.includes(values[5])&&line.endsWith('('+n+' berkas).')));
    if(n===0)assert.equal(values[5],'Belum ada berkas dalam paket');
  }
  if(!includeForms)return;
  await viewer.getByRole('button',{name:'SPT',exact:true}).first().click();
  await viewer.getByRole('table',{name:'Daftar SPT',exact:true}).getByRole('button',{name:'Buka',exact:true}).first().click();
  const dialog=viewer.getByRole('dialog'),versions=dialog.getByRole('combobox',{name:'Versi',exact:true});
  const values=await versions.locator('option').evaluateAll(opts=>opts.map(o=>o.value));assert.equal(values.length,2);
  const rowValues=[];
  for(const version of values){
    await versions.selectOption(version);await dialog.getByRole('combobox',{name:'Induk / lampiran'}).selectOption('a1');
    rowValues.push(await dialog.getByRole('cell',{name:/^Lampiran start-/}).innerText());
  }
  assert.deepEqual(rowValues.sort(),records.slice(0,2).map(r=>'Lampiran '+r.id).sort());
}

async function run(mode){
  const profile=await mkdtemp(join(tmpdir(),'scv2-spt-start-'));let ctx;
  let allowRevision,revisionRequested;
  const releaseRevision=new Promise(resolve=>allowRevision=resolve);
  const revisionRequest=new Promise(resolve=>revisionRequested=resolve);
  const launch=()=>chromium.launchPersistentContext(profile,{headless:true,offline:true,channel:'chromium',executablePath:process.env.CHROMIUM_PATH||undefined,
    args:['--disable-background-networking','--disable-extensions-except='+extension,'--load-extension='+extension]});
  try{
    const visited=[];let foreign=mode==='wrong-owner',hold=mode==='stop'||mode==='restart';
    const serve=async route=>{
      const url=route.request().url();
      if(url===listing)return route.fulfill({contentType:'text/html; charset=utf-8',body:listPage(wp,mode==='missing-action')});
      const doc=records.find(r=>url===detailBase+r.id);
      if(!doc)return route.abort();
      visited.push(doc.id);
      if(doc===records[1]&&hold){revisionRequested();await releaseRevision;if(mode==='restart')return;}
      const owner=doc===records[1]&&foreign?otherWp:wp;
      return route.fulfill({contentType:'text/html; charset=utf-8',body:detailPage(doc,owner)});
    };
    ctx=await launch();await ctx.route(/^https?:\/\//,serve);
    const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
    let source=await ctx.newPage();
    if(mode!=='import')await source.goto(listing);
    let page=await ctx.newPage();page.setDefaultTimeout(25000);
    await page.goto(new URL('app.html',worker.url()).href);await configure(page,{details:mode!=='import'});
    assert.equal(await page.locator('#queue .item').count(),0);
    if(mode==='import'){
      await page.locator('#sources input[value=sptarsip]').check();
      await page.locator('#source').selectOption('sptdaftar');await page.locator('#scope-ok').check();
      const row={NPWP:wp,ReturnSheetTypeCode:'VAT_VATR',TaxPeriodCode:'01012025',ReturnSheetModel:'normal',RecordId:'local-only',DocumentReceiptNumber:'BPE-FILE'};
      await page.locator('#source-files').setInputFiles({name:'synthetic-list.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([row]))});
      await page.locator('#queue .item').waitFor();
    }
    await page.getByRole('button',{name:'Mulai tarik',exact:true}).click();
    if(mode==='stop'||mode==='restart'){
      await Promise.race([revisionRequest,page.getByText('Tarikan selesai',{exact:true}).waitFor().then(()=>{throw Error('No second detail request to stop');})]);
      if(mode==='restart'){
        const appUrl=page.url();
        // The first version has already been saved. Close the isolated browser mid-request, without a stop action.
        await ctx.close();hold=false;allowRevision();
        ctx=await launch();await ctx.route(/^https?:\/\//,serve);
        source=await ctx.newPage();page=await ctx.newPage();page.setDefaultTimeout(25000);
        await page.goto(appUrl);
      }else{
        await page.locator('#stop').click();hold=false;allowRevision();
      }
    }
    if(mode==='stop'||mode==='restart'||mode==='wrong-owner'){
      const resume=page.locator('#pending-jobs').getByRole('button',{name:'Lanjutkan NPWP '+wp,exact:true});
      await resume.waitFor();await page.waitForFunction(()=>document.querySelector('#stop').hidden);
      assert.equal(await page.getByRole('button',{name:'Unduh paket',exact:true}).count(),0);
      if(mode==='wrong-owner'){
        assert.ok(visited.includes(records[1].id));
        assert.match(await page.locator('#log,#status').allTextContents().then(rows=>rows.join(' ')),/WP|identitas/i);
      }
      foreign=false;await source.goto(listing);
      await page.reload();await configure(page);await page.locator('#officer').fill('Penugasan fiktif lain');
      const beforeResume=visited.length;
      await resume.click();await page.locator('#log').getByText(/penugasan atau pilihan data berbeda/i).waitFor();
      assert.equal(visited.length,beforeResume);
      await page.getByRole('button',{name:'Muat penugasan tersimpan',exact:true}).click();
      assert.equal(await page.locator('#ids').inputValue(),wp);
      assert.equal(await page.locator('#officer').inputValue(),'Penguji fiktif');
      assert.equal(await page.locator('#consent').isChecked(),false);
      await page.locator('#consent').check();await resume.click();
    }
    const pkg=await readResult(page);
    assert.deepEqual(pkg.manifest.opsi.sumber.slice().sort(),(mode==='import'?['sptdaftar','sptarsip']:['sptdaftar','sptisi']).sort());
    if(mode==='import'){
      assert.deepEqual(visited,[]);
      assert.deepEqual(pkg.entries.map(e=>e.path),['spt/daftar.json']);
      assert.equal(pkg.entries[0].pages[0].Payload.Data[0].RecordId,'local-only');
      await verifyViewer(ctx,page,pkg,false);return;
    }
    const expected=mode==='missing-action'?records.slice(0,1):records.slice(0,2);
    assert.deepEqual([...new Set(visited)].sort(),expected.map(r=>r.id).sort(),JSON.stringify(pkg.manifest.cek));
    assert.ok(!JSON.stringify(pkg.entries).includes('FOREIGN-DATA'));
    for(const doc of expected){
      const parts=pkg.entries.filter(e=>e.cap.konteks?.spt?.recordId===doc.id);
      const part=name=>parts.find(e=>e.cap.konteks.bagian===name);
      assert.equal(parts.filter(e=>e.cap.konteks.bagian==='induk').length,1);
      assert.deepEqual(part('induk')?.pages[0].Payload.Data,[{Keterangan:'Induk '+doc.id}]);
      assert.deepEqual(part('a1')?.pages[0].Payload.Data,[{Uraian:'Lampiran '+doc.id}]);
    }
    if(mode==='missing-action'){
      assert.ok(!pkg.entries.some(e=>e.cap.konteks?.spt?.recordId===records[1].id));
      assert.ok(pkg.manifest.cek.some(c=>c.kode==='SPT-TAMPILAN'&&/tombol lihat/i.test(c.pesan)));
    }
    assert.ok(!pkg.entries.some(e=>e.cap.konteks?.spt?.recordId===records[2].id));
    if(mode==='complete')await verifyViewer(ctx,page,pkg,true);
  }finally{allowRevision();await ctx?.close();await rm(profile,{recursive:true,force:true});}
}
const scenarios=['complete','stop','restart','wrong-owner','missing-action','import'];
for(const mode of process.argv.length>2?process.argv.slice(2):scenarios){
  assert.ok(scenarios.includes(mode));await run(mode);
}
console.log('PASS · Mulai tarik SPT · '+(process.argv.length>2?process.argv.slice(2):scenarios).join(', '));
