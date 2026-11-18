import {forms as selectableForms, rowsOf, sources} from './app-data.js';

const profiles={info:'informasi-umum',pihak:'pihak-terkait',bank:'rekening-bank',flag:'flag-wp',jenispajak:'jenis-pajak',
  alamat:'alamat',klu:'klu',nomorlain:'nomor-identitas-lain',sertel:'sertifikat-elektronik',pbb:'tanah-bangunan',login:'login-terakhir',dokumen:'dokumen'};
const lists={sptdaftar:'daftar',sptbelum:'belum-dilaporkan',sptarsip:'daftar-arsip'};
const typeFields=new Set(['jenisspt','jenissuratpemberitahuanpajak','returnsheettypecode','taxreturntypecode']);
const typeText=value=>String(value).trim().toLowerCase().replace(/\s+/g,' ');
const typeLabels=new Map();
for(const [code,label] of selectableForms) {
  for(const value of [code,label,'SPT '+label]) typeLabels.set(typeText(value),code);
}
typeLabels.set('spt pph badan rupiah','ICT_RCITR');
typeLabels.set('spt masa pph pasal 21/26','ICT_WITR');
export const isSptList=source=>Object.hasOwn(lists,source);

export function listRowType(row) {
  const matched=new Set();
  for(const [key,value] of Object.entries(row || {})) {
    if(!typeFields.has(key.toLowerCase().replace(/[^a-z]/g,'')) || value==null || value==='')continue;
    matched.add(typeLabels.get(typeText(value)) || '');
  }
  return matched.size===1 ? [...matched][0] : '';
}
export function selectSptListRows(item,types) {
  if(!isSptList(item.source) || item.sptSelection) return item;
  const selected=new Set(types),all=selectableForms.every(([id])=>selected.has(id));
  const rows=rowsOf(item.page),included=[],byType={};
  let unknown=0;
  for(const row of rows) {
    const type=listRowType(row);
    if(type) byType[type]=(byType[type] || 0)+1;
    else unknown++;
    if(all || selected.has(type)) included.push(row);
  }
  if(!included.length) return null;
  const omitted=rows.length-included.length;
  const sptSelection={perJenisPadaSumber:byType,jenisBelumDikenali:unknown,barisSumber:rows.length,
    totalDilaporkanSumber:item.total ?? null,barisDilewati:omitted};
  // Preserve the native response verbatim when all its rows are in scope.
  return {...item,spt:'',sptSelection,rows:included.length,total:omitted?null:item.total,
    page:omitted?{Payload:{Data:included}}:item.page};
}
const forms={VAT_VATR:'PPN',VAT_VATTRNTEVATC:'PPN-PEMUNGUT',ICT_WITR:'PPH2126',ICT_WTR:'UNIFIKASI',ICT_RCITR:'BADAN',ICT_PITR:'OP'};
const collectorParts={induk:'Induk SPT PPN Pemungut',l1:'Lampiran 1',l2:'Lampiran 2','l2-total':'Lampiran 2: Jumlah'};
const monthNames=['januari','februari','maret','april','mei','juni','juli','agustus','september','oktober','november','desember'];

export function metaForSelection(meta,items) {
  if(!items.length || !items.every(e=>e.source==='tabelumum' && e.period===null)) return meta;
  return {...meta,periode:'Tidak tercantum pada sumber',opsi:{...meta.opsi,periode:null}};
}
function consistentField(rows, labels) {
  if(!rows.length) return '';
  const values=new Set();
  for(const row of rows) {
    if(!row || typeof row!=='object') return '';
    const fields=Object.entries(row).filter(([key])=>labels.includes(key.toLowerCase().replace(/[^a-z]/g,'')));
    if(!fields.length || fields.some(([,v])=>v===null || v===undefined || String(v).trim()==='')) return '';
    for(const [,v] of fields) values.add(String(v).trim());
  }
  return values.size===1?[...values][0]:'';
}
function periodLabel(rows) {
  const value=consistentField(rows,['masapajak','periodepajak','taxperiod','taxperiodcode']) ||
    consistentField(rows,['tahunpajak','taxyear']);
  const code=/^(0[1-9]|1[0-2])(0[1-9]|1[0-2])((?:19|20)\d{2})$/.exec(value);
  if(code)return code[1]===code[2]?code[3]+'-'+code[1]:code[3];
  if(/^(?:19|20)\d{2}(?:-(?:0[1-9]|1[0-2]))?$/.test(value)) return value;
  let m=value.toLowerCase().match(/^(\d{1,2}|[a-z]+)[ /-]+((?:19|20)\d{2})$/);
  if(!m) return '';
  const month=Number(m[1]) || monthNames.indexOf(m[1])+1;
  return month>=1 && month<=12?m[2]+'-'+String(month).padStart(2,'0'):'';
}
export function packagePath(item) {
  if(item.source==='tabelumum') return 'tabel/'+item.id+'.json';
  if(item.source==='bbsaldo') return 'bukubesar-saldo.json';
  if(Object.hasOwn(profiles,item.source)) return 'profil/'+profiles[item.source]+'.json';
  if(Object.hasOwn(lists,item.source)) return 'spt/'+lists[item.source]+'.json';
  if(item.source==='sptisi' && item.detailProof) {
    const {recordId,period,part,revision}=item.detailProof;
    if (Object.hasOwn(forms,item.spt) && /^[a-z0-9_-]{1,80}$/i.test(recordId || '') &&
        /^\d{4}(-(?:0[1-9]|1[0-2]))?$/.test(period) && Number.isInteger(revision) && revision>=0 && revision<=999 &&
        /^[a-z0-9][a-z0-9-]{0,45}$/.test(part)) {
      return 'spt/'+forms[item.spt]+'/'+period+'/p'+String(revision).padStart(2,'0')+'_'+recordId+'/'+part+'.json';
    }
    const pass=item.proof?.urutan?.id;
    return 'sptisi/'+(item.detailProof.receipt && /^[a-f0-9-]{36}$/i.test(pass || '')?pass:item.id)+'.json';
  }
  const rows=rowsOf(item.page), period=periodLabel(rows);
  if(['bb','bbtotal'].includes(item.source) && period.length===7) {
    return (item.source==='bb'?'bukubesar/':'bukubesar-total/')+period+'.json';
  }
  if(item.source==='sptisi' && Object.hasOwn(forms,item.spt)) {
    const id=consistentField(rows,['taxreturnrecordid','idrekamspt','idspt']);
    const version=consistentField(rows,['pembetulanke','pembetulan','amendmentnumber']);
    const partName=consistentField(rows,['bagianspt','lampiranspt','returnsection']).toLowerCase();
    const part=item.spt==='VAT_VATTRNTEVATC' ?
      Object.keys(collectorParts).find(k=>k===partName || collectorParts[k].toLowerCase()===partName) || '' :
      partName.replace(/^lampiran\s+/,'');
    const form=forms[item.spt], annual=['OP','BADAN'].includes(form);
    if(period.length===(annual?4:7) && /^[a-z0-9_-]{1,80}$/i.test(id) && /^\d{1,3}$/.test(version) && /^[a-z0-9][a-z0-9-]{0,45}$/.test(part)) {
      return 'spt/'+form+'/'+period+'/p'+version.padStart(2,'0')+'_'+id+'/'+part+'.json';
    }
  }
  return item.source+'/'+item.id+'.json';
}

