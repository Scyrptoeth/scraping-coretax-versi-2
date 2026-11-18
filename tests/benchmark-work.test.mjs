import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {readPackage} from '../extension/archive/package.js';
import {indexPackage} from '../extension/analisis/model.js';
import {benchmarkAnalysis,benchmarkSheet,validateBenchmark} from '../extension/analisis/benchmark-work.js';

const wp={nama:'WP Fiktif',npwp:'0000000000000017'};
function sample({sales=100000,profit=10000,tax=2000,partial=false,owner=wp.npwp,dup=false}={}){
  const data={L1cFormData:{L1cTreeData:[['4020',sales],['4300',25000],['4500',12000]].map(([AccountCode,Amount])=>({Data:{AccountCode,Amount}})),
    L1cTreeTotalRow:{Amount:profit}},MainFormData:{IncomeTaxInAYear:tax}};
  const entry={path:'spt/BADAN/2025/p01_b/induk.json',cap:{lengkap:!partial,konteks:{npwp:owner,bagian:'induk',
    spt:{recordId:'b',tahun:2025,pemb:1,jenis:'ICT_RCITR',masa:'01122025'}}},pages:[{Payload:{FormData:JSON.stringify(data)}}]};
  const registry={path:'profil/klu.json',pages:[{Payload:{Data:[{TradeClassificationCode:'25111',ValidFrom:'2024-01-01',IsMainEconomicCode:true}]}}]};
  return indexPackage({manifest:{wp},entries:[registry,entry,...(dup?[{...entry,path:'spt/BADAN/2025/p01_duplicate/induk.json'}]:[])],report:{valid:true}});
}
const ref=(metric,target,more={})=>({name:'Uji',year:2020,source:'Contoh fiktif halaman 3',klu:'251',metric,target,...more});
test('computes six ratios from the selected return, after-tax margin, and independent CTTOR and NPM scenarios',()=>{
  const pkg=sample(),list=[ref('CTTOR',3),ref('NPM',12,{taxRate:20,taxRateSource:'Asumsi fiktif'}),
    ref('CTTOR',1,{name:'Bawah'}),ref('GPM',30),ref('CTTOR',4,{klu:'252'})];
  const r=benchmarkAnalysis(pkg,2025,list);
  assert.deepEqual(r.ratios.map(x=>x['WP (%)']),[2,8,10,25,12,20]);
  assert.deepEqual(r.scenarios.map(x=>x['PPh tambahan simulasi (Rp)']),[1000,1000,0,null,null]);
  assert.equal(r.scenarios[3]['Selisih (poin persen)'],5);assert.match(r.scenarios[4].Keterangan,/di luar/);
  assert.match(r.ratios[1]['Isian pembilang'],/TreeTotalRow.*IncomeTaxInAYear/);
  assert.ok(benchmarkSheet(pkg,'2025',list).rows.some(row=>row.includes('Asumsi fiktif')));
  assert.equal(benchmarkSheet(pkg,'2024'),null);
});
test('preserves explicit zero and losses, missing financial values, integrity and version limits',()=>{
  const zero=benchmarkAnalysis(sample({profit:-7000,tax:0}),2025,[ref('CTTOR',2)]);
  assert.deepEqual(zero.ratios.map(r=>Number.isFinite(r['WP (%)'])?Math.round(r['WP (%)']):null),[0,-7,-7,25,12,null]);
  assert.equal(zero.scenarios[0]['PPh tambahan simulasi (Rp)'],2000);
  for(const pkg of [sample({partial:true}),sample({owner:'0000000000000080'}),sample({dup:true}),{...sample(),report:{valid:false}}]){
    const result=benchmarkAnalysis(pkg,'2025',[ref('CTTOR',3)]);
    assert.ok(result.ratios.every(r=>r['WP (%)']===null));assert.equal(result.scenarios[0]['PPh tambahan simulasi (Rp)'],null);
  }
  assert.equal(benchmarkAnalysis(sample({sales:0}),2025).ratios[0]['WP (%)'],null);
  assert.equal(benchmarkAnalysis(sample({tax:null}),2025).ratios[1]['WP (%)'],null);
});
test('imports references atomically and requires documentation for assumptions without counting alternative scenarios twice',()=>{
  assert.deepEqual(validateBenchmark(),[]);const a=ref('CTTOR',0);assert.deepEqual(validateBenchmark([a]),[a]);
  for(const bad of [null,{},[a,a],[ref('NPM',2)],[ref('NPM',2,{taxRate:100,taxRateSource:'Ilustrasi'})],
    [ref('NPM',2,{taxRate:22})],[ref('CTTOR',NaN)],[ref('GPM',3,{source:' '})],[ref('PPM',4,{klu:1})]])assert.throws(()=>validateBenchmark(bad));
});

const fixtures=process.env.VERITAX_FIXTURES,studio=process.env.STUDIO_BENCHMARK_DIR;
test('native Studio complete workbooks agree with all six taxpayer ratios for five fiscal years and sourced CTTOR scenarios',
  {skip:!fixtures||!studio},async()=>{
    const script=`import json,os,sys
from openpyxl import load_workbook
out={}
for fname in os.listdir(sys.argv[1]):
 if not fname.startswith(('umum-','migrasi-')) or not fname.endswith('.xlsx'): continue
 book=load_workbook(os.path.join(sys.argv[1],fname),read_only=True,data_only=True)
 if 'Benchmark & Tax Gap' not in book.sheetnames: continue
 rows=list(book['Benchmark & Tax Gap'].values);ratios={};refs=[]
 def pct(v): return None if v in (None,'–','—','-') else float(str(v).strip('%').replace(',','.'))
 for x in rows:
  if len(x)>2 and x[0] in ('CTTOR','NPM','PPM','GPM','OPM','ETR'):ratios[x[0]]=pct(x[2])
  if len(x)>5 and x[1]=='CTTOR' and str(x[0]).startswith(('DJP nasional','DJP Kanwil','DJP kuartil bawah')):refs.append([x[0],pct(x[3]),x[4]])
 out[fname[:-5]]={'ratios':ratios,'refs':refs}
print(json.dumps(out))`;
    const original=JSON.parse(execFileSync(process.env.PYTHON||'python3',['-c',script,studio],{encoding:'utf8'}));
    let cells=0,gaps=0;
    for(const [id,suffix] of [['umum',''],['migrasi','-BADAN-MIGRASI']]){
      const pkg=indexPackage(await readPackage(await readFile(join(fixtures,'CONTOH-paket-DEMO-FIKTIF'+suffix+'.zip'))));
      for(const y of pkg.years){
        const row=original[id+'-'+y];if(!row){assert.equal(benchmarkAnalysis(pkg,y),null);continue;}
        const {ratios,klu}=benchmarkAnalysis(pkg,y);
        for(const r of ratios){
          const value=r['WP (%)'];assert.equal(value===null?null:Number(value.toFixed(2)),row.ratios[r.Rasio],id+' '+y+' '+r.Rasio);cells++;
        }
        for(const [name,target,expected] of row.refs){
          const refRow=ref('CTTOR',target,{name,klu:klu.code});
          assert.equal(benchmarkAnalysis(pkg,y,[refRow]).scenarios[0]['PPh tambahan simulasi (Rp)'],expected,id+' '+y+' '+name);gaps++;
        }
      }
    }
    assert.equal(cells,30);assert.ok(gaps>=10);
  });
