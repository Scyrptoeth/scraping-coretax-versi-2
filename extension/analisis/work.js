import {createDocx} from '../archive/document.js';
import {count,issues,worksheet} from './model.js';
import {printOutput,renderDrafts} from './drafts.js';
import {validateDrafts} from './draft-model.js';
import {renderSanksi,validateSimulation} from './sanksi.js';
import {analysisFields,findingKey,potentialSummary,reviewOptions,scopeDefaults,scopeOptions,workpaper} from './findings.js';
import {box,button,card,dataTable,download,el,exportSheets,field,notice,select,showDialog,toggleSet} from './ui.js';

const textFields=['topik','sumber','fakta','simpulan','status','petugas'];
const statuses=['Belum diuji','Sedang diuji','Selesai','Perlu tindak lanjut'];
const evidenceOptions=[['none','Hanya lembar pengujian'],['indicative','Indikatif'],['verified','Berbukti berdasarkan dokumen']];
function workRow(row) {
  if(!row || typeof row!=='object' || textFields.some(key=>typeof row[key]!=='string'))throw Error('Format butir kerja tidak dikenali.');
  if(!statuses.includes(row.status))throw Error('Status butir tidak dikenali.');
  for(const key of ['menurutWp','menurutPetugas'])if(row[key]!==null&&!Number.isFinite(row[key]))throw Error('Nilai pengujian harus berupa angka.');
  if(row.tax!=null && typeof row.tax!=='string' || row.principal!=null && (!Number.isFinite(row.principal)||row.principal<0) ||
     row.review!=null && !reviewOptions.includes(row.review) || row.evidence!=null && !evidenceOptions.some(([key])=>key===row.evidence))
    throw Error('Klasifikasi atau nilai pokok butir tidak dikenali.');
  if(row.evidence==='verified' && (!row.fakta.trim()||!row.sumber.trim()))throw Error('Temuan berbukti memerlukan fakta dan rujukan bukti.');
  return {...Object.fromEntries([...textFields,'menurutWp','menurutPetugas'].map(key=>[key,row[key]])),
    tax:row.tax||'',principal:row.principal??null,evidence:row.evidence||'indicative',review:row.review||reviewOptions[0]};
}
function asReport(row,role){
  return {Butir:row.topik,Sumber:row.sumber,Fakta:row.fakta,'Menurut WP':row.menurutWp,['Menurut '+role]:row.menurutPetugas,Selisih:row.menurutWp!==null&&row.menurutPetugas!==null?row.menurutPetugas-row.menurutWp:null,Simpulan:row.simpulan,Status:row.status,Petugas:row.petugas};
}
function edit(parent,work,row,idx,repaint){
  const form=el('form');const inputs={};
  const labels={topik:'Butir pengujian',sumber:'Sumber / lokasi bukti',fakta:'Fakta yang ditemukan',menurutWp:'Menurut WP',menurutPetugas:'Menurut petugas',simpulan:'Simpulan',petugas:'Petugas',tax:'Jenis pajak',principal:'Potensi pokok berdasarkan pengujian (Rp)'};
  const grid=box('formgrid');
  for(const [key,title] of Object.entries(labels)){
    const input=el(['simpulan','fakta'].includes(key)?'textarea':'input');input.value=row[key]??'';
    if(['menurutWp','menurutPetugas','principal'].includes(key)){input.type='number';input.step='any';}
    if(key==='principal')input.min='0';
    if(key==='topik')input.required=true;
    inputs[key]=input;grid.append(field(title,input));
  }
  let status=row.status||statuses[0], evidence=row.evidence||(idx===null?'none':'indicative'), review=row.review||reviewOptions[0];
  const evidenceChanged=value=>{
    evidence=value;inputs.sumber.required=value==='verified';inputs.fakta.required=value==='verified';
  };
  evidenceChanged(evidence);
  const save=el('button','Simpan butir');save.type='submit';
  form.append(grid,box('toolbar',select(statuses,status,s=>status=s,'Status'),select(evidenceOptions,evidence,evidenceChanged,'Klasifikasi butir'),
    select(reviewOptions,review,v=>review=v,'Hasil penelaahan'),save));
  form.onsubmit=e=>{
    e.preventDefault();const out={status,evidence,review};
    for(const [k,input] of Object.entries(inputs))out[k]=input.type==='number'?(input.value===''?null:input.valueAsNumber):input.value.trim();
    if(!out.topik){inputs.topik.focus();return;}
    try{workRow(out);}catch(err){notice(err.message,true);return;}
    if(idx===null)work.rows.push(out);else work.rows[idx]=out;
    document.getElementById('dialog').close();repaint();notice('Butir tersimpan pada sesi ini. Unduh berkas kerja untuk membawanya ke sesi lain.');
  };
  showDialog(idx===null?'Tambah butir':'Ubah butir',form);
}
export function renderWork(target,state) {
  const pkg=state.pkg;const key=JSON.stringify([pkg.report.manifestHash||pkg.fileKey,state.year]);
  if(!state.work.has(key))state.work.set(key,{rows:[],drafts:[]});
  const work=state.work.get(key);
  work.scopes??={...scopeDefaults};
  work.analysis??={};
  work.dispositions??={};
  work.simulation??=validateSimulation();
  const modes=[['kkp','KKP'],['kka','KKA'],['sim','Simulasi sanksi'],['ba','Berita acara']];
  const mode=modes.some(([k])=>k===state.section)?state.section:(state.role==='Pemeriksa'?'kkp':'kka');
  const setYear=select(pkg.years,state.year,v=>{state.year=v;state.repaint();},'Tahun pajak');
  const save=()=>download(new Blob([JSON.stringify({format:'SCV2-KERJA',versi:1,paket:pkg.report.manifestHash,tahun:state.year,rows:work.rows,drafts:work.drafts,
    scopes:work.scopes,analysis:work.analysis,dispositions:work.dispositions,simulation:work.simulation},null,2)],{type:'application/json'}),'Berkas-kerja-'+state.year+'.json');
  const picker=el('input');picker.type='file';picker.accept='.json';picker.className='hidden-file';
  picker.onchange=async()=>{
    const file=picker.files?.[0];if(!file)return;
    try{
      const v=JSON.parse(await file.text());
      if(v.format!=='SCV2-KERJA'||v.versi!==1||!v.paket||v.paket!==pkg.report.manifestHash||v.tahun!==state.year||!Array.isArray(v.rows)||!Array.isArray(v.drafts))throw Error('Lembar ini harus berasal dari paket dan tahun yang sama.');
      const incoming=v.rows.map(workRow);
      for(const field of ['scopes','analysis','dispositions']){
        if(v[field]!==undefined && (!v[field] || typeof v[field]!=='object' || Array.isArray(v[field])))throw Error('Pengaturan lembar kerja tidak dikenali.');
      }
      const scopes={...scopeDefaults,...v.scopes},analysis=v.analysis||{},dispositions=v.dispositions||{};
      if(!Object.entries(scopes).every(([key,value])=>Object.hasOwn(scopeDefaults,key)&&scopeOptions.some(([v])=>v===value)) ||
         !Object.entries(analysis).every(([key,value])=>Object.hasOwn(analysisFields,key)&&typeof value==='string') ||
         !Object.entries(dispositions).every(([key,value])=>key.startsWith('[')&&reviewOptions.includes(value)))throw Error('Isian lingkup, KKA atau penelaahan tidak dikenali.');
      validateDrafts(v.drafts);
      const simulation=validateSimulation(v.simulation,state.year);
      if(v.drafts.some(d=>d.npwp!==pkg.manifest.wp?.npwp||d.year!==state.year))throw Error('Berita acara menggunakan WP atau tahun lain.');
      const apply=()=>{work.rows.splice(0,work.rows.length,...incoming);work.drafts.splice(0,work.drafts.length,...v.drafts);
        Object.assign(work,{scopes,analysis,dispositions,simulation});state.repaint();notice('Berkas kerja berhasil dimuat.');};
      if(work.rows.length||work.drafts.length||Object.keys(work.analysis).length||Object.keys(work.dispositions).length ||
           work.simulation.end||work.simulation.cases.length||Object.keys(scopeDefaults).some(k=>scopeDefaults[k]!==work.scopes[k])){
        const confirm=button('Ganti isi sesi ini',()=>{document.getElementById('dialog').close();apply();});
        showDialog('Ganti berkas kerja?',box('',el('p','Berkas ini berisi '+incoming.length+' butir dan '+v.drafts.length+' draf. Isi yang sedang terbuka akan diganti.'),confirm));
      }else apply();
    }catch(e){notice('Berkas kerja gagal dibuka. '+e.message,true);}finally{picker.value='';}
  };
  target.append(card('Kertas Kerja',box('toolbar',setYear,button('Unduh berkas kerja',save),button('Buka berkas kerja',()=>picker.click()),picker),toggleSet(modes,mode,s=>state.go('kerja',s))));
  if(!pkg.report.valid){target.append(card('Integritas paket perlu diperiksa',el('p','Buka rincian pada Muat paket sebelum menyusun kertas kerja.')));return;}
  if(mode==='ba'){renderDrafts(target,state,pkg,work);return;}
  if(mode==='sim'){renderSanksi(target,state,work);return;}
  const reports=work.rows.map(r=>asReport(r,state.role));
  const output=()=>workpaper(pkg,state.year,work,mode,state.role);
  const doc=output();
  const title=doc.title;
  const controls=box('toolbar',button('Tambah butir',()=>edit(target,work,{},null,state.repaint),''),button('Excel kertas kerja',()=>exportSheets(output().sheets,mode.toUpperCase()+'-'+state.year)),button('Word',async()=>{
    try{download(await createDocx(output()),mode.toUpperCase()+'-'+state.year+'.docx');}catch(e){notice(e.message,true);}
  }),button('Cetak / PDF',()=>printOutput(output())));
  const summary=work.rows.filter(r=>r.status==='Selesai').length+' dari '+count(work.rows.length)+' butir selesai.';
  target.append(card(title,el('p','Lembar pengujian manual · '+summary,'hint'),controls,dataTable(reports,{name:'Lembar kerja',openRow:r=>edit(target,work,work.rows[reports.indexOf(r)],reports.indexOf(r),state.repaint),empty:'Belum ada butir. Tambahkan butir pengujian atau pilih fakta dari data sumber di bawah.'})));
  if(mode==='kka'){
    const grid=box('formgrid');
    for(const [key,title] of Object.entries(analysisFields)){
      const input=el('textarea');input.value=work.analysis[key]??'';input.oninput=()=>{work.analysis[key]=input.value;};
      grid.append(field(title,input));
    }
    target.append(card('Kriteria dan usulan KKA',grid));
  }
  const choice=select(scopeOptions,work.scopes[mode],value=>{work.scopes[mode]=value;state.repaint();},'Temuan yang dimasukkan');
  const excluded=potentialSummary(doc.excluded);
  const omittedAmount=excluded.some(x=>x['Pokok terisi (Rp)']!==null)?
    ' Pokok indikatif terisi yang dikeluarkan Rp'+count(excluded.reduce((s,x)=>s+(x['Pokok terisi (Rp)']??0),0))+'.':'';
  target.append(card('Lingkup keluaran '+mode.toUpperCase(),choice,
    el('p',doc.selected.length+' butir disertakan. '+doc.excluded.length+' butir indikatif dikeluarkan.'+omittedAmount),
    dataTable(doc.summary,{name:'Potensi pokok per jenis',empty:'Belum ada butir dalam pilihan ini.'})));
  const audit=doc.all.map(f=>({Klasifikasi:f.status,Jenis:f.kind,Periode:f.period,Rincian:f.detail,Sumber:f.source,
    'Potensi pokok (Rp)':f.amount===''?null:f.amount,Penelaahan:work.dispositions[findingKey(f)]||reviewOptions[0]}));
  target.append(card('Rincian dan penelaahan temuan',dataTable(audit,{name:'Daftar temuan',openRow:r=>{
    const finding=doc.all[audit.indexOf(r)],id=findingKey(finding);
    const picker=select(reviewOptions,r.Penelaahan,v=>{work.dispositions[id]=v;
      document.getElementById('dialog').close();state.repaint();},'Hasil penelaahan');
    showDialog('Penelaahan temuan',box('stack',el('p',r.Rincian),el('p',r.Sumber),picker));
  }})));
  const facts=issues(pkg,state.year);target.append(card('Gunakan fakta dari paket',dataTable(facts,{name:'Fakta sumber',openRow:r=>edit(target,work,{topik:r.Butir,sumber:r.Sumber,fakta:r.Fakta+' · '+r.Periode},null,state.repaint)})));
}
