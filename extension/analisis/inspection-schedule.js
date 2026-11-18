export const scheduleSource = 'https://jdih.kemenkeu.go.id/api/download/20fcc3b3-4425-4664-816c-e5dae731d52a/2025pmkeuangan015.pdf';

const effective = '2025-02-14';
const day = 86400000;
const monthsByType = new Map([['lengkap', 5], ['terfokus', 3], ['spesifik', 1], ['konkret', 0]]);
const dateLabels = {
  spp: 'Penyampaian SPP', request: 'Penyampaian surat permintaan dokumen',
  sphp: 'Penyampaian SPHP', sphpReceived: 'Penerimaan SPHP oleh WP',
  minutes: 'Penandatanganan risalah pembahasan', sealed: 'Penyegelan',
  extensionNotice: 'Penyampaian pemberitahuan perpanjangan',
};

const utcDate = value => new Date(value + 'T00:00:00Z');
function checkDate(value, label) {
  const date = typeof value === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) && utcDate(value);
  if (!date || !Number.isFinite(date.getTime()) || !date.toISOString().startsWith(value + 'T'))
    throw Error(label + ' harus berupa tanggal kalender yang sah dengan format YYYY-MM-DD.');
  return value;
}

export function validateSchedule(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Data jadwal harus berupa objek.');
  const result = {type: input.type === undefined ? 'lengkap' : input.type};
  if (!monthsByType.has(result.type)) throw Error('Pilih jenis pemeriksaan yang tersedia.');
  for (const [field, label] of Object.entries(dateLabels)) {
    const value = input[field] === undefined ? '' : input[field];
    result[field] = value === '' ? '' : checkDate(value, label);
  }
  result.extensionMonths = input.extensionMonths === undefined ? 0 : input.extensionMonths;
  if (!Number.isInteger(result.extensionMonths) || result.extensionMonths < 0 || result.extensionMonths > 4)
    throw Error('Perpanjangan harus berupa bilangan bulat dari 0 sampai 4 bulan.');
  result.extensionBasis = input.extensionBasis === undefined ? '' : input.extensionBasis;
  if (!['', 'grup', 'transfer'].includes(result.extensionBasis)) throw Error('Periksa pilihan dasar perpanjangan.');
  result.qaEligible = input.qaEligible === undefined ? false : input.qaEligible;
  if (typeof result.qaEligible !== 'boolean') throw Error('Periksa konfirmasi syarat permohonan QA.');
  const holidays = input.holidays === undefined ? [] : input.holidays;
  if (!Array.isArray(holidays)) throw Error('Hari libur harus berupa daftar tanggal.');
  result.holidays = [...new Set(Array.from(holidays, value => checkDate(value, 'Hari libur')))].sort();
  return result;
}

function today() {
  const now = new Date();
  return [String(now.getFullYear()).padStart(4, '0'), ...[now.getMonth() + 1, now.getDate()].map(n => String(n).padStart(2, '0'))].join('-');
}

function iso(date) {
  if (date.getUTCFullYear() > 9999) throw Error('Hasil perhitungan melewati tahun 9999.');
  return date.toISOString().slice(0, 10);
}

function addMonths(value, months) {
  const date = utcDate(value);
  const originalDay = date.getUTCDate();
  date.setUTCMonth(date.getUTCMonth() + months + 1, 0);
  date.setUTCDate(Math.min(originalDay, date.getUTCDate()));
  return iso(date);
}

function addDays(value, count, holidays) {
  const date = utcDate(value);
  while (count > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (!holidays || (weekday !== 0 && weekday !== 6 && !holidays.has(iso(date)))) count--;
  }
  return iso(date);
}

const scopeNote = 'Jadwal umum untuk pemeriksaan kepatuhan. Periksa batas penyelesaian permohonan WP, ketentuan khusus PPh migas dengan pengembalian biaya operasi, dan penangguhan bila kasus mengalaminya (Pasal 6 dan 23).';

