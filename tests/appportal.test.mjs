import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexPackage} from '../extension/analisis/model.js';
import {inferHeader,inferMapping,inferType,portalSheets,portalTypes,reconcileAppportal} from '../extension/analisis/appportal.js';
import {annexDoc,headers,owner,portalEntry,portalRow} from './appportal-fixture.mjs';

function pack(entries){return indexPackage({manifest:{wp:{npwp:owner,nama:'Contoh fiktif'}},report:{valid:true},entries});}
function input(rows,extra={}){return {type:'PK',header:0,year:'2025',mapping:inferMapping(headers,'PK'),rows:[headers,...rows],scope:true,group:false,...extra};}
test('each appportal type uses only the corresponding VAT annexes and latest version in the selected year',()=>{
  for(const [type,{parts}] of Object.entries(portalTypes)){
    const docs=parts.map((_,i)=>annexDoc('00000'+(i+1)));
    const pk=pack([...parts.map((part,i)=>portalEntry(part,[docs[i]],{version:1})),portalEntry(parts[0],[annexDoc('OLD')]),
      portalEntry(parts[0],[annexDoc('OTHER-YEAR')],{period:'2024-01'}),portalEntry('c',[annexDoc('UNRELATED')],{version:1})]);
    const opts=input([...docs.map(r=>portalRow(r.DocumentNumber)),portalRow('OTHER-YEAR','1','1','2024')],{type});
    const r=reconcileAppportal(pk,opts);assert.equal(r.left,parts.length);assert.equal(r.right,parts.length);
    assert.equal(r.excluded.tahun,1);assert.ok(r.details.every(d=>d.Status==='Cocok'&&d.Nomor.startsWith('00000')&&d['Pembetulan SPT']==='1'));
    assert.deepEqual(r.coverage.map(x=>x.Status),parts.map(()=>'Lengkap'));
  }
});
test('counts and deltas separate missing amounts, repeated and missing IDs, true zero and one-sided records',()=>{
  const pk=pack([portalEntry('a2',['00','01','02','03','04'].map(n=>annexDoc(n,n==='00'?0:100,11)))]);
  const opts=input([portalRow('00','0'),portalRow('01','100','13'),portalRow('02','','11'),portalRow('03','50','6'),portalRow('03','50','5'),portalRow('05'),portalRow('')]);
  const result=reconcileAppportal(pk,opts);const get=(r,n)=>r.details.find(d=>d.Nomor===n);
  assert.equal(get(result,'00').Status,'Cocok');assert.equal(get(result,'01')['Selisih PPN (SPT − appportal)'],-2);
  assert.equal(get(result,'02').Status,'Perlu diperiksa');assert.equal(get(result,'03').Status,'Perlu diperiksa');
  assert.equal(get(result,'04').Status,'Hanya di SPT');assert.equal(get(result,'05').Status,'Hanya di appportal');
  assert.equal(get(result,'').Status,'Perlu diperiksa');assert.equal(get(reconcileAppportal(pk,{...opts,group:true}),'03').Status,'Cocok');
  assert.equal(result.summary.find(r=>r.Status==='Cocok')['DPP appportal'],0);assert.equal(result.months[0]['DPP appportal'],null);
});
test('invoice rounding tolerates one rupiah and a unique 13-digit suffix is only a partial match',()=>{
  const pk=pack([portalEntry('a2',[annexDoc('0400000000000011'),annexDoc('0400000000000012'),annexDoc('0400000000000013'),
    annexDoc('0400000000000014'),annexDoc('0410000000000014')])]);
  const rows=[portalRow('0100000000000011'),portalRow('0400000000000012','100','12'),portalRow('0400000000000013','100','13'),portalRow('0100000000000014')];
  const r=reconcileAppportal(pk,input(rows)),byNum=n=>r.details.find(d=>d.Nomor===n);
  assert.equal(byNum(rows[0][0]).Status,'Cocok sebagian');assert.equal(byNum(rows[0][0])['Nomor SPT'],'0400000000000011');
  assert.equal(byNum(rows[1][0]).Status,'Cocok');assert.equal(byNum(rows[1][0])['Selisih PPN (SPT − appportal)'],-1);
  assert.equal(byNum(rows[2][0]).Status,'Selisih nilai');assert.equal(byNum(rows[3][0])['Baris SPT'],0);
});
test('taxpayer scope covers every import row even outside year and a counterparty identifier never proves ownership',()=>{
  const pk=pack([portalEntry('a2',[])]),other='0000000000000042';
  const a=input([portalRow('001','0','0','2024','02',other)]);
  assert.throws(()=>reconcileAppportal(pk,{...a,confirmed:true,mapping:{...a.mapping,owner:-1}}),/NPWP pemilik berbeda/);
  const header=['Nomor','Masa','Tahun','NPWP pembeli','DPP','PPN'];
  const noOwner=input([],{rows:[header,portalRow('001','0','0','2025','01',other)],mapping:inferMapping(header,'PK')});
  assert.throws(()=>reconcileAppportal(pk,noOwner),/Cocokkan WP/);
  assert.equal(reconcileAppportal(pk,{...noOwner,confirmed:true}).ownerVerified,false);
  assert.equal(inferMapping(header,'PM').owner,3);
  assert.throws(()=>reconcileAppportal({...pk,report:{valid:false}},a),/telah diperiksa/);
  const wrong=pack([portalEntry('a2',[annexDoc('FOREIGN')],{npwp:other})]);
  const scope=reconcileAppportal(wrong,input([portalRow('A')]));
  assert.equal(scope.right,0);assert.equal(scope.details[0].Status,'Perlu diperiksa');
});
test('unique invoice may be declared in a later SPT month while totals keep the reporting month on each side',()=>{
  const pk=pack([portalEntry('b2',[]),portalEntry('b3',[]),portalEntry('b2',[annexDoc('000001')],{period:'2025-02'})]);
  const opts=input([portalRow('000001')],{type:'PM'}),r=reconcileAppportal(pk,opts);
  assert.equal(r.details[0].Status,'Cocok');assert.equal(r.details[0]['Masa appportal'],'2025-01');
  assert.equal(r.details[0]['Masa SPT'],'2025-02');assert.deepEqual(r.months.map(m=>[m['Baris appportal'],m['Baris SPT']]),[[1,0],[0,1]]);
  opts.rows.push(portalRow('000001','0','0','2025','02'));assert.equal(reconcileAppportal(pk,{...opts,group:true}).details[0].Status,'Perlu diperiksa');
});
test('unverified annex, missing month, months without returns and ambiguous latest versions cannot certify an appportal-only absence',()=>{
  const a=portalEntry('a2',[],{period:'2025-02'});a.cap.lengkap=false;
  const pk=pack([a,portalEntry('b2',[],{id:'v1',period:'2025-04'}),portalEntry('b2',[],{id:'v2',period:'2025-04'})]);
  const opts=input([portalRow('A'),portalRow('B','1','1','2025','02'),portalRow('C','1','1','2025','04'),portalRow('D','1','1','2025','')]);
  const scoped=reconcileAppportal(pk,opts);
  assert.deepEqual(scoped.excluded,{tahun:0,masa:1,tanpaSpt:1,versiGanda:1});
  assert.equal(scoped.details[0].Status,'Perlu diperiksa');
  assert.ok(reconcileAppportal(pk,{...opts,scope:false}).details.every(row=>row.Status==='Perlu diperiksa'));
});
test('headers, Indonesian decimals, date fallback, explicit reporting month and four Excel sheets retain scope and identity',()=>{
  const h=['No PIB','Tanggal dokumen','NPWP importir','DPP','PPN','Masa pajak','Tahun'],data=[['Judul'],h,
    ['00001','03/01/2025',owner,'1.000,00','110,5','',''],['00002','2024-12-31',owner,'0','0','Januari','2025'],
    [100045,'2025-01-01',owner,'0','0','','']];
  assert.equal(inferType('fiktif.xls',h),'PIB');assert.equal(inferHeader(data,'PIB'),1);
  const pk=pack([portalEntry('b1',[annexDoc('00001',1000,110.5),annexDoc('00002',0,0)])]);
  const opts=input([],{type:'PIB',header:1,rows:data,mapping:inferMapping(h,'PIB'),wp:pk.manifest.wp,role:'AR',hash:'f'.repeat(64),name:'uji.csv'});
  const report=reconcileAppportal(pk,opts);
  assert.equal(report.summary.find(r=>r.Status==='Cocok').Dokumen,2);
  assert.equal(report.details.find(r=>!r.Nomor).Status,'Perlu diperiksa');
  const sheets=portalSheets(report,opts);assert.deepEqual(sheets.map(s=>s.name),['Info PIB','Ringkasan PIB','Per masa PIB','Rincian PIB']);
  assert.equal(sheets[0].rows.find(r=>r[0]==='WP')[1],owner);assert.ok(sheets[3].rows.flat().includes('00001'));
});
