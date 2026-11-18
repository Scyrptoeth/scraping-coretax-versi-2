import {normalizeId} from '../app-data.js';
import {rowsOf} from './model.js';
import {sourceAmount} from './withholding-forms.js';
import {companyReconciliation} from './kkp-company-controls.js';
import {companyWithoutReturn} from './kkp-company-without-return.js';

const fiscalField='PositiveFiscalCorrection';
const namedCosts=[['5314','Penyusutan dan amortisasi'],['5321','Biaya jamuan'],['5409','Sumbangan']];
const deliveries=[
  ['export','Ekspor BKP berwujud','ExportTangibleTaxableGoods'],
  ['own','Penyerahan dipungut sendiri',null],
  ['collector','Penyerahan dipungut pemungut','DomesticDeliveriesCollectedByVATCollector'],
  ['uncollected','Penyerahan tidak dipungut','DomesticDeliveriesUncollectedVAT'],
  ['exempt','Penyerahan dibebaskan','DomesticDeliveriesExemptedVAT'],
  ['outside','Penyerahan tidak terutang','DeliveriesOfGoodsNoVAT'],
  ['total','Jumlah penyerahan menurut induk SPT PPN','TotalDeliveryOfGoodsAndServices']
];
const present=v=>v!==null&&v!==undefined&&v!=='';
const money=v=>{const n=sourceAmount(v);return Number.isFinite(n)?n:null;};
const total=values=>values.length&&values.every(Number.isFinite)?values.reduce((sum,v)=>sum+v,0):null;
const latest=list=>{const max=Math.max(...list.map(f=>f.version));const items=list.filter(f=>f.version===max);return items.length===1?items[0]:null;};
const reference=(form,part)=>form.parts.get(part)?.path||form.key+'/'+part+'.json';
const support=(Uraian,Nilai,Satuan,Sumber,Keterangan='')=>({Uraian,Nilai,Satuan,Sumber,Keterangan});

