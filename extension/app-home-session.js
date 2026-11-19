// Runs inside the authenticated home page. Only the display name and a
// fingerprint leave the page. The account identifier and role stay in the tab.
export async function readAccountBadge() {
  if (location.origin !== 'https://coretax.intranet.pajak.go.id' || !/^\/home\/id-ID\/?$/.test(location.pathname)) return null;
  const visible = el => el && el.getClientRects().length > 0 && el.checkVisibility({visibilityProperty:true,opacityProperty:true});
  const clean = text => (text || '').normalize('NFKC').replace(/\s+/g,' ').trim();
  const accounts = new Map();
  for (const button of document.querySelectorAll('button.tw-profilebtn-wide[title]')) {
    if (!visible(button)) continue;
    const id = button.querySelector('.tw-profile-text > .tw-profile-npwp');
    const name = button.querySelector('.tw-profile-text > .tw-profile-name');
    if (!visible(id) || !visible(name)) continue;
    const account = clean(id.innerText),display = clean(name.innerText);
    if (!account || !display) continue;
    const chip = button.querySelector('.tw-profile-imp-chip') || (button.nextElementSibling?.matches('.tw-profile-imp-chip') ? button.nextElementSibling : null);
    const role = visible(chip) ? clean(chip.innerText) : '';
    accounts.set(JSON.stringify(['home-account-v1',account.toLowerCase(),role.toLowerCase()]),display);
  }
  if (accounts.size > 1) return {ambiguous:true};
  if (!accounts.size) return null;
  const [[key,name]] = accounts;
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)));
  const fingerprint = Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  return {name,fingerprint};
}

export async function readHomeAccount(ext,homeTabId) {
  if (!ext || !Number.isInteger(homeTabId)) return null;
  let frame;
  try {
    [frame] = await ext.scripting.executeScript({target:{tabId:homeTabId},func:readAccountBadge});
  } catch { return null; }
  if (frame?.result?.ambiguous) throw Error('Beranda menampilkan lebih dari satu akun Coretax. Buka beranda dengan akun penugasan.');
  return frame?.result ?? null;
}

export async function watchHomeAccount({ext,homeTabId,expectedFingerprint}) {
  const session = {name:'',fingerprint:expectedFingerprint || '',checkpoint};
  let lastCheck = -Infinity, pending = null, failure = null;
  async function refresh() {
    const current = await readHomeAccount(ext,homeTabId);
    if (session.fingerprint && current?.fingerprint !== session.fingerprint) {
      const message = current ? 'Akun atau peran Coretax telah berubah. Untuk melanjutkan, gunakan akun dan peran awal.'
        : 'Akun pada beranda Coretax tidak terbaca. Buka kembali beranda dengan akun awal untuk melanjutkan.';
      throw Object.assign(Error(message),{code:'HOME_ACCOUNT'});
    }
    if (current) {
      session.name = current.name;
      session.fingerprint = current.fingerprint;
    }
    lastCheck = performance.now();
  }
  async function checkpoint(force = false) {
    if (failure) throw failure;
    if (pending) return pending;
    if (!force && performance.now() - lastCheck < 3000) return;
    pending = refresh().catch(error=>{ failure=error; throw error; }).finally(()=>{ pending=null; });
    return pending;
  }
  await checkpoint(true);
  return session;
}
