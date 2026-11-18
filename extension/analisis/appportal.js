import {normalizeId} from '../app-data.js';
import {rowsOf,worksheet} from './model.js';
import {vatCoverage} from './vat-coverage.js';

export const portalTypes={
  PK:{label:'Faktur Pajak Keluaran',parts:['a2'],owner:'NPWP Penjual'},
  PM:{label:'Faktur Pajak Masukan',parts:['b2','b3'],owner:'NPWP Pembeli'},
  PIB:{label:'PIB (impor)',parts:['b1'],owner:'NPWP Importir'},
  PEB:{label:'PEB (ekspor)',parts:['a1'],owner:'NPWP Eksportir'}
};
const aliases={
  number:['Nomor faktur','Nomor faktur pajak','No faktur','Nomor dokumen','DocumentNumber','Nomor','No dokumen','TaxInvoiceNumber','InvoiceNumber','Nomor aju'],
  owner:['NPWP pemilik','NPWP WP','NPWP wajib pajak','MainTaxpayerTIN'],
  month:['Masa pajak','Masa','Bulan','TaxPeriodMonth'],year:['Tahun pajak','Tahun','TaxPeriodYear'],
  date:['Tanggal faktur','Tanggal dokumen','Tanggal','DocumentDate','Tanggal PIB','Tanggal PEB'],
  base:['DPP','Dasar pengenaan pajak','TaxBase'],vat:['PPN','VAT','PPN terutang'],
  otherBase:['DPP nilai lain','OtherTaxBase'],luxury:['PPnBM','STLG'],partner:['NPWP lawan','NPWP lawan transaksi'],
  name:['Nama lawan','Nama lawan transaksi'],code:['Kode transaksi','TransactionCode'],desc:['Uraian','Barang/jasa','Nama barang'],
  invoiceStatus:['Status faktur','Status dokumen','Status'],itemType:['Jenis barang/jasa','Tipe barang/jasa'],
  duty:['Bea masuk','BM'],tax22:['PPh 22','PPh Pasal 22'],exchange:['Kurs','Nilai tukar']
};
export const mappingLabels={number:'Nomor dokumen',owner:'NPWP pemilik',month:'Masa',year:'Tahun',date:'Tanggal dokumen',base:'DPP',vat:'PPN',
  otherBase:'DPP nilai lain',luxury:'PPnBM',partner:'NPWP lawan',name:'Nama lawan',code:'Kode transaksi',desc:'Barang atau jasa',invoiceStatus:'Status dokumen',
  duty:'Bea masuk',tax22:'PPh 22',exchange:'Kurs',itemType:'Jenis barang atau jasa'};
