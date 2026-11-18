import {sources,rowsOf,visibleTables} from './app-data.js';
import {suggestedSource} from './app-batch.js';
import {periodLabel} from './app-package-entries.js';

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

async function inspectTable(ext,tab,table,source,scope,expect,includeRows=false){
  const [from,to]=scope.period.split(' s.d. ');
  const fields=columns[source].map(group=>table.labels.filter(label=>group.some(f=>key(f)===key(label))));
  const [frame]=await ext.scripting.executeScript({target:{tabId:tab.id},func:visibleTables,args:[{...table,url:tab.url,
    quick:{expect,fields,includeRows},scope:{source,wp:scope.wp,from,to,periodRequired:source==='bb'||source==='bbtotal'}}]});
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
    const manuallyAdded=existing.some(e=>!e.proof?.pratinjauSumber);
    for(const [i,m] of members.entries()){
      const status=hashes.size>1?'Ada beberapa tampilan berbeda untuk sumber dan masa ini. Periksa melalui Cara menarik.':
        live.some(e=>e.proof.pratinjauSumber.sidikIsi===m.slice.hash)?'Sudah ada di antrean.':
        live.length||manuallyAdded?'Ada sumber lain di antrean. Cocokkan melalui Cara menarik.':i?'Salinan identik pada baris yang tampak.':'Siap ditambahkan.';
      const ready=status==='Siap ditambahkan.';
      choices.push({...m,status,copies:members.length-1,ready,peers:ready?members.filter(other=>other!==m):[]});
    }
  }
  return choices;
}
export function openSourcePreview({ext,origin,box,context,queued,enqueue,render,notice}){
  let revision=0,active=false;
  function invalidate(){revision++;box.replaceChildren();}
  const stateText=row=>{const text=document.createElement('td');row.append(text);return text;};
  function accessibleMessage(text){const p=document.createElement('p');p.setAttribute('role','status');p.textContent=text;box.append(p);return p;}
  async function scan(){
    invalidate();const generation=revision,scope=context(),wanted=scope.sources.filter(s=>supportedSources.includes(s));
    if(!ext || !wanted.length)return false;
    const valid=()=>generation===revision && samePlan(scope,context());
    const found=[];let unread=0;
    for(const [i,tab] of (await ext.tabs.query({url:origin+'/*'})).entries()){
      if(!valid())return false;
      if(!tab.url || new URL(tab.url).origin!==origin)continue;
      let tables;
      try{const [frame]=await ext.scripting.executeScript({target:{tabId:tab.id},func:visibleTables,args:[null]});tables=frame?.result;}catch{unread++;continue;}
      if(!Array.isArray(tables))continue;
      for(const table of tables){
        const source=suggestedSource(table.title,wanted);
        if(!source)continue;
        const item={tab,table,source,n:i+1};found.push(item);
        if(!tableFits(source,table.labels)){item.skip='Judul sesuai, tetapi kolom khas sumber belum cocok.';continue;}
        if(!valid())return false;
        try{item.result=await inspectTable(ext,tab,table,source,scope);item.skip=item.result.skip;}
        catch{item.skip='Tab atau struktur tabel berubah selama pratinjau.';}
      }
    }
    if(!valid())return false;
    // SPT continues to use its own directory, including its independent rules for pagination.
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
      for(const v of [sources[item.source],month||'—',String(item.n),count??'—',status])stateText(r).textContent=v;
      return r.lastElementChild;
    }
    for(const item of found.filter(t=>t.skip))row(item,'',null,item.skip);
    for(const m of choices){
      const result=m.item.result,note=result.filtered?' Filter aktif pada tabel.':'';
      m.label=row(m.item,m.slice.month,m.slice.count,m.status+note+(result.canAdvance?' Ada halaman berikutnya.':''));
    }
    const ready=choices.filter(m=>m.ready);
    const missing=wanted.filter(s=>!found.some(item=>item.source===s)).length;
    const status=accessibleMessage('Pembacaan mencakup baris yang sedang tampak. '+(missing?missing+' sumber terpilih belum ditemukan. ':'')+
      (unread?unread+' tab tidak dapat diperiksa. ':'')+'Gunakan Cara menarik untuk beberapa halaman.');
    if(ready.length){
      const add=document.createElement('button');add.textContent='Tambahkan sumber terverifikasi';box.append(add);
      add.onclick=async()=>{
        if(active)return;active=true;add.disabled=true;
        let accepted=0,skipped=0;
        try{
          const verified=new Map(),peerChecks=new Map(),staged=[];
          async function reread(item,includeRows){
            const cache=includeRows?verified:peerChecks;
            if(cache.has(item))return cache.get(item);
            let current;
            try{current=await inspectTable(ext,item.tab,item.table,item.source,scope,item.result.stamp,includeRows);}
            catch{current={skip:'Tab atau struktur sumber berubah. Buka kembali Pratinjau WP.'};}
            cache.set(item,current);return current;
          }
          for(const m of ready){
            if(!valid())throw Error('Penugasan atau pilihan sumber berubah. Buka kembali Pratinjau WP.');
            const {item,slice}=m;
            const current=await reread(item,true);
            let copyChanged=false;
            for(const other of m.peers){
              if(!valid())throw Error('Penugasan atau pilihan sumber berubah. Buka kembali Pratinjau WP.');
              const peer=await reread(other.item,false);
              if(!peer.slices?.some(s=>s.month===slice.month && s.hash===slice.hash)){copyChanged=true;break;}
            }
            if(!valid())throw Error('Penugasan atau pilihan sumber berubah. Buka kembali Pratinjau WP.');
            const read=current.slices?.find(s=>s.month===slice.month && s.hash===slice.hash);
            if(copyChanged){m.label.textContent='Salinan di tab lain berubah sejak pratinjau. Periksa kembali sumber ini.';skipped++;continue;}
            if(!read || !Array.isArray(read.rows) || current.skip){m.label.textContent=current.skip||'Tampilan sumber berubah.';skipped++;continue;}
            const added=queued.some(e=>e.source===item.source && e.wp===scope.wp && e.period===scope.period && competes(e,slice.month));
            if(added){m.label.textContent='Sudah ada sumber pada antrean. Periksa kembali.';skipped++;continue;}
            const proof={columns:item.table.labels,owner:current.owner,period:current.period,morePagesAvailable:current.canAdvance,
              pratinjauSumber:{masa:slice.month,barisPadaTabel:item.table.rows,barisPadaMasa:slice.count,filterAktif:current.filtered,
                dasarPeriode:slice.month?'Masa pajak tiap baris':current.period.length?'Periode pada baris sesuai pilihan':
                  'Tanpa masa pajak pada tabel. Periode paket mengikuti penugasan.',
                ...(current.range?{rentangTampilan:current.range}:{}),salinanBarisTampak:m.copies,sidikIsi:slice.hash,cakupan:'Halaman yang terlihat'}};
            staged.push({m,read,info:{wp:scope.wp,source:item.source,spt:'',period:scope.period,proof}});
          }
          if(!valid())throw Error('Penugasan atau pilihan sumber berubah. Buka kembali Pratinjau WP.');
          for(const {m,read,info} of staged){
            enqueue(info,{Payload:{Data:read.rows}},m.item.table.title,'Tabel tampak');
            m.label.textContent='Masuk antrean · '+read.rows.length+' baris.';accepted++;
          }
          if(accepted)render();
          status.textContent=accepted+' sumber atau masa masuk antrean. '+skipped+' dilewati.';
        }catch(error){notice(error.message,true);status.textContent=error.message;}
        finally{active=false;}
      };
    }
    return true;
  }
  return {scan,invalidate,get active(){return active;}};
}
