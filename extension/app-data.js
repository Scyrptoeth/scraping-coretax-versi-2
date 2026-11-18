export const forms = [
  ['VAT_VATR','Masa PPN'], ['VAT_VATTRNTEVATC','Masa PPN non-PKP / pemungut'],
  ['ICT_WITR','Masa PPh 21/26'], ['ICT_WTR','Masa PPh Unifikasi'],
  ['ICT_RCITR','Tahunan PPh Badan'], ['ICT_PITR','Tahunan PPh Orang Pribadi']
];
export const catalogue = [
  ['Profil',[['info','Informasi umum WP'],['pihak','Pihak terkait'],['bank','Rekening bank'],['flag','Penanda WP'],['jenispajak','Registrasi jenis pajak']]],
  ['Registrasi',[['alamat','Alamat dan tempat kegiatan usaha'],['klu','Klasifikasi lapangan usaha'],['nomorlain','Nomor identitas lain'],['sertel','Sertifikat elektronik'],['pbb','Objek tanah dan bangunan'],['login','Login terakhir']]],
  ['Dokumen',[['dokumen','Daftar dokumen WP']]],
  ['SPT',[['sptdaftar','Daftar SPT dilaporkan'],['sptarsip','Daftar SPT diarsipkan',false],['sptbelum','Daftar SPT belum dilaporkan'],['sptisi','Induk dan lampiran SPT']]],
  ['Buku besar',[['bb','Buku besar per masa'],['bbtotal','Total pembanding buku besar'],['bbsaldo','Saldo seluruh periode',false]]],
  ['Bukti potong',[['bplawan','Bukti potong dari lawan transaksi']]]
];
export const sources = Object.fromEntries(catalogue.flatMap(([,list]) => list.map(([key,label]) => [key,label])));

