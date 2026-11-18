import {readPackage,sha256} from '../archive/package.js';
import {renderCatalog} from '../catalog.js';
import {renderDashboard,renderEntries,renderSpt} from './analysis-views.js';
import {indexPackage,count,label,receiptFields,rowsOf,typeNames} from './model.js';
import {indexedProfileSections} from './profile.js';
import {openForm} from './spt-forms.js';
import {qualityNotes,renderQuality} from './quality.js';
import {activeRateUpdate,hasSavedRates} from './rate-updates.js';
import {rateUpdateTools} from './rate-updates-ui.js';
import {buildIndex} from './kkp-index.js';
import {box,button,card,detail,el,notice,select,showDialog,toggleSet} from './ui.js';
import {probisRequests,renderWork} from './work.js';
import {readPref,resetAppearance,setPref} from './preferences.js';
import {renderTestingPrograms} from './testing-programs.js';
import {renderAppportal} from './appportal-ui.js';

const tabs=[['muat','Muat paket'],['ringkas','Dasbor'],['probis','Probis'],['profil','Profil WP'],['spt','SPT'],['kerja','Kertas Kerja'],['peraturan','Peraturan'],['tabel','Data mentah'],['bantuan','Bantuan']];
const needsPackage=new Set(['ringkas','profil','spt','kerja','tabel','impor']);
function developerMode(active){
  const index=tabs.findIndex(([key])=>key==='impor');
  if(active&&index<0)tabs.push(['impor','Impor appportal']);
  if(!active&&index>=0)tabs.splice(index,1);
}
const formSection=/^form-([a-f0-9]{32})-([1-9]\d*)$/;
const monthFormatter=new Intl.DateTimeFormat('id',{month:'long',timeZone:'UTC'});
let openFormHash='';
const $=id=>document.getElementById(id);
const state={packages:new Map(),pkg:null,tab:'muat',section:'',year:'',role:'Pemeriksa',selectedEntry:'',query:'',work:new Map(),sptFilters:{type:'',latest:true,late:false,amended:false},go,repaint:render};
const validRole=readPref('role');if(['AR','Penelaah','Pemeriksa'].includes(validRole))state.role=validRole;
$('role').value=state.role;$('role').onchange=()=>{state.role=$('role').value;setPref('role',state.role);render();};
function selectPackage(key){state.pkg=state.packages.get(key)||null;state.year=state.pkg?.years[0]||'';state.selectedEntry='';state.sptFilters.type='';state.sptFilters.allYears=false;}
$('taxpayer').onchange=()=>{selectPackage($('taxpayer').value);if(formSection.test(state.section)&&state.tab==='spt')go('spt');else render();};
$('close-dialog').onclick=()=>$('dialog').close();
$('dialog').addEventListener('close',()=>{
  if(!openFormHash||location.hash!==openFormHash||$('dialog').open)return;
  openFormHash='';history.replaceState(null,'','#/spt');render();
});
function applyTheme(){
  const t=readPref('theme')||'Terang';const density=readPref('density')||'Otomatis';
  const root=document.documentElement;root.classList.toggle('dark',t==='Grafit Zamrud'||(t==='Ikuti sistem'&&matchMedia('(prefers-color-scheme:dark)').matches));
  root.classList.toggle('glass',t==='Kaca hijau');root.classList.toggle('compact',density==='Rapat'||(density==='Otomatis'&&matchMedia('(max-width:1600px)').matches));root.classList.toggle('contrast',readPref('contrast')==='1');
}
applyTheme();matchMedia('(prefers-color-scheme:dark)').addEventListener('change',applyTheme);matchMedia('(max-width:1600px)').addEventListener('change',applyTheme);
function go(tab,section=''){
  if(!tabs.some(([key])=>key===tab))return;
  const hash=tab==='muat' && section==='mutu'?'#/mutu':'#/'+tab+(section?'/'+encodeURIComponent(section):'');
  if(location.hash===hash)render();else location.hash=hash;
}
function route(){
  const [raw,sub]=location.hash.replace(/^#\/?/,'').split('/');
  if(raw==='pengembang'){developerMode(true);return ['muat',''];}
  const key=({mutu:'muat',klu:'probis'})[raw]||raw;
  if(!tabs.some(([t])=>t===key)||(!state.pkg&&needsPackage.has(key)))return ['muat',''];
  let section='';try{section=decodeURIComponent(sub||'');}catch{/* Invalid hash can be ignored. */}
  return [key,raw==='mutu'?'mutu':raw==='klu'?'klu':section];
}
window.addEventListener('hashchange',()=>{openFormHash='';if($('dialog').open)$('dialog').close();render();});
function preferences(){
  const toolbar=box('toolbar');
  for(const [key,name,values] of [['density','Ukuran',['Otomatis','Nyaman','Rapat']],['theme','Tema',['Terang','Grafit Zamrud','Kaca hijau','Ikuti sistem']]]){
    toolbar.append(select(values,readPref(key)||values[0],v=>{setPref(key,v);applyTheme();},name));
  }
  const high=el('input');high.type='checkbox';high.checked=readPref('contrast')==='1';high.onchange=()=>{setPref('contrast',high.checked?'1':'0');applyTheme();};
  const l=el('label');l.append(high,document.createTextNode(' Kontras tinggi'));
  const filename=select([['npwp','NPWP saja'],['npwp-nama','NPWP dan nama WP']],readPref('filename'),v=>setPref('filename',v),'Identitas WP pada nama berkas');
  const reset=button('Kembali ke bawaan',()=>{
    resetAppearance();applyTheme();preferences();$('reset-appearance').focus();
  });
  reset.id='reset-appearance';
  toolbar.append(l,filename,reset);showDialog('Tampilan',toolbar);
}
function search(){
  const inp=el('input');inp.type='search';inp.placeholder='Menu, bagian profil, jenis dan masa SPT, atau berkas';inp.setAttribute('aria-label','Kata kunci pencarian cepat');const results=box('quick');let hits=[],index=0,limit=12;
  const routes=tabs.filter(([k])=>state.pkg||!needsPackage.has(k)).map(([k,title])=>({title,act:()=>go(k)}));
  routes.push({title:'Program pengujian',aliases:'prosedur penelaahan dokumen Coretax',act:()=>go('bantuan','program')});
  if(state.pkg){
    routes.push({title:'Rincian mutu data',aliases:'pencocokan baris CSV dan isi tabel',act:()=>go('muat','mutu')});
    if(state.pkg.report.valid && state.year){
      const workKey=JSON.stringify([state.pkg.report.manifestHash||state.pkg.fileKey,state.year]);
      const work=state.work.get(workKey)||{rows:[],drafts:[]};
      state.work.set(workKey,work);
      work.indexData??=buildIndex(state.pkg,state.year);
      for(const group of work.indexData.groups)routes.push({title:'KKP '+group.ref+' · '+group.title,aliases:group.tax,
        act:()=>{work.activeIndex=group.key;go('kerja','kkp');}});
    }
    for(const [sec,text] of [['ringkasan','Ringkasan dasbor'],['butir','Semua butir'],['keuangan','Keuangan'],['ppn','PPN & lawan'],['grafik','Laporan grafik'],['potput','PPh potput & buku besar'],['banding','Perbandingan antar-WP']])routes.push({title:text,act:()=>go('ringkas',sec)});
    for(const [tab,section,title] of [['spt','daftar','Daftar dan isi SPT'],['spt','ringkasan','Ringkasan SPT'],['kerja','kkp','Kertas Kerja Pemeriksaan (KKP)'],['kerja','kka','Kertas Kerja Analisis (KKA)'],['kerja','sim','Simulasi sanksi'],['kerja','ba','Berita acara']]){
      routes.push({title,act:()=>go(tab,section)});
    }
    for(const s of indexedProfileSections(state.pkg))routes.push({title:'Profil WP · '+s.title,aliases:s.group,act:()=>go('profil',s.id)});
    const pkg=state.pkg;
    for(const [i,f] of pkg.forms.entries()){
      const kind=typeNames[f.type]||f.type,version=f.version?'Pembetulan '+f.version:'Normal';
      const month=Number(f.period.slice(5)),monthName=month>=1&&month<=12?monthFormatter.format(Date.UTC(2020,month-1,1)):'Tahunan';
      routes.push({title:'SPT '+kind+' · '+f.period+' · '+version,
        aliases:[f.type,'P'+f.version,monthName,...Object.values(receiptFields(f.meta))].join(' '),
        act:()=>go('spt','form-'+pkg.formNamespace+'-'+(i+1))});
    }
    for(const e of pkg.entries.filter(e=>!e.path.startsWith('spt/')))routes.push({title:'Data mentah · '+(e.cap?.label||e.path),aliases:e.path,act:()=>{state.selectedEntry=e.path;go('tabel');}});
  }
  const norm=text=>text.toLocaleLowerCase('id').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  for(const route of routes){route.name=norm(route.title);route.terms=norm(route.title+' '+(route.aliases||''));}
  function accept(it){if(!it)return;$('dialog').close();it.act();}
  function show(){const q=norm(inp.value),terms=q.split(' ');const matches=routes.filter(x=>terms.every(t=>x.terms.includes(t)));
    if(q)matches.sort((a,b)=>Number(b.name===q)-Number(a.name===q)||Number(b.name.startsWith(q))-Number(a.name.startsWith(q)));
    hits=matches.slice(0,limit);
    if(q){for(const [key,title] of [['probis','Cari KBLI / Probis'],['peraturan','Cari peraturan']])hits.push({title:title+' · '+inp.value,act:()=>{state.query=inp.value;go(key);}});}
    index=Math.min(Math.max(index,0),Math.max(0,hits.length-1));results.replaceChildren(...hits.map((it,i)=>button(it.title,()=>accept(it),i===index?'':'secondary')));
    if(matches.length>limit)results.append(button('Tampilkan hasil lainnya ('+(matches.length-limit)+')',()=>{limit+=24;show();}));
  }
  inp.oninput=()=>{index=0;limit=12;show();};inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();accept(hits[index]);}else if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();index+=e.key==='ArrowDown'?1:-1;show();}};
  show();showDialog('Cari cepat',box('quick',inp,results));inp.focus();
}
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();search();return;}
  if($('dialog').open || ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName) || e.altKey||e.ctrlKey||e.metaKey)return;
  if(/^[1-9]$/.test(e.key)){const key=tabs[Number(e.key)-1]?.[0];if(key&&(state.pkg||!needsPackage.has(key)))go(key);}
  if(e.key==='/'){const control=$('screen').querySelector('input[type=search]');if(control){e.preventDefault();control.focus();}}
  if(e.key==='?')showDialog('Pintasan papan ketik',el('p','1–9 membuka tab. Ctrl+K mencari. / menempatkan kursor di saringan. Esc menutup dialog. Gunakan Kembali atau Maju pada browser untuk berpindah halaman.'));
});
function password(){
  return new Promise(resolve=>{
    const entry=el('input');entry.type='password';entry.autocomplete='off';entry.required=true;entry.setAttribute('aria-label','Kata sandi paket');
    const f=el('form');const submit=el('button','Buka paket');submit.type='submit';f.append(box('toolbar',entry,submit));
    const d=showDialog('Kata sandi paket',f);let answer=null;d.addEventListener('close',()=>{entry.value='';resolve(answer);},{once:true});f.onsubmit=e=>{e.preventDefault();answer=entry.value;d.close();};entry.focus();
  });
}
let loading=false;
async function addPackages(files){
  if(loading || !files.length)return false;
  loading=true;const problems=[];let opened=0;
  try{
    for(const file of files){
      notice('Memeriksa berkas dan sidik jari paket…');
      try{
        let result;
        try{result=await readPackage(file);}catch(e){
          if(e.code!=='PASSWORD_REQUIRED')throw e;
          const secret=await password();if(secret===null)throw Error('Pembukaan dibatalkan.');
          result=await readPackage(file,{password:secret});
        }
        const pkg=indexPackage(result);pkg.fileKey=pkg.report.manifestHash||crypto.randomUUID();
        pkg.submittedRows=pkg.entries.filter(e=>e.path==='spt/daftar.json'||e.cap?.sumber==='sptdaftar')
          .reduce((n,e)=>n+rowsOf(e).length,0);
        pkg.formNamespace=(await sha256('spt-view/'+pkg.fileKey)).slice(0,32);
        pkg.fileName=file.name||'Paket lokal';state.packages.set(pkg.fileKey,pkg);selectPackage(pkg.fileKey);opened++;
      }catch(e){problems.push((file.name||'Paket')+' — '+e.message);}
    }
    render();notice([opened?opened+' paket dibuka.':'',...problems].filter(Boolean).join(' '),Boolean(problems.length));return opened>0;
  }finally{loading=false;}
}
function removePackage(pkg) {
  const action=()=>{state.packages.delete(pkg.fileKey);for(const key of state.work.keys())if(JSON.parse(key)[0]===pkg.fileKey)state.work.delete(key);
    if(state.pkg===pkg)selectPackage(state.packages.keys().next().value);$('dialog').close();render();notice('Paket dilepas dari sesi ini.');};
  showDialog('Lepaskan paket?',box('',el('p','Isi paket dan kertas kerja yang belum diunduh akan dilepas dari sesi ini.'),button('Lepaskan paket',action)));
}
function importView(root){
  const input=el('input');input.type='file';input.multiple=true;input.accept='.zip,.sedotax';input.className='hidden-file';input.id='filePkg';
  const picker=el('label','Pilih file','upload');picker.htmlFor=input.id;picker.append(input);
  const sentence=el('p',null,'headline');sentence.append(el('b','Tarik file paket ke sini'),document.createTextNode(' atau '),picker);
  const drop=box('drop',sentence,el('p','Pilih satu atau beberapa paket ZIP atau SEDOTAX terenkripsi. Berkas diproses di komputer ini.','hint'));
  input.onchange=()=>{addPackages([...input.files]);input.value='';};
  drop.ondragover=e=>{e.preventDefault();drop.classList.add('over');};drop.ondragleave=()=>drop.classList.remove('over');
  drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');addPackages([...e.dataTransfer.files]);};
  root.append(drop,el('p','Muat paket untuk membuka Dasbor, Profil WP, SPT, Kertas Kerja, dan Data mentah. Probis, Peraturan, dan Bantuan tersedia sejak awal.','hint'));
  const dev=button('Mode pengembang',()=>{
    if(tabs.some(([key])=>key==='impor')){developerMode(false);go('muat');}
    else location.hash='pengembang';
  });
  dev.setAttribute('aria-pressed',String(tabs.some(([key])=>key==='impor')));root.append(dev);
  if(!state.packages.size)return;
  const list=card('Paket dalam sesi ini');
  for(const p of state.packages.values()){
    const ident=p.manifest.wp||{};
    const summary=box('',el('b',ident.nama||p.fileName),el('p',[ident.npwp,p.manifest.periode].filter(Boolean).join(' · '),'hint'));
    list.append(box('listrow',summary,box('row',button('Jadikan aktif',()=>{selectPackage(p.fileKey);render();}),button('Lepaskan',()=>removePackage(p)))));
  }
  root.append(list);
  const p=state.pkg;const ok=p.report.valid;
  const status=el('p',ok?'Konsisten · Seluruh sidik jari yang diperiksa cocok.':'Perhatian · Integritas paket perlu ditinjau.',ok?'notice':'notice error');
  const summary=el('p',count(p.report.checked)+' berkas diperiksa.'+(p.report.encrypted?' Paket terenkripsi.':''));
  const hash=el('pre',p.report.manifestHash||'—');
  const quality=card('Mutu data · paket aktif',status,summary,detail('SHA-256 manifest',hash),detail('Berita acara',el('pre',p.minutes||'Belum tersedia.')));
  if(p.report.issues.length){const ul=el('ul');for(const message of p.report.issues)ul.append(el('li',message));quality.append(ul);}
  const partial=p.entries.filter(e=>e.cap?.lengkap===false);quality.append(el('p',partial.length+' berkas ditandai belum lengkap oleh sumber.'));
  const notes=qualityNotes(p);
  quality.append(el('p',['Kritis','Peringatan','Info'].map(level=>level+' '+notes.filter(n=>n.Tingkat===level).length).join(' · '),'hint'),
    button('Rincian mutu data',()=>go('muat','mutu')));
  root.append(quality);
}
function help(root){
  root.append(toggleSet([['','Panduan dan tarif'],['program','Program pengujian']],state.section==='program'?'program':'',key=>go('bantuan',key)));
  if(state.section==='program'){renderTestingPrograms(root);return;}
  rateUpdateTools(root,render);
  root.append(card('Bantuan',detail('Membuka dan memeriksa paket',el('p','Seret paket ke Muat paket. Untuk paket terenkripsi masukkan kata sandi. Periksa integritas, periode, dan WP aktif sebelum mengolah data.')),detail('Membaca SPT dan data mentah',el('p','Pilih tahun dan buka satu baris pada Daftar SPT untuk melihat induk, lampiran, atau membandingkan pembetulan. Untuk tabel sumber lain, gunakan Profil WP dan Data mentah.')),detail('Kertas kerja dan berita acara',el('p','Tambah butir, catat sumber serta simpulan, lalu unduh berkas kerja sebelum menutup tab. Buka kembali berkas kerja bersama paket dan tahun yang sama.')),detail('Data lokal dan pintasan',el('p','Paket dan catatan sesi dilepas saat tab ditutup. Tema dan peran tersimpan sebagai preferensi. Gunakan Ctrl+K untuk pencarian, 1–9 untuk tab, dan ? untuk daftar pintasan.'))));
}
function render(){
  [state.tab,state.section]=route();const root=$('screen');root.replaceChildren();notice('');
  const formLink=state.tab==='spt'&&formSection.exec(state.section);let form;
  if(formLink){
    const pkg=[...state.packages.values()].find(p=>p.formNamespace===formLink[1]);
    form=pkg?.forms[Number(formLink[2])-1];
    if(form){if(pkg!==state.pkg)selectPackage(pkg.fileKey);state.year=form.year;state.sptFilters.allYears=false;}
  }
  const options=[...state.packages.values()].map(p=>{const o=el('option',[p.manifest.wp?.nama,p.manifest.wp?.npwp].filter(Boolean).join(' · ')||p.fileName);o.value=p.fileKey;return o;});
  $('taxpayer').replaceChildren(...(options.length?options:[el('option','Muat paket dahulu')]));if(state.pkg)$('taxpayer').value=state.pkg.fileKey;
  const nav=$('navigation');nav.replaceChildren();
  for(const [key,title] of tabs){
    if(['ringkas','kerja','peraturan'].includes(key))nav.append(el('span',null,'divider'));
    const tab=button(title,()=>{state.query='';go(key);},'');if(state.tab===key)tab.setAttribute('aria-current','page');
    if(key==='spt'&&state.pkg?.submittedRows){
      const n=count(state.pkg.submittedRows),badge=el('span',n,'spt-count');
      badge.setAttribute('aria-hidden','true');tab.append(badge);
      tab.title=n+' baris pada daftar SPT dilaporkan, termasuk pembetulan dan semua tahun.';
      tab.setAttribute('aria-description',tab.title);
    }
    if(!state.pkg&&needsPackage.has(key)){tab.disabled=true;tab.title='Muat paket WP untuk membuka tab ini.';}nav.append(tab);
  }
  nav.append(button('Cari  Ctrl K',search,'tools'),button('Tampilan',preferences,''));
  const title=tabs.find(t=>t[0]===state.tab)[1];$('crumb').textContent=title+(formLink?' › Formulir':state.section?' › '+label(state.section):'');
  const rateInfo=$('rate-info'),active=activeRateUpdate();
  rateInfo.hidden=!(active || hasSavedRates());
  if(!rateInfo.hidden){
    const label=active?'Tarif bunga pilihan sesi · '+active.source+' · '+active.date:'Ada tarif bunga tersimpan. Sesi ini memakai tarif bawaan.';
    rateInfo.replaceChildren(document.createTextNode(label+' '),button('Periksa tarif',()=>go('bantuan')));
  }
  if(state.tab==='muat'){
    if(!state.pkg&&location.hash.startsWith('#/spt/form-'))root.append(card('Buka formulir tertaut',el('p','Pilih paket asal untuk membuka formulir ini.')));
    if(state.section==='mutu' && state.pkg)renderQuality(root,state.pkg,()=>go('muat'));else importView(root);
  }
  else if(state.tab==='impor')renderAppportal(root,state);
  else if(state.tab==='ringkas')renderDashboard(root,state);
  else if(state.tab==='spt'){
    if(formLink&&!form){root.append(card('Formulir belum tersedia',el('p','Muat paket asal untuk membuka formulir yang ditautkan.')));importView(root);}
    else {
      renderSpt(root,state);
      if(form){
        openFormHash=location.hash;
        openForm(form,state.pkg,next=>{
          state.section='form-'+state.pkg.formNamespace+'-'+(state.pkg.forms.indexOf(next)+1);
          openFormHash='#/spt/'+state.section;history.replaceState(null,'',openFormHash);
        });
      }
    }
  }
  else if(['profil','tabel'].includes(state.tab))renderEntries(root,state,state.tab==='profil');
  else if(state.tab==='kerja')renderWork(root,state);
  else if(['probis','peraturan'].includes(state.tab))renderCatalog(root,state.tab,{manifest:state.pkg?.manifest,entries:state.pkg?.entries,query:state.query,openBusinessSearch:state.section==='klu',
    requests:state.pkg?.report.valid && state.year?()=>probisRequests(state):null});
  else help(root);
}
render();
const handoff=new URLSearchParams(location.search).get('paket');
if(handoff){
  try{
    if(!/^[a-f0-9-]{36}$/i.test(handoff))throw Error('Tautan paket tidak dikenali.');
    const {readHandoff,putHandoff}=await import('../app-handoff.js');const file=await readHandoff(handoff);
    if(!file)throw Error('Paket dari halaman penarikan sudah dilepas. Buka kembali dari hasil tarikan.');
    if(await addPackages([file])){await putHandoff(handoff,null);history.replaceState(null,'',location.pathname+location.hash);}
  }catch(e){notice(e.message,true);}
}
