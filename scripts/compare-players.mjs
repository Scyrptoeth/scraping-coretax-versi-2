// Read both installed extensions through their visible interfaces in separate offline profiles.
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {decodeText,readZip} from '../extension/archive/zip.js';

const {values}=parseArgs({options:{zip:{type:'string'},studio:{type:'string'},player:{type:'string',default:'extension'},
  role:{type:'string',default:'Pemeriksa'},out:{type:'string'},candidate:{type:'string'},years:{type:'string'}}});
if(!values.zip||!values.studio||!values.out)throw Error('Isi --zip BERKAS, --studio FOLDER dan --out LAPORAN_BARU.json. Pilihan lain: --player FOLDER, --role PERAN, --candidate ZIP dan --years 2023,2024,2025.');
const years=(values.years||'').split(',').filter(Boolean);
if(years.some(year=>!/^\d{4}$/.test(year))||new Set(years).size!==years.length)throw Error('Isi --years dengan tahun berbeda yang dipisahkan koma.');
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const bytes=await readFile(values.zip),menus=['Muat paket','Dasbor','Probis','Profil WP','SPT','Kertas Kerja','Peraturan','Data mentah','Bantuan'];
const temp=await mkdtemp(join(tmpdir(),'compare-local-players-'));

function tableKey(name){
  const text=name.toLocaleLowerCase('id').replace(/\bcoretax\b|tanpa duplikat|\bflag\b/g,'').replaceAll('&',' dan ')
    .replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
  if(/^buku besar total menurut$|^total buku besar per periode$/.test(text))return 'buku besar total';
  if(/^buku besar saldo seluruh periode menurut$|^saldo buku besar seluruh periode$/.test(text))return 'buku besar saldo';
  if(/^objek (?:tanah dan bangunan|pajak) pbb$/.test(text))return 'objek pbb';
  if(text==='klu utama dan tambahan'||text==='klasifikasi lapangan usaha')return 'klu';
  return text.replace(/^pph badan\b/,'badan').replace(/^pph orang pribadi\b/,'op')
    .replace(/^pph 21 26\b/,'pph2126').replace(/^pph unifikasi\b/,'unifikasi')
    .replace(/\binduk (?:angka )?per masa (?:dan )?versi$/,'induk').replace(/ di$/,'');
}
async function download(page,button){
  const [file]=await Promise.all([page.waitForEvent('download'),button.click()]);
  const entries=await readZip(await readFile(await file.path()));
  if([...entries.values()].some(entry=>!entry.crcOk))throw Error('Ada bagian ekspor yang gagal diperiksa.');
  return {name:file.suggestedFilename(),entries};
}
const part=(file,name)=>file.entries.has(name)?decodeText(file.entries.get(name).data):'';
const countMatches=(text,re)=>(text.match(re)||[]).length;

