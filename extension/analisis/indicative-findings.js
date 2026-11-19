import {benchmarkAnalysis} from './benchmark-work.js';
import {normalizeId} from '../app-data.js';
import {companyCreditScenario} from './company-credit-scenario.js';
import {fiscalComparisons} from './fiscal-comparisons.js';
import {companyRisks} from './indicative-company.js';
import {company} from './indicative-source.js';
import {vatRisks} from './indicative-vat.js';
import {listedReturns} from './return-source.js';
import {simulate} from './sanksi.js';

const hidden=status=>status==='explained'||status==='inapplicable';
const statusName=status=>status==='retained'?'Dipertahankan untuk pengujian':'Menunggu bukti';
const safe=Number.isSafeInteger;
function interest(r,end){
  if(!safe(r.amount))return {value:null,note:'Pokok skenario belum dapat dihitung.'};
  if(r.amount===0)return {value:0,note:''};
  if(!end)return {value:null,note:'Isi tanggal ketetapan rencana untuk memperkirakan bunga.'};
  if(!r.contributions.length)return {value:null,note:'Rincian masa untuk menghitung bunga belum tersedia.'};
  if(r.contributions.reduce((n,c)=>n+c.amount,0)!==r.amount)return {value:null,note:'Jumlah alokasi per masa berbeda dari pokok skenario.'};
  let rupiah=0n;
  for(const c of r.contributions){
    const v=simulate({tax:r.kind,period:c.period,article:'interest',principal:String(c.amount),basis:r.ruleId,transfers:[]},end);
    if(v.interest===null)return {value:null,note:v.reason};
    if(c.facilityBase!=null){
      // Keep the effective rate as a fraction until the interest for this period is settled in rupiah.
      const principalHundredths=BigInt(c.reportedVat)*100n+BigInt(c.facilityBase)*11n;
      rupiah+=principalHundredths*BigInt(v.rate.basisPoints)*BigInt(v.months)/1000000n;
    }else rupiah+=v.interest/10000n;
  }
  const value=Number(rupiah);
  return safe(value)?{value,note:'Skenario bunga Pasal 13 ayat (2) dihitung sampai tanggal rencana. Pecahan rupiah dilepas pada akhir setiap masa.'}
    :{value:null,note:'Nilai bunga melampaui ketelitian angka.'};
}

