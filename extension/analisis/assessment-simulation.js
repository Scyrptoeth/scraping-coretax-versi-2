import {monthlyAmounts} from './annual-vat.js';
import {companyAssessment} from './assessment-company.js';
import {companyCreditScenario} from './company-credit-scenario.js';
import {findingFromWorkRow,findingKey} from './findings.js';
import {rowsOf,sptDay,worksheet} from './model.js';
import {listedReturns,revisionProblem,sourceProblem,usesOtherCurrency} from './return-source.js';
import {simulate} from './sanksi.js';
import {normalizeId} from '../app-data.js';

const outputIndex='PPN/N.3.1';
const inputIndices=new Set(['PPN/N.8.1','PPN/N.10']);
const positive=n=>Math.max(0,n);
function activeReviews(work,year){
  return (work.rows||[]).filter(r=>{
    if(!r.kkpLine||r.review==='Terjelaskan'||r.review==='Tidak relevan'||!Number.isFinite(r.menurutPetugas))return false;
    const finding=findingFromWorkRow(r,year),status=finding&&work.dispositions?.[findingKey(finding)];
    return !status||status==='Dalam pengujian';
  });
}
const sourceValue=(body,key)=>Number.isFinite(body[key]?.VAT)?body[key].VAT:null;
const clause='Perkiraan berdasarkan hasil uji. Periksa dasar penerapan sanksi dan bukti kompensasi sebelum menetapkan pajak.';

function taxImpact(tax,period,principal,carry,end){
  if(principal<=0)return {interest:0,increase:0,sanction:0,total:0,months:0,rate:null,note:''};
  if(!Number.isSafeInteger(principal)||!Number.isSafeInteger(carry))
    return {note:'Periksa pembulatan dan satuan pokok sebelum menghitung sanksi.'};
  if(!period)return {note:'Akhir tahun buku belum dapat dipastikan dari induk. Periksa periode sebelum menghitung bunga.'};
  if(!end || end.slice(0,7)<=period)
    return {note:'Isi tanggal rencana setelah akhir masa untuk menghitung sanksi.'};
  const ordinary=principal-carry;
  const checked=simulate({tax,period,article:'interest',principal:String(ordinary),transfers:[],basis:'Lembar uji'},end);
  if(checked.reason&&(!checked.reason.startsWith('Tarif resmi')||ordinary>0))return {note:checked.reason};
  // Whole-rupiah estimates mirror the displayed assessment. Compare both penalties
  // per tax period when they apply together, as in the manual simulation.
  const interest=ordinary?Number(checked.interest/10000n):0;
  const increase=Number(BigInt(carry)*75n/100n),sanction=Math.max(increase,interest);
  return {interest,increase,sanction,total:principal+sanction,months:ordinary?checked.months:0,
    rate:ordinary?checked.rate.basisPoints/100:null,note:checked.rate&&ordinary?'Tarif '+checked.rate.decision:''};
}

