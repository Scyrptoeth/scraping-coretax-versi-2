import {packageFindingReports} from './finding-report.js';

const principal=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const tuple=f=>JSON.stringify([f.kind,f.period,f.source,f.detail]);
const jsonKey=(...parts)=>JSON.stringify(parts);
const inactive=new Set(['Terjelaskan','Tidak relevan']);
const closedRules=new Set(['explained','inapplicable']);
const taxKind=k=>['PPh 21/26','PPh Pasal 21'].includes(k)?'PPh Pasal 21/26':k;

function anchor(f){
  if(f.ledgerId)return ['ledger',f.period,f.ledgerId];
  if(f.formKey)return ['filing',f.formKey];
  if(f.teamId)return ['work',f.teamId];
  if(f.kkpLine)return ['index',f.kkpLine];
  if(f.invoiceKey)return ['invoice',f.invoiceKey];
  return null;
}
export const kkaLegacyKey=(f,year)=>jsonKey('kka',String(year),...(anchor(f)||['legacy',tuple(f)]));
function lookup(report,columns){
  const table=report.tables.find(t=>columns.every(k=>t.columns.includes(k)));
  return table?.rows.map(r=>Object.fromEntries(table.columns.map((c,i)=>[c,r[i]])))||[];
}
export function kkaPrincipalTotals(rows){
  const sums={pokok:null,saldoTercatat:null,skenario:null,jumlah:null};
  const components={'pokok':'pokok','saldo-tercatat':'saldoTercatat','skenario':'skenario'};
  let priced=0;
  for(const row of rows){
    const amount=principal(row.amount);
    if(amount===null)continue;
    priced++;
    const value=BigInt(amount);
    sums.jumlah=(sums.jumlah??0n)+value;
    const component=components[row.basisClass];
    if(component)sums[component]=(sums[component]??0n)+value;
  }
  const totals=Object.fromEntries(Object.entries(sums).map(([key,value])=>[key,
    value!==null&&value<=BigInt(Number.MAX_SAFE_INTEGER)?Number(value):null]));
  return {...totals,priced,unpriced:rows.length-priced};
}
function totals(all,work){
  const scope=work.scopes?.kka==='verified'?'verified':'all';
  const selected=all.filter(f=>(scope==='all'||f.status==='berbukti')&&!inactive.has(
    f.reviewKeys.map(k=>work.dispositions?.[k]).find(Boolean)));
  return {scope,...kkaPrincipalTotals(selected)};
}

