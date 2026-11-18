import {fiscalComparisons} from './fiscal-comparisons.js';
export {fiscalComparisons} from './fiscal-comparisons.js';
import {findingFromWorkRow,findingKey,findingsFor,reviewOptions,scopeDefaults,scopeOptions} from './findings.js';
import {installmentComparison} from './temporary-findings-installments.js';
import {companyAssessment} from './assessment-company.js';
import {directCreditFindings} from './direct-finding-credits.js';

const columns = ['Indeks','Jenis pajak','Masa/Tahun','Pos atau objek','Menurut SPT/WP','Pembanding KKP tanpa SPT',
  'Pembanding otomatis','Menurut petugas','Koreksi berbukti','Selisih indikatif','Status','Sumber dan bukti','Keterangan'];
const factsColumns = ['Jenis pajak','Masa/Tahun','Uraian','Potensi pokok (Rp)','Sumber dan bukti'];
const finite = Number.isFinite;
const active = (work, finding) => !work.dispositions?.[findingKey(finding)] || work.dispositions[findingKey(finding)] === reviewOptions[0];
const money = n => new Intl.NumberFormat('id-ID',{maximumFractionDigits:8}).format(n);


// The Studio annual VAT comparison carries untested months at their declared value.
// Show this projection once alongside the tested month, never as a second correction.
function vatAnnualContext(index,byLine,year) {
  const group=index.groups.find(g=>g.key==='PPN/N.3.1');
  const lines=group?.lines??[];
  if(lines.length!==12||!lines.every(l=>!l.partial&&finite(l.amount)&&l.period.startsWith(year+'-')))return '';
  const periods=new Set(lines.map(l=>l.period));
  for(let m=1;m<=12;m++)if(!periods.has(year+'-'+String(m).padStart(2,'0')))return '';
  let declared=0,projected=0,tested=0;
  for(const line of lines) {
    const row=byLine.get(line.id);
    if(row&&(row.menurutWp!==line.amount||!finite(row.menurutPetugas)))return '';
    declared+=line.amount;projected+=row?row.menurutPetugas:line.amount;
    if(row)tested++;
  }
  return tested&&finite(projected)&&finite(declared)?'Jumlah PPN keluaran menurut SPT 12 masa '+money(declared)+'. Proyeksi setelah '+tested+' masa diuji '+money(projected)+'. Masa yang belum diuji memakai nilai SPT.':'';
}

function fiscalSummary(index,lines,year) {
  const group=index.groups.find(g=>g.key==='BADAN/B.7');
  const base=group?.support?.find(r=>r.Uraian==='Jumlah koreksi positif menurut SPT');
  if(!finite(base?.Nilai))return null;
  const differences=lines.filter(r=>r.values[0]==='B.7');
  if(!differences.length||differences.some(r=>!finite(r.values[8]??r.values[9])))return null;
  const projection=differences.reduce((sum,r)=>sum+(r.values[8]??r.values[9]),base.Nilai);
  if(!finite(projection)||projection===base.Nilai)return null;
  return {id:'ringkasan-B.7',values:['B','PPh Badan',year,'Jumlah koreksi fiskal positif dengan rincian B.7',
    base.Nilai,null,projection,null,null,null,'Rekap perbandingan B.7',base.Sumber,
    'Jumlah menurut SPT disesuaikan dengan selisih pada baris B.7 yang ditampilkan. Pos lainnya memakai nilai SPT. Selisih rekap sudah tercakup pada rincian.',projection-base.Nilai]};
}

