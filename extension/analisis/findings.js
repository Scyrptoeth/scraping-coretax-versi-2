import {periodFacts, rowsOf, sptDay, submittedDay, typeNames, worksheet} from './model.js';
import {differenceCell,numericReference,sheetLink} from '../archive/table.js';
import {kkaFigures} from './kka-figures.js';
import {wireKkaWorkbook} from './kka-workbook.js';
import {kkaManagementSheet} from './kka-management.js';
import {kkaLegacyKey,kkaPotentials,kkaPrincipalTotals} from './kka-potentials.js';
import {buildIndex} from './kkp-index.js';
import {rateSourceLabel} from './rate-updates.js';

export const scopeOptions = [['verified','Berbukti saja'],['all','Berbukti + indikatif']];
export const reviewOptions = ['Dalam pengujian','Terjelaskan','Tidak relevan'];
export const scopeDefaults = {kkp:'verified',kka:'all'};
export const analysisFields = {crm:'Posisi dan variabel risiko CRM',visit:'Hasil kunjungan atau konfirmasi',
  response:'Tanggapan atas imbauan',collectability:'Pertimbangan ketertagihan',proposal:'Usulan dan alasan'};

const emptyFinding = () => ({kind:'',detail:'',period:'',source:'',status:'indikatif',amount:'',
  taxpayer:'',discussed:'',agreed:''});
export {emptyFinding};

function sourceFindings(pkg, year) {
  const output = [], invoices = new Map();
  for (const form of pkg.forms.filter(f => f.year <= year)) {
    const kind = typeNames[form.type] || form.type;
    if (form.year===year && form.late) {
      const fromForm = form.reportSource && !form.reportSource.startsWith('spt/daftar');
      const reported = form.reportDate ?? submittedDay(form.meta);
      const due = form.dueDate ?? sptDay(form.meta?.ExpectedReturnDate);
      output.push({...emptyFinding(),status:'berbukti',kind,period:form.period,formKey:form.key,
        detail:'Tanggal lapor '+reported+' melewati tanggal batas '+due+(fromForm?' pada metadata formulir SPT.':' pada daftar SPT.')+' Periksa relaksasi dan keadaan WP sebelum mengusulkan tindak lanjut.',
        source:fromForm ? form.reportSource : 'Daftar SPT · '+form.key});
    }
    if (form.year===year && form.amended) output.push({...emptyFinding(),kind,period:form.period,source:form.key,
      detail:'Periksa perubahan isian pembetulan '+form.version+' terhadap versi sebelumnya.'});
    if (!form.latest || form.type !== 'PPN') continue;
    const annex = form.parts.get('b2');
    if (annex?.cap?.lengkap !== true) continue;
    for (const row of rowsOf(annex)) {
      if (row.IsCancelled || !row.DocumentNumber || !row.TIN || !/^\d{4}-\d{2}-\d{2}/.test(row.DocumentDate||'') ||
          !Number.isFinite(row.VAT) || row.VAT <= 0) continue;
      const key = JSON.stringify([row.TIN,row.DocumentNumber,row.DocumentDate.slice(0,10)]);
      if (!invoices.has(key)) invoices.set(key, {number:row.DocumentNumber, filings:new Map()});
      const filings=invoices.get(key).filings;
      if(!filings.has(form.period))filings.set(form.period,{source:annex.path, amounts:new Set()});
      filings.get(form.period).amounts.add(row.VAT);
    }
  }
  for (const [invoiceKey,{number,filings}] of invoices) {
    if (filings.size < 2) continue;
    const periods=[...filings.keys()].sort();
    const repeats=periods.slice(1).filter(p=>p.slice(0,4)===year).length;
    if(!repeats)continue;
    const values=new Set([...filings.values()].flatMap(p=>[...p.amounts]));
    output.push({...emptyFinding(),kind:'PPN',invoiceKey,period:periods.join(', '),source:periods.map(p=>filings.get(p).source).join(' · '),
      detail:'Nomor faktur '+number+' dengan pemasok dan tanggal yang sama muncul pada lampiran B2 versi terakhir di beberapa masa. Cocokkan dokumen dan hak pengkreditan.',
      amount:values.size===1 ? [...values][0]*repeats : ''});
  }
  const ledgerRefs = new Set();
  for (const entry of pkg.entries) {
    const period=/^bukubesar\/(\d{4}-\d{2})\.json$/.exec(entry.path)?.[1];
    if(!period || period.slice(0,4)!==year) continue;
    for(const row of rowsOf(entry)) {
      if(row.IsCancelled !== false || row.AccountingTypeCode!=='TaxReturn' || !row.RecordId ||
          !Number.isFinite(row.AmountLeft) || !Number.isFinite(row.Amount) || row.Amount >= 0 || row.AmountLeft >= 0) continue;
      if(ledgerRefs.has(row.RecordId))continue;
      ledgerRefs.add(row.RecordId);
      output.push({...emptyFinding(),kind:String(row.RevenueCode || 'Buku besar'),period,
        status:'berbukti',source:entry.path+' · '+row.RecordId,ledgerId:row.RecordId,
        detail:'Buku besar mencatat sisa kewajiban Rp'+new Intl.NumberFormat('id-ID').format(-row.AmountLeft)+
          ' pada referensi '+(row.ReferenceNumber||row.RecordId)+'. Sisa yang telah dibukukan ditampilkan terpisah dari potensi pokok baru.'});
    }
  }
  return output;
}

