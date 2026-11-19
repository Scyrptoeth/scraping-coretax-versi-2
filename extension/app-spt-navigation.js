import {visibleTables,normalizeId} from './app-data.js';
import {planSptDetails,matchSptVersions} from './app-spt-plan.js';

// Chrome serializes this function into the tab's isolated world.
export function readSptView(request = {}) {
  if (location.origin !== 'https://coretax.intranet.pajak.go.id') return null;
  if (request.expectedUrl && location.href !== request.expectedUrl) return {identityChanged:true};
  const visible = el => el && el.getClientRects().length && el.checkVisibility({visibilityProperty:true,opacityProperty:true});
  const clean = value => (value || '').replace(/\s+/g,' ').trim();
  const caption = el => clean(el.getAttribute('aria-label') ||
    (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id=>document.getElementById(id)?.innerText).filter(Boolean).join(' ') ||
    el.querySelector(':scope > legend,:scope > caption,:scope > h2,:scope > h3')?.innerText);
  const accepted = /^(npwp wajib pajak|npwp wp|jenis spt|jenis surat pemberitahuan pajak|masa pajak|tahun pajak|model spt|pembetulan|id spt|nomor bukti penerimaan|nomor bpe|nomor bps)$/i;
  function pairs(root,include = () => true) {
    const result = [];
    for (const label of root.querySelectorAll('dt,th[scope=row],label[for]')) {
      if (!visible(label) || !include(label)) continue;
      const target = label.matches('label') ? label.control : label.nextElementSibling;
      if (!visible(target) || !root.contains(target)) continue;
      if (label.matches('dt') && !target.matches('dd')) continue;
      if (label.matches('th') && !target.matches('td')) continue;
      if (label.matches('label') && (!target.matches('input[readonly],input:disabled,textarea[readonly],textarea:disabled,select:disabled') ||
          target.matches('[type=password],[type=hidden],[type=file]'))) continue;
      const value = target.matches('select') ? target.selectedOptions[0]?.text :
        target.matches('[type=checkbox],[type=radio]') ? String(target.checked) :
        target.matches('input,textarea') ? target.value : target.innerText;
      result.push([clean(label.innerText).replace(/:$/,''),clean(value)]);
    }
    return result;
  }
  function identity(root) {
    const meta = {};
    for (const [label,value] of pairs(root)) {
      if (!value || !accepted.test(label)) continue;
      const key = label.toLowerCase();
      if (meta[key] && meta[key] !== value) return null;
      meta[key] = value;
    }
    if (!(meta['npwp wajib pajak'] || meta['npwp wp']) || !(meta['id spt'] || meta['nomor bukti penerimaan'] || meta['nomor bpe'] || meta['nomor bps'])) return null;
    return Object.fromEntries(Object.entries(meta).sort(([a],[b])=>a.localeCompare(b)));
  }
  function linkedRoute() {
    if (!request.linkedIndex || !request.expectedUrl) return null;
    const uuid='[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
    const list = new URL(request.linkedIndex);
    const index = new RegExp('^/returnsheets/id-ID/submitted-returnsheets/('+uuid+')/?$','i').exec(list.pathname);
    const formats={
      VAT_VATR:['value-added-tax-return','VAT_VAT','SURAT PEMBERITAHUAN MASA PAJAK PERTAMBAHAN NILAI (SPT MASA PPN)',/^(?:[AB]-[123]|C)$/i],
      ICT_WITR:['article-21-26-tax-return','ICT_WIT','PEMOTONGAN PPH PASAL 21 DAN/ATAU PASAL 26',/^L-(?:IA|IB|II|III)$/i],
      ICT_WTR:['withholding-tax-return','((?:0[1-9]|1[0-2])(?:0[1-9]|1[0-2])(?:19|20)[0-9]{2})','SPT MASA PPH UNIFIKASI',/^(?:DAFTAR-I{1,2}|LAMPIRAN-I)$/i]
    };
    const spec=formats[request.linkedType];
    if (!spec) return null;
    const form = new RegExp('^/returnsheets/id-ID/'+spec[0]+'/('+uuid+')/'+uuid+'/'+spec[1]+'/'+uuid+'/?$','i').exec(location.pathname);
    if (list.origin!==location.origin || !index || !form || index[1].toLowerCase()!==form[1].toLowerCase() || location.search || location.hash) return null;
    return spec;
  }
  function hasEdits(root){
    return [...root.querySelectorAll('input:not([readonly]):not(:disabled),textarea:not([readonly]):not(:disabled),select:not(:disabled),[contenteditable=true]')]
      .filter(visible).some(el=>{
        if(el.isContentEditable)return true;
        if(el.matches('select'))return [...el.options].some(o=>o.selected!==o.defaultSelected) &&
          !(el.selectedIndex===0 && ![...el.options].some(o=>o.defaultSelected));
        if(el.matches('[type=checkbox],[type=radio]'))return el.checked!==el.defaultChecked;
        return el.value!==el.defaultValue;
      });
  }
  if (request.returnUnmatched) {
    if (!linkedRoute()) return null;
    if (hasEdits(document)) return {edited:true};
    location.assign(request.linkedIndex);
    return {returning:true};
  }
  function linkedReturnHeader() {
    const spec=linkedRoute();
    if (!spec) return null;
    // The signature panel in Unifikasi can show a second NPWP without a proven amendment.
    // Its read route can be restored, but opening it does not establish form ownership.
    if (request.linkedType==='ICT_WTR') return null;
    const roots=[...document.querySelectorAll('main,[role=main]')].filter(visible);
    if (roots.length!==1) return null;
    const root=roots[0];
    const heading=spec[2];
    const mainHeading=[...root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading],legend,div,span,strong')].some(el=>
      visible(el) && clean(el.innerText).toUpperCase()===heading);
    const activeTabs=[...root.querySelectorAll('ul.p-tabview-nav [role=tab][aria-selected=true]')].filter(visible);
    const activeAttachment=request.linkedReturnOpened && activeTabs.length===1 && spec[3].test(clean(activeTabs[0].innerText));
    if (!mainHeading && !activeAttachment) return null;
    const labels={'npwp':'npwp wajib pajak','nomor identitas wp':'npwp wajib pajak','periode':'masa pajak','masa':'masa pajak',
      'masa pajak':'masa pajak','tahun pajak':'tahun pajak','normal/pembetulan':'model spt','status spt':'model spt'};
    const meta={'jenis spt':request.linkedType};
    for (const label of root.querySelectorAll('.form-group.row > label')) {
      if (!visible(label)) continue;
      const field=labels[clean(label.innerText).toLowerCase().replace(/^\d+\.\s*/,'').replace(/[\s*:]+$/,'')];
      if (!field) continue;
      const group=label.parentElement;
      if ([...group.querySelectorAll('input:not([type=hidden]),select,textarea')].some(el=>visible(el) && !el.disabled && !el.readOnly)) return null;
      const values=[...group.querySelectorAll('input:disabled,input[readonly],select:disabled,.p-dropdown-label')].filter(visible)
        .map(el=>clean(el.matches('select') ? el.selectedOptions[0]?.text : el.matches('input') ? el.value : el.innerText)).filter(Boolean);
      if (new Set(values).size!==1 || !values.length) return null;
      let value=values[0];
      if (field==='masa pajak') {
        const month=/^(0[1-9]|1[0-2])[-\s/]?((?:19|20)\d{2})$/.exec(value);
        if (month) value=month[2]+'-'+month[1];
        else {
          const words=value.toLowerCase().match(/^([a-z]+)(?:\s*[-–]\s*\1)?\s+((?:19|20)\d{2})$/);
          const n=words && 'januari februari maret april mei juni juli agustus september oktober november desember'.split(' ').indexOf(words[1])+1;
          if (n) value=words[2]+'-'+String(n).padStart(2,'0');
        }
      }
      if (field==='model spt') value=value.toLowerCase();
      if (meta[field] && meta[field]!==value) return null;
      meta[field]=value;
    }
    if (/^(?:0?[1-9]|1[0-2])$/.test(meta['masa pajak']) && /^(?:19|20)\d{2}$/.test(meta['tahun pajak']))
      meta['masa pajak']=meta['tahun pajak']+'-'+meta['masa pajak'].padStart(2,'0');
    if (meta['tahun pajak'] && meta['masa pajak']?.slice(0,4)!==meta['tahun pajak']) return null;
    delete meta['tahun pajak'];
    if (!meta['npwp wajib pajak'] || !meta['masa pajak'] || !meta['model spt']) return null;
    return {root,meta:Object.fromEntries(Object.entries(meta).sort(([a],[b])=>a.localeCompare(b)))};
  }
  const containers = [...document.querySelectorAll('main,[role=main],article,[role=dialog]')].filter(visible)
    .map(root=>({root,meta:identity(root)})).filter(item=>item.meta);
  const scopes = containers.filter(a=>!containers.some(b=>a!==b && a.root.contains(b.root)));
  const chained = scopes.length===0 && linkedReturnHeader();
  if (!chained && scopes.length !== 1) return null;
  const {root,meta} = chained || scopes[0];
  const basis=chained?{identityBasis:'Bukti penerimaan pada baris daftar, tautan WP, serta NPWP, jenis, masa dan pembetulan pada formulir.'}:{};
  if (request.expected && JSON.stringify(meta)!==JSON.stringify(request.expected)) return {identityChanged:true};
  if(request.returnIndex && request.expected){
    const target=new URL(request.returnIndex);
    if(target.origin!==location.origin || target.username || target.password ||
        !/^\/returnsheets\/id-ID\/submitted-returnsheets\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\/?$/i.test(target.pathname))return null;
    if(hasEdits(root))return {edited:true};
    if(request.closeOpened)window.close();
    else location.assign(target.href);
    return {returning:true};
  }
  function partName(label) {
    if(chained) {
      if(request.linkedType==='VAT_VATR' && /^(?:[AB]-[123]|C)$/i.test(label))return label.toLowerCase().replace('-','');
      const parts=request.linkedType==='ICT_WITR'?{'L-IA':'l1a','L-IB':'l1b','L-II':'l2','L-III':'l3'}:{};
      if(Object.hasOwn(parts,label.toUpperCase()))return parts[label.toUpperCase()];
    }
    if (/^(?:induk(?: spt)?|spt induk)(?:\s|$)/i.test(label)) return 'induk';
    if (/^(?:(?:total|jumlah)\s+lampiran\s+c|lampiran\s+c\s*[:–-]\s*(?:total|jumlah))$/i.test(label)) return 'c-total';
    const match = /^lampiran\s+([a-z]{1,3}\.?\d{1,3}(?:[-.][a-z0-9]+)*|\d{1,3}[a-z]?(?:[-.][a-z0-9]+)*|[a-z]{1,2})(?:\s|:|$)/i.exec(label);
    if (!match) return '';
    const code=match[1].toLowerCase().replace(/^([a-z]+)\.(\d)/,'$1$2').replaceAll('.','-');
    return (/^\d/.test(code)?'l':'')+code;
  }
  function riskyAction(control) {
    if (control.hasAttribute('formaction') || control.matches('button[type=submit],button[type=reset]') ||
        (control.form && control.type!=='button')) return true;
    return [control,...control.querySelectorAll('[class],[title],[aria-label]')].some(el=>
      /\b(?:hapus|kirim|simpan|ubah|submit|delete|trash|edit|save|send|pencil)\b/i.test(
        [el.getAttribute('class'),el.getAttribute('title'),el.getAttribute('aria-label')].join(' ')));
  }
  const tabs = [...root.querySelectorAll(chained?'ul.p-tabview-nav [role=tab][aria-controls]':'[role=tab][aria-controls]')].filter(visible);
  const unresolved=new Set();
  const tabInfo=tabs.map(tab=>({tab,label:caption(tab) || clean(tab.innerText),target:document.getElementById(tab.getAttribute('aria-controls'))}));
  for(const {label,target} of tabInfo)if(/^lampiran\b/i.test(label) &&
    (!partName(label) || !target || !root.contains(target) || !target.matches('[role=tabpanel]')))unresolved.add(label.toLowerCase());
  const tabParts = tabInfo
    .filter(x=>x.target ? root.contains(x.target) && x.target.matches('[role=tabpanel]') :
      chained && x.tab.getAttribute('aria-selected')==='false').map(x=>({...x,part:partName(x.label)})).filter(x=>x.part);
  const sections = [...root.querySelectorAll('section,fieldset,[role=tabpanel],table[aria-label],table:has(> caption)')].filter(visible)
    .map(el=>{const tabLabel=tabParts.find(x=>x.target===el)?.label;
      const label=(chained && tabLabel) || caption(el) || tabLabel || '';return {el,label,part:partName(label)};})
    .filter(x=>x.part);
  const offered = [];
  for (const part of new Set([...sections,...tabParts].map(x=>x.part))) {
    const active = sections.filter(x=>x.part===part);
    const inner = active.filter(x=>!active.some(y=>x!==y && x.el.contains(y.el)));
    const linked = tabParts.filter(x=>x.part===part);
    if (inner.length>1 || linked.length>1) {unresolved.add(part);continue;}
    const shown = inner[0];
    if (shown || linked.length) offered.push({part,label:shown?.label || linked[0].label,visible:Boolean(shown)});
    if (chained && request.linkedType==='ICT_WITR' && ['l1b','l2','l3'].includes(part)) unresolved.add(part);
  }
  if (!request.part) return {meta,...basis,sections:offered,unresolved:unresolved.size};
  const selection = offered.find(x=>x.part===request.part);
  if (!request.expected || !selection) return null;
  if (!selection.visible) {
    if (request.mode!=='activate') return null;
    const link = tabParts.find(x=>x.part===selection.part)?.tab;
    if (!link || link.matches(':disabled,[aria-disabled=true]') || riskyAction(link)) return null;
    const panelAnchor=link.matches('a[href]:not([download]):not([ping]):not([target])') &&
      (link.getAttribute('href')==='#'+link.getAttribute('aria-controls') || chained && link.getAttribute('href')==='#');
    const tabAnchor=chained && link.matches('a[role=tab]:not([href]):not([download]):not([target])');
    if (!tabAnchor && !panelAnchor && !link.matches('button[type=button],[role=tab]:not(a):not(button):not(input),button:not([type]):not(form button)')) return null;
    const names=[caption(link),clean(link.innerText),clean(link.title)].filter(Boolean);
    if(!names.length || names.some(n=>partName(n)!==selection.part || /\b(hapus|kirim|simpan|ubah|submit|delete|edit|save)\b/i.test(n)))return null;
    link.click(); return {activated:true};
  }
  const targets = sections.filter(x=>x.part===selection.part);
  const selected=targets.find(x=>!targets.some(y=>x!==y && x.el.contains(y.el)))?.el;
  if (!selected) return null;
  const otherParts=sections.filter(s=>s.part!==selection.part && selected.contains(s.el));
  const belongs=el=>!otherParts.some(s=>s.el.contains(el));
  const grids = selected.matches('table') ? [selected] : [...selected.querySelectorAll('table')].filter(el=>visible(el) && belongs(el));
  let rows = [],columns=[],paging='none',zero=false,atStart=false,atEnd=false,range=null,filtered=false;
  function cellValue(cell) {
    const controls=[...cell.querySelectorAll('input:not([type=hidden]),select,textarea,[contenteditable=true]')].filter(visible);
    if (!controls.length) return cell.innerText.trim();
    if (!chained || controls.some(el=>el.isContentEditable || el.matches('[type=password],[type=file]') || !el.disabled && !el.readOnly)) return null;
    const values=controls.map(el=>el.matches('select') ? el.selectedOptions[0]?.text :
      el.matches('[type=checkbox],[type=radio]') ? (el.checked?'Ya':'Tidak') : el.value).filter(v=>v!=null && v!=='');
    return [...new Set([clean(cell.innerText),...values].filter(Boolean))].join(' · ');
  }
  if (chained && selection.part==='induk') {
    if (request.mode==='advance' || selected.closest('[aria-busy=true]') ||
      [...selected.querySelectorAll('[role=progressbar],.p-datatable-loading-overlay')].some(visible)) return null;
    columns=['Tabel','Baris','Kolom','Isian pada formulir'];
    for (const group of selected.querySelectorAll('.form-group.row')) {
      if (!visible(group) || group.closest('table')) continue;
      const label=group.querySelector(':scope > label');
      if (!visible(label) || !clean(label.innerText) || /kata sandi|password|token|\bOTP\b/i.test(label.innerText)) continue;
      const values=[...group.querySelectorAll('input:disabled:not([type=password]):not([type=hidden]),input[readonly]:not([type=password]):not([type=hidden]),textarea:disabled,textarea[readonly],select:disabled,.p-dropdown-label')].filter(visible)
        .map(el=>clean(el.matches('select') ? el.selectedOptions[0]?.text : el.matches('input,textarea') ? el.value : el.innerText)).filter(Boolean);
      if (values.length) rows.push({Tabel:'Isian formulir',Baris:rows.length+1,Kolom:clean(label.innerText),'Isian pada formulir':[...new Set(values)].join(' · ')});
    }
    for (const [index,grid] of grids.entries()) {
      const lines=[...grid.rows].filter(tr=>visible(tr) && tr.closest('table')===grid);
      for (const [line,tr] of lines.entries()) for (const [column,cell] of [...tr.cells].entries()) {
        if (!visible(cell) || cell.querySelector('table')) continue;
        const value=cellValue(cell);
        if (value===null) return null;
        if (value) rows.push({Tabel:index+1,Baris:line+1,Kolom:column+1,'Isian pada formulir':value});
      }
    }
    // A view of the form layout does not prove all underlying return fields.
  } else if (grids.length === 1) {
    const grid=grids[0],heads=[...grid.querySelectorAll('thead tr')].filter(visible);
    if(selected.closest('[aria-busy=true]') || grid.closest('[aria-busy=true]') ||
      [...selected.querySelectorAll('[role=progressbar],.p-datatable-loading-overlay,[data-pc-section=loadingoverlay]')].some(visible))return null;
    if (heads.length!==1) return null;
    const labels=[...heads[0].cells].map(c=>clean(c.innerText));
    if (!labels.length || labels.some(k=>!k) || new Set(labels).size!==labels.length) return null;
    columns=labels;
    const host=grid.closest('.p-datatable,[data-pc-name=datatable],p-table') || selected;
    const local=[...host.querySelectorAll('table')].filter(visible).length<=1 && (selected.contains(host) || host.contains(selected));
    const pagers=local?[...host.querySelectorAll('.p-paginator,[data-pc-name=paginator],p-paginator,nav[aria-label]')].filter(visible):[];
    const filterHost=local && selected.contains(host)?selected:host;
    filtered=Boolean(filterHost.querySelector('.p-column-filter-menu-button-active,.p-datatable-column-filter-button-active,.p-column-filter-active'));
    const fields=[...root.querySelectorAll('input,textarea,select,[role=combobox],[role=searchbox]')].filter(el=>
      (filterHost.contains(el) && belongs(el) || grid.id && el.getAttribute('aria-controls')===grid.id) && !el.matches('input[type=hidden]'));
    for(const field of fields){
      const name=[field.getAttribute('aria-label'),field.getAttribute('placeholder'),field.title,field.id,field.name,
        ...(field.labels||[]),...(field.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id))]
        .map(s=>typeof s==='string'?s:s?.textContent||'').join(' ');
      if(!field.matches('[type=search],[role=searchbox]') && !field.closest('thead,[role=search],p-columnfilter,.p-column-filter,.p-datatable-filter') &&
        !/filter|search|cari|penyaring|saring/i.test(name))continue;
      if(field.matches('input[type=checkbox],input[type=radio]')){if(field.checked)filtered=true;}
      else if(field.matches('input,textarea,select')){if(clean(field.value))filtered=true;}
      else if(!field.matches('[aria-valuetext=""]') && !field.querySelector('.p-placeholder'))filtered=true;
    }
    const linked=grid.id?[...root.querySelectorAll('button[aria-controls]')].filter(b=>b.getAttribute('aria-controls')===grid.id):[];
    const candidates=[...new Set([...linked,...pagers.flatMap(el=>[...el.querySelectorAll('button')])])].filter(visible);
    const nextName=/^(?:(?:ke )?halaman (?:berikut(?:nya)?|selanjutnya)|berikut(?:nya)?|selanjutnya|(?:go to )?next(?: page)?|›|»|→)$/i;
    const next=candidates.filter(b=>{
      if(riskyAction(b))return false;
      if(b.hasAttribute('aria-controls') && b.getAttribute('aria-controls')!==grid.id)return false;
      const names=[b.getAttribute('aria-label'),b.innerText,b.title,
        (b.getAttribute('aria-labelledby') || '').split(/\s+/).map(id=>document.getElementById(id)?.innerText || '').join(' ')].map(clean).filter(Boolean);
      return names.length ? names.every(n=>nextName.test(n)) :
        b.matches('.p-paginator-next,[data-pc-section=nextpagebutton],[data-pc-section=next]') && pagers.some(p=>p.contains(b));
    });
    if(next.length===1)paging=next[0].matches(':disabled,[aria-disabled=true],.p-disabled')?'end':'next';
    else if(next.length>1 || pagers.length || linked.length)paging='unclear';
    const zeroLabels=local?[...host.querySelectorAll('.p-paginator-current,[aria-live],[role=status]')].filter(visible):[];
    const displayedRows=[...grid.querySelectorAll('tbody > tr')].filter(r=>visible(r) && r.closest('table')===grid);
    const placeholder=chained && !filtered && displayedRows.length===1 && displayedRows[0].cells.length===1 &&
      displayedRows[0].cells[0].colSpan===labels.length && /^tidak ada data yang ditemukan\.?$/i.test(clean(displayedRows[0].innerText));
    const reportedZero=placeholder || zeroLabels.some(el=>/^(?:(?:menampilkan|showing)\s+)?0\s*(?:-|–|s\.d\.|sampai|to)\s*0\s*(?:dari|of)\s*0(?:\s+(?:baris|data|entri|entries|records))?\.?$/i.test(clean(el.innerText)));
    for (const tr of [...grid.querySelectorAll('tbody > tr')].filter(r=>visible(r) && r.closest('table')===grid)) {
      if(reportedZero && tr.cells.length===1 && /^(?:tidak ada data(?: yang ditemukan)?|data tidak (?:tersedia|ditemukan)|no (?:data|records)(?: found)?)\.?$/i.test(clean(tr.innerText)))continue;
      if (tr.cells.length!==labels.length || [...tr.cells].some(c=>c.colSpan!==1 || c.rowSpan!==1) ||
          [...tr.querySelectorAll('[role=checkbox]')].some(visible)) return null;
      const values=[...tr.cells].map(cellValue);
      if (values.includes(null)) return null;
      rows.push(Object.fromEntries(labels.map((label,i)=>[label,values[i]])));
    }
    zero=reportedZero && !rows.length && ['end','none'].includes(paging);
    const previous=candidates.filter(b=>{
      if(riskyAction(b) || b.hasAttribute('aria-controls') && b.getAttribute('aria-controls')!==grid.id)return false;
      const names=[b.getAttribute('aria-label'),b.title,b.innerText,(b.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.innerText||'').join(' ')].map(clean).filter(Boolean);
      return names.length?names.every(n=>/^(?:(?:ke )?halaman (?:pertama|sebelumnya)|(?:go to )?(?:first|previous)(?: page)?|sebelumnya|‹|«|←)$/i.test(n)):
        b.matches('.p-paginator-first,.p-paginator-prev,[data-pc-section=firstpagebutton],[data-pc-section=previouspagebutton]') && pagers.some(p=>p.contains(b));
    });
    const positions=zeroLabels.map(el=>/^(?:(?:menampilkan|showing)\s+)?(\d+)\s*(?:-|–|s\.d\.|sampai|to)\s*(\d+)\s*(?:dari|of)\s*(\d+)(?:\s+(?:baris|data|entri|entries|records))?\.?$/i.exec(clean(el.innerText))).filter(Boolean);
    if(positions.length && positions.every(p=>p.slice(1).join('/')===positions[0].slice(1).join('/'))){
      const [first,last,total]=positions[0].slice(1).map(Number);
      if(first>=1 && last>=first && last<=total && last-first+1===rows.length && Number.isSafeInteger(total))range={first,last,total};
    }
    const firstByButton=previous.length>0 && previous.every(b=>b.matches(':disabled,[aria-disabled=true],.p-disabled'));
    const consistent=!positions.length || zero || Boolean(range && (paging!=='end' || range.last===range.total) && (paging!=='next' || range.last<range.total) &&
      (!previous.length || firstByButton===(range.first===1)));
    atStart=consistent && !filtered && (zero || (range?range.first===1:firstByButton));
    atEnd=consistent && !filtered && (zero || paging==='end' || paging==='none' && range && range.last===range.total);
    if(request.mode==='advance'){
      if(paging!=='next' || JSON.stringify(columns)!==JSON.stringify(request.columns) ||
          JSON.stringify(rows.map(row=>columns.map(c=>row[c])))!==request.before)return {changed:true};
      next[0].click();return {advanced:true};
    }
  } else if (!grids.length) {
    const fields=pairs(selected,belongs).filter(([label])=>label && !accepted.test(label));
    if (new Set(fields.map(([label])=>label)).size!==fields.length) return null;
    if (fields.length) {
      rows=[Object.fromEntries(fields)];columns=fields.map(([k])=>k);
      atStart=atEnd=!selected.querySelector('.p-paginator,[data-pc-name=paginator],p-paginator,nav,[aria-busy=true],[role=progressbar],button[aria-controls],input:not([readonly]):not(:disabled),textarea:not([readonly]):not(:disabled),select:not(:disabled),[contenteditable=true]');
    }
  }
  if (!rows.length && !zero) return null;
  if (chained && request.linkedType==='ICT_WITR' && ['l1b','l2','l3'].includes(selection.part)) atEnd=false;
  return {meta,...basis,part:selection.part,label:selection.label,rows,columns,paging,zero,atStart,atEnd,range,filtered};
}

