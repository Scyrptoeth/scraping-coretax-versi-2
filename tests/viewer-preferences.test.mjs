import assert from 'node:assert/strict';
import test from 'node:test';
import {outputFilename,readPref,resetAppearance,setPref} from '../extension/analisis/preferences.js';

test('name only single-taxpayer exports and keep identifiers as text',()=>{
  const wp={npwp:'0000000000000021',nama:'PT Récit / Uji:*?\nB'};
  resetAppearance();
  assert.equal(outputFilename('KKP-2025','xlsx',wp),'KKP-2025-0000000000000021.xlsx');
  setPref('filename','npwp-nama');
  assert.equal(outputFilename('KKP-2025','docx',wp),'KKP-2025-0000000000000021-PT-Récit-Uji-B.docx');
  assert.equal(outputFilename('Berkas','json',{...wp,nama:'../\\:'}),'Berkas-0000000000000021.json');
  assert.equal(outputFilename('Katalog','xlsx'),'Katalog.xlsx');
  assert.equal(outputFilename('SPT','xlsx',{nama:'Hanya nama'}),'SPT.xlsx');
  assert.equal(outputFilename('SPT','xlsx',{npwp:Number.MAX_SAFE_INTEGER+1}),'SPT.xlsx');
  setPref('role','AR');resetAppearance();
  assert.equal(readPref('role'),'AR');assert.equal(readPref('filename'),'npwp');
});
