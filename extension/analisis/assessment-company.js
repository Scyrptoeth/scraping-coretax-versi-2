import {normalizeId} from '../app-data.js';
import {findingFromWorkRow,findingKey} from './findings.js';
import {checkedCompanyEntry,checkedCompanyTable} from './kkp-company-annexes.js';
import {rowsOf,sptDay} from './model.js';
import {listedReturns,revisionProblem,usesOtherCurrency} from './return-source.js';
import {fiscalComparisons} from './temporary-findings.js';
import {installmentComparison} from './temporary-findings-installments.js';
import {sourceAmount} from './withholding-forms.js';

const validMoney=Number.isSafeInteger;
const active=r=>!['Terjelaskan','Tidak relevan'].includes(r);

function lastReturn(pkg,year) {
  const forms=pkg.forms.filter(f=>f.type==='BADAN'&&f.period===year);
  const latest=Math.max(...forms.map(f=>f.version)),matches=forms.filter(f=>f.version===latest);
  if(matches.length!==1)return null;
  const f=matches[0],source=checkedCompanyEntry(pkg,f,'induk');
  if(!source)return null;
  const body=rowsOf(source);
  if(body.length!==1||!body[0].MainFormData)return null;
  const main=body[0].MainFormData,owner=normalizeId(pkg.manifest.wp?.npwp),env=source.pages[0].Payload??source.pages[0];
  if(env.IsFound===false||[main.TIN,body[0].TIN,env.TIN].filter(Boolean).some(v=>normalizeId(v)!==owner)||
    (main.TaxYear!=null&&String(main.TaxYear)!==year))return null;
  if(revisionProblem(listedReturns(pkg,year,'ICT_RCITR').get(year)||[],forms,f))return null;
  return {f,main,source,env,body:body[0]};
}

function endPeriod(f,main,year) {
  const end=sptDay(main.AccountingPeriodEnd);
  if(end)return end.slice(0,7);
  const codes=[f.parts.get('induk').cap.konteks?.spt?.masa,f.meta?.TaxPeriodCode].filter(Boolean).map(String);
  return codes.length&&codes.every(v=>v==='0112'+year)&&Number(main.AccountingPeriodStart)===1&&Number(main.AccountingPeriodEnd)===12?year+'-12':null;
}

function receivedWithholding(pkg,year) {
  const path='bukti-potong-lawan/'+year+'/BPPU.json',files=pkg.entries.filter(e=>e.path===path);
  if(files.length!==1)return null;
  const entry=files[0],cap=entry.cap||{},q=cap.payload||{},owner=normalizeId(pkg.manifest.wp?.npwp);
  if(!owner||cap.lengkap!==true||normalizeId(cap.konteks?.npwp)!==owner||normalizeId(q.IncomeRecipientTin)!==owner||
    String(cap.konteks?.tahun)!==year||cap.konteks?.jenis&&cap.konteks.jenis!=='BPPU'||String(q.TaxYear||'').slice(0,4)!==year||q.WithholdingSlipsType!=='BPPU'||
    q.First!==0||q.Filters?.length||[q.TaxPeriod,q.WithholderTin,q.WithholdingSlipsNumber,q.WithholdingSlipsStatus].some(v=>v!=null&&v!=='')||
    cap.halamanSumber?.some(h=>h.pencocokan?.morePagesAvailable)||!entry.pages?.length||
    entry.pages.some(p=>!p||p.IsSuccessful===false||p.Errors?.length||!Array.isArray((p.Payload??p).Data))||
    pkg.manifest.gagal?.some(f=>[path,'data/'+path].includes(typeof f==='string'?f:f?.path)))return null;
  const rows=rowsOf(entry);
  const totals=[cap.total,...entry.pages.map(p=>(p.Payload??p).TotalRecords)].filter(v=>v!=null);
  if(!totals.length||totals.some(n=>n!==rows.length)||cap.baris!=null&&cap.baris!==rows.length||cap.halaman!=null&&cap.halaman!==entry.pages.length)return null;
  let amount=0,count=0;const seen=new Set();
  for(const r of rows) {
    if(!/^(?:pasal|article)\s*(?:22|23)$/i.test(String(r.TaxArticle||'').trim()))continue;
    const status=String(r.WithholdingSlipsStatus||'').toUpperCase(),code=String(r.TaxPeriodCode||'');
    const party=normalizeId(r.WitholderTin||r.WithholderTin),id=r.WithholdingSlipsNumber&&party&&JSON.stringify([party,r.WithholdingSlipsNumber]);
    if(!id||seen.has(id)||normalizeId(r.EmployeeTin||r.IncomeRecipientTin)!==owner||
      !/^(0[1-9]|1[0-2])\1\d{4}$/.test(code)||code.slice(4)!==year||
      [r.FiscalYear,r.__Y].filter(v=>v!=null&&v!=='').some(v=>String(v)!==year)||usesOtherCurrency(r))return null;
    seen.add(id);
    if(status==='CANCELLED'||r.IsCancelled===true)continue;
    if(status!=='NORMAL'||!validMoney(r.IncomeTax)||r.IncomeTax<0)return null;
    amount+=r.IncomeTax;count++;
  }
  return validMoney(amount)?{amount,count,path}:null;
}

