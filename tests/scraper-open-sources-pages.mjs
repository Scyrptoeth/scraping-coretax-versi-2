import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readPackage} from '../extension/archive/package.js';

function installFixture({wp,catalogue,copy,holdBank}){
  document.body.replaceChildren();
  const modes={bank:'first',flag:'owner',klu:'filter',pihak:'no-first',nomorlain:'overlap',sertel:'peers',bb:'months',bbtotal:'stable-filter',pbb:'empty',dokumen:'total'};
  for(const [id,title,fields] of catalogue){
    const mode=modes[id];if(!mode || (copy && id!=='sertel'))continue;
    const host=document.createElement('section');host.className='p-datatable';
    host.innerHTML='<input type="search" aria-label="Cari"><table><caption></caption><thead><tr></tr></thead><tbody></tbody></table>'+
      '<div class="p-paginator"><span class="p-paginator-current"></span><button type="button">Halaman pertama</button>'+
      '<button type="button">Berikutnya</button></div>';
    document.body.append(host);
    const table=host.querySelector('table'),[first,next]=host.querySelectorAll('button'),filter=host.querySelector('input');
    if(mode==='stable-filter')filter.value='kondisi fiktif';
    table.id=id;table.caption.textContent=title;
    for(const h of ['NPWP pemilik',...fields]){
      const th=document.createElement('th');th.textContent=h;table.tHead.rows[0].append(th);
    }
    let n=['first','no-first'].includes(mode)?1:0;
    if(mode==='no-first')first.remove();
    function draw(){
      const total=mode==='empty'?0:mode==='total'&&n>0?6:5;
      const start=n*2,stop=Math.min(start+2,total);table.tBodies[0].replaceChildren();
      for(let i=start;i<stop;i++){
        const row=table.tBodies[0].insertRow();
        const k=mode==='overlap'&&i===2?1:i;
        const owner=mode==='owner'&&n>0?'0000000000000018':wp;
        row.insertCell().textContent=owner;
        for(const field of fields){
          const value=/PeriodCode/.test(field)?(i%2?'02022025':'01012025'):field==='Tahun pajak'?'2025':
            field==='PostingDate'?'2025-01-03':field==='Amount'||['Debit','Credit','Balance'].includes(field)?String(k+10):
            'UJI-'+field+'-'+k+(copy&&n>0?'-SALINAN':'');
          row.insertCell().textContent=value;
        }
      }
      if(mode==='filter'&&n>0)filter.value='berubah';
      host.querySelector('span').textContent=(total?start+1:0)+'–'+stop+' dari '+total;
      first.disabled=n===0;next.disabled=stop===total;
      host.removeAttribute('aria-busy');
    }
    function jump(number){
      n=number;host.setAttribute('aria-busy','true');
      if(holdBank&&id==='bank'&&n===1){
        holdBank=false;host.dataset.held='true';host.addEventListener('release-fixture',draw,{once:true});
      }else setTimeout(draw,35);
    }
    first.onclick=()=>jump(0);next.onclick=()=>jump(n+1);draw();
  }
}

