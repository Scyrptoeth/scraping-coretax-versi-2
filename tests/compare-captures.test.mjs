import test from 'node:test';
import assert from 'node:assert/strict';
import {compareCaptures} from '../scripts/compare-captures.mjs';

const wp='0000000000000017',periode={from:{y:2025,m:1},to:{y:2025,m:12}};
const bank=(path,rows)=>({path,cap:{sumber:'bank'},pages:[{Payload:{Data:rows}}]});
const pkg=(...entries)=>({entries,report:{valid:true},manifest:{wp:{npwp:wp},opsi:{periode}}});

test('the comparison pairs files by path and compares rows across page boundaries without losing duplicate, zero or blank values',()=>{
  const x={a:1,b:0},y={b:0,a:1},z={a:1,b:null};
  const ref=pkg(bank('bank/a',[x,z,x]),bank('bank/b',[x]),bank('bank/c',[x,x]),bank('bank/d',[x]),bank('bank/e',[]));
  const paged=bank('bank/a',[z]);paged.pages.push({Payload:{Data:[y,y]}});
  const miss=bank('bank/e',[]);miss.pages[0].IsSuccessful=false;
  const own=pkg(paged,bank('bank/b',[z]),bank('bank/c',[x]),bank('bank/f',[x]),miss);
  assert.deepEqual(compareCaptures(ref,own),{berkasAcuan:5,berkasPembanding:5,periodePilihan:'Sama',perSumber:[
    {sumber:'Rekening bank',hanyaAcuan:1,hanyaPembanding:1,berpasangan:4,kodeSumberBerbeda:0,responsSama:0,barisSama:1,barisBerbeda:2,barisBelumDapatDibandingkan:1}]});
});
test('the comparison identifies scope and integrity limitations and omits private paths, identities and row values',()=>{
  const entry=bank('bank/PRIVATE-DOCUMENT',['PRIVATE-ROW']);
  const ref=pkg(entry),own=pkg(structuredClone(entry));own.entries[0].cap.sumber='PRIVATE-CODE';
  own.manifest.opsi={};
  const out=compareCaptures(ref,own);assert.equal(out.periodePilihan,'Tidak dapat dipastikan');assert.equal(out.perSumber[0].kodeSumberBerbeda,1);
  assert.ok(!JSON.stringify(out).includes('PRIVATE'));assert.ok(!JSON.stringify(out).includes(wp));
  own.manifest.wp.npwp='0000000000000018';assert.throws(()=>compareCaptures(ref,own),/NPWP yang sama/);
  own.report.valid=false;assert.throws(()=>compareCaptures(ref,own),/Integritas/);
});
