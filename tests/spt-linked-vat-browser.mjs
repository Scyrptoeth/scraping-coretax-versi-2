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
    field('NPWP*',wp)+'<div class="form-group row"><label>Periode *</label>'+
    '<input disabled formcontrolname="Period" value="012025"><input disabled formcontrolname="BookkeepingPeriod" value="01-12"></div>'+revision+
    '<table><tbody><tr><td>Jumlah penyerahan</td><td><input value="12.345" disabled></td></tr></tbody></table></div>'+
    '<div role="tabpanel" id="appendix" hidden>'+field('MASA','012025')+field('Nomor Identitas WP',wp)+revision+
    '<table><thead><tr><th>No.</th><th>DPP</th></tr></thead><tbody><tr><td colspan="2">Tidak ada data yang ditemukan.</td></tr></tbody></table></div>'+
    '<script>function showAnnex(){document.querySelector("[aria-selected=true]").setAttribute("aria-selected","false");document.querySelector("#a-tab").setAttribute("aria-selected","true");document.querySelector("#main").hidden=true;document.querySelector("#appendix").hidden=false}</script></main>');
  const worker=ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const page=await ctx.newPage();await page.goto(list);
  const ui=await ctx.newPage();
  await ui.goto(new URL('app.html',worker.url()).href);
  await page.goto(detail);
  const month=await ui.evaluate(async ({list,detail})=>{
    const {readSptView}=await import('./app-spt-navigation.js');
    const [tab]=await chrome.tabs.query({url:detail});
    const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:readSptView,
      args:[{expectedUrl:detail,linkedIndex:list,linkedType:'VAT_VATR'}]});
    return result?.meta?.['masa pajak']??null;
  },{list,detail});
  assert.equal(month,'2025-01');
  await page.goto(list);
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
  const readUnnumbered=()=>ui.evaluate(async ({list,wp})=>{
    const {readSubmittedPreview}=await import('./app-spt-preview.js');
    const {planSptDetails}=await import('./app-spt-plan.js');
    const {sptNavigation}=await import('./app-spt-navigation.js');
    const [tab]=await chrome.tabs.query({url:list}), pages=[];
    const checkpoint=()=>{};
    const report=await readSubmittedPreview(chrome,tab,wp,{checkpoint,limit:Infinity,workTab:true,onPage:page=>pages.push(page)});
    const items=pages.map(({rows,ownerEvidence,indexScope},i)=>({source:'sptdaftar',wp,
      page:{Payload:{Data:rows}},previewBinding:{scope:{wp},route:new URL(list).pathname},
      proof:{ownerEvidence,indexScope,halamanDaftar:i+1,daftarPratinjau:{...report,id:'complete-index'}}}));
    const period={from:{y:2025,m:1},to:{y:2025,m:1}};
    const {documents:[doc]}=planSptDetails({wp,period,items,strictReceipts:true,allowLinkedRows:true});
    if(!doc?.linkedRow || doc.receipt || doc.recordId)throw Error('The verified directory did not supply exactly this unnumbered version.');
    const nav=sptNavigation({ext:chrome,wp,period,doc,allowLinkedReturn:true});
    const view=await nav.open(tab.id), main=await nav.capture(view,'induk');
    self.unnumberedRun={nav,view};
    return {linked:main.linkedRecordId,record:main.recordId,receipt:main.receipt};
  },{list,wp});
  const originalVatList=routes.get(list);
  const readVatRoute=detail+'?view=true';
  routes.set(readVatRoute,routes.get(detail).replaceAll('>Normal<','>Silakan pilih<'));
  routes.set(list,originalVatList.replaceAll(detail,readVatRoute).replace(/>BPE-INDEX-(?:JAN|FEB)</g,'>-<'));
  try {
    await page.goto(list);
    const record=new URL(readVatRoute).pathname.split('/').at(-3);
    assert.deepEqual(await readUnnumbered(),{linked:record,record,receipt:null});
    const annex=await ui.evaluate(async()=>{
      const {nav,view}=self.unnumberedRun;
      return await nav.capture(view,'a1');
    });
    assert.equal(annex.linkedRecordId,record);
    await page.locator('#appendix .p-dropdown-label').evaluate(el=>el.textContent='Pembetulan 2');
    const conflict=await ui.evaluate(async()=>{
      const {nav,view}=self.unnumberedRun;
      try {await nav.capture(view,'a1');}catch(error){return error.code;}
      return null;
    });
    assert.equal(conflict,'IDENTITY');
    await page.locator('#appendix .p-dropdown-label').evaluate(el=>el.textContent='Silakan pilih');
    await page.locator('#appendix').evaluate(el=>{
      const input=document.createElement('input');
      input.id='unsaved-edit';
      input.value='changed';
      el.append(input);
    });
    const restoreTimedOut=()=>ui.evaluate(async list=>{
      const {nav,view}=self.unnumberedRun;
      try {await nav.returnToIndex(view,list,view.tabId,()=>{},true);}catch(error){return error.code;}
      return null;
    },list);
    assert.equal(await restoreTimedOut(),'SCOPE');
    await page.locator('#unsaved-edit').evaluate(el=>el.remove());
    await page.locator('main').evaluate(el=>el.hidden=true);
    assert.equal(await restoreTimedOut(),null);
    await page.waitForURL(list);
  } finally {routes.set(list,originalVatList);}
  for (const [type,form,route,heading] of [
    ['ICT_WITR','Masa PPh 21/26',detail.replace('value-added-tax-return','article-21-26-tax-return').replace('VAT_VAT','ICT_WIT')+'?view=true','PEMOTONGAN PPH PASAL 21 DAN/ATAU PASAL 26'],
    ['ICT_WTR','Masa PPh Unifikasi',detail.replace('value-added-tax-return','withholding-tax-return').replace('VAT_VAT','01012025'),'SPT MASA PPH UNIFIKASI']
  ]) {
    const positive=type==='ICT_WITR';
    const labels=positive?['Induk','L-IA','L-IB','L-II','L-III']:['INDUK','DAFTAR-I','DAFTAR-II','LAMPIRAN-I'];
    const annexTable=value=>'<table><thead><tr><th>No.</th><th>DPP</th></tr><tr><th></th><th><input type="search" aria-label="Cari"></th></tr></thead>'+
      '<tbody><tr><td>1</td><td>'+value+'</td></tr></tbody></table>';
    const annexHeader=field('Nomor Identitas WP',wp)+'<div class="form-group row"><label>MASA PAJAK (MM-YYYY)</label><input type="text" class="annex-period"></div>';
    const withholdingPanel=i=>i===0?annexHeader+annexTable('85'):i===1?annexHeader+
      ['BPA2','BPA1'].map((title,index)=>'<p-panel><span class="p-panel-title">'+title+'</span>'+annexTable(index===0?'150':'100')+'</p-panel>').join(''):'';
    const markup=(positive?'<main hidden>':'<main>')+'<h2>'+heading+'</h2><ul class="p-tabview-nav">'+labels.map((label,i)=>
      '<li><a role="tab" aria-controls="section'+i+'" aria-selected="'+(i===0)+'" onclick="selectPart(this)">'+label+'</a></li>').join('')+'</ul>'+
      '<div role="tabpanel" id="section0">'+field('1. NPWP',wp)+field('Masa Pajak','1')+field('Tahun Pajak','2025')+
      (positive?'<div class="form-group row"><label>Status SPT</label><input disabled value=""><span class="p-dropdown-label">Pembetulan</span></div>'
        :field('NPWP',other)+field('Status Penyampaian','-'))+
      '<table><tr><td>Jumlah pajak</td><td><input disabled value="500"></td></tr></table></div>'+
      labels.slice(1).map((_,i)=>'<div role="tabpanel" hidden id="section'+(i+1)+'">'+(positive?withholdingPanel(i):'')+'</div>').join('')+
      '<script>function selectPart(tab){const prior=document.querySelector("[aria-selected=true]");'+
      'document.getElementById(prior.getAttribute("aria-controls")).hidden=true;prior.setAttribute("aria-selected","false");'+
      'tab.setAttribute("aria-selected","true");const active=document.getElementById(tab.getAttribute("aria-controls"));active.hidden=false;'+
      'const period=active.querySelector(".annex-period");if(period)period.value="01-2025"}'+
      (positive?'setTimeout(()=>document.querySelector("main").hidden=false,4600);':'')+'</script></main>';
    const oldList=routes.get(list);
    const listMarkup=oldList.replaceAll('SPT Masa PPN',form).replaceAll(detail,route);
    routes.set(route,markup);routes.set(list,positive?listMarkup.replaceAll('>Normal<','>Pembetulan 1<'):listMarkup);await page.goto(list);
    try {
      const value=await ui.evaluate(async ({wp,list,type,form})=>{
        const {planSptDetails}=await import('./app-spt-plan.js'), {sptNavigation}=await import('./app-spt-navigation.js');
        const period={from:{y:2025,m:1},to:{y:2025,m:1}};
        const listed={'Jenis SPT':form,'Masa Pajak':'Januari 2025','Model SPT':type==='ICT_WITR'?'Pembetulan 1':'Normal',
          'Nomor Bukti Penerimaan':'BPE-INDEX-JAN'};
        const {documents:[doc]}=planSptDetails({wp,period,items:[{source:'sptdaftar',wp,page:{Payload:{Data:[listed]}}}]});
        const tab=(await chrome.tabs.query({url:list}))[0];
        let waiting=0;
        const nav=sptNavigation({ext:chrome,wp,period,doc,allowLinkedReturn:true,onLoading:()=>waiting++});
        if(type==='ICT_WTR'){
          try {await nav.open(tab.id);} catch {return {restored:await nav.recoverIndex(tab.id,list)};}
          throw Error('The unverified signing identity was accepted');
        }
        const view=await nav.open(tab.id), capture=await nav.capture(view,'induk');
        const {readSptView}=await import('./app-spt-navigation.js');
        const [{result:unlinked}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:readSptView,
          args:[{linkedIndex:list,linkedType:type,expectedUrl:(await chrome.tabs.get(tab.id)).url}]});
        const a1=await nav.capture(view,'l1b-a1'),a2=await nav.capture(view,'l1b-a2');
        const annex=await nav.capture(view,'l1a');
        self.withholdingCheck={nav,view};
        return {parts:view.sections.map(s=>s.part),unresolved:view.unresolved,receipt:capture.receipt,basis:capture.identityBasis,unlinked,waiting,
          annex:[annex,a1,a2].map(part=>part.rows.map(row=>row.DPP)),
          values:capture.rows.filter(r=>r.Tabel===1).map(r=>r['Isian pada formulir'])};
      },{wp,list,type,form});
      if(positive){
        assert.deepEqual(value.parts,['induk','l1a','l1b-a1','l1b-a2','l2-a1','l2-a2','l3-bp21','l3-bp26']);
        assert.equal(value.unresolved,0);
        assert.ok(value.waiting>0);
        assert.equal(value.receipt,'BPE-INDEX-JAN');
        assert.deepEqual(value.values,['Jumlah pajak','500']);
        assert.match(value.basis,/pembetulan pada baris/);
        assert.equal(value.unlinked.meta['model spt'],'pembetulan');
        assert.deepEqual(value.annex,[['85'],['100'],['150']]);
        await page.locator('#section1 .annex-period').fill('02-2025');
        const changed=await ui.evaluate(async()=>{
          const {nav,view}=self.withholdingCheck;
          try {await nav.capture(view,'l1a');}catch(error){return error.code;}
          return '';
        });
        assert.equal(changed,'IDENTITY');
        await page.locator('#section1 .annex-period').fill('01-2025');
        await ui.evaluate(async list=>{
          const {nav,view}=self.withholdingCheck;
          await nav.returnToIndex(view,list,view.tabId);
        },list);
        await page.waitForURL(list);
        const editRoute=route.replace('?view=true','?view=false');
        routes.set(editRoute,markup);
        await page.goto(editRoute);
        await page.locator('main').waitFor();
        const readEdit=await ui.evaluate(async ({list,type,editRoute})=>{
          const {readSptView}=await import('./app-spt-navigation.js');
          const [tab]=await chrome.tabs.query({url:editRoute});
          const [{result}]=await chrome.scripting.executeScript({
            target:{tabId:tab.id},func:readSptView,args:[{linkedIndex:list,linkedType:type,linkedRevision:0,expectedUrl:editRoute}]
          });
          return result;
        },{list,type,editRoute});
        assert.equal(readEdit,null);
        routes.set(list,listMarkup.replaceAll('>Normal<','>Pembetulan 1<').replace(/>BPE-INDEX-(?:JAN|FEB)</g,'>-<'));
        await page.goto(list);
        const linkedId=new URL(route).pathname.split('/').at(-3);
        assert.deepEqual(await readUnnumbered(),{linked:linkedId,record:linkedId,receipt:null});
      } else {assert.equal(value.restored,true);await page.waitForURL(list);}
    } finally {routes.set(list,oldList);}
  }
  assert.equal(fixture.visited.some(address=>address.endsWith('/incorrect')),false);
  console.log('The receipt selected in the index, the read-only form, the active appendix and the owner change matched their expected results.');
} finally { await fixture.close(); }
