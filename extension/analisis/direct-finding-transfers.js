import {normalizeId} from '../app-data.js';
import {rowsOf,sptDay} from './model.js';
import {usesOtherCurrency} from './return-source.js';
import {paymentDeadline} from './direct-finding-calendar.js';

const transfers={ICT_WITR:{type:'PPH2126',label:'PPh 21/26'},ICT_WTR:{type:'UNIFIKASI',label:'PPh Unifikasi'},VAT_VATR:{type:'PPN',label:'PPN'}};
export const monthlyAccounts={PPN:['411211'],PPH2126:['411121'],UNIFIKASI:['411124','411128','411127','411122','411123']};
export function observedTransferRows(pkg,year,asOf){
  const table={title:'Pemindahbukuan yang perlu dicocokkan dengan tanggal bayar',columns:['Jenis pajak','Masa','Jenis kewajiban','Tanggal transaksi buku besar',
    'Batas umum penyetoran','Jumlah dialokasikan (Rp)','Referensi pemindahbukuan pada buku besar','Sumber','Bukti yang perlu diperiksa'],rows:[]};
  const owner=normalizeId(pkg.manifest.wp?.npwp);
  if(!owner||/^0+$/.test(owner)||pkg.report?.valid===false)return table;
  const seen=new Map(),conflicts=new Set();
  for(const e of pkg.entries||[]){
    const match=/^bukubesar\/(20\d\d-(?:0[1-9]|1[0-2]))\.json$/.exec(e.path),period=match?.[1],cap=e.cap||{};
    if(!period||period.slice(0,4)!==String(year)||normalizeId(cap.konteks?.npwp)!==owner||!e.pages?.length||
      e.pages.some(p=>!p||p.IsSuccessful===false||p.Errors?.length)||usesOtherCurrency(cap,cap.konteks)||
      (pkg.manifest.gagal||[]).some(f=>[e.path,'data/'+e.path].includes(typeof f==='string'?f:f?.path)))continue;
    const code=period.slice(5).repeat(2)+year;
    if((cap.konteks.tahun!=null&&String(cap.konteks.tahun)!==String(year))||(cap.konteks.masa!=null&&Number(cap.konteks.masa)!==Number(period.slice(5))))continue;
    const rows=rowsOf(e),byId=new Map(),ambiguous=new Set();
    for(const row of rows){
      const id=row.RecordId;
      if(!id)continue;
      if(byId.has(id)&&JSON.stringify(byId.get(id))!==JSON.stringify(row))ambiguous.add(id);
      byId.set(id,row);
    }
    for(const pay of byId.values()){
      if(pay.AccountingTypeCode!=='Payment'||pay.AccountingTypeDetailCode!=='BT'||pay.ReferenceType!=='Balance Transfer In'||
        pay.PaymentCode!=='100'||pay.PeriodCode!==code||!pay.ReferenceNumber||pay.IsCancelled!==false||ambiguous.has(pay.RecordId))continue;
      const debt=byId.get(pay.RelatedRecordId),type=debt&&transfers[debt.ReferenceType];
      if(!type||debt.AccountingTypeCode!=='TaxReturn'||debt.IsCancelled!==false||ambiguous.has(debt.RecordId)||pay.PeriodCode!==debt.PeriodCode||
        pay.RevenueCode!==debt.RevenueCode||!monthlyAccounts[type.type].includes(String(pay.RevenueCode))||usesOtherCurrency(pay,debt)||
        [pay.TaxpayerTIN,debt.TaxpayerTIN].filter(Boolean).some(t=>normalizeId(t)!==owner))continue;
      const due=paymentDeadline(type.type,period),day=sptDay(pay.TransactionDate);
      if(!due||!day||day<=due||asOf&&day>asOf)continue;
      const pieces=pay.TaxpayerAccountingDetails;
      if(!Array.isArray(pieces)||!Number.isSafeInteger(pay.Amount)||!Number.isSafeInteger(pay.AmountLeft)||
        pay.AmountLeft<0||pay.AmountLeft>=pay.Amount)continue;
      const allocations=pieces.filter(d=>d.AccountingTypeCode==='TaxReturn');
      if(allocations.length!==1)continue;
      const [d]=allocations,allocated=pay.Amount-pay.AmountLeft;
      if(d.HeaderRecordId!==pay.RecordId||d.ReconciledRecordId!==debt.RecordId||d.PeriodCode!==code||
        d.RevenueCode!==pay.RevenueCode||d.ReferenceType!==debt.ReferenceType||usesOtherCurrency(d)||d.Amount!==-allocated)continue;
      const id=pay.RecordId;
      const revision={N:'SPT normal',A:'Pembetulan SPT'}[debt.AccountingTypeDetailCode]||'SPT pada buku besar';
      const note='Tanggal bayar yang berlaku perlu dicocokkan dengan BPN atau Bukti Pemindahbukuan sesuai PMK 81/2024. '+
        (debt.AccountingTypeDetailCode==='A'?'Periksa kenaikan pajak dan dasar Pasal 8 ayat (2a) untuk pembetulan SPT masa.':'Periksa dasar sanksi setelah tanggal bayar terkonfirmasi.');
      const values=[type.label,period,revision,day,due,allocated,pay.ReferenceNumber,e.path+' · '+pay.RecordId+' → '+debt.RecordId,note];
      if(seen.has(id)&&JSON.stringify(seen.get(id))!==JSON.stringify(values))conflicts.add(id);
      seen.set(id,values);
    }
  }
  for(const [id,row] of seen)if(!conflicts.has(id))table.rows.push(row);
  return table;
}