function matchedDocument(row,wp,period,doc) {
  const item={wp,source:'sptdaftar',page:{Payload:{Data:[row]}}};
  const match=planSptDetails({wp,period,types:[doc.type],items:[item],strictReceipts:true}).documents[0];
  return matchSptVersions(match,doc);
}
const wait = ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function sptNavigation({ext,wp,period,doc,allowLinkedReturn=false}) {
  const site='https://coretax.intranet.pajak.go.id';
  const pins=new Map();
  let unverifiedLink=null;
  const execute=async (tabId,func,options)=>{
    const request=func===readSptView?{...pins.get(tabId),...options}:options;
    return (await ext.scripting.executeScript({target:{tabId},func,args:[request]}))[0]?.result;
  };
  function verified(view) {
    const meta=view?.meta;
    const owners=[meta?.['npwp wajib pajak'],meta?.['npwp wp']].filter(Boolean);
    if (!owners.length || owners.some(owner=>normalizeId(owner)!==wp)) return null;
    if (view.identityBasis) {
      if (!allowLinkedReturn || !doc.receipt || meta['jenis spt']!==doc.type) return null;
      return matchedDocument({...meta,'nomor bukti penerimaan':doc.receipt},wp,period,doc);
    }
    return matchedDocument(meta,wp,period,doc);
  }
  async function inspect(tabId,linkedIndex) {
    let view;
    try {
      const url=(await ext.tabs.get(tabId)).url;
      const pin={expectedUrl:url,...(linkedIndex?{linkedIndex,linkedType:doc.type}:{})};
      if (pins.has(tabId) && pins.get(tabId).expectedUrl!==url) return null;
      view=await execute(tabId,readSptView,pin);
      if (!verified(view)) return null;
      pins.set(tabId,{...pins.get(tabId),...pin,...(view.identityBasis?{linkedReturnOpened:true}:{})});
      return {tabId,...view};
    } catch { return null; }
  }
  async function open(tabId) {
    const tab=await ext.tabs.get(tabId);
    const index=(await execute(tabId,visibleTables,null)).filter(t=>t.indexSource==='sptdaftar');
    if(index.length!==1) throw Error('Pilih tab dengan satu daftar SPT Dilaporkan yang sedang terbuka.');
    const options={...index[0],url:tab.url,scope:{wp,source:'sptdaftar',manual:true}};
    const read=await execute(tabId,visibleTables,options);
    const matches=(read?.rows || []).filter(row=>matchedDocument(row,wp,period,doc));
    if(!read?.indexScope || matches.length!==1) throw Error('WP dan versi SPT harus cocok dengan satu baris di halaman daftar yang terlihat.');
    const previous=new Set((await ext.tabs.query({url:site+'/*'})).map(t=>t.id));
    pins.delete(tabId);
    unverifiedLink=null;
    const opened=await execute(tabId,visibleTables,{...options,openSpt:index[0].labels.map(k=>matches[0][k])});
    if (!opened?.opened) throw Error(opened?.skip || 'Tindakan lihat pada baris SPT belum tersedia.');
    for (let attempt=0;attempt<20;attempt++) {
      await wait(200);
      const tabs=(await ext.tabs.query({url:site+'/*'})).filter(t=>t.id===tabId ||
        (!previous.has(t.id) && (t.openerTabId===tabId || (opened.target && t.url===opened.target))));
      const changed=tabs.find(t=>t.id===tabId && t.url!==tab.url);
      if (allowLinkedReturn && doc.receipt && changed) {
        if (unverifiedLink && unverifiedLink.expectedUrl!==changed.url) throw changedIdentity();
        unverifiedLink={tabId,linkedIndex:tab.url,linkedType:doc.type,expectedUrl:changed.url};
      }
      const views=(await Promise.all(tabs.map(t=>inspect(t.id,
        (allowLinkedReturn && doc.receipt && t.id===tabId && t.url!==tab.url) ? tab.url : null)))).filter(Boolean);
      if (views.length===1) {unverifiedLink=null;return views[0];}
      if (views.length>1) break;
    }
    throw Error('Tampilan sudah dibuka. WP, jenis, masa, pembetulan, dan nomor dokumen belum dapat dicocokkan pada satu tampilan.');
  }
  async function recoverIndex(tabId,indexUrl) {
    if (!unverifiedLink || unverifiedLink.tabId!==tabId || unverifiedLink.linkedIndex!==indexUrl) return false;
    const result=await execute(tabId,readSptView,{...unverifiedLink,returnUnmatched:true});
    unverifiedLink=null;
    if(result?.edited)throw Object.assign(Error('Isian pada formulir berubah. Tab dibiarkan terbuka untuk diperiksa.'),{code:'SCOPE'});
    return Boolean(result?.returning);
  }
  const changedIdentity=()=>Object.assign(Error('Identitas WP atau dokumen berubah. Pilih kembali versi SPT.'),{code:'IDENTITY'});
  async function capture(view,part,checkpoint=()=>{}) {
    const args={part,expected:view.meta};
    const current=await execute(view.tabId,readSptView,{expected:view.meta});
    if (!verified(current)) throw changedIdentity();
    const section=current.sections.find(s=>s.part===part);
    if (!section) throw Error('Bagian SPT sudah berubah.');
    if (!section.visible) {
      await checkpoint();
      if (!(await execute(view.tabId,readSptView,{...args,mode:'activate'}))?.activated) throw Error('Bagian ini belum dapat dibuka melalui tab formulir.');
    }
    for(let attempt=0;attempt<10;attempt++) {
      const result=await execute(view.tabId,readSptView,args);
      if(result?.identityChanged)throw changedIdentity();
      const match=verified(result);
      if(match && result.rows) {
        if (result.zero && result.identityBasis) {
          await wait(250);await checkpoint();
          const next=await execute(view.tabId,readSptView,args);
          if(next?.identityChanged)throw changedIdentity();
          if (!next?.zero || !verified(next)) continue;
        }
        return {...result,recordId:match.recordId || doc.recordId,receipt:match.receipt || doc.receipt};
      }
      await wait(150);
    }
    throw Error('Bagian belum terbaca sebagai satu tabel atau satu formulir yang jelas. Periksa identitas dan tampilan sumber.');
  }
  async function collect(view,{limit,checkpoint,onPage,onIssue,skipParts=new Set(),onSections=()=>{},onCovered=()=>{},onReuse=()=>{}}) {
    if(!(allowLinkedReturn&&limit===Infinity) && (!Number.isInteger(limit) || limit<1 || limit>100))throw Error('Pilih batas 1–100 halaman per bagian.');
    const listed=[...view.sections].sort((a,b)=>Number(b.part==='induk')-Number(a.part==='induk'));
    if(!listed.length)throw Error('Nama induk atau lampiran belum terbaca pada tampilan ini.');
    const discovered=new Set(listed.map(s=>s.part));
    onSections(listed);
    let unresolved=view.unresolved || 0;
    function discover(current){
      unresolved=Math.max(unresolved,current.unresolved||0);
      for(const item of current.sections){
        if(discovered.has(item.part))continue;
        discovered.add(item.part);listed.push(item);onSections([item]);
      }
    }
    for(const section of listed){
      await checkpoint();
      if(skipParts.has(section.part)){
        let current=await execute(view.tabId,readSptView,{expected:view.meta});
        if(!verified(current))throw changedIdentity();
        discover(current);
        if(doc.parts?.some(p=>!skipParts.has(p.name) && !discovered.has(p.name)) && current.sections.some(p=>p.part===section.part && !p.visible)){
          const activation=await execute(view.tabId,readSptView,{part:section.part,expected:view.meta,mode:'activate'});
          if(activation?.identityChanged)throw changedIdentity();
          if(activation?.activated){
            for(let attempt=0;attempt<10;attempt++){
              await checkpoint();current=await execute(view.tabId,readSptView,{expected:view.meta});
              if(!verified(current))throw changedIdentity();
              if(current.sections.some(s=>s.part===section.part && s.visible)){discover(current);break;}
              await wait(150);
            }
          }
        }
        onReuse(section);continue;
      }
      const pass=crypto.randomUUID(),seen=new Set();
      try {
        let result=await capture(view,section.part,checkpoint);
        const shape=JSON.stringify(result.columns);
        for(let page=1;;page++){
          await checkpoint();
          if(!verified(await execute(view.tabId,readSptView,{expected:view.meta})))throw changedIdentity();
          const fingerprint=JSON.stringify(result.rows.map(row=>result.columns.map(k=>row[k])));
          if(shape!==JSON.stringify(result.columns) || seen.has(fingerprint))throw Error('Kolom berubah atau halaman berulang.');
          if(result.zero && page>1)throw Error('Total berubah menjadi nol setelah halaman berisi.');
          seen.add(fingerprint);
          await onPage({...result,pass,page});
          if(result.paging==='unclear')throw Error('Kontrol halaman berikutnya belum dapat dipastikan.');
          if(result.paging!=='next'){
            if(result.atEnd){
              if(!verified(await execute(view.tabId,readSptView,{expected:view.meta})))throw changedIdentity();
              onCovered(pass);
            }
            break;
          }
          if(page>=limit)throw Error('Batas halaman tercapai saat masih ada halaman berikutnya.');
          await checkpoint();
          const args={part:section.part,expected:view.meta};
          const clicked=await execute(view.tabId,readSptView,{...args,mode:'advance',columns:result.columns,before:fingerprint});
          if(clicked?.identityChanged)throw changedIdentity();
          if(!clicked?.advanced)throw Error('Tabel atau tombol berikutnya berubah sebelum dibuka.');
          let next;
          for(let attempt=0;attempt<24;attempt++){
            await wait(125);await checkpoint();
            const candidate=await execute(view.tabId,readSptView,args);
            if(candidate?.identityChanged)throw changedIdentity();
            if(!candidate?.rows || !verified(candidate))continue;
            if(JSON.stringify(candidate.columns)!==shape)throw Error('Kolom sumber berubah sesudah pindah halaman.');
            if(JSON.stringify(candidate.rows.map(row=>candidate.columns.map(k=>row[k])))!==fingerprint){next=candidate;break;}
          }
          if(!next)throw Error('Halaman berikut belum berubah atau data berulang.');
          if((result.range || next.range) && (!result.range || !next.range || result.range.total!==next.range.total || next.range.first!==result.range.last+1))
            throw Error('Urutan atau total baris pada penanda halaman berubah.');
          result={...next,recordId:result.recordId,receipt:result.receipt};
        }
      } catch(error){
        if(error.code==='IDENTITY' || error.code==='STOP' || error.code==='SCOPE')throw error;
        if(!verified(await execute(view.tabId,readSptView,{expected:view.meta})))throw changedIdentity();
        onIssue(section,error);
      }
      const refreshed=await execute(view.tabId,readSptView,{expected:view.meta});
      if(!verified(refreshed))throw changedIdentity();
      discover(refreshed);
    }
    for(const part of doc.parts||[])if(!skipParts.has(part.name) && !discovered.has(part.name))
      onIssue({part:part.name,label:part.name.toUpperCase()},Error('Bagian yang diperlukan belum ditemukan pada tampilan ini.'));
    if(unresolved)onIssue({label:'Tampilan sumber'},Error(unresolved+' bagian berlabel belum bisa dicocokkan ke satu panel.'));
  }
  async function returnToIndex(view,indexUrl,indexTabId){
    const closeOpened=view.tabId!==indexTabId;
    let result;
    try{result=await execute(view.tabId,readSptView,{returnIndex:indexUrl,expected:view.meta,closeOpened});}
    catch(error){
      if(!closeOpened)throw error;
      try{await ext.tabs.get(view.tabId);}catch{return;}
      throw error;
    }
    if(result?.edited)throw Object.assign(Error('Isian pada formulir berubah. Tab dibiarkan terbuka untuk diperiksa.'),{code:'SCOPE'});
    if(!result?.returning)throw changedIdentity();
  }
  return {open,inspect,capture,collect,returnToIndex,recoverIndex,matches:row=>Boolean(matchedDocument(row,wp,period,doc))};
}
