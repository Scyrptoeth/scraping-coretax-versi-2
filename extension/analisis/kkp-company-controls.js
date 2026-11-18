import {signedSumCell} from '../archive/table.js';
import {worksheet} from './model.js';
import {sourceAmount} from './withholding-forms.js';

const accounts=[
  ['4020','Penjualan bersih'],['5020','Harga pokok penjualan'],['4199','Pendapatan lainnya'],
  ['5400','Beban usaha'],['4600','Pendapatan nonusaha'],['5500','Beban nonusaha']
];
const l1Fields=[
  ['FINAL','Penghasilan yang dikenai PPh final','SubjectToFinalTax'],
  ['NONOBJEK','Penghasilan bukan objek pajak','NonTaxableObject'],
  ['POSITIF','Penyesuaian fiskal positif','PositiveFiscalCorrection'],
  ['NEGATIF','Penyesuaian fiskal negatif','NegativeFiscalCorrection']
];
const parentFields=[
  ['FAS-NETO','Pengurangan penghasilan neto','TotalNetIncomeReduction'],['FAS-VOK','Fasilitas vokasi','TotalGrossIncomeVocational'],
  ['FAS-RISET','Fasilitas penelitian','TotalGrossIncomeResearch'],['RUGI','Kompensasi kerugian fiskal','TotalCarriedForward'],
  ['TERUTANG','PPh terutang menurut induk','IncomeTaxInAYear'],['KREDIT-1','Kredit pajak pada induk','TotalIncomeTaxOverseas'],
  ['KREDIT-2','Tambahan pengurang PPh pada induk','TotalIncomeTaxDeduction'],['P25','Angsuran PPh Pasal 25','InstallmentOfIncome'],
  ['STP','Pokok STP PPh Pasal 25','NoticeOfCollection'],
  ['REF-NETO','Penghasilan neto fiskal menurut induk','FiscalNetIncomeAfterTax'],['REF-PKP','PKP menurut induk','TaxableIncome'],
  ['REF-SALDO','PPh kurang/(lebih) bayar menurut induk','UnderpaymentIncomeTax']
];
const formulas=[
  ['KOTOR','Laba kotor',['A4020','-A5020']],['USAHA','Laba atau rugi usaha',['KOTOR','A4199','-A5400']],
  ['LABA','Laba atau rugi komersial sebelum pajak',['USAHA','A4600','-A5500']],
  ['NETO','Penghasilan neto fiskal hasil hitung',['LABA','-FINAL','-NONOBJEK','POSITIF','-NEGATIF']],
  ['FASILITAS','Jumlah fasilitas pengurangan penghasilan neto',['FAS-NETO','FAS-VOK','FAS-RISET']],
  ['PKP','Penghasilan kena pajak hasil hitung',['NETO','-FASILITAS','-RUGI']],
  ['KREDIT','Jumlah kredit pajak pada induk',['KREDIT-1','KREDIT-2']],
  ['SALDO','PPh kurang/(lebih) bayar hasil hitung',['TERUTANG','-KREDIT','-P25','-STP']],
  ['K1','Kontrol laba sebelum pajak terhadap total L1',['LABA','-REF-LABA']],
  ['K2','Kontrol penghasilan neto fiskal terhadap induk',['NETO','-REF-NETO']],
  ['K3','Kontrol PKP terhadap induk',['PKP','-REF-PKP']],['K4','Kontrol PPh kurang/(lebih) bayar terhadap induk',['SALDO','-REF-SALDO']]
];
const components=terms=>terms.map(term=>({key:term.replace(/^-/u,''),sign:term.startsWith('-')?-1:1}));
const sum=items=>items.reduce((n,v)=>n+v,0);

function fiscalInput(tree,field) {
  const {variant,l1,leaves,valid}=tree;
  const totalKey=(variant||'L1')+'TreeTotalRow.'+field;
  const source=variant?variant+'FormData.'+totalKey:'L1a/L1c · '+field;
  if(!valid)return {value:null,source,why:'Pohon akun L1 tidak tersedia atau memuat akun yang bertentangan.'};
  const raw=l1[variant+'TreeTotalRow']?.[field],declared=sourceAmount(raw);
  const amounts=leaves.map(n=>sourceAmount(n.d[field]));
  const complete=leaves.length>0&&amounts.every(Number.isFinite);
  const known=complete?sum(amounts):null;
  if(raw!==undefined&&raw!==null&&raw!==''&&declared===null)
    return {value:null,source,why:'Total L1 tidak dapat dibaca sebagai angka.'};
  if(declared!==null){
    if(complete&&Math.abs(known-declared)>1e-6)return {value:null,source,why:'Total L1 bertentangan dengan jumlah seluruh akun daun yang terisi.'};
    return {value:declared,source};
  }
  return {value:known,source:tree.treeField+' · seluruh akun daun · '+field,why:complete?'':'Total L1 dan sebagian nilai akun daun belum tersedia.'};
}

