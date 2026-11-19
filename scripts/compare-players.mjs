// Read both installed extensions through their visible interfaces in separate offline profiles.
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {parseArgs} from 'node:util';

const {values}=parseArgs({options:{zip:{type:'string'},studio:{type:'string'},player:{type:'string',default:'extension'},
  role:{type:'string',default:'Pemeriksa'},out:{type:'string'}}});
if(!values.zip||!values.studio||!values.out)throw Error('Gunakan --zip BERKAS --studio FOLDER_EKSTENSI --out LAPORAN_BARU.json. Pilihan tambahan: --player FOLDER dan --role PERAN.');
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
async function inspect(dir,studio){
  const ext=resolve(dir),manifest=JSON.parse(await readFile(join(ext,'manifest.json'),'utf8'));
  const browser=await chromium.launchPersistentContext(join(temp,studio?'studio':'v2'),{channel:'chromium',headless:true,offline:true,
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
    await page.locator('#filePkg').setInputFiles({name:'paket.zip',mimeType:'application/zip',buffer:bytes});
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
    return {version:manifest.version,menus:available,tables,externalRequests:external,pageErrors:errors};
  }finally{await browser.close();}
}
try{
  const studio=await inspect(values.studio,true),player=await inspect(values.player,false);
  const pairs=studio.tables.map(s=>{
    const matches=player.tables.filter(p=>p.key===s.key);
    const p=matches.length===1&&studio.tables.filter(o=>o.key===s.key).length===1?matches[0]:null;
    return {studio:s.title,studioRows:s.rows,player:p?.title??null,playerRows:p?.rows??null,
      status:p?(s.rows===p.rows?'Jumlah cocok':'Jumlah berbeda'):matches.length?'Nama ambigu':'Belum dipasangkan'};
  });
  const report={sha256:createHash('sha256').update(bytes).digest('hex'),role:values.role,studio,player,pairs};
  await writeFile(values.out,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log('Menu terbuka Studio/V2: '+studio.menus.length+'/'+player.menus.length+'. Jumlah baris cocok pada '+pairs.filter(p=>p.status==='Jumlah cocok').length+' dari '+pairs.length+' tabel Studio.');
}finally{await rm(temp,{recursive:true,force:true});}
