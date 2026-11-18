import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {readPackage} from '../extension/archive/package.js';
import {findingsFor} from '../extension/analisis/findings.js';
import {kkaLegacyKey,kkaPotentials,kkaPrincipalTotals} from '../extension/analisis/kka-potentials.js';
import {buildIndex} from '../extension/analisis/kkp-index.js';
import {indexPackage} from '../extension/analisis/model.js';

const year='2025',owner='0000000000000044';
test('recap totals keep observed zero, missing inputs and integer overflow distinct',()=>{
  const row=(amount,basisClass='pokok')=>({amount,basisClass});
  assert.deepEqual(kkaPrincipalTotals([row(null),row(''),row(0,'skenario')]),
    {pokok:null,saldoTercatat:null,skenario:0,jumlah:0,priced:1,unpriced:2});
  assert.deepEqual(kkaPrincipalTotals([row(Number.MAX_SAFE_INTEGER),row(1),row(0.5,'skenario'),row(-1),row(3,'saldo-tercatat')]),
    {pokok:null,saldoTercatat:3,skenario:null,jumlah:null,priced:3,unpriced:2});
});
function fixture(){
  const period=year+'-01',path='spt/PPN/'+period+'/p00_fiktif/a2.json';
  const invoice={DocumentNumber:'07-FIKTIF',DocumentDate:'2025-01-10',TIN:'0000000000000033',TaxBase:1200000,OtherTaxBase:1100000,VAT:0,STLG:0};
  const part={path,cap:{lengkap:true,baris:1,total:1,konteks:{npwp:owner}},pages:[{Payload:{Data:[invoice],TotalRecords:1}}]};
  const f={id:'fiktif',key:'spt/PPN/'+period,type:'PPN',year,period,version:0,latest:true,parts:new Map([['a2',part]]),meta:{}};
  const pkg={manifest:{wp:{npwp:owner}},forms:[f],entries:[part]};
  return {invoice,part,pkg,run:(work={},legacy=[])=>kkaPotentials(pkg,year,work,undefined,legacy)};
}

test('One N.5 principal feeds the all-scope total without sanctions or the additional comparison',()=>{
  const f=fixture(),m=f.run({simulation:{end:'2026-06-01'}}),rows=m.all.filter(r=>r.indicationRuleId==='vat-facility');
  assert.equal(rows.length,1);const [r]=rows;
  assert.equal(r.amount,132000);assert.equal(r.basisClass,'skenario');assert.equal(r.reference,'N.5');
  assert.ok(r.law.includes('Pasal 16B'));assert.ok(r.calculation.includes('fasilitas'));
  assert.equal(r.comparisonAmount,undefined);assert.ok(r.source.includes('a2.json'));assert.ok(r.key.startsWith('['));
  for(const key of ['sanctionAmount','interest','bookedAmount'])assert.equal(Object.hasOwn(r,key),false);
  assert.deepEqual(m.comparableTotals,{scope:'all',pokok:null,saldoTercatat:null,skenario:132000,jumlah:132000,priced:1,unpriced:0});
  const later=f.run({simulation:{end:'2027-02-20'}});
  assert.equal(later.all[0].key,r.key);assert.equal(later.comparableTotals.jumlah,m.comparableTotals.jumlah);
  assert.equal(f.run({scopes:{kka:'verified'}}).comparableTotals.jumlah,null);
  assert.equal(f.run({indicationReviews:{'vat-facility':'explained'}}).all.length,0);
  assert.equal(f.run({indicationReviews:{'vat-facility':'inapplicable'}}).all.length,0);
  assert.equal(f.run({indicationReviews:{'vat-facility':'retained'}}).all[0].amount,132000);
});

test('Unverified rates provide a separate comparison. Failed and incomplete evidence cannot price the case',()=>{
  const f=fixture();f.invoice.OtherTaxBase=0;
  let m=f.run();assert.equal(m.all[0].amount,null);assert.equal(m.all[0].comparisonAmount,132000);
  assert.equal(m.comparableTotals.jumlah,null);assert.ok(m.notes.some(n=>n.includes('N.5')));
  f.part.cap.lengkap=false;m=f.run();assert.ok(!m.all.some(r=>r.comparisonAmount!=null||r.amount!=null));
  f.part.cap.lengkap=true;f.invoice.OtherTaxBase=1100000;f.pkg.report={valid:false};m=f.run();
  assert.equal(m.comparableTotals.priced,0);
});

