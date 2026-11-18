import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import test from 'node:test';
import {planSptDetails} from '../extension/app-spt-plan.js';
import {readPackage} from '../extension/archive/package.js';
import {appendPackageEntry} from '../extension/app-package-entries.js';

const wp = '0000000000000001', other = '0000000000000002';
const period = {from:{y:2025,m:6}, to:{y:2025,m:8}};
const row = (id,extra = {}) => ({RecordId:id,ReturnSheetTypeCode:'VAT_VATR',TaxPeriodCode:'06062025',
  ReturnSheetModel:'Normal',...extra});
const table = (rows,source = 'sptdaftar',owner = wp) => ({wp:owner,source,page:{Payload:{Data:rows}}});
const plan = (items,extra = {}) => planSptDetails({wp,period,items,...extra});
function section(part,extra = {}) {
  const {complete = true, pages = [{IsSuccessful:true,Payload:{Data:[]}}],spt = {},owner = wp} = extra;
  return {cap:{sumber:'sptisi',lengkap:complete,konteks:{npwp:owner,bagian:part,
    spt:{recordId:'r1',jenis:'VAT_VATR',masa:'06062025',pemb:0,npwp:owner,...spt}}},pages};
}

test('plan keeps each revision and annual year while reconciling archives and named visible columns', () => {
  const normal = row('r1',{DocumentReceiptNumber:'BPE-DEMO-1'});
  const amended = row('r2',{ReturnSheetModel:'Amendment 001'});
  const fiscal = row('r3',{ReturnSheetTypeCode:'ICT_RCITR',TaxPeriodCode:'04032025'});
  const visible = {'Nomor Bukti Penerimaan':'BPE-DEMO-1','Jenis Surat Pemberitahuan Pajak':'SPT Masa PPN',
    'Masa Pajak':'Juni 2025','Model SPT':'Normal'};
  const options = {types:['VAT_VATR','ICT_RCITR']};
  const items = [table([normal,amended,fiscal,row('unknown',{ReturnSheetTypeCode:'LBT_LBTR'}),
    row('before',{TaxPeriodCode:'05052025'}),row('pph',{ReturnSheetTypeCode:'ICT_WITR'}),row('no-rev',{ReturnSheetModel:''}),
    row(null),row('foreign',{NPWP:other})]),table([normal],'sptarsip'),table([visible]),table([amended],'sptbelum')];
  const {documents,counts} = plan(items,options);
  assert.deepEqual(documents.map(d=>[d.type,d.period,d.revision]),[
    ['ICT_RCITR','2025-04/03',0],['VAT_VATR','2025-06',0],['VAT_VATR','2025-06',1]]);
  assert.deepEqual(counts,{periods:2,versions:3,unknown:1,outside:1,excludedType:1,conflicts:1,duplicateRows:2,
    missing:2,readyParts:0,pendingParts:3,retryParts:0,drafts:1,failedIndexPages:0,unmatchedParts:0});
  assert.deepEqual(plan(items.toReversed(),options),{documents,counts});
  const fromTable = plan([table([visible])]).documents[0];
  assert.equal(fromTable.key,documents[1].key);
  assert.equal(fromTable.parts[0].key,documents[1].parts[0].key);
  assert.equal(fromTable.receipt,'BPE-DEMO-1');
  assert.equal(fromTable.recordId,null);
});

test('recognize exact submitted-return captions and the calendar-year corporate period',()=>{
  const cases=[
    ['SPT Masa PPh Pasal 21/26','ICT_WITR','Juni 2025','2025-06'],
    ['SPT Masa PPh Unifikasi','ICT_WTR','Juni 2025','2025-06'],
    ['SPT PPh Badan Rupiah','ICT_RCITR','Januari - Desember 2025','2025'],
    ['SPT Masa PPN','VAT_VATR','Juni 2025','2025-06']
  ];
  for(const [title,type,display,expected] of cases){
    const source={'Jenis Surat Pemberitahuan Pajak':title,'Model SPT':'Amendment 001','Masa Pajak':display,'ID SPT':'id-fiktif'};
    const [doc]=plan([table([source])]).documents;
    assert.deepEqual([doc?.type,doc?.period,doc?.revision],[type,expected,1]);
    assert.equal(plan([table([{...source,'Jenis Surat Pemberitahuan Pajak':title+' Lain'}])]).documents.length,0);
  }
});

test('ambiguous references, missing scope and foreign documents never acquire parts', () => {
  const listing = table([row('r1'),row('r2'),row('r2',{TaxPeriodCode:'07072025'}),row('r9',{TaxPeriodCode:'08082025'})]);
  const details = [section('l1'),section('induk',{owner:other}),section('l1',{spt:{npwp:other}})];
  const bounded = plan([listing,...details,table([row('r0')],'sptarsip',other)]);
  assert.deepEqual(bounded.documents.map(d=>d.recordId),['r9']);
  assert.equal(bounded.counts.conflicts,4);
  assert.equal(bounded.counts.unmatchedParts,2);
  assert.equal(bounded.counts.readyParts,0);
  const different = row('r1',{TaxPeriodCode:'07072025',ReturnSheetModel:'Amendment 001'});
  assert.equal(plan([table([row('r1'),different])]).counts.versions,2);
  const inconsistent = table([row('r4',{'Jenis SPT':'ICT_RCITR'}),row('r5',{Pembetulan:2}),
    row('r6',{'ID SPT':'r7'}),row('',{'Nomor Bukti Penerimaan':'—'})]);
  const screened = plan([inconsistent]).counts;
  assert.deepEqual([screened.versions,screened.conflicts,screened.missing],[0,3,1]);
  assert.throws(()=>plan([], {wp:''}),/NPWP/);
  assert.throws(()=>plan([], {period:{from:{y:2025,m:7},to:{y:2025,m:6}}}),/Periode/);
});

