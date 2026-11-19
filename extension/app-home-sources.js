import {rowsOf,sources as labels,visibleTables} from './app-data.js';
import {homeLedgerCode,homeLedgerMonth,planHomeCapture,scopeHomeRows} from './app-home-plan.js';
import {ledgerCode,ledgerControls,ledgerMonthLabel,ledgerYearRanges,selectLedgerMonth} from './app-home-ledger.js';
import {homeDigest,homeRowStamp,homeTableSections,taxRegistrationGroups} from './app-home-coverage.js';
import {tableFits} from './app-open-sources.js';

const coretax='https://coretax.intranet.pajak.go.id';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function sourceMessage(error){
  const message=String(error?.message||'');
  if(/no tab with id|tab (?:was )?closed|frame.*(?:removed|navigat)|no frame with id|cannot access|could not establish connection|document (?:was )?unloaded/i.test(message))
    return 'Tab kerja Coretax berpindah atau tertutup sebelum pembacaan selesai.';
  if(/network error|failed to fetch|ERR_CONNECTION|ERR_INTERNET/i.test(message))return 'Sambungan ke Coretax terputus saat membaca sumber ini.';
  return message||'Bagian ini belum dapat dibaca.';
}
const names={
  info:['Informasi Umum Wajib Pajak','Informasi Umum','Profil Wajib Pajak','Umum'],
  pihak:['Pihak Terkait'],bank:['Rekening Bank Wajib Pajak','Rekening Bank'],
  flag:['Penanda Wajib Pajak','Penanda WP'],jenispajak:['Jenis Pajak','Registrasi Jenis Pajak'],
  alamat:['Alamat Wajib Pajak','Alamat','Tempat Kegiatan Usaha/Sub Unit','Tempat Kegiatan Usaha'],klu:['Klasifikasi Lapangan Usaha','Klasifikasi Lapangan Usaha (KLU)','KLU'],
  nomorlain:['Nomor Identitas Lain','Nomor Identifikasi Eksternal'],sertel:['Sertifikat Elektronik'],pbb:['Objek Pajak Bumi dan Bangunan','Objek Pajak PBB P5L'],
  login:['Login Terakhir','Umum'],dokumen:['Dokumen Wajib Pajak','Daftar Dokumen','Dokumen'],
  bb:['Buku Besar Wajib Pajak','Buku Besar','General Ledger'],bbtotal:['Total Pembanding Buku Besar'],bbsaldo:['Saldo Seluruh Periode'],
  sptarsip:['Archieved Return Sheets','SPT Diarsipkan'],sptbelum:['SPT Belum Disampaikan','SPT Belum Dilaporkan']
};
const text=value=>String(value||'').toLowerCase().replace(/\s+/g,' ').trim();
const field=value=>text(value).replace(/[^a-z0-9]/g,'');
const profileSources=['info','pihak','bank','flag','jenispajak','alamat','klu','nomorlain','sertel','pbb','login','dokumen'];
const ledgerSources=['bb','bbtotal','bbsaldo'];
const sourceRoute={
  info:['registration','general-information'],bb:['accounting','balancesheet'],
  sptarsip:['returnsheets','archieved-returnsheets'],sptbelum:['returnsheets','not-submitted-returnsheets']
};
const profileRoutes={
  alamat:['address','place-of-business-activity'],pihak:['related-parties'],klu:['economic-code'],
  pbb:['land-and-building-tax-objects'],nomorlain:['external-identification-number'],dokumen:['documents'],jenispajak:['tax-types']
};
const titles=source=>[labels[source],...(names[source]||[])].map(text);

export function profileDestinations(source,links,profileUrl){
  const base=new URL(profileUrl),parts=base.pathname.split('/').filter(Boolean);
  if(base.origin!==coretax||parts.length!==4||parts.slice(0,3).join('/')!=='registration/id-ID/general-information')return [];
  const routes=profileRoutes[source]||[];
  return routes.map(route=>{
    const matches=new Set();
    for(const link of links){
      if(!titles(source).includes(text(link.label)))continue;
      let u;try{u=new URL(link.url);}catch{continue;}
      if(u.origin===coretax&&!u.username&&!u.password&&!u.search&&!u.hash&&
        u.pathname.replace(/\/$/,'')==='/registration/id-ID/'+route+'/'+parts[3])matches.add(u.href);
    }
    return matches.size===1?[...matches][0]:null;
  });
}

