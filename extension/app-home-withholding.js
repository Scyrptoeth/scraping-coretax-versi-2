import {normalizeId,visibleTables} from './app-data.js';
import {homeWithholdingGroup,planHomeCapture,verifyHomeRowOwners} from './app-home-plan.js';
import {homeGroupUpdate,readSourcePages} from './app-home-sources.js';

const origin='https://coretax.intranet.pajak.go.id';
const reportPath='/report-native/id-ID/withholding-slips/withholding-report-008';
const heading='Daftar Bukti Pemotongan atau Pemungutan yang Diterima Wajib Pajak';
const kinds={
  BPPU:'BPPU',BPSP:'Penyetoran Sendiri',BP21:'BP 21 – Bukti Pemotongan Selain Pegawai Tetap',
  BP26:'BP 26 – Bukti Pemotongan Wajib Pajak Luar Negeri',BPA1:'BP A1 – Bukti Pemotongan A1 Masa Pajak Terakhir',
  BPA2:'BP A2 – Bukti Pemotongan A1 Masa Pajak Terakhir',BPCY:'BPCY',NPMP:'Bukti Pemotongan Bulanan Pegawai Tetap'
};

export function reportMenu({heading,path,expand}) {
  if(location.origin!=='https://coretax.intranet.pajak.go.id'||!/^\/home\/id-ID\/?$/.test(location.pathname))return null;
  const visible=el=>el.getClientRects().length && el.checkVisibility({visibilityProperty:true,opacityProperty:true});
  const buttons=[...document.querySelectorAll('button')].filter(b=>visible(b) && b.innerText.trim()==='Laporan' && !b.disabled);
  const menuState=Symbol.for('coretax-v2.withholding-report-menu');
  const opened=buttons.length===1&&document[menuState]===buttons[0];
  const links=[...document.querySelectorAll('a[href]')].filter(a=>
    (visible(a)||opened&&a.getClientRects().length&&a.checkVisibility({visibilityProperty:true})) && a.innerText.trim()===heading &&
    a.origin===location.origin && a.pathname===path && !a.search && !a.hash && !a.username && !a.password);
  if(links.length===1)return {url:links[0].href};
  if(expand && buttons.length===1){
    if(!opened&&buttons[0].getAttribute('aria-expanded')!=='true'){
      document[menuState]=buttons[0];
      buttons[0].click();
    }
    return {opened:true};
  }
  return null;
}