function benchmarkTable(pkg,year,work){
  const t={title:'Pembanding benchmark',columns:['Skenario','Rasio','Tahun acuan','Estimasi PPh (Rp)','Rujukan','Keterangan'],rows:[]};
  if(work.benchmark?.length){
    const analysis=benchmarkAnalysis(pkg,year,work.benchmark),form=company(pkg,year),owners=pkg.entries.filter(e=>e.path===analysis?.klu?.path);
    const verified=form&&owners.length===1&&owners[0].cap?.lengkap===true&&
      normalizeId(owners[0].cap.konteks?.npwp)===normalizeId(pkg.manifest.wp.npwp);
    for(const s of analysis?.scenarios||[])t.rows.push([s.Skenario,s.Rasio,s['Tahun data acuan'],verified?s['PPh tambahan simulasi (Rp)']:null,
      s['Rujukan acuan'],verified?s.Keterangan:'Periksa versi SPT terakhir, satuan, serta berkas sumber KLU untuk WP ini.']);
  }
  if(!t.rows.length)t.rows.push(['Acuan sektoral belum tersedia',null,null,null,null,'Masukkan acuan sesuai KLU dan tahun pada lembar Benchmark & Tax Gap.']);
  return t;
}
export function indicativeFindings(pkg,year,work={},index={groups:[]}){
  year=String(year);
  const present=(type,code)=>pkg.forms.some(f=>f.type===type&&f.year===year)||listedReturns(pkg,year,code).size>0;
  const corporate=present('BADAN','ICT_RCITR'),personal=present('OP','ICT_PITR'),vat=present('PPN','VAT_VATR');
  const hasCorporate=corporate&&!personal;
  const analyses={title:'Analisis indikatif',columns:['Jenis pajak','Uraian','Dasar skenario','Pokok skenario (Rp)','Bunga skenario (Rp)',
    'Jumlah skenario (Rp)','Status telaah','Indeks','Masa dasar bunga','Bukti yang diminta','Sumber','Dasar hukum','Cara hitung dan batas data'],rows:[]};
  const initial={title:'Nilai awal kertas kerja',columns:['Indeks','Uraian','Masa/Tahun','Menurut SPT','Pembanding awal','Selisih pembanding','Status telaah','Sumber','Keterangan'],rows:[]};
  const facts=[],candidates=[],measured=[];
  let facilityReference=null;
  const states=work.indicationReviews||{};
  const rules=[...(vat?vatRisks(pkg,year):[]),...(hasCorporate?companyRisks(pkg,year,work):[])];
  for(const r of rules){
    candidates.push({ruleId:r.ruleId,title:r.title,kind:r.kind,reference:r.ref,basis:r.base,
      source:r.source,evidence:r.evidence,law:r.law,note:r.note});
    const status=states[r.ruleId];
    if(hidden(status))continue;
    const a=safe(r.amount)?r.amount:null,fee=interest(r,work.simulation?.end),total=a!==null&&fee.value!==null&&safe(a+fee.value)?a+fee.value:null;
    const s=r.standardScenario;
    if(s){
      const scenarioInterest=interest({...r,amount:s.amount,contributions:s.contributions},work.simulation?.end).value;
      facilityReference={title:'Pembanding N.5 · PPN fasilitas',columns:['Indeks','Masa terbaca','Faktur 07/08','DPP menurut A2',
        'PPN tercantum di A2','Faktur yang perlu pemeriksaan tarif','Pokok pembanding (Rp)','Bunga menurut masa di A2 (Rp)',
        'Jumlah pembanding (Rp)','Faktur bertanggal setelah masa SPT','Masa tanpa SPT di paket','Faktur dengan PPN nol yang diestimasi','Keterangan'],
        rows:[['N.5',s.periods,s.count,r.base,s.recorded,s.rateDifferences,s.amount,scenarioInterest,
          safe(scenarioInterest)&&safe(s.amount+scenarioInterest)?s.amount+scenarioInterest:null,s.anchorDifferences,s.missing,s.estimated,
          'Andaikan fasilitas gugur dan semua penyerahan berada pada masa SPT yang memuatnya. Pokok mengikuti nominal PPN di A2. Pada faktur dengan DPP positif dan PPN nol, pembanding memakai estimasi efektif 11%. Periksa tarif, periode, syarat fasilitas dan pembayaran per faktur. Pembanding ditampilkan di luar subtotal.']]};
    }
    const months=r.contributions.map(c=>c.period).join(', '),note=[r.note,fee.note].filter(Boolean).join(' ');
    analyses.rows.push([r.kind,r.title,safe(r.base)?r.base:null,a,fee.value,total,statusName(status),r.ref,months,r.evidence,r.source,r.law,note]);
    measured.push([a,fee.value,total]);
    if(a>0||a===null&&(r.base>0||r.hasObservation))facts.push({
      ruleId:r.ruleId,kind:r.kind,period:year,detail:r.title,source:r.source,status:'indikatif',amount:a??'',
      classification:statusName(status),evidence:r.evidence,reference:r.ref,basis:r.base,interest:fee.value});
  }
  const fiscal=hasCorporate?fiscalComparisons(pkg,year,index):new Map();
  const positive=index.groups.find(g=>g.key==='BADAN/B.7');
  const initialRules=hasCorporate?[['depreciation','5314','Penyusutan dan amortisasi'],['entertainment','5321','Biaya jamuan']]:[];
  for(const [ruleId,code,title] of initialRules){
    const line=positive?.lines.find(l=>l.id.endsWith('/account-'+code)),comparison=line&&fiscal.get(line.id);
    const value=comparison?.value??null,reported=line?.amount??null;
    const source=[line?.source,comparison?.source].filter(Boolean).join(' · ');
    const note=comparison?.note||'Pembanding dengan selisih yang dapat ditelusuri belum tersedia.';
    candidates.push({ruleId,title,kind:'PPh Badan',reference:'B.7',basis:reported,source,note});
    if(hidden(states[ruleId]))continue;
    initial.rows.push(['B.7',title+' · akun '+code,year,reported,value,safe(value)&&safe(reported)?value-reported:null,statusName(states[ruleId]),
      source,note]);
  }
  // A combined subtotal uses only cases with both components. Unpriced cases remain visible.
  const totals=['Subtotal pokok skenario','Subtotal bunga skenario','Subtotal pokok dan bunga'].map((label,i)=>{
    const known=measured.map(r=>r[i]).filter(safe),value=known.reduce((a,b)=>a+b,0);
    return {label,value:known.length&&safe(value)?value:null,note:known.length+' dari '+measured.length+' skenario aktif memiliki angka.'};
  });
  const tables=[analyses];
  if(facilityReference)tables.push(facilityReference);
  if(hasCorporate)tables.push(initial,benchmarkTable(pkg,year,work));
  const credit=hasCorporate&&companyCreditScenario(pkg,year,{...work,rows:[]},index);
  if(credit)tables.push({title:'Pembanding ketetapan dari nilai awal',columns:['Jenis pajak','Pokok skenario (Rp)','Bunga skenario (Rp)',
    'Jumlah skenario (Rp)','Masa dasar bunga','Bulan bunga','Asumsi dan batas data','Sumber'],
    rows:[['PPh Badan',credit.principal,credit.interest,credit.total,credit.period,credit.months,credit.notes.join(' '),credit.source]]});
  return {tables,facts,candidates,totals,initialFiscal:initial,
    notes:['Setiap angka merupakan skenario untuk meminta bukti. Status dipertahankan berarti butir masih perlu diuji.',
      ...(hasCorporate?['Subtotal hanya memakai analisis aktif yang memiliki angka. Nilai awal B.7, pembanding ketetapan dan benchmark ditampilkan terpisah untuk mencegah penghitungan ganda.']:[]),
      ...(personal&&corporate?['Paket memuat SPT Tahunan Badan dan Orang Pribadi pada tahun yang sama. Periksa identitas sumber.']:[]),
      ...(!rules.length?['Paket belum memiliki SPT yang sesuai dengan analisis pada tahun ini.']:[]),
      work.simulation?.end?'Tanggal ketetapan rencana '+work.simulation.end+'.':'Tanggal ketetapan rencana belum diisi.']};
}