function vatMonth(pkg,period,versions,listed,adjustments){
  const base={period,source:'',notes:[],changes:[],valid:false};
  if(!versions.length)return {...base,notes:['Daftar memuat masa ini, tetapi induk SPT belum ada di paket.']};
  const latest=Math.max(...versions.map(f=>f.version)),same=versions.filter(f=>f.version===latest);
  if(same.length!==1)return {...base,notes:['Ada dua rekaman dengan nomor pembetulan terakhir yang sama.']};
  const form=same[0],entry=form.parts.get('induk');
  base.source=entry?.path||form.key;base.version=latest;
  const reason=revisionProblem(listed,versions,form)||sourceProblem(pkg,form,'induk',entry);
  if(reason)return {...base,notes:[reason]};
  const payload=rowsOf(entry),body=payload.length===1?payload[0]:null;
  if(!body)return {...base,notes:['Induk tidak berisi satu rekaman yang dapat dipasangkan.']};
  const owner=normalizeId(pkg.manifest.wp?.npwp);
  const envelope=entry.pages[0].Payload??entry.pages[0],code=period.slice(5).repeat(2)+period.slice(0,4);
  if(envelope.IsFound===false||[envelope.TIN,body.TIN,body.MainFormData?.TIN].filter(Boolean).some(v=>normalizeId(v)!==owner)||
    [envelope.PeriodCode,body.PeriodCode,body.TaxPeriodCode].filter(Boolean).some(v=>![code,period].includes(String(v))))
    return {...base,notes:['Identitas dalam induk berbeda dari WP pada paket.']};
  if(usesOtherCurrency(form.meta,entry.cap,entry.cap.konteks,envelope,body,body.MainFormData))
    return {...base,notes:['Periksa mata uang induk sebelum memakai simulasi rupiah.']};
  const notes=[],recap=monthlyAmounts(body,period,notes);
  const pk=recap['PPN dipungut sendiri (PK)'],primaryPk=sourceValue(body,'OutputTaxMustBeSelfCollected');
  const total=sourceValue(body,'InputTaxCanBeCalculated'),carry=sourceValue(body,'CarryForwardOfInputTax');
  const declared=sourceValue(body,'VATUnderOrOverPaid'),deposit=sourceValue(body,'VATIsDepositedInAdvance');
  let pm=null;
  if(total!==null&&carry!==null) {
    if(deposit!==null)pm=total-carry+deposit;
    else if(!Object.hasOwn(body,'VATIsDepositedInAdvance')&&pk!==null&&declared===pk-total){
      pm=total-carry;base.notes.push('Setoran dimuka tidak dicantumkan. Jumlah PK dikurangi pajak masukan cocok dengan saldo yang dilaporkan.');
    }
  }
  Object.assign(base,{pk,primaryPk,pm,carry,declared,deposit});
  if(notes.length)base.notes.push('PK rekap menggunakan subtotal penyerahan terutang. Periksa PK pada isian utama induk.');
  if(![pk,pm,carry,declared].every(Number.isFinite)||carry<0){
    base.notes.push('Isian PK, PM, kompensasi, setoran dimuka atau saldo SPT belum dapat dicocokkan.');return base;
  }
  let deltaPk=0,deltaPm=0;
  for(const {line,review} of adjustments){
    const part=line.groupKey===outputIndex?'induk':line.groupKey==='PPN/N.10'?'b2':'b1';
    const issue=sourceProblem(pkg,form,part,form.parts.get(part));
    if(issue||line.partial||!Number.isFinite(line.amount)||line.version!==latest||review.menurutWp!==line.amount){
      base.notes.push('Periksa sumber perubahan pada '+line.ref+'. '+issue);return base;
    }
    const delta=review.menurutPetugas-line.amount;
    if(part==='induk'&&delta!==0&&line.amount!==pk){
      base.notes.push('Nilai PK pada lembar uji berbeda dari dasar PK rekap. Cocokkan kedua isian sebelum menerapkan koreksi.');return base;
    }
    if(line.groupKey===outputIndex)deltaPk+=delta;else deltaPm+=delta;
    if(delta!==0)base.changes.push(line.ref+' · '+line.source+' · '+review.document);
  }
  return {...base,valid:true,deltaPk,deltaPm};
}

