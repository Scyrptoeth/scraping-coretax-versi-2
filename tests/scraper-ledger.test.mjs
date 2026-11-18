import assert from 'node:assert/strict';
import test from 'node:test';
import {checkLedgerScope,ledgerCancellation,selectLedgerRows} from '../extension/ledger-status.js';
import {appendPackageEntry,packagePath} from '../extension/app-package-entries.js';
import {rowsOf} from '../extension/app-data.js';

const wp='0000000000000017';
const filter=(value,mode='equals')=>({PropertyName:'IsCancelled',MatchMode:mode,Value:value});
function source(data,filters,source='bb'){
  const rows=data.map((r,i)=>({NPWP:wp,PeriodCode:'03032025',ReferenceNumber:'DEMO-'+i,...r}));
  return {source,wp,id:'fixture',name:'fiktif.json',period:'2025-01 s.d. 2025-03',origin:'Berkas ekspor',rows:rows.length,total:rows.length,
    page:{Payload:{Data:rows,TotalRecords:rows.length},...(filters?{Request:{Filters:filters}}:{})}};
}

test('Only explicit cancellation fields establish row status, including false and zero',()=>{
  for(const x of [false,0,'0','False','Tidak dibatalkan'])assert.equal(ledgerCancellation({IsCancelled:x}),'active');
  for(const x of [true,1,'1','Dibatalkan'])assert.equal(ledgerCancellation({'Status pembatalan':x}),'cancelled');
  for(const r of [{Status:'cancelled'},{Amount:-5},{IsCancelled:'pending'},{IsCancelled:''},{IsCancelled:true,IsCanceled:0}])
    assert.equal(ledgerCancellation(r),'unknown');
});

test('Unchecked skips only proven cancelled rows and preserves the raw input and its reported count',()=>{
  const item=source([{IsCancelled:0},{IsCancelled:true},{}],[]);
  const selected=selectLedgerRows(item,false),s=selected.ledgerSelection;
  assert.deepEqual(rowsOf(selected.page).map(r=>r.ReferenceNumber),['DEMO-0','DEMO-2']);
  assert.deepEqual([s.barisSumber,s.barisTersimpan,s.batalDilewati,s.tidakDiketahui,s.totalDilaporkanSumber,selected.total],[3,2,1,1,3,null]);
  assert.equal(rowsOf(item.page).length,3);assert.equal(item.page.Payload.TotalRecords,3);
  const all=selectLedgerRows(item,true);
  assert.equal(all.page,item.page);assert.equal(all.ledgerSelection.cakupanOpsi,'sesuai');assert.equal(all.ledgerSelection.barisTersimpan,3);
  assert.equal(selectLedgerRows(selected,false),selected);assert.equal(selectLedgerRows(item,undefined),item);
  assert.equal(selectLedgerRows(null,true),null);
});

test('A source filter can supply missing flags but cannot replace an unrecognised or contrary flag',()=>{
  const item=source([{}, {IsCancelled:'pending'}, {IsCancelled:0}],[filter('0')]);
  const s=selectLedgerRows(item,true).ledgerSelection;
  assert.deepEqual([s.cakupanOpsi,s.aktif,s.tidakDiketahui,s.berdasarkanFilter],['berbeda',2,1,1]);
  assert.equal(ledgerCancellation({},s),'active');assert.equal(ledgerCancellation({IsCancelled:'pending'},s),'unknown');
  const both=source([{}, {IsCancelled:1}, {IsCancelled:0}],[filter('0')]);
  const conflict=selectLedgerRows(both,false).ledgerSelection;
  assert.deepEqual([conflict.filterPembatalanSumber,conflict.filterPembatalanDilaporkan,conflict.barisTersimpan,conflict.berdasarkanFilter,conflict.konflikStatus],
    ['bertentangan','aktif',3,0,1]);
  assert.deepEqual(rowsOf(both.page).map(r=>ledgerCancellation(r,conflict)),['unknown','unknown','active']);
  for(const groups of [[filter('1','notEquals')],[filter('1'),filter('0')],[{...filter('1'),Operator:'or'}]]){
    const selected=selectLedgerRows(source([{}],groups),false);
    assert.equal(selected.rows,1);assert.equal(selected.ledgerSelection.tidakDiketahui,1);
  }
});

test('An all-cancelled month keeps a source note with zero eligible rows and a partial capture',()=>{
  const item=source([{}],[filter('1')]),projected=selectLedgerRows(item,false),s=projected.ledgerSelection;
  assert.equal(packagePath(projected),'bukubesar/2025-03.json');assert.equal(projected.page.Payload.TotalRecords,undefined);
  assert.deepEqual([s.barisSumber,s.barisTersimpan,s.batal,s.berdasarkanFilter,s.batalDilewati],[1,0,1,1,1]);
  const entry=appendPackageEntry(new Map(),projected,wp);
  assert.equal(entry.cap.lengkap,false);assert.equal(entry.cap.baris,0);assert.equal(entry.cap.total,null);
  assert.deepEqual(entry.cap.halamanSumber[0].pemilihanBukuBesar,s);
});

test('Totals and balances retain source figures and unrelated source filters remain explicit',()=>{
  const item=source([{Key:'Filtered',Balance:'0012'}],[filter('0'),{PropertyName:'Office',MatchMode:'equals',Value:'FIKTIF'}],'bbtotal');
  for(const include of [true,false]){
    const out=selectLedgerRows(item,include),s=out.ledgerSelection;
    assert.equal(out.page,item.page);assert.equal(s.cakupanOpsi,include?'berbeda':'sesuai');
    assert.equal(s.filterLainPadaSumber,true);assert.equal(s.batal,null);assert.equal(s.aktif,null);
  }
  const wrongPeriod=[filter('0'),{PropertyName:'PeriodCode',MatchMode:'equals',Value:'08082024'}];
  assert.equal(selectLedgerRows(source([{}],wrongPeriod),false).ledgerSelection.filterLainPadaSumber,true);
  const balance={...item,source:'bbsaldo'};assert.equal(selectLedgerRows(balance,false),balance);
  const foreign=source([{TaxpayerTIN:'0000000000000018',IsCancelled:true}]);
  assert.throws(()=>checkLedgerScope(foreign,foreign.page),/NPWP/);
  const tooLate=source([{PeriodCode:'05052025',IsCancelled:true}]);
  assert.throws(()=>checkLedgerScope(tooLate,tooLate.page),/luar periode/);
});

test('A declared PeriodCode is used for a monthly total when the total row itself has no period',()=>{
  const item=source([{Key:'Filtered',Balance:12}],[filter('0'),{PropertyName:'PeriodCode',MatchMode:'equals',Value:'02022025'}],'bbtotal');
  delete item.page.Payload.Data[0].PeriodCode;
  assert.doesNotThrow(()=>checkLedgerScope(item,item.page));
  const total=selectLedgerRows(item,false);
  assert.equal(packagePath(total),'bukubesar-total/2025-02.json');assert.equal(total.ledgerSelection.masaDariFilter,'2025-02');
  assert.equal(total.ledgerSelection.filterLainPadaSumber,false);
  item.page.Request.Filters[1].Value='05052025';
  assert.throws(()=>checkLedgerScope(item,item.page),/luar periode/);
  item.page.Request.Logic='or';
  assert.equal(selectLedgerRows(item,false).ledgerPeriod,'');
});
