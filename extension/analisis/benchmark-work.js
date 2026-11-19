import {annualRatios,fiscalMeasures} from './peer-analysis.js';
import {worksheet} from './model.js';

export const benchmarkMetrics=fiscalMeasures.map(([code])=>code.toUpperCase());
const text=v=>typeof v==='string'&&v.trim()?v.trim():null;
const scopeCode=/^(?:\d{2,5}|Z\d{1,4})$/;
const key=r=>JSON.stringify([r.metric,r.name,r.source,r.year,r.klu]);

export function validateBenchmark(input=[]){
  if(!Array.isArray(input))throw Error('Acuan benchmark harus berupa daftar skenario.');
  const seen=new Set();
  return input.map((row,i)=>{
    const fail=message=>{throw Error('Acuan ke-'+(i+1)+' · '+message);};
    if(!row||typeof row!=='object')fail('Baris tidak dikenali.');
    const name=text(row.name),source=text(row.source),year=row.year,klu=text(row.klu),metric=text(row.metric);
    if(!name||!source||!Number.isInteger(year)||year<1900||year>9999||!klu||!scopeCode.test(klu))
      fail('Isi nama acuan, rujukan, tahun data, dan kode KLU cakupan dalam bentuk teks.');
    if(!benchmarkMetrics.includes(metric)||!Number.isFinite(row.target))fail('Periksa nama rasio dan nilai persentase.');
    const norm={name,source,year,klu,metric,target:row.target};
    if(metric==='NPM'){
      if(!Number.isFinite(row.taxRate)||row.taxRate<0||row.taxRate>=100||!text(row.taxRateSource))
        fail('Skenario NPM memerlukan tarif simulasi antara 0 dan kurang dari 100 persen, serta rujukan tarif.');
      Object.assign(norm,{taxRate:row.taxRate,taxRateSource:row.taxRateSource.trim()});
    }
    if(seen.has(key(norm)))fail('Rasio, KLU, tahun, sumber, dan nama skenario berulang.');
    seen.add(key(norm));return norm;
  });
}

export function benchmarkAnalysis(pkg,year,references=[]){
  year=String(year);
  if(!pkg.forms.some(f=>f.type==='BADAN'&&f.period===year))return null;
  const base=annualRatios(pkg,year),reason=base.complete?'':base.condition;
  const amounts=base.values;
  const ratios=fiscalMeasures.map(([key,label,,n,d])=>{
    const a=amounts[n],b=amounts[d],value=base.ratios[key];
    return {Rasio:key.toUpperCase(),Uraian:label,'WP (%)':value,Pembilang:a.value,Penyebut:b.value,'Isian pembilang':a.field,
      'Isian penyebut':b.field,'Berkas induk':base.form?.parts.get('induk')?.path||'',
      Keterangan:reason||(value===null?(b.value!==null&&b.value<=0?'Penyebut nol atau negatif.':'Nilai sumber belum lengkap.'):'')};
  });
  const scenarios=validateBenchmark(references).map(ref=>{
    const wp=base.ratios[ref.metric.toLowerCase()],applies=Boolean(base.klu.code&&base.klu.code.startsWith(ref.klu)),delta=applies&&wp!==null?ref.target-wp:null;
    let gap=null,note='';
    if(!applies)note=base.klu.code?'KLU WP di luar cakupan acuan.':'KLU WP belum dapat ditentukan.';
    else if(delta===null)note='Rasio WP belum dapat dihitung.';
    else if(ref.metric==='CTTOR')gap=Math.max(0,amounts.sales.value*ref.target/100-amounts.tax.value);
    else if(ref.metric==='NPM')gap=Math.max(0,amounts.sales.value*delta/100)*ref.taxRate/(100-ref.taxRate);
    else note='Selisih rasio disajikan untuk pemeriksaan kegiatan.';
    const rounded=gap===null?null:Math.round(gap);
    if(gap!==null&&!Number.isSafeInteger(rounded))note='Hasil rupiah di luar ketelitian angka.';
    return {Skenario:ref.name,Rasio:ref.metric,'Tahun data acuan':ref.year,'KLU cakupan':ref.klu,'WP (%)':wp,
      'Acuan (%)':ref.target,'Selisih (poin persen)':delta,'Tarif simulasi (%)':ref.taxRate??null,
      'PPh tambahan simulasi (Rp)':Number.isSafeInteger(rounded)?rounded:null,'Rujukan acuan':ref.source,
      'Rujukan tarif':ref.taxRateSource||'',Keterangan:note};
  });
  return {year,form:base.form,klu:base.klu,ratios,scenarios,reason};
}

