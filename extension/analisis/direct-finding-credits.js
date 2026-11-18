import {companyEndPeriod,creditArticle,lastCompanyReturn,receivedWithholding} from './assessment-company.js';
import {checkedCompanyEntry,checkedCompanyTable} from './kkp-company-annexes.js';
import {rowsOf} from './model.js';
import {usesOtherCurrency} from './return-source.js';
import {ledgerPayments} from './temporary-findings-installments.js';

const valid=Number.isSafeInteger;
const money=n=>Number.isSafeInteger(n)&&n>=0;
const diff=(a,b)=>money(a)&&money(b)&&valid(b-a)?b-a:null;
const tableTitle='Rekonsiliasi kredit dan angsuran PPh Badan';
const columns=['Indeks','Uraian','Menurut SPT','Teramati pada bukti','Selisih sejenis','Selisih jika seluruh kredit induk berasal dari bukti ini','Sumber','Keterangan'];

function domesticCredit(pkg,form){
  const rows=checkedCompanyTable(pkg,form,'l3');
  const totalEntry=checkedCompanyEntry(pkg,form,'l3-total'),summary=rowsOf(totalEntry);
  if(!rows||!totalEntry||summary.length!==1||!money(summary[0].IncomeTax)||usesOtherCurrency(summary[0]))return null;
  // Restrict the reported side to the same tax articles as the counterparty evidence.
  const identities=new Set();
  for(const r of rows){
    if(!money(r.IncomeTax)||usesOtherCurrency(r)||creditArticle(r.TaxArticle)===null)return null;
    const key=r.RecordId||JSON.stringify(Object.entries(r).sort(([a],[b])=>a.localeCompare(b)));
    if(identities.has(key))return null;
    identities.add(key);
  }
  if(rows.reduce((sum,r)=>sum+r.IncomeTax,0)!==summary[0].IncomeTax)return null;
  const selected=rows.filter(r=>[22,23].includes(creditArticle(r.TaxArticle)));
  const amount=selected.reduce((n,r)=>n+r.IncomeTax,0);
  return money(amount)?{value:amount,source:form.parts.get('l3').path+' · '+totalEntry.path}:null;
}

