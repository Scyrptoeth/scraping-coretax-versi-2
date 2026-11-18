import assert from 'node:assert/strict';
import test from 'node:test';
import {findingsFor,findingKey,workpaper} from '../extension/analisis/findings.js';
import {newDraft,visibleFindings,draftFindings} from '../extension/analisis/draft-model.js';
import {createXlsx} from '../extension/archive/table.js';
import {readZip,decodeText} from '../extension/archive/zip.js';

const inv={DocumentNumber:'FIKTIF-11',TIN:'Pemasok fiktif',DocumentDate:'2024-12-12',VAT:450};
const vat=(period,latest=true,list=[inv],complete=true)=>({
  type:'PPN',year:period.slice(0,4),period,latest,amended:false,meta:{},version:0,
  key:'spt/PPN/'+period,parts:new Map([['b2',{path:'spt/PPN/'+period+'/b2.json',cap:{lengkap:complete},pages:[{Payload:{Data:list}}]}]])
});
const ledger={path:'bukubesar/2025-09.json',pages:[{Payload:{Data:[{RecordId:'fiktif',IsCancelled:false,
  AccountingTypeCode:'TaxReturn',Amount:-450,AmountLeft:-80,RevenueCode:'411211'}]}}]};
const pkg={manifest:{wp:{nama:'Usaha Fiktif',npwp:'0000000000000001'}},
  forms:[vat('2024-12'),vat('2025-01',true,[inv,inv]),vat('2025-02',true,[inv]),vat('2025-03',false),
    vat('2025-04',true,[inv],false),vat('2026-02')],entries:[ledger,ledger]};
const manual={topik:'=literal',fakta:'Diperiksa',sumber:'Bukti A',menurutWp:0,menurutPetugas:1500,
  principal:0,tax:'PPh',evidence:'verified',review:'Dalam pengujian',status:'Selesai',simpulan:'',petugas:'Uji'};

test('findings use latest complete B2 per period, support cross-year references, avoid duplicated monthly rows and booked debt',()=>{
  const findings=findingsFor(pkg,'2025',[]);
  assert.equal(findings.length,2);
  const duplicate=findings.find(f=>f.status==='indikatif'),debt=findings.find(f=>f.status==='berbukti');
  assert.equal(duplicate.amount,900);
  assert.equal(duplicate.period,'2024-12, 2025-01, 2025-02');
  assert.equal(debt.amount,'');
  assert.match(debt.detail,/Rp80/);
  const mismatch={...pkg,forms:[vat('2025-02'),vat('2025-05',true,[{...inv,VAT:200}])]};
  assert.equal(findingsFor(mismatch,'2025',[]).find(r=>r.status==='indikatif').amount,'');
});
test('KKP and KKA scopes, reviewed findings and principal separately survive draft transfer',()=>{
  const work={rows:[manual],drafts:[],scopes:{kkp:'verified',kka:'all'}};
  const kkp=workpaper(pkg,'2025',work,'kkp','Pemeriksa'),kka=workpaper(pkg,'2025',work,'kka','AR');
  assert.equal(kkp.selected.length,2);assert.equal(kka.selected.length,3);
  assert.ok(!kkp.sheets.some(s=>s.name.includes('indikatif')));
  assert.ok(kka.sheets.some(s=>s.name.includes('L-9')));
  assert.equal(kka.summary.find(r=>r.Jenis==='PPh')['Pokok terisi (Rp)'],0);
  assert.equal(kka.summary.find(r=>r.Jenis==='411211')['Pokok terisi (Rp)'],null);
  const indicator=kka.selected.find(r=>r.status==='indikatif');
  work.dispositions={[findingKey(indicator)]:'Terjelaskan'};
  assert.equal(workpaper(pkg,'2025',work,'kka','AR').selected.length,2);
  const letter=newDraft('SP2DK',pkg,'2025',null,work.rows,work.dispositions);
  assert.equal(letter.findings.length,2);
  letter.scope='verified';letter.findings[0].taxpayer='23';letter.narrative='Suntingan pengguna';
  const minutes=newDraft('BAP2DK',pkg,'2025',letter);
  assert.equal(minutes.scope,'verified');
  assert.ok(visibleFindings(minutes).every(r=>r.taxpayer==='' && r.agreed===''));
  assert.equal(letter.narrative,'Suntingan pengguna');
  assert.equal(draftFindings(pkg,'2025',[{...manual,evidence:'none'}]).length,2);
});
test('generated formulas recalculate edited figures, preserve unknowns and leave untrusted cells literal',async()=>{
  const work={rows:[manual,{...manual,topik:'Belum ada angka WP',menurutWp:null}],analysis:{}};
  const output=workpaper(pkg,'2025',work,'kkp','Pemeriksa');
  const blob=await createXlsx({sheets:[...output.sheets,{name:'Untrusted',rows:[['=12+11',{formula:'EVAL()'}]]}]});
  const zip=await readZip(blob);
  const xml=decodeText(zip.get('xl/worksheets/sheet2.xml').data);
  assert.match(xml,/<f>IF\(COUNT\(D2,E2\)=2,E2-D2,&quot;&quot;\)<\/f><v>1500<\/v>/);
  assert.match(xml,/<c r="F3" t="str"><f>[^<]+<\/f><v><\/v><\/c>/);
  assert.match(xml,/t="inlineStr".*?=literal/);
  const last=decodeText(zip.get('xl/worksheets/sheet'+(output.sheets.length+1)+'.xml').data);
  assert.ok(last.includes('=12+11'));assert.ok(!last.includes('<f>'));
});