test('known attachments depend on their own principal and explicit failures remain retryable', () => {
  const otherRevision = row('r2',{ReturnSheetModel:'Pembetulan ke-1'});
  const rows = table([row('r1'),otherRevision]);
  const broken = section('l2',{pages:[{IsSuccessful:false,Payload:{}}]});
  const partial = section('l3',{complete:false});
  const failure = section('l4',{complete:false,pages:[]});
  const options = {failures:[failure]};
  const indexFailure = {wp,source:'sptdaftar',page:{IsSuccessful:false,Payload:{Data:[row('bad')]}}};
  const input = [rows,indexFailure,section('induk'),section('l1'),broken,partial,section('l1',{spt:{pemb:1}})];
  const {documents,counts} = plan(input,options);
  assert.deepEqual(documents[0].parts.map(p=>[p.name,p.status]),[
    ['induk','ready'],['l1','ready'],['l2','retry'],['l3','pending'],['l4','retry']]);
  assert.deepEqual(documents[0].parts.slice(1).map(p=>p.dependsOn),Array(4).fill([documents[0].parts[0].key]));
  assert.deepEqual(documents[1].parts.map(p=>[p.name,p.status]),[['induk','pending']]);
  assert.equal(counts.unmatchedParts,1);
  assert.equal(counts.failedIndexPages,1);
  assert.equal(plan([...input,section('l2'),section('l4')],options).counts.retryParts,0);
});

test('queued source evidence identifies a named attachment without declaring a visible page complete', () => {
  const queued = {wp,source:'sptisi',spt:'VAT_VATR',id:'test',period:'2025-06',rows:1,page:{Payload:{Data:[
    {'ID SPT':'r1','Pembetulan':0,'Masa Pajak':'2025-06','Bagian SPT':'Lampiran a1'}
  ]}}};
  const result = plan([table([row('r1')]),queued]);
  assert.deepEqual(result.documents[0].parts.map(p=>[p.name,p.status]),[['induk','pending'],['a1','pending']]);
  assert.equal(result.counts.readyParts,0);
  const receiptOnly=plan([table([row('',{DocumentReceiptNumber:'FICTIVE-BPE'})]),section('l2',{
    complete:false,spt:{recordId:'',nomor:'FICTIVE-BPE'}})]);
  assert.deepEqual(receiptOnly.documents[0].parts.map(p=>[p.name,p.status]),[['induk','pending'],['l2','pending']]);
  assert.equal(receiptOnly.counts.unmatchedParts,0);
  const visible={...queued,id:'capture-fictitious',page:{Payload:{Data:[{Uraian:'Fiktif',Jumlah:'7'}]}},
    detailProof:{period:'2025-06',revision:0,part:'l2',label:'Lampiran 2',recordId:null,receipt:'FICTIVE-BPE'}};
  const archives=new Map();appendPackageEntry(archives,visible,wp);
  const entry=[...archives.values()][0];
  assert.equal(entry.path,'sptisi/capture-fictitious.json');
  assert.equal(entry.cap.lengkap,false);
  assert.equal(entry.cap.konteks.spt.recordId,'');
  assert.equal(entry.cap.konteks.spt.nomor,'FICTIVE-BPE');
  assert.deepEqual(entry.pages[0],visible.page);
});

test('all four reference demonstration packages plan the same in-scope document versions as their captured files', async t => {
  const folder = new URL('../01-VERITAX_v1.32.0/',import.meta.url);
  let files;
  try { files = await readdir(folder); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return t.skip('Keempat paket fiktif referensi tersimpan di workspace lokal.');
  }
  const totals = [];
  for (const name of files.filter(n=>n.startsWith('CONTOH-') && n.endsWith('.zip'))) {
    const {entries,manifest} = await readPackage(await readFile(new URL(name,folder)));
    const options = {wp:manifest.wp.npwp,period:manifest.opsi.periode,types:manifest.opsi.jenisSpt};
    const {documents,counts} = planSptDetails({...options,items:entries});
    const captured = entries.filter(entry=>entry.cap.sumber === 'sptisi');
    const versions = new Set(captured.map(entry=>entry.cap.konteks.spt.recordId));
    assert.deepEqual(new Set(documents.map(d=>d.recordId)),versions);
    assert.equal(counts.readyParts,captured.length);
    assert.deepEqual([counts.conflicts,counts.unmatchedParts,counts.pendingParts,counts.retryParts],[0,0,0,0]);
    const onlyLists = planSptDetails({...options,items:entries.filter(entry=>entry.cap.sumber === 'sptdaftar')});
    assert.equal(onlyLists.counts.readyParts,0);
    assert.equal(onlyLists.counts.pendingParts,versions.size);
    totals.push([counts.periods,counts.versions,counts.readyParts]);
  }
  assert.deepEqual(totals.sort((a,b)=>a[2]-b[2]),[[2,2,26],[2,3,39],[73,76,590],[105,105,858]]);
});
