import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceChoices,supportedSources,tableFits} from '../extension/app-open-sources.js';
import {packagePath,periodLabel} from '../extension/app-package-entries.js';

const scope={wp:'0000000000000017',period:'2025-01 s.d. 2025-03'};
const item=(source,month,hash,opts={})=>({source,result:{filtered:false,atStart:true,atEnd:true,slices:[{month,hash,count:1}],...opts}});
test('each supported family has distinctive fields; document capture is restricted to a metadata table',()=>{
  const examples={info:['Nama Wajib Pajak','Status WP'],pihak:['PersonName','RelatedPersonType'],bank:['Nomor Rekening'],
    flag:['FlagType','FlagValue'],jenispajak:['TaxTypeCode','RegistrationDate'],alamat:['AddressDetail','TypeOfAddress'],
    klu:['TradeClassificationCode','ActivityDescription'],nomorlain:['IdentificationNumberType','IdentificationNumber'],
    sertel:['CertificateNumber','ValidFrom'],pbb:['TaxObjectNumber','LandArea'],dokumen:['DocumentNumber','DocumentTypeCode'],
    bb:['Amount','PostingDate'],bbtotal:['Debit','Credit','Balance']};
  assert.deepEqual(new Set(Object.keys(examples)),new Set(supportedSources));
  for(const [source,fields] of Object.entries(examples)){
    assert.ok(tableFits(source,fields));assert.equal(tableFits(source,['NPWP','Status']),false);
  }
  assert.equal(tableFits('dokumen',['DocumentNumber','DocumentTitle','FileContent']),false);
  assert.equal(tableFits('bplawan',['Amount','PostingDate']),false);
});
test('two copies count once, independent months remain selectable and conflicting captures stay out',()=>{
  const filtered=item('bank','','h1',{filtered:true}),unfiltered=item('bank','','h1'),jan=item('bb','2025-01','h3'),feb=item('bb','2025-02','h4');
  const first=sourceChoices([filtered,unfiltered,jan,feb,item('flag','','a'),item('flag','','b')],[],scope);
  assert.deepEqual(first.filter(r=>r.ready).map(r=>r.item),[unfiltered,jan,feb]);
  assert.equal(first.filter(r=>r.ready)[0].copies,1);assert.match(first.find(r=>r.item===filtered).status,/Salinan/);
  assert.ok(first.filter(r=>r.item.source==='flag').every(r=>/beberapa tampilan berbeda/.test(r.status)));
  const same={...scope,source:'bb',proof:{pratinjauSumber:{masa:'2025-01',sidikIsi:'h3'}}};
  assert.deepEqual(sourceChoices([jan,feb],[same],scope).filter(r=>r.ready).map(r=>r.item),[feb]);
  const native={...scope,source:'bb',page:{Payload:{Data:[{PeriodCode:'01012025'}]}}};
  assert.deepEqual(sourceChoices([jan,feb],[native],scope).filter(r=>r.ready).map(r=>r.item),[feb]);
  native.page.Payload.Data.push({PeriodCode:'02022025'});
  assert.equal(sourceChoices([jan,feb],[native],scope).filter(r=>r.ready).length,0);
});
test('monthly ledger and comparison balance route separately; non-month periods cannot create a monthly path',()=>{
  const entry={id:'fiktif',source:'bbtotal',proof:{pratinjauSumber:{masa:'2025-02'}},page:{Payload:{Data:[]}}};
  assert.equal(packagePath(entry),'bukubesar-total/2025-02.json');entry.source='bb';assert.equal(packagePath(entry),'bukubesar/2025-02.json');
  entry.proof.pratinjauSumber.masa='2025-13';assert.equal(packagePath(entry),'bb/fiktif.json');
  assert.equal(periodLabel([{PeriodCode:'01012025'}],true),'2025-01');
  assert.equal(periodLabel([{PeriodCode:'01012025'}]),'');
});