export function linkedSource(source,links,submittedUrl){
  const base=new URL(submittedUrl),id=base.pathname.split('/').filter(Boolean).at(-1);
  if(base.origin!==coretax||!/^\/returnsheets\/id-ID\/submitted-returnsheets\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\/?$/i.test(base.pathname))return null;
  const group=profileSources.includes(source)?'info':ledgerSources.includes(source)?'bb':source;
  const route=sourceRoute[group],found=new Set();
  if(!route)return null;
  for(const link of links){
    if(!titles(group).includes(text(link.label)))continue;
    let u;try{u=new URL(link.url);}catch{continue;}
    if(u.origin!==coretax||u.username||u.password||u.search||u.hash)continue;
    const parts=u.pathname.split('/').filter(Boolean);
    if(parts.length!==4||parts[1]!=='id-ID'||parts[3]!==id)continue;
    if(parts[0]!==route[0]||parts[2]!==route[1])continue;
    found.add(u.href);
  }
  return found.size===1?[...found][0]:null;
}

// This reader runs in the Coretax tab. Only titled tabs, labelled fields and
// the surrounding headings of visible tables are used to interpret a page.
export function sourceScreen({url,names,select=false,profile=false,login=false}){
  if(location.origin!=='https://coretax.intranet.pajak.go.id'||location.href!==url)return null;
  const visible=el=>el?.getClientRects().length>0 && el.checkVisibility({visibilityProperty:true,opacityProperty:true});
  const normalized=v=>String(v||'').toLowerCase().replace(/\s+/g,' ').trim();
  const all=(root,selector)=>[...root.querySelectorAll(selector)].filter(visible);
  const label=el=>normalized(el.getAttribute('aria-label')||el.innerText);
  const owners=new Set();
  const addOwner=v=>{
    const id=String(v||'').trim().replace(/[.\s-]/g,'');
    if(/^\d{15,16}$/.test(id))owners.add(id.padStart(16,'0'));
  };
  const ledger=/^\/accounting\/id-ID\/balancesheet\/[a-f\d-]+\/?$/i.test(location.pathname);
  const searches=ledger?all(document,'button#submit').filter(el=>label(el)==='cari'&&!el.disabled):[];
  const controls=all(document,'[role=tab]').filter(el=>names.includes(label(el)) && !el.matches(':disabled,[aria-disabled=true],a[href]:not([href^="#"])'));
  for(const card of all(document,'shared-left-menu p.ct-title-white'))addOwner(card.innerText);
  if(select && controls.length===1 && controls[0].getAttribute('aria-selected')!=='true'){
    controls[0].click();return {selected:true};
  }
  const values=new Map();
  function add(name,value){
    const k=normalized(name).replace(/\s*:\s*$/,''),v=String(value??'').trim();
    if(!k||!v)return;
    if(['npwp','npwp wajib pajak','nomor pokok wajib pajak'].includes(k))addOwner(v);
    if(!profile&&!login||!name||/password|kata sandi|token|otp/i.test(k))return;
    let key=k,title=name.trim();
    for(let n=2;values.has(key);n++){
      if(values.get(key).value===v)return;
      key=k+' ('+n+')';title=name.trim()+' ('+n+')';
    }
    values.set(key,{name:title,value:v});
  }
  for(const el of all(document,'dt')){
    if(el.nextElementSibling?.tagName==='DD'&&visible(el.nextElementSibling))add(el.innerText,el.nextElementSibling.innerText);
  }
  for(const el of all(document,'label[for]')){
    const control=el.control;
    if(!control||!visible(control)||control.closest('table,[role=table],[role=grid]')||control.matches('[type=password],[type=hidden]'))continue;
    if(control.matches('input[readonly],input[disabled],textarea[readonly],textarea[disabled],output,select[disabled]'))
      add(el.innerText,control.tagName==='SELECT'?control.selectedOptions[0]?.textContent:control.value);
  }
  const tables=all(document,'table,[role=table],[role=grid]').map((t,index)=>{
    const heading=t.caption?.innerText||t.getAttribute('aria-label')||'';
    const host=t.closest('section,[role=region],[role=tabpanel],p-card');
    const headings=host&&all(host,'table,[role=table],[role=grid]').length===1?
      all(host,'h1,h2,h3,h4,h5,[role=heading],legend').map(el=>label(el)):[];
    const group=t.closest('reg-tax-type-grid ui-grid')?.previousElementSibling;
    return {index,names:[normalized(heading),...headings].filter(Boolean),statusGroup:visible(group)?group.innerText.trim():''};
  });
  for(const grid of all(document,'.grid.ct-center-label')){
    const caption=grid.querySelector(':scope > .col-4 .ct-label'),content=grid.querySelector(':scope > .col-8');
    if(visible(caption)&&visible(content))add(caption.innerText,content.innerText.replace(/^\s*:\s*/,''));
  }
  const links=all(document,'a[href]').filter(a=>a.origin===location.origin && /^\/registration\/id-ID\/[a-z-]+\/[a-f\d-]+\/?$/i.test(a.pathname) &&
    !a.search && !a.hash && !a.username && !a.password && !a.ping && !a.hasAttribute('download'))
    .map(a=>({url:a.href,label:a.innerText.trim()})).filter(link=>link.label);
  let form=profile && [...values.keys()].some(k=>['nama','nama wajib pajak','nama wp','nama lengkap wajib pajak'].includes(k))?
    Object.fromEntries([...values.values()].map(v=>[v.name,v.value])):null;
  if(login){
    const item=values.get('login terakhir / aktif')||values.get('login terakhir');
    if(item?.value && !/^[-–—]+$/.test(item.value))form={[item.name]:item.value};
  }
  const externalFilter=all(document,'input[type=search],[role=search] input,input[aria-label*="filter" i],input[aria-label*="cari" i],input[placeholder*="cari" i]')
    .some(el=>el.value?.trim()&&!el.closest('table,[role=grid],[role=table],header,aside,nav,shared-left-menu,.p-paginator,.p-dropdown-panel'));
  return {tables,owners:[...owners],form,links,externalFilter,canSearch:searches.length===1,hasTab:controls.length===1,active:controls.length===1&&controls[0].getAttribute('aria-selected')==='true'};
}