// Serialized into the report page by Chrome. Each search starts with a fresh
// document. A pre-existing empty row is not evidence of a completed search.
export function withholdingReportScreen({step,url,wp,year,kind,label,heading}) {
  if(location.origin!=='https://coretax.intranet.pajak.go.id'||location.href!==url)return null;
  const visible=el=>el && el.getClientRects().length && el.checkVisibility({visibilityProperty:true,opacityProperty:true});
  const clean=s=>(s||'').replace(/\s+/g,' ').trim();
  const all=(root,selector)=>[...root.querySelectorAll(selector)].filter(visible);
  const one=(root,sel)=>{const els=all(root,sel);return els.length===1?els[0]:null;};
  const exact=(a,b)=>clean(a).replace(/[–—]/g,'-').toLowerCase()===clean(b).replace(/[–—]/g,'-').toLowerCase();
  if(!all(document,'h1,h2,h3,h4,[role=heading],legend,.card-title,.p-panel-title').some(el=>exact(el.innerText,heading)) &&
      !all(document,'span,div,strong').some(el=>!el.childElementCount && exact(el.innerText,heading)))return null;
  const recipient=one(document,'input#NpwpPenerimaPenghasilan');
  const type=one(document,'[formcontrolname="JenisBuktiPotong"]');
  const yearField=one(document,'input[placeholder="Pilih Tahun Pajak"][readonly]');
  if(!recipient||!type||!yearField)return null;
  const typeLabel=()=>clean(type.querySelector('.p-dropdown-label,.p-select-label')?.innerText || type.querySelector('select')?.selectedOptions[0]?.text);
  const sameType=()=>[label,kind].some(t=>exact(t,typeLabel()));
  const owner=()=>clean(recipient.value).replace(/[.\s-]/g,'');
  const years=()=>all(document,'.p-yearpicker-year');
  const busySelector='[aria-busy="true"],.p-datatable-loading-overlay,.p-progress-spinner,.p-progressspinner,[role=progressbar]';
  const stateKey='__scv2WithholdingReportState';
  function scopedFilters(){
    const extra=all(document,'input#NpwpPemotong,input#NomorBuktiPotong,input[formcontrolname="NpwpPemotong"],input[formcontrolname="NomorBuktiPotong"]');
    const dropdowns=all(document,'[formcontrolname="MasaPajak"],[formcontrolname="Status"]');
    return owner()===wp && sameType() && clean(yearField.value)===year && extra.every(el=>!clean(el.value)) &&
      dropdowns.every(el=>{
        const control=el.querySelector('.p-dropdown-label,.p-select-label');
        return !control || control.matches('.p-placeholder') || !clean(control.innerText) || /^(?:pilih(?:lah)?\b|semua\b)/i.test(clean(control.innerText));
      });
  }
  const recipientHeader=el=>exact(el.innerText,'NPWP Penerima Penghasilan');
  const grids=all(document,'table').filter(t=>all(t,'thead th').some(recipientHeader) &&
    all(t,'thead th').some(el=>exact(el.innerText,'Nomor Bukti Pemotongan/Pemungutan')));
  if(grids.length!==1)return null;
  const grid=grids[0];
  if(step==='prepare'){
    if(owner()!==wp){
      if(!['text','tel','search'].includes(recipient.type) || recipient.disabled || recipient.readOnly)return null;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(recipient,wp);
      recipient.dispatchEvent(new Event('input',{bubbles:true}));recipient.dispatchEvent(new Event('change',{bubbles:true}));
      return null;
    }
    if(!sameType()){
      const options=all(document,'[role=option]');
      if(!options.length){
        const trigger=one(type,'.p-dropdown-trigger,.p-select-dropdown');
        if(trigger && type.querySelector('[aria-expanded=true]')==null)trigger.click();
        return null;
      }
      const choices=options.filter(o=>[label,kind].some(text=>exact(o.innerText,text)));
      if(choices.length!==1)return {error:'Pilihan jenis ini belum dapat dicocokkan di laporan Coretax.'};
      choices[0].click();return null;
    }
    if(clean(yearField.value)!==year){
      const options=years(),choice=options.filter(o=>clean(o.innerText)===year);
      if(choice.length===1){choice[0].click();return null;}
      if(!options.length){
        const calendar=yearField.closest('p-calendar,[formcontrolname="TahunPajak"]');
        const open=calendar && one(calendar,'button[aria-label="Open calendar"],button.p-datepicker-trigger');
        if(open)open.click();return null;
      }
      const values=options.map(o=>Number(clean(o.innerText))).filter(Number.isInteger);
      const picker=options[0].closest('.p-datepicker,.p-datepicker-panel');
      const move=picker && (Number(year)<Math.min(...values)?one(picker,'button.p-datepicker-prev'):
        Number(year)>Math.max(...values)?one(picker,'button.p-datepicker-next'):null);
      if(move){move.click();return null;}
      return {error:'Tahun pajak tidak tersedia pada kalender laporan.'};
    }
    if(!scopedFilters())return {error:'Filter penerima, jenis, tahun, atau isian tambahan pada laporan belum cocok.'};
    const search=all(document,'button').filter(b=>exact(b.innerText,'Cari'));
    if(search.length!==1 || search[0].disabled)return null;
    const host=grid.closest('p-table,.p-datatable')||grid;
    globalThis[stateKey]?.observer?.disconnect();
    const state={before:grid.tBodies[0]?.rows[0],busySeen:false,replaced:false};
    const observer=new MutationObserver(changes=>{
      for(const change of changes){
        if(change.type==='attributes' && change.attributeName==='aria-busy' &&
           (change.oldValue==='true'||change.target.getAttribute('aria-busy')==='true'))state.busySeen=true;
        for(const node of [...change.addedNodes,...change.removedNodes]){
          if(node.nodeType===1 && (node.matches(busySelector)||node.querySelector(busySelector)))state.busySeen=true;
          if(node===state.before || node.nodeType===1 && state.before && node.contains(state.before))state.replaced=true;
        }
      }
    });
    observer.observe(host,{subtree:true,childList:true,attributes:true,attributeOldValue:true,attributeFilter:['aria-busy']});
    globalThis[stateKey]={state,observer};
    search[0].click();
    // The form may clear last year's rows synchronously before starting the
    // request. Waiting begins with the placeholder in that cleared grid.
    observer.takeRecords();
    state.before=grid.tBodies[0]?.rows[0];
    state.busySeen=host.matches('[aria-busy=true]') || all(host,busySelector).length>0;
    return {searched:true};
  }
  if(!scopedFilters())return {error:'Filter laporan berubah ketika membaca hasil.'};
  const tracker=globalThis[stateKey];
  if(!tracker)return null;
  const row=grid.tBodies[0]?.rows[0],host=grid.closest('p-table,.p-datatable')||grid;
  const alerts=all(document,'[role=alert],.p-toast-message-error,.p-message-error');
  if(alerts.some(el=>/kesalahan|gagal|tidak diizinkan|ditolak|error|forbidden|unauthorized/i.test(clean(el.innerText))))return {error:'Coretax melaporkan kesalahan saat membuka hasil.'};
  if(all(host,busySelector).length || host.matches('[aria-busy=true]')){tracker.state.busySeen=true;return null;}
  if(!tracker.state.busySeen && !tracker.state.replaced && row===tracker.state.before)return null;
  const headers=all(grid,'thead th'),ownerIndex=headers.findIndex(recipientHeader);
  for(const tr of all(grid,'tbody tr')){
    if(tr.cells.length===1 && tr.cells[0].colSpan>1)continue;
    const recipient=clean(tr.cells[ownerIndex]?.innerText).replace(/[.\s-]/g,'');
    if(!/^\d{15,16}$/.test(recipient)||recipient.padStart(16,'0')!==wp)return {code:'IDENTITY',error:'Identitas penerima pada hasil berbeda atau tidak tercantum.'};
  }
  return {verified:true};
}

