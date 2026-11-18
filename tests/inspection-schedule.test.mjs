import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSchedule, validateSchedule} from '../extension/analisis/inspection-schedule.js';

const asOf = '2026-02-10';
const sample = {
  spp: '2026-01-30', request: '2026-02-02', sphp: '2026-02-13',
  sphpReceived: '2026-02-13', minutes: '2026-02-20', qaEligible: true,
};
const extension = {extensionMonths: 1, extensionBasis: 'grup', extensionNotice: '2026-02-05'};
function byId(input) {
  const {rows} = buildSchedule(input, asOf);
  assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
  return Object.fromEntries(rows.map(r => [r.id, r]));
}

test('an empty draft is valid, and validation supports JSON round trips without changing caller data', () => {
  const empty = validateSchedule();
  assert.deepEqual(empty, {type: 'lengkap', spp: '', request: '', sphp: '', sphpReceived: '',
    minutes: '', sealed: '', extensionNotice: '', extensionMonths: 0, extensionBasis: '', qaEligible: false, holidays: []});
  assert.deepEqual(buildSchedule({}, asOf).rows, []);
  const original = {...sample, holidays: ['2026-02-17', '2026-02-16', '2026-02-17']};
  const normalized = validateSchedule(original);
  assert.deepEqual(normalized.holidays, ['2026-02-16', '2026-02-17']);
  assert.equal(original.holidays.length, 3);
  assert.deepEqual(validateSchedule(JSON.parse(JSON.stringify(normalized))), normalized);
});

test('invalid dates, malformed holiday lists and out-of-range extensions fail explicitly', () => {
  for (const input of [null, [], true, {type: 'unknown'}, {type: null}, {spp: '2025-02-29'}, {spp: '2026-13-01'},
    {spp: '2026-02-01T00:00:00Z'}, {request: '01/02/2026'}, {sphp: null}, {sealed: '0000-12-07'},
    {holidays: '2026-01-01'}, {holidays: [null]}, {holidays: ['']}, {holidays: ['2025-02-30']},
    {extensionMonths: '1'}, {extensionMonths: 1.5}, {extensionMonths: -1}, {extensionMonths: 5},
    {extensionBasis: 'lain'}, {qaEligible: 'false'}]) assert.throws(() => validateSchedule(input));
  assert.throws(() => buildSchedule(sample, '2025-02-29'));
  assert.equal(validateSchedule({spp: '2028-02-29', extensionMonths: 4}).spp, '2028-02-29');
});

test('studio synthetic comparison for the three ordinary types with a supported extension and all event dates', () => {
  for (const [type, expectedTest, expectedPreliminary] of [
    ['lengkap', '2026-07-30', '2026-06-30'], ['terfokus', '2026-05-30', '2026-04-30'], ['spesifik', '2026-03-30', undefined],
  ]) {
    const rows = byId({...sample, ...extension, type});
    assert.equal(rows['test-deadline'].date, expectedTest);
    assert.match(rows['test-deadline'].note, /satu grup/);
    assert.equal(rows.preliminary?.date, expectedPreliminary);
    assert.equal(rows['warning-1'].date, '2026-02-16');
    assert.equal(rows['warning-2'].date, '2026-02-23');
    assert.equal(rows['documents-due'].date, '2026-03-02');
    assert.equal(rows['response-due'].date, '2026-02-20');
    assert.equal(rows['qa-due'].date, '2026-02-25');
    assert.equal(rows['report-due'].date, '2026-03-27');
    assert.match(rows['report-due'].note, /30 hari kerja/);
    assert.equal(rows.spp.daysRemaining, -11);
    assert.equal(rows['response-due'].daysRemaining, 10);
    assert.equal(rows['seal-review'], undefined);
  }
});

test('concrete-data examinations use ten business days in each phase and count calendar weeks for warnings', () => {
  const input = {...sample, type: 'konkret'};
  const base = byId(input);
  assert.equal(base['test-deadline'].date, '2026-02-13');
  assert.equal(base['report-due'].date, '2026-02-27');
  assert.match(base['report-due'].note, /10 hari kerja/);
  assert.equal(base.preliminary, undefined);
  const adjusted = byId({...input, holidays: ['2026-02-16', '2026-02-17', '2026-02-17', '2026-02-21']});
  assert.equal(adjusted['response-due'].date, '2026-02-24');
  assert.equal(adjusted['report-due'].date, '2026-03-03');
  assert.equal(adjusted['qa-due'].date, '2026-02-25');
  assert.equal(adjusted['warning-1'].date, '2026-02-16');
  const notes = buildSchedule(input, asOf).notes.join(' ');
  assert.match(notes, /kalender resmi/);
  assert.match(notes, /Pasal 7 ayat \(3\)/);
});

