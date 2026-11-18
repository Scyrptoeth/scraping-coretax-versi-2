import assert from 'node:assert/strict';
import test from 'node:test';
import {checkIdentity, csvCell, filePage, parseDelimited, readCaptureId, rowsOf} from '../extension/app-data.js';

test('normalizes WP identifiers as text, deduplicates and rejects partial matches', () => {
  assert.equal(readCaptureId('123456789012345\n01.234.567.890.123-45'),'0123456789012345');
  for(const sep of [',','\n',';','\r','\t']) assert.throws(()=>readCaptureId('0123456789012345'+sep+'0000000000000001'),/satu NPWP/);
  assert.equal(readCaptureId(' \n'),'');
  assert.throws(() => readCaptureId('abc0123456789012345'));
});
test('delimited exports preserve newlines, delimiters, escaped quotes, and NPWP zeroes', () => {
  const rows=parseDelimited('\uFEFFNPWP;Keterangan\r\n0000000000000001;"a; b\n""c"""\r\n');
  assert.deepEqual(rows,[{NPWP:'0000000000000001',Keterangan:'a; b\n"c"'}]);
  assert.throws(() => parseDelimited('a,a\n1,2'));
  assert.throws(() => parseDelimited('a,b\n1'));
  assert.throws(() => parseDelimited('a,b\n1,"2'));
  assert.equal(csvCell('=1+1'),'"\'=1+1"');
});
test('preserves native envelopes, prevents explicit mixed-WP assignments', () => {
  const page={Payload:{Data:[{NPWP:'0000000000000001',Nilai:0}],TotalRecords:4}};
  assert.deepEqual(filePage('example.json',JSON.stringify(page)),page);
  assert.doesNotThrow(() => checkIdentity(rowsOf(page),'0000000000000001'));
  assert.throws(() => checkIdentity(rowsOf(page),'0000000000000002'));
  assert.deepEqual(rowsOf(filePage('sample.csv','x')),[]);
  assert.throws(() => filePage('sample.json','broken'));
});