export function checkedCompanyEntry(pkg,form,part,{requireOwner=true}={}){
  const e=form.parts.get(part),cap=e?.cap||{},ctx=cap.konteks||{},spt=ctx.spt||{},q=cap.payload||{};
  const declaredOwner=pkg.manifest?.wp?.npwp,npwp=normalizeId(declaredOwner);
  const m=form.period.slice(-2),code=form.type==='BADAN'?'0112'+form.year:m+m+form.year;
  const matches=(values,expected)=>values.filter(present).every(x=>String(x)===String(expected));
  if(!e||(!npwp&&(requireOwner||present(declaredOwner)))||pkg.report?.valid===false||cap.lengkap!==true||!e.pages?.length||
    !matches([cap.halaman],e.pages.length)||e.pages.some(p=>!p||p.IsSuccessful===false||p.Errors?.length)||
    !matches([ctx.bagian],part)||!matches([spt.recordId,q.ReturnSheetRecordId,q.RecordId],form.id)||
    !matches([spt.jenis],form.type==='BADAN'?'ICT_RCITR':'VAT_VATR')||!matches([spt.tahun],form.year)||
    !matches([spt.pemb],form.version)||present(spt.masa)&&![form.period,code].includes(String(spt.masa))||
    [ctx.npwp,spt.npwp].filter(present).some(id=>!npwp||normalizeId(id)!==npwp)||
    Number(q.First)>0||q.Filters?.length||Array.isArray(cap.halamanSumber)&&cap.halamanSumber.some(s=>s?.pencocokan?.morePagesAvailable))return null;
  const failures=Array.isArray(pkg.manifest?.gagal)?pkg.manifest.gagal:[];
  return failures.some(f=>[e.path,'data/'+e.path].includes(typeof f==='string'?f:f?.path))?null:e;
}
function parent(pkg,form){
  const e=checkedCompanyEntry(pkg,form,'induk'),rows=rowsOf(e);
  return rows.length===1?rows[0]:null;
}
function table(pkg,form,part){
  const e=checkedCompanyEntry(pkg,form,part);if(!e)return null;
  const pages=e.pages.map(p=>p.Payload??p),tables=pages.map(p=>Array.isArray(p)?p:p?.Data);
  if(tables.some(t=>!Array.isArray(t)))return null;
  const n=tables.reduce((sum,t)=>sum+t.length,0);
  const totals=[e.cap.total,...pages.map(p=>p?.TotalRecords)].filter(present);
  if(!totals.length||totals.some(t=>!Number.isSafeInteger(t)||t!==n)||(present(e.cap.baris)&&e.cap.baris!==n))return null;
  const limit=e.cap.payload?.Rows;
  if(e.cap.total==null&&e.cap.payload?.First===0&&Number.isSafeInteger(limit)&&limit>0&&n===limit&&tables.at(-1).length)return null;
  if(tables.length>1){
    const seen=new Set();
    for(const rows of tables)for(const r of rows){
      const key=JSON.stringify(r);if(seen.has(key))return null;seen.add(key);
    }
  }
  return tables.flat();
}
function accountsOf(body){
  const variants=Object.entries(body||{}).filter(([k,v])=>/^L1[a-z]FormData$/i.test(k)&&v&&typeof v==='object');
  const variant=variants.length===1&&/^L1[ac]FormData$/.test(variants[0][0])?variants[0][0].slice(0,3):null;
  const l1=variant?variants[0][1]:null,treeField=variant?variant+'FormData.'+variant+'TreeData':'pohon akun L1';
  const nodes=l1?.[variant+'TreeData'];
  const byCode=new Map(),leaves=[];let valid=Boolean(nodes?.length),consistentFiscal=true;
  function visit(nodes,path){
    if(!Array.isArray(nodes)){valid=false;return;}
    nodes.forEach((n,i)=>{
      const d=n?.Data,code=String(d?.AccountCode??'').trim(),at=path+'['+i+']';
      if(!code){valid=false;return;}
      const item={code,d,at:at+'.Data'};
      if(byCode.has(code)){byCode.set(code,null);valid=false;}else byCode.set(code,item);
      if(n.Children!=null&&!Array.isArray(n.Children)){valid=false;return;}
      if(n.Children?.length){
        const start=leaves.length;visit(n.Children,at+'.Children');
        const parentAmount=money(d[fiscalField]),child=leafAmounts(leaves.slice(start));
        if(parentAmount!==null&&parentAmount!==0&&(!child.valid||child.sum>parentAmount||!child.missing&&child.sum!==parentAmount))consistentFiscal=false;
      }else leaves.push(item);
    });
  }
  if(l1)visit(nodes,treeField);
  return {byCode,leaves,l1,variant,treeField,valid,consistentFiscal};
}
function leafAmounts(leaves){
  let sum=0,missing=0,valid=true,count=0;
  for(const {d} of leaves){
    const raw=d[fiscalField],n=money(raw);
    if(!present(raw))missing++;
    else if(n===null||n<0)valid=false;
    else{sum+=n;count++;}
  }
  return {sum,missing,valid,count};
}
function newGroup(ref,title){return {key:'BADAN/'+ref,ref,title,tax:'PPh Badan',lines:[],support:[]};}
function add(group,form,key,topic,amount,source,note=''){
  const id=reference(form,'induk')+'#'+group.ref+'/'+key;
  group.lines.push({id,ref:group.ref,groupKey:group.key,period:form.period,version:form.version,topic,tax:group.tax,
    amount,partial:!Number.isFinite(amount),source:[source,note].filter(Boolean).join(' · ')});
}
function accountSource(at,key,field){return at+' · '+(key?.at||'L1 (akun belum teridentifikasi)')+'.'+field;}