export function kkaPotentials(pkg,year,work={},index={groups:[],byId:new Map()},legacyFacts=[]){
  year=String(year);
  const {tl,ti}=packageFindingReports(pkg,year,work,index),all=[],byKey=new Map(),aliases=new Map(),notes=[];
  function add(f,identity,family,basisClass,value,extra={}){
    const key=jsonKey('kka',year,...identity),old=tuple(f),alias=anchor(f);
    const existing=byKey.get(key)||(alias?aliases.get(jsonKey(...alias)):aliases.get(old));
    if(existing){
      for(const k of [key,old])if(!existing.reviewKeys.includes(k))existing.reviewKeys.push(k);
      return existing;
    }
    const row={kind:taxKind(f.kind),period:f.period,source:f.source,detail:f.detail,status:f.status,
      ...extra,...(f.ruleId?{ruleId:f.ruleId}:{}),...(f.reference?{reference:f.reference}:{}),
      ...(f.ledgerId?{ledgerId:f.ledgerId}:{}),...(f.formKey?{formKey:f.formKey}:{}),
      key,sourceKey:f.sourceKey||jsonKey(family,year,...identity),reviewKeys:[key,old],basisClass,amount:principal(value)};
    byKey.set(key,row);aliases.set(old,row);
    if(alias)aliases.set(jsonKey(...alias),row);
    all.push(row);return row;
  }
  // Only the outstanding principal on a matched obligation is a booked amount.
  // Filing fees, accrued interest and previously issued penalty notices have separate reporting paths.
  for(const f of tl.facts){
    if(f.ledgerId && principal(f.ledgerBalance)!==null){
      add(f,anchor(f),'tl','saldo-tercatat',f.ledgerBalance);
    }else if(f.ruleId){
      add(f,['tl',f.ruleId],'tl','pokok',null);
    }
  }
  const credit=lookup(tl,['Dasar','Tambahan pokok positif (Rp)','Sumber']).find(r=>r.Dasar==='Kredit dan angsuran dengan dasar sejenis');
  const creditAmount=principal(credit?.['Tambahan pokok positif (Rp)']);
  if(creditAmount>0){
    add({kind:'PPh Badan',period:year,status:'berbukti',source:credit.Sumber,
      detail:'Perkiraan tambahan pokok dari kredit dan angsuran yang dapat dipasangkan. Pos lain pada SPT diasumsikan tetap.'},
    ['tl','additional-credit-principal'],'tl','pokok',creditAmount,{reference:'B'});
  }
  const reference=lookup(ti,['Indeks','Pokok pembanding (Rp)','Keterangan']).find(r=>r.Indeks==='N.5');
  const risks=lookup(ti,['Indeks','Uraian','Jenis pajak','Dasar hukum','Cara hitung dan batas data']);
  for(const f of ti.facts){
    const comparison=f.ruleId==='vat-facility'&&reference?principal(reference['Pokok pembanding (Rp)']):null;
    const extra={classification:f.classification,evidence:f.evidence,basis:f.basis,indicationRuleId:f.ruleId};
    const matching=risks.filter(r=>r.Indeks===f.reference && r.Uraian===f.detail && r['Jenis pajak']===f.kind);
    if(matching.length===1){extra.law=matching[0]['Dasar hukum'];extra.calculation=matching[0]['Cara hitung dan batas data'];}
    if(f.ruleId==='related-loan' && principal(f.amount)===null && !work.indicationLoanRate)
      notes.push('Pokok atas piutang afiliasi menunggu isian asumsi tingkat bunga tahunan dan rujukannya pada telaah indikasi.');
    if(comparison!==null && comparison!==principal(f.amount)){
      extra.comparisonAmount=comparison;
      extra.comparisonNote='Pembanding N.5 memakai asumsi efektif 11% untuk faktur yang mencantumkan PPN nol. Tarif dan syarat fasilitas masih perlu diperiksa.';
      notes.push('N.5 memiliki pembanding bersyarat tersendiri. Rekap pokok hanya memakai nilai yang dapat ditelusuri dengan dasar tarif yang tersedia.');
    }
    add(f,['ti',f.ruleId],'ti','skenario',f.amount,extra);
  }
  // The B.7 projection also applies the credit change. Count only its increment
  // over an already included direct credit estimate for the same return.
  const baseline=lookup(ti,['Asumsi dan batas data','Sumber','Pokok skenario (Rp)'])[0];
  if(baseline && principal(baseline['Pokok skenario (Rp)'])>0){
    const ids=['depreciation','entertainment'];
    const reviewed=ids.some(id=>closedRules.has(work.indicationReviews?.[id]))||
      (work.rows||[]).some(r=>r.kkpLine && (/\/account-(5314|5321)$/.test(r.kkpLine)||r.kkpLine.includes('#MainFormData.UnderpaymentIncomeTax')));
    if(reviewed){
      notes.push('Proyeksi gabungan B.7 dan kredit memakai nilai awal. Perhitungan gabungan memerlukan penyesuaian setelah telaah atau pengisian hasil uji.');
    }else{
      const combined=baseline['Pokok skenario (Rp)'],additional=Math.max(0,combined-(creditAmount??0));
      if(additional>0)add({kind:'PPh Badan',period:year,status:'indikatif',source:baseline.Sumber,reference:'B.7',
        detail:'Proyeksi tambahan pokok dari nilai awal B.7 dan perbandingan kredit. '+baseline['Asumsi dan batas data']},
        ['ti','initial-fiscal-credit'],'ti','skenario',additional,{comparisonAmount:combined,
          comparisonNote:creditAmount>0?'Tambahan pokok dari kredit yang sudah tercantum dikurangkan dari proyeksi gabungan.':'Proyeksi memakai asumsi kredit pada SPT dan nilai awal B.7.'});
      if(creditAmount>combined)notes.push('Proyeksi gabungan B.7 dan kredit lebih kecil daripada perkiraan kredit berbukti. Keduanya merupakan perhitungan alternatif untuk saldo yang sama.');
    }
  }
  let filingNotes=false;
  for(const f of legacyFacts){
    if(f.formKey && principal(f.amount)===null){filingNotes=true;continue;}
    const identity=anchor(f)||['legacy',tuple(f)];
    const kind=f.ledgerId?'saldo-tercatat':f.status==='indikatif'?'skenario':'pokok';
    add(f,identity,'legacy',kind,f.ledgerId?null:f.amount);
  }
  // A text-only key from an older workfile can describe multiple independently identified rows.
  const seenKeys=new Set(),sharedKeys=new Set();
  for(const row of all)for(const key of row.reviewKeys){
    if(seenKeys.has(key))sharedKeys.add(key);
    seenKeys.add(key);
  }
  if(sharedKeys.size){
    for(const row of all)row.reviewKeys=row.reviewKeys.filter(key=>!sharedKeys.has(key));
    if([...sharedKeys].some(k=>inactive.has(work.dispositions?.[k])))
      notes.push('Ada penelaahan lama dengan uraian yang sama pada beberapa butir. Periksa kembali keputusan untuk masing-masing butir.');
  }
  if(filingNotes)notes.push('Tanggal pelaporan dan batas setelah penyesuaian kalender atau relaksasi diperiksa pada Temuan langsung. Keterlambatan pelaporan saja tidak menghasilkan pokok pajak.');
  if(all.some(f=>f.basisClass==='saldo-tercatat'))notes.push('Sisa pokok pada buku besar sudah tercatat sebagai kewajiban. Rekap pembanding menampilkan bagiannya secara terpisah.');
  if(all.some(f=>f.basisClass==='skenario'))notes.push('Angka indikatif adalah skenario pokok. Periksa syarat, periode dan bukti tiap butir sebelum memutuskan tindak lanjut.');
  return {all,notes,comparableTotals:totals(all,work)};
}