export function buildSchedule(input = {}, asOf = today()) {
  const data = validateSchedule(input);
  checkDate(asOf, 'Tanggal acuan');
  const notes = [scopeNote], rows = [];
  const holidays = new Set(data.holidays);
  const workdays = (date, count) => addDays(date, count, holidays);
  function row(id, label, date, basis, status, note = '') {
    rows.push({id, label, date, basis, status, note, daysRemaining: date ? (utcDate(date) - utcDate(asOf)) / day : null});
  }
  function finish() {
    rows.sort((a, b) => (a.daysRemaining ?? Number.MAX_SAFE_INTEGER) - (b.daysRemaining ?? Number.MAX_SAFE_INTEGER));
    return {rows, notes};
  }
  // Actual events stay on the record even if inconsistent dates prevent calculating the next step.
  const events = {};
  function event(field, basis, previous = []) {
    const value = data[field];
    if (!value) return;
    const conflict = previous.find(key => data[key] && (!events[key] || value < data[key]));
    const note = conflict ? 'Periksa urutan tanggal dengan kejadian ' + dateLabels[conflict].toLowerCase() + '.' : '';
    events[field] = conflict ? null : value;
    row(field, dateLabels[field], value, data.spp >= effective ? basis : 'Catatan petugas', conflict ? 'Periksa tanggal' : 'Tanggal masukan', note);
  }
  event('spp', 'Pasal 10 ayat (6)');
  event('request', 'Pasal 12 ayat (1)', ['spp']);
  event('sphp', 'Pasal 18 ayat (1)', ['spp']);
  event('sphpReceived', 'Pasal 18 ayat (2)', ['spp', 'sphp']);
  event('minutes', 'Pasal 18 ayat (7)', ['spp', 'sphp', 'sphpReceived']);
  event('sealed', 'Pasal 14', ['spp']);
  event('extensionNotice', 'Pasal 6 ayat (7)', ['spp']);

  if (!data.spp || data.spp < effective) {
    notes.push(data.spp
      ? 'Pemeriksaan dimulai sebelum 14 Februari 2025. Penyelesaiannya mengikuti ketentuan peralihan Pasal 30. Cocokkan aturan sebelumnya untuk PBB atau jenis pajak lain.'
      : 'Isi tanggal penyampaian SPP untuk menetapkan kapan pemeriksaan dimulai dan memeriksa aturan yang berlaku.');
    return finish();
  }

  const pending = 'Belum dapat dihitung';
  const limit = 'Batas waktu';
  const workdayLimit = 'Perkiraan hari kerja';
  const concrete = data.type === 'konkret';
  const base = concrete ? workdays(data.spp, 10) : addMonths(data.spp, monthsByType.get(data.type));
  const testBasis = concrete ? 'Pasal 6 ayat (4) huruf a' : 'Pasal 6 ayat (2)';
  const duration = concrete ? '10 hari kerja' : monthsByType.get(data.type) + ' bulan';
  let deadline = base, extensionIssue = '';
  if (data.extensionMonths > 0) {
    if (concrete) extensionIssue = 'Jenis data konkret memakai batas khusus 10 hari kerja. Periksa dasar penerapan perpanjangan untuk kasus ini.';
    else if (!data.extensionBasis || !events.extensionNotice)
      extensionIssue = 'Lengkapi alasan perpanjangan dan tanggal pemberitahuan perpanjangan yang disampaikan kepada WP.';
    else if (events.extensionNotice > base || (data.sphp && events.extensionNotice > data.sphp))
      extensionIssue = 'Cocokkan pemberitahuan perpanjangan dengan akhir jangka biasa dan tanggal penyampaian SPHP.';
    if (extensionIssue) {
      deadline = null;
      row('test-standard', 'Batas pengujian menurut jangka biasa', base, testBasis, 'Jangka biasa', duration + ' sejak penyampaian SPP.');
    } else deadline = addMonths(data.spp, monthsByType.get(data.type) + data.extensionMonths);
  } else if (data.extensionBasis || data.extensionNotice) {
    notes.push('Isian perpanjangan tersedia, tetapi jumlah bulan masih nol. Jadwal memakai jangka biasa.');
  }
  const extendedBasis = data.extensionMonths ? testBasis + ', ayat (5)–(7)' : testBasis;
  const reason = data.extensionBasis === 'grup' ? 'WP dalam satu grup' : 'indikasi transfer pricing atau transaksi khusus yang terindikasi rekayasa transaksi keuangan';
  const testNote = extensionIssue || (data.extensionMonths
    ? duration + ' sejak penyampaian SPP ditambah ' + data.extensionMonths + ' bulan. Dasar pemberitahuan yang dicatat petugas adalah ' + reason + '.'
    : duration + ' sejak penyampaian SPP.');
  const testStatus = concrete ? workdayLimit : limit;
  row('test-deadline', 'Batas pengujian dan penyampaian SPHP', deadline, extendedBasis, deadline ? testStatus : pending, testNote);
  if (events.sphp && deadline && events.sphp > deadline)
    notes.push('Tanggal penyampaian SPHP sesudah batas pengujian yang dihitung. Periksa riwayat dan ketentuan yang berlaku pada kasus ini.');
  if (['lengkap', 'terfokus'].includes(data.type))
    row('preliminary', 'Batas pembahasan temuan sementara', deadline ? addMonths(deadline, -1) : null,
      'Pasal 17 ayat (3)', deadline ? limit : pending, deadline ? 'Satu bulan sebelum jangka waktu pengujian berakhir.' : extensionIssue);
  else notes.push('Pemeriksaan spesifik dikecualikan dari kewajiban pembahasan temuan sementara menurut Pasal 7 ayat (3).');

  if (data.request) {
    const request = events.request;
    for (const [id, weeks, label] of [['warning-1', 2, 'Peringatan pertama'], ['warning-2', 3, 'Peringatan kedua']]) {
      row(id, label, request ? addDays(request, weeks * 7) : null, 'Pasal 12 ayat (5)', request ? 'Bersyarat' : pending,
        request ? 'Setelah ' + weeks + ' minggu. Pemeriksa dapat mengirim peringatan bila dokumen belum lengkap dan batas satu bulan masih berjalan.' : 'Periksa tanggal penyampaian surat permintaan.');
    }
    row('documents-due', 'Batas pemenuhan permintaan dokumen', request ? addMonths(request, 1) : null, 'Pasal 12 ayat (2)',
      request ? limit : pending, 'Satu bulan sejak surat permintaan disampaikan. Dokumen yang masih ada pada pihak ketiga mengikuti syarat Pasal 12 ayat (11).');
  }
  if (data.sealed)
    row('seal-review', 'Periksa akses dan bantuan WP setelah penyegelan', events.sealed ? addDays(events.sealed, 7) : null,
      'Pasal 14 ayat (13)', events.sealed ? 'Bersyarat' : pending, 'Periksa apakah setelah tujuh hari WP tetap menolak memberi akses atau bantuan.');
  if (data.sphp || data.sphpReceived) {
    const received = events.sphpReceived;
    row('response-due', 'Batas tanggapan tertulis atas SPHP', received ? workdays(received, 5) : null,
      'Pasal 18 ayat (2)', received ? workdayLimit : pending,
      received ? 'Lima hari kerja sejak SPHP diterima WP.' : 'Isi atau periksa tanggal SPHP diterima WP.');
    const sent = events.sphp, count = concrete ? 10 : 30;
    row('report-due', 'Batas pembahasan akhir dan LHP', sent ? workdays(sent, count) : null,
      concrete ? 'Pasal 6 ayat (4) huruf b' : 'Pasal 6 ayat (3)', sent ? workdayLimit : pending,
      sent ? count + ' hari kerja sejak SPHP disampaikan.' : 'Isi atau periksa tanggal penyampaian SPHP.');
  }
  if (data.minutes || data.qaEligible) {
    const qualified = events.minutes && data.qaEligible;
    row('qa-due', 'Batas permohonan pembahasan dengan Tim QA', qualified ? workdays(events.minutes, 3) : null,
      'Pasal 19 ayat (1) dan (3)', qualified ? workdayLimit : pending, qualified
        ? 'Tiga hari kerja sejak penandatanganan risalah pembahasan.'
        : 'Periksa tanggal penandatanganan risalah dan semua syarat permohonan pada Pasal 19 ayat (1).');
  }
  if (concrete || data.sphp || data.sphpReceived || data.minutes)
    notes.push('Perhitungan hari kerja dimulai pada hari berikutnya, dengan melewati Sabtu, Minggu, dan tanggal libur yang dimasukkan petugas. Cocokkan daftar itu dengan kalender resmi selama seluruh periode penghitungan.');
  return finish();
}
