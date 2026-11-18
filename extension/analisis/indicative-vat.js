import {sptDay} from './model.js';
import {listedReturns,usesOtherCurrency} from './return-source.js';
import {documentState,months,num} from './indicative-source.js';

const numberMonth=s=>Number(s.slice(0,4))*12+Number(s.slice(5,7));
const rates='PMK 131 Tahun 2024 · https://jdih.kemenkeu.go.id/dok/pmk-131-tahun-2024/summary';
const creditLaw='Pasal 9 ayat (9) UU PPN · https://pajak.go.id/id/siaran-pers/pengkreditan-pajak-masukan-pasca-implementasi-coretax';
const reporting='Lampiran PER-11/PJ/2025, Formulir A2 · https://jdih.kemenkeu.go.id/api/download/465612a0-fca6-4f3e-8c9f-b32970ad49af/Lampiran%20PER-11%20PJ%202025.pdf';
function risk(pkg,year,facility){
  const part=facility?'a2':'b2',ruleId=facility?'vat-facility':'vat-input-late';
  const result=facility?{ruleId,kind:'PPN',title:'Fasilitas PPN pada faktur kode 07 atau 08',ref:'N.5',
    evidence:'Cocokkan dokumen fasilitas, identitas penerima, DPP per faktur, dan pembayaran yang telah diperhitungkan.',law:'Pasal 16B UU PPN · '+rates+' · '+reporting}
    :{ruleId,kind:'PPN',title:'Faktur masukan dikreditkan setelah tiga masa',ref:'N.10',
      evidence:'Periksa tanggal faktur, masa pengkreditan, pembetulan, dan pemenuhan syarat Pajak Masukan.',law:creditLaw};
  let base=0,principal=0,count=0,recorded=0,rateDifferences=0,anchorDifferences=0,unpriced=0,estimated=0;
  const contributions=[],paths=[],seen=new Map(),missing=[],withoutReturn=[],listed=listedReturns(pkg,year,'VAT_VATR');
  for(const [i,source] of months(pkg,year,'PPN',part).entries()){
    const period=year+'-'+String(i+1).padStart(2,'0');
    if(!source){
      const expected=listed.has(period)||pkg.forms.some(f=>f.type==='PPN'&&f.period===period);
      (expected?missing:withoutReturn).push(period);continue;
    }
    let monthBase=0,monthTax=0,zeroBase=0,valid=true,monthCount=0,monthDifferences=0,monthAnchors=0,unknownRate=0,estimatedCount=0;
    for(const r of source.rows){
      const state=documentState(r);
      if(state==='omit')continue;
      if(state==='unknown'){valid=false;break;}
      const date=sptDay(r.DocumentDate),number=String(r.DocumentNumber??'').trim();
      const invoiceCode=number.slice(0,2),transaction=String(r.TransactionCode||'').match(/(?:^|[.])(?:003)?(\d{2})$/)?.[1];
      if(!date||!number||facility&&transaction&&transaction!==invoiceCode){valid=false;break;}
      const age=numberMonth(period)-numberMonth(date);
      const matches=facility?['07','08'].includes(invoiceCode):age>3;
      const id=JSON.stringify([r.TIN,number,date]),basis=num(r.TaxBase),vat=num(r.VAT);
      if(seen.has(id)&&(seen.get(id)||matches)){valid=false;break;}
      seen.set(id,matches);
      if(age<0&&(facility?matches:true))monthAnchors++;
      if(!matches)continue;
      if(!r.TIN||usesOtherCurrency(r)||basis===null||vat===null){valid=false;break;}
      if(facility){
        const other=num(r.OtherTaxBase);
        if(date<'2022-04-01'){valid=false;break;}
        const different=num(r.STLG)!==0||date>='2025-01-01'&&(other===null||Math.abs(other-basis*11/12)>1)||
          vat>0&&Math.abs(vat-basis*11/100)>1;
        if(different)monthDifferences++;
        if(vat===0&&basis>0){zeroBase+=basis;estimatedCount++;if(different)unknownRate++;}
      }
      monthBase+=basis;monthTax+=vat;monthCount++;
    }
    if(!valid){missing.push(period);continue;}
    const amount=monthTax+(facility?Math.round(zeroBase*11/100):0);
    base+=monthBase;principal+=amount;count+=monthCount;recorded+=monthTax;rateDifferences+=monthDifferences;
    anchorDifferences+=monthAnchors;unpriced+=unknownRate;estimated+=estimatedCount;paths.push(source.path);
    if(amount)contributions.push(facility?{period,amount,facilityBase:zeroBase,reportedVat:monthTax}:{period,amount});
  }
  const measured=paths.length>0&&!missing.length&&[base,principal,recorded].every(Number.isSafeInteger)&&(!withoutReturn.length||count>0);
  const priced=measured&&unpriced===0;
  const explanation=facility?'Skenario bila syarat fasilitas gagal. Gunakan PPN tercantum pada A2. Untuk nominal nol dengan DPP positif, estimasi efektif 11% memerlukan dasar yang sesuai.'
    :'Selisih bulan dihitung dari tanggal faktur sampai masa SPT terakhir. Jumlah memakai PPN pada faktur yang bersangkutan.';
  const standardScenario=facility&&measured&&count?{amount:principal,contributions,recorded,rateDifferences,anchorDifferences,estimated,count,
    periods:paths.length,missing:withoutReturn.join(', ')}:null;
  return {...result,base:measured?base:null,amount:priced?principal:null,contributions:priced&&(!facility||!anchorDifferences)?contributions:[],standardScenario,
    source:paths.join(' · '),note:[explanation,count+' faktur pada masa yang dapat dibaca.',
      facility?'PPN tercantum di A2 dapat bernilai positif pada transaksi fasilitas. Periksa pemenuhan syarat dan pembayaran sebelum menyimpulkan kekurangan.':'',
      rateDifferences?rateDifferences+' faktur memiliki DPP, PPN, atau PPnBM yang berbeda dari pembanding efektif 11%. Periksa tarif dan dasar per faktur.':'',
      anchorDifferences?anchorDifferences+' faktur bertanggal sesudah masa SPT yang memuatnya. Periksa masa dan tanggal dokumen.':'',
      withoutReturn.length?'Cakupan '+paths.length+' masa. Paket tidak memuat SPT masa '+withoutReturn.join(', ')+'. Angka hanya mencakup masa yang tersedia.':'',
      missing.length?'Periksa cakupan, identitas faktur, jenis penyerahan, atau tarif masa '+missing.join(', ')+'.':''].filter(Boolean).join(' ')};
}
export function vatRisks(pkg,year){return [risk(pkg,year,true),risk(pkg,year,false)];}
