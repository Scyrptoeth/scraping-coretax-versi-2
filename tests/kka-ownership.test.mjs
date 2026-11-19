import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kkaOwnership} from '../extension/analisis/kka-ownership.js';

const owner='0000000000000045',shareholder='0000000000000046';
function returnForm(year,version,ownership){
  const path='spt/BADAN/'+year+'/p0'+version+'_fiktif/induk.json';
  const entry={path,cap:{lengkap:true,konteks:{npwp:owner}},pages:[{Payload:{
    MainFormData:{TaxYear:year},L1aFormData:{L1aTreeData:[{Data:{AccountCode:'4020'}}]},ListOfOwnership:ownership
  }}]};
  return {id:'fiktif',type:'BADAN',year,period:year,version,parts:new Map([['induk',entry]])};
}

test('shareholder and investment attachments use verified version for KKA tax year, separately from registration date',()=>{
  const registry={path:'profil/pihak-terkait.json',cap:{sumber:'pihak',lengkap:true,baris:2,konteks:{npwp:owner}},pages:[{Payload:{Data:[
    {PersonName:'Pemegang fiktif',PersonNIKTIN:shareholder,Percentage:70,ValidFrom:'2025-09-01',BenefitialOwner:true},
    {PersonName:'Registrasi berakhir',PersonNIKTIN:'0000000000000048',Percentage:30,ValidTo:'2026-10-01'}
  ]}}]};
  const record=(label,percentage)=>({Name:label,TIN:shareholder,PaidInCapitalPercentage:percentage,PaidInCapital:1_250,Dividend:0});
  const pkg={manifest:{wp:{npwp:owner},dibuat:'2026-11-01'},entries:[registry],forms:[
    returnForm('2024',0,{ListOfShareholders:[record('SPT lama',30)],InvestmentList:[]}),
    returnForm('2024',1,{ListOfShareholders:[record('SPT terpilih',70)],InvestmentList:[
      {Name:'Penyertaan fiktif',Tin:'0000000000000047',Investment:500,Debt:0,Receivable:null}
    ]}),
    returnForm('2025',0,{ListOfShareholders:[record('SPT tahun berikut',80)],InvestmentList:[]})
  ]};
  const [shares,investments]=kkaOwnership(pkg,'2024');
  assert.equal(shares.rows.find(r=>r[0]==='Porsi cocok pada kedua sumber')[1],1);
  assert.equal(shares.rows.find(r=>r[0]==='Total porsi dalam SPT (%)')[1],70);
  assert.ok(shares.workbook.rows.some(r=>r.includes('Pembetulan 1')&&r.at(-1).includes('2024/p01')));
  assert.ok(shares.workbook.rows.some(r=>r[0]==='SPT terpilih'&&r[1]===shareholder&&r[4]===1_250&&r[5]===0));
  assert.ok(shares.workbook.rows.some(r=>r[0]==='Pemegang fiktif'&&r[3]==='Ya'&&r.at(-1)===registry.path));
  assert.ok(!shares.workbook.rows.some(r=>r.includes('SPT tahun berikut')||r.includes('SPT lama')||r.includes('Registrasi berakhir')));
  assert.equal(investments.rows[1][1],1);
  assert.deepEqual(investments.workbook.rows.at(-1).slice(1,7),['0000000000000047',undefined,500,null,0,null]);
  assert.equal(kkaOwnership(pkg,'2025')[1].rows[1][1],0);
  assert.equal(kkaOwnership(pkg,'2023')[1].rows[1][1],null);
  assert.ok(kkaOwnership(pkg,'2023')[0].workbook.rows.some(r=>r.includes('Data SPT belum tersedia')));
});

test('ownership has no equivalent for OP and withholds lists if latest amendment is missing or malformed',()=>{
  const annual=returnForm('2025',0,{ListOfShareholders:[null],InvestmentList:[null]});
  const pkg={manifest:{wp:{npwp:owner}},entries:[],forms:[annual]};
  assert.equal(kkaOwnership(pkg,'2025')[0].rows[1][1],null);
  assert.equal(kkaOwnership(pkg,'2025')[1].rows[1][1],null);
  annual.parts.get('induk').pages[0].Payload.ListOfOwnership={ListOfShareholders:[],InvestmentList:[]};
  pkg.entries.push({path:'spt/daftar.json',cap:{sumber:'sptdaftar'},pages:[{Payload:{Data:[
    {ReturnSheetTypeCode:'ICT_RCITR',TaxPeriodCode:'01122025',ReturnSheetModel:'Amendment 1',RecordId:'latest-fiktif'}
  ]}}]});
  assert.equal(kkaOwnership(pkg,'2025')[1].rows[1][1],null);
  assert.deepEqual(kkaOwnership({...pkg,forms:[{...annual,type:'OP'}]},'2025'),[]);
});
