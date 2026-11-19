import {normalizeId} from '../app-data.js';
import {rangeIsValid} from '../app-spt-plan.js';
import {kkaRegistryEntries} from './kka-management.js';
import {reconcileLedgerTotals} from './ledger-reconciliation.js';
import {ledgerTypeLabels,ledgerDetailLabels} from './ledger-table.js';
import {rowsOf,sptDay,submittedDay} from './model.js';
import {packageLedger} from './profile.js';
import {submittedReturnRows} from './profile-filing.js';
import {generalProfile,profileDay,profileLoginDay} from './profile-overview.js';
import {usesOtherCurrency} from './return-source.js';

const title='L-11 Ketertagihan';
const dayMs=86400000;
const text=value=>typeof value==='string'&&/[^\s–—-]/.test(value)?value.trim():Number.isSafeInteger(value)?String(value):'';
const paths=rows=>[...new Set(rows.filter(Boolean))].join(' · ');
const label=status=>status===true?'Mendukung':status===false?'Tidak mendukung':'Belum dapat dinilai';
const goodPage=page=>page&&page.IsSuccessful!==false&&!page.Errors?.length;
const dateField=(row,...names)=>names.map(k=>profileDay(row[k])).find(Boolean)||'';

function capture(pkg,source,path){
  const files=kkaRegistryEntries(pkg,source,path);
  const rows=files.flatMap(entry=>rowsOf({...entry,pages:entry.pages.filter(goodPage)})
    .map(row=>({...row,source:entry.path})));
  const failures=pkg.manifest.gagal||[];
  const complete=files.length>0&&files.every(entry=>entry.cap.lengkap===true&&entry.pages.length&&entry.pages.every(goodPage)&&
    entry.cap.baris===rowsOf(entry).length&&(entry.cap.total==null||entry.cap.total===entry.cap.baris)&&
    !entry.cap.payload?.Filters?.length&&!failures.some(f=>[source,entry.path,'data/'+entry.path].includes(
      typeof f==='string'?f:f?.path??f?.sumber)));
  return {files,rows,complete,source:paths(files.map(e=>e.path))};
}

function dated(row,asOf){
  const begin=dateField(row,'ValidFrom','Tanggal Mulai');
  const rawEnd=row.ValidTo??row['Tanggal Berakhir'];
  const end=profileDay(rawEnd);
  return asOf&&begin&&begin<=asOf&&(!end||end>=asOf)&&
    (Object.hasOwn(row,'ValidTo')||Object.hasOwn(row,'Tanggal Berakhir'))&&
    (!text(rawEnd)||end||/^(?:0001|1900)-01-01/.test(String(rawEnd)));
}

function rangeMonths(range){
  if(!rangeIsValid(range))return [];
  const start=range.from.y*12+range.from.m-1,end=range.to.y*12+range.to.m-1;
  return Array.from({length:end-start+1},(_,i)=>{
    const n=start+i;
    return Math.floor(n/12)+'-'+String(n%12+1).padStart(2,'0');
  });
}

function ledgerEvidence(pkg){
  const owner=normalizeId(pkg.manifest.wp?.npwp);
  const entries=pkg.entries.filter(e=>owner&&normalizeId(e.cap?.konteks?.npwp)===owner&&
    e.path.startsWith('bukubesar/')&&e.pages.length&&e.pages.every(goodPage));
  const rows=packageLedger({...pkg,entries},{includeUncertain:true});
  const active=rows.filter(r=>r['Status pembatalan untuk analisis']==='Aktif'&&
    [r.TaxpayerTIN,r.TaxpayerTin].filter(Boolean).every(id=>normalizeId(id)===owner));
  const debts=active.filter(r=>r.Amount<0&&Number.isFinite(r.Amount)&&Number.isFinite(r.AmountLeft)&&r.AmountLeft<0&&!usesOtherCurrency(r));
  const monthChecks=rangeMonths(pkg.manifest.opsi?.periode);
  const verified=new Set(monthChecks.length?reconcileLedgerTotals(pkg).filter(r=>r.Hasil==='Saldo cocok')
    .map(r=>r['Masa atau tahun']):[]);
  const complete=Boolean(verified.size&&monthChecks.every(m=>verified.has(m))&&
    entries.every(e=>verified.has(e.path.slice('bukubesar/'.length,-'.json'.length)))&&active.length===rows.length&&
    active.every(r=>Number.isFinite(r.Amount)&&(r.Amount>=0||Number.isFinite(r.AmountLeft)&&!usesOtherCurrency(r))));
  const read=active.some(r=>Number.isFinite(r.Amount)&&Number.isFinite(r.AmountLeft));
  return {active,debts,complete,total:read||complete?debts.reduce((sum,r)=>sum-r.AmountLeft,0):null,
    source:paths(entries.map(e=>e.path))};
}

