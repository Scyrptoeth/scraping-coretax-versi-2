import assert from 'node:assert/strict';
import test from 'node:test';
import {reconcileLedgerTotals} from '../extension/analisis/ledger-reconciliation.js';

const wp='0000000000000088';
const filter={PropertyName:'PeriodCode',MatchMode:'equals',Value:'01012025'};
function fixture(){
  const cap=()=>({lengkap:true,konteks:{npwp:wp,masa:1,tahun:2025},payload:{Filters:[filter]}});
  const detail={path:'bukubesar/2025-01.json',cap:cap(),pages:[{Payload:{TotalRecords:2,Data:[
    {RecordId:'a',Amount:50,IsCancelled:false},{RecordId:'b',Amount:-30,IsCancelled:true}]}}]};
  const total={path:'bukubesar-total/2025-01.json',cap:cap(),pages:[{Payload:[{Key:'Total',Balance:901},{Key:'Filtered',Balance:20}]}]};
  const pkg={manifest:{wp:{npwp:wp}},entries:[total,detail]};
  return {detail,total,pkg,run:()=>reconcileLedgerTotals(pkg)[0]};
}
test('compare the signed balance to the filtered total for the same period and leave underlying movements intact',()=>{
  const f=fixture();assert.equal(f.run().Hasil,'Saldo cocok');assert.equal(f.run()['Baris total'],'Filtered');
  f.total.pages[0].Payload[1].Balance=0;assert.equal(f.run()['Selisih (Rp)'],20);
  f.detail.pages[0].Payload.Data=[];assert.equal(f.run()['Jumlah rincian (Rp)'],0);
  f.detail.cap.lengkap=false;assert.match(f.run().Cakupan,/baris tersimpan/);
  f.total.pages[0].Payload.splice(1);assert.equal(f.run()['Saldo pembanding (Rp)'],901);
});
test('a query limit repeated as a total cannot certify a complete population from observed balances',()=>{
  const f=fixture();
  f.detail.cap.total=null;Object.assign(f.detail.cap.payload,{First:0,Rows:10000});
  f.detail.pages[0].Payload.TotalRecords=10000;
  assert.equal(f.run().Hasil,'Saldo cuplikan cocok');
  assert.equal(f.run()['Selisih (Rp)'],0);
});
test('displayed book amounts and filtered balances support a snapshot comparison',()=>{
  const f=fixture();
  const row=amount=>({'Nomor Transaksi':'FIKTIF','Jenis Pencatatan':'Pembayaran','Masa Pajak':'Januari 2025',
    Jumlah:amount,'Mata Uang':'IDR'});
  f.detail.pages[0].Payload.Data=[row('50.125'),row('-30.025')];
  f.detail.cap.lengkap=false;
  f.total.pages[0].Payload[1]={Key:'Filtered',Saldo:'20.100'};
  assert.equal(f.run()['Saldo pembanding (Rp)'],20100);
  assert.equal(f.run()['Selisih (Rp)'],0);
  assert.equal(f.run().Hasil,'Saldo cuplikan cocok');
  f.total.pages[0].Payload[1].Saldo='20.100,25';
  assert.equal(f.run()['Selisih (Rp)'],null);
});
test('missing ownership, period, currency, ID uniqueness, matching filters or an unambiguous source total withholds the difference',()=>{
  for(const change of [f=>f.total.cap.konteks.npwp='0000000000000099',f=>f.total.cap.konteks.masa=2,
    f=>f.pkg.manifest.gagal=[{path:'data/'+f.detail.path}],f=>f.detail.pages[0].Payload.Data[1].RecordId='a',
    f=>f.detail.cap.payload.Filters=[filter,{PropertyName:'IsCancelled',MatchMode:'equals',Value:'0'}],
    f=>f.detail.pages[0].Payload.Data[1].CurrencyCode='USD',f=>f.total.pages[0].Payload.push({Key:'Filtered',Balance:20})]){
    const f=fixture();change(f);assert.equal(f.run()['Selisih (Rp)'],null);
  }
});
test('captured detail may exclude cancellations while the total still includes them',()=>{
  const f=fixture();
  for(const [entry,jenis] of [[f.detail,'rincian'],[f.total,'total']]){
    delete entry.cap.payload;entry.cap.halamanSumber=[{pemilihanBukuBesar:{jenis,ikutkanBatal:false,
      filterPembatalanSumber:'tanpa-filter-pembatalan',filterLainPadaSumber:false,konflikStatus:0,tidakDiketahui:0}}];
  }
  f.detail.pages[0].Payload.Data.pop();assert.equal(f.run()['Selisih (Rp)'],null);
  f.total.cap.halamanSumber[0].pemilihanBukuBesar.filterPembatalanSumber='aktif';assert.equal(f.run()['Selisih (Rp)'],30);
});
