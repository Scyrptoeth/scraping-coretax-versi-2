import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kkaManagementSheet} from '../extension/analisis/kka-management.js';
import {createXlsx} from '../extension/archive/table.js';
import {decodeText,readZip} from '../extension/archive/zip.js';

const owner='0000000000000089',other='0000000000000091',day='2026-11-18';
function source(name,path,data,wp=owner){
  return {path,cap:{sumber:name,konteks:{npwp:wp},lengkap:true,baris:data.length,total:data.length},
    pages:[{IsSuccessful:true,Payload:{Data:data,TotalRecords:data.length}}]};
}
function packageWith(data,type='TA002'){
  const entries=[source('info','profil/informasi-umum.json',[{GeneralInformation:{UniqueIdentificationNumber:owner,TaxpayerType:type}}])];
  if(data)entries.push(source('pihak','profil/pihak-terkait.json',data));
  return {manifest:{wp:{npwp:owner}},forms:[],entries};
}
function grid(sheet){
  const n=sheet.rows.findIndex(row=>row[0]==='Peran');
  return {labels:sheet.rows[n],people:sheet.rows.slice(n+1).filter(r=>r.length>1)};
}

test('registry roles retain history and text identifiers; pure shareholders stay outside the register',async()=>{
  const id='0011000000000001',base={PersonName:'Orang simulasi',PersonNIKTIN:id,BusinessRoleType:'PP',ValidTo:null};
  const rows=[
    {...base,RelatedPersonType:'C_LC_CO'},
    {...base,RelatedPersonType:'C_LC_DI',ValidFrom:'1980-01-20',ValidTo:'2026-11-17'},
    {...base,RelatedPersonType:'C_LC_DI',PersonRole:'CO004',Percentage:60,ValidTo:day},
    {...base,RelatedPersonType:'C_LC_OT'},
    {...base,RelatedPersonType:'C_LC_XY',RelatedPersonSubType:'C_LC_XY_EM'},
    {...base,TypeOfRelatedTaxpayer:'TY003'},
    {...base,TypeOfRelatedTaxpayer:'TY001',Percentage:40,PersonName:'Pemilik murni'}
  ];
  const sheet=kkaManagementSheet(packageWith(rows),day);
  const {labels,people}=grid(sheet);
  assert.deepEqual(labels,['Peran','Nama','NPWP/NIK','Porsi (%)','Kode jabatan','Berlaku dari','s.d.','Status']);
  assert.deepEqual(people.map(r=>r[0]),['Direksi','Direksi','Komisaris','Pihak lain','Pihak terkait (WP)','C_LC_XY C_LC_XY_EM PP']);
  assert.ok(people.every(r=>r[2]===id));
  assert.equal(people[0][3],60);assert.equal(people[0][4],'CO004');assert.equal(people[0][7],'Aktif');
  assert.equal(people[1][5],'20-01-1980');assert.equal(people[1][7],'Berakhir');
  const xlsx=await createXlsx({sheets:[{name:'Profil',rows:[['Profil']]},sheet,{name:'SPT',rows:[['SPT']]},{name:'KKA',rows:[['KKA']]}],contentsName:'L-0'});
  const xml=[...await readZip(xlsx)].filter(([n])=>/^xl\/worksheets\/sheet\d+.xml$/.test(n)).map(([,e])=>decodeText(e.data));
  assert.ok(xml.some(s=>s.includes('L-2a Pengurus')&&s.includes('location=')));
  assert.ok(xml.some(s=>/t="inlineStr"><is><t[^>]*>0011000000000001<\/t>/.test(s)));
});

test('empty, incomplete and unavailable registry sources remain distinguishable',()=>{
  assert.match(kkaManagementSheet(packageWith([]),day).rows.flat().join(' '),/mencatat nol/);
  const partial=packageWith([]);partial.entries[1].cap.total=2;
  const out=kkaManagementSheet(partial,day).rows.flat().join(' ');
  assert.match(out,/belum terkonfirmasi lengkap/);assert.doesNotMatch(out,/mencatat nol/);
  const missing=packageWith(null),foreign=source('pihak','profil/pihak-terkait.json',[{PersonName:'Row from different owner'}],other);
  missing.entries.push(foreign);
  assert.match(kkaManagementSheet(missing,day).rows.flat().join(' '),/belum tersedia/);
  missing.entries.push(source('pihak','profil/pihak-terkait.json',[{'Nama Pihak Terkait':'Table sample','Jenis Pihak Terkait':'Direksi','NPWP/NIK':'0000123'}]));
  const {labels,people}=grid(kkaManagementSheet(missing,day));
  assert.deepEqual(labels,['Peran','Nama','NPWP/NIK','Status']);
  assert.deepEqual(people,[['Direksi','Table sample','0000123','Belum diketahui']]);
  assert.equal(kkaManagementSheet(packageWith([],'TA001'),day),null);
  const unclear={manifest:{wp:{npwp:owner}},forms:[],entries:[foreign]};
  assert.equal(kkaManagementSheet(unclear,day),null);
  unclear.forms=[{type:'BADAN'}];assert.ok(kkaManagementSheet(unclear,day));
  unclear.forms.push({type:'OP'});assert.equal(kkaManagementSheet(unclear,day),null);
});

test('expiration uses the UTC export day, including at midnight in Indonesia',context=>{
  const p=packageWith([{PersonName:'Contoh',RelatedPersonType:'C_LC_DI',ValidTo:'2026-11-18'}]);
  p.manifest.dibuat='2026-11-08T15:30:00Z';
  context.mock.timers.enable({apis:['Date'],now:new Date('2026-11-19T00:00:00+07:00')});
  const sheet=kkaManagementSheet(p);
  assert.equal(grid(sheet).people[0].at(-1),'Aktif');assert.match(sheet.rows[1][0],/18-11-2026 \(UTC\)/);
  context.mock.timers.tick(7*60*60*1000);
  assert.equal(grid(kkaManagementSheet(p)).people[0].at(-1),'Berakhir');
});

test('a failed registry or integrity check cannot establish an empty register',()=>{
  const p=packageWith([]),note=()=>kkaManagementSheet(p,day).rows.flat().join(' ');
  p.report={valid:false};assert.doesNotMatch(note(),/mencatat nol/);
  p.report.valid=true;
  for(const failed of ['data/profil/pihak-terkait.json',{sumber:'pihak'},{label:'Pihak terkait'}]){
    p.manifest.gagal=[failed];assert.doesNotMatch(note(),/mencatat nol/);
    assert.match(note(),/belum terkonfirmasi lengkap/);
  }
  p.manifest.gagal=[{path:'data/profil/rekening-bank.json'}];assert.match(note(),/mencatat nol/);
});