// A full transfer can continue at the revised amount. A partial transfer is
// limited to the amount actually claimed by the next observed monthly return.
function transfer(balance,claimed,full){
  const excess=positive(-balance);
  return full?excess:Math.min(excess,claimed);
}
export function vatCascade(pkg,year,work,index){
  const versions=new Map(),adjustments=new Map(),listed=listedReturns(pkg,year,'VAT_VATR');
  for(const form of pkg.forms.filter(f=>f.type==='PPN'&&f.year===year)){
    if(!versions.has(form.period))versions.set(form.period,[]);
    versions.get(form.period).push(form);
  }
  for(const review of activeReviews(work,year)){
    const line=index.byId.get(review.kkpLine);
    if(!line||line.groupKey!==outputIndex&&!inputIndices.has(line.groupKey))continue;
    if(!adjustments.has(line.period))adjustments.set(line.period,[]);
    adjustments.get(line.period).push({line,review});
  }
  const observed=Array.from({length:12},(_,i)=>{
    const p=year+'-'+String(i+1).padStart(2,'0');
    return versions.has(p)||listed.has(p)?vatMonth(pkg,p,versions.get(p)||[],listed.get(p)||[],adjustments.get(p)||[]):null;
  });
  let baselineCarry=null,revisedCarry=null,lostFullTransfer=0;
  for(const [i,r] of observed.entries()){
    if(!r?.valid){baselineCarry=null;revisedCarry=null;lostFullTransfer=0;continue;}
    r.baselineCarry=baselineCarry??r.carry;r.revisedCarry=revisedCarry??r.carry;
    r.reviewPk=r.pk+r.deltaPk;r.reviewPm=r.pm+r.deltaPm;
    r.baseline=r.pk-r.pm-r.baselineCarry;r.revised=r.reviewPk-r.reviewPm-r.revisedCarry;
    r.delta=positive(r.revised)-positive(r.baseline);
    r.increaseBase=Math.min(positive(r.delta),lostFullTransfer);
    r.impact=taxImpact('PPN',r.period,r.delta,r.increaseBase,work.simulation?.end||'');
    if(r.baseline!==r.declared)r.notes.push('Saldo hasil rekonstruksi berbeda dari saldo SPT. Dampak koreksi dihitung terhadap rekonstruksi sebelum perubahan.');
    if(i>0&&!observed[i-1]?.valid)r.notes.push('Rangkaian sebelumnya terputus. Kompensasi awal memakai nilai pada SPT masa ini.');
    const next=observed[i+1];
    if(!next?.valid){baselineCarry=null;revisedCarry=null;lostFullTransfer=0;continue;}
    const matched=r.declared<0&&next.carry>0&&Math.abs(next.carry+r.declared)<=1;
    baselineCarry=transfer(r.baseline,next.carry,matched);revisedCarry=transfer(r.revised,next.carry,matched);
    lostFullTransfer=matched?positive(baselineCarry-revisedCarry):0;
    if(!matched&&next.carry>0&&r.deltaPm!==r.deltaPk)r.notes.push('Kompensasi ke masa berikut tidak cocok penuh dengan LB yang dilaporkan. Verifikasi alokasinya sebelum mengusulkan kenaikan.');
  }
  return observed.filter(Boolean);
}