export function normalizeId(text) {
  const stripped = String(text).trim().replace(/[.\s-]/g,'');
  if (!/^\d{15,16}$/.test(stripped)) return null;
  return stripped.padStart(16,'0');
}
export function readIds(input) {
  const result = new Set();
  for (const token of input.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)) {
    const id = normalizeId(token);
    if (!id) throw new Error('Periksa daftar NPWP. Setiap nomor harus berisi 15 atau 16 digit.');
    result.add(id);
  }
  return [...result];
}
export function parseDelimited(input) {
  const text = input.replace(/^\uFEFF/,'');
  const first = text.split(/\r?\n/,1)[0];
  const delimiters = [',',';','\t'];
  const counts = delimiters.map(delimiter => {
    let quoted=false, count=0;
    for (let i=0;i<first.length;i++) {
      if (first[i] === '"') {
        if (quoted && first[i+1] === '"') i++;
        else quoted=!quoted;
      } else if (!quoted && first[i] === delimiter) count++;
    }
    return count;
  });
  const delimiter = delimiters[counts.indexOf(Math.max(...counts))];
  const rows = [];
  let field = '', cells = [], quoted = false;
  for (let i=0; i<text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i+1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && c === delimiter) { cells.push(field); field = ''; }
    else if (!quoted && (c === '\r' || c === '\n')) {
      if (c === '\r' && text[i+1] === '\n') i++;
      cells.push(field);
      if (cells.some(v => v.trim())) rows.push(cells);
      field = ''; cells = [];
    } else field += c;
  }
  if (quoted) throw new Error('Tanda kutip di dalam CSV belum berpasangan.');
  cells.push(field);
  if (cells.some(v => v.trim())) rows.push(cells);
  if (!rows.length) throw new Error('CSV kosong.');
  const [header,...data] = rows;
  if (header.some(v => !v.trim()) || new Set(header).size !== header.length) throw new Error('Kolom CSV harus memiliki nama yang unik.');
  return data.map((r,i) => {
    if (r.length !== header.length) throw new Error('Jumlah kolom berbeda pada baris CSV ' + (i+2) + '.');
    return Object.fromEntries(header.map((v,k) => [v,r[k]]));
  });
}
export function filePage(name,text) {
  if (/\.csv$/i.test(name)) return {Payload:{Data:parseDelimited(text)}};
  if (!/\.json$/i.test(name)) throw new Error('Gunakan berkas JSON atau CSV.');
  let value;
  try { value = JSON.parse(text.replace(/^\uFEFF/,'')); }
  catch { throw new Error('Berkas JSON tidak dapat dibaca.'); }
  if (value === null || typeof value !== 'object') throw new Error('Isi JSON harus berupa objek atau daftar.');
  if ('Payload' in value) return value;
  return {Payload:{Data:Array.isArray(value) ? value : [value]}};
}
export function rowsOf(page) {
  const payload = page?.Payload;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.Data)) return payload.Data;
  if (Array.isArray(payload?.Items)) return payload.Items;
  return payload && typeof payload === 'object' ? [payload] : [];
}
export function checkIdentity(rows,npwp) {
  const ownKeys = new Set(['npwp','npwpwp','npwpwajibpajak','taxpayeridentificationnumber','taxpayeridentificationno']);
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    for (const [label,value] of Object.entries(row)) {
      if (!ownKeys.has(label.toLowerCase().replace(/[^a-z]/g,'')) || value === '' || value == null) continue;
      const actual = normalizeId(value);
      if (actual !== npwp) throw new Error('NPWP pada sumber berbeda atau tidak lengkap. Pisahkan berkas atau pilih tabel untuk satu WP.');
    }
  }
}
export function reportSource(page) {
  const rows=rowsOf(page);
  const reported=[page.Payload?.TotalRecords,page.Payload?.TotalRecordCount,page.Payload?.TotalCount,page.TotalRecords]
    .find(n => (typeof n==='number' || (typeof n==='string' && /^\d+$/.test(n))) && Number.isSafeInteger(Number(n)) && Number(n)>=0);
  return {rows:rows.length,total:reported===undefined ? null : Number(reported)};
}
export function taxpayerName(entries) {
  const names=new Set();
  for (const entry of entries.filter(x => x.source === 'info')) for (const row of rowsOf(entry.page)) {
    if (row === null || typeof row !== 'object') continue;
    for (const [label,value] of Object.entries(row)) {
      if (['namawp','namawajibpajak','taxpayername'].includes(label.toLowerCase().replace(/[^a-z]/g,'')) && typeof value==='string' && value.trim()) names.add(value.trim());
    }
  }
  return names.size === 1 ? [...names][0] : '';
}
export function csvCell(value) {
  let raw = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(raw)) raw = "'" + raw;
  return '"' + raw.replaceAll('"','""') + '"';
}

