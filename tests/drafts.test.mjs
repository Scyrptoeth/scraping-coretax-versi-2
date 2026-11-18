import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedDrafts, draftOutput, draftSheets, importAnswers, newDraft, suggestQuestions, visibleFindings } from "../extension/analisis/draft-model.js";

const pkg={manifest:{wp:{npwp:"0000000000000011",nama:"WP Sintetis"},penarik:{nama:"Petugas Sintetis"}},
  forms:[{year:"2025",period:"2025-01",type:"PPN",version:1,amended:true,key:"spt/PPN/2025-01/p01_fiktif"}],entries:[]};
test("role selection and BAP2DK transfer keep taxpayer statements and agreement empty",()=>{
  assert.deepEqual(allowedDrafts("AR"),["SP2DK","BAP2DK"]);
  assert.deepEqual(allowedDrafts("Pemeriksa"),["BAPK"]);
  assert.deepEqual(allowedDrafts("Penelaah"),[]);
  const letter=newDraft("SP2DK",pkg,"2025");
  letter.number="S-UJI";letter.findings[0].amount="25";letter.findings[0].taxpayer="0";
  const minutes=newDraft("BAP2DK",pkg,"2025",letter);
  assert.equal(minutes.related.number,"S-UJI");
  assert.equal(minutes.findings[0].amount,"25");
  assert.equal(minutes.findings[0].taxpayer,"");
  assert.equal(minutes.findings[0].agreed,"");
  assert.equal(draftOutput(minutes).tables[1].rows[1][5],25);
  minutes.scope="verified";assert.deepEqual(visibleFindings(minutes),[]);
  assert.throws(()=>newDraft("BAP2DK",pkg,"2024",letter));
});
test("only selected BAPK questions appear in Word; internal notes and IDs stay in control workbook",()=>{
  const d=newDraft("BAPK",pkg,"2025");
  assert.equal(suggestQuestions(d,pkg),2);
  assert.equal(suggestQuestions(d,pkg),0);
  d.questions[1].selected=true;d.questions[1].answer="Jawaban WP";d.questions[1].note="Catatan uji internal";
  const main=draftOutput(d),control=draftSheets(d).find(s=>s.name==="Kendali pertanyaan");
  assert.equal(main.tables[1].rows.length,2);
  assert.match(JSON.stringify(main),/Jawaban WP/);
  assert.doesNotMatch(JSON.stringify(main),/Catatan uji internal/);
  assert.doesNotMatch(JSON.stringify(draftOutput(d,"blank")),/Jawaban WP/);
  assert.match(draftOutput(d,"invitation").title,/Panggilan/);
  control.rows[2][2]="Jawaban direvisi";
  assert.equal(importAnswers(d,[control]),1);
  assert.equal(d.questions[1].answer,"Jawaban direvisi");
  control.rows.push(control.rows[2]);
  assert.throws(()=>importAnswers(d,[control]),/dua kali/);
});
