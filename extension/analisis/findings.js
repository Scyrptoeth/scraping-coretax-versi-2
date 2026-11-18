import {periodFacts, rowsOf, typeNames, worksheet} from './model.js';
import {differenceCell} from '../archive/table.js';

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
      output.push({...emptyFinding(),status:'berbukti',kind,period:form.period,
        detail:'Tanggal lapor '+form.meta.ReturnDate.slice(0,10)+' melewati tanggal batas '+form.meta.ExpectedReturnDate.slice(0,10)+' pada daftar SPT. Periksa relaksasi dan keadaan WP sebelum mengusulkan tindak lanjut.',
        source:'Daftar SPT · '+form.key});
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
  for (const {number,filings} of invoices.values()) {
    if (filings.size < 2) continue;
    const periods=[...filings.keys()].sort();
    const repeats=periods.slice(1).filter(p=>p.slice(0,4)===year).length;
    if(!repeats)continue;
    const values=new Set([...filings.values()].flatMap(p=>[...p.amounts]));
    output.push({...emptyFinding(),kind:'PPN',period:periods.join(', '),source:periods.map(p=>filings.get(p).source).join(' · '),
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
        status:'berbukti',source:entry.path+' · '+row.RecordId,
        detail:'Buku besar mencatat sisa kewajiban Rp'+new Intl.NumberFormat('id-ID').format(-row.AmountLeft)+
          ' pada referensi '+(row.ReferenceNumber||row.RecordId)+'. Sisa yang telah dibukukan ditampilkan terpisah dari potensi pokok baru.'});
    }
  }
  return output;
}

export function findingKey(finding) {
  return JSON.stringify([finding.kind,finding.period,finding.source,finding.detail]);
}

export function findingsFor(pkg, year, rows) {
  const findings=sourceFindings(pkg,String(year));
  for (const row of rows) {
    if (row.review==='Terjelaskan' || row.review==='Tidak relevan' || row.evidence==='none') continue;
    findings.push({...emptyFinding(),kind:row.tax||'Belum ditentukan',detail:[row.topik,row.fakta,row.simpulan].filter(Boolean).join(' · '),
      source:row.sumber,period:row.kkpLine&&row.kkpPeriod?row.kkpPeriod:String(year),status:row.evidence==='verified' && row.sumber && row.fakta?'berbukti':'indikatif',
      amount:Number.isFinite(row.principal)?row.principal:''});
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

export function workpaper(pkg, year, work, mode, role) {
  const scope=work.scopes?.[mode]||scopeDefaults[mode], all=findingsFor(pkg,year,work.rows);
  const active=all.filter(f=> !work.dispositions?.[findingKey(f)] || work.dispositions[findingKey(f)]===reviewOptions[0]);
  const selected=selectedFindings(active,scope),excluded=active.filter(row=>scope==='verified' && row.status==='indikatif');
  const verified=selected.filter(row=>row.status==='berbukti'), indicative=selected.filter(row=>row.status==='indikatif');
  const title=mode==='kkp'?'Kertas Kerja Pemeriksaan':'Kertas Kerja Analisis';
  const header=['Butir','Sumber','Fakta','Menurut WP','Menurut '+role,'Selisih','Simpulan','Status','Petugas'];
  const rows=work.rows.map(r=>[r.topik,r.sumber,r.fakta,r.menurutWp,r.menurutPetugas,
    Number.isFinite(r.menurutWp)&&Number.isFinite(r.menurutPetugas)?r.menurutPetugas-r.menurutWp:null,r.simpulan,r.status,r.petugas]);
  const summary=potentialSummary(selected), skipped=potentialSummary(excluded);
  const context=[['Isian','Nilai'],['Nama WP',pkg.manifest.wp?.nama],['NPWP',pkg.manifest.wp?.npwp],['Tahun pajak',year],
    ['Peran',role],['Temuan yang dimasukkan',scopeOptions.find(([k])=>k===scope)[1]],['Butir berbukti',verified.length],['Butir indikatif disertakan',indicative.length],
    ['Butir indikatif dikeluarkan',excluded.length],['Pokok terisi dari butir yang dikeluarkan (Rp)',
      skipped.some(x=>x['Pokok terisi (Rp)']!==null)?skipped.reduce((s,x)=>s+(x['Pokok terisi (Rp)']??0),0):null]];
  const principalRows=[['Jenis','Jumlah butir','Pokok terisi (Rp)','Tanpa nominal'],...summary.map(r=>Object.values(r))];
  const table=(title,rows)=>({title,rows});
  const facts=periodFacts(pkg,year);
  const allTables=mode==='kkp' ? [
    table('Identitas dan cakupan',context),table('A. Kolom pemeriksa',[header,...rows]),
    table('B. Temuan berbukti langsung',findingRows(verified)),...(scope==='all'?[table('C. Temuan indikatif',findingRows(indicative))]:[])
  ] : [table('I. Profil WP',context),table('II. Kriteria penentuan WP',[['Keterangan','Isian petugas'],
    ...Object.entries(analysisFields).filter(([key])=>key!=='proposal').map(([key,label])=>[label,work.analysis?.[key]])]),
    table('Tabel 4.1. SPT dua tahun',annualComparison(pkg,year)),
    table('Tabel 5. Potensi per jenis pajak',principalRows),table('Tabel 5.1. Rincian titik potensi',findingRows(selected)),
    table('III. Usulan',[['Keterangan','Isian petugas'],[analysisFields.proposal,work.analysis?.proposal]]),
    ...(scope==='all'?[table('L-9. Temuan indikatif',findingRows(indicative))]:[])];
  if(facts.length)allTables.push(table('SPT per masa',worksheet(facts)));
  const sheets=allTables.map(t=>({name:t.title,rows:t.rows}));
  if(mode==='kkp') {
    sheets[1]={name:'A. Kolom pemeriksa',rows:[header,...rows.map((r,i)=>r.map((v,j)=>j===5?differenceCell(i+2,4,5,v):v))]};
  }
  return {title,selected,excluded,all,summary,tables:allTables,sheets,
    paragraphs:['Tahun pajak '+year,'Lingkup temuan · '+scopeOptions.find(([key])=>key===scope)[1],
      'Potensi memuat nilai pokok yang tersedia. Butir indikatif memerlukan pemeriksaan bukti. Angka kosong menandai nilai yang belum ditentukan.']};
}