function fits(source,columns){
  if(tableFits(source,columns))return true;
  const keys=new Set(columns.map(field)),has=(...keysToFind)=>keysToFind.some(k=>keys.has(k));
  if(source==='sptarsip'||source==='sptbelum')return has('masapajak','taxperiodcode')&&has('jenissuratpemberitahuanpajak','jenisspt','taxreturntypecode','returnsheettypecode');
  if(source==='bbsaldo')return has('saldo','balance','saldoakhir')&&has('debit','debet','credit','kredit');
  if(source==='login')return has('loginterakhir','lastlogindate','waktuloginterakhir');
  if(source==='alamat')return has('detailalamat')&&has('jenisalamat','kodepos') || has('namatempatkegiatanusaha','namasubunit','namatku')&&has('alamat','detailalamat','alamattku');
  if(source==='pihak')return has('niknpwporang')&&has('namapj')&&has('jenisorangterkait');
  if(source==='klu')return has('kodeklu')&&has('deskripsitku');
  if(source==='nomorlain')return has('tipe')&&has('nomoridentifikasi');
  if(source==='pbb')return has('nop')&&has('namaobjekpajak')&&has('sektor','luasobjekpajak');
  if(source==='jenispajak')return has('jenispajak')&&has('tanggalregistrasi','tanggalpendaftaran')&&has('tanggalpermohonan','tanggalmulaitransaksi');
  if(source==='flag')return has('jenisbendera')&&has('nomorpenunjukan','tanggalpenunjukan');
  if(source==='bb')return has('tanggalposting')&&has('masapajak')&&has('jumlah')&&has('nomortransaksi','referensi');
  return false;
}

function selectTable(source,list,screen,child=false){
  const candidates=list.filter(t=>fits(source,t.labels));
  const named=candidates.filter(t=>[text(t.title),...(screen.tables.find(s=>s.index===t.index)?.names||[])].some(name=>titles(source).includes(name)));
  if(named.length===1)return named[0];
  // An unnamed table can be recognised by its columns on a dedicated page or active tab.
  const dedicated=child||['sptbelum','sptarsip'].includes(source)||screen.active;
  return !named.length && dedicated && candidates.length===1?candidates[0]:null;
}