function activities(pkg,information,asOf){
  const logins=capture(pkg,'login','profil/login-terakhir.json').rows
    .map(row=>({day:profileLoginDay(row),source:row.source,kind:'Login Coretax'}));
  for(const row of information){
    const day=profileLoginDay(generalProfile(row));
    if(day)logins.push({day,source:row.source,kind:'Login Coretax'});
  }
  const filed=submittedReturnRows(pkg).map(({meta})=>({day:submittedDay(meta),source:meta['Berkas sumber'],kind:'Pelaporan SPT'}));
  if(!asOf)return null;
  return [...filed,...logins].filter(item=>item.day&&item.day<=asOf).sort((a,b)=>b.day.localeCompare(a.day))[0]??null;
}

function abilityAssessment(ability){
  const {principal,cash,workingCapital,operatingCashflow}=ability;
  const funds=[cash.value,workingCapital.value,operatingCashflow.value];
  if(principal.value===0)return [true,'Pokok yang tercatat dalam lingkup temuan adalah nol.'];
  if(!Number.isFinite(principal.value))return [null,'Pokok dalam lingkup temuan belum tersedia.'];
  if(funds.some(value=>Number.isFinite(value)&&value>=principal.value))return [true,'Setidaknya satu sumber dana pada Tabel 5.3 menutup pokok.'];
  if(funds.every(Number.isFinite))return [false,'Ketiga sumber dana pada Tabel 5.3 berada di bawah pokok.'];
  return [null,'Angka sumber dana yang belum tersedia masih memengaruhi penilaian.'];
}

