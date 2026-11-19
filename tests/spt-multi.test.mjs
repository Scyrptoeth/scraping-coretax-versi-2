import assert from 'node:assert/strict';
import test from 'node:test';
import {collectSptQueue,sptDirectory} from '../extension/app-spt-directory.js';
import {sptNavigation} from '../extension/app-spt-navigation.js';
import {planSptDetails} from '../extension/app-spt-plan.js';

function fixture(failOn,failureCode='IDENTITY'){
  const opened=[],finished=[];
  const candidates=['ready','retry','pending'].map(status=>({doc:{parts:[{status}]},navigation:{
    open:async()=>{opened.push(status);return {tabId:1};},
    collect:async(view,sink)=>{
      sink.onPage({});
      if(status===failOn)throw Object.assign(Error('Source interrupted'),{code:failureCode});
    }
  }}));
  const options={candidates,indexLimit:10,limit:10,onOpen(){},checkpoint(){},
    directory:{tabId:1,find:async group=>group[0],restore:async()=>{}},
    createSink(candidate){
      let pages=0;
      return {onPage(){pages++;},finish(error){
        finished.push([candidate.doc.parts[0].status,pages,error?.code || null]);
        return {pages,issues:error?[error.message]:[]};
      }};
    }};
  return {options,opened,finished};
}

test('retry and incomplete versions are visited before a selected version already verified complete',async()=>{
  const {options,opened}=fixture();
  assert.deepEqual(await collectSptQueue(options),{attempted:3,withPages:3,pages:3,problem:null});
  assert.deepEqual(opened,['retry','pending','ready']);
});

test('owner change retains checked pages and reports every remaining selection without opening it',async()=>{
  const {options,opened,finished}=fixture('retry'),result=await collectSptQueue(options);
  assert.equal(result.attempted,1);assert.equal(result.pages,1);assert.equal(result.problem.code,'IDENTITY');
  assert.deepEqual(opened,['retry']);
  assert.deepEqual(finished,[['retry',1,'IDENTITY'],['ready',0,'IDENTITY'],['pending',0,'IDENTITY']]);
});

test('a form that failed to load leaves its checked pages and the remaining versions are attempted',async()=>{
  const {options,opened,finished}=fixture('retry','SPT_LOAD_TIMEOUT');
  const restored=[];
  options.directory.restore=async(candidate,view,checkpoint,failure)=>restored.push(failure?.code??null);
  const result=await collectSptQueue(options);
  assert.equal(result.attempted,3);
  assert.deepEqual(opened,['retry','pending','ready']);
  assert.deepEqual(restored,['SPT_LOAD_TIMEOUT',null,null]);
  assert.deepEqual(finished,[['retry',1,'SPT_LOAD_TIMEOUT'],['pending',1,null],['ready',1,null]]);
});

test('work-tab version search rechecks the same page when its cells settle before the next click',async()=>{
  const selector={index:0,indexSource:'sptdaftar',labels:['Model SPT'],tableId:'spt',title:'SPT Dilaporkan'};
  const wp='0000000000000017',url='https://coretax.intranet.pajak.go.id/returnsheets/id-ID/submitted-returnsheets/example';
  let content='Memuat',attempts=0;
  const ext={tabs:{get:async()=>({url})},scripting:{async executeScript({args:[options]}){
    let result;
    if(!options)result=[selector];
    else if(options.advance){
      attempts++;
      content='Pembetulan 1';
      result={staleBeforeAdvance:true};
    }else result={indexScope:'Daftar SPT lintas masa',rows:[{'Model SPT':content}],position:{pageNumber:1,atStart:true},
      canFirst:false,canAdvance:true};
    return [{result,documentId:'simulasi'}];
  }}};
  const directory=await sptDirectory(ext,1,wp,{workTab:true});
  const candidate={navigation:{matches:row=>row['Model SPT']==='Pembetulan 1'}};
  assert.equal(await directory.find([candidate],{checkpoint(){},limit:2}),candidate);
  assert.equal(attempts,1);
});

test('a changing work-tab appendix accepts only the next verified position and does not click twice',async()=>{
  const wp='0000000000000017',period={from:{y:2025,m:1},to:{y:2025,m:1}};
  const meta={'jenis spt':'ICT_WITR','masa pajak':'2025-01','model spt':'normal','npwp wajib pajak':wp};
  const page={Payload:{Data:[{...meta,'Nomor Bukti Penerimaan':'BPE-SIMULASI'}]}};
  const {documents:[doc]}=planSptDetails({wp,period,items:[{wp,source:'sptdaftar',page}]});
  const view={tabId:1,meta,identityBasis:'Formulir uji',sections:[{part:'l1a',label:'L-IA',visible:true}]};
  let attempts=0,moves=0,behind=0;
  const ext={scripting:{async executeScript({args:[options]}){
    if(options.mode==='advance'){
      assert.equal(options.position[1],1);
      if(++attempts===1)return [{result:{changed:true}}];
      assert.equal(options.before,JSON.stringify([['11']]));
      moves++;
      return [{result:{advanced:true}}];
    }
    if(!options.part)return [{result:view}];
    const pageNumber=moves && ++behind>1?2:1;
    return [{result:{...view,part:'l1a',label:'L-IA',pageNumber,range:null,filtered:false,
      rows:[{DPP:pageNumber===1&&!moves?(attempts?'11':'10'):'20'}],columns:['DPP'],paging:pageNumber===1?'next':'end',atEnd:pageNumber===2}}];
  }}};
  const nav=sptNavigation({ext,wp,period,doc,allowLinkedReturn:true}),values=[],issues=[];
  await nav.collect(view,{limit:10,skipParts:new Set(['induk']),checkpoint(){},onPage:result=>values.push([result.pageNumber,result.rows[0].DPP]),
    onIssue:(section,error)=>issues.push(error.message)});
  assert.deepEqual(values,[[1,'11'],[2,'20']]);
  assert.deepEqual(issues,[]);
  assert.equal(attempts,2);
  assert.equal(moves,1);
});

test('a verified work-tab form waits for its header to redraw and still rejects a different taxpayer',async()=>{
  const wp='0000000000000017',period={from:{y:2025,m:1},to:{y:2025,m:1}};
  const meta={'jenis spt':'ICT_WITR','masa pajak':'2025-01','model spt':'normal','npwp wajib pajak':wp};
  const page={Payload:{Data:[{...meta,'Nomor Bukti Penerimaan':'BPE-SIMULASI'}]}};
  const {documents:[doc]}=planSptDetails({wp,period,items:[{wp,source:'sptdaftar',page}]});
  const view={tabId:1,meta,identityBasis:'Formulir uji',sections:[{part:'induk',label:'Induk',visible:true}]};
  let reads=0,changesTaxpayer=false;
  const ext={scripting:{async executeScript({args:[options]}){
    if(!options.part && ++reads===1)return [{result:{loading:true}}];
    const result=changesTaxpayer?{identityChanged:true}:options.part?{...view,part:'induk',label:'Induk',
      rows:[{DPP:'10'}],columns:['DPP'],paging:'none'}:view;
    return [{result}];
  }}};
  const nav=sptNavigation({ext,wp,period,doc,allowLinkedReturn:true});
  assert.deepEqual((await nav.capture(view,'induk')).rows,[{DPP:'10'}]);
  changesTaxpayer=true;
  await assert.rejects(nav.capture(view,'induk'),{code:'IDENTITY'});
});
