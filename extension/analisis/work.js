import {createDocx} from '../archive/document.js';
import {count,issues,worksheet} from './model.js';
import {renderDrafts} from './drafts.js';
import {validateDrafts} from './draft-model.js';
import {box,button,card,dataTable,download,el,exportSheets,field,notice,select,showDialog,toggleSet} from './ui.js';

const textFields=['topik','sumber','fakta','simpulan','status','petugas'];
const statuses=['Belum diuji','Sedang diuji','Selesai','Perlu tindak lanjut'];
function workRow(row) {
  if(!row || typeof row!=='object' || textFields.some(key=>typeof row[key]!=='string'))throw Error('Format butir kerja tidak dikenali.');
  if(!statuses.includes(row.status))throw Error('Status butir tidak dikenali.');
  for(const key of ['menurutWp','menurutPetugas'])if(row[key]!==null&&!Number.isFinite(row[key]))throw Error('Nilai pengujian harus berupa angka.');
  return Object.fromEntries([...textFields,'menurutWp','menurutPetugas'].map(key=>[key,row[key]]));
}
function asReport(row,role){
  return {Butir:row.topik,Sumber:row.sumber,Fakta:row.fakta,'Menurut WP':row.menurutWp,['Menurut '+role]:row.menurutPetugas,Selisih:row.menurutWp!==null&&row.menurutPetugas!==null?row.menurutPetugas-row.menurutWp:null,Simpulan:row.simpulan,Status:row.status,Petugas:row.petugas};
}
function edit(parent,work,row,idx,repaint){
  const form=el('form');const inputs={};
  const labels={topik:'Butir pengujian',sumber:'Sumber / lokasi bukti',fakta:'Fakta yang ditemukan',menurutWp:'Menurut WP',menurutPetugas:'Menurut petugas',simpulan:'Simpulan',petugas:'Petugas'};
  const grid=box('formgrid');
  for(const [key,title] of Object.entries(labels)){
    const input=el(['simpulan','fakta'].includes(key)?'textarea':'input');input.value=row[key]??'';
    if(['menurutWp','menurutPetugas'].includes(key)){input.type='number';input.step='any';}
    if(key==='topik')input.required=true;
    inputs[key]=input;grid.append(field(title,input));
  }
  let status=row.status||statuses[0];
  const save=el('button','Simpan butir');save.type='submit';
  form.append(grid,box('toolbar',select(statuses,status,s=>status=s,'Status'),save));
  form.onsubmit=e=>{
    e.preventDefault();const out={status};
    for(const [k,input] of Object.entries(inputs))out[k]=input.type==='number'?(input.value===''?null:input.valueAsNumber):input.value.trim();
    if(!out.topik){inputs.topik.focus();return;}
    if(idx===null)work.rows.push(out);else work.rows[idx]=out;
    document.getElementById('dialog').close();repaint();notice('Butir tersimpan pada sesi ini. Unduh berkas kerja untuk membawanya ke sesi lain.');
  };
  showDialog(idx===null?'Tambah butir':'Ubah butir',form);
}
export function renderWork(target,state) {
  const pkg=state.pkg;const key=JSON.stringify([pkg.report.manifestHash||pkg.fileKey,state.year]);
  if(!state.work.has(key))state.work.set(key,{rows:[],drafts:[]});
  const work=state.work.get(key);
  const modes=[['kkp','KKP'],['kka','KKA'],['ba','Berita acara']];
  const mode=modes.some(([k])=>k===state.section)?state.section:(state.role==='Pemeriksa'?'kkp':'kka');
  const setYear=select(pkg.years,state.year,v=>{state.year=v;state.repaint();},'Tahun pajak');
  const save=()=>download(new Blob([JSON.stringify({format:'SCV2-KERJA',versi:1,paket:pkg.report.manifestHash,tahun:state.year,rows:work.rows,drafts:work.drafts},null,2)],{type:'application/json'}),'Berkas-kerja-'+state.year+'.json');
  const picker=el('input');picker.type='file';picker.accept='.json';picker.className='hidden-file';
  picker.onchange=async()=>{
    const file=picker.files?.[0];if(!file)return;
    try{
      const v=JSON.parse(await file.text());
      if(v.format!=='SCV2-KERJA'||v.versi!==1||!v.paket||v.paket!==pkg.report.manifestHash||v.tahun!==state.year||!Array.isArray(v.rows)||!Array.isArray(v.drafts))throw Error('Lembar ini harus berasal dari paket dan tahun yang sama.');
      const incoming=v.rows.map(workRow);
      validateDrafts(v.drafts);
      if(v.drafts.some(d=>d.npwp!==pkg.manifest.wp?.npwp||d.year!==state.year))throw Error('Berita acara menggunakan WP atau tahun lain.');
      const apply=()=>{work.rows.splice(0,work.rows.length,...incoming);work.drafts.splice(0,work.drafts.length,...v.drafts);state.repaint();notice('Berkas kerja berhasil dimuat.');};
      if(work.rows.length||work.drafts.length){
        const confirm=button('Ganti isi sesi ini',()=>{document.getElementById('dialog').close();apply();});
        showDialog('Ganti berkas kerja?',box('',el('p','Berkas ini berisi '+incoming.length+' butir dan '+v.drafts.length+' draf. Isi yang sedang terbuka akan diganti.'),confirm));
      }else apply();
    }catch(e){notice('Berkas kerja gagal dibuka. '+e.message,true);}finally{picker.value='';}
  };
  target.append(card('Kertas Kerja',box('toolbar',setYear,button('Unduh berkas kerja',save),button('Buka berkas kerja',()=>picker.click()),picker),toggleSet(modes,mode,s=>state.go('kerja',s))));
  if(!pkg.report.valid){target.append(card('Integritas paket perlu diperiksa',el('p','Buka rincian pada Muat paket sebelum menyusun kertas kerja.')));return;}
  if(mode==='ba'){renderDrafts(target,state,pkg,work);return;}
  const reports=work.rows.map(r=>asReport(r,state.role));
  const title=mode==='kka'?'Kertas Kerja Analisis':'Kertas Kerja Pemeriksaan';
  const controls=box('toolbar',button('Tambah butir',()=>edit(target,work,{},null,state.repaint),''),button('Excel kertas kerja',()=>exportSheets([{name:mode.toUpperCase(),rows:worksheet(reports)}],mode.toUpperCase()+'-'+state.year)),button('Word',async()=>{
    try{download(await createDocx({title,paragraphs:['Tahun pajak '+state.year,'Peran '+state.role],tables:[{title:'Butir pengujian',rows:worksheet(reports)}]}),mode.toUpperCase()+'-'+state.year+'.docx');}catch(e){notice(e.message,true);}
  }),button('Cetak / PDF',()=>window.print()));
  const summary=work.rows.filter(r=>r.status==='Selesai').length+' dari '+count(work.rows.length)+' butir selesai.';
  target.append(card(title,el('p','Lembar pengujian manual · '+summary,'hint'),controls,dataTable(reports,{name:'Lembar kerja',openRow:r=>edit(target,work,work.rows[reports.indexOf(r)],reports.indexOf(r),state.repaint),empty:'Belum ada butir. Tambahkan butir pengujian atau pilih fakta dari data sumber di bawah.'})));
  const facts=issues(pkg,state.year);target.append(card('Gunakan fakta dari paket',dataTable(facts,{name:'Fakta sumber',openRow:r=>edit(target,work,{topik:r.Butir,sumber:r.Sumber,fakta:r.Fakta+' · '+r.Periode},null,state.repaint)})));
}