export function vatCascadeRows(cascade){
  return cascade.map(r=>({Masa:r.period,'PK SPT':r.pk,'PK setelah uji':r.reviewPk,'PM masa ini dan setoran dimuka':r.pm,
    'PM setelah uji':r.reviewPm,'Kompensasi SPT':r.carry,'Kompensasi setelah uji':r.revisedCarry,'KB/(LB) SPT':r.declared,
    'KB/(LB) setelah uji':r.revised,'Perubahan pokok':r.delta,'Dasar kenaikan':r.increaseBase,'Kenaikan 75%':r.impact?.increase,
    'Bunga Pasal 13(2)':r.impact?.interest,'Bulan bunga':r.impact?.months,'Tarif (% per bulan)':r.impact?.rate,
    'Sanksi terpilih':r.impact?.sanction,'PK pada isian utama':r.primaryPk,'Saldo rekonstruksi sebelum uji':r.baseline,
    Pembetulan:r.version,Sumber:r.source,'Isian uji':r.changes.join('\n'),Keterangan:[...r.notes,r.impact?.note].filter(Boolean).join(' ')}));
}
const withholdingRefs=new Set(['C.2.2','E.2.2','G.2.2','K.2.2']);
const companyFields=[
  ['baseCorrection','Koreksi fiskal positif pada SPT','Induk SPT dan B.7'],
  ['projectedCorrection','Proyeksi koreksi fiskal positif','B.7 · dua pembanding biaya'],
  ['declaredTax','PPh terutang pada SPT','Induk SPT'],
  ['projectedTax','Proyeksi PPh terutang jika asumsi pada catatan terpenuhi','B.7 dan induk SPT'],
  ['observedInstallments','Setoran angsuran yang tercatat','Buku besar PPh 25'],
  ['observedWithholding','Potongan PPh dalam negeri yang tercatat','Bukti potong diterima'],
  ['overseasField','Kredit pajak yang tercantum pada induk','Induk SPT · TotalIncomeTaxOverseas']
];
function annualBasis(pkg,line,group){
  if(line.withoutReturn)return {period:null,issue:''};
  const type=group.key.split('/')[0],versions=pkg.forms.filter(f=>f.type===type&&f.period===line.period);
  const latest=Math.max(...versions.map(f=>f.version)),same=versions.filter(f=>f.version===latest);
  const form=same.length===1?same[0]:null;
  if(!form||latest!==line.version||form.parts.get('induk')?.path!==line.id.split('#')[0])return {issue:'Pembetulan SPT yang diuji belum dapat dipastikan.'};
  const entry=form.parts.get('induk'),rows=rowsOf(entry);
  const list=listedReturns(pkg,line.period,type==='BADAN'?'ICT_RCITR':'ICT_PITR');
  const issue=revisionProblem(list.get(line.period)||[],versions,form)||sourceProblem(pkg,form,'induk',entry);
  if(issue||rows.length!==1)return {issue:issue||'Induk SPT tunggal belum tersedia.'};
  const env=entry.pages[0].Payload??entry.pages[0],owner=normalizeId(pkg.manifest.wp?.npwp);
  const data=rows[0].MainFormData||rows[0],end=sptDay(data.AccountingPeriodEnd);
  if(env.IsFound===false||[env.TIN,rows[0].TIN,data.TIN].filter(Boolean).some(v=>normalizeId(v)!==owner)||
    usesOtherCurrency(form.meta,entry.cap,entry.cap.konteks,env,rows[0],data))return {issue:'Identitas atau mata uang induk belum dapat dicocokkan.'};
  if(end)return {period:end.slice(0,7)};
  const codes=[entry.cap.konteks?.spt?.masa,form.meta?.TaxPeriodCode,rows[0].TaxPeriodCode].filter(Boolean).map(String);
  if(codes.length&&codes.every(v=>v==='0112'+line.period)&&
    (data.AccountingPeriodStart==null||Number(data.AccountingPeriodStart)===1)&&
    (data.AccountingPeriodEnd==null||Number(data.AccountingPeriodEnd)===12))return {period:line.period+'-12'};
  return {period:null};
}
export function assessmentOutput(pkg,year,work,index){
  const cascade=vatCascade(pkg,year,work,index),lines=[];
  if(cascade.length){
    const complete=cascade.every(r=>r.valid),totals=cascade.every(r=>Number.isFinite(r.impact?.total));
    const sum=fn=>cascade.reduce((n,r)=>n+fn(r),0);
    lines.push({'Jenis pajak':'PPN',Indeks:'N',Masa:year,Pokok:complete?sum(r=>positive(r.delta)):null,
      'Kenaikan 75%':totals?sum(r=>r.impact.increase):null,Bunga:totals?sum(r=>r.impact.interest):null,
      'Sanksi terpilih':totals?sum(r=>r.impact.sanction):null,Jumlah:totals?sum(r=>r.impact.total):null,
      Keterangan:cascade.filter(r=>r.valid).length+' dari '+cascade.length+' masa dalam paket dapat dihitung. Lihat sumber dan sanksi per masa.'});
  }
  const other=new Map(),reviews=new Map(activeReviews(work,year).map(r=>[r.kkpLine,r]));
  for(const g of index.groups){
    const annual=['BADAN/B','OP/B'].includes(g.key);
    if(!annual&&!withholdingRefs.has(g.ref))continue;
    for(const l of g.lines){
      if(annual&&!(l.id.endsWith('#MainFormData.UnderpaymentIncomeTax')||l.id.endsWith('#UnderOrOverPaymentTax')||l.withoutReturn&&l.id.endsWith('/balance')))continue;
      const review=reviews.get(l.id);
      if(!review)continue;
      const tax=g.ref==='C.2.2'?(l.id.endsWith('#A26IncomeTaxWithheld')?'PPh Pasal 26':'PPh Pasal 21'):g.tax;
      const key=g.key+'|'+tax+'|'+l.period;
      if(!other.has(key)){
        const basis=annual?annualBasis(pkg,l,g):{period:l.period};
        other.set(key,{tax,ref:g.ref,period:l.period,endPeriod:basis.period,delta:0,notes:basis.issue?[basis.issue]:[],known:!basis.issue});
      }
      const agg=other.get(key);
      if(!Number.isFinite(l.amount)||review.menurutWp!==l.amount||l.partial&&!l.withoutReturn){agg.known=false;agg.notes.push('Nilai atau cakupan sumber perlu diperiksa.');continue;}
      // Annual net and separate monthly withholding lines have different tax bases.
      agg.delta+=annual?positive(review.menurutPetugas)-positive(l.amount):review.menurutPetugas-l.amount;
      agg.notes.push(l.source+' · '+review.document+' · '+(review.evidence==='verified'?'Hasil uji berbukti':'Hasil uji sementara'));
    }
  }
  for(const r of other.values()){
    const impact=r.known?taxImpact(r.tax,r.endPeriod,r.delta,0,work.simulation?.end||''):{};
    lines.push({'Jenis pajak':r.tax,Indeks:r.ref,Masa:r.period,Pokok:r.known?positive(r.delta):null,'Kenaikan 75%':null,
      Bunga:impact.interest,'Sanksi terpilih':impact.sanction,Jumlah:impact.total,Keterangan:[...r.notes,impact.note].filter(Boolean).join(' · ')});
  }
  const comparison=[];
  if(!lines.some(r=>r['Jenis pajak']==='PPh Badan'&&r.Indeks==='B')){
    const derived=companyAssessment(pkg,year,work,index);
    if(derived){
      lines.push({'Jenis pajak':'PPh Badan',Indeks:'B',Masa:year,Pokok:null,'Kenaikan 75%':null,Bunga:null,'Sanksi terpilih':null,Jumlah:null,
        Keterangan:derived.notes.join(' ')});
      for(const [key,label,source] of companyFields){
        const value=derived.components?.[key];
        if(Number.isFinite(value))comparison.push({Komponen:label,'Angka dalam satuan sumber':value,Rujukan:source});
      }
      const scenario=companyCreditScenario(pkg,year,work,index,derived);
      if(scenario){
        for(const [label,value] of [['Pokok',scenario.principal],['Bunga',scenario.interest],['Jumlah',scenario.total]])
          comparison.push({Komponen:label+' · skenario dengan asumsi kredit','Angka dalam satuan sumber':value,Rujukan:scenario.assumption});
      }
    }
  }
  const notes=[clause,work.simulation?.end?'Tanggal rencana ketetapan '+work.simulation.end:'Tanggal rencana ketetapan belum diisi.',
    'Pokok PPN berasal dari perubahan PK dan PM yang diuji pada KKP dan perubahan kompensasi antarmasa. Pokok PPh memakai perubahan pada baris saldo atau pajak dipotong yang diuji.'];
  return {lines,cascade:vatCascadeRows(cascade),comparison,notes};
}
export function assessmentSheets(output){
  const appendix=output.comparison.length?[[],['Pembanding PPh Badan'],...worksheet(output.comparison)]:[];
  return [{name:'Simulasi',rows:[...worksheet(output.lines),[],...output.notes.map(s=>[s]),...appendix]},{name:'Kaskade PPN',rows:worksheet(output.cascade)}];
}
