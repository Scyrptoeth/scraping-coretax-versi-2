import {inPeriod,rangeIsValid} from '../app-spt-plan.js';
import {fieldValue} from './display-fields.js';
import {reviewStates} from './indication-review.js';
import {receiptFields,submittedDay} from './model.js';
import {filingPeriod,submittedReturnRows} from './profile-filing.js';

const title='L-6 Hasil analisis';
const filingCheck='Tanggal lapor belum tercatat';
const reviews=new Map(reviewStates);

function missingFilingDates(pkg,year){
  const range=pkg.manifest.opsi?.periode,scoped=rangeIsValid(range),rows=[];
  for(const {meta} of submittedReturnRows(pkg)){
    const period=filingPeriod(meta);
    if(period?.year!==Number(year)||submittedDay(meta))continue;
    if(scoped&&!inPeriod({year:period.year,first:period.month||1,last:period.month||12},!period.month,range))continue;
    const type=meta.ReturnSheetTypeCode==='LBT_LBTR'?'SPT PBB':fieldValue('ReturnSheetTypeCode',meta.ReturnSheetTypeCode);
    const label=period.month?year+'-'+String(period.month).padStart(2,'0'):String(year);
    rows.push([type,label,fieldValue('ReturnSheetModel',meta.ReturnSheetModel),receiptFields(meta).BPE??null,meta['Berkas sumber']]);
  }
  return rows;
}

export function kkaAnalysisAppendix(pkg,year,work,checks){
  if(pkg.report?.valid===false)return null;
  const missing=missingFilingDates(pkg,year);
  const checkRows=checks.map(check=>[check.title,check.kind,check.reference,reviews.get(work.indicationReviews?.[check.ruleId])??reviews.get('pending'),
    Number.isFinite(check.basis)?check.basis:null,check.source||'Sumber belum tersedia',check.note,check.evidence,check.law]);
  const groups=new Map();
  for(const row of checkRows)groups.set(row[3],(groups.get(row[3])??0)+1);
  const rows=[['Pemeriksaan','Jumlah','Keterangan']];
  if(missing.length)rows.push([filingCheck,missing.length,'Cocokkan tanggal pada BPE atau bukti penerimaan lain.']);
  for(const [label,count] of groups)rows.push(['Analisis indikatif',count,label]);
  if(rows.length===1)rows.push(['Belum ada hasil yang dapat ditampilkan',null,'Periksa cakupan daftar dan isi SPT pada paket.']);
  const detail=[[title],['Tahun pajak',String(year)],...rows,[],
    ['Analisis indikatif'],['Butir','Jenis pajak','Indeks','Status telaah','Nilai dasar yang terbaca','Sumber',
      'Cara membaca dan batas data','Bukti yang perlu diperiksa','Rujukan']];
  detail.push(...(checkRows.length?checkRows:[['Belum ada analisis indikatif dari sumber yang tersedia.']]));
  if(missing.length)detail.push([],[filingCheck],['Jenis SPT','Masa','Versi','BPE','Berkas daftar'],...missing);
  return {title,rows,workbook:{name:title,rows:detail}};
}