function reportedCurrency(body,form) {
  const codes=[body?.CurrencyCode,body?.MainFormData?.CurrencyCode,form.meta?.CurrencyCode]
    .filter(v=>v!==undefined&&v!==null&&v!=='').map(v=>String(v).trim().toUpperCase());
  if(codes.length)return new Set(codes).size===1&&/^[A-Z]{3}$/.test(codes[0])?codes[0]:'Bertentangan atau tidak dikenali';
  return 'Belum dinyatakan';
}

export function companyReconciliation(body,tree,path,form) {
  const support=[],seen=new Map(),missing=new Map();
  const unit=reportedCurrency(body,form);
  function input(key,title,value,source,why=''){
    const number=Number.isFinite(value)?value:null;
    const note=number===null?(why||'Nilai sumber belum tersedia atau belum terbaca.'):why;
    support.push({Kode:key,Uraian:title,Nilai:number,Satuan:unit,Sumber:path+' · '+source,Keterangan:note});
    seen.set(key,number);
    missing.set(key,number===null?[key+' ('+source+')']:[]);
  }
  for(const [code,title] of accounts){
    const found=tree.byCode.get(code),source=found?found.at+'.Amount':'L1 · akun '+code+' · Amount';
    const overlaps=found&&accounts.some(([other])=>{
      const peer=tree.byCode.get(other);
      return peer&&other!==code&&(peer.at.startsWith(found.at.slice(0,-5)+'.Children')||found.at.startsWith(peer.at.slice(0,-5)+'.Children'));
    });
    const why=!tree.valid?'Pohon akun L1 tidak tersedia atau memuat akun yang bertentangan.':
      overlaps?'Salah satu akun pembanding merupakan bagian dari subtotal akun ini atau sebaliknya.':'';
    input('A'+code,title+' · akun '+code,why?null:sourceAmount(found?.d?.Amount),source,why);
  }
  for(const [key,title,field] of l1Fields){
    const {value,source,why}=fiscalInput(tree,field);
    input(key,title,value,source,why);
  }
  for(const [key,title,field] of parentFields)input(key,title,sourceAmount(body?.MainFormData?.[field]),'MainFormData.'+field);
  const totalKey=tree.variant?tree.variant+'FormData.'+tree.variant+'TreeTotalRow.Amount':'L1a/L1c · TreeTotalRow.Amount';
  input('REF-LABA','Laba komersial menurut total L1',sourceAmount(tree.l1?.[tree.variant+'TreeTotalRow']?.Amount),totalKey);
  for(const [key,title,terms] of formulas){
    const parts=components(terms);
    const absent=[...new Set(parts.flatMap(part=>missing.get(part.key)))];
    if(unit==='Bertentangan atau tidak dikenali')absent.push('kode mata uang pada sumber');
    else if(key==='PKP'&&unit!=='IDR')absent.push('satuan rupiah untuk perhitungan PKP');
    const amount=absent.length?null:sum(parts.map(({key,sign})=>sign*seen.get(key)));
    const result=amount!==null&&key==='PKP'?Math.max(0,Math.floor(amount/1000)*1000):amount;
    const expression=terms.map((s,i)=>s.startsWith('-')?' − '+s.slice(1):i?' + '+s:s).join('');
    const rounding=key==='PKP'&&unit==='IDR'?' Hasil positif dibulatkan ke bawah ke ribuan rupiah. Hasil negatif menjadi nol.':'';
    const status=absent.length?'Belum dapat dihitung. Periksa '+absent.join(', ')+'.':
      /^K[1-4]$/.test(key)?result===0?'Sesuai dengan angka sumber.':'Terdapat selisih dengan angka sumber.':'';
    support.push({Kode:key,Uraian:title,Nilai:result,Satuan:unit,Sumber:path+' · '+expression,Keterangan:(status+rounding).trim()});
    seen.set(key,result);missing.set(key,absent);
  }
  return support;
}

export function companySupportWorksheet(group,firstDataRow){
  const rows=worksheet(group.support);
  if(!group.companyReconciliation)return rows;
  const index=new Map(group.support.map((r,i)=>[r.Kode,i]));
  for(const [key,,terms] of formulas){
    const i=index.get(key),{Nilai:amount,Satuan:unit}=group.support[i];
    if(unit==='Bertentangan atau tidak dikenali'||(key==='PKP'||key==='K3')&&unit!=='IDR')continue;
    const cells=components(terms).map(({key,sign})=>({row:firstDataRow+index.get(key),sign}));
    rows[i+1][2]=signedSumCell(cells,3,amount,key==='PKP');
  }
  return rows;
}
