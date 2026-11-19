import assert from 'node:assert/strict';
import test from 'node:test';
import {homeLedgerCode,homeLedgerMonth,homeWithholdingGroup,planHomeCapture,scopeHomeRows,verifyHomeRowOwners} from '../extension/app-home-plan.js';
import {appendPackageEntry,selectSptListRows} from '../extension/app-package-entries.js';

const wp = '0000000000000001', other = '0000000000000002';
const period = '2025-12 s.d. 2026-01';
const plan = options => planHomeCapture({wp,period,sources:['bb'],...options});
const scope = (rows,options = {}) => scopeHomeRows(rows,{wp,sourceWp:wp,period,source:'bb',...options});

test('the home plan enumerates both endpoint months once for a single owner', () => {
  const result = plan({wp:wp.slice(1),sources:['bb','bbtotal','bb']});
  assert.equal(result.wp,wp);
  assert.deepEqual(result.months,['2025-12','2026-01']);
  assert.deepEqual(result.years,[2025,2026]);
  assert.deepEqual(result.sources,['bb','bbtotal']);
  assert.deepEqual(plan({period:result.period}).months,result.months);
  assert.throws(() => plan({wp:wp+';'+other}),/satu NPWP/i);
  for (const invalid of ['2026-01 s.d. 2025-12','2025-13 s.d. 2026-01','2025-12','']) {
    assert.throws(() => plan({period:invalid}),/bulan dan tahun/);
  }
  assert.throws(() => plan({sources:['sptdaftar'],types:[]}),/Pilih jenis SPT/);
  assert.throws(() => plan({sources:['unknown']}),/Pilih sumber data/);
  assert.deepEqual(plan({types:[]}).types,[]);
});

test('filters submitted, expected and archived lists by tax period and selected form, regardless of filing date', () => {
  const keep = {ReturnSheetTypeCode:'VAT_VATR',TaxPeriodCode:'12122025',ReturnDate:'2026-04-30'};
  const annual = {'Jenis SPT':'Tahunan PPh Badan','Tahun Pajak':'2026'};
  const outside = {'Jenis SPT':'Masa PPN','Masa Pajak':'November 2025',ReturnDate:'2026-01-03'};
  const unknownDate = {...keep,TaxPeriodCode:'',ReturnDate:'2026-01-01'};
  const otherType = {...keep,ReturnSheetTypeCode:'ICT_WITR'};
  const unknownType = {...keep,ReturnSheetTypeCode:'unrecognized'};
  for (const source of ['sptdaftar','sptarsip','sptbelum']) {
    const result = scope([keep,annual,outside,unknownDate,otherType,unknownType],{source,types:['VAT_VATR','ICT_RCITR']});
    assert.deepEqual(result,{rows:[keep,annual],sourceRows:6,outsidePeriod:1,unknownPeriod:1,excludedType:1,unknownType:1});
    assert.deepEqual(scope([unknownType],{source}).rows,[unknownType]);
  }
});

test('ledger and withholding records must show the tax month or have an independently observed month filter', () => {
  const totals = {Debit:12,Credit:10};
  assert.equal(scope([totals],{source:'bbtotal'}).unknownPeriod,1);
  assert.deepEqual(scope([totals],{source:'bbtotal',sourceMonth:'2026-01'}).rows,[totals]);
  assert.deepEqual(scope([totals],{source:'bbtotal',sourceLedgerCode:'01122026'}).rows,[totals]);
  assert.deepEqual(scope([totals],{source:'bbtotal',sourceLedgerCode:'04032026'}).rows,[totals]);
  assert.equal(scope([{PeriodCode:'01012026'}],{source:'bb',sourceLedgerCode:'04032026'}).unknownPeriod,1);
  assert.throws(() => scope([totals],{sourceMonth:'2026-01',sourceLedgerCode:'02022026'}),/Kode masa/);
  const rows = [{PeriodCode:'01012026'},{PeriodCode:'02022026'},{PeriodCode:'01012026',FiscalYear:2025},{}];
  assert.deepEqual(scope(rows),{rows:[rows[0]],sourceRows:4,outsidePeriod:1,unknownPeriod:2,excludedType:0,unknownType:0});
  assert.equal(scope([rows[1]],{sourceMonth:'2026-01'}).unknownPeriod,1);
  assert.throws(() => scope([],{sourceMonth:'2026-00'}),/Bulan/);
  assert.deepEqual(scope([totals],{source:'bbsaldo'}).rows,[totals]);
  const withheld = {EmployeeTin:wp,WitholderTin:other,TaxPeriodCode:'01012026',FiscalYear:2026};
  assert.deepEqual(scope([withheld],{source:'bplawan'}).rows,[withheld]);
  assert.throws(() => scope([{...withheld,EmployeeTin:other}],{source:'bplawan'}),/NPWP/);
  const withinYear={...withheld,TaxPeriodCode:'08082026'};
  assert.deepEqual(scope([withinYear],{source:'bplawan'}).rows,[withinYear]);
  assert.equal(scope([{...withheld,FiscalYear:2025}],{source:'bplawan'}).unknownPeriod,1);
});

