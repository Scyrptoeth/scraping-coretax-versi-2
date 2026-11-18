import assert from 'node:assert/strict';
import test from 'node:test';
import {kbli} from '../extension/catalog-data.js';
import {lookupKbliCorrespondence} from '../extension/kbli-correspondence.js';

test('BPS annexes preserve leading zeroes, one-to-many links and printed source pages', () => {
  const forward = lookupKbliCorrespondence(2020, '01727');
  assert.equal(forward.known, true);
  assert.equal(forward.toEdition, '2025');
  assert.equal(forward.appendix, 5);
  assert.equal(new URL(forward.sourceUrl).hostname, 'www.bps.go.id');
  assert.deepEqual(forward.matches.map(({code, page}) => [code, page]), [
    ['03214', 121], ['03224', 121], ['03234', 121],
  ]);
  const same = lookupKbliCorrespondence('2025', '01111');
  assert.equal(same.appendix, 10);
  assert.deepEqual(same.matches, [{code: '01111', title: 'PERTANIAN JAGUNG', page: 311}]);
  assert.equal(lookupKbliCorrespondence('2020', '99000').matches[0].page, 231);
  assert.equal(lookupKbliCorrespondence('2025', '99000').matches[0].page, 428);
});

test('identical codes across editions can have different meanings', () => {
  assert.deepEqual(lookupKbliCorrespondence(2020, '01283').matches.map(m => m.code), ['01138']);
  assert.deepEqual(lookupKbliCorrespondence(2025, '01283').matches.map(m => m.code), ['01289']);
  for (const [year, code] of [[2015, '01111'], [2020, '0111'], [2025, 1111], [2025, '00000'], [2025, 'constructor']]) {
    const result = lookupKbliCorrespondence(year, code);
    assert.equal(result.known, false);
    assert.deepEqual(result.matches, []);
  }
});

test('every published group is covered, and all 2,560 links agree in both directions', () => {
  const links = [];
  for (const [year, total, multiple, firstPage, lastPage] of [
    ['2020', 1789, 328, 117, 231], ['2025', 1559, 458, 311, 428],
  ]) {
    const groups = Object.keys(kbli[year]).filter(key => key.length === 5);
    assert.equal(groups.length, total);
    let multi = 0;
    const pairs = [];
    for (const code of groups) {
      const result = lookupKbliCorrespondence(year, code);
      assert.ok(result.known && result.matches.length);
      if (result.matches.length > 1) multi++;
      for (const match of result.matches) {
        assert.equal(match.title, kbli[result.toEdition][match.code]);
        assert.ok(match.title && match.page >= firstPage && match.page <= lastPage);
        pairs.push(year === '2020' ? `${code}/${match.code}` : `${match.code}/${code}`);
      }
    }
    assert.equal(multi, multiple);
    assert.equal(pairs.length, 2560);
    assert.equal(new Set(pairs).size, pairs.length);
    links.push(pairs.sort());
  }
  assert.deepEqual(links[0], links[1]);
});