export async function collectHomeWithholding({ext,homeTab,wp,period,checkpoint=()=>{},enqueue,replace,items=[],onTab,pageLimit=Infinity}){
  const plan=planHomeCapture({wp,period,sources:['bplawan']});
  const result={added:[],issues:[]},years=[...new Set(plan.months.map(m=>m.slice(0,4)))];
  const range=typeof period==='string'?period:plan.months[0]+' s.d. '+plan.months.at(-1);
  const home=homeTab && new URL(homeTab.url);
  if(!home || home.origin!==origin || !/^\/home\/id-ID\/?$/.test(home.pathname) || normalizeId(wp)!==plan.wp)
    throw Error('Buka beranda Coretax untuk menggunakan laporan bukti potong.');
  await checkpoint();
  const tab=await ext.tabs.create({url:origin+'/home/id-ID/',active:false,...(Number.isInteger(homeTab.windowId)?{windowId:homeTab.windowId}:{})});
  await onTab?.(tab.id);
  const run=async(id,func,arg)=>(await ext.scripting.executeScript({target:{tabId:id},func,args:[arg]}))[0]?.result;
  const wait=async(fn,message)=>{
    const end=Date.now()+15000;
    do{
      await checkpoint();
      let value;
      try{value=await fn();}
      catch(error){if(!/frame.*(?:removed|navigat)|cannot access|no frame with id/i.test(error.message))throw error;}
      if(value?.error)throw Error(value.error);
      if(value)return value;
      await new Promise(resolve=>setTimeout(resolve,180));
    }while(Date.now()<end);
    throw Error(message);
  };
  function issue(year,kind,reason){result.issues.push('Bukti potong dari lawan transaksi · '+kind+' '+year+' · '+reason);}
  let reportUrl;
  try{
    const args={heading,path:reportPath};
    const menu=await wait(()=>run(tab.id,reportMenu,{...args,expand:true}),'Menu Laporan belum tersedia di beranda Coretax.');
    const link=menu.url?menu:await wait(()=>run(tab.id,reportMenu,{...args,expand:false}),'Tautan laporan bukti potong yang diterima WP belum tersedia di menu Laporan.');
    reportUrl=link.url;
  }catch(error){
    if(error.code)throw error;
    for(const year of years)for(const kind of Object.keys(kinds))issue(year,kind,error.message);
    return result;
  }
  if(reportUrl!==origin+reportPath)throw Error('Alamat laporan bukti potong belum dapat dipastikan.');
  for(const year of years)for(const [kind,label] of Object.entries(kinds)){
    await checkpoint();
    const previous=items.filter(e=>e.source==='bplawan' && e.wp===plan.wp && e.period===range &&
      String(e.proof?.dariBeranda?.buktiPotong?.tahun)===year && e.proof.dariBeranda.buktiPotong.jenis===kind);
    if(previous.length && previous.every(e=>e.proof.dariBeranda.rentangUtuh && !e.proof.morePagesAvailable))continue;
    if(kind==='NPMP'){issue(year,kind,'Coretax mensyaratkan NPWP pemotong untuk bukti potong bulanan pegawai tetap.');continue;}
    const args={url:reportUrl,wp:plan.wp,year,kind,label,heading};
    const check=async()=>{
      const state=await run(tab.id,withholdingReportScreen,{...args,step:'check'});
      if(state?.error)throw Object.assign(Error(state.error),{code:state.code});
      return state?.verified===true;
    };
    try{
      // Navigate through a distinct home document between searches. This
      // clears prior filters and results, including two consecutive empty grids.
      if((await ext.tabs.get(tab.id)).url===reportUrl){
        const homeUrl=origin+'/home/id-ID/';
        await ext.tabs.update(tab.id,{url:homeUrl});
        await wait(async()=>{const t=await ext.tabs.get(tab.id);return t.url===homeUrl && t.status==='complete';},'Beranda belum selesai dimuat.');
      }
      await ext.tabs.update(tab.id,{url:reportUrl});
      await wait(()=>run(tab.id,withholdingReportScreen,{...args,step:'prepare'}),'Filter laporan belum dapat diterapkan.');
      await wait(check,'Coretax belum menunjukkan bahwa hasil pencarian telah diperbarui.');
      const list=await run(tab.id,visibleTables,null);
      const grids=list?.filter(t=>t.labels.includes('NPWP Penerima Penghasilan')&&t.labels.includes('Nomor Bukti Pemotongan/Pemungutan'))||[];
      if(grids.length!==1)throw Error('Tabel laporan untuk penerima belum dapat dicocokkan.');
      const read=await readSourcePages({run,id:tab.id,table:grids[0],url:reportUrl,screen:check,checkpoint,pageLimit});
      for(const note of read.notes)issue(year,kind,note);
      verifyHomeRowOwners(read.rows,{source:'bplawan',wp:plan.wp});
      for(const row of read.rows){
        const group=homeWithholdingGroup(row,kind);
        if(!group || String(group.tahun)!==year)throw Error('Masa, tahun, atau jenis bukti pada hasil belum cocok dengan filter laporan.');
      }
      const zero=read.complete && read.total===0 && !read.filtered && !read.rows.length;
      if(!read.rows.length && !zero){issue(year,kind,'Belum ada hasil yang dapat dipastikan.');continue;}
      const group={tahun:year,jenis:kind};
      const proof={columns:grids[0].labels,morePagesAvailable:read.morePagesAvailable,...(zero?{nolPadaSumber:true}:{}),
        dariBeranda:{bagian:'Laporan bukti potong yang diterima',kelompok:JSON.stringify(['','',group]),buktiPotong:group,
          jumlahHalaman:read.pages,barisSumber:read.rows.length,totalTampilan:read.total??null,rentangUtuh:read.complete,
          filterAktif:read.filtered,kosongPadaSumber:zero,cakupanTahun:year}};
      await checkpoint();
      if(!await check())throw Error('Filter laporan berubah sebelum hasil disimpan.');
      const action=homeGroupUpdate(previous,read.rows,proof);
      if(action==='conflict'){issue(year,kind,'Isi halaman sebelumnya berubah. Hasil tersimpan perlu diperiksa.');continue;}
      if(action==='keep')continue;
      if(action==='replace'&&!replace){issue(year,kind,'Antrean sebelumnya belum dapat diperbarui.');continue;}
      const capture=[{wp:plan.wp,period:range,source:'bplawan',spt:'',proof},{Payload:{Data:read.rows,...(zero?{TotalRecords:0}:{})}},
        'Bukti potong '+kind+' '+year,'Dari beranda Coretax'];
      if(action==='replace')await replace(previous,...capture);
      else await enqueue(...capture);
      result.added.push({source:'bplawan',tahun:year,jenis:kind,rows:read.rows.length});
    }catch(error){if(error.code)throw error;issue(year,kind,error.message);}
  }
  return result;
}
