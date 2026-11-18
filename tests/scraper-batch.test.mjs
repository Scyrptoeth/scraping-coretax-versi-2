import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestedSource} from '../extension/app-batch.js';
import {appendPackageEntry, metaForSelection, packagePath,selectSptListRows} from '../extension/app-package-entries.js';
import {indexPackage,rowsOf} from '../extension/analisis/model.js';
import {parseDelimited,checkIdentity,forms} from '../extension/app-data.js';

const wp='0000000000000001';
const make=(source,rows,spt='')=>({source,spt,wp,id:'local-1',name:'Dari tabel',period:'2025-01 s.d. 2025-12',
  origin:'Tabel tampak',rows:rows.length,total:null,page:{Payload:{Data:rows}}});

test('maps exactly fourteen values under the Coretax case-export header and preserves the original strings',()=>{
  const columns=['CaseNumber','MainTaxpayerTIN','MainTaxpayerName','CaseTypeName','CaseStatus','CaseSource','CreatedDate','CreatedByUser','IsSuspended','WorkflowStep','TopDueDate','EndDate','TaxRegion','TaxOffice'];
  const values=['00004',wp,'Nama, Fiktif','Jenis A','Aktif','Sumber A','2025-03-01','Contoh','false','04','','','01','02'];
  const quote=items=>items.map(x=>'"'+x+'"').join(',');
  const header=quote(['[object Object]','',...columns]), body=quote(values);
  const [parsed]=parseDelimited(header+'\r\n'+body);
  assert.deepEqual(Object.keys(parsed),columns);assert.deepEqual(Object.values(parsed),values);
  assert.doesNotThrow(()=>checkIdentity([parsed],wp));
  assert.throws(()=>checkIdentity([parsed],'0000000000000002'),/NPWP/);
  assert.throws(()=>parseDelimited(header+'\n'+body+',"extra"'),/Kolom/);
  assert.throws(()=>parseDelimited(header.replace('CaseSource','Different')+'\n'+body),/Kolom/);
  assert.throws(()=>parseDelimited(header+'\n'+body+'\n'+quote(values.slice(0,-1))),/Kolom/);
});

test('suggests only a selected, identifiable source',()=>{
  assert.equal(suggestedSource('Rekening bank',['bank','klu']),'bank');
  assert.equal(suggestedSource('Lainnya',['bank','klu']),'');
  assert.equal(suggestedSource('Rekening bank',['klu']),'');
});
test('classifies SPT lists per row and retains native fields, scope and ambiguous types',()=>{
  const codes=forms.map(([code])=>code);
  const rows=forms.flatMap(([code,name])=>[{ReturnSheetTypeCode:code},{'Jenis Surat Pemberitahuan Pajak':'SPT '+name}]);
  rows.push({'Jenis Surat Pemberitahuan Pajak':'SPT PPh Badan Rupiah'}, {'Jenis Pajak':'PPN'}, {ReturnSheetTypeCode:'VAT_VATR','Jenis SPT':'ICT_WITR'});
  const item=make('sptdaftar',rows,'VAT_VATR');item.total=30;
  const all=selectSptListRows(item,codes);
  assert.equal(all.page,item.page);assert.equal(all.spt,'');
  assert.equal(all.sptSelection.jenisBelumDikenali,2);
  assert.equal(all.sptSelection.perJenisPadaSumber.ICT_RCITR,3);
  const one=selectSptListRows(item,['ICT_RCITR']);
  assert.deepEqual(one.page.Payload.Data,[rows[8],rows[9],rows[12]]);
  assert.equal(one.sptSelection.totalDilaporkanSumber,30);assert.equal(one.total,null);
  assert.equal(selectSptListRows(item,[]),null);
});
test('records missing tax periods only for explicitly undated administrative sources',()=>{
  const meta={periode:'2025-01 s.d. 2025-12',opsi:{periode:{from:{y:2025,m:1},to:{y:2025,m:12}}}};
  const dated=make('tabelumum',[{CaseNumber:'01'}]),undated={...dated,period:null};
  const groups=new Map();appendPackageEntry(groups,undated,wp);
  const manifest=metaForSelection(meta,[undated]), entries=[...groups.values()];
  assert.equal(manifest.periode,'Tidak tercantum pada sumber');
  assert.equal(manifest.opsi.periode,null);assert.equal(entries[0].cap.konteks.periode,null);
  assert.deepEqual(indexPackage({manifest,entries}).years,[]);
  assert.equal(metaForSelection(meta,[dated]),meta);
  assert.equal(metaForSelection(meta,[dated,undated]),meta);
});
test('groups source pages without dropping provenance, duplicate rows or value types',()=>{
  const groups=new Map(),row={NPWP:wp,KLU:'00111',Nilai:'0'};
  for(let i=1;i<=2;i++)appendPackageEntry(groups,{...make('klu',[row]),name:'Halaman '+i,proof:{owner:['NPWP'],period:[],columns:Object.keys(row)}},wp);
  const [entry]=groups.values();assert.equal(entry.path,'profil/klu.json');assert.deepEqual(rowsOf(entry),[row,row]);
  assert.equal(entry.cap.baris,2);assert.equal(entry.cap.total,null);
  assert.deepEqual(entry.cap.halamanSumber.map(p=>p.asal),['Halaman 1','Halaman 2']);
  assert.deepEqual(entry.cap.halamanSumber[1].pencocokan.columns,Object.keys(row));
});
test('routes unambiguous SPT detail to the viewer and retains an untagged capture as raw data',()=>{
  const obj={NPWP:wp,'ID SPT':'TEST-1',Pembetulan:0,'Lampiran SPT':'Lampiran A2','Masa Pajak':'Januari 2025',Nilai:'0'};
  const item=make('sptisi',[obj],'VAT_VATR'),groups=new Map();appendPackageEntry(groups,item,wp);
  const indexed=indexPackage({manifest:{},entries:[...groups.values()]});
  assert.equal(indexed.forms.length,1);assert.equal(indexed.forms[0].period,'2025-01');assert.equal(indexed.forms[0].type,'PPN');
  assert.deepEqual(rowsOf(indexed.forms[0].parts.get('a2')),[obj]);
  for(const changed of [{'ID SPT':''},{Pembetulan:''},{'Masa Pajak':'lain'},{'Lampiran SPT':'../hapus'}]){
    assert.equal(packagePath(make('sptisi',[{...obj,...changed}],'VAT_VATR')),'sptisi/local-1.json');
  }
  assert.equal(packagePath(make('bb',[{'Masa Pajak':'2025-02'}])),'bukubesar/2025-02.json');
  assert.equal(packagePath(make('tabelumum',[{'Status kasus':'Aktif'}])),'tabel/local-1.json');
});
