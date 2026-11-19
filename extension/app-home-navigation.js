import {normalizeId,visibleTables} from './app-data.js';

const origin = 'https://coretax.intranet.pajak.go.id';
const homePath = /^\/home\/id-ID\/?$/;
const searchPath = '/returnsheets/id-ID/taxpayer-search';
const listPath = /^\/returnsheets\/id-ID\/submitted-returnsheets\/[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\/?$/i;

function localPath(url) {
  try {
    const parsed = new URL(url);
    if (parsed.origin === origin && !parsed.username && !parsed.password) return parsed.pathname;
  } catch {}
  return '';
}

// Chrome injects this function into the working tab. Keep the menu action
// separate from entering an identifier on the taxpayer-search screen.
export function readHomeMenu(expand = false) {
  if (location.origin !== 'https://coretax.intranet.pajak.go.id' || !/^\/home\/id-ID\/?$/.test(location.pathname)) return null;
  const visible = el => el.getClientRects().length > 0 && el.checkVisibility({visibilityProperty:true,opacityProperty:true});
  const label = el => (el.getAttribute('aria-label') ||
    (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id=>document.getElementById(id)?.textContent).filter(Boolean).join(' ') ||
    el.innerText || el.title || '').replace(/\s+/g,' ').trim();
  const links = [...document.querySelectorAll('a[href]')].filter(a =>
    visible(a) && label(a) === 'SPT per Wajib Pajak' && a.origin === location.origin && !a.username && !a.password &&
    a.pathname === '/returnsheets/id-ID/taxpayer-search' && !a.search && !a.hash);
  if (links.length) return {url:links[0].href};
  const controls = [...document.querySelectorAll('button,[role=button],a[aria-haspopup]')].filter(el =>
    visible(el) && label(el) === 'SPT' && !el.matches(':disabled,[aria-disabled=true]') &&
    (!el.matches('a[href]') || el.getAttribute('href') === '#'));
  const menuButtons = controls.filter(el=>el.matches('button'));
  const targets = menuButtons.length ? menuButtons : controls;
  if (targets.length === 1) {
    if (expand && targets[0].getAttribute('aria-expanded') !== 'true') targets[0].click();
    return {hasMenu:true};
  }
  return null;
}

// Runs only in the normal SPT taxpayer-search page. Returning a match never
// exposes the other rows or their identifiers to the extension.
export function searchTaxpayer({wp,step}) {
  if (location.origin !== 'https://coretax.intranet.pajak.go.id' || location.pathname !== '/returnsheets/id-ID/taxpayer-search') return null;
  const visible = el => el.getClientRects().length > 0 && el.checkVisibility({visibilityProperty:true,opacityProperty:true});
  const clean = text => String(text || '').replace(/\s+/g,' ').trim();
  const normalize = text => {
    const value = clean(text).replace(/[.\s-]/g,'');
    return /^\d{15,16}$/.test(value) ? value.padStart(16,'0') : '';
  };
  if (!/^\d{16}$/.test(wp)) return null;
  const fields = [...document.querySelectorAll('input')].filter(el =>
    ['text','search','tel'].includes(el.type) && visible(el) && !el.disabled && !el.readOnly &&
    (el.id === 'ObjectPermitNumber' || [el.getAttribute('aria-label'),el.placeholder,...[...el.labels].map(l=>l.innerText)]
      .some(s=>clean(s) === 'Cari Wajib Pajak berdasarkan NIK/NPWP')));
  if (fields.length !== 1) return null;
  const field = fields[0];
  if (step === 'enter') {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,wp);
    field.dispatchEvent(new Event('input',{bubbles:true}));
    field.dispatchEvent(new Event('change',{bubbles:true}));
    return {entered:true};
  }
  if (step !== 'select' || normalize(field.value) !== wp) return null;
  const matching = [];
  for (const table of [...document.querySelectorAll('table,[role=table],[role=grid]')].filter(visible)) {
    const rows = [...table.querySelectorAll('tr,[role=row]')].filter(row =>
      visible(row) && row.closest('table,[role=table],[role=grid]') === table);
    const heads = rows.map(row=>[...row.querySelectorAll(':scope > th,:scope > [role=columnheader]')])
      .filter(cells=>cells.length && cells.some(cell=>clean(cell.innerText) === 'NPWP/NIK'));
    if (heads.length !== 1) continue;
    const positions = heads[0].map((cell,i)=>clean(cell.innerText) === 'NPWP/NIK' ? i : -1).filter(i=>i>=0);
    if (positions.length !== 1) continue;
    for (const row of rows) {
      const cells = row.querySelectorAll(':scope > td,:scope > [role=cell],:scope > [role=gridcell]');
      if (normalize(cells[positions[0]]?.innerText) === wp) matching.push(row);
    }
  }
  if (matching.length > 1) return {error:'Coretax menampilkan beberapa baris dengan NPWP yang sama. Penarikan dihentikan.'};
  if (!matching.length) return null;
  const controls = [...matching[0].querySelectorAll('button,[role=button]')].filter(el =>
    visible(el) && clean(el.getAttribute('aria-label') ||
      (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id=>document.getElementById(id)?.textContent).filter(Boolean).join(' ') ||
      clean(el.innerText) || el.title) === 'Pilih' && !el.matches(':disabled,[aria-disabled=true]'));
  if (controls.length !== 1) return null;
  controls[0].click();
  return {selected:true};
}

