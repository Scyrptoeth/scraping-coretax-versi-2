import {payloads} from './model.js';

const ownDeliveries = ['DomesticDeliveriesOtherThanOtherValue', 'DomesticDeliveriesUsingOtherValue',
  'DomesticDeliveriesToTourist', 'DomesticDeliveriesSelfCollected'];
const domesticPurchases = ['DomesticTaxableGoodsWithInvoiceCode01', 'DomesticTaxableGoodsWithInvoiceCode02',
  'DomesticTaxableGoodsUsingOtherValueTaxBase'];
const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

function value(record, group, field) {
  const amount=record[group]?.[field];
  return Number.isFinite(amount) ? amount : null;
}
function sum(values) {
  return values.length && values.every(Number.isFinite) ? values.reduce((a,b)=>a+b,0) : null;
}
function difference(base, components) {
  const rest=sum(components);
  return base===null || rest===null ? null : base-rest;
}

function monthlyAmounts(record,period,notes) {
  const price=group=>value(record,group,'SellingPrice');
  const vat=group=>value(record,group,'VAT');
  const exports=price('ExportTangibleTaxableGoods');
  const taxable='DeliveryOfTaxableGoodsSubjectToVAT';
  let selfBase=sum(ownDeliveries.map(price));
  const remainder=difference(price(taxable),[exports]);
  if((selfBase===null || selfBase===0) && remainder!==null) selfBase=Math.max(0,remainder);
  const directVat=vat('OutputTaxMustBeSelfCollected');
  const taxableVat=vat(taxable);
  let selfVat=directVat;
  if((selfVat===0 || selfVat===null) && taxableVat!==null) {
    selfVat=taxableVat;
    if(selfVat!==directVat) notes.push({Masa:period,Kolom:'PPN dipungut sendiri (PK)',
      'Nilai isian utama':directVat,'Nilai dalam rekap':selfVat,'Isian yang digunakan':taxable+'.VAT'});
  }
  const totalInput=vat('InputTaxCanBeCalculated'),credit=vat('CarryForwardOfInputTax'),importInput=vat('ImportOfTaxableGoods');
  let domesticVat=sum(domesticPurchases.map(vat));
  const currentInput=difference(totalInput,[credit,importInput]);
  if((domesticVat===0 || domesticVat===null) && currentInput!==null && currentInput>0) domesticVat=currentInput;
  const otherInput=totalInput===0 ? 0 : difference(totalInput,[credit,importInput,domesticVat]);
  return {
    'DPP Ekspor':exports,'DPP dipungut sendiri':selfBase,'DPP dipungut Pemungut':price('DomesticDeliveriesCollectedByVATCollector'),
    'DPP tidak dipungut':price('DomesticDeliveriesUncollectedVAT'),'DPP dibebaskan':price('DomesticDeliveriesExemptedVAT'),
    'DPP tidak terutang':price('DeliveriesOfGoodsNoVAT'),'PPN dipungut sendiri (PK)':selfVat,
    'DPP impor':price('ImportOfTaxableGoods'),'PM impor':importInput,'DPP perolehan DN':sum(domesticPurchases.map(price)),
    'PM perolehan DN':domesticVat,'DPP PM tidak dapat dikreditkan':price('ImportsOfUncreditedInput'),
    'Penyesuaian PM lain (induk)':otherInput===null ? null : Math.abs(otherInput)<1 ? 0 : otherInput,
    'Kompensasi bulan lalu':credit,'PPN disetor dimuka':vat('VATIsDepositedInAdvance'),
    'PPN harus disetor':vat('VATPayable'),'PPN kurang/(lebih) bayar':vat('VATUnderOrOverPaid')
  };
}

export function annualVat(forms,year) {
  const formsByMonth=new Map(forms.filter(f=>f.latest && f.type==='PPN' && f.year===year).map(f=>[f.period,f]));
  if(!formsByMonth.size) return null;
  const notes=[],reported=[];
  const rows=months.map((month,i)=>{
    const period=year+'-'+String(i+1).padStart(2,'0'),form=formsByMonth.get(period);
    if(!form) return {Masa:month};
    const amounts=monthlyAmounts(payloads(form.parts.get('induk'))[0] || {},period,notes);
    reported.push(amounts);
    return {Masa:month,...amounts};
  });
  if(!reported.length) return null;
  const total={Masa:'Jumlah masa tersedia'};
  for(const key of Object.keys(reported[0])) total[key]=sum(reported.map(r=>r[key]));
  // The reference reads these rolling positions by period. Adding them counts
  // balances carried between returns more than once.
  total['Kompensasi bulan lalu']=null;
  total['PPN kurang/(lebih) bayar']=null;
  return {rows:[...rows,total],notes,available:reported.length};
}