export function directCreditFindings(pkg,year){
  const table={title:tableTitle,columns,rows:[]},facts=[],notes=[];
  const assessment={reportedBalance:null,creditDifference:null,period:null,source:'',ready:false,reason:''};
  const result={table,facts,notes,assessment,scenario:null};
  const data=lastCompanyReturn(pkg,String(year));
  if(!data){assessment.reason='Induk PPh Badan dan pembetulan terakhir belum dapat dipastikan.';return result;}
  const {f,main,env,body,source}=data;
  assessment.source=source.path;
  if(usesOtherCurrency(f.meta,source.cap,env,body,main)){
    assessment.reason='Cocokkan mata uang SPT dengan buku besar rupiah.';notes.push(assessment.reason);return result;
  }
  if(![f.meta,source.cap,env,body,main].some(r=>r?.CurrencyCode||r?.Currency||r?.MataUang||r?.['Mata Uang'])){
    notes.push('Mata uang induk belum dinyatakan. Cocokkan satuan induk dengan bukti dalam rupiah sebelum memakai selisih.');
  }
  assessment.period=companyEndPeriod(f,main,String(year));
  assessment.reportedBalance=valid(main.UnderpaymentIncomeTax)?main.UnderpaymentIncomeTax:null;
  // The observations below cover January through December. A broken fiscal year needs a different ledger window.
  if(assessment.period!==year+'-12'||Number(main.AccountingPeriodStart)!==1&&
    !String(main.AccountingPeriodStart||'').startsWith(year+'-01-')){
    assessment.reason='Periode pembukuan Januari–Desember belum cocok dengan periode bukti potong dan buku besar.';notes.push(assessment.reason);return result;
  }
  const slips=receivedWithholding(pkg,year),imports=ledgerPayments(pkg,year,'411123'),p25=ledgerPayments(pkg,year,'411126');
  const combined=money(main.TotalIncomeTaxOverseas)?main.TotalIncomeTaxOverseas:null;
  const declared25=money(main.InstallmentOfIncome)?main.InstallmentOfIncome:null;
  const domestic=domesticCredit(pkg,f);
  const observed=slips&&imports&&(!imports.count||!slips.count)?slips.amount+imports.value:null;
  const sameCredit=diff(domestic?.value,observed),installments=diff(declared25,p25?.value);
  function fact(id,description,location){
    facts.push({ruleId:id,kind:'PPh Badan',period:year,detail:description,source:location,status:'berbukti',amount:'',
      taxpayer:'',discussed:'',agreed:''});
  }
  const sources=[source.path,domestic?.source,slips?.path,imports?.source].filter(Boolean).join(' · ');
  if(combined!==null||slips||imports||domestic){
    const message=[slips?slips.count+' bukti PPh Pasal 22/23 aktif.':'Bukti potong PPh 22/23 belum terkonfirmasi.',
      imports?'Setoran PPh 22 Impor (411123-100) pada 12 masa sebesar '+imports.value.toLocaleString('id-ID')+'.':'Buku besar PPh 22 Impor belum lengkap.',
      slips?.count&&imports?.count?'Cocokkan tanda terima impor dengan dokumen pemungutan untuk mencegah penjumlahan ganda.':'',
      domestic?'Nilai SPT memakai rincian 22/23 di Lampiran 3 yang cocok dengan totalnya.':'Rincian dalam negeri dan total Lampiran 3 belum dapat dipasangkan. Angka induk dapat mencakup sumber kredit lain.'].filter(Boolean).join(' ');
    table.rows.push(['B',domestic?'PPh 22/23 dan setoran impor':'Kredit pajak pada induk dan bukti PPh 22/23 yang teramati',
      domestic?domestic.value:combined,observed,sameCredit,domestic?null:diff(combined,observed),sources,message]);
    if(sameCredit!==null&&sameCredit!==0)fact('domestic-credits','Selisih Rp'+sameCredit.toLocaleString('id-ID')+' antara rincian kredit PPh 22/23 dan bukti yang teramati. Periksa pemanfaatan kredit.',sources);
  }
  if(declared25!==null||p25){
    const path=[source.path+' · InstallmentOfIncome',p25?.source].filter(Boolean).join(' · ');
    table.rows.push(['B','Angsuran PPh Pasal 25',declared25,p25?.value??null,installments,null,path,
      p25?p25.count+' pembayaran aktif KAP 411126 KJS 100 dalam 12 masa. Cocokkan pemanfaatannya pada SPT.':'Satu atau beberapa masa buku besar belum lengkap.']);
    if(installments!==null&&installments!==0)fact('company-installments','Selisih Rp'+installments.toLocaleString('id-ID')+' antara angsuran Pasal 25 pada induk dan pembayaran tercatat.',path);
  }
  const sum=sameCredit!==null&&installments!==null?sameCredit+installments:null;
  assessment.creditDifference=valid(sum)?sum:null;
  assessment.ready=assessment.creditDifference!==null&&assessment.reportedBalance!==null;
  assessment.reason=assessment.ready?'Perkiraan jika seluruh selisih kredit yang telah dipasangkan dapat diperhitungkan dan pos lain tetap.':
    'Perkiraan pokok menunggu saldo SPT dan dua perbandingan kredit dengan sumber yang sejenis.';
  const scenarioCredit=domestic?sameCredit:diff(combined,observed);
  if(scenarioCredit!==null&&installments!==null&&assessment.reportedBalance!==null&&valid(scenarioCredit+installments)){
    result.scenario={reportedBalance:assessment.reportedBalance,creditChange:scenarioCredit+installments,period:assessment.period,source:sources,
      creditReported:domestic?domestic.value:combined,creditObserved:observed,creditComparable:Boolean(domestic),
      assumption:domestic?'Skenario memakai rincian PPh 22/23 yang dapat dipasangkan dan pembayaran Pasal 25.':
        'Skenario mengasumsikan seluruh isian kredit pada induk berasal dari bukti PPh 22/23 dan pembayaran impor yang teramati. Komponen luar negeri atau kredit lain belum dapat dipisahkan pada Lampiran 3.'};
  }
  if(!assessment.ready)notes.push(assessment.reason);
  return result;
}
