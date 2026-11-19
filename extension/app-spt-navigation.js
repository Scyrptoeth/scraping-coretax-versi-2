import {visibleTables,normalizeId} from './app-data.js';
import {linkedSptTypes,planSptDetails,matchSptVersions,sptListContext,submittedRowKey} from './app-spt-plan.js';
import {sha256} from './archive/package.js';

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
    const form = new RegExp('^/returnsheets/id-ID/'+spec[0]+'/('+uuid+')/('+uuid+')/'+spec[1]+'/'+uuid+'/?$','i').exec(location.pathname);
    if (list.origin!==location.origin || !index || !form || index[1].toLowerCase()!==form[1].toLowerCase() ||
        (location.search && location.search!=='?view=true') || location.hash) return null;
    if (request.linkedRecordId && request.linkedRecordId.toLowerCase()!==form[2].toLowerCase()) return null;
    return {spec,recordId:form[2].toLowerCase()};
  }
  function hasEdits(root,verifiedPeriod){
    return [...root.querySelectorAll('input:not([readonly]):not(:disabled),textarea:not([readonly]):not(:disabled),select:not(:disabled),[contenteditable=true]')]
      .filter(visible).some(el=>{
        if(el===verifiedPeriod)return false;
        if(el.isContentEditable)return true;
        if(el.matches('select'))return [...el.options].some(o=>o.selected!==o.defaultSelected) &&
          !(el.selectedIndex===0 && ![...el.options].some(o=>o.defaultSelected));
        if(el.matches('[type=checkbox],[type=radio]'))return el.checked!==el.defaultChecked;
        return el.value!==el.defaultValue;
      });
  }
  if (request.returnUnmatched) {
    const route=linkedRoute();
    if (!route&&!request.allowFreshIndex) return null;
    if (hasEdits(document)) return {edited:true};
    if (!route) return {reopen:true};
    location.assign(request.linkedIndex);
    return {returning:true};
  }
  function linkedReturnHeader() {
    const route=linkedRoute();
    if (!route) return null;
    const {spec,recordId}=route;
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
    const withholdingReadView=request.linkedType==='ICT_WITR' && location.search==='?view=true';
    const vatReadView=request.linkedType==='VAT_VATR' && request.linkedRow && location.search==='?view=true';
    const activePanel=withholdingReadView && activeAttachment && document.getElementById(activeTabs[0].getAttribute('aria-controls'));
    const labels={'npwp':'npwp wajib pajak','nomor identitas wp':'npwp wajib pajak','periode':'masa pajak','masa':'masa pajak',
      'masa pajak':'masa pajak','tahun pajak':'tahun pajak','normal/pembetulan':'model spt','status spt':'model spt'};
    const meta={'jenis spt':request.linkedType};
    let placeholderModel=false,verifiedPeriod=null;
    for (const label of root.querySelectorAll('.form-group.row > label')) {
      if (!visible(label)) continue;
      const labelText=clean(label.innerText).toLowerCase().replace(/^\d+\.\s*/,'').replace(/[\s*:]+$/,'');
      const attachmentPeriod=activePanel && activePanel.matches('[role=tabpanel]') && root.contains(activePanel) &&
        activePanel.contains(label) && labelText==='masa pajak (mm-yyyy)';
      const field=attachmentPeriod?'masa pajak':labels[labelText];
      if (!field) continue;
      const group=label.parentElement;
      const editable=[...group.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(el=>visible(el) && !el.disabled && !el.readOnly);
      if (editable.length) {
        if (!attachmentPeriod || editable.length!==1 || !editable[0].matches('input[type=text]') ||
            !/^(?:0[1-9]|1[0-2])-(?:19|20)\d{2}$/.test(clean(editable[0].value))) return null;
        verifiedPeriod=editable[0];
      }
      const fields=[...group.querySelectorAll('input:disabled,input[readonly],select:disabled,.p-dropdown-label')].filter(visible);
      const vatPeriod=request.linkedType==='VAT_VATR' && field==='masa pajak' &&
        fields.some(el=>el.matches('input[formcontrolname="Period"]'));
      const values=fields.filter(el=>!vatPeriod||!el.matches('input[formcontrolname="BookkeepingPeriod"]'))
        .map(el=>clean(el.matches('select') ? el.selectedOptions[0]?.text : el.matches('input') ? el.value : el.innerText)).filter(Boolean);
      if(editable.length)values.push(clean(verifiedPeriod.value));
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
      if (field==='model spt'){
        value=value.toLowerCase();
        const withholdingPlaceholder=withholdingReadView && (value==='please select' || value==='pembetulan' && request.linkedRevision>0);
        const vatPlaceholder=vatReadView && value==='silakan pilih';
        if ((withholdingPlaceholder || vatPlaceholder) && group.querySelector('input:disabled,select:disabled')){
          placeholderModel=true;
          continue;
        }
      }
      if (meta[field] && meta[field]!==value) return null;
      meta[field]=value;
    }
    if (/^(?:0?[1-9]|1[0-2])$/.test(meta['masa pajak']) && /^(?:19|20)\d{2}$/.test(meta['tahun pajak']))
      meta['masa pajak']=meta['tahun pajak']+'-'+meta['masa pajak'].padStart(2,'0');
    if (meta['tahun pajak'] && meta['masa pajak']?.slice(0,4)!==meta['tahun pajak']) return null;
    delete meta['tahun pajak'];
    const revisionFromIndex=!meta['model spt'] && (placeholderModel || activePanel) && (withholdingReadView || vatReadView) &&
      Number.isInteger(request.linkedRevision) &&
      request.linkedRevision>=0 && request.linkedRevision<=999;
    if (revisionFromIndex) meta['model spt']=request.linkedRevision===0?'normal':String(request.linkedRevision);
    if (!meta['npwp wajib pajak'] || !meta['masa pajak'] || !meta['model spt']) return null;
    const linkedRecordId=request.linkedRow && (withholdingReadView || vatReadView)?recordId:'';
    return {root,meta:Object.fromEntries(Object.entries(meta).sort(([a],[b])=>a.localeCompare(b))),revisionFromIndex,verifiedPeriod,linkedRecordId};
  }
  const containers = [...document.querySelectorAll('main,[role=main],article,[role=dialog]')].filter(visible)
    .map(root=>({root,meta:identity(root)})).filter(item=>item.meta);
  const scopes = containers.filter(a=>!containers.some(b=>a!==b && a.root.contains(b.root)));
  const chained = scopes.length===0 && linkedReturnHeader();
  if (!chained && scopes.length !== 1) {
    if (request.checkLoading && !scopes.length && ['VAT_VATR','ICT_WITR'].includes(request.linkedType) && linkedRoute())
      return {loading:true};
    return null;
  }
  const {root,meta} = chained || scopes[0];
  const basis=chained?{...(chained.linkedRecordId?{linkedRecordId:chained.linkedRecordId}:{}),
    identityBasis:chained.linkedRecordId?'Tautan formulir baca dari baris daftar yang unik, serta NPWP, jenis dan masa pada formulir.':
    chained.revisionFromIndex
    ?'Bukti penerimaan dan pembetulan pada baris yang membuka formulir baca, serta NPWP, jenis dan masa pada formulir.'
    :'Bukti penerimaan pada baris daftar, tautan WP, serta NPWP, jenis, masa dan pembetulan pada formulir.'}:{};
  if (request.expected && JSON.stringify(meta)!==JSON.stringify(request.expected)) return {identityChanged:true};
  if(request.returnIndex && request.expected){
    const target=new URL(request.returnIndex);
    if(target.origin!==location.origin || target.username || target.password ||
        !/^\/returnsheets\/id-ID\/submitted-returnsheets\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\/?$/i.test(target.pathname))return null;
    if(hasEdits(root,chained?.verifiedPeriod))return {edited:true};
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
  const subdivisions=chained && request.linkedType==='ICT_WITR' && location.search==='?view=true'?{
    l1b:[['l1b-a1','BPA1'],['l1b-a2','BPA2']],
    l2:[['l2-a1','BPA1'],['l2-a2','BPA2']],
    l3:[['l3-bp21','BP21'],['l3-bp26','BP26']]
  }:{};
  const tabInfo=tabs.map(tab=>({tab,label:caption(tab) || clean(tab.innerText),target:document.getElementById(tab.getAttribute('aria-controls'))}));
  for(const {label,target} of tabInfo)if(/^lampiran\b/i.test(label) &&
    (!partName(label) || !target || !root.contains(target) || !target.matches('[role=tabpanel]')))unresolved.add(label.toLowerCase());
  const parentTabs = tabInfo
    .filter(x=>x.target ? root.contains(x.target) && x.target.matches('[role=tabpanel]') :
      chained && x.tab.getAttribute('aria-selected')==='false').map(x=>({...x,part:partName(x.label)})).filter(x=>x.part);
  const tabParts=parentTabs.flatMap(item=>subdivisions[item.part]?.map(([part,title])=>
    ({...item,part,label:item.label+' · '+title,parent:item.part}))??[item]);
  const sections = [...root.querySelectorAll('section,fieldset,[role=tabpanel],table[aria-label],table:has(> caption)')].filter(visible)
    .map(el=>{const tabLabel=parentTabs.find(x=>x.target===el)?.label;
      const label=(chained && tabLabel) || caption(el) || tabLabel || '';return {el,label,part:partName(label)};})
    .filter(x=>x.part).flatMap(item=>{
      const parts=subdivisions[item.part];
      if(!parts)return [item];
      if(!parentTabs.some(tab=>tab.part===item.part && tab.target===item.el))return [];
      const panels=[...item.el.querySelectorAll('p-panel')].filter(visible);
      return parts.flatMap(([part,title])=>panels.filter(panel=>
        [...panel.querySelectorAll('.p-panel-title')].some(el=>el.closest('p-panel')===panel &&
          visible(el) && clean(el.innerText).toUpperCase()===title))
        .map(el=>({el,label:item.label+' · '+title,part})));
    });
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
    const tab = tabParts.find(x=>x.part===selection.part),link=tab?.tab;
    if (!link || link.matches(':disabled,[aria-disabled=true]') || riskyAction(link)) return null;
    const panelAnchor=link.matches('a[href]:not([download]):not([ping]):not([target])') &&
      (link.getAttribute('href')==='#'+link.getAttribute('aria-controls') || chained && link.getAttribute('href')==='#');
    const tabAnchor=chained && link.matches('a[role=tab]:not([href]):not([download]):not([target])');
    if (!tabAnchor && !panelAnchor && !link.matches('button[type=button],[role=tab]:not(a):not(button):not(input),button:not([type]):not(form button)')) return null;
    const names=[caption(link),clean(link.innerText),clean(link.title)].filter(Boolean);
    if(!names.length || names.some(n=>partName(n)!==(tab.parent??selection.part) || /\b(hapus|kirim|simpan|ubah|submit|delete|edit|save)\b/i.test(n)))return null;
    if(tab.parent && link.getAttribute('aria-selected')==='true')return {activated:true};
    link.click(); return {activated:true};
  }
  const targets = sections.filter(x=>x.part===selection.part);
  const selected=targets.find(x=>!targets.some(y=>x!==y && x.el.contains(y.el)))?.el;
  if (!selected) return null;
  const otherParts=sections.filter(s=>s.part!==selection.part && selected.contains(s.el));
  const belongs=el=>!otherParts.some(s=>s.el.contains(el));
  const grids = selected.matches('table') ? [selected] : [...selected.querySelectorAll('table')].filter(el=>visible(el) && belongs(el));
  let rows = [],columns=[],paging='none',zero=false,atStart=false,atEnd=false,range=null,pageNumber=null,filtered=false;
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
    if (heads.length!==1) {
      const filterControls='input,textarea,select,[role=combobox],[role=searchbox],p-columnfilter,p-dropdown,.p-dropdown';
      if(!chained || heads.length!==2 || heads[0].cells.length!==heads[1].cells.length ||
          !heads[1].querySelector(filterControls))return null;
      const walker=document.createTreeWalker(heads[1],NodeFilter.SHOW_TEXT);
      while(walker.nextNode()){
        const text=walker.currentNode;
        if(clean(text.textContent) && visible(text.parentElement) && !text.parentElement.closest(filterControls))return null;
      }
    }
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
    const activePages=pagers.flatMap(pager=>[...pager.querySelectorAll(
      '.p-paginator-page.p-highlight,.p-paginator-page[aria-current=page],[data-pc-section=pagebutton][aria-current=page]')]).filter(visible);
    const activeNumber=activePages.length===1?clean(activePages[0].innerText):'';
    if(/^[1-9]\d*$/.test(activeNumber)&&Number.isSafeInteger(Number(activeNumber)))pageNumber=Number(activeNumber);
    const number='(\\d{1,3}(?:[.,]\\d{3})+|\\d+)';
    const captionPattern=new RegExp('^(?:(?:menampilkan|showing)\\s+)?'+number+
      '\\s*(?:-|–|s\\.d\\.|sampai|to)\\s*'+number+'\\s*(?:dari|of)\\s*'+number+
      '(?:\\s+(?:baris|data|entri|entries|records))?\\.?$','i');
    const positions=zeroLabels.map(el=>captionPattern.exec(clean(el.innerText))).filter(Boolean);
    if(positions.length && positions.every(p=>p.slice(1).join('/')===positions[0].slice(1).join('/'))){
      const [first,last,total]=positions[0].slice(1).map(value=>Number(value.replace(/[.,]/g,'')));
      if(first>=1 && last>=first && last<=total && last-first+1===rows.length && Number.isSafeInteger(total))range={first,last,total};
    }
    const firstByButton=previous.length>0 && previous.every(b=>b.matches(':disabled,[aria-disabled=true],.p-disabled'));
    const consistent=!positions.length || zero || Boolean(range && (paging!=='end' || range.last===range.total) && (paging!=='next' || range.last<range.total) &&
      (!previous.length || firstByButton===(range.first===1)));
    atStart=consistent && !filtered && (zero || (range?range.first===1:firstByButton));
    atEnd=consistent && !filtered && (zero || paging==='end' || paging==='none' && range && range.last===range.total);
    if(request.mode==='advance'){
      if(paging!=='next' || JSON.stringify(columns)!==JSON.stringify(request.columns) ||
          request.position && JSON.stringify([range,pageNumber,filtered])!==JSON.stringify(request.position) ||
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
  return {meta,...basis,part:selection.part,label:selection.label,rows,columns,paging,zero,atStart,atEnd,range,pageNumber,filtered};
}

function matchedDocument(row,wp,period,doc) {
  const item={wp,source:'sptdaftar',page:{Payload:{Data:[row]}}};
  const match=planSptDetails({wp,period,types:[doc.type],items:[item],strictReceipts:true}).documents[0];
  return matchSptVersions(match,doc);
}
const wait = ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function sptNavigation({ext,wp,period,doc,allowLinkedReturn=false,onLoading=()=>{}}) {
  const site='https://coretax.intranet.pajak.go.id';
  const pins=new Map();
  const linkedRow=allowLinkedReturn && linkedSptTypes.has(doc.type) && Boolean(doc.linkedRow);
  const canFollow=allowLinkedReturn && (doc.receipt || linkedRow);
  const matchesIndex=row=>linkedRow?submittedRowKey(row)===doc.linkedRow:Boolean(matchedDocument(row,wp,period,doc));
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
      if (!canFollow || meta['jenis spt']!==doc.type) return null;
      if(linkedRow){
        const context=sptListContext(meta),recordId=view.linkedRecordId;
        return recordId && (!doc.recordId||recordId===doc.recordId) && !context.typeConflict && !context.revisionConflict &&
          context.period?.label===doc.period && context.revision===doc.revision?{...doc,recordId}:null;
      }
      return matchedDocument({...meta,'nomor bukti penerimaan':doc.receipt},wp,period,doc);
    }
    return matchedDocument(meta,wp,period,doc);
  }
  async function inspect(tabId,linkedIndex) {
    let view;
    try {
      const url=(await ext.tabs.get(tabId)).url;
      const pin={expectedUrl:url,...(linkedIndex?{linkedIndex,linkedType:doc.type,linkedRevision:doc.revision,
        ...(doc.recordId?{linkedRecordId:doc.recordId}:{}),linkedRow}:{})};
      if (pins.has(tabId) && pins.get(tabId).expectedUrl!==url) return null;
      view=await execute(tabId,readSptView,{...pin,checkLoading:Boolean(linkedIndex)});
      if(view?.loading)return view;
      if (!verified(view)) return null;
      pins.set(tabId,{...pins.get(tabId),...pin,...(view.identityBasis?{linkedReturnOpened:true}:{}),
        ...(view.linkedRecordId?{linkedRecordId:view.linkedRecordId}:{})});
      return {tabId,...view};
    } catch { return null; }
  }
  async function open(tabId,checkpoint=()=>{}) {
    const tab=await ext.tabs.get(tabId);
    const index=(await execute(tabId,visibleTables,null)).filter(t=>t.indexSource==='sptdaftar');
    if(index.length!==1) throw Error('Pilih tab dengan satu daftar SPT Dilaporkan yang sedang terbuka.');
    const options={...index[0],url:tab.url,scope:{wp,source:'sptdaftar',manual:true}};
    const read=await execute(tabId,visibleTables,options);
    const matches=(read?.rows || []).filter(matchesIndex);
    if(!read?.indexScope || matches.length!==1) throw Error('WP dan versi SPT harus cocok dengan satu baris di halaman daftar yang terlihat.');
    const previous=new Set((await ext.tabs.query({url:site+'/*'})).map(t=>t.id));
    pins.delete(tabId);
    unverifiedLink=null;
    const opened=await execute(tabId,visibleTables,{...options,openSpt:index[0].labels.map(k=>matches[0][k])});
    if (!opened?.opened) throw Error(opened?.skip || 'Tindakan lihat pada baris SPT belum tersedia.');
    const start=Date.now();
    while (Date.now()-start<120000) {
      await wait(200);await checkpoint();
      const tabs=(await ext.tabs.query({url:site+'/*'})).filter(t=>t.id===tabId ||
        (!previous.has(t.id) && (t.openerTabId===tabId || (opened.target && t.url===opened.target))));
      const changed=tabs.find(t=>t.id===tabId && t.url!==tab.url);
      if (canFollow && changed) {
        if (unverifiedLink && unverifiedLink.expectedUrl!==changed.url) throw changedIdentity();
        const canReopen=opened.target ? changed.url===opened.target : changed.url.startsWith(site+'/returnsheets/id-ID/');
        unverifiedLink={tabId,linkedIndex:tab.url,linkedType:doc.type,expectedUrl:changed.url,canReopen};
      }
      const inspected=await Promise.all(tabs.map(t=>inspect(t.id,
        (canFollow && t.id===tabId && t.url!==tab.url) ? tab.url : null)));
      const views=inspected.filter(view=>view && !view.loading);
      if (views.length===1) {unverifiedLink=null;return views[0];}
      if (views.length>1) break;
      if (inspected.some(view=>view?.loading)) onLoading(Math.max(0,120000-(Date.now()-start)));
      else if(Date.now()-start>=4000)break;
    }
    throw Error('Tampilan sudah dibuka. WP, jenis, masa, pembetulan, dan nomor dokumen belum dapat dicocokkan pada satu tampilan.');
  }
  const editedForm=tabId=>Object.assign(Error('Isian pada formulir berubah. Tab dibiarkan terbuka untuk diperiksa.'),
    {code:'SCOPE',keepTabId:tabId});
  async function recoverIndex(tabId,indexUrl,{allowFreshIndex=false}={}) {
    if (!unverifiedLink || unverifiedLink.tabId!==tabId || unverifiedLink.linkedIndex!==indexUrl) return false;
    const link=unverifiedLink;
    unverifiedLink=null;
    const result=await execute(tabId,readSptView,{...link,returnUnmatched:true,allowFreshIndex:allowFreshIndex&&link.canReopen});
    if(result?.edited)throw editedForm(tabId);
    if(result?.reopen)return {tabId,expectedUrl:link.expectedUrl};
    return Boolean(result?.returning);
  }
  const changedIdentity=result=>Object.assign(Error(result?.loading
    ?'Identitas pada formulir SPT belum terbaca dalam 2 menit.'
    :'Identitas WP atau dokumen berubah. Pilih kembali versi SPT.'),{code:result?.loading?'SPT_LOAD_TIMEOUT':'IDENTITY'});
  async function readCurrent(view,checkpoint,options={}){
    const checkLoading=Boolean(allowLinkedReturn && view.identityBasis);
    const deadline=Date.now()+120000;
    for(;;){
      const current=await execute(view.tabId,readSptView,{...options,expected:view.meta,checkLoading});
      if(!checkLoading || !current?.loading || current.identityChanged || Date.now()>=deadline)return current;
      onLoading(deadline-Date.now());
      await wait(150);await checkpoint();
    }
  }
  async function currentView(view,checkpoint){
    const current=await readCurrent(view,checkpoint);
    if(current?.identityChanged || !verified(current))throw changedIdentity(current);
    return current;
  }
  async function capture(view,part,checkpoint=()=>{}) {
    const args={part,expected:view.meta};
    const current=await currentView(view,checkpoint);
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
        const recordId=match.recordId || doc.recordId;
        const localId=allowLinkedReturn && doc.receipt && !verified(view)?.recordId
          ? 'cuplikan-'+await sha256(JSON.stringify([wp,doc.key,doc.receipt])) : '';
        return {...result,recordId,localId,receipt:match.receipt || doc.receipt};
      }
      await wait(150);
    }
    throw Error('Bagian belum terbaca sebagai satu tabel atau satu formulir yang jelas. Periksa identitas dan tampilan sumber.');
  }
  const pageFingerprint=result=>JSON.stringify(result.rows.map(row=>result.columns.map(column=>row[column])));
  const pagePosition=result=>[result.range,result.pageNumber,result.filtered];
  async function clickNext(view,args,result,position){
    const clicked=await execute(view.tabId,readSptView,{...args,mode:'advance',columns:result.columns,
      before:pageFingerprint(result),position});
    if(clicked?.identityChanged)throw changedIdentity();
    return clicked?.advanced===true;
  }
  async function advanceWorkingPage(view,args,result,checkpoint,checkPage){
    const position=pagePosition(result),proof={recordId:result.recordId,localId:result.localId,receipt:result.receipt};
    for(let attempt=0;attempt<3;attempt++){
      await checkpoint();
      checkPage(result);
      if(await clickNext(view,args,result,position))return result;
      if(attempt===2)break;
      await wait(200);await checkpoint();
      const refreshed=await execute(view.tabId,readSptView,args);
      if(refreshed?.identityChanged||refreshed?.meta&&!verified(refreshed))throw changedIdentity();
      if(refreshed?.rows && verified(refreshed) && refreshed.paging==='next' && JSON.stringify(pagePosition(refreshed))===JSON.stringify(position))
        result={...refreshed,...proof};
    }
    throw Error('Tabel atau tombol berikutnya berubah sebelum dibuka.');
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
        let current=await currentView(view,checkpoint);
        discover(current);
        if(doc.parts?.some(p=>!skipParts.has(p.name) && !discovered.has(p.name)) && current.sections.some(p=>p.part===section.part && !p.visible)){
          const activation=await execute(view.tabId,readSptView,{part:section.part,expected:view.meta,mode:'activate'});
          if(activation?.identityChanged)throw changedIdentity();
          if(activation?.activated){
            for(let attempt=0;attempt<10;attempt++){
              await checkpoint();current=await currentView(view,checkpoint);
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
        const args={part:section.part,expected:view.meta};
        for(let page=1;;page++){
          await checkpoint();
          await currentView(view,checkpoint);
          const checkPage=candidate=>{
            if(shape!==JSON.stringify(candidate.columns)||seen.has(pageFingerprint(candidate)))throw Error('Kolom berubah atau halaman berulang.');
            if(candidate.zero && page>1)throw Error('Total berubah menjadi nol setelah halaman berisi.');
          };
          const workPage=allowLinkedReturn && view.identityBasis && (result.range || result.pageNumber);
          const advanceBeforeSave=workPage && result.paging==='next' && page<limit;
          if(advanceBeforeSave)result=await advanceWorkingPage(view,args,result,checkpoint,checkPage);
          else checkPage(result);
          const fingerprint=pageFingerprint(result);
          seen.add(fingerprint);
          await onPage({...result,pass,page});
          if(result.paging==='unclear')throw Error('Kontrol halaman berikutnya belum dapat dipastikan.');
          if(result.paging!=='next'){
            if(result.atEnd){
              await currentView(view,checkpoint);
              onCovered(pass);
            }
            break;
          }
          if(page>=limit)throw Error('Batas halaman tercapai saat masih ada halaman berikutnya.');
          await checkpoint();
          if(!advanceBeforeSave && !await clickNext(view,args,result))throw Error('Tabel atau tombol berikutnya berubah sebelum dibuka.');
          let next;
          const start=Date.now(),waitLimit=workPage?120000:3000;
          while(Date.now()-start<waitLimit){
            await wait(125);await checkpoint();
            if(workPage && Date.now()-start>=2000)onLoading(Math.max(0,waitLimit-(Date.now()-start)));
            const candidate=await execute(view.tabId,readSptView,args);
            if(candidate?.identityChanged)throw changedIdentity();
            if(!candidate?.rows || !verified(candidate))continue;
            if(JSON.stringify(candidate.columns)!==shape)throw Error('Kolom sumber berubah sesudah pindah halaman.');
            if(workPage && (candidate.filtered!==result.filtered ||
                result.pageNumber && candidate.pageNumber!==result.pageNumber+1 ||
                result.range && (!candidate.range || candidate.range.total!==result.range.total ||
                  candidate.range.first!==result.range.last+1)))continue;
            if(pageFingerprint(candidate)!==fingerprint){next=candidate;break;}
          }
          if(!next)throw Error('Halaman berikut belum berubah atau data berulang.');
          if((result.range || next.range) && (!result.range || !next.range || result.range.total!==next.range.total || next.range.first!==result.range.last+1))
            throw Error('Urutan atau total baris pada penanda halaman berubah.');
          result={...next,recordId:result.recordId,localId:result.localId,receipt:result.receipt};
        }
      } catch(error){
        if(['IDENTITY','STOP','SCOPE','SPT_LOAD_TIMEOUT'].includes(error.code))throw error;
        await currentView(view,checkpoint);
        onIssue(section,error);
      }
      discover(await currentView(view,checkpoint));
    }
    for(const part of doc.parts||[])if(!skipParts.has(part.name) && !discovered.has(part.name))
      onIssue({part:part.name,label:part.name.toUpperCase()},Error('Bagian yang diperlukan belum ditemukan pada tampilan ini.'));
    if(unresolved)onIssue({label:'Tampilan sumber'},Error(unresolved+' bagian berlabel belum bisa dicocokkan ke satu panel.'));
  }
  async function returnToIndex(view,indexUrl,indexTabId,checkpoint=()=>{},timedOut=false){
    const closeOpened=view.tabId!==indexTabId;
    let result;
    try{
      if(timedOut && allowLinkedReturn && !closeOpened && pins.get(view.tabId)?.linkedIndex===indexUrl){
        await checkpoint();
        result=await execute(view.tabId,readSptView,{returnUnmatched:true});
      }else result=await readCurrent(view,checkpoint,{returnIndex:indexUrl,closeOpened});
    }
    catch(error){
      if(!closeOpened)throw error;
      try{await ext.tabs.get(view.tabId);}catch{return;}
      throw error;
    }
    if(result?.edited)throw editedForm(view.tabId);
    if(!result?.returning)throw changedIdentity(result);
  }
  return {open,inspect,capture,collect,returnToIndex,recoverIndex,matches:matchesIndex};
}
