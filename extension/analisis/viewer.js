import {readPackage} from '../archive/package.js';
import {renderCatalog} from '../catalog.js';
import {renderDashboard,renderEntries,renderSpt} from './analysis-views.js';
import {indexPackage,count,label} from './model.js';
import {box,button,card,dataTable,detail,el,notice,select,showDialog} from './ui.js';
import {renderWork} from './work.js';

const tabs=[['muat','Muat paket'],['ringkas','Dasbor'],['probis','Probis'],['profil','Profil WP'],['spt','SPT'],['kerja','Kertas Kerja'],['peraturan','Peraturan'],['tabel','Data mentah'],['bantuan','Bantuan']];
const needsPackage=new Set(['ringkas','profil','spt','kerja','tabel']);
const $=id=>document.getElementById(id);
const state={packages:new Map(),pkg:null,tab:'muat',section:'',year:'',role:'Pemeriksa',selectedEntry:'',query:'',work:new Map(),sptFilters:{type:'',latest:false,late:false,amended:false},go,repaint:render};
const readPref=k=>{try{return localStorage.getItem('scv2-view-'+k);}catch{return null;}};
const setPref=(k,v)=>{try{localStorage.setItem('scv2-view-'+k,v);}catch{/* Browser preferences may be disabled. */}};
const validRole=readPref('role');if(['AR','Penelaah','Pemeriksa'].includes(validRole))state.role=validRole;
$('role').value=state.role;$('role').onchange=()=>{state.role=$('role').value;setPref('role',state.role);render();};
function selectPackage(key){state.pkg=state.packages.get(key)||null;state.year=state.pkg?.years[0]||'';state.selectedEntry='';state.sptFilters.type='';}
$('taxpayer').onchange=()=>{selectPackage($('taxpayer').value);render();};
$('close-dialog').onclick=()=>$('dialog').close();
function applyTheme(){
  const t=readPref('theme')||'Terang';const density=readPref('density')||'Otomatis';
  const root=document.documentElement;root.classList.toggle('dark',t==='Grafit Zamrud'||(t==='Ikuti sistem'&&matchMedia('(prefers-color-scheme:dark)').matches));
  root.classList.toggle('glass',t==='Kaca hijau');root.classList.toggle('compact',density==='Rapat'||(density==='Otomatis'&&matchMedia('(max-width:1600px)').matches));root.classList.toggle('contrast',readPref('contrast')==='1');
}
applyTheme();matchMedia('(prefers-color-scheme:dark)').addEventListener('change',applyTheme);matchMedia('(max-width:1600px)').addEventListener('change',applyTheme);
function go(tab,section=''){
  if(!tabs.some(([key])=>key===tab))return;
  const hash='#/'+tab+(section?'/'+encodeURIComponent(section):'');
  if(location.hash===hash)render();else location.hash=hash;
}
function route(){
  const [raw,sub]=location.hash.replace(/^#\/?/,'').split('/');
  const key=({mutu:'muat',klu:'probis'})[raw]||raw;
  if(!tabs.some(([t])=>t===key)||(!state.pkg&&needsPackage.has(key)))return ['muat',''];
  let section='';try{section=decodeURIComponent(sub||'');}catch{/* Invalid hash can be ignored. */}
  return [key,section];
}
window.addEventListener('hashchange',()=>{if($('dialog').open)$('dialog').close();render();});
function preferences(){
  const toolbar=box('toolbar');
  for(const [key,name,values] of [['density','Ukuran',['Otomatis','Nyaman','Rapat']],['theme','Tema',['Terang','Grafit Zamrud','Kaca hijau','Ikuti sistem']]]){
    toolbar.append(select(values,readPref(key)||values[0],v=>{setPref(key,v);applyTheme();},name));
  }
  const high=el('input');high.type='checkbox';high.checked=readPref('contrast')==='1';high.onchange=()=>{setPref('contrast',high.checked?'1':'0');applyTheme();};
  const l=el('label');l.append(high,document.createTextNode(' Kontras tinggi'));toolbar.append(l);showDialog('Tampilan',toolbar);
}
function search(){
  const inp=el('input');inp.type='search';inp.placeholder='Tab, bagian, atau berkas';inp.setAttribute('aria-label','Kata kunci pencarian cepat');const results=box('quick');let hits=[],index=0;
  const routes=tabs.filter(([k])=>state.pkg||!needsPackage.has(k)).map(([k,title])=>({title,act:()=>go(k)}));
  if(state.pkg){
    for(const [sec,text] of [['ringkasan','Ringkasan dasbor'],['butir','Semua butir'],['keuangan','Keuangan'],['ppn','PPN & lawan'],['grafik','Laporan grafik'],['potput','PPh potput & buku besar']])routes.push({title:text,act:()=>go('ringkas',sec)});
    for(const e of state.pkg.entries.filter(e=>!e.path.startsWith('spt/')))routes.push({title:e.cap?.label||e.path,act:()=>{state.selectedEntry=e.path;go(e.path.startsWith('profil/')?'profil':'tabel');}});
  }
  function accept(it){if(!it)return;$('dialog').close();it.act();}
  function show(){const q=inp.value.trim().toLocaleLowerCase('id');hits=routes.filter(x=>x.title.toLocaleLowerCase('id').includes(q)).slice(0,12);
    if(q){for(const [key,title] of [['probis','Cari KBLI / Probis'],['peraturan','Cari peraturan']])hits.push({title:title+' · '+inp.value,act:()=>{state.query=inp.value;go(key);}});}
    index=Math.min(Math.max(index,0),Math.max(0,hits.length-1));results.replaceChildren(...hits.map((it,i)=>button(it.title,()=>accept(it),i===index?'':'secondary')));
  }
  inp.oninput=()=>{index=0;show();};inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();accept(hits[index]);}else if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();index+=e.key==='ArrowDown'?1:-1;show();}};
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
  if(partial.length)quality.append(dataTable(partial.map(e=>({Berkas:e.path,Keterangan:(e.cap.catatan||[]).join(' ')})),{name:'Berkas belum lengkap'}));
  root.append(quality);
}
function help(root){
  root.append(card('Bantuan',detail('Membuka dan memeriksa paket',el('p','Seret paket ke Muat paket. Untuk paket terenkripsi masukkan kata sandi. Periksa integritas, periode, dan WP aktif sebelum mengolah data.')),detail('Membaca SPT dan data mentah',el('p','Pilih tahun dan buka satu baris pada Daftar SPT untuk melihat induk, lampiran, atau membandingkan pembetulan. Untuk tabel sumber lain, gunakan Profil WP dan Data mentah.')),detail('Kertas kerja dan berita acara',el('p','Tambah butir, catat sumber serta simpulan, lalu unduh berkas kerja sebelum menutup tab. Buka kembali berkas kerja bersama paket dan tahun yang sama.')),detail('Data lokal dan pintasan',el('p','Paket dan catatan sesi dilepas saat tab ditutup. Tema dan peran tersimpan sebagai preferensi. Gunakan Ctrl+K untuk pencarian, 1–9 untuk tab, dan ? untuk daftar pintasan.'))));
}
function render(){
  [state.tab,state.section]=route();const root=$('screen');root.replaceChildren();notice('');
  const options=[...state.packages.values()].map(p=>{const o=el('option',[p.manifest.wp?.nama,p.manifest.wp?.npwp].filter(Boolean).join(' · ')||p.fileName);o.value=p.fileKey;return o;});
  $('taxpayer').replaceChildren(...(options.length?options:[el('option','Muat paket dahulu')]));if(state.pkg)$('taxpayer').value=state.pkg.fileKey;
  const nav=$('navigation');nav.replaceChildren();
  for(const [key,title] of tabs){
    if(['ringkas','kerja','peraturan'].includes(key))nav.append(el('span',null,'divider'));
    const tab=button(title,()=>{state.query='';go(key);},'');if(state.tab===key)tab.setAttribute('aria-current','page');
    if(!state.pkg&&needsPackage.has(key)){tab.disabled=true;tab.title='Muat paket WP untuk membuka tab ini.';}nav.append(tab);
  }
  nav.append(button('Cari  Ctrl K',search,'tools'),button('Tampilan',preferences,''));
  const title=tabs.find(t=>t[0]===state.tab)[1];$('crumb').textContent=title+(state.section?' › '+label(state.section):'');
  if(state.tab==='muat')importView(root);
  else if(state.tab==='ringkas')renderDashboard(root,state);
  else if(state.tab==='spt')renderSpt(root,state);
  else if(['profil','tabel'].includes(state.tab))renderEntries(root,state,state.tab==='profil');
  else if(state.tab==='kerja')renderWork(root,state);
  else if(['probis','peraturan'].includes(state.tab))renderCatalog(root,state.tab,{manifest:state.pkg?.manifest,entries:state.pkg?.entries,query:state.query});
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
