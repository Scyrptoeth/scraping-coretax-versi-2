import {visibleTables,normalizeId} from './app-data.js';
import {planSptDetails} from './app-spt-plan.js';

// Chrome serializes this function into the tab's isolated world.
export function readSptView(request = {}) {
  if (location.origin !== 'https://coretax.intranet.pajak.go.id') return null;
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
  const containers = [...document.querySelectorAll('main,[role=main],article,[role=dialog]')].filter(visible)
    .map(root=>({root,meta:identity(root)})).filter(item=>item.meta);
  const scopes = containers.filter(a=>!containers.some(b=>a!==b && a.root.contains(b.root)));
  if (scopes.length !== 1) return null;
  const {root,meta} = scopes[0];
  if (request.expected && JSON.stringify(meta)!==JSON.stringify(request.expected)) return null;
  function partName(label) {
    if (/^(?:induk(?: spt)?|spt induk)(?:\s|$)/i.test(label)) return 'induk';
    const match = /^lampiran\s+([a-z]{0,3}\d{1,3}(?:[-.][a-z0-9]+)*|[a-z]{1,2})(?:\s|:|$)/i.exec(label);
    if (!match) return '';
    return (/^\d/.test(match[1])?'l':'')+match[1].toLowerCase().replaceAll('.','-');
  }
  const tabs = [...root.querySelectorAll('[role=tab][aria-controls]')].filter(visible);
  const tabParts = tabs.map(tab=>({tab,label:caption(tab) || clean(tab.innerText),target:document.getElementById(tab.getAttribute('aria-controls'))}))
    .filter(x=>x.target && root.contains(x.target) && x.target.matches('[role=tabpanel]')).map(x=>({...x,part:partName(x.label)})).filter(x=>x.part);
  const sections = [...root.querySelectorAll('section,fieldset,[role=tabpanel],table[aria-label],table:has(> caption)')].filter(visible)
    .map(el=>{const label=caption(el) || tabParts.find(x=>x.target===el)?.label || '';return {el,label,part:partName(label)};})
    .filter(x=>x.part);
  const offered = [];
  for (const part of new Set([...sections,...tabParts].map(x=>x.part))) {
    const active = sections.filter(x=>x.part===part);
    const inner = active.filter(x=>!active.some(y=>x!==y && x.el.contains(y.el)));
    const linked = tabParts.filter(x=>x.part===part);
    if (inner.length>1 || linked.length>1) continue;
    const shown = inner[0];
    if (shown || linked.length) offered.push({part,label:shown?.label || linked[0].label,visible:Boolean(shown)});
  }
  if (!request.part) return {meta,sections:offered};
  const selection = offered.find(x=>x.part===request.part);
  if (!request.expected || !selection) return null;
  if (!selection.visible) {
    if (request.mode!=='activate') return null;
    const link = tabParts.find(x=>x.part===selection.part)?.tab;
    if (!link || !link.matches('button[type=button],[role=tab]:not(a):not(button):not(input),button:not([type]):not(form button)') ||
        link.matches(':disabled,[aria-disabled=true]')) return null;
    link.click(); return {activated:true};
  }
  const targets = sections.filter(x=>x.part===selection.part);
  const selected=targets.find(x=>!targets.some(y=>x!==y && x.el.contains(y.el)))?.el;
  if (!selected) return null;
  const otherParts=sections.filter(s=>s.part!==selection.part && selected.contains(s.el));
  const belongs=el=>!otherParts.some(s=>s.el.contains(el));
  const grids = selected.matches('table') ? [selected] : [...selected.querySelectorAll('table')].filter(el=>visible(el) && belongs(el));
  let rows = [];
  if (grids.length === 1) {
    const grid=grids[0],heads=[...grid.querySelectorAll('thead tr')].filter(visible);
    if (heads.length!==1) return null;
    const labels=[...heads[0].cells].map(c=>clean(c.innerText));
    if (!labels.length || labels.some(k=>!k) || new Set(labels).size!==labels.length) return null;
    for (const tr of [...grid.querySelectorAll('tbody > tr')].filter(r=>visible(r) && r.closest('table')===grid)) {
      if (tr.cells.length!==labels.length || [...tr.cells].some(c=>c.colSpan!==1 || c.rowSpan!==1) ||
          [...tr.querySelectorAll('input,select,textarea,[role=checkbox]')].some(visible)) return null;
      rows.push(Object.fromEntries(labels.map((label,i)=>[label,tr.cells[i].innerText.trim()])));
    }
  } else if (!grids.length) {
    const fields=pairs(selected,belongs).filter(([label])=>label && !accepted.test(label));
    if (new Set(fields.map(([label])=>label)).size!==fields.length) return null;
    if (fields.length) rows=[Object.fromEntries(fields)];
  }
  if (!rows.length) return null;
  return {meta,part:selection.part,label:selection.label,rows};
}

