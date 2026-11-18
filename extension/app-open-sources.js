import {sources,rowsOf,visibleTables} from './app-data.js';
import {suggestedSource} from './app-batch.js';
import {periodLabel} from './app-package-entries.js';
import {collectOpenPages} from './app-open-source-pages.js';

// A table needs an exact source caption and at least one field from each group.
// Ordinary transaction dates are never used to infer a tax period.
const columns={
  info:[['TaxpayerName','Nama WP','Nama Wajib Pajak','Name'],['TaxpayerType','TaxpayerStatus','Jenis Wajib Pajak','Status WP','Status Wajib Pajak']],
  pihak:[['PersonName','Nama Pihak Terkait'],['RelatedPersonType','BusinessRoleType','Jenis Pihak Terkait']],
  bank:[['BankAccountNumber','Nomor Rekening','Nomor Rekening Bank']],
  flag:[['FlagType','Jenis Penanda'],['FlagValue','Nilai Penanda']],
  jenispajak:[['TaxTypeCode','Kode Jenis Pajak'],['RegistrationDate','Tanggal Registrasi','TaxStatusCode','Status Registrasi']],
  alamat:[['AddressDetail','Alamat Lengkap'],['TypeOfAddress','Jenis Alamat','PostalCode','Kode Pos']],
  klu:[['TradeClassificationCode','Kode KLU'],['ActivityDescription','Uraian Kegiatan','IsMainEconomicCode','KLU Utama']],
  nomorlain:[['IdentificationNumberType','Jenis Nomor Identitas'],['IdentificationNumber','Nomor Identitas']],
  sertel:[['CertificateNumber','Nomor Sertifikat'],['ValidFrom','Berlaku Mulai','ValidTo','Berlaku Sampai']],
  pbb:[['TaxObjectNumber','Nomor Objek Pajak'],['LandArea','Luas Tanah','BuildingArea','Luas Bangunan','TaxObjectAddress','Alamat Objek Pajak']],
  dokumen:[['DocumentTitle','Judul Dokumen','DocumentTypeCode','Jenis Dokumen'],['DocumentNumber','Nomor Dokumen','DocumentDate','Tanggal Dokumen']],
  bb:[['Amount','Nominal','Jumlah Transaksi'],['PostingDate','Tanggal Posting','AccountingTypeCode','ReferenceNumber','Nomor Referensi']],
  bbtotal:[['Debit','Debet'],['Credit','Kredit'],['Balance','Saldo']]
};
const key=s=>String(s).trim().toLowerCase().replace(/[\s_-]+/g,'');
export const supportedSources=Object.keys(columns);
export function tableFits(source,labels){
  const fields=new Set(labels.map(key));
  if(source==='dokumen' && ['filecontent','documentcontent','isidokumen'].some(k=>fields.has(k)))return false;
  return columns[source]?.every(group=>group.some(field=>fields.has(key(field))))||false;
}
const itemKey=(source,month)=>source+'/'+month;
function competes(entry,month){
  if(entry.proof?.pratinjauSumber)return entry.proof.pratinjauSumber.masa===month;
  if(!month)return true;
  const prior=periodLabel(rowsOf(entry.page),true);return !/^\d{4}-\d{2}$/.test(prior) || prior===month;
}
function sameItems(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function samePlan(a,b){return a.wp===b.wp && a.period===b.period && sameItems(a.sources,b.sources) && sameItems(a.assignment,b.assignment);}

async function inspectTable(ext,tab,table,source,scope,expect,includeRows=false,navigation={}){
  const [from,to]=scope.period.split(' s.d. ');
  const fields=columns[source].map(group=>table.labels.filter(label=>group.some(f=>key(f)===key(label))));
  const [frame]=await ext.scripting.executeScript({target:{tabId:tab.id},func:visibleTables,args:[{...table,url:tab.url,
    quick:{expect,fields,includeRows,...navigation},scope:{source,wp:scope.wp,from,to,periodRequired:source==='bb'||source==='bbtotal'}}]});
  return frame?.result || {skip:'Tabel sumber tidak tersedia.'};
}
export function sourceChoices(items,queued,scope){
  const groups=new Map();
  for(const item of items)for(const slice of item.result?.slices||[]){
    const k=itemKey(item.source,slice.month);
    if(!groups.has(k))groups.set(k,[]);
    groups.get(k).push({item,slice});
  }
  const choices=[];
  for(const members of groups.values()){
    const strength=m=>Number(!m.item.result.filtered)*2+Number(m.item.result.atStart && m.item.result.atEnd);
    members.sort((a,b)=>strength(b)-strength(a));
    const hashes=new Set(members.map(m=>m.slice.hash)),first=members[0];
    const existing=queued.filter(e=>e.source===first.item.source && e.wp===scope.wp && e.period===scope.period && competes(e,first.slice.month));
    const live=existing.filter(e=>e.proof?.pratinjauSumber?.masa===first.slice.month);
    const sameQueued=live.length>0&&live.length===existing.length&&live.every(e=>e.proof.pratinjauSumber.sidikIsi===first.slice.hash);
    const conflict=hashes.size>1 || existing.length>0&&!sameQueued;
    for(const [i,m] of members.entries()){
      const status=hashes.size>1?'Ada beberapa tampilan berbeda untuk sumber dan masa ini. Periksa melalui Cara menarik.':
        sameQueued?'Sudah ada di antrean.':
        conflict?'Ada sumber lain di antrean. Cocokkan melalui Cara menarik.':i?'Salinan identik pada baris yang tampak.':'Siap ditambahkan.';
      const ready=status==='Siap ditambahkan.';
      choices.push({...m,status,conflict,copies:members.length-1,ready,peers:ready?members.filter(other=>other!==m):[]});
    }
  }
  return choices;
}
function groupStamps(choices){
  const perMonth=new Map();
  for(const {item,slice} of choices){
    const name=itemKey(item.source,slice.month);
    if(!perMonth.has(name))perMonth.set(name,[]);
    perMonth.get(name).push(JSON.stringify([item.tab.id,item.tab.url,item.table.index,item.result.stamp]));
  }
  return new Map([...perMonth].map(([name,stamps])=>[name,JSON.stringify(stamps.sort())]));
}
function visibleProof(item,slice,current,copies){
  const range=current.range,morePagesAvailable=Boolean(current.canAdvance||range&&range.last<range.total);
  return {columns:item.table.labels,owner:current.owner,period:current.period,morePagesAvailable,
    pratinjauSumber:{masa:slice.month,barisPadaTabel:current.slices.reduce((n,s)=>n+s.count,0),barisPadaMasa:slice.count,filterAktif:current.filtered,
      dasarPeriode:slice.month?'Masa pajak tiap baris':current.period.length?'Periode pada baris sesuai pilihan':
        'Tanpa masa pajak pada tabel. Periode paket mengikuti penugasan.',
      ...(current.range?{rentangTampilan:current.range}:{}),salinanBarisTampak:copies,sidikIsi:slice.hash,cakupan:'Halaman yang terlihat'}};
}
export function openSourcePreview({ext,origin,box,context,queued,enqueue,render,notice}){
  let revision=0,active=false,preview=null;
  function invalidate(){revision++;preview=null;box.replaceChildren();}
  function accessibleMessage(text){const p=document.createElement('p');p.setAttribute('role','status');p.textContent=text;box.append(p);return p;}
  function guard(scope,generation,checkpoint,explicitScope){
    return async()=>{
      if(checkpoint)await checkpoint();
      if(generation!==revision || !explicitScope && !samePlan(scope,context()))throw Error('Penugasan atau pilihan sumber berubah. Buka kembali Pratinjau WP.');
    };
  }
  async function inspect(scope,check){
    const wanted=scope.sources.filter(s=>supportedSources.includes(s)),found=[];
    let unread=0,tabs=[];
    await check();
    if(ext&&wanted.length){
      try{tabs=await ext.tabs.query({url:origin+'/*'});}catch{unread++;}
    }
    await check();
    for(const [i,tab] of tabs.entries()){
      if(!tab.url || new URL(tab.url).origin!==origin)continue;
      let tables;
      try{const [frame]=await ext.scripting.executeScript({target:{tabId:tab.id},func:visibleTables,args:[null]});tables=frame?.result;}
      catch{unread++;}
      await check();
      if(!Array.isArray(tables))continue;
      for(const table of tables){
        const source=suggestedSource(table.title,wanted);
        if(!source)continue;
        const item={tab,table,source,n:i+1};found.push(item);
        if(!tableFits(source,table.labels)){item.skip='Judul sesuai, tetapi kolom khas sumber belum cocok.';continue;}
        try{item.result=await inspectTable(ext,tab,table,source,scope);item.skip=item.result.skip;}
        catch{item.skip='Tab atau struktur tabel berubah saat diperiksa.';}
        await check();
      }
    }
    return {scope,found,unread,missing:wanted.filter(s=>!found.some(item=>item.source===s))};
  }

  async function collectSelected(options={}){
    if(active)throw Error('Tunggu sampai pembacaan sumber selesai.');
    const scope=options.scope??context(),items=options.items??queued,accept=options.enqueue??enqueue;
    const check=guard(scope,revision,options.checkpoint,Boolean(options.scope));
    const previous=preview&&samePlan(scope,preview.scope)?preview:null;
    const result={added:[],missing:[],skipped:[],issues:[]};
    const warn=text=>{if(!result.issues.includes(text))result.issues.push(text);};
    function coverage(source,proof){
      const evidence=proof?.pratinjauSumber;
      if(!evidence)return;
      if(evidence.paginasi)return;
      if(proof.morePagesAvailable || evidence.rentangTampilan?.last<evidence.rentangTampilan?.total)
        warn(sources[source]+' · Ada halaman berikutnya yang belum dibaca.');
      if(evidence.rentangTampilan?.first>1)warn(sources[source]+' · Halaman sebelum tampilan ini belum dibaca.');
      if(evidence.filterAktif)warn(sources[source]+' · Hanya baris yang terlihat dengan filter saat ini yang ditambahkan.');
    }
    const skip=(source,month,reason,issue=true)=>{
      result.skipped.push({source,month,reason});
      if(issue)warn(sources[source]+(month?' · '+month:'')+' · '+reason);
    };
    active=true;
    try{
      const current=await inspect(scope,check);
      for(const entry of items)if(entry.wp===scope.wp&&entry.period===scope.period&&scope.sources.includes(entry.source))coverage(entry.source,entry.proof);
      result.missing=current.missing;
      for(const source of current.missing){
        const old=items.filter(e=>e.source===source&&e.wp===scope.wp&&e.period===scope.period);
        if(!old.length)warn(sources[source]+' belum ditemukan pada tab yang dapat diperiksa.');
        else if(old.some(e=>e.proof?.pratinjauSumber?.paginasi)&&!old.some(e=>e.proof?.pratinjauSumber?.paginasi?.akhir))
          warn(sources[source]+' · Tab sumber belum ditemukan untuk melanjutkan halaman yang tersimpan.');
      }
      if(current.unread)warn(current.unread+' tab atau daftar tab Coretax tidak dapat diperiksa.');
      for(const item of current.found)if(item.skip)skip(item.source,'',item.skip);
      const choices=sourceChoices(current.found,items,scope),stamps=groupStamps(choices);
      const prior=previous?groupStamps(sourceChoices(previous.found,[],scope)):null;
      const changed='Tampilan sumber atau salinannya berubah sejak pratinjau. Buka kembali Pratinjau WP.';
      if(previous){
        for(const [name] of prior)if(!stamps.has(name)){
          const [source,month]=name.split('/');if(!previous.moved?.has(source))skip(source,month,changed);
        }
      }
      const paged=new Set();
      if(options.scope){
        const limit=Number.isInteger(options.pageLimit)?Math.min(100,Math.max(1,options.pageLimit)):100;
        for(const source of scope.sources){
          const peers=current.found.filter(p=>p.source===source&&!p.skip);
          const existing=items.filter(e=>e.source===source&&e.wp===scope.wp&&e.period===scope.period);
          if(!peers.some(p=>p.result.range) || existing.some(e=>!e.proof?.pratinjauSumber?.paginasi))continue;
          if(peers.some(p=>p.result.filterValueHidden)){
            warn(sources[source]+' · Nilai filter kolom belum terlihat. Hanya halaman saat ini yang diperiksa.');
            continue;
          }
          paged.add(source);
          const tracked=[...new Set([...(prior?.keys()||[]),...stamps.keys()])].filter(k=>k.startsWith(source+'/'));
          let anchors=[];
          if(prior&&tracked.some(k=>stamps.get(k)!==prior.get(k))){
            if(!previous.moved?.has(source)){skip(source,'',changed);continue;}
            const old=previous.found.filter(p=>p.source===source&&!p.skip);
            anchors=peers.map(p=>old.find(o=>o.tab.id===p.tab.id&&o.tab.url===p.tab.url&&o.table.index===p.table.index)?.result);
            if(anchors.length!==old.length||anchors.some(a=>!a?.range)){skip(source,'',changed);continue;}
          }
          if(peers.some(p=>!p.result.range)){skip(source,'','Salah satu salinan tabel tidak menunjukkan rentang baris.');continue;}
          async function read(peer,expect,includeRows,navigation){
            await check();let value;
            try{value=await inspectTable(ext,peer.tab,peer.table,source,scope,expect,includeRows,navigation);}
            catch{value={skip:'Tab, alamat, atau struktur tabel berubah. Periksa kembali sumber.'};}
            if(value.moved&&previous){previous.moved??=new Set();previous.moved.add(source);}
            await check();return value;
          }
          async function save(item,slice,current,pagination){
            const proof=visibleProof(item,slice,current,peers.length-1);
            proof.pratinjauSumber.paginasi=pagination;
            proof.pratinjauSumber.cakupan='Rentang baris pada tabel';
            await accept({wp:scope.wp,source,spt:'',period:scope.period,proof},{Payload:{Data:slice.rows}},item.table.title,'Tabel tampak');
            result.added.push({source,month:slice.month,rows:slice.count,morePages:proof.morePagesAvailable});
          }
          const problem=await collectOpenPages({peers,existing,anchors,read,save,check,limit});
          if(problem)skip(source,'',problem);
          if(peers.some(p=>p.result.filtered))warn(sources[source]+' · Hasil mengikuti filter pada tabel sumber.');
        }
      }
      const verified=new Map(),peerChecks=new Map(),staged=[];
      async function reread(item,includeRows){
        const cache=includeRows?verified:peerChecks;
        if(cache.has(item))return cache.get(item);
        await check();
        let read;
        try{read=await inspectTable(ext,item.tab,item.table,item.source,scope,item.result.stamp,includeRows);}
        catch{read={skip:'Tab atau struktur sumber berubah. Buka kembali Pratinjau WP.'};}
        await check();cache.set(item,read);return read;
      }
      for(const {item,slice,ready,status,conflict,copies,peers} of choices){
        if(paged.has(item.source))continue;
        const name=itemKey(item.source,slice.month);
        if(prior&&stamps.get(name)!==prior.get(name)){skip(item.source,slice.month,changed);continue;}
        if(!ready){
          skip(item.source,slice.month,status,conflict);
          continue;
        }
        const current=await reread(item,true),read=current.slices?.find(s=>s.month===slice.month&&s.hash===slice.hash);
        if(!Array.isArray(read?.rows)||current.skip){skip(item.source,slice.month,current.skip||changed);continue;}
        let copyChanged=false;
        for(const peer of peers){
          const state=await reread(peer.item,false);
          if(!state.slices?.some(s=>s.month===slice.month&&s.hash===slice.hash)){copyChanged=true;break;}
        }
        if(copyChanged){skip(item.source,slice.month,changed);continue;}
        staged.push({item,slice,read,proof:visibleProof(item,slice,current,copies)});
      }
      await check();
      for(const {item,slice,read,proof} of staged){
        await check();
        if(items.some(e=>e.source===item.source&&e.wp===scope.wp&&e.period===scope.period&&competes(e,slice.month))){
          skip(item.source,slice.month,'Sudah ada sumber pada antrean. Periksa kembali.',false);continue;
        }
        await accept({wp:scope.wp,source:item.source,spt:'',period:scope.period,proof},{Payload:{Data:read.rows}},item.table.title,'Tabel tampak');
        result.added.push({source:item.source,month:slice.month,rows:read.rows.length,morePages:proof.morePagesAvailable});
        coverage(item.source,proof);
      }
      await check();return result;
    }finally{active=false;}
  }

  async function scan(){
    if(active)throw Error('Tunggu sampai pembacaan sumber selesai.');
    invalidate();const scope=context(),generation=revision,check=guard(scope,generation);
    if(!ext||!scope.sources.some(s=>supportedSources.includes(s)))return false;
    active=true;
    let snapshot;
    try{snapshot=await inspect(scope,check);}
    finally{active=false;}
    preview=snapshot;
    const {found,unread,missing}=snapshot;
    if(!found.length && scope.sources.includes('sptdaftar'))return false;
    const heading=document.createElement('h3');heading.textContent='Sumber lain dari tab Coretax';box.append(heading);
    if(!found.length){accessibleMessage('Belum ada tabel terverifikasi untuk sumber terpilih. Buka tabel sumber atau tambahkan ekspor lokal.');return true;}
    const region=document.createElement('div'),table=document.createElement('table');
    region.className='capture-table';region.tabIndex=0;region.setAttribute('role','region');region.setAttribute('aria-label',heading.textContent);
    table.createCaption().textContent='Pemeriksaan sumber terpilih';const header=table.createTHead().insertRow();
    for(const label of ['Sumber','Masa pada baris','Tab','Baris tampak','Hasil pemeriksaan']){const h=document.createElement('th');h.scope='col';h.textContent=label;header.append(h);}
    const body=table.createTBody();region.append(table);box.append(region);
    const choices=sourceChoices(found,queued,scope);
    function row(item,month,count,status){
      const r=body.insertRow();
      for(const v of [sources[item.source],month||'—',String(item.n),count??'—',status])r.insertCell().textContent=v;
      return r.lastElementChild;
    }
    for(const item of found.filter(t=>t.skip))row(item,'',null,item.skip);
    for(const m of choices){
      const result=m.item.result,note=result.filtered?' Filter aktif pada tabel.':'';
      m.label=row(m.item,m.slice.month,m.slice.count,m.status+note+(result.canAdvance?' Ada halaman berikutnya.':''));
    }
    const status=accessibleMessage('Pembacaan mencakup baris yang sedang tampak. '+(missing.length?missing.length+' sumber terpilih belum ditemukan. ':'')+
      (unread?unread+' tab tidak dapat diperiksa. ':'')+'Mulai tarik dapat membaca halaman berikutnya jika rentang baris dan tombol halaman dikenali.');
    const ready=choices.filter(m=>m.ready);
    if(ready.length){
      const add=document.createElement('button');add.textContent='Tambahkan sumber terverifikasi';box.append(add);
      add.onclick=async()=>{
        if(active)return;
        add.disabled=true;
        try{
          const {added,skipped}=await collectSelected();
          for(const m of ready){
            const match=entry=>entry.source===m.item.source&&entry.month===m.slice.month;
            const entry=added.find(match),failure=skipped.find(match);
            if(entry)m.label.textContent='Masuk antrean · '+entry.rows+' baris.';
            else if(failure)m.label.textContent=failure.reason;
          }
          if(added.length)render();
          status.textContent=added.length+' sumber atau masa masuk antrean. '+skipped.length+' dilewati.';
        }catch(error){notice(error.message,true);status.textContent=error.message;}
      };
    }
    return true;
  }
  return {scan,collectSelected,invalidate,get active(){return active;}};
}