test('requires visible owner even on empty pages, distinguishes related persons and checks every ledger row', () => {
  assert.throws(() => scope([],{sourceWp:undefined}),/NPWP/);
  assert.throws(() => scope([],{sourceWp:other}),{code:'IDENTITY'});
  assert.throws(() => scope([{TaxpayerTIN:other,PeriodCode:'11112023'}]),/NPWP/);
  assert.throws(() => scope([{'NPWP WP':other}],{source:'alamat'}),{code:'IDENTITY'});
  assert.throws(() => scope([{GeneralInformation:{UniqueIdentificationNumber:other}}],{source:'info'}),/NPWP/);
  assert.throws(() => scope([null]),/baris/);
  const related = {NPWP:other,'NPWP WP':wp,'Berlaku Sejak':'2015-01-01'};
  assert.deepEqual(scope([related],{source:'pihak'}).rows,[related]);
  assert.doesNotThrow(() => verifyHomeRowOwners([related],{source:'pihak',wp}));
  assert.deepEqual(scope([]).rows,[]);
  for (const source of ['sptisi','tabelumum','unknown']) assert.throws(() => scope([],{source}),/pemeriksaan/);
});

test('observed tax periods and certificate types determine the archive paths and year context', () => {
  const item=(source,proof) => ({id:'demo',wp,source,period,page:{Payload:{Data:[]}},rows:0,proof:{dariBeranda:proof}});
  const entry=(source,proof) => appendPackageEntry(new Map(),item(source,proof),wp);
  assert.equal(homeLedgerMonth({'Masa Pajak':'Januari - Januari 2026'}),'2026-01');
  assert.equal(homeLedgerMonth({PeriodCode:'04122025'}),'');
  assert.equal(homeLedgerCode({PeriodCode:'April - Maret 2026'}),'04032026');
  assert.equal(homeLedgerCode({PeriodCode:'2025'}),'');
  assert.equal(homeLedgerCode({TaxYear:2025}),'');
  const fiscal={PeriodCode:'04032026'};
  assert.deepEqual(scope([fiscal]).rows,[fiscal]);
  const january={TaxPeriodCode:'01012026','Jenis Bukti Potong':'BPPU'};
  assert.deepEqual(homeWithholdingGroup(january),{tahun:2026,jenis:'BPPU'});
  assert.deepEqual(homeWithholdingGroup({FiscalYear:2025},'BPA1'),{tahun:2025,jenis:'BPA1'});
  assert.equal(homeWithholdingGroup(january,'BP21'),null);
  assert.equal(homeWithholdingGroup({FiscalYear:2025,TaxCertificateCode:'BPPU'}),null);
  const slip=entry('bplawan',{buktiPotong:homeWithholdingGroup(january)});
  assert.equal(slip.path,'bukti-potong-lawan/2026/BPPU.json');
  assert.deepEqual(slip.cap.konteks,{npwp:wp,periode:period,tahun:2026,jenis:'BPPU'});
  assert.equal(entry('bplawan',{buktiPotong:{tahun:2026,jenis:'../BPPU'}}).path,'bplawan/demo.json');
  for (const [code,tail] of [['01012026','01'],['01122026','setahun'],['04032026','04032026']]) {
    const detail=entry('bb',{kodeMasa:code}),total=entry('bbtotal',{kodeMasa:code});
    assert.equal(detail.path,'bukubesar/2026-'+tail+'.json');
    assert.equal(total.cap.konteks.totalOf,detail.path);
    assert.equal(total.cap.konteks.tahun,2026);
    assert.equal(total.cap.lengkap,false);
  }
});

test('an empty archived or unsubmitted list must have independently verified zero rows before packaging', () => {
  for (const source of ['sptarsip','sptbelum']) {
    const home={rentangUtuh:true,filterAktif:false,totalTampilan:0,barisSumber:0,kosongPadaSumber:true};
    const item={source,rows:0,page:{Payload:{Data:[],TotalRecords:0}},proof:{nolPadaSumber:true,dariBeranda:home}};
    assert.equal(selectSptListRows(item,['VAT_VATR']).rows,0);
    for (const change of [{filterAktif:true},{totalTampilan:null},{barisSumber:1},{rentangUtuh:false}]) {
      assert.equal(selectSptListRows({...item,proof:{...item.proof,dariBeranda:{...home,...change}}},['VAT_VATR']),null);
    }
  }
});