const formFields={
  PK:['number','owner','month','year','date','base','vat','otherBase','luxury','partner','name','code','itemType','desc','invoiceStatus'],
  PM:['number','owner','month','year','date','base','vat','otherBase','luxury','partner','name','code','itemType','desc','invoiceStatus'],
  PIB:['number','owner','month','year','date','base','vat','luxury','partner','name','duty','tax22','exchange'],
  PEB:['number','owner','month','year','date','base','partner','name','exchange']
};
export const fieldsFor=type=>formFields[type];
export const fieldCaption=(type,k)=>k==='base'&&type==='PIB'?'Nilai pabean':k==='base'&&type==='PEB'?'Nilai ekspor':mappingLabels[k];
const key=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g,'');
const present=value=>value!==null&&value!==undefined&&String(value).trim()!=='';
function fieldAliases(type,field){
  if(field==='owner')return [portalTypes[type].owner,...aliases.owner];
  if(field==='number')return ['Nomor '+type,'No '+type,...aliases.number];
  if(field==='base'&&type==='PIB')return ['Nilai pabean','Nilai impor',...aliases.base];
  if(field==='base'&&type==='PEB')return ['Nilai ekspor','FOB','Nilai FOB',...aliases.base];
  const party={PK:'Pembeli',PM:'Penjual',PIB:'Pemasok',PEB:'Pembeli'}[type];
  if(party&&['partner','name'].includes(field))return [(field==='partner'?'NPWP ':'Nama ')+party,...aliases[field]];
  return aliases[field];
}
export function inferMapping(header,type){
  const keys=Array.from(header,key);
  return Object.fromEntries(fieldsFor(type).map(field=>{
    for(const name of fieldAliases(type,field)){const i=keys.indexOf(key(name));if(i!==-1)return [field,i];}
    return [field,-1];
  }));
}
export function inferHeader(rows,type){
  let best=0,max=0;
  rows.slice(0,40).forEach((r,i)=>{
    const m=inferMapping(r,type),score=Object.values(m).filter(v=>v>=0).length+(m.number>=0?2:0);
    if(score>max){best=i;max=score;}
  });
  return best;
}
export function inferType(name,header){
  const norm=String(name).toUpperCase().replace(/[^A-Z0-9]+/g,' ');
  const found=Object.keys(portalTypes).filter(t=>norm.split(' ').includes(t));
  if(found.length===1)return found[0];
  const labels=header.map(key);
  if(labels.some(v=>['nomorpib','nopib'].includes(v)))return 'PIB';
  if(labels.some(v=>['nomorpeb','nopeb'].includes(v)))return 'PEB';
  if(/MASUKAN/.test(norm))return 'PM';
  return 'PK';
}
function amount(value){
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(!present(value))return null;
  let text=String(value).trim();
  if(/^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text))text=text.replaceAll('.','').replace(',','.');
  else if(/^[+-]?\d+(,\d+)?$/.test(text))text=text.replace(',','.');
  else if(!/^[+-]?\d+\.\d+$/.test(text))return null;
  const n=Number(text);
  return Number.isFinite(n)?n:null;
}
const monthNames=['januari','februari','maret','april','mei','juni','juli','agustus','september','oktober','november','desember'];
function datedPeriod(value,date1904){
  if(typeof value==='number'&&value>=32874&&value<=73415){
    const epoch=date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,30);
    return new Date(epoch+Math.trunc(value)*86400000).toISOString().slice(0,7);
  }
  const s=String(value??'').trim(),iso=/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/.exec(s);
  const local=/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if(!iso&&!local)return '';
  const [year,month,day]=iso?iso.slice(1).map(Number):local.slice(1).reverse().map(Number);
  const d=new Date(Date.UTC(year,month-1,day));
  return d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day?d.toISOString().slice(0,7):'';
}
function taxPeriod(month,year,date,date1904){
  const m=String(month??'').trim().toLowerCase(),y=String(year??'').trim();
  const combined=/^(\d{4})-(0[1-9]|1[0-2])$/.exec(m);
  if(combined)return !y||y===combined[1]?m:'';
  const fallback=datedPeriod(date,date1904);
  if(y&&!/^\d{4}$/.test(y))return '';
  if(!m)return !y||y===fallback.slice(0,4)?fallback:'';
  const n=/^\d{1,2}$/.test(m)?Number(m):monthNames.indexOf(m)+1;
  const fiscalYear=y||fallback.slice(0,4);
  return n>=1&&n<=12&&fiscalYear?fiscalYear+'-'+String(n).padStart(2,'0'):'';
}
function documentNumber(value){
  // Spreadsheet numeric cells may already have lost leading zeroes or precision.
  if(typeof value!=='string')return '';
  const s=value.normalize('NFKC').trim().toUpperCase();
  return /^[\d .-]+$/.test(s)?s.replace(/[ .-]/g,''):s;
}
function indexed(rows,side){
  const groups=new Map();
  for(const [index,r] of rows.entries()){
    const k=r.number?'id/'+r.number:side+'/'+index;
    if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);
  }
  return groups;
}
const status={ok:'Cocok',similar:'Cocok sebagian',diff:'Selisih nilai',portal:'Hanya di appportal',spt:'Hanya di SPT',uncertain:'Perlu diperiksa'};
function tails(groups){
  const found=new Map();
  for(const [key,group] of groups){
    const n=group[0].number;if(!/^\d{13,16}$/.test(n))continue;
    const tail=n.slice(-13);found.set(tail,found.has(tail)?null:key);
  }
  return found;
}
function total(group,field){
  if(!group?.length||group.some(r=>r[field]===null))return null;
  return group.reduce((n,r)=>n+r[field],0);
}
const unique=(group,field)=>[...new Set(group.map(r=>r[field]).filter(present))].join(', ');
function compareGroup(left,right,opts,partial,suffixMatch=false){
  const r=(left[0]||right[0]),dpp=total(left,'base'),sptDpp=total(right,'base'),vat=total(left,'vat'),sptVat=total(right,'vat');
  let label,note='';
  if(!r.number){label=status.uncertain;note='Nomor kosong atau disimpan sebagai angka.';}
  else if((left.length>1&&(!opts.group||new Set(left.map(r=>r.period)).size>1))||right.length>1){label=status.uncertain;note='Nomor muncul beberapa kali. Periksa masa dan baris rincian.';}
  else if(!right.length){label=partial?status.uncertain:status.portal;if(partial)note='Lampiran SPT masa ini belum lengkap.';}
  else if(!left.length){label=status.spt;}
  else{
    const values=[[opts.mapping.base,dpp,sptDpp]];
    if(opts.type!=='PEB')values.push([opts.mapping.vat,vat,sptVat]);
    const comparable=values.filter(([i])=>i>=0);
    if(!comparable.length||comparable.some(([,a,b])=>a===null||b===null)){label=status.uncertain;note='Nominal pembanding belum lengkap.';}
    else label=comparable.some(([,a,b])=>Math.abs(a-b)>1)?status.diff:suffixMatch?status.similar:status.ok;
    if(suffixMatch)note=[note,'Tiga belas digit terakhir cocok. Periksa awalan nomor pada kedua sumber.'].filter(Boolean).join(' ');
    if(left[0].period!==right[0].period)note=[note,'Masa dokumen appportal berbeda dari masa pelaporan SPT.'].filter(Boolean).join(' ');
  }
  return {Masa:r.period,Nomor:r.number,Status:label,'Masa appportal':unique(left,'period'),'Masa SPT':unique(right,'period'),'Nomor appportal':unique(left,'originalNumber'),'Nomor SPT':unique(right,'originalNumber'),
    'Lampiran SPT':unique(right,'part'),'Pembetulan SPT':unique(right,'version'),'Tanggal appportal':unique(left,'date'),
    'NPWP lawan':unique(left,'partner'),'Nama lawan':unique(left,'name'),'Baris appportal':left.length,'Baris SPT':right.length,'DPP appportal':dpp,'DPP SPT':sptDpp,
    'Selisih DPP (SPT − appportal)':dpp===null||sptDpp===null?null:sptDpp-dpp,'PPN appportal':vat,'PPN SPT':sptVat,
    'Selisih PPN (SPT − appportal)':vat===null||sptVat===null?null:sptVat-vat,'DPP nilai lain appportal':total(left,'otherBase'),'PPnBM appportal':total(left,'luxury'),
    'Kode transaksi':unique(left,'code'),'Tarif efektif PPN (%)':dpp&&vat!==null?100*vat/dpp:null,'Barang atau jasa':unique(left,'desc'),'Jenis barang atau jasa':unique(left,'itemType'),
    'Status dokumen':unique(left,'invoiceStatus'),'Bea masuk':total(left,'duty'),'PPh 22':total(left,'tax22'),Kurs:unique(left,'exchange'),
    'Baris sumber appportal':left.map(r=>r.index).join(', '),'Sumber SPT':unique(right,'source'),Keterangan:note};
}
function sourceGrid(pkg,forms,type,columns={}){
  const docs=[],partial=new Set(),coverage=[],available=new Set();
  for(const f of forms){
    const rows=vatCoverage(f,pkg)?.rows||[];
    for(const part of portalTypes[type].parts){
      const entry=f.parts.get(part);
      const checked=rows.find(r=>r.Bagian===part.toUpperCase()),quality=checked?.Status||'Belum ada';
      if(!['Lengkap','Kosong terverifikasi'].includes(quality))partial.add(f.period);
      coverage.push({Masa:f.period,Lampiran:part.toUpperCase(),Status:quality,Sumber:entry?.path||''});
      const owner=pkg.manifest.wp.npwp;
      const owners=[entry?.cap?.konteks?.npwp,entry?.cap?.konteks?.spt?.npwp].filter(present);
      if(owners.some(v=>normalizeId(v)!==normalizeId(owner)))continue;
      const ctx=entry?.cap?.konteks,spt=ctx?.spt;
      if((present(ctx?.bagian)&&ctx.bagian!==part)||(present(spt?.recordId)&&spt.recordId!==f.id)||
        (present(spt?.jenis)&&spt.jenis!=='VAT_VATR')||(present(spt?.pemb)&&Number(spt.pemb)!==f.version)||
        (present(spt?.tahun)&&String(spt.tahun)!==f.year)||
        (present(spt?.masa)&&![f.period,f.period.slice(-2).repeat(2)+f.year].includes(spt.masa)))continue;
      const successful=(entry?.pages||[]).filter(p=>p?.IsSuccessful!==false&&!p?.Errors?.length);
      for(const r of rowsOf({pages:successful})){
        for(const [k,v] of Object.entries(r))if(typeof v==='number'||typeof v==='string')available.add(k);
        const originalNumber=columns.number?r[columns.number]:r.DocumentNumber??r.TaxInvoiceNumber??r.InvoiceNumber;
        docs.push({period:f.period,number:documentNumber(originalNumber),originalNumber,
          base:amount(r[columns.base||'TaxBase']),vat:amount(r[columns.vat||'VAT']),source:entry.path,part:part.toUpperCase(),version:f.version});
      }
    }
  }
  return {docs,partial,coverage,available:[...available].sort()};
}
export function reconcileAppportal(pkg,opts){
  const {type,year,rows,header,mapping,confirmed,scope=true}=opts;
  if(!pkg?.report?.valid||!normalizeId(pkg?.manifest?.wp?.npwp)||!portalTypes[type]||!/^\d{4}$/.test(year))throw Error('Pilih paket WP yang telah diperiksa, jenis data dan tahun.');
  if(!Number.isInteger(mapping.number)||mapping.number<0)throw Error('Pilih kolom nomor dokumen.');
  const owner=normalizeId(pkg.manifest.wp.npwp);
  const headerNames=rows[header].map(key);
  const ownerColumns=new Set(headerNames.map((name,index)=>fieldAliases(type,'owner').some(alias=>key(alias)===name)?index:-1).filter(i=>i>=0));
  if(mapping.owner>=0)ownerColumns.add(mapping.owner);
  const seen=new Map(),ambiguous=new Set();
  for(const form of pkg.forms.filter(f=>f.type==='PPN'&&f.year===year)){
    const v=seen.get(form.period);
    if(!v||form.version>v.version){seen.set(form.period,form);ambiguous.delete(form.period);}
    else if(form.version===v.version)ambiguous.add(form.period);
  }
  const forms=[...seen.values()].filter(f=>!ambiguous.has(f.period));
  const grid=sourceGrid(pkg,forms,type,opts.packageMapping),left=[],excluded={tahun:0,masa:0,tanpaSpt:0,versiGanda:0};
  for(const period of ambiguous)grid.coverage.push({Masa:period,Lampiran:portalTypes[type].parts.join('+').toUpperCase(),Status:'Versi terakhir ganda',Sumber:''});
  const data=rows.slice(header+1);
  let missingOwner=!ownerColumns.size;
  for(const [offset,row] of data.entries()){
    if(!row.some(present))continue;
    const ids=[...ownerColumns].map(i=>row[i]).filter(present);
    if(ids.some(id=>typeof id!=='string'||normalizeId(id)!==owner))throw Error('NPWP pemilik berbeda atau tidak terbaca sebagai teks. Periksa berkas untuk satu WP.');
    if(!ids.length)missingOwner=true;
    const period=taxPeriod(row[mapping.month],row[mapping.year],row[mapping.date],opts.date1904);
    if(!period){excluded.masa++;continue;}
    if(period.slice(0,4)!==year){excluded.tahun++;continue;}
    if(ambiguous.has(period)){excluded.versiGanda++;continue;}
    if(scope&&!seen.has(period)){excluded.tanpaSpt++;continue;}
    const doc={period,number:documentNumber(row[mapping.number]),originalNumber:row[mapping.number],index:opts.rowNumbers?.[header+1+offset]??header+2+offset};
    for(const k of ['base','vat','otherBase','luxury','duty','tax22'])doc[k]=amount(row[mapping[k]]);
    for(const k of ['date','partner','name','code','desc','invoiceStatus','exchange','itemType'])doc[k]=row[mapping[k]];
    left.push(doc);
  }
  if(missingOwner&&!confirmed)throw Error('Cocokkan WP pemilik berkas dengan WP aktif dan centang konfirmasi.');
  const byLeft=indexed(left,'appportal'),byRight=indexed(grid.docs,'spt'),details=[],used=new Set();
  const invoices=['PK','PM'].includes(type),portalTails=invoices?tails(byLeft):null,sptTails=invoices?tails(byRight):null;
  for(const [k,l] of byLeft){
    const period=l[0].period,suffix=l[0].number.slice(-13);
    let candidate=byRight.has(k)?k:null,suffixMatch=false;
    if(!candidate&&portalTails?.get(suffix)===k){
      candidate=sptTails.get(suffix);suffixMatch=Boolean(candidate&&!byLeft.has(candidate));
      if(!suffixMatch)candidate=null;
    }
    if(candidate)used.add(candidate);
    const match=compareGroup(l,byRight.get(candidate)||[],opts,grid.partial.has(period)||!seen.has(period),suffixMatch);
    if(!candidate&&portalTails?.has(suffix)&&sptTails?.has(suffix)){
      match.Status=status.uncertain;match.Keterangan='Akhiran nomor cocok dengan lebih dari satu kemungkinan. Periksa nomor lengkap.';
    }
    details.push(match);
  }
  for(const [k,r] of byRight)if(!used.has(k))details.push(compareGroup([],r,opts,false));
  details.sort((a,b)=>a.Masa.localeCompare(b.Masa)||a.Nomor.localeCompare(b.Nomor));
  function totals(group){
    const sums={};
    for(const field of ['DPP appportal','DPP SPT','PPN appportal','PPN SPT']){
      sums[field]=total(group.filter(r=>r[field.endsWith('SPT')?'Baris SPT':'Baris appportal']>0),field);
    }
    return sums;
  }
  const summary=Object.values(status).map(s=>{
    const group=details.filter(r=>r.Status===s);return {Status:s,Dokumen:group.length,...totals(group)};
  });
  const months=[...new Set([...grid.coverage.map(r=>r.Masa),...left.map(r=>r.period)])].sort().map(Masa=>{
    const portal=left.filter(r=>r.period===Masa),spt=grid.docs.filter(r=>r.period===Masa);
    return {Masa,'Baris appportal':portal.length,'Baris SPT':spt.length,
      'DPP appportal':total(portal,'base'),'DPP SPT':total(spt,'base'),'PPN appportal':total(portal,'vat'),'PPN SPT':total(spt,'vat'),
      'Belum cocok':details.filter(r=>r.Status!==status.ok&&[...r['Masa appportal'].split(', '),...r['Masa SPT'].split(', ')].includes(Masa)).length};
  });
  const diagnostics=[];
  for(const [label,rows] of [['Appportal',left],['SPT',grid.docs]]){
    const lengths=new Map();
    for(const r of rows){const n=r.number.length;lengths.set(n,(lengths.get(n)||0)+1);}
    for(const [length,n] of [...lengths.entries()].sort(([a],[b])=>a-b))diagnostics.push({Sumber:label,'Panjang nomor':length,Baris:n});
  }
  return {details,summary,months,diagnostics,coverage:grid.coverage,columns:grid.available,excluded,left:left.length,right:grid.docs.length,ownerVerified:!missingOwner};
}
export function portalSheets(report,opts){
  const {year,type,wp,role,name,hash,scope,group,imported,date,header,sheet,mapping}=opts;
  const info=[['Keterangan','Nilai'],['WP',wp.npwp],['Nama WP',wp.nama||''],['Peran',role],['Waktu impor',imported],['Waktu ekspor',date],
    ['Tahun pajak',year],['Jenis',portalTypes[type].label],['Lampiran',portalTypes[type].parts.join(' + ').toUpperCase()],['Berkas appportal',name],['SHA-256 appportal',hash],
    ['Toleransi nominal','Rp1 per nilai pembanding'],['Arah selisih','SPT dikurangi appportal'],
    ['SHA-256 manifest',opts.manifestHash],['Lembar',sheet],['Baris judul',opts.rowNumbers?.[header]??header+1],['Pembanding SPT','Versi terakhir setiap masa'],['Hanya masa dengan SPT',scope?'Ya':'Tidak'],
    ['Jumlahkan barang per nomor',group?'Ya':'Tidak'],['Identitas pemilik',report.ownerVerified?'Kolom pemilik cocok dengan WP':'Dikonfirmasi pengguna'],
    ['Baris appportal dalam cakupan',report.left],['Baris lampiran SPT',report.right],['Di luar tahun',report.excluded.tahun],['Masa tidak terbaca',report.excluded.masa],
    ['Masa tanpa SPT',report.excluded.tanpaSpt],['Masa dengan pembetulan terakhir ganda (baris)',report.excluded.versiGanda]];
  for(const [k,i] of Object.entries(mapping))info.push(['Kolom '+fieldCaption(type,k),i>=0?String(opts.rows[header][i]??''):'']);
  for(const k of ['number','base','vat'])info.push(['Kolom SPT · '+mappingLabels[k],opts.packageMapping?.[k]||'Otomatis']);
  const monthly=[...worksheet(report.months),[],...worksheet(report.coverage)];
  const rows=[info,worksheet(report.summary),monthly,worksheet(report.details)];
  return ['Info','Ringkasan','Per masa','Rincian'].map((name,i)=>({name:name+' '+type,rows:rows[i]}));
}