function matchedDocument(row,wp,period,doc) {
  const item={wp,source:'sptdaftar',page:{Payload:{Data:[row]}}};
  const match=planSptDetails({wp,period,types:[doc.type],items:[item]}).documents[0];
  if (!match || match.key!==doc.key || (doc.recordId && match.recordId && doc.recordId!==match.recordId)) return null;
  return (doc.recordId && match.recordId===doc.recordId) || (doc.receipt && match.receipt===doc.receipt) ? match : null;
}
const wait = ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function sptNavigation({ext,wp,period,doc}) {
  const site='https://coretax.intranet.pajak.go.id';
  const execute=async (tabId,func,options)=>(await ext.scripting.executeScript({target:{tabId},func,args:[options]}))[0]?.result;
  function verified(view) {
    const meta=view?.meta;
    if (!meta || normalizeId(meta['npwp wajib pajak'] || meta['npwp wp'])!==wp) return null;
    return matchedDocument(meta,wp,period,doc);
  }
  async function inspect(tabId) {
    let view;
    try { view=await execute(tabId,readSptView,{}); } catch { return null; }
    return verified(view) ? {tabId,...view} : null;
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
    const opened=await execute(tabId,visibleTables,{...options,openSpt:index[0].labels.map(k=>matches[0][k])});
    if (!opened?.opened) throw Error(opened?.skip || 'Tindakan lihat pada baris SPT belum tersedia.');
    for (let attempt=0;attempt<20;attempt++) {
      await wait(200);
      const tabs=(await ext.tabs.query({url:site+'/*'})).filter(t=>t.id===tabId ||
        (!previous.has(t.id) && (t.openerTabId===tabId || (opened.target && t.url===opened.target))));
      const views=(await Promise.all(tabs.map(t=>inspect(t.id)))).filter(Boolean);
      if (views.length===1) return views[0];
      if (views.length>1) break;
    }
    throw Error('Tampilan sudah dibuka. WP, jenis, masa, pembetulan, dan nomor dokumen belum dapat dicocokkan pada satu tampilan.');
  }
  async function capture(view,part) {
    const args={part,expected:view.meta};
    const current=await execute(view.tabId,readSptView,{expected:view.meta});
    if (!verified(current)) throw Error('Identitas WP atau dokumen berubah. Pilih kembali versi SPT.');
    const section=current.sections.find(s=>s.part===part);
    if (!section) throw Error('Bagian SPT sudah berubah.');
    if (!section.visible) {
      if (!(await execute(view.tabId,readSptView,{...args,mode:'activate'}))?.activated) throw Error('Bagian ini belum dapat dibuka melalui tab formulir.');
    }
    for(let attempt=0;attempt<10;attempt++) {
      const result=await execute(view.tabId,readSptView,args);
      const match=verified(result);
      if(match && result.rows) return {...result,recordId:match.recordId || doc.recordId,receipt:match.receipt || doc.receipt};
      await wait(150);
    }
    throw Error('Bagian belum terbaca sebagai satu tabel atau satu formulir yang jelas. Periksa identitas dan tampilan sumber.');
  }
  return {open,inspect,capture};
}