export function submittedLink() {
  const match = /^\/returnsheets\/id-ID\/not-submitted-returnsheets\/([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})\/?$/i.exec(location.pathname);
  if (location.origin !== 'https://coretax.intranet.pajak.go.id' || !match) return null;
  const allowed = '/returnsheets/id-ID/submitted-returnsheets/' + match[1];
  const links = [...document.querySelectorAll('a[href]')].filter(a =>
    a.getClientRects().length && a.checkVisibility({visibilityProperty:true,opacityProperty:true}) &&
    a.innerText.trim() === 'SPT Dilaporkan' && a.origin === location.origin &&
    a.pathname.replace(/\/$/,'') === allowed && !a.search && !a.hash && !a.username && !a.password);
  return links.length ? {url:links[0].href} : null;
}

export async function openHomeModule({ext,homeTab,wp,module='spt',checkpoint=()=>{},onTab}) {
  if (module !== 'spt') throw Error('Modul awal penarikan adalah SPT per Wajib Pajak.');
  const owner = normalizeId(wp);
  if (!owner || !homeTab || !homePath.test(localPath(homeTab.url))) throw Error('Buka beranda Coretax, login, dan isi satu NPWP.');
  await checkpoint();
  const original = await ext.tabs.get(homeTab.id);
  if (!homePath.test(localPath(original.url))) throw Error('Tab beranda sudah berpindah. Buka kembali beranda Coretax.');
  const work = await ext.tabs.create({url:origin + '/home/id-ID/',active:false,
    ...(Number.isInteger(original.windowId)?{windowId:original.windowId}:{})});
  await onTab?.(work.id);
  const read = async(func,...args) => {
    const [frame] = await ext.scripting.executeScript({target:{tabId:work.id},func,args});
    return frame?.result;
  };
  async function waitFor(test,message) {
    const until = Date.now() + 25000;
    do {
      await checkpoint();
      const tab = await ext.tabs.get(work.id);
      let value;
      // A new Coretax tab can briefly redirect while restoring its session.
      if (localPath(tab.url)) {
        try { value = await test(tab); }
        catch (error) {
          if (/showing error page/i.test(error.message)) throw Error('Coretax tidak dapat dijangkau. Periksa koneksi intranet dan sesi login.');
          if (!/frame.*(?:removed|navigat)|document.*(?:unloaded|navigat)|cannot access|no frame with id/i.test(error.message)) throw error;
        }
      }
      if (value?.error) throw Error(value.error);
      if (value) return value;
      await new Promise(resolve=>setTimeout(resolve,250));
    } while (Date.now() < until);
    throw Error(message);
  }
  const menu = await waitFor(tab=>homePath.test(localPath(tab.url)) && read(readHomeMenu,true),
    'Menu SPT belum tersedia di beranda. Pastikan sesi Coretax masih aktif.');
  const search = menu.url ? menu : await waitFor(async()=>{
    const view=await read(readHomeMenu,false);
    return view?.url ? view : null;
  },'Tautan SPT per Wajib Pajak belum tersedia di menu SPT.');
  if (localPath(search.url) !== searchPath) throw Error('Alamat pencarian Wajib Pajak belum dapat dipastikan.');
  await checkpoint();
  await ext.tabs.update(work.id,{url:search.url});
  await waitFor(tab=>localPath(tab.url) === searchPath && read(searchTaxpayer,{wp:owner,step:'enter'}),
    'Kolom pencarian NIK/NPWP belum tersedia di Coretax.');
  await waitFor(tab=>localPath(tab.url) === searchPath && read(searchTaxpayer,{wp:owner,step:'select'}),
    'Coretax belum menampilkan satu hasil dengan NPWP yang diminta.');
  const target = await waitFor(async tab => listPath.test(localPath(tab.url)) ? {url:tab.url} : read(submittedLink),
    'Tautan SPT Dilaporkan untuk WP terpilih belum tersedia.');
  if (!listPath.test(localPath(target.url))) throw Error('Alamat daftar SPT untuk WP terpilih belum dapat dipastikan.');
  await checkpoint();
  if ((await ext.tabs.get(work.id)).url !== target.url) await ext.tabs.update(work.id,{url:target.url});
  return waitFor(async tab => {
    if (tab.url !== target.url) return null;
    const result = await read(visibleTables,{discoverSubmitted:true,wp:owner,url:target.url});
    return result?.match ? {tabId:work.id,url:tab.url} : null;
  },'Identitas WP dan tabel SPT Dilaporkan belum cocok dengan penugasan.');
}