test('regime depends on the actual start date, including the effective day, not the tax year or later SPHP', () => {
  const old = buildSchedule({...sample, spp: '2025-02-13'}, asOf);
  assert.equal(old.rows.some(row => row.id === 'report-due'), false);
  assert.equal(old.rows.find(row => row.id === 'sphp').basis, 'Catatan petugas');
  assert.match(old.notes.join(' '), /Pasal 30/);
  assert.equal(byId({spp: '2025-02-14', type: 'spesifik'})['test-deadline'].date, '2025-03-14');
  const unknown = byId({sphp: sample.sphp, sphpReceived: sample.sphp, minutes: sample.minutes, qaEligible: true});
  assert.equal(unknown['qa-due'], undefined);
  assert.equal(unknown.sphp.date, sample.sphp);
});

test('calendar months clamp to the last available day, including leap February and year changes', () => {
  for (const [spp, expected] of [['2026-01-31', '2026-02-28'], ['2028-01-31', '2028-02-29'],
    ['2025-12-31', '2026-01-31'], ['2026-03-31', '2026-04-30']]) {
    const rows = byId({type: 'spesifik', spp, request: spp});
    assert.equal(rows['test-deadline'].date, expected);
    assert.equal(rows['documents-due'].date, expected);
  }
});

test('service and receipt have different consequences, and QA requires a signed record plus the statutory criteria', () => {
  const missing = byId({spp: sample.spp, sphp: sample.sphp, minutes: sample.minutes});
  assert.equal(missing['report-due'].date, '2026-03-27');
  assert.equal(missing['response-due'].date, null);
  assert.equal(missing['response-due'].daysRemaining, null);
  assert.equal(missing['qa-due'].date, null);
  assert.equal(byId({...sample, sphpReceived: '2026-02-16'})['response-due'].date, '2026-02-23');
  const onlyReceipt = byId({spp: sample.spp, sphpReceived: sample.sphp});
  assert.equal(onlyReceipt['response-due'].date, '2026-02-20');
  assert.equal(onlyReceipt['report-due'].date, null);
  assert.equal(byId({spp: sample.spp, qaEligible: true})['qa-due'].date, null);
});

test('missing or contradictory extension evidence preserves the ordinary baseline but yields no final extended deadline', () => {
  for (const extra of [{}, {extensionNotice: '2025-12-01', extensionBasis: 'grup'},
    {extensionBasis: 'transfer'}, {extensionNotice: '2027-02-01', extensionBasis: 'grup'},
    {extensionNotice: '2026-02-20', extensionBasis: 'grup'}]) {
    const rows = byId({...sample, extensionMonths: 2, ...extra});
    assert.equal(rows['test-standard'].date, '2026-06-30');
    assert.equal(rows['test-deadline'].date, null);
    assert.equal(rows.preliminary.date, null);
  }
  const concrete = byId({...sample, ...extension, type: 'konkret'});
  assert.equal(concrete['test-standard'].date, '2026-02-13');
  assert.equal(concrete['test-deadline'].date, null);
  const ordinary = byId({...sample, ...extension, extensionMonths: 0});
  assert.equal(ordinary['test-deadline'].date, '2026-06-30');
});

test('conflicting event order blocks dependent dates and preserves unrelated source dates', () => {
  const rows = byId({...sample, request: '2026-01-05', sphp: '2026-01-09', sealed: '2026-02-01'});
  assert.equal(rows.sphp.date, '2026-01-09');
  assert.equal(rows.sphp.status, 'Periksa tanggal');
  for (const id of ['warning-1', 'warning-2', 'documents-due', 'response-due', 'report-due', 'qa-due'])
    assert.equal(rows[id].date, null);
  assert.equal(rows['seal-review'].date, '2026-02-08');
  assert.equal(rows['seal-review'].status, 'Bersyarat');
  assert.match(rows['seal-review'].basis, /14 ayat \(13\)/);
  assert.equal(rows['test-deadline'].date, '2026-06-30');
  const sorted = buildSchedule({...sample, sphpReceived: ''}, asOf).rows;
  assert.deepEqual(sorted.map(r => r.date || '~'), sorted.map(r => r.date || '~').sort());
});