function benchmarkRows(pkg,analysis){
  const {form,klu,ratios,scenarios}=analysis;
  const rows=[['Benchmark sektoral dan simulasi tax gap'],['Nama WP',pkg.manifest.wp?.nama],['NPWP',pkg.manifest.wp?.npwp],['Tahun SPT',analysis.year],
    ['Versi SPT',form?form.version===0?'Normal':'Pembetulan '+form.version:null],['KLU WP',klu.code],['Dasar KLU',klu.basis,klu.path],
    [],...worksheet(ratios),[],['Simulasi terhadap acuan'],['CTTOR','Peredaran × CTTOR acuan dikurangi PPh terutang. Selisih positif dibulatkan ke rupiah.'],
    ['NPM','Kelebihan NPM acuan atas NPM WP × peredaran × tarif ÷ (1 − tarif). Tarif dan rasio dipakai sebagai pecahan.']];
  if(scenarios.length)rows.push(...worksheet(scenarios));else rows.push(['Belum ada acuan sektoral yang dimasukkan untuk WP dan tahun ini.']);
  rows.push(['Penggunaan','Setiap skenario dihitung sendiri dan dapat ditelusuri ke rujukannya. Nilai simulasi terpisah dari pokok hasil pengujian.']);
  return rows;
}

export function benchmarkSheet(pkg,year,references=[]){
  const analysis=benchmarkAnalysis(pkg,year,references);
  return analysis?{name:'Benchmark & Tax Gap',rows:benchmarkRows(pkg,analysis)}:null;
}

const displayValue=new Intl.NumberFormat('id-ID',{maximumFractionDigits:2});
const percent=value=>Number.isFinite(value)?displayValue.format(value)+'%':'Belum tersedia';

export function kkaBenchmarkAppendix(pkg,year,references=[]){
  const analysis=benchmarkAnalysis(pkg,year,references);
  if(!analysis)return null;
  const title='L-10 Pembanding sektoral', {klu,form,ratios,scenarios}=analysis;
  const rows=[['Uraian','Hasil','Dasar atau rujukan'],
    ['Tahun pajak dan versi SPT',analysis.year+' · '+(form?form.version===0?'Normal':'Pembetulan '+form.version:'Versi belum dapat ditentukan'),
      form?.parts.get('induk')?.path||analysis.reason],
    ['KLU WP',klu.code||'Belum dapat ditentukan',klu.basis],
    ...ratios.map(r=>[r.Rasio,percent(r['WP (%)']),r.Keterangan||r.Uraian])];
  if(!scenarios.length)rows.push(['Acuan sektoral','Belum diisi','Tambahkan acuan dan rujukannya di Kertas Kerja.']);
  for(const s of scenarios){
    const outcome=Number.isFinite(s['PPh tambahan simulasi (Rp)'])?'Rp '+displayValue.format(s['PPh tambahan simulasi (Rp)']):'';
    rows.push([s.Skenario+' · '+s.Rasio,
      ['Acuan '+percent(s['Acuan (%)']),outcome,s.Keterangan].filter(Boolean).join(' · '),
      ['KLU '+s['KLU cakupan'],s['Tahun data acuan'],s['Rujukan acuan'],s['Rujukan tarif']].filter(Boolean).join(' · ')]);
  }
  rows.push(['Penggunaan','Pembanding risiko','Nilai simulasi terpisah dari rekap pokok pajak.']);
  return {title,rows,workbook:{name:title,rows:benchmarkRows(pkg,analysis)}};
}
