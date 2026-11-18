import assert from 'node:assert/strict';
import test from 'node:test';
import {collectSptQueue} from '../extension/app-spt-directory.js';

function fixture(failOn){
  const opened=[],finished=[];
  const candidates=['ready','retry','pending'].map(status=>({doc:{parts:[{status}]},navigation:{
    open:async()=>{opened.push(status);return {tabId:1};},
    collect:async(view,sink)=>{
      sink.onPage({});
      if(status===failOn)throw Object.assign(Error('WP berubah'),{code:'IDENTITY'});
    }
  }}));
  const options={candidates,tabId:1,indexLimit:10,limit:10,onOpen(){},checkpoint(){},
    directory:{find:async group=>group[0],restore:async()=>{}},
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
