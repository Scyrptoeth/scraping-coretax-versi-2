import {kbli} from './catalog-data.js';
import {groupLinks} from './kbli-correspondence-data.js';

export const kbliCorrespondenceSource = 'https://www.bps.go.id/id/publication/2026/04/22/909d503355d2b7664e43dea8/tabel-konversi-kbli-2020---kbli-2025.html';

let byEdition;

function correspondenceIndex() {
  if (byEdition) return byEdition;
  byEdition = {'2020': new Map(), '2025': new Map()};
  for (const row of groupLinks.split('\n')) {
    const [oldCode, newCode, forwardPage, reversePage] = row.split(' ');
    for (const [edition, source, target, page] of [
      ['2020', oldCode, newCode, forwardPage], ['2025', newCode, oldCode, reversePage],
    ]) {
      const map = byEdition[edition];
      if (!map.has(source)) map.set(source, []);
      map.get(source).push({code: target, page: Number(page)});
    }
  }
  return byEdition;
}

export function lookupKbliCorrespondence(edition, groupCode) {
  const fromEdition = String(edition);
  const toEdition = fromEdition === '2020' ? '2025' : fromEdition === '2025' ? '2020' : null;
  const code = typeof groupCode === 'string' ? groupCode.trim() : '';
  const known = Boolean(toEdition && /^[0-9]{5}$/.test(code) && Object.hasOwn(kbli[fromEdition], code));
  const matches = known ? (correspondenceIndex()[fromEdition].get(code) || []).map(({code: target, page}) => ({
    code: target, title: kbli[toEdition][target], page,
  })) : [];
  const appendix = toEdition ? (fromEdition === '2020' ? 5 : 10) : null;
  return {known, fromEdition, toEdition, code, matches, appendix, sourceUrl: kbliCorrespondenceSource};
}