test('A duplicated fact counts once and stable keys recover an earlier disposition',()=>{
  const f=fixture(),fact=f.run().all[0];
  const legacy={kind:fact.kind,period:fact.period,source:fact.source,status:'indikatif',detail:fact.detail,amount:fact.amount};
  const m=f.run({},[legacy]);
  assert.equal(m.all.length,1);assert.equal(m.comparableTotals.priced,1);
  const old=JSON.stringify([legacy.kind,legacy.period,legacy.source,legacy.detail]);
  assert.ok(m.all[0].reviewKeys.includes(old));
  for(const key of [old,kkaLegacyKey(legacy,year),fact.key])
    assert.equal(f.run({dispositions:{[key]:'Terjelaskan'}},[legacy]).comparableTotals.jumlah,null);
  const staff={...legacy,kind:'PPh',teamId:'baris-demo',detail:'Uji A',amount:0};
  const oldKey=kkaLegacyKey(staff,year);
  assert.equal(kkaLegacyKey({...staff,detail:'Uji diperbarui'},year),oldKey);
  assert.equal(f.run({},[staff]).all.find(r=>r.kind==='PPh').amount,0);
});

test('Legacy balance, a penalty notice and an unpriced observation never become new principal',()=>{
  const f=fixture();f.pkg.forms=[];f.pkg.entries=[];
  const base={kind:'PPh',period:'2025-01',source:'Buku besar contoh',status:'berbukti',detail:'Sisa kewajiban lama',ledgerId:'debt-demo',amount:'',
    sanctionAmount:900,bookedAmount:700};
  const late={kind:'PPN',period:base.period,source:'Tanggal lapor contoh',status:'berbukti',detail:'Batas awal pada daftar SPT',formKey:'SPT/FIKTIF',amount:''};
  const m=f.run({},[late,base,{...base,detail:'Catatan dari sumber lain',amount:700}]);
  assert.equal(m.all.length,1);assert.equal(m.all[0].basisClass,'saldo-tercatat');assert.equal(m.all[0].amount,null);
  assert.equal(m.comparableTotals.jumlah,null);assert.equal(m.all[0].interest,undefined);
  assert.ok(m.notes.some(v=>v.includes('Tanggal pelaporan')));
});

test('reviewing one manual finding preserves another with identical wording and an independent ID',()=>{
  const f=fixture();f.pkg.forms=[];f.pkg.entries=[];
  const base={kind:'PPN',period:year,source:'Dokumen fiktif',detail:'Hasil pemeriksaan',status:'berbukti',amount:100};
  const pair=[{...base,teamId:'manual-a'},{...base,teamId:'manual-b',amount:200}];
  const rows=f.run({},pair).all;
  assert.equal(rows.length,2);
  const dispositions=Object.fromEntries(rows[0].reviewKeys.map(k=>[k,'Terjelaskan']));
  assert.equal(f.run({dispositions},pair).comparableTotals.jumlah,200);
});

test('The fictitious Studio L-7 tax groups reconcile with an explicit loan-rate assumption',async t=>{
  if(!process.env.VERITAX_FIXTURES)return t.skip('Optional local fictitious reference package');
  const pkg=indexPackage(await readPackage(await readFile(join(process.env.VERITAX_FIXTURES,'CONTOH-paket-DEMO-FIKTIF.zip'))));
  const index=buildIndex(pkg,year),legacy=findingsFor(pkg,year,[]),run=work=>kkaPotentials(pkg,year,work,index,legacy);
  const rate={percent:8,source:'Asumsi fiktif dalam contoh'},opts={indicationLoanRate:rate};
  const report=run(opts),groups=new Map();
  for(const r of report.all.filter(f=>f.amount!==null))groups.set(r.kind,(groups.get(r.kind)??0)+r.amount);
  assert.deepEqual(groups,new Map([['PPN',4182520232],['PPh Badan',664577500],['PPh Pasal 21/26',345795171],['PPh Pasal 4 ayat (2)',188042647]]));
  assert.deepEqual([report.comparableTotals.priced,report.comparableTotals.saldoTercatat,report.comparableTotals.jumlah],[9,63045480,5380935550]);
  assert.equal(report.all.filter(f=>f.ledgerId && f.amount>0).length,2);
  const noRate=run({});assert.equal(noRate.comparableTotals.jumlah,5354535550);
  assert.equal(noRate.all.find(r=>r.ruleId==='related-loan').amount,null);
  assert.equal(noRate.all.find(r=>r.ruleId==='related-loan').key,report.all.find(r=>r.ruleId==='related-loan').key);
  assert.equal(run({...opts,scopes:{kka:'verified'}}).comparableTotals.jumlah,63045480);
  const closed=run({...opts,indicationReviews:{depreciation:'explained'}});
  assert.equal(closed.all.some(f=>f.reference==='B.7'&&f.amount>0),false);
});
