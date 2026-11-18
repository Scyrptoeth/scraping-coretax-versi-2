import {normalizeId} from '../app-data.js';
import {rowsOf,sptDay} from './model.js';
import {usesOtherCurrency} from './return-source.js';
import {company,confirmedAbsentPeriods,documentState,months,num} from './indicative-source.js';

const notes={
  debt:'PMK 169/PMK.010/2015 · https://jdih.kemenkeu.go.id/api/download/fulltext/2015/169~PMK.010~2015Per.pdf',
  payroll:'PMK 168 Tahun 2023 · https://jdih.kemenkeu.go.id/dok/pmk-168-tahun-2023',
  rental:'PP 34 Tahun 2017 · https://jdih.kemenkeu.go.id/api/download/FullText/2017/34TAHUN2017PP.pdf',
  loan:'PMK 172 Tahun 2023 · https://jdih.kemenkeu.go.id/dok/pmk-172-tahun-2023',
};
const positive=n=>Math.max(0,n);
const sum=a=>a.reduce((x,y)=>x+y,0);
const indicator=(ruleId,kind,title,ref,law,evidence)=>({ruleId,kind,title,ref,law,evidence,base:null,amount:null,source:'',note:'',contributions:[]});
const present=x=>x!=null&&x!=='';
function declared(pub,year,type,part){
  const seq=months(pub,year,type,part),absent=confirmedAbsentPeriods(pub,year,type),sources=seq.filter(Boolean);
  const complete=seq.every((s,i)=>Boolean(s)||absent.has(year+'-'+String(i+1).padStart(2,'0')));
  return {sources,complete:complete&&sources.length>0,absent:[...absent]};
}
function payroll(pkg,year,f){
  const r=indicator('payroll-gap','PPh Pasal 21','Biaya pegawai dibandingkan dengan bruto SPT Masa','C.2.1',notes.payroll,
    'Cocokkan daftar gaji, komponen yang menjadi objek pajak, bukti potong, dan masa pembayaran setiap pegawai.');
  const {sources,complete,absent}=declared(pkg,year,'PPH2126','induk');
  const items=['5311','5312'].filter(k=>f?.accounts.has(k)),costs=items.map(k=>num(f.accounts.get(k).Amount));
  const gross=sources.map(s=>num(s.rows[0].Form1A?.GrossIncome)),tax=sources.map(s=>num(s.rows[0].A21IncomeTaxWithheld));
  r.source=[f?.path&&f.path+' · akun '+items.join(', '),...sources.map(s=>s.path)].filter(Boolean).join(' · ');
  r.note='Bruto dan PPh berasal dari Form 1A dan A21IncomeTaxWithheld. Rasio agregat WP hanya memberi estimasi. Rincian gaji per masa diperlukan untuk bunga dan penghitungan individual.';
  if(absent.length)r.note+=' Daftar paket tidak memuat SPT masa '+absent.join(', ')+'.';
  if(!f?.calendarYear){r.note+=' Tahun buku Januari–Desember belum terkonfirmasi.';return r;}
  if(!complete||!items.includes('5311')||costs.includes(null)||gross.includes(null)||tax.includes(null)||sum(gross)<=0)return r;
  r.base=positive(sum(costs)-sum(gross));r.amount=Math.round(r.base*sum(tax)/sum(gross));
  return r;
}
function rental(pkg,year,f){
  const r=indicator('rent-gap','PPh Pasal 4 ayat (2)','Biaya sewa dibandingkan dengan objek sewa tanah atau bangunan','K.2.1',notes.rental,
    'Pisahkan kontrak tanah/bangunan dan harta lainnya. Periksa pembayaran per masa, pengecualian, dan kewajiban pemotongan.');
  const {sources,complete,absent}=declared(pkg,year,'UNIFIKASI','d1-bpu'),cost=num(f?.accounts.get('5315')?.Amount);
  const entries=pkg.entries.filter(e=>e.path==='profil/alamat.json'),profile=entries[0];
  const owner=normalizeId(pkg.manifest?.wp?.npwp);
  const rented=owner&&entries.length===1&&profile.cap?.lengkap===true&&normalizeId(profile.cap.konteks?.npwp)===owner&&rowsOf(profile).some(s=>{
    const start=sptDay(s.RentStartDate),end=sptDay(s.RentEndDate);
    return s.LocationIsRented===true&&start&&start<=year+'-12-31'&&(!s.RentEndDate||end&&end>=year+'-01-01');
  });
  r.note='Anggapan seluruh selisih merupakan sewa tanah/bangunan memakai tarif 10%. Periksa masa sebenarnya sebelum menghitung bunga.';
  if(absent.length)r.note+=' Daftar SPT yang lengkap tidak memuat masa '+absent.join(', ')+'. Pembanding hanya mencakup SPT yang dilaporkan.';
  r.source=[f?.path&&f.path+' · akun 5315',rented&&profile.path,...sources.map(s=>s.path)].filter(Boolean).join(' · ');
  if(!f?.calendarYear){r.note+=' Tahun buku Januari–Desember belum terkonfirmasi.';return r;}
  if(cost===null||!complete)return r;
  const seen=new Set();let captured=0;
  for(const s of sources)for(const rec of s.rows){
    const state=documentState(rec);
    if(state==='omit')continue;
    const code=String(rec.TaxObjectCode||''),name=String(rec.TaxObject||''),article=String(rec.TaxArticle||'');
    const wording=/land.*building.*rent|rent.*land.*building|sewa.*tanah|sewa.*bangunan/i.test(name);
    if(!code&&!name)return r;
    if(code!=='28-403-02'&&!wording)continue;
    const id=rec.WithholdingSlipsNumber,base=num(rec.TaxBase);
    if(state==='unknown'||!id||seen.has(id)||code!=='28-403-02'||!/4.*2/.test(article)||base===null||usesOtherCurrency(rec))return r;
    seen.add(id);captured+=base;
  }
  r.base=positive(cost-captured);
  if(rented)r.amount=Math.round(r.base/10);else r.note+=' Konfirmasi penggunaan lokasi sewaan dan jenis objek.';
  return r;
}
function debt(f){
  const r=indicator('borrowing-cost','PPh Badan','Biaya pinjaman pada rasio utang terhadap modal di atas 4:1','B.3',notes.debt,
    'Periksa rata-rata saldo akhir bulan, biaya pinjaman yang dapat diperhitungkan, dan apakah WP termasuk golongan yang dikecualikan.');
  const l11=f?.body.L11BFormData,interest=num(f?.accounts.get('5316')?.Amount);
  const liabilities=num(l11?.TotalDebtBalanceAverage),equity=num(l11?.TotalEquityBalanceAverage);
  r.source=f?f.path+' · akun 5316 dan L11BFormData (rata-rata utang dan modal)':'';
  r.note='Skenario memakai saldo rata-rata yang tercantum di L11B dan beban bunga L1. Kelayakan pengurang serta pengecualian sektor memerlukan bukti.';
  if(interest===null||liabilities===null||equity===null||equity<=0||liabilities<=0)return r;
  const ratio=liabilities/equity;
  if(present(l11.DebtToEquityRatio)&&(!Number.isFinite(Number(l11.DebtToEquityRatio))||Math.abs(Number(l11.DebtToEquityRatio)-ratio)>0.011))return r;
  r.base=Math.round(interest*positive(1-4/ratio));return r;
}
function related(f,rate){
  const r=indicator('related-loan','PPh Badan','Skenario bunga atas piutang kepada pihak berelasi','B.4',notes.loan,
    'Periksa perjanjian, arus kas, pihak berelasi, jangka pinjaman, bunga yang sudah dibukukan, dan analisis kesebandingan.');
  const balance=num(f?.assets.AC1125);
  r.source=f?f.path+' · AC1125 dan IsTransactionWithRelated':'';
  r.note='Saldo piutang akhir tahun merupakan pembanding. Jenis pinjaman, periode pemanfaatan, dan tingkat bunga perlu dibuktikan.';
  if(balance!==null)r.note+=' Saldo dalam SPT '+balance.toLocaleString('id-ID')+'.';
  r.hasObservation=Boolean(balance>0&&f?.calendarYear&&[true,1,'1'].includes(f.main.IsTransactionWithRelated));
  if(!rate||!Number.isFinite(rate.percent)||rate.percent<0||typeof rate.source!=='string'||!rate.source.trim()){
    r.note+=' Isi tarif dan sumber skenario bunga.';return r;
  }
  if(!f?.calendarYear||balance===null||![true,1,'1'].includes(f.main.IsTransactionWithRelated))return r;
  const estimate=Math.round(balance*rate.percent/100);
  if(!Number.isSafeInteger(estimate)){r.note+=' Nilai skenario melampaui ketelitian angka.';return r;}
  r.base=estimate;r.source+=' · '+rate.source.trim();
  r.note+=' Skenario saldo tetap sepanjang tahun tanpa bunga yang telah dibukukan, dengan tarif '+rate.percent+'%.';return r;
}
export function companyRisks(pkg,year,work){
  const f=company(pkg,year),borrowing=debt(f),loan=related(f,work.indicationLoanRate);
  const tax=num(f?.main.IncomeTaxInAYear),pkp=num(f?.main.TaxableIncome),sales=num(f?.accounts.get('4020')?.Amount);
  const standard=Number(year)>=2022&&f?.end&&sales>50000000000&&pkp>0&&tax!==null&&BigInt(tax)*100n===BigInt(pkp)*22n;
  let extra=0;
  for(const item of [borrowing,loan]){
    if(item.base===null||!standard){item.note+=' Periksa dasar dan tarif SPT Badan sebelum memakai estimasi pokok.';continue;}
    if(['explained','inapplicable'].includes(work.indicationReviews?.[item.ruleId]))continue;
    const before=Math.floor((pkp+extra)/1000)*1000;extra+=item.base;
    const after=Math.floor((pkp+extra)/1000)*1000;
    item.amount=Math.round((after-before)*22/100);
    item.contributions=[{period:f.end,amount:item.amount}];
    item.note+=' Jika isian induk dalam rupiah, skenario mengikuti tarif 22% yang cocok dengan SPT serta pembulatan PKP ke ribuan. Pos lain diasumsikan tetap.';
  }
  return [borrowing,payroll(pkg,year,f),rental(pkg,year,f),loan];
}