function workbookEvidence(file){
  const workbook=part(file,'xl/workbook.xml');
  if(!workbook||!part(file,'xl/_rels/workbook.xml.rels'))throw Error('Berkas Excel tidak memiliki bagian workbook.');
  const sheets=[...file.entries.keys()].filter(name=>/^xl\/worksheets\/sheet\d+\.xml$/.test(name)).map(name=>part(file,name));
  return {sheets:sheets.length,formulas:sheets.reduce((n,xml)=>n+countMatches(xml,/<f(?:\s[^>]*)?>/g),0),
    formulaErrors:sheets.reduce((n,xml)=>n+countMatches(xml,/<c\b[^>]*\bt="e"/g),0),
    sheetLinks:sheets.reduce((n,xml)=>n+countMatches(xml,/<hyperlink\b/g),0)};
}
function documentEvidence(doc,companion){
  const document=part(doc,'word/document.xml'),rels=part(doc,'word/_rels/document.xml.rels');
  if(!document)throw Error('Berkas Word tidak memiliki isi dokumen.');
  const workbook=part(companion,'xl/workbook.xml');
  const localTargets=[...rels.matchAll(/\bTarget="([^"#]+\.xlsx)#([^"#]+)"/gi)];
  return {links:countMatches(document,/<w:hyperlink\b/g),workbookLinks:localTargets.length,
    resolvedWorkbookLinks:localTargets.filter(([,file,anchor])=>
      decodeURIComponent(file)===companion.name&&workbook.includes('name="'+anchor+'"')).length};
}

async function dashboardCoverage(page){
  const heading=page.getByText('Perhitungan dan sumber indikator',{exact:true});
  if(!await heading.count())return [];
  await heading.click();
  return page.getByRole('table',{name:'Sumber indikator dasbor',exact:true}).locator('tbody tr').evaluateAll(rows=>rows.map(row=>{
    const cells=[...row.cells].map(cell=>cell.textContent.trim());
    const count=/^(\d+) dari (\d+) masa yang tercatat/u.exec(cells[3]);
    const scope=['Belum dapat dihitung','Data sebagian','Sesuai cakupan paket'].includes(cells[2])?cells[2]:null;
    return {indicator:cells[0],scope,months:count?[Number(count[1]),Number(count[2])]:null};
  }));
}

async function paymentProfile(page,nav){
  await nav.getByRole('button',{name:/^Profil WP/}).click();
  const payments=page.getByRole('button',{name:/^Rincian pembayaran \(\d+\)$/});
  const count=Number(/\((\d+)\)/.exec(await payments.innerText())[1]);
  await payments.click();
  await page.getByRole('heading',{name:'Rincian pembayaran',exact:true}).waitFor();
  if(!count)return {count,sampleDates:0,localizedDates:0};
  return page.getByRole('table',{name:'Rincian pembayaran',exact:true}).evaluate((table,count)=>{
    const names=[...table.querySelectorAll('th')].map(th=>th.textContent.trim());
    const columns=names.flatMap((name,i)=>/^Tanggal (?:pembukuan|posting|transaksi)$/i.test(name)?[i]:[]);
    const dates=[...table.tBodies[0].rows].flatMap(row=>columns.map(i=>row.cells[i]?.textContent.trim()).filter(text=>text&&text!=='—'));
    const local=/^\d{1,2} (?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember) \d{4}(?: · .+)?$/;
    return {count,sampleDates:dates.length,localizedDates:dates.filter(text=>local.test(text)).length};
  },count);
}

async function inspectYears(page,nav,studio){
  const open=async menu=>{
    const name=new RegExp('^'+menu);
    await nav.getByRole('button',{name}).click();
    await nav.locator('[aria-current="page"],[aria-selected="true"]').filter({hasText:name}).first().waitFor();
  };
  const button=name=>page.getByRole('button',{name,exact:true});
  const yearOptions=()=>page.getByRole('combobox',{name:'Tahun pajak',exact:true});
  const selectYear=async(year,section)=>{
    if(studio)await page.locator(section+' [data-y="'+year+'"]:visible').first().click();
    else await yearOptions().selectOption(year);
  };
  const evidence={};
  for(const year of years){
    await open('Dasbor');
    await selectYear(year,'#v-ringkas');
    const dashboard=await page.locator(studio?'.d1-kpi:visible':'#screen .kpi:visible').evaluateAll((cards,isStudio)=>cards.map(card=>[
      card.querySelector(isStudio?'.d1-l':'small')?.textContent.trim(),
      card.querySelector(isStudio?'.d1-n':'b')?.textContent.trim()
    ]),studio);
    const coverage=studio?undefined:await dashboardCoverage(page);
    await open('SPT');
    const visibleCount=async()=>{
      if(studio)return page.locator('.dsp-t tbody tr').count();
      const count=page.getByRole('group',{name:'Filter tahun pajak SPT'}).locator('button[aria-pressed="true"] .spt-count');
      return Number((await count.innerText()).replaceAll('.',''));
    };
    const last=studio?page.locator('[data-t="last"]'):page.getByRole('checkbox',{name:'Versi terakhir',exact:true});
    let spt=null;
    if(await last.count()){
      if(studio){
        const yearButton=page.locator('[data-g="tahun"][data-v="'+year+'"]');
        if(await yearButton.getAttribute('aria-pressed')!=='true')await yearButton.click();
        if(await last.getAttribute('aria-pressed')!=='true')await last.click();
      }else{
        await selectYear(year);
        await last.setChecked(true);
      }
      const latest=await visibleCount();
      if(studio)await last.click();else await last.setChecked(false);
      spt={latest,allVersions:await visibleCount()};
      if(studio)await last.click();else await last.setChecked(true);
    }
    await open('Kertas Kerja');
    const kkpTab=studio?page.getByRole('tab',{name:/format SE-08/}):button('KKP');
    await kkpTab.click();
    await (studio?page.getByRole('tab',{name:/format SE-08/,selected:true}):
      page.getByRole('button',{name:'KKP',exact:true,pressed:true})).waitFor();
    await selectYear(year,'#v-kerja');
    const exportKkp=studio?page.locator('#kXlLengkap'):button('Excel semua KKP');
    const indices=studio?await page.locator('.kkplist [data-ref]').evaluateAll(items=>items.map(item=>item.dataset.ref)
      .filter(ref=>!['SIM','TS','JD','TL','TI','DOK'].includes(ref))):
      await page.getByRole('combobox',{name:'Pilih indeks KKP'}).locator('option').evaluateAll(items=>items.map(item=>item.value));
    const kkp={indices,excel:await exportKkp.count()?workbookEvidence(await download(page,exportKkp)):null};
    await (studio?page.getByRole('tab',{name:'KKA (ND-306)',exact:true}):button('KKA')).click();
    const xlsx=await download(page,studio?page.locator('#kkaLamp'):button('Excel kertas kerja'));
    const doc=await download(page,studio?page.locator('#kkaWord'):button('Word'));
    evidence[year]={dashboard,coverage,spt,kkp,kka:{excel:workbookEvidence(xlsx),word:documentEvidence(doc,xlsx)}};
  }
  return evidence;
}

function dashboardNumber(text){
  const match=/^(?:Rp)?\s*([−-]?[\d.]+(?:,\d+)?)(?:\s+(juta|miliar|triliun))?$/.exec(text??'');
  if(!match)return null;
  const [,raw,unit]=match,scale={juta:1e6,miliar:1e9,triliun:1e12}[unit]||1;
  const value=Number(raw.replace('−','-').replaceAll('.','').replace(',','.'))*scale;
  return {value,step:scale/10**(raw.split(',')[1]?.length??0)};
}
function dashboardResults(studio,player,candidate){
  const indicators={};
  const label=value=>value==='PPN kurang bayar disetor'?'PPN kurang bayar menurut SPT':value;
  const status=value=>value===null?'Belum tersedia':value.value===0?'Nol':'Tersedia';
  const compare=(a,b)=>a&&b?(Math.abs(a.value-b.value)<=Math.max(a.step,b.step)/2
    ?(a.step===1&&b.step===1?'Cocok':'Cocok pada presisi tampilan'):'Berbeda'):'Belum dapat dibandingkan';
  for(const year of years){
    const [s,p,c]=[studio,player,candidate].map(report=>new Map((report?.byYear?.[year].dashboard||[]).map(([key,text])=>[label(key),text])));
    const keys=new Set([...s.keys(),...p.keys(),...c.keys()]);
    indicators[year]=[...keys].filter(Boolean).map(indicator=>{
      const a=dashboardNumber(s.get(indicator)),b=dashboardNumber(p.get(indicator)),d=dashboardNumber(c.get(indicator));
      return {indicator,studio:status(a),player:status(b),studioPlayer:compare(a,b),
        ...(candidate?{candidate:status(d),playerCandidate:compare(b,d)}:{})};
    });
    for(const entry of [studio,player,candidate])if(entry)delete entry.byYear[year].dashboard;
  }
  return indicators;
}

async function inspect(dir,studio,input,profile){
  const ext=resolve(dir),manifest=JSON.parse(await readFile(join(ext,'manifest.json'),'utf8'));
  const browser=await chromium.launchPersistentContext(join(temp,profile),{channel:'chromium',headless:true,offline:true,
    viewport:{width:1600,height:950},executablePath:process.env.CHROMIUM_PATH||undefined,
    args:['--disable-background-networking','--disable-extensions-except='+ext,'--load-extension='+ext]});
  try{
    let external=0,errors=0;await browser.route(/^https?:/,async route=>{external++;await route.abort();});
    const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
    const page=await browser.newPage();page.on('pageerror',()=>errors++);
    await page.goto(new URL('analisis/index.html',worker.url()).href);
    const start=page.getByRole('button',{name:'Mulai',exact:true});
    if(studio&&await start.isVisible())await start.click();
    await page.locator(studio?'#peranSel':'#role').selectOption({label:values.role});
    await page.locator('#filePkg').setInputFiles({name:'paket.zip',mimeType:'application/zip',buffer:input});
    await page.waitForFunction(sel=>Boolean(document.querySelector(sel)?.value),studio?'#wpSel':'#taxpayer',{timeout:120000});
    const nav=page.getByRole('navigation',{name:'Bagian aplikasi'}),available=[];
    // Controls that require a package are enabled after loading has completed.
    await nav.getByRole('button',{name:/^Data mentah/}).click({timeout:120000});
    for(const menu of menus){
      const control=nav.getByRole('button',{name:new RegExp('^'+menu)});
      if(await control.count()===1&&await control.isEnabled()){
        await control.click();
        await nav.locator('[aria-current="page"],[aria-selected="true"]').filter({hasText:new RegExp('^'+menu)}).first().waitFor();
        available.push(menu);
      }
    }
    await nav.getByRole('button',{name:/^Data mentah/}).click();
    const heading=page.getByRole('heading',{name:studio?/^Tabel data standar/i:/^Data mentah/i}).first();await heading.waitFor();
    const names=await page.locator('button:visible').allInnerTexts(),tables=[];
    for(const name of names){
      const match=/^(.+?)\s+([\d.]+) baris(?:\s*·\s*[\d.]+ kolom)?$/i.exec(name.replace(/\s+/g,' ').trim());
      if(match)tables.push({title:match[1],rows:Number(match[2].replaceAll('.','')),key:tableKey(match[1])});
    }
    const byYear=years.length?await inspectYears(page,nav,studio):undefined;
    const profilePayments=years.length&&!studio?await paymentProfile(page,nav):undefined;
    return {version:manifest.version,menus:available,tables,byYear,profilePayments,externalRequests:external,pageErrors:errors};
  }finally{await browser.close();}
}
try{
  const studio=await inspect(values.studio,true,bytes,'studio'),player=await inspect(values.player,false,bytes,'v2');
  const candidateBytes=values.candidate?await readFile(values.candidate):null;
  const candidate=candidateBytes?await inspect(values.player,false,candidateBytes,'v2-candidate'):undefined;
  const pairs=studio.tables.map(s=>{
    const matches=player.tables.filter(p=>p.key===s.key);
    const p=matches.length===1&&studio.tables.filter(o=>o.key===s.key).length===1?matches[0]:null;
    return {studio:s.title,studioRows:s.rows,player:p?.title??null,playerRows:p?.rows??null,
      status:p?(s.rows===p.rows?'Jumlah cocok':'Jumlah berbeda'):matches.length?'Nama ambigu':'Belum dipasangkan'};
  });
  const dashboard=years.length?dashboardResults(studio,player,candidate):undefined;
  const report={sha256:createHash('sha256').update(bytes).digest('hex'),
    candidateSha256:candidateBytes?createHash('sha256').update(candidateBytes).digest('hex'):undefined,
    role:values.role,studio,player,candidate,pairs,dashboard};
  await writeFile(values.out,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log('Menu terbuka Studio/V2: '+studio.menus.length+'/'+player.menus.length+'. Jumlah baris cocok pada '+pairs.filter(p=>p.status==='Jumlah cocok').length+' dari '+pairs.length+' tabel Studio.');
}finally{await rm(temp,{recursive:true,force:true});}
