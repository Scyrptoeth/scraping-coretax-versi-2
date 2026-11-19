import test from 'node:test';
import assert from 'node:assert/strict';
import {standardTables} from '../extension/analisis/standard-tables.js';
import {partRows} from '../extension/analisis/spt-forms.js';
import {compareDisplayed,fieldLabel,fieldValue,presentRows,sourceLabel} from '../extension/analisis/display-fields.js';

const entry=(path,sumber,rows)=>({path,cap:{sumber,label:'Lampiran'},pages:[{Payload:{Data:rows}}]});
test('Coretax tax types use the same captions in captured SPT lists and forms while retaining their source codes',()=>{
  const codes=['VAT_VAT','ICT_WIT','ICT_WT'],names=['PPN','PPh Pasal 21/26','PPh Unifikasi'];
  for(const column of ['TaxTypeCode','TaxType','Kode Jenis Pajak','Kode jenis pajak','Jenis Pajak']){
    const source=codes.map(value=>({[column]:value}));
    const item=entry('spt/daftar.json','sptdaftar',source);
    const [list]=standardTables({forms:[],entries:[item]});
    assert.deepEqual(list.rows().map(r=>r['Jenis pajak']),names);
    const form={parts:new Map([['a1',item]])};
    assert.deepEqual(partRows(form,'a1').map(r=>r['Jenis pajak']),names);
    assert.deepEqual(partRows(form,'a1',true).map(r=>r[column]),codes);
  }
  assert.equal(fieldValue('TaxType','PBB'),'PBB');
  assert.equal(fieldValue('TaxType','Pajak daerah'),'Pajak daerah');
  assert.equal(fieldValue('TaxTypeCode','FUTURE_TAX'),'FUTURE_TAX');
  assert.equal(fieldValue('TaxTypeCode','ICT_WITR'),'ICT_WITR');
  assert.equal(fieldValue('ReturnSheetTypeCode','ICT_WITR'),'SPT Masa PPh Pasal 21/26');
  assert.equal(fieldValue('OtherField','ICT_WT'),'ICT_WT');
});
test('home table headings and source codes give the same return context in the player',()=>{
  const canonical=[
    {ReturnSheetTypeCode:'ICT_RCITR',TaxPeriodCode:'01122025',ReturnSheetModel:'Amendment 02'},
    {ReturnSheetTypeCode:'LBT_LBTR',TaxPeriodCode:'01122026',ReturnSheetModel:'Normal'},
    {ReturnSheetTypeCode:'VAT_VATR',TaxPeriodCode:'09092026',ReturnSheetModel:'Normal'}
  ];
  const visible=canonical.map((r,i)=>({'Jenis Surat Pemberitahuan Pajak':['Tahunan PPh Badan','Surat Pemberitahuan Objek Pajak Pajak Bumi dan Bangunan','Masa PPN'][i],
    'Masa Pajak':['Januari - Desember 2025','Januari - Desember 2026','September 2026'][i],
    'Model SPT':i===0?'Pembetulan ke-2':'Normal'}));
  const expected=[
    ['SPT Tahunan PPh Badan','2025',2],['SPT PBB','Januari–Desember 2026',0],['SPT Masa PPN','September 2026',0]
  ];
  for(const source of ['sptdaftar','sptarsip']){
    for(const rows of [canonical,visible]){
      const tables=standardTables({forms:[],entries:[entry('spt/daftar.json',source,rows)]});
      assert.deepEqual(tables[0].rows().map(r=>[r['Jenis SPT'],r.Masa,r.Pembetulan]),expected);
    }
  }
  const conflict={...visible[0],ReturnSheetModel:'Normal'};
  assert.equal(standardTables({forms:[],entries:[entry('spt/daftar.json','sptdaftar',[conflict])]})[0].rows()[0].Pembetulan,null);
  assert.equal(fieldValue('Jenis Surat Pemberitahuan Pajak','LBT_LBTR'),'SPT PBB');
  assert.equal(fieldValue('Status SPT','SUBMITTED'),'Dilaporkan');
  assert.equal(fieldValue('Kanal','TAXPAYER_PORTAL'),'Portal Wajib Pajak');
  assert.equal(fieldValue('Masa Pajak','09092026'),'September 2026');
});
test('asset tables keep both return versions and all source groups with context, zeros and identifiers',()=>{
  const forms=[0,1].map(version=>{
    const part='l9-1-'+(version+1);
    const item=entry('spt/BADAN/2025/p'+version+'_test/'+part+'.json','sptisi',[{RecordId:'0012',AcquisitionPrice:version?47:0,GroupType:'Other Group',Notes:null}]);
    return {type:'BADAN',period:'2025',version,latest:version===1,parts:new Map([[part,item]])};
  });
  const [table]=standardTables({forms,entries:forms.flatMap(f=>[...f.parts.values()])});
  assert.equal(table.count,2);assert.deepEqual(table.rows().map(r=>[r.Pembetulan,r['Versi terakhir'],r['Harga perolehan'],r['ID rekaman']]),[[0,'Tidak',0,'0012'],[1,'Ya',47,'0012']]);
});
test('monthly and annual ledgers share a deduplicated index and list only actual detail rows',()=>{
  const row={RecordId:'h1',TransactionNumber:'00019',ReferenceNumber:'INV-1',IsLegallyBound:true,IsUnderAppeal:false,TaxpayerAccountingDetails:[{Amount:19,RecordId:'d1'},{Amount:0,RecordId:'d2'}]};
  const pkg={forms:[],entries:[entry('bukubesar/2025-01.json','bb',[row]),entry('bukubesar/2025-setahun.json','bb',[row,{RecordId:'h2',TaxpayerAccountingDetails:[]}])]};
  const tables=standardTables(pkg);
  assert.equal(tables.find(t=>t.id==='buku-gabungan').count,2);
  const ledger=tables.find(t=>t.id==='buku-gabungan');
  assert.deepEqual(ledger.rows().map(r=>[r['Status hukum/penagihan'],r['Jumlah rincian']]),[['Berkekuatan hukum',2],[null,0]]);
  assert.equal(ledger.rows(true)[0]['Dalam proses banding'],'Tidak');
  assert.deepEqual(tables.find(t=>t.id==='buku-rincian').rows().map(r=>[r['ID rekaman'],r.Jumlah,r['Referensi induk']]),[['d1',19,'INV-1'],['d2',0,'INV-1']]);
});
test('translated columns retain separate source fields when their labels coincide and preserve unrecognized codes',()=>{
  const rows=presentRows([{RecordID:'one',RecordId:'two',IsSelectable:false,AcquisitionPrice:0,Notes:null}],{filledOnly:true});
  assert.deepEqual(rows,[{'ID rekaman':'one','ID rekaman (2)':'two','Dapat dipilih':'Tidak','Harga perolehan':0}]);
  assert.equal(fieldValue('ReturnSheetStatusCode','SUBMITTED'),'Dilaporkan');
  assert.equal(fieldValue('ReturnSheetStatusCode','FUTURE_CODE'),'Kode sumber FUTURE_CODE');
  assert.equal(fieldValue('TaxPeriodCode','01012025'),'Januari 2025');
  assert.equal(fieldValue('CreationDatetime','2025-02-28T08:01:30Z'),'28 Februari 2025 · 08:01:30 UTC');
  assert.equal(fieldValue('PostingDate','2023-08-12T13:24:35.037+07:00'),'12 Agustus 2023 · 13:24:35.037 UTC+07:00');
  assert.ok(compareDisplayed('31 Januari 2024','1 Februari 2024')<0);
  assert.ok(compareDisplayed('12 Agustus 2023 · 13:24:35.037 UTC+07:00','12 Agustus 2023 · 07:00:00 UTC')<0);
  assert.equal(compareDisplayed('Agustus 2023','No. rekening'),undefined);
  assert.equal(fieldValue('PostingDate','2025-02-30'),'2025-02-30');
  assert.equal(fieldValue('PostingDate','0001-01-01T00:00:00'),'Tanggal belum ditetapkan');
  assert.equal(fieldValue('ReturnSheetTypeCode','LBT_LBTR'),'SPT PBB');
  assert.equal(fieldValue('TaxTypeCode','LBT_LBT'),'PBB');
  assert.equal(fieldLabel('WasUnderNonObjectionArt361BFirstRequestedDate'),'Tanggal permohonan · Pasal 36 ayat (1) huruf b · pertama');
  assert.equal(sourceLabel('spt/PPN/2025-01/p01_demo/induk.json · header.x'),'Induk SPT · PPN · Januari 2025 · pembetulan 1');
});
test('standard table context comes from each return or its own source file',()=>{
  const items=[entry('bukubesar-total/2024-setahun.json','bbtotal',[{Credit:0}]),
    entry('bukti-potong-lawan/2023/BP26.json','bplawan',[{EmployeeTin:'001'}]),
    entry('spt/daftar.json','sptdaftar',[{ReturnSheetTypeCode:'VAT_VATR',ReturnSheetModel:'Amendment 03',TaxPeriodCode:'07072024'},
      {ReturnSheetModel:'Versi tak dikenal'}])];
  const tables=standardTables({forms:[],entries:items});
  const values=id=>tables.find(t=>t.id==='sumber:'+id).rows();
  assert.deepEqual(values('bbtotal'),[{Periode:'Setahun 2024',Kredit:0}]);
  assert.deepEqual(values('bplawan'),[{Tahun:'2023','Jenis bukti potong':'BP26','NPWP pegawai':'001'}]);
  assert.equal(values('sptdaftar')[0].Masa,'Juli 2024');assert.equal(values('sptdaftar')[0].Pembetulan,3);
  assert.equal(values('sptdaftar')[0]['Jenis SPT pada sumber'],values('sptdaftar')[0]['Jenis SPT']);
  assert.equal(values('sptdaftar')[1].Pembetulan,null);assert.equal(values('sptdaftar')[1].Masa,null);
});
