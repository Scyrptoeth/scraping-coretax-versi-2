import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {readPackage} from '../extension/archive/package.js';
import {createXlsx} from '../extension/archive/table.js';
import {decodeText,readZip} from '../extension/archive/zip.js';
import {indexPackage} from '../extension/analisis/model.js';
import {assessLine,buildIndex,completeIndexBook,indexSheets,indexStatus,restoreIndexedRows} from '../extension/analisis/kkp-index.js';
import {findingsFor} from '../extension/analisis/findings.js';

const wp='0000000000000016',y='2025';
const employee=(a,b)=>({A21IncomeTaxWithheld:a,A26IncomeTaxWithheld:b,A21IncomeTaxUnderpaidOverpaid:7777});
const article=(name,n)=>({data:{Type:'Tax Article',Name:name,TotalWithholding:n,TotalIncomeTaxPaid:999}});
const unif=(a,b)=>({IncomeTaxes:[article('Article 23',a),article('Article 4 Section 2',b)]});
function entry(type,month,v,row,overrides={}){
  const id='fiktif-'+type+month+'-'+v,period=y+'-'+month;
  return {path:'spt/'+type+'/'+period+'/p0'+v+'_'+id+'/induk.json',cap:{lengkap:true,konteks:{npwp:wp,bagian:'induk',
    spt:{jenis:type==='PPH2126'?'ICT_WITR':'ICT_WTR',recordId:id,pemb:v,tahun:2025,masa:period}},...overrides},
  pages:[{IsSuccessful:true,Payload:{FormData:JSON.stringify(row)}}]};
}
const pack=entries=>indexPackage({manifest:{wp:{npwp:wp}},report:{valid:true,manifestHash:'fiktif'},entries});
const group=(index,ref)=>index.groups.find(g=>g.ref===ref);
const monthly=g=>g.support.filter(r=>r.Masa!==y);
const note={document:'Bukti fiktif',officer:'Petugas',note:'Dicocokkan pada bukti',classification:'verified',principal:2};
test('an input component has one review ID, one principal and one finding in the complete workbook; individual exports remain self contained',async()=>{
  const p=pack([entry('PPH2126','01',0,employee(5,4)),entry('PPH2126','01',1,employee(100,20)),
    entry('PPH2126','02',0,employee(0,0)),entry('UNIFIKASI','01',0,unif(21,42))]);
  const i=buildIndex(p,y);
  for(const [parent,target,money,field] of [['C','C.2.2',100,'A21IncomeTaxWithheld'],['G','G.2.2',21,'TotalWithholding'],['K','K.2.2',42,'TotalWithholding']]){
    const legacy=group(i,parent),canon=group(i,target);
    const line=legacy.lines.find(l=>l.period==='2025-01'&&l.id.endsWith(field));
    assert.equal(line.amount,money);assert.equal(line.groupKey,legacy.key);assert.equal(i.byId.get(line.id),line);
    assert.ok(canon.lines.includes(line));assert.equal(line.canonicalKey,canon.key);
    const previous=assessLine({...line,canonicalKey:undefined},{...note,value:money+2}),row=assessLine(line,{...note,value:money+2});
    assert.deepEqual(row,previous);assert.deepEqual(restoreIndexedRows([previous],[previous],i),[row]);
    assert.throws(()=>restoreIndexedRows([row,row],[row,row],i),/Indeks/);
    const reviews=new Map([[line.id,row]]);
    for(const g of [legacy,canon]){assert.equal(indexStatus(g,reviews).changed,1);assert.equal(indexStatus(g,reviews).tested,1);}
    assert.equal(findingsFor(p,y,[row]).filter(f=>f.source===row.sumber).length,1);
    const complete=completeIndexBook(p,y,i,reviews,{}),ts=complete.find(s=>s.name==='Temuan Sementara'),main=complete.find(s=>s.name==='INDUK');
    assert.equal(ts.rows.length,2);assert.equal(ts.rows[1][0].target.name.startsWith(target+' '),true);
    assert.equal(main.rows.length,2);assert.equal(main.rows[1][7],2);
    assert.equal(complete.find(s=>s.name==='SPT Data').rows.filter(r=>r[6]===line.source).length,1);
    const legacySheet=complete.find(s=>s.name.startsWith(parent+' ')),canonSheet=complete.find(s=>s.name.startsWith(target+' '));
    const linked=legacySheet.rows[legacy.lines.indexOf(line)+6];
    assert.ok(linked.slice(3,6).every(c=>c.target===canonSheet));assert.deepEqual(linked.slice(3,6).map(c=>c.cached),[money,money+2,2]);
    const standalone=indexSheets(canon,reviews),independent=standalone.rows[canon.lines.indexOf(line)+6];assert.equal(independent[3],money);
    const zip=await readZip(await createXlsx({sheets:[standalone]}));
    const xml=decodeText(zip.get('xl/worksheets/sheet1.xml').data);assert.match(xml,/Bukti fiktif/);assert.doesNotMatch(xml,/#REF!/);
  }
  const c=group(i,'C.2.2');
  assert.deepEqual(monthly(c).map(r=>[r.Masa,r.Nilai]).sort(),[['2025-01',120],['2025-02',0]]);
  assert.match(monthly(c)[0].Sumber,/A21IncomeTaxWithheld \+ A26IncomeTaxWithheld/);
  assert.ok(c.lines.some(l=>l.amount===20&&l.tax==='PPh Pasal 26'));
  assert.equal(c.support.at(-1).Nilai,120);
  const g=group(i,'G.2.2');assert.equal(monthly(g)[0].Nilai,21);assert.match(monthly(g)[0].Sumber,/\.TotalWithholding/);
});
test('missing amounts, mismatched owner, repeated article, later listed corrections and absent months stay distinguishable',()=>{
  const wrong={konteks:{npwp:'0000000000000019'}};
  const list={path:'spt/daftar.json',cap:{konteks:{npwp:wp}},pages:[{Payload:{Data:[{RecordId:'later',ReturnSheetTypeCode:'ICT_WTR',
    TaxPeriodCode:'06062025',ReturnSheetModel:'Amendment 001',ReturnSheetStatusCode:'SUBMITTED'}]}}]};
  const foreign=unif(30,9);foreign.IncomeTaxes[0].data.CurrencyCode='USD';
  const i=buildIndex(pack([entry('PPH2126','01',0,employee(4,null)),entry('PPH2126','03',0,employee(0,0)),
    entry('UNIFIKASI','01',0,unif(13,0)),entry('UNIFIKASI','02',0,unif(7,3),wrong),
    entry('UNIFIKASI','03',0,{IncomeTaxes:[article('Article 23',2),article('Article 23',4)]}),
    entry('UNIFIKASI','04',0,unif(null,1)),entry('UNIFIKASI','05',0,foreign),entry('UNIFIKASI','06',0,unif(88,4)),list]),y);
  const c=group(i,'C.2.2');assert.equal(monthly(c).find(r=>r.Masa==='2025-01').Nilai,null);
  assert.equal(c.support.at(-1).Nilai,null);assert.equal(c.support.at(-1)['Masa terkonfirmasi'],1);
  const g=group(i,'G.2.2'),r=Object.fromEntries(monthly(g).map(row=>[row.Masa,row]));
  assert.equal(r['2025-01'].Nilai,13);
  for(const [month,reason] of [['02',/Identitas/],['03',/beberapa kali/],['04',/sebagai angka/],['05',/Mata uang/],['06',/Pembetulan terakhir/]]){
    assert.equal(r[y+'-'+month].Nilai,null);assert.match(r[y+'-'+month].Keterangan,reason);
  }
  assert.equal(g.support.at(-1).Nilai,null);assert.equal(g.support.at(-1)['Masa SPT dalam paket'],6);
  assert.equal(g.support.at(-1)['Masa terkonfirmasi'],1);assert.equal(r['2025-07'],undefined);
});

const refs=process.env.STUDIO_CGK_DIR;
test('three monthly and annual results follow the saved physical Studio workbook when withholding, payment and Article 26 intentionally differ',{skip:!refs},async()=>{
  const p=indexPackage(await readPackage(await readFile(join(refs,'contoh.zip')))),i=buildIndex(p,y);
  const py=spawnSync(process.env.PYTHON||'python3',['-c',
    "import sys,json,openpyxl;w=openpyxl.load_workbook(sys.argv[1],read_only=True,data_only=True);print(json.dumps({s.title.split()[0]:[r[3] for r in list(s.values)[15:28]] for s in w if s.title.split()[0] in ['C.2.2','G.2.2','K.2.2']}))",
    join(refs,'Studio-cgk.xlsx')],{encoding:'utf8'});assert.equal(py.status,0,py.stderr);const reference=JSON.parse(py.stdout);
  assert.deepEqual(['C.2.2','G.2.2','K.2.2'].map(k=>reference[k][0]),[2011,3333,4444]);
  for(const [k,cells] of Object.entries(reference))for(const r of group(i,k).support)assert.equal(r.Nilai,cells[r.Masa===y?12:Number(r.Masa.slice(-2))-1]);
});
