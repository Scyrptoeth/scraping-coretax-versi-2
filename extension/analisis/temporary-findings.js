import {checkedCompanyEntry,checkedCompanyTable} from './kkp-company-annexes.js';
import {findingFromWorkRow,findingKey,findingsFor,reviewOptions,scopeDefaults,scopeOptions} from './findings.js';
import {sourceAmount} from './withholding-forms.js';
import {installmentComparison} from './temporary-findings-installments.js';

const columns = ['Indeks','Jenis pajak','Masa/Tahun','Pos atau objek','Menurut SPT/WP','Pembanding KKP tanpa SPT',
  'Pembanding otomatis','Menurut petugas','Koreksi berbukti','Selisih indikatif','Status','Sumber dan bukti','Keterangan'];
const factsColumns = ['Jenis pajak','Masa/Tahun','Uraian','Potensi pokok (Rp)','Sumber dan bukti'];
const fiscalParts = ['l9-1-1','l9-1-2','l9-1-3','l9-1-4','l9-1-5','l9-2-1','l9-2-2','l9-3-1','l9-3-2','l9-3-3','l9-3-4','l9-3-5'];
const finite = Number.isFinite;
const active = (work, finding) => !work.dispositions?.[findingKey(finding)] || work.dispositions[findingKey(finding)] === reviewOptions[0];
const money = n => new Intl.NumberFormat('id-ID',{maximumFractionDigits:8}).format(n);

export function fiscalComparisons(pkg,year,index) {
  const output=new Map();
  const group=index.groups.find(g=>g.key==='BADAN/B.7');
  const parents=pkg.forms.filter(f=>f.type==='BADAN'&&f.period===year);
  if(!group||!parents.length)return output;
  const last=Math.max(...parents.map(f=>f.version)),forms=parents.filter(f=>f.version===last);
  if(forms.length!==1||!checkedCompanyEntry(pkg,forms[0],'induk'))return output;
  const form=forms[0];
  const control=index.groups.find(g=>g.key==='BADAN/B')?.support?.find(r=>r.Kode==='A4020');
  if(!control||control.Satuan==='Bertentangan atau tidak dikenali')return output;
  function account(code) {
    const line=group.lines.find(l=>l.id.endsWith('/account-'+code));
    const cost=group.support.find(s=>s.Uraian==='Biaya komersial · '+code);
    return line && !line.partial && finite(line.amount) && finite(cost?.Nilai) && cost.Nilai>=0 ? {line,cost} : null;
  }
  // Only compare like-for-like annual inputs. Missing, filtered or ambiguous schedules cannot establish a zero.
  const depreciation=account('5314');
  if(depreciation&&!Array.from(form.parts.keys()).some(k=>/^l9-\d/.test(k)&&!fiscalParts.includes(k))) {
    const tables=fiscalParts.map(part=>checkedCompanyTable(pkg,form,part));
    if(tables.every(Array.isArray)) {
      const values=tables.flat().map(r=>sourceAmount(r?.FiscalYearValue));
      if(values.every(v=>finite(v)&&v>=0)) {
        const {line,cost}=depreciation;
        const value=Math.max(0,cost.Nilai-values.reduce((sum,n)=>sum+n,0));
        if(finite(value)&&value!==line.amount)output.set(line.id,{value,
          source:[cost.Sumber,...fiscalParts.map(k=>form.parts.get(k).path)].join(' · '),
          note:'Biaya penyusutan dan amortisasi pada L1 dikurangi jumlah nilai fiskal tahun berjalan pada rincian L9, dibatasi paling rendah nol. Cocokkan aset, masa manfaat, dan metode dengan bukti.'});
      }
    }
  }
  const entertainment=account('5321'),list=checkedCompanyTable(pkg,form,'l11a-2');
  if(entertainment&&list?.length===0) {
    const {line,cost}=entertainment;
    if(cost.Nilai!==line.amount)output.set(line.id,{value:cost.Nilai,
      source:cost.Sumber+' · '+form.parts.get('l11a-2').path,
      note:'Daftar nominatif L11A tabel 2 yang lengkap pada paket berisi nol baris. Biaya jamuan menjadi pembanding awal. Periksa rincian biaya, tujuan usaha, dan bukti pendukung.'});
  }
  return output;
}

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
    'Jumlah menurut SPT disesuaikan dengan selisih pada baris B.7 yang ditampilkan. Pos lainnya memakai nilai SPT. Selisih dicatat satu kali pada rincian.']};
}

export function temporaryFindings(pkg,year,work,index) {
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
  const facts=findingsFor(pkg,year,workRows.filter(r=>!r.kkpLine)).filter(f=>active(work,f));
  const section=(title,findings)=>({title,columns:factsColumns,rows:findings.map(f=>[f.kind,f.period,f.detail,finite(f.amount)?f.amount:null,f.source])});
  const direct=section('Temuan berbukti langsung',facts.filter(f=>f.status==='berbukti'));
  const indicative=section('Temuan indikatif',facts.filter(f=>f.status==='indikatif'));
  const tables=[{title:'Perbandingan angka dan hasil uji indeks',columns,rows:lines.map(r=>r.values)},direct];
  if(scope==='all')tables.push(indicative);
  const summary=[scopeOptions.find(([id])=>id===scope)[1],
    counts.tested+' butir angka diuji, '+counts.untested+' belum diuji. '+counts.unavailable+' butir memiliki sumber sebagian atau angka pembanding yang belum tersedia.',
    'Kolom koreksi berbukti berisi selisih yang didukung hasil uji dan rujukan dokumen. Nilai kosong menandakan angka belum tersedia atau belum ditetapkan.'];
  if(counts.closed)summary.push(counts.closed+' hasil uji telah ditandai terjelaskan atau tidak relevan.');
  return {year,scope,counts,tables,summary};
}

export function temporaryFindingsSheet(pkg,year,work,index) {
  const report=temporaryFindings(pkg,year,work,index),wp=pkg.manifest?.wp||{};
  const rows=[['Daftar temuan sementara'],['Wajib Pajak',wp.nama,wp.npwp],['Tahun pajak',report.year],...report.summary.map(s=>[s])];
  for(const table of report.tables)rows.push([],[table.title],table.columns,...(table.rows.length?table.rows:[['Belum ada butir.']]));
  return {name:'Daftar TS',rows};
}