export function homeGroupUpdate(previous,rows,proof){
  if(!previous.length)return 'add';
  const oldRows=previous.flatMap(entry=>rowsOf(entry.page));
  const key=row=>JSON.stringify(Object.entries(row).sort(([a],[b])=>a<b?-1:a>b?1:0));
  const samePrefix=rows.slice(0,Math.min(oldRows.length,rows.length)).every((row,i)=>key(row)===key(oldRows[i]));
  const old=previous.at(-1).proof,prior=old.dariBeranda,current=proof.dariBeranda;
  const sameFilter=prior.filterAktif===current.filterAktif&&prior.transaksiDibatalkan===current.transaksiDibatalkan&&prior.filterLain===current.filterLain;
  if(!samePrefix||!sameFilter||prior.kosongPadaSumber!==current.kosongPadaSumber)return 'conflict';
  if(rows.length<oldRows.length||prior.rentangUtuh&&!current.rentangUtuh)return 'keep';
  if(rows.length>oldRows.length)return prior.rentangUtuh?'conflict':'replace';
  return !prior.rentangUtuh&&current.rentangUtuh||old.morePagesAvailable&&!proof.morePagesAvailable||
    !prior.buktiTabel&&current.buktiTabel&&current.rentangUtuh?'replace':'keep';
}

async function readSourceView({ext,run,id,url,source,wp,child,statusGroup,requestedMonth,readScreen,checkpoint,pageLimit}){
  const args={url,names:titles(source),profile:source==='info',login:source==='login'};
  const screen=()=>readScreen(id,args);
  let view,table,activated=false;
  for(let attempt=0;attempt<36;attempt++){
    try{view=await screen();}catch(error){if(error.code)throw error;view=null;}
    if(view){
      const tables=await run(id,visibleTables,null);
      const candidates=statusGroup?tables.filter(t=>text(view.tables.find(v=>v.index===t.index)?.statusGroup)===text(statusGroup)):tables;
      table=selectTable(source,candidates,view,child);
      if(table || view.form&&view.owners.includes(wp))break;
      if(view.hasTab&&!view.active&&!activated){await run(id,sourceScreen,{...args,select:true});activated=true;}
      if(attempt>=10&&!activated&&(await ext.tabs.get(id)).status==='complete')break;
    }
    await wait(160);
  }
  if(!table){
    if(!view?.form||!view.owners.includes(wp))return null;
    const confirmed=await screen();
    if(!confirmed?.owners.includes(wp)||JSON.stringify(confirmed.form)!==JSON.stringify(view.form))throw Error('Isian profil berubah saat sedang dibaca.');
    return {rows:[view.form],columns:Object.keys(view.form),complete:false,notes:source==='info'?['Yang terbaca adalah isian profil yang tampil pada halaman.']:[],pages:1,filtered:false};
  }
  const scopedScreen=async()=>{
    const current=await screen();
    if(current&&current.externalFilter!==view.externalFilter)throw Error('Filter pada halaman sumber berubah saat tabel dibaca.');
    if(statusGroup&&text(current?.tables.find(t=>t.index===table.index)?.statusGroup)!==text(statusGroup))
      throw Error('Kelompok pendaftaran jenis pajak berubah saat tabel dibaca.');
    if(requestedMonth){
      const state=await run(id,ledgerControls,{url,wp,action:'state',label:ledgerMonthLabel(requestedMonth)});
      if(!state?.selected||state.identityError)throw Object.assign(Error('WP atau masa buku besar berubah saat membaca tabel.'),{code:'SCOPE'});
    }
    return current;
  };
  const certify=homeTableSections(source).length>0 && (child||['sptarsip','sptbelum'].includes(source)||source==='flag'&&view.active);
  const read=await readSourcePages({run,id,table,url,screen:scopedScreen,checkpoint,pageLimit,certify});
  read.columns=table.labels;
  if(view.externalFilter){
    read.filtered=true;
    read.notes.push('Ada penyaringan pada halaman sumber. Hasil mengikuti pilihan yang tampil di Coretax.');
  }
  if(statusGroup)read.rows=read.rows.map(row=>({...row,'Kelompok pendaftaran':statusGroup}));
  return read;
}

