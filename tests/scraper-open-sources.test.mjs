import test from 'node:test';
import assert from 'node:assert/strict';
import {openSourcePreview,sourceChoices,supportedSources,tableFits} from '../extension/app-open-sources.js';
import {packagePath,periodLabel} from '../extension/app-package-entries.js';
import {collectOpenPages} from '../extension/app-open-source-pages.js';

const scope={wp:'0000000000000017',period:'2025-01 s.d. 2025-03'};
const item=(source,month,hash,opts={})=>({source,result:{filtered:false,atStart:true,atEnd:true,slices:[{month,hash,count:1}],...opts}});
function automaticCollector(options={}){
  const origin='https://coretax.intranet.pajak.go.id',tab={id:1,url:origin+'/sintetis'};
  const table={title:'Rekening bank',index:0,labels:['NPWP pemilik','BankAccountNumber'],rows:1};
  const list={stamp:'bukti',owner:['NPWP pemilik'],period:[],canAdvance:true,
    slices:[{month:'',hash:'isi',count:1}]};
  let reads=0;
  const ext={tabs:{query:async()=>[tab]},scripting:{executeScript:async({args:[request]})=>{
    reads++;
    if(request===null)return [{result:[table]}];
    if(!request.quick.includeRows)return [{result:list}];
    return [{result:options.changed?{skip:'WP pada sumber berubah.'}:{...list,
      slices:[{...list.slices[0],rows:[{'NPWP pemilik':scope.wp,BankAccountNumber:'FIKTIF'}]}]}}];
  }}};
  const state={...scope,sources:['bank','klu'],assignment:['uji']},collect=openSourcePreview({ext,origin,queued:[]});
  return {run:(params={})=>collect.collectSelected({scope:state,enqueue:()=>{},...params}),get reads(){return reads;},state};
}
test('automatic collection uses explicit scope, awaits the sink and reports missing, skipped and visible-page coverage',async()=>{
  const scan=automaticCollector(),queued=[];
  const result=await scan.run({items:queued,enqueue:async(info,page)=>{await Promise.resolve();queued.push({...info,page});}});
  assert.deepEqual(result.added,[{source:'bank',month:'',rows:1,morePages:true}]);assert.deepEqual(result.missing,['klu']);
  assert.ok(result.issues.some(s=>s.includes('halaman berikutnya')));assert.equal(queued.length,1);
  const duplicate=await scan.run({items:queued});assert.deepEqual(duplicate.added,[]);
  assert.ok(duplicate.skipped.some(s=>s.reason.includes('Sudah ada')));
  assert.ok(duplicate.issues.some(s=>s.includes('halaman berikutnya')));
  const replacement=await automaticCollector({changed:true}).run();assert.deepEqual(replacement.added,[]);
  assert.ok(replacement.issues.some(m=>m.includes('WP pada sumber berubah')));
  const noSources=automaticCollector();
  assert.deepEqual(await noSources.run({scope:{...noSources.state,sources:[]}}),{added:[],missing:[],skipped:[],issues:[]});
  assert.equal(noSources.reads,0);
  queued[0]={...queued[0],proof:{},origin:'Ekspor lokal'};
  assert.equal((await scan.run({items:queued})).added.length,0);assert.equal(queued.length,1);
});
test('a cancelled checkpoint propagates and cannot queue a staged source after its final read',async()=>{
  const scan=automaticCollector();let accepted=0;
  await assert.rejects(scan.run({checkpoint:()=>{if(scan.reads>=3)throw Error('Dihentikan.');},enqueue:()=>accepted++}),/Dihentikan/);
  assert.equal(accepted,0);assert.equal((await scan.run()).added.length,1);
});
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

function pageSimulation({copies=1,conflictingEnd=false,changes={}}={}){
  const positions=Array(copies).fill(0);
  const make=(i,n)=>{
    const value=changes[n]||'R-'+n,last=n===2,rows=[{Account:value}];
    const extra=last&&conflictingEnd&&i===1;
    return {stamp:'stamp-'+value,pageHash:'page-'+value,filterHash:'filter',range:{first:n+1,last:n+1,total:3},atStart:!n,
      atEnd:last&&!extra,canAdvance:!last||extra,canFirst:!!n,slices:[{month:'',hash:'slice-'+value,count:1,rows}]};
  };
  const peers=positions.map((_,id)=>({id,source:'bank',table:{labels:['Account']},result:make(id,0)}));
  async function read(p,expect,includeRows,nav){
    const state=make(p.id,positions[p.id]);
    if(expect&&expect!==state.stamp)return {skip:'stale'};
    if(nav.move){positions[p.id]=nav.move==='first'?0:positions[p.id]+1;return {moved:true};}
    return {...state,slices:state.slices.map(s=>({...s,rows:includeRows?s.rows:undefined}))};
  }
  return async(existing=[],limit=100,anchors=[])=>{
    const added=[];
    const problem=await collectOpenPages({peers,existing,anchors,read,limit,check:async()=>{},
      save:async(p,s,r,paginasi)=>added.push({proof:{pratinjauSumber:{paginasi,masa:s.month,sidikIsi:s.hash}}})});
    return {added,problem};
  };
}
test('every copy must agree that navigation ended before a final page can certify the table',async()=>{
  const a=await pageSimulation({copies:2,conflictingEnd:true})();
  assert.equal(a.added.length,3);assert.equal(a.added.at(-1).proof.pratinjauSumber.paginasi.akhir,false);
  assert.match(a.problem,/belum dapat dibuktikan/);
});
test('resume verifies each stored page before extending the saved prefix, even when the first page still matches',async()=>{
  const prefix=await pageSimulation()([],2);
  assert.equal(prefix.added.length,2);assert.match(prefix.problem,/Batas 2/);
  const same=await pageSimulation()(prefix.added);
  assert.equal(same.problem,'');assert.equal(same.added.length,1);assert.equal(same.added[0].proof.pratinjauSumber.paginasi.akhir,true);
  const changed=await pageSimulation({changes:{1:'new'}})(prefix.added);
  assert.equal(changed.added.length,0);assert.match(changed.problem,/berbeda dari hasil yang tersimpan/);
  const oldPreview=await pageSimulation()([],100,[{range:{first:2},stamp:'old-middle'}]);
  assert.equal(oldPreview.added.length,1);assert.match(oldPreview.problem,/dipratinjau berubah/);
});