export function findingKey(finding) {
  return finding.key ?? JSON.stringify([finding.kind,finding.period,finding.source,finding.detail]);
}

export function findingReview(work,finding,year) {
  const keys=[...(finding.reviewKeys||[findingKey(finding)])];
  if(year&&!finding.reviewKeys)keys.push(kkaLegacyKey(finding,year));
  for(const key of keys){
    if(Object.hasOwn(work.dispositions||{},key))return work.dispositions[key];
  }
  return reviewOptions[0];
}

export function findingFromWorkRow(row, year) {
  if (row.review==='Terjelaskan' || row.review==='Tidak relevan' || row.evidence==='none') return null;
  return {...emptyFinding(),kind:row.tax||'Belum ditentukan',detail:[row.topik,row.fakta,row.simpulan].filter(Boolean).join(' · '),
      ...(row.teamId?{teamId:row.teamId}:{}),...(row.kkpLine?{kkpLine:row.kkpLine}:{}),
      source:row.sumber,period:row.kkpLine&&row.kkpPeriod?row.kkpPeriod:String(year),status:row.evidence==='verified' && row.sumber && row.fakta?'berbukti':'indikatif',
      amount:Number.isFinite(row.principal)?row.principal:''};
}

export function findingsFor(pkg, year, rows) {
  const findings=sourceFindings(pkg,String(year));
  for (const row of rows) {
    const finding=findingFromWorkRow(row,year);
    if(finding)findings.push(finding);
  }
  return findings;
}

export const selectedFindings=(rows,scope)=>scope==='verified'?rows.filter(r=>r.status==='berbukti'):rows.slice();
export const findingRows=rows=>[['Jenis','Periode','Klasifikasi','Rincian','Sumber','Potensi pokok (Rp)'],
  ...rows.map(r=>[r.kind,r.period,r.status,r.detail,r.source,r.amount===''?null:r.amount])];

export function potentialSummary(rows) {
  const groups=new Map();
  for (const row of rows) {
    if(!groups.has(row.kind))groups.set(row.kind,{Jenis:row.kind,'Jumlah butir':0,'Pokok terisi (Rp)':null,'Tanpa nominal':0});
    const group=groups.get(row.kind);
    group['Jumlah butir']++;
    if(Number.isFinite(row.amount))group['Pokok terisi (Rp)']=(group['Pokok terisi (Rp)']??0)+row.amount;
    else group['Tanpa nominal']++;
  }
  return [...groups.values()];
}

function annualComparison(pkg, year) {
  const previous=String(Number(year)-1);
  const oldRows=periodFacts(pkg,previous).filter(r=>r.Periode===previous);
  const newRows=periodFacts(pkg,year).filter(r=>r.Periode===year);
  const types=new Set([...oldRows,...newRows].map(r=>r.Jenis));
  const result=[['SPT','Isian',previous,year,'Perubahan']];
  for(const type of types){
    const old=oldRows.find(r=>r.Jenis===type), current=newRows.find(r=>r.Jenis===type);
    const fields=new Set([...Object.keys(old||{}),...Object.keys(current||{})]);
    for(const key of fields){
      if(['Jenis','Versi','Periode'].includes(key))continue;
      const before=old?.[key]??null,after=current?.[key]??null;
      result.push([type,key,before,after,after!==null&&before!==null?after-before:null]);
    }
  }
  return result;
}