export async function collectHomeSources({ext,origin=coretax,tabId,wp,period,sources,types,items=[],checkpoint=async()=>{},enqueue,replace,pageLimit=Infinity,includeCancelled=false}){
  const result={added:[],skipped:[],missing:[],issues:[]};
  if(origin!==coretax)throw Error('Alamat Coretax untuk penarikan tidak cocok.');
  const wanted=sources.filter(s=>names[s]);
  if(!wanted.length)return result;
  const run=async(id,func,arg)=>(await ext.scripting.executeScript({target:{tabId:id},func,args:[arg]}))[0]?.result;
  const submitted=(await ext.tabs.get(tabId)).url;
  const panel=await run(tabId,visibleTables,{homeLinks:true,url:submitted,wp});
  if(panel?.wp!==wp)throw Object.assign(Error('Panel WP pada daftar SPT berubah sebelum membuka sumber.'),{code:'IDENTITY'});
  const ownerContext=await homeDigest([panel.wp,new URL(submitted).pathname]);
  const opened=new Map(),ledgerTabs=new Map(),monthlyTotals=new Map(),ledgerRanges=new Map();
  function issue(source,reason){
    const message=labels[source]+' · '+reason;
    if(!result.issues.includes(message)){result.skipped.push({source,reason});result.issues.push(message);}
  }
  async function open(url){
    if(!opened.has(url)){
      const tab=await ext.tabs.create({url,active:false});
      opened.set(url,tab.id);
    }
    return opened.get(url);
  }
  async function readScreen(id,args){
    await checkpoint();
    const current=await run(id,sourceScreen,args);
    if(current?.owners.some(value=>value!==wp))throw Object.assign(Error('NPWP pada halaman sumber berbeda dari penugasan.'),{code:'IDENTITY'});
    return current;
  }
  async function destinations(source,url){
    const fresh=await run(tabId,visibleTables,{homeLinks:true,url:submitted,wp});
    if(fresh?.wp!==wp||linkedSource(source,fresh.links,submitted)!==url)throw Object.assign(Error('WP atau tautan pada menu sumber berubah.'),{code:'IDENTITY'});
    const id=await open(url);
    if(ledgerSources.includes(source)){
      if(!ledgerTabs.has(id)){
        let ready=null,initialTotalVerified=false;
        for(let n=0;n<30&&!ready;n++){
          let state;
          try{state=await readScreen(id,{url,names:[],profile:false});}catch(e){if(e.code)throw e;}
          if(state?.canSearch&&!searched.has(id)){
            const cancel=await run(id,ledgerControls,{url,wp,action:'cancel',label:includeCancelled?'Yes':'No'});
            if(cancel?.identityError)throw Object.assign(Error('WP pada buku besar berbeda dari penugasan.'),{code:'IDENTITY'});
            const search=await run(id,ledgerControls,{url,wp,action:'initial'});
            if(search?.ok){
              searched.add(id);initialTotalVerified=search.totalsRefreshed;
              if(!cancel?.ok)issue(source,'Pilihan transaksi dibatalkan pada buku besar belum dapat diterapkan.');
            }
            else if(search?.identityError)throw Object.assign(Error('WP pada buku besar berbeda dari penugasan.'),{code:'IDENTITY'});
          }
          if(searched.has(id)){
            ready=await run(id,ledgerControls,{url,wp,action:'state',label:''});
            if(ready?.identityError)throw Object.assign(Error('WP pada buku besar berbeda dari penugasan.'),{code:'IDENTITY'});
          }
          if(!ready&&n>=6&&state?.tables.length&&!state.canSearch)break;
          if(!ready)await wait(160);
        }
        if(ready&&!initialTotalVerified)ready.totals=[];
        ledgerTabs.set(id,ready);
      }
      const initial=ledgerTabs.get(id);
      if(initial){
        if(source==='bbsaldo')return [{url,id,initial}];
        const plan=planHomeCapture({wp,period,sources:[source],types});
        if(!ledgerRanges.has(id))ledgerRanges.set(id,await ledgerYearRanges({run,id,url,wp,years:plan.years,checkpoint}));
        const ranges=ledgerRanges.get(id);
        if(ranges.unconfirmed.length)issue(source,'Cakupan masa khusus belum dapat dipastikan untuk tahun '+ranges.unconfirmed.join(', ')+'.');
        return [...plan.months,...ranges.choices].map(month=>({url,id,month}));
      }
    }
    if(!profileRoutes[source])return [{url,id}];
    for(let n=0;n<24;n++){
      let view;
      try{view=await readScreen(id,{url,names:[]});}catch(e){if(e.code)throw e;}
      if(view?.links.length){
        const children=profileDestinations(source,view.links,url);
        if(children.some(Boolean)){
          if(children.some(link=>!link))issue(source,'Salah satu bagian '+labels[source]+' belum ditemukan dalam menu WP.');
          const targets=[];
          for(const link of children.filter(Boolean)){
            const tab=await open(link);
            if(source==='jenispajak')for(const statusGroup of taxRegistrationGroups)targets.push({url:link,id:tab,child:true,statusGroup});
            else targets.push({url:link,id:tab,child:true});
          }
          return targets;
        }
        if(n>=5)break;
      }
      await wait(160);
    }
    return [{url,id}];
  }
  const searched=new Set();
  try{
    for(const source of wanted){
      await checkpoint();
      if(items.some(e=>e.wp===wp&&e.period===period&&e.source===source && !e.proof?.dariBeranda)){
        issue(source,'Antrean sudah memuat sumber ini dari pembacaan lain. Cakupan dari beranda belum diperiksa.');
        continue;
      }
      const entryUrl=linkedSource(source,panel.links,submitted);
      if(!entryUrl){result.missing.push(source);issue(source,'Tautan untuk WP ini belum tersedia dari menu sumber.');continue;}
      try{
       for(const {id,url,child,month:requestedMonth,initial,statusGroup} of await destinations(source,entryUrl)){
        const subpage=url.split('/').filter(Boolean).at(-2);
        const section=statusGroup||(subpage==='address'?'Alamat':subpage==='place-of-business-activity'?'Tempat Kegiatan Usaha/Sub Unit':labels[source]);
        const sectionLabel=requestedMonth?ledgerMonthLabel(requestedMonth):section;
        try{
        let activePeriod,totals;
        if(requestedMonth){
            const cached=source==='bbtotal'&&monthlyTotals.get(requestedMonth);
            if(cached){activePeriod=cached.activePeriod;totals=cached.totals;}
            else{
              activePeriod=await selectLedgerMonth({run,id,url,wp,month:requestedMonth,checkpoint});
              if(!activePeriod)throw Error('Pemilih masa buku besar belum tersedia.');
              const state=await run(id,ledgerControls,{url,wp,action:'state',label:ledgerMonthLabel(requestedMonth)});
              if(state?.identityError)throw Object.assign(Error('WP pada buku besar berubah.'),{code:'IDENTITY'});
              if(!state?.selected)throw Error('Masa pada buku besar berubah.');
              if((state.cancelled==='Yes')!==includeCancelled || !['Yes','No'].includes(state.cancelled))
                issue(source,sectionLabel+' · Filter transaksi dibatalkan pada sumber berbeda atau belum terbaca.');
              activePeriod.cancelled=state.cancelled;
              activePeriod.filterLain=state.otherFilters;
              if(activePeriod.totalsRefreshed){
                totals=state.totals;
                monthlyTotals.set(requestedMonth,{totals,activePeriod});
              }
            }
        }
        const summary=initial?.totals?.filter(row=>row.Key==='Total')||source==='bbtotal'&&requestedMonth&&totals?.filter(row=>row.Key==='Filtered');
        if((initial||requestedMonth&&source==='bbtotal')&&summary?.length!==1){issue(source,'Jumlah pembanding pada tabel Coretax belum dapat dipastikan'+(requestedMonth?' untuk '+sectionLabel:'')+'.');continue;}
        const read=summary?{rows:summary,complete:false,notes:[],pages:1,filtered:!!requestedMonth}:
          await readSourceView({ext,run,id,url,source,wp,child:child||source==='bb'&&searched.has(id),statusGroup,requestedMonth,readScreen,checkpoint,pageLimit});
        if(!read){
          result.missing.push(source);
          issue(source,(statusGroup?statusGroup+' · ':'')+'Halaman WP terbuka, tetapi bagian dan kolom sumber belum dapat dicocokkan.');continue;
        }
        const provenRows=requestedMonth&&!activePeriod?.refreshed?read.rows.filter(row=>homeLedgerCode(row)===ledgerCode(requestedMonth)):read.rows;
        if(provenRows.length<read.rows.length)read.notes.push('Sebagian baris belum menunjukkan hasil terbaru untuk masa yang dipilih.');
        const selection=scopeHomeRows(provenRows,{source,wp,period,types,sourceWp:panel.wp,
          ...(requestedMonth?{sourceLedgerCode:ledgerCode(requestedMonth)}:{})});
        if(source==='sptarsip'){
          selection.rows=read.rows;
        }
        if(['bb','bbtotal'].includes(source)&&!requestedMonth)read.notes.push('Cakupan masa khusus dan transaksi setahun pada buku besar belum terbukti.');
        if(source!=='sptarsip'&&selection.unknownPeriod)read.notes.push(selection.unknownPeriod+' baris tidak menunjukkan masa pajak yang dapat dipastikan.');
        if(source!=='sptarsip'&&selection.unknownType && types?.length && types.length<6)read.notes.push(selection.unknownType+' baris belum menunjukkan jenis SPT yang dipilih.');
        for(const note of read.notes)issue(source,note);
        const selectedFilter=requestedMonth&&activePeriod?.refreshed&&activePeriod.filterLain===false&&
          activePeriod.cancelled===(includeCancelled?'Yes':'No');
        const zero=read.complete&&read.total===0&&(!read.filtered||selectedFilter)&&(!requestedMonth||activePeriod?.refreshed);
        if(!selection.rows.length&&!zero){
          if(!read.notes.length)issue(source,'Tidak ada baris yang cocok dengan pilihan pada data yang terbaca.');
          continue;
        }
        const groups=new Map();
        for(const row of selection.rows){
          const code=requestedMonth?ledgerCode(requestedMonth):ledgerSources.includes(source)?homeLedgerCode(row):'';
          const month=requestedMonth?.length===7?requestedMonth:ledgerSources.includes(source)?homeLedgerMonth(row):'';
          if(!groups.has(code))groups.set(code,{month,rows:[]});
          groups.get(code).rows.push(row);
        }
        if(zero)groups.set(requestedMonth?ledgerCode(requestedMonth):'',{month:requestedMonth?.length===7?requestedMonth:'',rows:[]});
        for(const [code,{month,rows}] of groups){
          const previous=items.filter(entry=>{
            const prior=entry.proof?.dariBeranda;
            return entry.wp===wp&&entry.source===source&&entry.period===period&&prior?.bagian===section&&prior.masa===month&&
              (prior.kodeMasa||'')===code;
          });
          const proof={columns:read.columns||Object.keys(read.rows[0]||{}),morePagesAvailable:read.morePagesAvailable??false,
            dariBeranda:{bagian:section,masa:month,...(source==='sptarsip'?{indeksLintasMasa:true}:{}),...(code?{kodeMasa:code}:{}),
              ...(read.evidence?{buktiTabel:{versi:1,npwp:panel.wp,konteksWp:ownerContext,sumber:source,halaman:read.evidence}}:{}),
              ...((activePeriod||initial)?{transaksiDibatalkan:activePeriod?.cancelled||initial?.cancelled,filterLain:activePeriod?.filterLain??initial?.otherFilters}:{}),
              jumlahHalaman:read.pages,barisSumber:read.rows.length,totalTampilan:read.total??null,
              rentangUtuh:read.complete,filterAktif:read.filtered,kosongPadaSumber:zero,
              diLuarPeriode:selection.outsidePeriod,jenisDilewati:selection.excludedType,
              masaTidakDikenali:selection.unknownPeriod,jenisTidakDikenali:selection.unknownType},...(zero?{nolPadaSumber:true}:{})};
          const page={Payload:{Data:rows,...(zero?{TotalRecords:0}:{})}};
          const operation=homeGroupUpdate(previous,rows,proof);
          if(operation==='keep')continue;
          if(operation==='conflict'){
            issue(source,section+' · Isi atau filter sumber berbeda dengan yang sudah tersimpan. Hasil sebelumnya tetap ada.');continue;
          }
          await checkpoint();
          const info={wp,period,source,spt:'',proof,...(month?{ledgerPeriod:month}:{})};
          if(operation==='replace'&&!replace){issue(source,section+' · Hasil tersimpan belum memuat seluruh baris yang kini terlihat.');continue;}
          try{
            if(operation==='replace')await replace(previous,info,page,labels[source],'Dari beranda Coretax');
            else await enqueue(info,page,labels[source],'Dari beranda Coretax');
          }catch(error){throw Object.assign(error,{code:error.code||'SAVE'});}
          result.added.push({source,month,rows:rows.length});
        }
        }catch(error){
          if(error.code)throw error;
          issue(source,sectionLabel+' · '+sourceMessage(error));
        }
       }
      }catch(error){if(error.code)throw error;issue(source,sourceMessage(error));}
    }
  }finally{
    for(const [url,id] of opened)try{if((await ext.tabs.get(id)).url===url)await ext.tabs.remove(id);}catch{}
  }
  return result;
}