function fiscalProjection(pkg,year,work,index,annual,main) {
  const tax=sourceAmount(main.IncomeTaxInAYear),income=sourceAmount(main.FiscalNetIncomeAfterTax),taxable=sourceAmount(main.TaxableIncome);
  const turnover=annual.support?.find(r=>r.Kode==='A4020')?.Nilai;
  // Restrict this comparison to returns that already reconcile to an unreduced rate
  // and round positive taxable income to thousands. Other tax treatments need their own source.
  if(Number(year)<2022||![tax,income,taxable,turnover].every(validMoney)||turnover<=50000000000||taxable<=0||
    Math.floor(income/1000)*1000!==taxable||BigInt(tax)*100n!==BigInt(taxable)*22n)return null;
  const group=index.groups.find(g=>g.key==='BADAN/B.7');
  const declared=group?.support?.find(s=>s.Uraian==='Jumlah koreksi positif menurut SPT');
  if(!validMoney(declared?.Nilai))return null;
  const changes=fiscalComparisons(pkg,year,index),rows=work.rows??[];
  let delta=0;
  for(const code of ['5314','5321']) {
    const line=group.lines.find(l=>l.id.endsWith('/account-'+code));
    if(!line||line.partial||!validMoney(line.amount))return null;
    const reviews=rows.filter(r=>r.kkpLine===line.id),review=reviews[0];
    if(reviews.length>1)return null;
    const finding=review&&findingFromWorkRow(review,year);
    if(review&&(review.menurutWp!==line.amount||!validMoney(review.menurutPetugas)||!active(review.review)||
      finding&&!active(work.dispositions?.[findingKey(finding)])))return null;
    const value=review?review.menurutPetugas:changes.get(line.id)?.value;
    if(!validMoney(value))return null;
    delta+=value-line.amount;
  }
  if(!validMoney(delta)||!validMoney(income+delta)||income+delta<0)return null;
  const projected=Number(BigInt(income+delta)/1000n*1000n*22n/100n);
  if(!validMoney(projected)||!validMoney(declared.Nilai+delta))return null;
  return {baseCorrection:declared.Nilai,projectedCorrection:declared.Nilai+delta,declaredTax:tax,projectedTax:projected};
}

export function companyAssessment(pkg,year,work,index) {
  year=String(year);
  const data=lastReturn(pkg,year);
  if(!data)return null;
  const {f,source,body,env,main}=data,annual=index.groups.find(g=>g.key==='BADAN/B');
  if(!annual)return null;
  // The assessment's existing reviewed-balance path owns this outcome, including validation.
  const balance=annual.lines.find(l=>l.source===source.path+' · MainFormData.UnderpaymentIncomeTax');
  if(balance&&(work.rows??[]).some(r=>r.kkpLine===balance.id))return null;
  const period=endPeriod(f,main,year);
  const currencies=[f.meta?.CurrencyCode,env.CurrencyCode,body.CurrencyCode,main.CurrencyCode,
    annual.support?.find(r=>r.Kode==='P25')?.Satuan].filter(v=>v&&v!=='Belum dinyatakan');
  if(usesOtherCurrency(f.meta,env,body,main)||currencies.includes('Bertentangan atau tidak dikenali'))return {mode:'indikasi',principal:null,period,notes:['Mata uang sumber belum dapat disamakan dengan rupiah. Periksa induk dan bukti pembayaran.']};
  const notes=[],components={};
  const projection=fiscalProjection(pkg,year,work,index,annual,main);
  if(projection){
    Object.assign(components,projection);
    notes.push((currencies.length?'Proyeksi':'Jika angka induk dalam rupiah, proyeksi')+' PPh terutang '+projection.projectedTax.toLocaleString('id-ID')+' dibandingkan dengan '+projection.declaredTax.toLocaleString('id-ID')+' pada induk. Skenario memakai akun 5314 dan 5321 di B.7, pembulatan PKP ke ribuan, serta tarif 22% yang sesuai dengan angka SPT. Pos lain diasumsikan tetap.');
  }
  const installments=installmentComparison(pkg,year,index);
  if(installments){components.observedInstallments=installments.value;notes.push('Setoran PPh 25 KAP 411126 KJS 100 pada 12 masa buku besar '+installments.value.toLocaleString('id-ID')+'. Cocokkan pemanfaatan setoran pada tahun pajak ini.');}
  const slips=receivedWithholding(pkg,year);
  if(slips){components.observedWithholding=slips.amount;notes.push(slips.count+' bukti PPh 22/23 aktif pada '+slips.path+' memuat potongan '+slips.amount.toLocaleString('id-ID')+'. Periksa sifat pajak dan hak pengkreditan.');}
  const overseas=sourceAmount(main.TotalIncomeTaxOverseas);
  if(validMoney(overseas)){components.overseasField=overseas;notes.push('Isian TotalIncomeTaxOverseas pada '+source.path+' sebesar '+overseas.toLocaleString('id-ID')+'. Potongan dalam negeri dan kredit luar negeri perlu dicocokkan dengan jenis serta lampiran masing-masing.');}
  const l3=checkedCompanyTable(pkg,f,'l3');
  if(l3)notes.push('Lampiran 3 yang terbaca memuat '+l3.length+' baris.');
  if(!currencies.length)notes.push('Satuan mata uang pada induk belum dinyatakan. Angka pembanding mengikuti satuan yang tercantum pada masing-masing sumber.');
  notes.push('Pokok tambahan PPh Badan menunggu rekonsiliasi kredit yang sejenis atau hasil uji saldo B dengan bukti.');
  return {mode:'indikasi',principal:null,period,notes,components};
}