const basisColumns={'pokok':'Pokok hasil uji (Rp)','saldo-tercatat':'Saldo pokok tercatat (Rp)','skenario':'Pokok skenario (Rp)'};
function kkaSummary(rows) {
  const groups=new Map();
  for(const row of rows){
    if(!groups.has(row.kind))groups.set(row.kind,[]);
    groups.get(row.kind).push(row);
  }
  return [...groups].map(([kind,findings])=>{
    const totals=kkaPrincipalTotals(findings);
    return {Jenis:kind,'Jumlah butir':findings.length,'Pokok terisi (Rp)':totals.jumlah,'Tanpa nominal':totals.unpriced,
      [basisColumns.pokok]:totals.pokok,[basisColumns['saldo-tercatat']]:totals.saldoTercatat,[basisColumns.skenario]:totals.skenario};
  });
}
function kkaFindingRows(rows) {
  return [['Jenis','Periode','Klasifikasi','Dasar nominal','Indeks','Rincian','Sumber','Pokok dalam lingkup (Rp)'],
    ...rows.map(r=>[r.kind,r.period,r.status,basisColumns[r.basisClass]?.replace(' (Rp)',''),r.reference,r.detail,r.source,Number.isFinite(r.amount)?r.amount:null])];
}
function evidenceRows(rows) {
  return [['Jenis','Indeks','Periode','Uraian','Dasar nominal','DPP / dasar','Pokok dalam lingkup (Rp)','Sumber','Bukti yang perlu diuji','Dasar hukum','Cara hitung dan batas data','Pembanding terpisah (Rp)','Asumsi pembanding'],
    ...rows.map(r=>[r.kind,r.reference,r.period,r.detail,basisColumns[r.basisClass]?.replace(' (Rp)',''),r.basis,r.amount,r.source,r.evidence,r.law,r.calculation,r.comparisonAmount,r.comparisonNote])];
}