// This function runs in the tab's isolated world and must remain self-contained.
export async function visibleTables(selected) {
  const visible = el => el.checkVisibility ? el.checkVisibility({visibilityProperty:true,opacityProperty:true}) && el.getClientRects().length > 0 : el.getClientRects().length > 0;
  const tables = [...document.querySelectorAll('table,[role=table],[role=grid]')].filter(visible);
  function shape(table) {
    const rowNodes = [...table.querySelectorAll('tr,[role=row]')].filter(r => visible(r) && r.closest('table,[role=table],[role=grid]') === table);
    const cells = r => [...r.querySelectorAll(':scope > th,:scope > td,:scope > [role=columnheader],:scope > [role=gridcell],:scope > [role=cell]')].filter(visible);
    const head = rowNodes.filter(r => r.closest('thead') || cells(r).every(c => c.matches('th,[role=columnheader]'))).at(-1);
    const data = rowNodes.filter(r => r !== head && !r.closest('thead,tfoot') && cells(r).length);
    const width = head ? cells(head).length : data.length ? cells(data[0]).length : 0;
    const used = new Set();
    const labels = Array.from({length:width},(_,i) => {
      const base = (head && cells(head)[i]?.innerText.trim()) || 'Kolom ' + (i+1);
      let name = base, n = 1;
      while (used.has(name)) name = base + ' (' + (++n) + ')';
      used.add(name); return name;
    });
    return {data,cells,labels};
  }
  function nextButton(table) {
    const host = table.closest('.p-datatable,[data-pc-name="datatable"],[role=region]');
    const controls = table.id ? [...document.querySelectorAll('button[aria-controls]')].filter(b => b.getAttribute('aria-controls')===table.id) : [];
    if (host && [...host.querySelectorAll('table,[role=table],[role=grid]')].filter(visible).length===1) {
      controls.push(...host.querySelectorAll('.p-paginator button,[data-pc-name="paginator"] button,nav[aria-label] button,[role=navigation][aria-label] button'));
    }
    const candidates=[...new Set(controls)].filter(b => {
      const namedNav=b.closest('nav[aria-label],[role=navigation][aria-label]');
      const ownsPager=b.matches('button[aria-controls]') && table.id && b.getAttribute('aria-controls')===table.id ||
        !!b.closest('.p-paginator,[data-pc-name="paginator"]') || /pagin|halaman/i.test(namedNav?.getAttribute('aria-label')||'');
      const name=(b.getAttribute('aria-label') || b.title || b.innerText).trim();
      return ownsPager && visible(b) && !b.disabled && b.getAttribute('aria-disabled')!=='true' &&
        (!b.form || b.type==='button') && /^(next( page)?|(halaman )?(berikut(nya)?|selanjutnya))$/i.test(name);
    });
    return candidates.length===1 ? candidates[0] : null;
  }
  function records(current) {
    return current.data.map(row => {
      const fields = current.cells(row);
      if (fields.length !== current.labels.length) throw new Error('Struktur baris tabel berbeda. Gunakan ekspor JSON/CSV dari halaman ini.');
      return Object.fromEntries(current.labels.map((label,i) => [label,fields[i].innerText.trim()]));
    });
  }
  function sameOwner(rows,wp) {
    if (!rows.length) return false;
    return rows.every(row => Object.entries(row).some(([label,value]) => {
      const key=label.toLowerCase().replace(/[^a-z]/g,'');
      const id=String(value).replace(/[.\s-]/g,'');
      return ['npwp','npwpwp','npwpwajibpajak','taxpayeridentificationnumber'].includes(key) && /^\d{15,16}$/.test(id) && id.padStart(16,'0')===wp;
    }));
  }
  if (selected == null) return tables.map((table,index) => {
    const {data,labels} = shape(table);
    return {index,rows:data.length,labels,tableId:table.id,canAdvance:!!nextButton(table),title:table.caption?.innerText?.trim() || table.getAttribute('aria-label') || 'Tabel ' + (index+1)};
  });
  if (!tables[selected.index]) throw new Error('Tabel berubah. Periksa ulang tab.');
  const currentTable=tables[selected.index], current=shape(currentTable);
  if (JSON.stringify(current.labels) !== JSON.stringify(selected.labels) || location.href !== selected.url || current.data.length !== selected.rows || currentTable.id!==selected.tableId) {
    throw new Error('Tampilan tab berubah. Pilih ulang tabel yang hendak diambil.');
  }
  const currentRows=records(current);
  if (!selected.advance) return currentRows;
  if (!sameOwner(currentRows,selected.owner)) throw new Error('Paginasi membutuhkan kolom NPWP pemilik yang cocok pada setiap baris. Lanjutkan per halaman.');
  if (JSON.stringify(currentRows)!==selected.expected) throw new Error('Isi tabel berubah sejak pengambilan. Pilih ulang tabel.');
  const next=nextButton(currentTable);
  if (!next) return {end:true};
  next.click();
  const deadline=Date.now()+5000;
  while(Date.now()<deadline) {
    await new Promise(resolve=>setTimeout(resolve,120));
    if (location.href!==selected.url) throw new Error('Alamat halaman berubah. Pilih ulang sumber sebelum melanjutkan.');
    const table=[...document.querySelectorAll('table,[role=table],[role=grid]')].filter(visible)[selected.index];
    if(!table || table.id!==selected.tableId) continue;
    const changed=shape(table);
    if(JSON.stringify(changed.labels)!==JSON.stringify(selected.labels)) continue;
    const rows=records(changed);
    if(!rows.length || JSON.stringify(rows)===selected.expected) continue;
    if(!sameOwner(rows,selected.owner)) throw new Error('NPWP tampilan berubah. Halaman berikut tidak ditambahkan.');
    return {rows,canAdvance:!!nextButton(table)};
  }
  throw new Error('Halaman berikut belum berubah atau mengulang data. Periksa halaman di Coretax.');
}