export function appendPackageEntry(groups,item,wp) {
  const path=packagePath(item);
  if(!groups.has(path)) {
    const collectorPart=path.startsWith('spt/PPN-PEMUNGUT/') ? collectorParts[path.split('/').at(-1).replace(/\.json$/,'')] : '';
    const context={npwp:wp,periode:item.period};
    if(item.source==='sptisi' && path.startsWith('spt/')) {
      const [,,period,version,filename]=path.split('/');
      const [amendment,recordId]=/^p(\d+)_(.+)$/.exec(version).slice(1);
      const part=filename.slice(0,-5),year=Number(period.slice(0,4)),month=period.slice(5);
      const nativePeriod=consistentField(rowsOf(item.page),['taxperiodcode']);
      const masa=/^(0[1-9]|1[0-2])(0[1-9]|1[0-2])((?:19|20)\d{2})$/.test(nativePeriod) ? nativePeriod :
        month?month+month+year:period;
      context.spt={recordId,jenis:item.spt,masa,pemb:Number(amendment),tahun:year,npwp:wp};
      context.bagian=part;
      context.labelBagian=collectorPart || part.toUpperCase();
      if(part==='induk')context.jenisBagian='induk';
      else if(part.endsWith('-total'))context.jenisBagian='footer';
      else if(Array.isArray(item.page.Payload?.Data) || Array.isArray(item.page.Payload))context.jenisBagian='grid';
    }
    if(item.source==='sptisi' && item.detailProof) {
      const proof=item.detailProof;
      const [year,month]=proof.period.split('-');
      const masa=month && /^\d{2}$/.test(month)?month+month+year:proof.period;
      context.spt={recordId:proof.recordId || '',jenis:item.spt,masa,pemb:proof.revision,tahun:Number(year),npwp:wp,
        nomor:proof.receipt || ''};
      context.bagian=proof.part;context.labelBagian=proof.label;
      context.cuplikanTampilan=true;
    }
    groups.set(path,{path,cap:{sumber:item.source,label:collectorPart?sources[item.source]+' · '+collectorPart:sources[item.source],baris:0,total:null,lengkap:false,
      konteks:context,catatan:['Isi mengikuti halaman atau berkas yang ditambahkan pada penarikan ini.',
        ...(item.period===null?['Sumber tidak mencantumkan masa pajak.']:[])],asal:item.name,halamanSumber:[]},pages:[]});
  }
  const entry=groups.get(path);
  entry.pages.push(item.page);
  entry.cap.baris+=item.rows;
  // A reported total may cover other pages, so adding totals would double count.
  entry.cap.total=entry.pages.length===1 ? item.total : null;
  const type=isSptList(item.source)?'':item.spt;
  entry.cap.halamanSumber.push({asal:item.name,metode:item.origin,baris:item.rows,total:item.total,jenisSpt:type || '',
    ...(item.sptSelection?{klasifikasiSpt:item.sptSelection}:{}),...(item.proof?{pencocokan:item.proof}:{})});
  if(entry.pages.length===1 && type) entry.cap.konteks.jenisSpt=type;
  else if(entry.cap.konteks.jenisSpt!==type) delete entry.cap.konteks.jenisSpt;
}