export function workpaper(pkg, year, work, mode, role, index) {
  const scope=work.scopes?.[mode]||scopeDefaults[mode], legacy=findingsFor(pkg,year,work.rows);
  const potentials=mode==='kka'?kkaPotentials(pkg,year,work,index??buildIndex(pkg,year),legacy):null;
  const all=potentials?potentials.all.map(f=>f.amount===null?{...f,amount:''}:f):legacy;
  const active=all.filter(f=>findingReview(work,f,year)===reviewOptions[0]);
  const selected=selectedFindings(active,scope),excluded=active.filter(row=>scope==='verified' && row.status==='indikatif');
  const verified=selected.filter(row=>row.status==='berbukti'), indicative=selected.filter(row=>row.status==='indikatif');
  const title=mode==='kkp'?'Kertas Kerja Pemeriksaan':'Kertas Kerja Analisis';
  const header=['Butir','Sumber','Fakta','Menurut WP','Menurut '+role,'Selisih','Simpulan','Status','Petugas'];
  const rows=work.rows.map(r=>[r.topik,r.sumber,r.fakta,r.menurutWp,r.menurutPetugas,
    Number.isFinite(r.menurutWp)&&Number.isFinite(r.menurutPetugas)?r.menurutPetugas-r.menurutWp:null,r.simpulan,r.status,r.petugas]);
  const summary=potentials?kkaSummary(selected):potentialSummary(selected), skipped=potentialSummary(excluded);
  const excludedPrincipal=potentials?kkaPrincipalTotals(excluded).jumlah:
    (skipped.some(x=>x['Pokok terisi (Rp)']!==null)?skipped.reduce((s,x)=>s+(x['Pokok terisi (Rp)']??0),0):null);
  const context=[['Isian','Nilai'],['Nama WP',pkg.manifest.wp?.nama],['NPWP',pkg.manifest.wp?.npwp],['Tahun pajak',year],
    ['Peran',role],['Temuan yang dimasukkan',scopeOptions.find(([k])=>k===scope)[1]],['Butir berbukti',verified.length],['Butir indikatif disertakan',indicative.length],
    ['Butir indikatif dikeluarkan',excluded.length],['Pokok terisi dari butir yang dikeluarkan (Rp)',excludedPrincipal]];
  const columns=['Jenis','Jumlah butir','Pokok terisi (Rp)','Tanpa nominal',...Object.values(basisColumns)];
  const principalRows=[columns,...summary.map(r=>columns.map(col=>r[col]))];
  context.push(['Pilihan tarif bunga sesi',rateSourceLabel()]);
  const table=(title,rows)=>({title,rows});
  const facts=periodFacts(pkg,year);
  const totals=potentials?.comparableTotals,principal=totals?.jumlah??null;
  const figures=mode==='kka'?kkaFigures(pkg,year,{principal}):null;
  const destinations=new Map();
  function linkedTable(t,sheet,targetName){
    const row=sheet.rows.findIndex(r=>r[0]===t.title)+1;
    (sheet.targets??=[]).push({name:targetName,row});
    destinations.set(targetName,{sheet,row});
    return {...t,workbookTarget:targetName};
  }
  let recap;
  if(figures){
    const coverage='Untuk mengukur kemampuan membayar, Tabel 5.3 memakai jumlah pokok dalam lingkup Tabel 5. '+totals.priced+' dari '+selected.length+' butir mempunyai nominal. Kolom Tabel 5 merinci pokok hasil uji, saldo yang sudah tercatat, dan skenario yang masih perlu diuji.';
    if(summary.length)principalRows.push(['Jumlah',selected.length,principal,totals.unpriced,totals.pokok,totals.saldoTercatat,totals.skenario]);
    figures.notes.push(coverage,...potentials.notes);figures.sheet.rows.push([coverage],...potentials.notes.map(n=>[n]));
  }
  const figureTable=key=>linkedTable(figures.tables.find(t=>t.key===key),figures.sheet,'KKA_L13_'+key.replace('.','_'));
  const summaryTable=table('Tabel 5. Potensi per jenis pajak',principalRows);
  const detailTable=table('Tabel 5.1. Rincian titik potensi',kkaFindingRows(selected));
  if(figures)recap={name:'L-7 Rekap potensi',rows:[[summaryTable.title],...summaryTable.rows,[],[detailTable.title],...detailTable.rows,[],...potentials.notes.map(n=>[n])]};
  const allTables=mode==='kkp' ? [
    table('Identitas dan cakupan',context),table('A. Kolom pemeriksa',[header,...rows]),
    table('B. Temuan berbukti langsung',findingRows(verified)),...(scope==='all'?[table('C. Temuan indikatif',findingRows(indicative))]:[])
  ] : [table('I. Profil WP',context),table('II. Kriteria penentuan WP',[['Keterangan','Isian petugas'],
    ...Object.entries(analysisFields).filter(([key])=>key!=='proposal').map(([key,label])=>[label,work.analysis?.[key]])]),
    figureTable('4.1'),figureTable('4.2'),
    linkedTable(summaryTable,recap,'KKA_L7_5'),linkedTable(detailTable,recap,'KKA_L7_5_1'),
    figureTable('5.3'),table('III. Usulan',[['Keterangan','Isian petugas'],[analysisFields.proposal,work.analysis?.proposal]]),
    ...(scope==='all'?[table('L-9. Temuan indikatif',findingRows(indicative))]:[])];
  if(facts.length)allTables.push(table('SPT per masa',worksheet(facts)));
  const sheets=allTables.map(t=>{
    if(t.title==='L-9. Temuan indikatif')return {name:t.title,rows:evidenceRows(indicative)};
    if(!t.workbookTarget)return {name:t.title,rows:t.rows};
    const {sheet,row}=destinations.get(t.workbookTarget);
    const numericColumns={KKA_L7_5:[1,2,3,4,5,6],KKA_L7_5_1:[7],KKA_L13_4_1:[1,2,3,4],KKA_L13_4_2:[2,3],KKA_L13_5_3:[1]};
    const rows=t.rows.map((r,i)=>r.map((v,j)=>i>0&&numericColumns[t.workbookTarget].includes(j)?
      numericReference(sheet,row+i+1,j+1,v):v));
    rows.push([],[sheetLink(sheet,'Buka rincian '+sheet.name.split(' ')[0],row)]);
    return {name:t.title,rows};
  });
  if(figures){
    wireKkaWorkbook(recap,figures.sheet,summary.length,selected.length);
    const management=kkaManagementSheet(pkg);
    if(management)sheets.splice(1,0,management);
    sheets.push(recap,{name:'L-8 Temuan langsung',rows:evidenceRows(verified)},figures.sheet);
    const previous=annualComparison(pkg,year);
    if(previous.length>1)sheets.push({name:'Isian induk SPT dua tahun',rows:previous});
  }
  if(mode==='kkp') {
    sheets[1]={name:'A. Kolom pemeriksa',rows:[header,...rows.map((r,i)=>r.map((v,j)=>j===5?differenceCell(i+2,4,5,v):v))]};
  }
  return {title,selected,excluded,excludedPrincipal,all,summary,tables:allTables,sheets,figures,
    paragraphs:['Tahun pajak '+year,'Lingkup temuan · '+scopeOptions.find(([key])=>key===scope)[1],
      'Potensi memuat nilai pokok yang tersedia. Butir indikatif memerlukan pemeriksaan bukti. Angka kosong menandai nilai yang belum ditentukan.',
      ...(figures?.notes||[])]};
}
