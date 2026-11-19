import assert from 'node:assert/strict';
import {home,launchHomeFixture} from './scraper-home-fixture.mjs';

const badge = '<button class="tw-profilebtn-wide" title="Profil akun"><span class="tw-profile-text">'+
  '<span class="tw-profile-npwp">AKUN-UJI-A</span><span class="tw-profile-name">Petugas Simulasi</span></span>'+
  '<span class="tw-profile-imp-chip">Definitif</span></button>';
const {ctx,close,routes} = await launchHomeFixture();
try {
  routes.set(home,routes.get(home)+badge);
  const source = await ctx.newPage();
  await source.goto(home);
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const app = await ctx.newPage();
  await app.goto(new URL('/app.html',worker.url()).href);
  const baseline = await app.evaluate(async home=>{
    const {readHomeAccount,watchHomeAccount} = await import('./app-home-session.js');
    const [tab] = await chrome.tabs.query({url:home});
    const state={calls:0};
    const ext={scripting:{executeScript:request=>{state.calls++;return chrome.scripting.executeScript(request);}}};
    state.read=()=>readHomeAccount(ext,tab.id);
    state.watch=expectedFingerprint=>watchHomeAccount({ext,homeTabId:tab.id,expectedFingerprint});
    const session=await state.watch();
    await Promise.all([session.checkpoint(),session.checkpoint()]);
    const cachedCalls=state.calls;
    await Promise.all([session.checkpoint(true),session.checkpoint(true)]);
    state.session=session;
    window.testSession=state;
    return {badge:await state.read(),name:session.name,cachedCalls,forcedCalls:state.calls-1};
  },home);
  assert.deepEqual(Object.keys(baseline.badge).sort(),['fingerprint','name']);
  assert.equal(baseline.name,'Petugas Simulasi');
  assert.equal(baseline.badge.name,baseline.name);
  assert.match(baseline.badge.fingerprint,/^[\da-f]{64}$/);
  assert.equal(baseline.cachedCalls,1);
  assert.equal(baseline.forcedCalls,2);
  const check=()=>app.evaluate(()=>testSession.session.checkpoint(true));
  const resume=fp=>app.evaluate(async fingerprint=>{
    testSession.session=await testSession.watch(fingerprint);
    return testSession.session.name;
  },fp);
  const role=source.locator('.tw-profile-imp-chip'),id=source.locator('.tw-profile-npwp');
  await role.evaluate(el=>el.textContent='Peran simulasi lain');
  await assert.rejects(check,/Akun atau peran Coretax telah berubah/);
  await assert.rejects(()=>resume(baseline.badge.fingerprint),/Akun atau peran Coretax telah berubah/);
  await role.evaluate(el=>el.textContent='Definitif');
  assert.equal(await resume(baseline.badge.fingerprint),baseline.name);
  await source.locator('.tw-profilebtn-wide').evaluate(el=>{
    el.hidden=true;
    setTimeout(()=>el.hidden=false,600);
  });
  await check();
  assert.equal(await app.evaluate(()=>testSession.session.fingerprint),baseline.badge.fingerprint);
  await id.evaluate(el=>el.textContent='AKUN-UJI-B');
  await assert.rejects(check,/Akun atau peran Coretax telah berubah/);
  await source.locator('.tw-profilebtn-wide').evaluate(el=>el.hidden=true);
  await assert.rejects(()=>resume(baseline.badge.fingerprint),/tidak terbaca/);
  assert.equal(await resume(null),'');
  assert.equal(await app.evaluate(()=>testSession.read()),null);
  await id.evaluate(el=>el.textContent='AKUN-UJI-A');
  await source.locator('.tw-profilebtn-wide').evaluate(el=>el.hidden=false);
  await check();
  assert.equal(await app.evaluate(()=>testSession.session.fingerprint),baseline.badge.fingerprint);
  await source.locator('.tw-profilebtn-wide').evaluate(el=>{
    const duplicate=el.cloneNode(true);
    duplicate.querySelector('.tw-profile-npwp').textContent='AKUN-UJI-C';
    el.after(duplicate);
  });
  await assert.rejects(check,/lebih dari satu akun/);
  console.log('Nama akun terbaca. Perubahan akun atau peran dan identitas ganda terdeteksi. Lanjutan memeriksa sidik akun awal. Sumber tanpa nama mendukung pengisian manual.');
} finally { await close(); }
