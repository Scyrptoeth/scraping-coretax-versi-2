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
  ['Bukti potong',[['bplawan','Bukti potong dari lawan transaksi']]],
  ['Tabel lain',[['tabelumum','Tabel lain yang terlihat']]]
];
export const sources = Object.fromEntries(catalogue.flatMap(([,list]) => list.map(([key,label]) => [key,label])));

export function normalizeId(text) {
  const stripped = String(text).trim().replace(/[.\s-]/g,'');
  if (!/^\d{15,16}$/.test(stripped)) return null;
  return stripped.padStart(16,'0');
}
export function readCaptureId(input) {
  let owner = '';
  for (const token of input.split(/[\r\n,;\t]+/).map(s => s.trim()).filter(Boolean)) {
    const id = normalizeId(token);
    if (!id) throw new Error('Masukkan NPWP yang terdiri dari 15 atau 16 digit.');
    if (owner && owner !== id) throw new Error('Satu tarikan hanya untuk satu NPWP. Masukkan satu NPWP sesuai penugasan.');
    owner = id;
  }
  return owner;
}
export function delimitedRows(input, headerLine, keepEmpty=false) {
  const text = input.replace(/^\uFEFF/,'');
  const first = headerLine ?? text.split(/\r?\n/,1)[0];
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
      if (keepEmpty||cells.some(v => v.trim())) rows.push(cells);
      field = ''; cells = [];
    } else field += c;
  }
  if (quoted) throw new Error('Tanda kutip di dalam CSV belum berpasangan.');
  cells.push(field);
  if (cells.some(v => v.trim())) rows.push(cells);
  if (!rows.length) throw new Error('CSV kosong.');
  return rows;
}
export function parseDelimited(input) {
  const rows = delimitedRows(input);
  const [declaredHeader,...data] = rows;
  const caseExportFields=['CaseNumber','MainTaxpayerTIN','MainTaxpayerName','CaseTypeName','CaseStatus','CaseSource',
    'CreatedDate','CreatedByUser','IsSuspended','WorkflowStep','TopDueDate','EndDate','TaxRegion','TaxOffice'];
  const hasCasePresentationHeader=declaredHeader.length===caseExportFields.length+2 &&
    declaredHeader[0]==='[object Object]' && declaredHeader[1]==='' &&
    caseExportFields.every((field,index)=>declaredHeader[index+2]===field) &&
    data.length>0 && data.every(row=>row.length===caseExportFields.length);
  const header=hasCasePresentationHeader ? declaredHeader.slice(2) : declaredHeader;
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
  const ownKeys = new Set(['npwp','npwpwp','npwpwajibpajak','npwpwajibpajakpusat','npwppemilik','maintaxpayertin','taxpayeridentificationnumber','taxpayeridentificationno']);
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

// Chrome may reorder dictionary keys when transferring executeScript results.
export function rowsInColumnOrder(rows,columns) {
  return rows.map(row=>Object.fromEntries(columns.map(column=>[column,row[column]])));
}

// This function runs in the tab's isolated world and must remain self-contained.
export async function visibleTables(selected) {
  const visible = el => el.checkVisibility ? el.checkVisibility({visibilityProperty:true,opacityProperty:true}) && el.getClientRects().length > 0 : el.getClientRects().length > 0;
  const listTables=()=>[...document.querySelectorAll('table,[role=table],[role=grid]')].filter(visible);
  const tables=listTables();
  const ownerKeys=['npwp','npwpwp','npwpwajibpajak','npwpwajibpajakpusat','npwppemilik','maintaxpayertin','taxpayeridentificationnumber','taxpayeridentificationno'];
  const tableTitle = (table,index) => table.caption?.innerText?.trim() || table.getAttribute('aria-label') ||
    (table.getAttribute('aria-labelledby') || '').split(/\s+/).map(id=>document.getElementById(id)).filter(el=>el && visible(el)).map(el=>el.innerText.trim()).join(' ') || 'Tabel '+(index+1);
  function shape(table) {
    const rowNodes = [...table.querySelectorAll('tr,[role=row]')].filter(r => visible(r) && r.closest('table,[role=table],[role=grid]') === table);
    const cells = r => [...r.querySelectorAll(':scope > th,:scope > td,:scope > [role=columnheader],:scope > [role=gridcell],:scope > [role=cell]')].filter(visible);
    const headerRows=rowNodes.filter(r=>r.closest('thead') || (cells(r).length && cells(r).every(c=>c.matches('th,[role=columnheader]'))));
    const controls='input,textarea,select,[role=combobox],[role=searchbox],[role=textbox],p-columnfilter,[data-pc-name="columnfilter"],button[aria-haspopup],button[aria-label*="filter" i]';
    function heading(cell) {
      if(!cell.querySelector(controls)) return cell.innerText.trim();
      const walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT);
      const parts=[];
      while(walker.nextNode()){
        const node=walker.currentNode;
        if(!node.parentElement.closest(controls) && visible(node.parentElement) && node.textContent.trim()) parts.push(node.textContent.trim());
      }
      return parts.join(' ');
    }
    const grid=[];
    let semanticRow=-1;
    for(const [i,row] of headerRows.entries()){
      grid[i] ||= [];
      let position=0;
      for(const cell of cells(row)){
        while(grid[i][position]) position++;
        const title=heading(cell);
        if(title) semanticRow=i;
        const columns=Math.min(1000,Math.max(1,Number(cell.getAttribute('aria-colspan') || cell.colSpan)||1));
        const rows=Math.min(headerRows.length-i,Math.max(1,Number(cell.getAttribute('aria-rowspan') || cell.rowSpan)||1));
        for(let y=i;y<i+rows;y++){
          grid[y] ||= [];
          for(let x=position;x<position+columns;x++) grid[y][x]={title};
        }
        position+=columns;
      }
    }
    const widthFromHeader=grid.reduce((max,row)=>Math.max(max,row.length),0);
    // Coretax may add a second header row consisting entirely of filter controls.
    const titles=grid[semanticRow] || [];
    const emptyMessage = /^(?:tidak ada data(?: yang ditemukan| yang tersedia)?|data tidak ditemukan|no (?:data|records)(?: (?:available|found))?)[.!]?$/i;
    const data = rowNodes.filter(row => {
      const fields = cells(row);
      if (headerRows.includes(row) || row.closest('thead,tfoot') || !fields.length) return false;
      const spansTable = fields.length === 1 && widthFromHeader > 1 &&
        Number(fields[0].getAttribute('colspan') || fields[0].getAttribute('aria-colspan')) >= widthFromHeader;
      const designatedEmpty = row.matches('.p-datatable-emptymessage,[data-pc-section="emptymessage"]');
      return !((spansTable || designatedEmpty) && fields.length === 1 && emptyMessage.test(fields[0].innerText.trim()));
    });
    const width = widthFromHeader || (data.length ? cells(data[0]).length : 0);
    const used = new Set();
    const labels = Array.from({length:width},(_,i) => {
      const base = titles[i]?.title || 'Kolom ' + (i+1);
      let name = base, n = 1;
      while (used.has(name)) name = base + ' (' + (++n) + ')';
      used.add(name); return name;
    });
    return {data,cells,labels};
  }
  function nextButton(table,first=false,includeDisabled=false) {
    const host = table.closest('.p-datatable,[data-pc-name="datatable"],p-table,[role=region]');
    const controls = table.id ? [...document.querySelectorAll('button[aria-controls]')].filter(b => b.getAttribute('aria-controls')===table.id) : [];
    if (host && [...host.querySelectorAll('table,[role=table],[role=grid]')].filter(visible).length===1) {
      controls.push(...host.querySelectorAll('.p-paginator button,p-paginator button,[data-pc-name="paginator"] button,nav[aria-label] button,[role=navigation][aria-label] button'));
    }
    const candidates=[...new Set(controls)].filter(b => {
      const namedNav=b.closest('nav[aria-label],[role=navigation][aria-label]');
      const ownsPager=b.matches('button[aria-controls]') && table.id && b.getAttribute('aria-controls')===table.id ||
        !!b.closest('.p-paginator,p-paginator,[data-pc-name="paginator"]') || /pagin|halaman/i.test(namedNav?.getAttribute('aria-label')||'');
      const names=[b.getAttribute('aria-label'),b.title,b.innerText,
        ...(b.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.innerText || '')]
        .map(s=>(s || '').trim()).filter(Boolean);
      const iconSelector=first?'.p-paginator-first,[data-pc-section="firstpagebutton"],[data-pc-section="first"]':
        '.p-paginator-next,[data-pc-section="nextpagebutton"],[data-pc-section="next"]';
      const icon=b.closest('.p-paginator,p-paginator,[data-pc-name="paginator"]') && b.matches(iconSelector);
      const label=first?/^(?:first(?: page)?|halaman pertama)$/i:/^(?:next(?: page)?|(?:halaman )?(?:berikut(?:nya)?|selanjutnya))$/i;
      const arrow=first?/^[«⏮]$/:/^[›→]$/;
      const destructive=[b,...b.querySelectorAll('[class],[aria-label],[title]')].some(el=>
        /\b(?:hapus|delete|trash|kirim|send|simpan|save|edit|pencil|submit)\b/i.test(
          [el.getAttribute('class'),el.getAttribute('title'),el.getAttribute('aria-label')].join(' ')));
      return ownsPager && visible(b) && (includeDisabled || !b.matches(':disabled,.p-disabled,[aria-disabled="true"],[data-p-disabled="true"]')) &&
        (!b.hasAttribute('aria-controls') || b.getAttribute('aria-controls')===table.id) &&
        !destructive && !b.hasAttribute('formaction') && (!b.form || b.type==='button') && !b.matches('[type=submit],[type=reset]') &&
        (icon || names.some(n=>label.test(n))) && names.every(n=>label.test(n) || arrow.test(n));
    });
    return candidates.length===1 ? candidates[0] : null;
  }
  function cellValue(cell,label) {
    const text=cell.innerText.trim();
    if(text || /^(?:Kolom \d+(?: \(\d+\))?|aksi|tindakan|actions?|pilih|select(?:ion)?)$/i.test(label)) return text;
    const checks=[...cell.querySelectorAll('input[type="checkbox"],[role="checkbox"]')].filter(visible);
    if(checks.length!==1) return '';
    const box=checks[0], state=box.getAttribute('aria-checked');
    if(box.matches('input[type="checkbox"]')) {
      if(box.indeterminate || (state!==null && state!==String(box.checked))) return '';
      return String(box.checked);
    }
    return state==='true' || state==='false'?state:'';
  }
  function records(current) {
    return current.data.map(row => {
      const fields = current.cells(row);
      if (fields.length !== current.labels.length) throw new Error('Struktur baris tabel berbeda. Gunakan ekspor JSON/CSV dari halaman ini.');
      return Object.fromEntries(current.labels.map((label,i) => [label,cellValue(fields[i],label)]));
    });
  }
  function sameOwner(rows,wp) {
    if (!rows.length) return false;
    return rows.every(row => Object.entries(row).some(([label,value]) => {
      const key=label.toLowerCase().replace(/[^a-z]/g,'');
      const id=String(value).replace(/[.\s-]/g,'');
      return ownerKeys.includes(key) && /^\d{15,16}$/.test(id) && id.padStart(16,'0')===wp;
    }));
  }
  const submitted=location.origin==='https://coretax.intranet.pajak.go.id' &&
    /^\/returnsheets\/id-ID\/submitted-returnsheets\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\/?$/i.test(location.pathname);
  const indexColumns=['jenis pajak','jenis surat pemberitahuan pajak','masa pajak','model spt','status spt'];
  const isIndex=labels=>submitted && indexColumns.every(k=>labels.some(s=>s.toLowerCase()===k));
  function indexPosition(table,count){
    const host=table.closest('.p-datatable,[data-pc-name="datatable"],p-table,[role=region]');
    const local=host && [...host.querySelectorAll('table,[role=table],[role=grid]')].filter(visible).length===1?host:table;
    const labels=[...local.querySelectorAll('.p-paginator-current,[role=status],[aria-live]')].filter(visible);
    const number='(\\d{1,3}(?:[.,]\\d{3})+|\\d+)';
    const caption=new RegExp('^(?:(?:menampilkan|showing)\\s+)?'+number+'\\s*(?:-|–|s\\.d\\.|sampai|to)\\s*'+number+'\\s*(?:dari|of)\\s*'+number+'(?:\\s+(?:baris|data|entri|entries|records))?\\.?$','i');
    const ranges=labels.map(el=>caption.exec(el.innerText.trim())).filter(Boolean);
    const parse=s=>/^\d+$|^\d{1,3}(?:[.,]\d{3})+$/.test(s)?Number(s.replace(/[.,]/g,'')):NaN;
    const [first,last,total]=ranges[0]?.slice(1).map(parse)||[];
    const range=ranges.length && ranges.every(r=>r.slice(1).map(parse).join('/')===[first,last,total].join('/')) && Number.isSafeInteger(total) &&
      (count===0?first===0 && last===0 && total===0:first>=1 && last-first+1===count && last<=total)?{first,last,total}:null;
    const firstControl=nextButton(table,true,true),nextControl=nextButton(table,false,true);
    const disabled=b=>Boolean(b && b.matches(':disabled,.p-disabled,[aria-disabled="true"],[data-p-disabled="true"]'));
    const activeColumns=[...local.querySelectorAll('.p-column-filter-menu-button-active,.p-datatable-column-filter-button-active,.p-column-filter-active')].map(el=>el.closest('td,th')?.cellIndex??-1);
    const fields=[...local.querySelectorAll('thead input,thead select,input[type=search],[role=search] input,input[placeholder*="cari" i],input[aria-label*="filter" i],input[aria-label*="cari" i]')];
    const filterInputs=fields.map(el=>el.type==='checkbox'||el.type==='radio'?el.checked:el.value?.trim());
    const filtered=activeColumns.length>0 || filterInputs.some(Boolean);
    const conflict=Boolean(ranges.length && !range || range && (firstControl && disabled(firstControl)!==(first<=1) || nextControl && disabled(nextControl)!==(last===total)));
    return {range,atStart:!conflict && (range?first<=1:disabled(firstControl)),atEnd:!conflict && (range?last===total:disabled(nextControl)),
      filtered,filterState:JSON.stringify([activeColumns,filterInputs]),conflict};
  }
  function panelOwner() {
    const links=[...document.querySelectorAll('a[href]')].filter(a=>visible(a) && a.origin===location.origin);
    const pick=links.filter(a=>a.pathname==='/returnsheets/id-ID/taxpayer-search' && a.innerText.trim()==='Pilih Wajib Pajak Lain');
    const current=links.filter(a=>a.pathname===location.pathname && a.innerText.trim()==='SPT Dilaporkan');
    if(pick.length!==1 || current.length!==1)return '';
    const routeId=location.pathname.split('/').filter(Boolean).at(-1);
    for(let panel=pick[0].parentElement;panel && panel!==document.body;panel=panel.parentElement){
      if(panel.querySelector('table,[role=table],[role=grid]'))break;
      if(!panel.contains(current[0]))continue;
      const details=links.filter(a=>panel.contains(a) && /^\/(?:registration\/id-ID\/general-information|accounting\/id-ID\/balancesheet|returnsheets\/id-ID\/(?:archieved|waiting-for-payment|rejected|canceled)-returnsheets)\//i.test(a.pathname));
      if(!details.length)continue;
      if(details.some(a=>a.pathname.split('/').filter(Boolean).at(-1)!==routeId))return '';
      const ids=new Set(),walker=document.createTreeWalker(panel,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()){
        const node=walker.currentNode,el=node.parentElement;
        if(!visible(el) || el.closest('a,button,input,textarea,select,ul,ol') ||
            !(node.compareDocumentPosition(current[0]) & Node.DOCUMENT_POSITION_FOLLOWING))continue;
        const text=node.textContent.trim(),raw=text.replace(/^NPWP\s*:?\s*/i,'').replace(/[.\s-]/g,'');
        if(!/^\d{15,16}$/.test(raw))continue;
        for(let card=el;card && card!==panel && !card.querySelector('a,button,table');card=card.parentElement){
          const caption=card.innerText.trim();
          if(/^NPWP\s*:?\s*\d/i.test(text) || (caption.startsWith(text) && /\p{L}/u.test(caption.slice(text.length)))){
            ids.add(raw.padStart(16,'0'));break;
          }
        }
      }
      if(ids.size)return ids.size===1 ? [...ids][0] : '';
    }
    return '';
  }
  if(selected?.discoverSubmitted){
    if(!submitted || location.href!==selected.url || panelOwner()!==selected.wp)return {match:false};
    const indexes=tables.map((table,index)=>({table,index,shape:shape(table)})).filter(t=>isIndex(t.shape.labels));
    return {match:indexes.length===1,ambiguous:indexes.length>1};
  }
  if (selected == null) return tables.map((table,index) => {
    const {data,labels} = shape(table);
    return {index,rows:data.length,labels,tableId:table.id,canAdvance:!!nextButton(table),title:tableTitle(table,index),
      ...(isIndex(labels)?{indexSource:'sptdaftar'}:{})};
  });
  if (!tables[selected.index]) throw new Error('Tabel berubah. Periksa ulang tab.');
  const currentTable=tables[selected.index], current=shape(currentTable);
  if (JSON.stringify(current.labels) !== JSON.stringify(selected.labels) || location.href !== selected.url || current.data.length !== selected.rows || currentTable.id!==selected.tableId || tableTitle(currentTable,selected.index)!==selected.title) {
    throw new Error('Tampilan tab berubah. Pilih ulang tabel yang hendak diambil.');
  }
  const currentRows=records(current);
  function checkScope(rows,labels,table=currentTable) {
    const key = value => value.toLowerCase().replace(/[^a-z]/g,'');
    const ownerColumns = labels.filter(label=>ownerKeys.includes(key(label)));
    const periodColumns = labels.filter(label=>['masapajak','periodepajak','taxperiod','taxperiodcode','tahunpajak','taxyear'].includes(key(label)) ||
      ['bb','bbtotal'].includes(selected.scope.source) && key(label)==='periodcode');
    const months = ['januari','februari','maret','april','mei','juni','juli','agustus','september','oktober','november','desember'];
    function interval(text) {
      const s=String(text).trim().toLowerCase();
      if (/^(?:19|20)\d{2}$/.test(s)) return [s+'-01',s+'-12'];
      const native=/^(0[1-9]|1[0-2])(0[1-9]|1[0-2])((?:19|20)\d{2})$/.exec(s);
      if(native)return native[1]<=native[2]?[native[3]+'-'+native[1],native[3]+'-'+native[2]]:null;
      let year, month, match=s.match(/^((?:19|20)\d{2})[-/](\d{1,2})$/);
      if(match) [,year,month]=match;
      else if((match=s.match(/^(\d{1,2})[-/]((?:19|20)\d{2})$/))) [,month,year]=match;
      else if((match=s.match(/^([a-z]+)\s+((?:19|20)\d{2})$/))) {month=months.indexOf(match[1])+1;year=match[2];}
      if(!year || Number(month)<1 || Number(month)>12) return null;
      const value=year+'-'+String(month).padStart(2,'0');return [value,value];
    }
    const index=isIndex(labels);
    if(submitted && ((selected.scope.source==='sptdaftar')!==index))return {skip:'Kategori sumber berbeda dari tabel SPT Dilaporkan.'};
    if(index && (panelOwner()!==selected.scope.wp || listTables().filter(t=>isIndex(shape(t).labels)).length!==1))
      return {skip:'Panel WP pada daftar SPT berbeda atau tidak dapat dipastikan.'};
    if(selected.previewIndex && index || selected.quick){
      const host=table.closest('.p-datatable,[data-pc-name="datatable"],p-table,[role=region]')||table;
      if(table.closest('[aria-busy=true]') || [...host.querySelectorAll('.p-datatable-loading-overlay,.p-datatable-loading,[data-pc-section=loadingoverlay],[role=progressbar]')].some(visible))
        return {loading:true,skip:selected.quick?'Tabel sumber masih dimuat.':'Daftar SPT masih dimuat.'};
    }
    if(!rows.length && !(selected.previewIndex && index && indexPosition(table,0).range?.total===0))return {skip:'Tabel kosong atau belum selesai dimuat.'};
    if(selected.quick && !ownerColumns.some(c=>['npwpwp','npwpwajibpajak','npwppemilik','taxpayeridentificationnumber','taxpayeridentificationno'].includes(key(c)) ||
          selected.scope.source==='info' && key(c)==='npwp'))
      return {skip:'Kolom NPWP pemilik tabel belum dapat dipastikan.'};
    if((!ownerColumns.length && !index && !selected.scope.manual) || !rows.every(row=>ownerColumns.every(col=>{
      const id=row[col].replace(/[.\s-]/g,'');
      return /^\d{15,16}$/.test(id) && id.padStart(16,'0')===selected.scope.wp;
    }))) return {skip:'Identitas WP di setiap baris belum cocok.'};
    if(index)return {rows,ownerColumns,periodColumns,indexScope:'Daftar SPT lintas masa',ownerEvidence:'Panel WP pada SPT Dilaporkan'};
    if(selected.quick && selected.scope.periodRequired){
      const rowPeriods=rows.map(row=>{
        const values=periodColumns.map(col=>String(row[col]).trim());
        const bounds=values.map(interval);
        const month=bounds.find(b=>b && b[0]===b[1])?.[0];
        if(!month || month<selected.scope.from || month>selected.scope.to)return '';
        return bounds.every((b,i)=>b && (b[0]===month && b[1]===month || /^(19|20)\d{2}$/.test(values[i]) && values[i]===month.slice(0,4)))?month:'';
      });
      if(rowPeriods.some(m=>!m))return {skip:'Sumber buku besar belum menunjukkan satu masa pajak yang cocok pada setiap baris.'};
      return {rows,ownerColumns,periodColumns,rowPeriods};
    }
    if(!selected.scope.manual && (selected.scope.periodRequired || periodColumns.length)) {
      if(!periodColumns.length || !rows.every(row=>periodColumns.every(col=>{
        const bounds=interval(row[col]);
        return bounds && bounds[0]>=selected.scope.from && bounds[1]<=selected.scope.to;
      }))) return {skip:'Masa pada baris belum tersedia atau di luar pilihan.'};
    }
    return {rows,ownerColumns,periodColumns};
  }
  if (selected.scope) {
    const checked=checkScope(currentRows,current.labels);
    if(selected.quick){
      if(checked.skip)return {skip:checked.skip};
      if(location.origin!=='https://coretax.intranet.pajak.go.id')return {skip:'Tab ini bukan sumber Coretax yang dipilih.'};
      const normal=s=>s.toLowerCase().replace(/\s+/g,' ').trim(),refs=(currentTable.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id));
      if(refs.some(el=>!el || !visible(el)))return {skip:'Label tabel belum dapat diperiksa.'};
      const names=[currentTable.caption && visible(currentTable.caption)?currentTable.caption.innerText.trim():'',
        currentTable.getAttribute('aria-label')||'',refs.map(el=>el.innerText.trim()).join(' ')].filter(Boolean).map(normal);
      if(!names.length || names.some(n=>n!==normal(selected.title)))return {skip:'Judul dan label tabel belum cocok.'};
      if(!currentRows.some(r=>selected.quick.fields.every(group=>group.some(field=>r[field]?.trim()))))
        return {skip:'Kolom khas sumber belum memuat isian yang dapat dikenali.'};
      const position=indexPosition(currentTable,currentRows.length);
      if(position.conflict)return {skip:'Rentang halaman dan jumlah baris sumber bertentangan.'};
      const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),
        b=>b.toString(16).padStart(2,'0')).join('');
      const stamp=await digest([current.labels,currentRows,position]);
      if(selected.quick.expect && stamp!==selected.quick.expect)return {skip:'Isi atau filter tabel berubah sejak pratinjau. Buka kembali Pratinjau WP.'};
      const groups=new Map();
      currentRows.forEach((row,i)=>{const month=checked.rowPeriods?.[i]||'';if(!groups.has(month))groups.set(month,[]);groups.get(month).push(row);});
      const slices=[];
      for(const [month,rows] of groups){
        const canonical=rows.map(r=>JSON.stringify(Object.keys(r).sort().map(k=>[k,r[k]]))).sort();
        slices.push({month,count:rows.length,hash:await digest(canonical),...(selected.quick.expect && selected.quick.includeRows?{rows}:{})});
      }
      const latest=shape(currentTable),latestRows=records(latest);
      if(location.href!==selected.url || listTables()[selected.index]!==currentTable || tableTitle(currentTable,selected.index)!==selected.title ||
          checkScope(latestRows,latest.labels).skip || JSON.stringify([latest.labels,latestRows,indexPosition(currentTable,latestRows.length)])!==JSON.stringify([current.labels,currentRows,position]))
        return {skip:'Halaman sumber berubah saat isi tabel sedang dicocokkan.'};
      return {stamp,slices,owner:checked.ownerColumns,period:checked.periodColumns,range:position.range,filtered:position.filtered,
        atStart:position.atStart,atEnd:position.atEnd,canAdvance:!!nextButton(currentTable)};
    }
    if(selected.restartIndex){
      if(checked.skip || !checked.indexScope || selected.scope.source!=='sptdaftar')return {skip:'Daftar dan WP belum cocok.'};
      location.assign(location.href);
      return {returning:true};
    }
    if (selected.openSpt) {
      if (checked.skip || !checked.indexScope || selected.scope.source!=='sptdaftar') return {skip:'WP atau daftar SPT dilaporkan belum cocok.'};
      const matches=currentRows.map((row,i)=>current.labels.every((k,j)=>row[k]===selected.openSpt[j])?i:-1).filter(i=>i>=0);
      if(matches.length!==1)return {skip:'Baris SPT berubah atau muncul lebih dari sekali.'};
      const positive=/^(?:lihat|tampilkan|buka|view|show)(?: (?:detail |rincian )?(?:spt|surat pemberitahuan|tax return|return sheet))?$|^(?:detail|rincian)(?: spt)?$/i;
      const blockedAction=/sendemail|viewreceipt|downloadpdf|(?:^|[-_])(?:send|download|kirim|unduh|hapus|delete|edit|ubah|submit|sign|tandaterima)(?:button)?(?:$|[-_])/i;
      const buttons=[...current.data[matches[0]].querySelectorAll('a[href],button,input[type=button],[role=button]')].filter(el=>{
        if(!visible(el) || el.matches(':disabled,[aria-disabled=true]') || el.closest('tr,[role=row]')!==current.data[matches[0]])return false;
        if(blockedAction.test(el.id))return false;
        const labelledBy=(el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
        if(labelledBy.some(id=>!document.getElementById(id)))return false;
        const names=[el.getAttribute('aria-label'),el.title,el.innerText,
          labelledBy.map(id=>document.getElementById(id)?.textContent || '').join(' '),
          ...Array.from(el.labels || [],label=>label.textContent),
          ...Array.from(el.querySelectorAll('img[alt],svg > title'),icon=>icon.getAttribute('alt') || icon.textContent),
          el.matches('input[type=button]')?el.value:'',el.id==='ViewButton'?el.id:'']
          .map(s=>(s || '').replace(/\s+/g,' ').trim()).filter(Boolean);
        if(!names.length || !names.every(s=>s==='ViewButton' || positive.test(s)))return false;
        if(el.matches('a'))return el.origin===location.origin && !el.username && !el.password && !el.ping && !el.hasAttribute('download') &&
          ['', '_self','_blank'].includes(el.target) && !/(?:^|[/?&=_-])(?:edit|delete|create|submit|sign|hapus|ubah|kirim|receipt|download|unduh|sendemail|viewreceipt|submitteddownloadpdf|requestdownloadpdf)(?:button)?(?:$|[/?&=_-])/i.test(el.pathname+el.search);
        return el.matches('button[type=button],input[type=button]') || (el.matches('button:not([type])') && !el.form);
      });
      if(buttons.length!==1)return {skip:'Baris ini belum memiliki satu tombol lihat yang dapat dikenali.'};
      const control=buttons[0];
      // Dispatch in this turn while the verified row and taxpayer are still current.
      const target=control.matches('a') ? control.href : null;
      control.click();
      return {opened:true,target};
    }
    if(checked.skip || !selected.advance) return {...checked,canAdvance:!!nextButton(currentTable),
      ...(selected.previewIndex && checked.indexScope?{position:indexPosition(currentTable,currentRows.length)}:{}),
      ...(checked.indexScope?{canFirst:!!nextButton(currentTable,true)}:{})};
  }
  if (!selected.advance) return currentRows;
  if (!selected.scope && !sameOwner(currentRows,selected.owner)) throw new Error('Paginasi membutuhkan kolom NPWP pemilik yang cocok pada setiap baris. Lanjutkan per halaman.');
  if (JSON.stringify(currentRows)!==selected.expected) throw new Error('Isi tabel berubah sejak pengambilan. Pilih ulang tabel.');
  const next=nextButton(currentTable,selected.advance==='first' && selected.scope?.source==='sptdaftar');
  if (!next) return {end:true};
  next.click();
  const deadline=Date.now()+5000;
  while(Date.now()<deadline) {
    await new Promise(resolve=>setTimeout(resolve,120));
    if (location.href!==selected.url) throw new Error('Alamat halaman berubah. Pilih ulang sumber sebelum melanjutkan.');
    if(selected.scope && isIndex(selected.labels) && panelOwner()!==selected.scope.wp)
      throw new Error('NPWP tampilan berubah atau panel WP tidak tersedia. Halaman berikut tidak ditambahkan.');
    const table=listTables()[selected.index];
    if(!table)continue;
    if(table.id!==selected.tableId || tableTitle(table,selected.index)!==selected.title)
      throw new Error('Tabel sumber berubah. Halaman berikut tidak ditambahkan.');
    const changed=shape(table);
    if(!changed.labels.length)continue;
    if(JSON.stringify(changed.labels)!==JSON.stringify(selected.labels))
      throw new Error('Kolom tabel sumber berubah. Halaman berikut tidak ditambahkan.');
    const rows=records(changed);
    if(!rows.length || JSON.stringify(rows)===selected.expected) continue;
    if(selected.scope){
      const checked=checkScope(rows,changed.labels,table);
      if(checked.loading)continue;
      return {...checked,canAdvance:!!nextButton(table)};
    }
    if(!sameOwner(rows,selected.owner)) throw new Error('NPWP tampilan berubah. Halaman berikut tidak ditambahkan.');
    return {rows,canAdvance:!!nextButton(table)};
  }
  throw new Error('Halaman berikut belum berubah atau mengulang data. Periksa halaman di Coretax.');
}