export function temporaryFindings(pkg,year,work,index,reports) {
  year=String(year);
  const workRows=work.rows??[],byLine=new Map(workRows.filter(r=>r.kkpLine).map(r=>[r.kkpLine,r]));
  const scope=work.scopes?.kkp??scopeDefaults.kkp;
  const automatic=fiscalComparisons(pkg,year,index);
  const installments=installmentComparison(pkg,year,index);
  if(installments)automatic.set(installments.id,installments);
  const counts={tested:0,untested:0,unavailable:0,closed:0};
  const lines=[],seen=new Set(),validReviews=new Map();
  for(const group of index.groups)for(const line of group.lines) {
    if(line.period!==year&&!line.period?.startsWith(year+'-'))continue;
    if(seen.has(line.id)||line.canonicalKey&&line.canonicalKey!==group.key||Object.hasOwn(line,'refundCode'))continue;
    seen.add(line.id);
    const review=byLine.get(line.id),finding=review&&findingFromWorkRow(review,year);
    if(review)counts.tested++;else counts.untested++;
    if(!finite(line.amount)||line.partial)counts.unavailable++;
    if(review&&(['Terjelaskan','Tidak relevan'].includes(review.review)||(finding&&!active(work,finding)))){counts.closed++;continue;}
    if(review)validReviews.set(line.id,review);
    const possible=automatic.get(line.id)??(line.withoutReturn&&finite(line.prefill)&&!line.partial&&line.prefill!==line.amount
      ? {value:line.prefill,source:line.source,note:line.explanation||'Cocokkan pembanding dari paket dengan dokumen.'}:null);
    if(!review&&!possible)continue;
    const comparable=finite(line.amount)&&!line.partial;
    const current=review?comparable&&review.menurutWp===line.amount&&finite(review.menurutPetugas):comparable;
    const delta=review&&current?review.menurutPetugas-line.amount:null;
    if(review&&delta===0)continue;
    const verified=review&&current&&finding?.status==='berbukti'&&Boolean(review.document?.trim());
    const reported=line.withoutReturn?null:line.amount;
    let status='Belum diuji · pembanding otomatis';
    let note=possible?.note||'';
    if(review) {
      status=!current?'Pembanding belum terkonfirmasi':verified?'Koreksi berbukti':'Hasil uji indikatif';
      note=[line.withoutReturn?line.explanation:'',review.kkpNote||review.fakta,!current?'Periksa kelengkapan dan kesesuaian nilai sumber dengan angka saat pengujian.':''].filter(Boolean).join(' ');
    }
    const source=[line.source,review?review.document:possible.source].filter(Boolean);
    lines.push({id:line.id,values:[group.ref,line.tax,line.period,line.topic,reported,line.withoutReturn?line.amount:null,
      !review&&possible?possible.value:null,review?.menurutPetugas??null,verified?delta:null,
      !review&&possible&&current?possible.value-line.amount:review&&current&&!verified?delta:null,status,[...new Set(source)].join(' · '),note]});
  }
  const vat=lines.find(r=>r.values[0]==='N.3.1'&&validReviews.has(r.id));
  if(vat)vat.values[12]=[vat.values[12],vatAnnualContext(index,validReviews,year)].filter(Boolean).join(' ');
  const fiscal=fiscalSummary(index,lines,year);
  if(fiscal)lines.unshift(fiscal);
  if(index.groups.some(g=>g.key==='BADAN/B'&&g.lines.some(l=>l.id?.endsWith('#MainFormData.UnderpaymentIncomeTax')))){
    const projection=companyAssessment(pkg,year,work,index),c=projection?.components;
    if(c&&finite(c.projectedTax)&&c.declaredTax!==c.projectedTax)lines.push({values:['B','PPh Badan',year,
      'Proyeksi PPh terutang melalui B.7',c.declaredTax,null,c.projectedTax,null,null,c.projectedTax-c.declaredTax,'Rekap skenario B.7',
      'Induk SPT · IncomeTaxInAYear dan rincian koreksi fiskal positif',projection.notes[0]]});
    const {scenario}=directCreditFindings(pkg,year);
    if(scenario&&scenario.creditReported!==scenario.creditObserved)lines.push({values:['B','PPh Badan',year,'Kredit pajak dan bukti PPh 22/23 yang teramati',
      scenario.creditReported,null,scenario.creditObserved,null,null,scenario.creditObserved-scenario.creditReported,
      scenario.creditComparable?'Pembanding Lampiran 3':'Skenario kredit pada induk',scenario.source,scenario.assumption]});
  }
  const legacy=findingsFor(pkg,year,workRows.filter(r=>!r.kkpLine));
  const anchor=f=>f.formKey?'form/'+f.formKey:f.ledgerId?'ledger/'+f.ledgerId:null;
  const detailed=[...(reports?.tl.facts||[]),...(reports?.ti.facts||[])];
  const linked=new Set(detailed.map(anchor).filter(Boolean));
  const closed=new Set(legacy.filter(f=>!active(work,f)).map(anchor).filter(Boolean));
  const unmatched=legacy.filter(f=>!linked.has(anchor(f))&&active(work,f));
  // The older filing list uses the original due date even when a holiday or relief applies.
  const needsSourceReview=f=>Boolean(reports?.tl&&f.status==='berbukti'&&anchor(f));
  const observations=unmatched.filter(needsSourceReview);
  const facts=[...detailed.filter(f=>!closed.has(anchor(f))&&active(work,f)),...unmatched.filter(f=>!needsSourceReview(f))];
  function section(title,findings){
    const columns=[...factsColumns],extended=findings.some(f=>f.sanctionAmount!=null||f.interest!=null);
    if(extended)columns.push('Sanksi atau bunga skenario (Rp)');
    return {title,columns,rows:findings.map(f=>[f.kind,f.period,f.detail,finite(f.amount)?f.amount:null,f.source,
      ...(extended?[f.sanctionAmount??f.interest??null]:[])])};
  }
  const direct=section('Temuan berbukti langsung',facts.filter(f=>f.status==='berbukti'));
  const indicative=section('Temuan indikatif',facts.filter(f=>f.status==='indikatif'));
  const comparisonColumns=fiscal?[...columns,'Selisih rekap yang sudah tercakup pada rincian']:columns;
  const tables=[{title:'Perbandingan angka dan hasil uji indeks',columns:comparisonColumns,rows:lines.map(r=>r.values)},direct];
  if(scope==='all')tables.push(indicative);
  if(observations.length)tables.push({title:'Tanggal dan saldo sumber yang perlu dicocokkan',
    columns:['Jenis pajak','Masa/Tahun','Catatan pada sumber','Rujukan'],rows:observations.map(f=>[f.kind,f.period,f.detail,f.source])});
  const summary=[scopeOptions.find(([id])=>id===scope)[1],
    counts.tested+' butir angka diuji, '+counts.untested+' belum diuji. '+counts.unavailable+' butir memiliki sumber sebagian atau angka pembanding yang belum tersedia.',
    'Kolom koreksi berbukti berisi selisih yang didukung hasil uji dan rujukan dokumen. Nilai kosong menandakan angka belum tersedia atau belum ditetapkan.'];
  if(counts.closed)summary.push(counts.closed+' hasil uji telah ditandai terjelaskan atau tidak relevan.');
  return {year,scope,counts,tables,summary};
}

export function temporaryFindingsSheet(pkg,year,work,index,reports) {
  const report=temporaryFindings(pkg,year,work,index,reports),wp=pkg.manifest?.wp||{};
  const rows=[['Daftar temuan sementara'],['Wajib Pajak',wp.nama,wp.npwp],['Tahun pajak',report.year],...report.summary.map(s=>[s])];
  for(const table of report.tables)rows.push([],[table.title],table.columns,...(table.rows.length?table.rows:[['Belum ada butir.']]));
  return {name:'Daftar TS',rows};
}
