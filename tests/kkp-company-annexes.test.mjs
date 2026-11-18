import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {readPackage} from '../extension/archive/package.js';
import {indexPackage} from '../extension/analisis/model.js';
import {assessLine,buildIndex,indexSheets} from '../extension/analisis/kkp-index.js';
import {companyAnnexIndices} from '../extension/analisis/kkp-company-annexes.js';

const npwp='0000000000000017';
function account(code,cost,positive=0,children=[]){
  return {Data:{AccountCode:code,Amount:cost,PositiveFiscalCorrection:positive,NegativeFiscalCorrection:0},Children:children};
}
function corporate({turnover=100,otherSales=5,jamuan=2,reported=7,extra=[]}={}){
  return {L1cFormData:{L1cTreeData:[account('4020',turnover),account('4199',otherSales),account('5314',12,1),
    account('5321',22,jamuan),account('5409',11,0),...extra],L1cTreeTotalRow:{PositiveFiscalCorrection:reported}}};
}
const asPrice=n=>({SellingPrice:n});
function vat(total=6){
  return {ExportTangibleTaxableGoods:asPrice(1),DomesticDeliveriesOtherThanOtherValue:asPrice(0),DomesticDeliveriesUsingOtherValue:asPrice(1),
    DomesticDeliveriesToTourist:asPrice(0),DomesticDeliveriesSelfCollected:asPrice(0),DomesticDeliveriesCollectedByVATCollector:asPrice(1),
    DomesticDeliveriesUncollectedVAT:asPrice(1),DomesticDeliveriesExemptedVAT:asPrice(1),DeliveriesOfGoodsNoVAT:asPrice(1),
    TotalDeliveryOfGoodsAndServices:asPrice(total)};
}
function entry(type,period,body,{part='induk',version=0,id='demo-'+version,cap={},owner=npwp}={}){
  const rows=Array.isArray(body),payload=rows?{TotalRecords:body.length,Data:body}:{CurrentFormData:JSON.stringify(body)};
  const ctx={npwp:owner,bagian:part,spt:{npwp:owner,masa:period,tahun:period.slice(0,4),pemb:version,
    recordId:id,jenis:type==='BADAN'?'ICT_RCITR':'VAT_VATR'}};
  return {path:'spt/'+type+'/'+period+'/p'+String(version).padStart(2,'0')+'_'+id+'/'+part+'.json',
    cap:{lengkap:true,halaman:1,konteks:ctx,...(rows?{total:body.length,baris:body.length}:{}),...cap},pages:[{IsSuccessful:true,Payload:payload}]};
}
function sample(cit=corporate(),monthly=Array.from({length:12},()=>vat()),more=[]){
  return indexPackage({entries:[entry('BADAN','2025',cit),...monthly.flatMap((v,i)=>v?[entry('PPN','2025-'+String(i+1).padStart(2,'0'),v)]:[]),...more],
    manifest:{wp:{npwp}},report:{valid:true}});
}
const get=(r,ref)=>r.groups.find(g=>g.ref===ref);
const line=(g,key)=>g.lines.find(l=>l.id.endsWith('/'+key));
const auxiliary=(g,field)=>g.support.find(item=>item.Uraian===field);
const model=p=>companyAnnexIndices(p,'2025',buildIndex(p,'2025'));
const subtotalGap='Selisih subtotal akun 4020 dengan penyerahan';
const subtotalPercent='Persentase selisih terhadap subtotal akun 4020';
test('turnover tie-out uses two distinct commercial accounts, six declared classes and the independent annual total',()=>{
  const p=sample(),g=get(model(p),'B.1.4');
  assert.equal(line(g,'sales').amount,105);assert.equal(line(g,'vat-own').amount,12);assert.equal(line(g,'vat-total').amount,72);
  assert.equal(auxiliary(g,'Jumlah enam kelompok penyerahan').Nilai,72);assert.equal(auxiliary(g,'Selisih peredaran usaha dengan penyerahan').Nilai,33);
  assert.equal(auxiliary(g,'Persentase selisih terhadap peredaran usaha').Nilai,100*33/105);
  assert.equal(auxiliary(g,subtotalGap),undefined);assert.equal(auxiliary(g,subtotalPercent),undefined);
  assert.match(line(g,'vat-export').source,/2025-12\/p00_demo-0\/induk.json/);assert.match(line(g,'sales').source,/Data.Amount/);
  assert.ok(indexSheets(g,new Map()).rows.slice(6,6+g.lines.length).every(row=>row[4]===null));
  const l=line(g,'sales'),r=assessLine(l,{value:120,document:'Rekening fiktif',officer:'Penguji',note:'Uji transaksi'});
  assert.equal(r.menurutPetugas,120);assert.equal(l.amount,105);
});
test('a separately reported 4020 subtotal compares with VAT without supplying the missing account 4199',()=>{
  const months=Array.from({length:12},()=>vat());
  const pkg=sample(corporate(),months,[entry('BADAN','2025',corporate({turnover:48,otherSales:null}),{version:1}),
    entry('PPN','2025-02',vat(),{version:1,id:'new-feb'})]);
  const group=get(model(pkg),'B.1.4'),delta=auxiliary(group,subtotalGap),pct=auxiliary(group,subtotalPercent);
  assert.deepEqual([delta.Nilai,pct.Nilai],[-24,-50]);assert.deepEqual([delta.Satuan,pct.Satuan],['Rp','%']);
  assert.match(delta.Sumber,/BADAN\/2025\/p01_demo-1\/induk.json.*L1cTreeData\[0\].Data.Amount/);
  assert.match(delta.Sumber,/PPN\/2025-02\/p01_new-feb\/induk.json.*TotalDeliveryOfGoodsAndServices.SellingPrice/);
  assert.equal(delta.Sumber,pct.Sumber);assert.match(delta.Keterangan,/4199/);
  assert.equal(line(group,'sales').amount,null);assert.equal(auxiliary(group,'Selisih peredaran usaha dengan penyerahan').Nilai,null);
  assert.equal(auxiliary(group,'Persentase selisih terhadap peredaran usaha').Nilai,null);
  const exported=indexSheets(group,new Map()).rows;
  assert.ok(exported.some(row=>row[0]===subtotalGap&&row[1]===-24));
  assert.ok(exported.some(row=>row[0]===subtotalPercent&&row[1]===-50));
});
test('subtotal comparisons retain reported zero, missing VAT coverage, conflicting totals and unusable account evidence',()=>{
  const group=(cit,months)=>get(model(sample(cit,months)),'B.1.4');
  const measure=(g)=>[auxiliary(g,subtotalGap)?.Nilai,auxiliary(g,subtotalPercent)?.Nilai];
  assert.deepEqual(measure(group(corporate({turnover:0,otherSales:null}))),[-72,null]);
  const zero=Array.from({length:12},()=>Object.fromEntries(Object.keys(vat()).map(field=>[field,asPrice(0)])));
  const cit=corporate({otherSales:null});assert.deepEqual(measure(group(cit,zero)),[100,100]);
  assert.deepEqual(measure(group(cit,[vat()])),[null,null]);
  assert.deepEqual(measure(group(cit,Array.from({length:12},()=>vat(7)))),[null,null]);
  const detailed=Array.from({length:12},()=>{const item=vat();delete item.TotalDeliveryOfGoodsAndServices;return item;});
  const detailGroup=group(cit,detailed);assert.deepEqual(measure(detailGroup),[28,28]);
  assert.match(auxiliary(detailGroup,subtotalGap).Sumber,/ExportTangibleTaxableGoods.SellingPrice/);
  for(const invalid of [corporate({turnover:null,otherSales:null}),corporate({otherSales:'?'}),
    corporate({otherSales:null,extra:[account('4020',5)]}),corporate({otherSales:0})]){
    assert.deepEqual(measure(group(invalid)),[undefined,undefined]);
  }
});
test('unknown or duplicate accounts, incomplete periods and contradictory sales totals keep the final gap undetermined',()=>{
  for(const cit of [corporate({otherSales:null}),corporate({extra:[account('4199',0)]}),
    {L1dFormData:{L1dTreeData:[]}}]){
    const g=get(model(sample(cit)),'B.1.4');assert.equal(line(g,'sales').amount,null);assert.equal(auxiliary(g,'Selisih peredaran usaha dengan penyerahan').Nilai,null);
  }
  const missing=sample(corporate(),[vat()]);
  const gap=get(model(missing),'B.1.4');assert.equal(line(gap,'vat-total').amount,null);assert.match(line(gap,'vat-total').source,/1 dari 12/);
  const wrong=get(model(sample(corporate(),Array.from({length:12},()=>vat(7)))),'B.1.4');
  assert.equal(line(wrong,'vat-total').amount,84);assert.equal(auxiliary(wrong,'Selisih peredaran usaha dengan penyerahan').Nilai,null);
  const c=corporate();c.L1cFormData.L1cTreeData[0].Children.push(c.L1cFormData.L1cTreeData.splice(1,1)[0]);
  assert.equal(line(get(model(sample(c)),'B.1.4'),'sales').amount,null);
});
test('positive corrections retain unallocated migration total, avoid double counting parent rows and never infer officer corrections',()=>{
  const p=sample(corporate({reported:85,extra:[account('9000',null,8,[account('9010',25,8)])]}),[],
    [entry('BADAN','2025',[{FiscalYearValue:5},{FiscalYearValue:8}],{part:'l9-1-2'}),entry('BADAN','2025',[],{part:'l11a-2'})]);
  const g=get(model(p),'B.7');
  assert.equal(line(g,'account-5314').amount,1);assert.equal(line(g,'account-5321').amount,2);assert.equal(line(g,'other').amount,82);
  assert.equal(auxiliary(g,'Jumlah koreksi positif menurut SPT').Nilai,85);assert.equal(auxiliary(g,'Jumlah koreksi positif dari akun daun').Nilai,11);
  assert.equal(auxiliary(g,'Selisih total L1 dengan jumlah akun daun').Nilai,74);
  assert.equal(auxiliary(g,'Penyusutan fiskal · L9 tabel 1.2 · nilai tahun ini').Nilai,13);
  assert.equal(auxiliary(g,'Daftar nominatif · L11A tabel 2 · jumlah baris').Nilai,0);
  assert.ok(indexSheets(g,new Map()).rows.slice(6,6+g.lines.length).every(row=>row[4]===null));
  const old=corporate({extra:[account('9000',null,8,[account('9010',25,8)])]});delete old.L1cFormData.L1cTreeTotalRow.PositiveFiscalCorrection;
  const b=get(model(sample(old,[])),'B.7');assert.equal(auxiliary(b,'Jumlah koreksi positif menurut SPT').Nilai,11);
  assert.equal(line(b,'other').amount,8);assert.match(line(b,'other').source,/akun daun/);
  assert.equal(auxiliary(b,'Daftar nominatif · L11A tabel 2 · jumlah baris').Nilai,null);
  const malformed=corporate();malformed.L1cFormData.L1cTreeTotalRow.PositiveFiscalCorrection='?';
  assert.equal(auxiliary(get(model(sample(malformed,[])),'B.7'),'Jumlah koreksi positif menurut SPT').Nilai,null);
  const mismatch=corporate({extra:[account('8000',null,8,[account('8010',12,6)])]});delete mismatch.L1cFormData.L1cTreeTotalRow.PositiveFiscalCorrection;
  assert.equal(line(get(model(sample(mismatch,[])),'B.7'),'other').amount,null);
});
test('L1a preserves an actual reported sales subtotal and can prove other positive corrections from leaves that exhaust a declared total',()=>{
  const build=(grand,unknown=null)=>({L1aFormData:{L1aTreeData:[account('4020',100,null),account('4199',null,null),
    account('5314',null,unknown),account('5399',10,15),account('9999',null,0)],L1aTreeTotalRow:{PositiveFiscalCorrection:grand}}});
  const group=model(sample(build(15)));
  assert.equal(line(get(group,'B.1.4'),'sales').amount,null);assert.equal(line(get(group,'B.1.4'),'reported-sales').amount,100);
  const b=get(group,'B.7');assert.equal(line(b,'other').amount,15);assert.match(line(b,'other').source,/L1aFormData.L1aTreeTotalRow/);
  assert.equal(line(b,'account-5314').amount,null);
  for(const body of [build(16),build(10),build(15,'?'),build(15,-1)])assert.equal(line(get(model(sample(body)),'B.7'),'other').amount,null);
});
test('last corporate amendment only, no borrowed annex, and no previously reported VAT month substituted for ambiguous latest',()=>{
  const p=sample(corporate(),Array.from({length:12},()=>vat()),[
    entry('BADAN','2025',corporate({otherSales:10}),{version:1}),entry('BADAN','2025',[],{part:'l9-1-2'}),
    entry('PPN','2025-02',vat(),{version:1,id:'r1'}),entry('PPN','2025-02',vat(),{version:1,id:'r2'})]);
  const m=model(p),g=get(m,'B.1.4'),b=get(m,'B.7');
  assert.equal(line(g,'sales').amount,110);assert.equal(line(g,'sales').version,1);assert.equal(line(g,'vat-total').amount,null);
  assert.equal(auxiliary(b,'Penyusutan fiskal · L9 tabel 1.2 · jumlah baris').Nilai,null);
  assert.ok(b.lines.every(l=>l.id.includes('/p01_')));
  const mixed=sample(corporate(),[],[entry('BADAN','2025',corporate(),{version:1,owner:'0000000000000081'})]);
  assert.equal(line(get(model(mixed),'B.1.4'),'sales').amount,null);
  const tied=sample(corporate(),[],[entry('BADAN','2025',corporate(),{id:'duplikat'})]);
  assert.equal(model(tied).groups.length,0);
  assert.equal(companyAnnexIndices(p,'2024').groups.length,0);
});
const reference=process.env.STUDIO_KKP_DIR,fixtures=process.env.VERITAX_FIXTURES;
test('five business years compare against the actual normal Studio downloads and one year has no corporate SPT',{skip:!reference||!fixtures},async()=>{
  const script=[
    'import sys,json,openpyxl,pathlib','p=pathlib.Path(sys.argv[1]); info={}',
    "for f in sorted([*p.glob('umum-*.xlsx'),*p.glob('migrasi-*.xlsx')]):",
    ' w=openpyxl.load_workbook(f,read_only=True,data_only=True)',
    " pick=lambda k:next((s for s in w if s.title.startswith(k+' ')),None)",
    " b=pick('B.7'); a=pick('B.1.4')",
    ' if b is None or a is None: info[f.stem]=None; continue',
    " ar=list(a.values); data=list(b.values)[15:]; ix=next(i for i,r in enumerate(data) if len(r)>3 and r[1]=='Jumlah')",
    " info[f.stem]={'categories':[ar[i][3] for i in range(16,23)],'sales':ar[15][3],'gap':ar[23][3],'percent':float(ar[24][3].removesuffix('%')),'tax':[r[3] for r in data[:ix]],'totalTax':data[ix][3]}",
    'print(json.dumps(info))'
  ].join('\n');
  const result=spawnSync(process.env.PYTHON||'python3',['-c',script,reference],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const wb=JSON.parse(result.stdout);assert.equal(Object.keys(wb).length,6);
  for(const [prefix,suffix] of [['umum',''],['migrasi','-BADAN-MIGRASI']]){
    const pkg=indexPackage(await readPackage(await readFile(join(fixtures,'CONTOH-paket-DEMO-FIKTIF'+suffix+'.zip'))));
    for(const year of pkg.years){
      const expected=wb[prefix+'-'+year],actual=companyAnnexIndices(pkg,year,buildIndex(pkg,year));
      if(!expected){assert.equal(actual.groups.length,0);continue;}
      const a=get(actual,'B.1.4'),b=get(actual,'B.7');
      assert.deepEqual(b.lines.map(l=>l.amount),expected.tax);assert.equal(auxiliary(b,'Jumlah koreksi positif menurut SPT').Nilai,expected.totalTax);
      assert.equal(auxiliary(a,'Peredaran usaha · akun 4020').Nilai,expected.sales);assert.equal(line(a,'sales').amount,null);
      assert.equal(auxiliary(a,subtotalGap).Nilai,expected.gap);
      assert.equal(Number(auxiliary(a,subtotalPercent).Nilai.toFixed(2)),expected.percent);
      assert.equal(auxiliary(a,'Selisih peredaran usaha dengan penyerahan').Nilai,null);
      for(const [i,k] of ['export','own','collector','uncollected','exempt','outside','total'].entries()){
        const v=line(a,'vat-'+k).amount;
        if(['collector','exempt','outside'].includes(k)){assert.equal(v,null);assert.equal(expected.categories[i],0);}
        else assert.equal(v,expected.categories[i]);
      }
    }
  }
});
