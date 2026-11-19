import assert from 'node:assert/strict';
import {launchHomeFixture,list,origin,wp,other} from './scraper-home-fixture.mjs';

const fixture=await launchHomeFixture();
try {
  const {ctx,routes}=fixture;
  const ownerId=list.split('/').at(-1);
  const detail=origin+'/returnsheets/id-ID/value-added-tax-return/'+ownerId+'/00000000-0000-4000-8000-000000000002/VAT_VAT/00000000-0000-4000-8000-000000000003';
  const button='<button type="button" id="ViewButton" onclick="location.href=\''+detail+'\'"><span class="pi pi-eye"></span></button>';
  const otherButtons=['SendEmailButton','ViewReceiptButton','RequestDownloadPdfButton'].map(id=>
    '<button type="button" id="'+id+'" onclick="location.href=\'/incorrect\'"></button>').join('');
  routes.set(list,routes.get(list).replace('<th>ID SPT</th>','').replace(/<td>INDEX-(?:JAN|FEB)<\/td>/g,'')
    .replace(/<a href="[^"]*simulasi-spt\/[^"]*">Lihat SPT<\/a>/g,button+otherButtons));
  const field=(label,value)=>'<div class="form-group row"><label>'+label+'</label><input disabled value="'+value+'"></div>';
  const revision='<div class="form-group row"><label>Normal/Pembetulan</label><input disabled value=""><span class="p-dropdown-label">Normal</span></div>';
  routes.set(detail,'<main><ul class="p-tabview-nav"><li><a role="tab" aria-controls="main" aria-selected="true">INDUK</a></li>'+
    '<li><a id="a-tab" role="tab" aria-controls="appendix" aria-selected="false" onclick="showAnnex()">A-1</a></li></ul>'+
    '<div role="tabpanel" id="main"><h3>SURAT PEMBERITAHUAN MASA PAJAK PERTAMBAHAN NILAI (SPT MASA PPN)</h3>'+
    field('NPWP*',wp)+field('Periode *','012025')+revision+
    '<table><tbody><tr><td>Jumlah penyerahan</td><td><input value="12.345" disabled></td></tr></tbody></table></div>'+
    '<div role="tabpanel" id="appendix" hidden>'+field('MASA','012025')+field('Nomor Identitas WP',wp)+revision+
    '<table><thead><tr><th>No.</th><th>DPP</th></tr></thead><tbody><tr><td colspan="2">Tidak ada data yang ditemukan.</td></tr></tbody></table></div>'+
    '<script>function showAnnex(){document.querySelector("[aria-selected=true]").setAttribute("aria-selected","false");document.querySelector("#a-tab").setAttribute("aria-selected","true");document.querySelector("#main").hidden=true;document.querySelector("#appendix").hidden=false}</script></main>');
  const worker=ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const page=await ctx.newPage();await page.goto(list);
  const ui=await ctx.newPage();
  await ui.goto(new URL('app.html',worker.url()).href);
  const result=await ui.evaluate(async ({wp,list})=>{
    const {planSptDetails}=await import('./app-spt-plan.js'), {sptNavigation}=await import('./app-spt-navigation.js');
    const period={from:{y:2025,m:1},to:{y:2025,m:1}};
    const listed={'Jenis Surat Pemberitahuan Pajak':'SPT Masa PPN','Masa Pajak':'Januari 2025','Model SPT':'Normal','Nomor Bukti Penerimaan':'BPE-INDEX-JAN'};
    const {documents:[doc]}=planSptDetails({wp,period,items:[{source:'sptdaftar',wp,page:{Payload:{Data:[listed]}}}]});
    const tab=(await chrome.tabs.query({url:list}))[0];
    const nav=sptNavigation({ext:chrome,wp,period,doc,allowLinkedReturn:true});
    const view=await nav.open(tab.id);
    const main=await nav.capture(view,'induk');
    const annex=await nav.capture(view,'a1');
    self.vatRun={nav,view};
    return {record:main.recordId,number:main.receipt,basis:main.identityBasis,
      values:main.rows.filter(r=>r.Tabel===1).map(r=>r['Isian pada formulir']),empty:annex.zero,coverage:main.atEnd};
  },{wp,list});
  assert.equal(result.record,null);
  assert.equal(result.number,'BPE-INDEX-JAN');
  assert.match(result.basis,/baris daftar/);
  assert.deepEqual(result.values,['Jumlah penyerahan','12.345']);
  assert.equal(result.empty,true);
  assert.equal(result.coverage,false);
  await page.locator('#appendix input').nth(1).evaluate((el,owner)=>el.value=owner,other);
  assert.equal(await ui.evaluate(async ()=>{
    try { await self.vatRun.nav.capture(self.vatRun.view,'a1'); } catch(e) { return e.code; }
  }),'IDENTITY');
  for (const [type,form,route,heading] of [
    ['ICT_WITR','Masa PPh 21/26',detail.replace('value-added-tax-return','article-21-26-tax-return').replace('VAT_VAT','ICT_WIT'),'PEMOTONGAN PPH PASAL 21 DAN/ATAU PASAL 26'],
    ['ICT_WTR','Masa PPh Unifikasi',detail.replace('value-added-tax-return','withholding-tax-return').replace('VAT_VAT','01012025'),'SPT MASA PPH UNIFIKASI']
  ]) {
    const positive=type==='ICT_WITR';
    const labels=positive?['Induk','L-IA','L-IB','L-II','L-III']:['INDUK','DAFTAR-I','DAFTAR-II','LAMPIRAN-I'];
    const markup='<main><h2>'+heading+'</h2><ul class="p-tabview-nav">'+labels.map((label,i)=>
      '<li><a role="tab" aria-controls="section'+i+'" aria-selected="'+(i===0)+'">'+label+'</a></li>').join('')+'</ul>'+
      '<div role="tabpanel" id="section0">'+field('1. NPWP',wp)+field('Masa Pajak','1')+field('Tahun Pajak','2025')+
      (positive?field('Status SPT','Normal'):field('NPWP',other)+field('Status Penyampaian','-'))+
      '<table><tr><td>Jumlah pajak</td><td><input disabled value="500"></td></tr></table></div>'+
      labels.slice(1).map((_,i)=>'<div role="tabpanel" hidden id="section'+(i+1)+'"></div>').join('')+'</main>';
    const oldList=routes.get(list);
    routes.set(route,markup);routes.set(list,oldList.replaceAll('SPT Masa PPN',form).replaceAll(detail,route));await page.goto(list);
    try {
      const value=await ui.evaluate(async ({wp,list,type,form})=>{
        const {planSptDetails}=await import('./app-spt-plan.js'), {sptNavigation}=await import('./app-spt-navigation.js');
        const period={from:{y:2025,m:1},to:{y:2025,m:1}};
        const listed={'Jenis SPT':form,'Masa Pajak':'Januari 2025','Model SPT':'Normal','Nomor Bukti Penerimaan':'BPE-INDEX-JAN'};
        const {documents:[doc]}=planSptDetails({wp,period,items:[{source:'sptdaftar',wp,page:{Payload:{Data:[listed]}}}]});
        const tab=(await chrome.tabs.query({url:list}))[0];
        const nav=sptNavigation({ext:chrome,wp,period,doc,allowLinkedReturn:true});
        if(type==='ICT_WTR'){
          try {await nav.open(tab.id);} catch {return {restored:await nav.recoverIndex(tab.id,list)};}
          throw Error('The unverified signing identity was accepted');
        }
        const view=await nav.open(tab.id), capture=await nav.capture(view,'induk');
        return {parts:view.sections.map(s=>s.part),unresolved:view.unresolved,receipt:capture.receipt,
          values:capture.rows.filter(r=>r.Tabel===1).map(r=>r['Isian pada formulir'])};
      },{wp,list,type,form});
      if(positive){
        assert.deepEqual(value.parts,['induk','l1a','l1b','l2','l3']);
        assert.equal(value.unresolved,3);
        assert.equal(value.receipt,'BPE-INDEX-JAN');
        assert.deepEqual(value.values,['Jumlah pajak','500']);
      } else {assert.equal(value.restored,true);await page.waitForURL(list);}
    } finally {routes.set(list,oldList);}
  }
  assert.equal(fixture.visited.some(address=>address.endsWith('/incorrect')),false);
  console.log('The receipt selected in the index, the read-only form, the active appendix and the owner change matched their expected results.');
} finally { await fixture.close(); }