function positiveCorrections(pkg,form,tree){
  const group=newGroup('B.7','Koreksi fiskal positif'),path=reference(form,'induk'),{byCode,l1,leaves,valid}=tree;
  const components=[];
  for(const [code,title] of namedCosts){
    const item=byCode.get(code);
    if(!item){if(byCode.has(code))components.push(null);continue;}
    const reported=money(item.d[fiscalField]),cost=money(item.d.Amount);
    if((cost===null||cost===0)&&reported===0)continue;
    const source=accountSource(path,item,fiscalField);
    add(group,form,'account-'+code,title+' · akun '+code,reported,source);
    group.support.push(support('Biaya komersial · '+code,cost,'Rp',accountSource(path,item,'Amount')),
      support('Koreksi fiskal negatif · '+code,money(item.d.NegativeFiscalCorrection),'Rp',accountSource(path,item,'NegativeFiscalCorrection')));
    components.push(reported);
  }
  const detail=leafAmounts(leaves);
  const sumDetail=valid&&tree.consistentFiscal&&detail.valid&&!detail.missing?detail.sum:null;
  const totalField=tree.variant?tree.variant+'FormData.'+tree.variant+'TreeTotalRow.'+fiscalField:'Total koreksi fiskal positif L1';
  const raw=l1?.[tree.variant+'TreeTotalRow']?.[fiscalField];
  const declared=money(raw),usingDeclared=declared!==null&&declared>=0;
  const invalidDeclared=present(raw)&&!usingDeclared;
  const grand=usingDeclared?declared:invalidDeclared?null:sumDetail;
  const detailSource=path+' · '+tree.treeField+' · akun daun · '+fiscalField;
  const grandSource=usingDeclared?path+' · '+totalField:detailSource;
  const attributed=components.length?total(components):0;
  // Known nonnegative leaf amounts can exhaust an independently declared total even when other cells are blank.
  const covered=valid&&tree.consistentFiscal&&detail.valid&&detail.count>0&&usingDeclared&&detail.sum===declared;
  const classified=covered?leaves.filter(item=>!namedCosts.some(([code])=>code===item.code)).reduce((sum,item)=>sum+(money(item.d[fiscalField])??0),0):null;
  const namedLeavesOnly=namedCosts.every(([code])=>!byCode.has(code)||leaves.includes(byCode.get(code)));
  const confirmed=classified!==null&&namedLeavesOnly;
  const remaining=confirmed?classified:valid&&tree.consistentFiscal&&detail.valid&&grand!==null&&attributed!==null&&grand>=attributed&&
    (!usingDeclared||detail.sum<=grand)?grand-attributed:null;
  const note=invalidDeclared?'Total koreksi pada L1 tidak terbaca sebagai angka positif atau nol.':!tree.consistentFiscal?'Subtotal akun bertentangan dengan rincian akun daun.':covered?'Jumlah akun daun yang terisi sesuai dengan total L1.':
    usingDeclared&&declared!==sumDetail?'Jumlah dinyatakan pada total L1. Pembagian seluruh selisih tersebut ke akun belum didukung rincian.':'';
  add(group,form,'other','Koreksi positif lainnya menurut L1',remaining,confirmed?grandSource+' · dicocokkan dengan '+detailSource:grandSource+' · dikurangi jumlah koreksi akun yang dirinci pada indeks ini',
    confirmed?'Jumlah nilai positif pada akun daun yang terisi cocok dengan total L1. Sel akun yang kosong tetap kosong.':note);
  group.support.push(support('Jumlah koreksi positif menurut SPT',grand,'Rp',grandSource,note),
    support('Jumlah koreksi positif dari akun daun',sumDetail,'Rp',detailSource),
    support('Selisih total L1 dengan jumlah akun daun',declared===null||sumDetail===null?null:declared-sumDetail,'Rp',grandSource+' · '+detailSource));
  for(const item of leaves){
    const amount=money(item.d[fiscalField]);
    if(amount!==0&&!namedCosts.some(([code])=>code===item.code))group.support.push(support('Rincian koreksi positif akun '+item.code,amount,'Rp',accountSource(path,item,fiscalField)));
  }
  for(const [part,label] of [['l9-1-2','Penyusutan fiskal · L9 tabel 1.2'],['l11a-2','Daftar nominatif · L11A tabel 2']]){
    const rows=table(pkg,form,part),src=reference(form,part);
    group.support.push(support(label+' · jumlah baris',rows?.length??null,'baris',src,rows?'':'Cakupan tabel belum terkonfirmasi.'));
    if(part==='l9-1-2')group.support.push(support(label+' · nilai tahun ini',rows?rows.length?total(rows.map(r=>money(r?.FiscalYearValue))):0:null,'Rp',
      src+' · FiscalYearValue','Hanya mencakup tabel 1.2 yang dirujuk.'));
  }
  return group;
}
function equalization(pkg,form,tree,baseLines){
  const g=newGroup('B.1.4','Ekualisasi peredaran usaha dan penyerahan PPN'),path=reference(form,'induk');
  const accounts=['4020','4199'].map(code=>tree.byCode.get(code)),values=accounts.map(a=>money(a?.d.Amount));
  const accountSources=accounts.map(a=>accountSource(path,a,'Amount'));
  for(const [i,code] of ['4020','4199'].entries())g.support.push(support('Peredaran usaha · akun '+code,values[i],'Rp',accountSources[i]));
  const nested=accounts.every(Boolean)&&(accounts[0].at.startsWith(accounts[1].at.slice(0,-5)+'.Children')||
    accounts[1].at.startsWith(accounts[0].at.slice(0,-5)+'.Children'));
  const sales=tree.valid&&!nested?total(values):null;
  add(g,form,'sales','Peredaran usaha · akun 4020 + 4199',sales,accountSources.join(' + '),sales===null?'Kedua nilai komersial dari akun yang terpisah diperlukan.':'');
  if(sales===null&&tree.valid&&Number.isFinite(values[0]))add(g,form,'reported-sales','Subtotal peredaran usaha yang tercantum · akun 4020',values[0],accountSources[0],
    'Akun 4020 dapat ditelusuri tersendiri. Jumlah gabungan menunggu nilai akun 4199 yang dapat dibedakan dari subtotal ini.');
  const periods=new Map();
  for(const f of pkg.forms.filter(f=>f.type==='PPN'&&f.year===form.year&&/^\d{4}-(0[1-9]|1[0-2])$/.test(f.period))){
    if(!periods.has(f.period))periods.set(f.period,[]);periods.get(f.period).push(f);
  }
  const months=Array.from({length:12},(_,i)=>{
    const period=form.year+'-'+String(i+1).padStart(2,'0'),f=latest(periods.get(period)||[]);
    return {period,f,body:f?parent(pkg,f):null};
  });
  const amounts=new Map(),sources=new Map();
  for(const [code,title,field] of deliveries){
    const records=months.map(({f,period,body})=>{
      if(!f||!body)return {n:null,source:period+' · induk SPT PPN belum tersedia sebagai satu versi lengkap.'};
      if(code==='own'){
        const l=baseLines.find(x=>x.period===period&&x.version===f.version&&!x.partial&&x.id?.startsWith(reference(f,'induk')+'#'));
        return {n:l?.amount??null,source:l?.source||reference(f,'induk')+' · DPP dipungut sendiri belum terkonfirmasi.'};
      }
      return {n:money(body[field]?.SellingPrice),source:reference(f,'induk')+' · '+field+'.SellingPrice'};
    });
    const n=total(records.map(r=>r.n)),source=records.map(r=>r.source).join('\n');
    const verified=records.filter(r=>Number.isFinite(r.n)).length;
    add(g,form,'vat-'+code,title,n,source,verified+' dari 12 masa memiliki nominal sumber.');
    amounts.set(code,n);sources.set(code,source);
  }
  const direct=amounts.get('total'),sum=total(deliveries.slice(0,-1).map(([code])=>amounts.get(code)));
  const consistent=direct===null||sum===null||Math.abs(direct-sum)<0.000001;
  const basis=direct??sum;
  const combinedSource=[...accountSources,direct!==null?sources.get('total'):'Jumlah enam kelompok penyerahan pada indeks ini.'].join('\n');
  const gap=Number.isFinite(sales)&&Number.isFinite(basis)&&consistent?sales-basis:null;
  g.support.push(support('Jumlah enam kelompok penyerahan',sum,'Rp','Enam baris penyerahan di atas.'),
    support('Selisih peredaran usaha dengan penyerahan',gap,'Rp',combinedSource,consistent?'Peredaran usaha dikurangi penyerahan. Periksa alasan ekonominya.':'Jumlah penyerahan dan rinciannya berbeda.'),
    support('Persentase selisih terhadap peredaran usaha',sales&&gap!==null?100*gap/sales:null,'%',combinedSource));
  if(tree.valid&&Number.isFinite(values[0])&&!present(accounts[1]?.d.Amount)){
    const subtotal=values[0],subtotalGap=consistent&&basis!==null?subtotal-basis:null;
    const vatSource=direct!==null||sum===null?sources.get('total'):deliveries.slice(0,-1).map(([code])=>sources.get(code)).join('\n');
    const source=accountSources[0]+'\n'+vatSource;
    const note=!consistent?'Jumlah penyerahan dan rinciannya berbeda.':basis===null?'Data penyerahan PPN untuk 12 masa belum lengkap.':
      'Subtotal akun 4020 dikurangi penyerahan PPN. Akun 4199 belum memiliki nilai.';
    g.support.push(support('Selisih subtotal akun 4020 dengan penyerahan',subtotalGap,'Rp',source,note),
      support('Persentase selisih terhadap subtotal akun 4020',subtotalGap!==null&&subtotal!==0?100*subtotalGap/subtotal:null,'%',source,
        subtotal===0?'Subtotal akun 4020 sebagai pembagi bernilai nol.':subtotalGap===null?note:'Selisih dibagi subtotal akun 4020, lalu dikalikan 100.'));
  }
  return g;
}

export function companyAnnexIndices(pkg,year,index={}){
  const forms=pkg.forms.filter(f=>f.type==='BADAN'&&f.period===String(year));
  if(!forms.length)return companyWithoutReturn(pkg,String(year),checkedCompanyEntry);
  const f=latest(forms);
  if(!f)return {groups:[],warnings:['Indeks B.1.4 dan B.7 menunggu identifikasi satu SPT Badan versi terakhir untuk '+year+'.']};
  const body=parent(pkg,f),tree=accountsOf(body),groups=index.groups instanceof Map?[...index.groups.values()]:index.groups||[];
  const base=groups.find(g=>g.key==='PPN/N.3')?.lines||[];
  const annual=groups.find(g=>g.key==='BADAN/B')||newGroup('B','Induk PPh Badan');
  const current={...annual,companyReconciliation:true,support:companyReconciliation(body,tree,reference(f,'induk'),f)};
  return {groups:[current,equalization(pkg,f,tree,base),positiveCorrections(pkg,f,tree)],warnings:[]};
}
export {table as checkedCompanyTable};