export function kkaCollectabilityAppendix(pkg,year,work,ability){
  if(pkg.report?.valid===false)return null;
  const asOf=sptDay(pkg.manifest.dibuat),owner=normalizeId(pkg.manifest.wp?.npwp);
  const info=capture(pkg,'info','profil/informasi-umum.json').rows.filter(row=>{
    const id=generalProfile(row).UniqueIdentificationNumber;
    return !id||normalizeId(id)===owner;
  });
  const profiles=info.map(generalProfile);
  const statuses=new Set(profiles.map(row=>text(row.TaxpayerStatus).toLowerCase()).filter(Boolean));
  const enforced=new Set(profiles.map(row=>row.IsUnderEnforcement).filter(value=>typeof value==='boolean'));
  const wpState=statuses.size===1?[...statuses][0]:'';
  const enforcement=enforced.size===1?[...enforced][0]:null;
  const active=['active','aktif'].includes(wpState);
  const stateIsKnown=active||['inactive','inaktif','nonaktif','tidak aktif'].includes(wpState);
  const admin=enforcement===true||stateIsKnown&&!active?false:active&&enforcement===false?true:null;
  const address=capture(pkg,'alamat','profil/alamat.json');
  const main=address.rows.filter(row=>row.IsMainAddress===true||row.TypeOfAddress==='MAIN'||row['Jenis TKU']==='Kantor Pusat');
  const current=main.find(row=>dated(row,asOf));
  const bank=capture(pkg,'bank','profil/rekening-bank.json'),pbb=capture(pkg,'pbb','profil/tanah-bangunan.json');
  const banks=[...new Map(bank.rows.flatMap(row=>{
    const number=text(row.BankAccountNumber??row.AccountNumber??row['Nomor Rekening']);
    const name=text(row.BankName??row.BankCode??row['Nama Bank']);
    return number?[[JSON.stringify([name,number]),[name,number,row.source]]]:[];
  })).values()];
  const objects=[...new Map(pbb.rows.flatMap(row=>{
    const id=text(row.TaxObjectNumber??row.NOP);
    return id?[[id,[id,row.TaxObjectName??row['Nama Objek Pajak']??null,row.source]]]:[];
  })).values()];
  const linked=capture(pkg,'pihak','profil/pihak-terkait.json');
  const directors=linked.rows.filter(row=>/^C_LC_DI(?:_|$)|^Direksi$/i.test(String(row.RelatedPersonType??row['Jenis Pihak Terkait']))&&
    Boolean(text(row.PersonName??row['Nama Pihak Terkait']))&&dated(row,asOf));
  const types=new Set(profiles.map(row=>text(row.TaxpayerType).toLowerCase()).filter(Boolean));
  const person=types.size===1&&['ta001','orang pribadi'].some(t=>types.has(t))&&Boolean(owner);
  const activity=activities(pkg,info,asOf),ledger=ledgerEvidence(pkg);
  const recent=activity?(Date.parse(asOf)-Date.parse(activity.day))/dayMs<=180:null;
  const notices=ledger.active.filter(row=>row.AccountingTypeCode==='TaxNotice'||['TaxAssessment','NoticeOfTaxCollection'].includes(row.ReferenceType));
  const [canPay,payNote]=abilityAssessment(ability);
  const factors=[
    ['Status WP dan penagihan',admin,active?(enforcement===null?'WP aktif. Status penagihan belum tersedia.':
      enforcement?'WP aktif dan bertanda dalam penagihan.':'WP aktif dan tidak bertanda dalam penagihan.'):
      stateIsKnown?'WP tercatat tidak aktif.':enforcement===true?'Penanda penagihan aktif tersedia. Status WP belum dapat dipastikan.':
      'Status WP belum dapat dipastikan.',paths(info.map(row=>row.source))],
    ['Alamat utama atau kantor pusat',current?true:address.complete&&!main.length?false:null,
      current?'Alamat tercatat dan berlaku pada tanggal paket.':address.complete&&!main.length?
      'Berkas registrasi tidak mencatat alamat utama atau kantor pusat.':'Alamat yang berlaku belum dapat dipastikan.',current?.source??address.source],
    ['Objek PBB terdaftar',objects.length?true:pbb.complete&&!pbb.rows.length?false:null,
      objects.length?objects.length+' objek memiliki nomor objek pajak.':pbb.complete&&!pbb.rows.length?
      'Berkas registrasi mencatat nol objek PBB.':'Periksa cakupan registrasi objek PBB.',pbb.source],
    ['Rekening bank terdaftar',banks.length?true:bank.complete&&!bank.rows.length?false:null,
      banks.length?banks.length+' rekening tercatat.':bank.complete&&!bank.rows.length?
      'Berkas registrasi mencatat nol rekening.':'Periksa sumber registrasi rekening.',bank.source],
    ['Kewajiban belum lunas',ledger.debts.length?false:ledger.complete?true:null,
      ledger.debts.length?'Ada kewajiban dengan sisa debit pada baris yang dapat diperiksa.':
      ledger.complete?'Sisa debit nol pada periode pilihan paket yang terverifikasi.':ledger.total===0?'Sisa debit pada rincian yang terbaca nol. Cakupan belum terkonfirmasi lengkap.':
      'Rincian buku besar belum cukup untuk menilai sisa kewajiban.',ledger.source],
    ['Aktivitas dalam 180 hari terakhir',recent===true?true:null,
      activity?activity.kind+' terakhir yang terbaca pada '+activity.day+'.'+(recent===false?' Cakupan aktivitas setelah tanggal tersebut belum dapat dipastikan.':''):
      'Tanggal pelaporan dan login belum dapat diperiksa.',activity?.source],
    ['WP atau direksi aktif teridentifikasi',person||directors.length?true:linked.complete&&!linked.rows.length?false:null,
      person?'Identitas WP Orang Pribadi tersedia.':directors.length?directors.length+' baris direksi berlaku pada tanggal paket.':
      'Identitas WP OP atau masa berlaku direksi perlu diperiksa.',person?paths(info.map(row=>row.source)):linked.source],
    ['Kemampuan menutup pokok',canPay,payNote,'L-13 · Tabel 5.3']
  ];
  const positive=factors.filter(r=>r[1]===true).length,known=factors.filter(r=>r[1]!==null).length;
  const category=known===factors.length?(positive>=7?'Tinggi':positive>=5?'Sedang':'Rendah'):'Belum dapat dinilai lengkap';
  const assessment=text(work.analysis?.collectability);
  const rows=[['Faktor','Penilaian'],...factors.map(([name,status])=>[name,label(status)]),
    ['Indikasi dari data paket',category],...(assessment?[['Pertimbangan petugas',assessment]]:[])];
  const sourceRow=r=>[r.ReferenceNumber??r.Referensi,r.PeriodCode,r.RevenueCode,r['Berkas sumber']];
  const detail=[[title],['Tahun analisis',String(year)],['Keadaan menurut paket',asOf||null],['Indikasi dari data paket',category],
    ['Faktor mendukung',positive,'Faktor dapat dinilai',known,'Faktor diperiksa',factors.length],
    ...(assessment?[['Pertimbangan petugas',assessment]]:[]),[],
    ['Faktor','Penilaian','Dasar','Berkas sumber'],...factors.map(([name,status,note,source])=>[name,label(status),note,source]),[],
    ['Angka pembanding pada Tabel 5.3'],['Uraian','Jumlah (Rp)','Berkas sumber atau dasar'],
    ...[['Potensi pokok pajak',ability.principal],['Kas dan setara kas',ability.cash],
      ['Modal kerja',ability.workingCapital],['Perkiraan arus kas operasi',ability.operatingCashflow]]
      .map(([name,item])=>[name,item.value,item.source]),[],
    ['Sisa kewajiban pada rincian yang terbaca (Rp)',ledger.total],['Rujukan','Kode masa','KAP','Berkas sumber','Sisa (Rp)'],
    ...ledger.debts.map(r=>[...sourceRow(r),-r.AmountLeft]),[],
    ['Rekening terdaftar'],['Bank','Nomor rekening','Berkas sumber'],...banks,[],
    ['Objek PBB terdaftar'],['NOP','Nama objek','Berkas sumber'],...objects,[],
    ['Ketetapan dan tagihan pada buku besar'],['Rujukan','Kode masa','KAP','Berkas sumber','Rincian pembukuan'],
    ...notices.map(r=>[...sourceRow(r),ledgerDetailLabels[r.AccountingTypeDetailCode]??ledgerTypeLabels[r.AccountingTypeCode]??r.AccountingTypeCode])];
  return {title,rows,workbook:{name:title,rows:detail}};
}