export async function readSourcePages({run,id,table,url,screen,checkpoint=async()=>{},pageLimit=Infinity,certify=false}){
  const rows=[],notes=[],seen=new Set(),evidence=[];
  let current,total,filter,filtered=false,complete=false,morePagesAvailable=false,pages=0;
  const observe=async(options={})=>{
    if(!await screen())throw Error('Alamat sumber berubah ketika membaca tabel.');
    const now=(await run(id,visibleTables,null))?.find(t=>t.index===table.index && t.tableId===table.tableId && t.title===table.title &&
      JSON.stringify(t.labels)===JSON.stringify(table.labels));
    if(!now)throw Error('Tabel atau susunan kolom sumber berubah.');
    const data=await run(id,visibleTables,{...now,url,homeRead:options});
    if(data?.skip)throw Error(data.skip);
    return data;
  };
  const settle=async(previous,previousRows)=>{
    for(let attempt=0;attempt<35;attempt++){
      await checkpoint();
      const data=await observe();
      if(data?.rows && data.stamp!==previous && (!previousRows||JSON.stringify(data.rows)!==previousRows))return data;
      await wait(140);
    }
    throw Error('Halaman sumber belum selesai dimuat atau halaman berikut mengulang tampilan.');
  };
  current=await settle();
  if(current.canFirst||current.range?.first>1||current.pageNumber>1){
    await observe({move:'first',expect:current.stamp});
    current=await settle(current.stamp,JSON.stringify(current.rows));
  }
  try{
   for(;pages<Math.max(1,pageLimit);){
    const range=current.range;
    if(!pages){filter=current.filterHash;total=range?.total;}
    if(filter!==current.filterHash||range&&(range.total!==total||range.first!==(range.total===0?0:rows.length+1))||
       !range && current.pageNumber && current.pageNumber!==pages+1)throw Error('Rentang atau filter tabel berubah saat berpindah halaman.');
    if(seen.has(current.stamp))throw Error('Halaman yang sama terbaca kembali.');
    seen.add(current.stamp);
    if(current.explicitEmpty)await wait(300);
    const confirmed=await observe({expect:current.stamp});
    if(confirmed?.stamp!==current.stamp||confirmed.explicitEmpty!==current.explicitEmpty)throw Error('Isi tabel belum stabil saat pemeriksaan ulang.');
    const emptyAtStart=current.explicitEmpty&&!current.canFirst&&!current.canAdvance&&!current.rows.length&&
      (current.atStart||current.pageNumber===1||!current.hasPaginator);
    if(certify&&(range||emptyAtStart)){
      const observed=range||{first:0,last:0,total:0};
      evidence.push({dari:observed.first,sampai:observed.last,total:observed.total,filterAktif:current.filtered,
        sidikBaris:await homeRowStamp(current.rows,table.labels)});
    }
    rows.push(...current.rows);filtered||=current.filtered;morePagesAvailable=current.canAdvance||Boolean(range&&range.last<range.total);pages++;
    if(emptyAtStart&&!range){
      complete=true;total=0;break;
    }
    if(!range&&!current.pageNumber){notes.push('Jumlah seluruh baris belum ditampilkan. Yang tersimpan hanya baris pada halaman ini.');break;}
    if(range&&range.last===range.total){complete=true;break;}
    if(!range&&current.atEnd){notes.push('Semua halaman bernomor yang tersedia telah dibaca. Jumlah seluruh baris tidak tercantum pada sumber.');break;}
    if(!current.canAdvance||pages>=pageLimit){notes.push('Masih ada halaman sumber yang belum terbaca.');break;}
    await observe({move:'next',expect:current.stamp});
    current=await settle(current.stamp,JSON.stringify(current.rows));
   }
  }catch(error){
    if(error.code||!pages)throw error;
    notes.push('Pembacaan berhenti setelah '+pages+' halaman. '+sourceMessage(error));
  }
  if(filtered)notes.push('Ada filter pada tabel Coretax. Hasil mengikuti filter yang sedang aktif.');
  return {rows,pages,notes,filtered,complete,morePagesAvailable,total,...(certify?{evidence}:{})};
}