export async function testOpenSourcePagination({ctx,ui,addr,wp,catalogue}){
  const tabs=[];
  for(const copy of [false,true]){
    const tab=await ctx.newPage();await tab.goto(addr(0));await tab.evaluate(installFixture,{wp,catalogue,copy});tabs.push(tab);
  }
  await ui.reload();await ui.locator('#officer').fill('Penguji paginasi');await ui.locator('#ids').fill(wp);
  for(const end of ['start','end'])await ui.locator('#year-'+end).selectOption('2025');
  await ui.locator('#month-start').selectOption('01');await ui.locator('#month-end').selectOption('03');
  const wanted=new Set(['bank','flag','klu','pihak','nomorlain','sertel','bb','bbtotal','pbb','dokumen']);
  for(const input of await ui.locator('#sources input').all())await input.setChecked(wanted.has(await input.inputValue()));
  await ui.locator('#consent').check();await ui.locator('#preview').click();
  await ui.locator('#other-preview').getByRole('button',{name:'Tambahkan sumber terverifikasi'}).waitFor();
  await ui.locator('#start').click();await ui.locator('#status').getByText(/Tarikan selesai untuk NPWP/).waitFor({timeout:30000});
  await ui.getByRole('button',{name:'Unduh paket'}).first().click();
  const [file]=await Promise.all([ui.waitForEvent('download'),ui.locator('#package-dialog button[value=ok]').click()]);
  const pkg=await readPackage(await readFile(await file.path()));assert.ok(pkg.report.valid);
  const entries=id=>pkg.entries.filter(e=>e.cap.sumber===id),bank=entries('bank')[0];
  assert.equal(bank.cap.lengkap,true);assert.equal(bank.cap.total,5);
  assert.deepEqual(bank.pages.flatMap(p=>p.Payload.Data.map(r=>r.BankAccountNumber)),Array.from({length:5},(_,i)=>'UJI-BankAccountNumber-'+i));
  const proof=bank.cap.halamanSumber.map(h=>h.pencocokan.pratinjauSumber.paginasi);
  assert.deepEqual(proof.map(p=>[p.halaman,p.awal,p.akhir,p.rentang.first,p.rentang.last]),[[1,true,false,1,2],[2,false,false,3,4],[3,false,true,5,5]]);
  assert.equal(new Set(proof.map(p=>p.sidikRangkaian)).size,1);assert.equal(new Set(proof.map(p=>p.sidikHalaman)).size,3);
  for(const source of ['flag','klu','pihak','nomorlain','sertel','dokumen']){
    const e=entries(source)[0];assert.ok(e,source);assert.equal(e.cap.baris,2,source);assert.equal(e.cap.lengkap,false,source);
  }
  assert.equal(entries('pihak')[0].cap.halamanSumber[0].pencocokan.pratinjauSumber.paginasi.awal,false);
  assert.equal(entries('pbb').length,0);
  for(const source of ['bb','bbtotal']){
    const monthly=entries(source).sort((a,b)=>a.path.localeCompare(b.path));
    assert.deepEqual(monthly.map(e=>e.cap.baris),[3,2]);
    assert.deepEqual(monthly.map(e=>e.pages.length),[3,2]);assert.ok(monthly.every(e=>!e.cap.lengkap));
    for(const e of monthly)for(const p of e.pages)assert.ok(p.Payload.Data.every(r=>(r.TaxPeriodCode||r.PeriodCode).slice(0,2)===e.path.slice(-7,-5)));
  }
  assert.ok(entries('bbtotal').every(e=>e.cap.halamanSumber.every(h=>h.pencocokan.pratinjauSumber.filterAktif)));
  const issues=JSON.stringify(pkg.manifest.cek);
  for(const reason of ['Identitas WP','baris yang sama','salinan tabel berbeda','halaman pertama','Tabel kosong','filter pada tabel'])assert.match(issues,new RegExp(reason,'i'));
  const open=ctx.waitForEvent('page');await ui.getByRole('button',{name:'Buka di Analisis'}).first().click();
  const viewer=await open;await viewer.locator('#navigation').getByRole('button',{name:'Profil WP',exact:true}).click();
  await viewer.getByRole('button',{name:'Rekening bank (5)',exact:true}).click();
  for(let i=0;i<5;i++)await viewer.getByRole('cell',{name:'UJI-BankAccountNumber-'+i,exact:true}).first().waitFor();
  await viewer.close();await tabs[1].close();
  const onlyBank=catalogue.filter(item=>item[0]==='bank');
  await tabs[0].evaluate(installFixture,{wp,catalogue:onlyBank,holdBank:true});
  await ui.reload();await ui.locator('#officer').fill('Penguji pemulihan');await ui.locator('#ids').fill(wp);
  for(const end of ['start','end'])await ui.locator('#year-'+end).selectOption('2025');
  for(const input of await ui.locator('#sources input').all())await input.setChecked(await input.inputValue()==='bank');
  await ui.locator('#consent').check();await ui.locator('#start').click();
  const held=tabs[0].locator('[data-held=true]');await held.waitFor();
  await ui.locator('#stop').click();await held.evaluate(host=>host.dispatchEvent(new Event('release-fixture')));
  const resume=ui.locator('#pending-jobs').getByRole('button',{name:'Lanjutkan NPWP '+wp,exact:true});
  await resume.waitFor();await ui.reload();
  await ui.getByRole('button',{name:'Muat penugasan tersimpan',exact:true}).click();
  await ui.locator('#consent').check();await resume.click();
  await ui.locator('#status').getByText(/Tarikan selesai untuk NPWP/).waitFor();
  await ui.getByRole('button',{name:'Unduh paket'}).first().click();
  const [resumedFile]=await Promise.all([ui.waitForEvent('download'),ui.locator('#package-dialog button[value=ok]').click()]);
  const restored=await readPackage(await readFile(await resumedFile.path()));
  assert.deepEqual(restored.entries[0].pages,bank.pages);assert.equal(restored.entries[0].cap.lengkap,true);
  await tabs[0].close();
  console.log('PASS: first/next through 3 bank pages (5 rows) in the ZIP and player, 2 ledger months, filter and owner changes, changed totals, conflicting copies, repeated rows, missing first control and unverified zero.');
  console.log('PASS: stopped after the first saved non-SPT page, reloaded, restored the assignment and completed the same 5 rows across 3 pages without duplication.');
}
