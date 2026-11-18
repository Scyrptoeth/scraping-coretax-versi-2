import {createDocx} from '../archive/document.js';
import {count,issues,worksheet} from './model.js';
import {printOutput,renderDrafts} from './drafts.js';
import {validateDrafts} from './draft-model.js';
import {renderSanksi,validateSimulation} from './sanksi.js';
import {validateSchedule} from './inspection-schedule.js';
import {renderInspectionSchedule} from './inspection-schedule-ui.js';
import {renderTemporaryFindings} from './temporary-findings-ui.js';
import {validateDocumentScope} from './document-requests-output-model.js';
import {renderDocumentRequestsOutput} from './document-requests-output.js';
import {renderAssessmentSimulation} from './assessment-simulation-ui.js';
import {buildIndex,restoreIndexedRows,restoreNotes,validateIndexDocuments} from './kkp-index.js';
import {outputFilename} from './preferences.js';
import {probisRequestKey,publicGuide} from '../probis-guide.js';
import {editIndexLine,outputMenus,renderIndex} from './kkp-index-ui.js';
import {validateBusiness} from './business-work.js';
import {validateBenchmark} from './benchmark-work.js';
import {benchmarkPanel} from './benchmark-work-ui.js';
import {identifyRows,markEdit,nextIndexDocumentNumber,planMerge,progressReport,readAudit,readClearedRows,readRemovedDocuments,rowIdentity,showMergePreview,validateTimes,workAuditRows} from './team-work.js';
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
  return {...(row.teamId===undefined?{}:{teamId:row.teamId}),...Object.fromEntries([...textFields,'menurutWp','menurutPetugas'].map(key=>[key,row[key]])),
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
    out.teamId=row.teamId||'manual/'+crypto.randomUUID();
    markEdit(work,'rows',rowIdentity(out),idx===null?null:work.rows[idx],out);
    if(idx===null)work.rows.push(out);else work.rows[idx]=out;
    document.getElementById('dialog').close();repaint();notice('Butir tersimpan pada sesi ini. Unduh berkas kerja untuk membawanya ke sesi lain.');
  };
  showDialog(idx===null?'Tambah butir':'Ubah butir',form);
}
function yearWork(state,pkg,year){
  const key=JSON.stringify([pkg.report.manifestHash||pkg.fileKey,year]);
  if(!state.work.has(key))state.work.set(key,{rows:[],drafts:[]});
  return state.work.get(key);
}

export function probisRequests(state){
  const pkg=state.pkg, year=String(state.year),work=yearWork(state,pkg,year);
  const index=work.indexData??=buildIndex(pkg,year);
  function assertScope(){
    if(state.pkg!==pkg || String(state.year)!==year || !pkg.report.valid)throw Error('Paket atau tahun berubah. Buka kembali Probis untuk WP yang dipilih.');
  }
  return {year,years:pkg.years,groups:index.groups,business:work.business||{},
    saveBusiness(key,value){
      assertScope();
      const before=work.business?.[key];
      const next=validateBusiness({...work.business,[key]:value});
      work.business=next;markEdit(work,'business',key,before,next[key]);
    },
    changeYear(next){assertScope();if(pkg.years.includes(next)){state.year=next;state.repaint();}},
    open(target){assertScope();work.activeIndex=target;state.go('kerja','kkp');},
    add(row,target,ids){
      assertScope();
      if(!index.groups.some(g=>g.key===target))throw Error('Pilih indeks KKP untuk tahun ini.');
      const guide=publicGuide(row.code),docs=work.indexDocuments||[],next=[...docs],added=[],numbers=[];
      let last=nextIndexDocumentNumber(work)-1;
      for(const id of new Set(ids)){
        const choice=guide.documents.find(([key])=>key===id);
        if(!choice)throw Error('Pilih dokumen yang tersedia untuk prosedur ini.');
        const probis={klu:row.code,edition:row.year,year,procedure:guide.code,check:guide.check,document:id};
        const key=probisRequestKey(target,probis),existing=docs.find(d=>d.probis && probisRequestKey(d.index,d.probis)===key);
        if(existing){numbers.push(existing.number);continue;}
        const doc={number:++last,index:target,name:choice[1],status:'Saran',date:'',due:'',reference:'',probis};
        next.push(doc);added.push(doc);numbers.push(doc.number);
      }
      if(added.length){
        work.indexDocuments=validateIndexDocuments(next,index,year);
        for(const d of added)markEdit(work,'indexDocuments',String(d.number));
      }
      return {added,numbers};
    }
  };
}

export function renderWork(target,state) {
  const pkg=state.pkg,wp=pkg.manifest.wp,work=yearWork(state,pkg,state.year);
  work.indexNotes??={};
  work.indexDocuments??=[];
  work.editTimes??={};
  const index=()=>work.indexData??=buildIndex(pkg,state.year);
  work.scopes??={...scopeDefaults};
  work.analysis??={};
  work.dispositions??={};
  work.simulation??=validateSimulation();
  const modes=[['kkp','KKP'],['kka','KKA'],['sim','Simulasi sanksi'],['ba','Berita acara']];
  const isOutput=Object.hasOwn(outputMenus,state.section);
  const mode=isOutput||modes.some(([k])=>k===state.section)?state.section:(state.role==='Pemeriksa'?'kkp':'kka');
  const setYear=select(pkg.years,state.year,v=>{state.year=v;state.repaint();},'Tahun pajak');
  const save=()=>download(new Blob([JSON.stringify({format:'SCV2-KERJA',versi:1,paket:pkg.report.manifestHash,tahun:state.year,rows:work.rows,drafts:work.drafts,
    scopes:work.scopes,analysis:work.analysis,dispositions:work.dispositions,simulation:work.simulation,indexNotes:work.indexNotes,indexDocuments:work.indexDocuments,
    business:work.business||{},benchmark:work.benchmark||[],schedule:work.schedule,documentScope:work.documentScope,removedDocuments:work.removedDocuments||[],
    clearedRows:work.clearedRows||[],editTimes:work.editTimes,auditLog:readAudit(work.auditLog,work.editTimes)},null,2)],{type:'application/json'}),outputFilename('Berkas-kerja-'+state.year,'json',wp));
  const picker=el('input');picker.type='file';picker.accept='.json';picker.className='hidden-file';
  picker.onchange=async()=>{
    const file=picker.files?.[0],expectedYear=state.year;if(!file)return;
    try{
      const v=JSON.parse(await file.text());
      if(state.pkg!==pkg||state.year!==expectedYear)throw Error('Pilihan paket atau tahun berubah. Buka kembali berkas pada ruang kerja yang dimaksud.');
      if(v.format!=='SCV2-KERJA'||v.versi!==1||!v.paket||v.paket!==pkg.report.manifestHash||v.tahun!==state.year||!Array.isArray(v.rows)||!Array.isArray(v.drafts))throw Error('Lembar ini harus berasal dari paket dan tahun yang sama.');
      const incoming=identifyRows(restoreIndexedRows(v.rows,v.rows.map(workRow),index()));
      const indexNotes=restoreNotes(v.indexNotes,index());
      const indexDocuments=validateIndexDocuments(v.indexDocuments,index(),state.year);
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
      const data={rows:incoming,clearedRows:readClearedRows(v.clearedRows,incoming,index()),drafts:v.drafts,scopes,analysis,dispositions,simulation,indexNotes,indexDocuments,
        documentScope:v.documentScope===undefined?undefined:validateDocumentScope(v.documentScope),removedDocuments:readRemovedDocuments(v.removedDocuments,indexDocuments),
        schedule:v.schedule===undefined?undefined:validateSchedule(v.schedule),business:validateBusiness(v.business),benchmark:validateBenchmark(v.benchmark)};
      data.editTimes=validateTimes(v.editTimes,data);
      data.auditLog=readAudit(v.auditLog,data.editTimes);
      const apply=(result,merged=false)=>{
        if(merged){
          try{result.indexDocuments=validateIndexDocuments(result.indexDocuments,index(),state.year);}
          catch(e){notice('Penggabungan dibatalkan. '+e.message,true);return;}
        }
        Object.assign(work,result);state.repaint();notice(merged?'Isian berkas kerja telah digabungkan.':'Berkas kerja berhasil dimuat.');
      };
      if(work.rows.length||work.clearedRows?.length||work.drafts.length||work.indexDocuments.length||work.documentScope||work.removedDocuments?.length||Object.keys(work.analysis).length||Object.keys(work.dispositions).length ||Object.keys(work.indexNotes).length||
           work.schedule||Object.keys(work.business||{}).length||work.benchmark?.length||work.editTimes?.[JSON.stringify(['benchmark','acuan'])]||work.simulation.end||work.simulation.cases.length||Object.keys(scopeDefaults).some(k=>scopeDefaults[k]!==work.scopes[k])){
        const plan=planMerge(work,data),close=()=>document.getElementById('dialog').close();
        showDialog('Pratinjau berkas kerja',showMergePreview(plan,{merge:result=>{close();apply(result,true);},replace:()=>{close();apply(data);}}));
      }else apply(data);
    }catch(e){notice('Berkas kerja gagal dibuka. '+e.message,true);}finally{picker.value='';}
  };
  target.append(card('Kertas Kerja',box('toolbar',setYear,button('Unduh berkas kerja',save),button('Buka berkas kerja',()=>picker.click()),picker),toggleSet(modes,isOutput?'kkp':mode,s=>state.go('kerja',s))));
  if(!pkg.report.valid){target.append(card('Integritas paket perlu diperiksa',el('p','Buka rincian pada Muat paket sebelum menyusun kertas kerja.')));return;}
  const progress=progressReport(pkg,state.year,work,index());
  const showAudit=()=>showDialog('Jejak audit berkas kerja',dataTable(workAuditRows(work),{wp,name:'Riwayat perubahan',empty:'Belum ada perubahan tercatat.'}));
  target.append(card('Kemajuan pekerjaan '+state.year,el('p',progress.total?progress.done+' dari '+progress.total+' butir dan baris telah dikerjakan ('+progress.percent+'%).':'Belum ada butir atau baris KKP untuk tahun ini.'),
    el('p',progress.counts.map(([name,n,all])=>name+' '+n+'/'+all).join(' · '),'hint'),
    button('Excel laporan progres',()=>exportSheets(progress.sheets,'Kemajuan-WP-'+state.year,wp)),
    button('Lihat jejak audit',showAudit)));
  if(mode==='ba'){renderDrafts(target,state,pkg,work);return;}
  if(mode==='sim'){renderSanksi(target,state,work);return;}
  if(isOutput){
    target.append(button('Kembali ke daftar indeks',()=>state.go('kerja','kkp')));
    const renderOutput={jadwal:renderInspectionSchedule,dok:renderDocumentRequestsOutput,ts:renderTemporaryFindings,'simulasi-kkp':renderAssessmentSimulation};
    renderOutput[mode](target,state,work,index());return;
  }
  if(mode==='kkp'){
    renderIndex(target,state,work,index());
    target.append(benchmarkPanel(pkg,state.year,work.benchmark||[],rows=>{
      const before=work.benchmark||[];
      work.benchmark=validateBenchmark(rows);markEdit(work,'benchmark','acuan',before,work.benchmark);
    }));
  }
  const reports=work.rows.map(r=>asReport(r,state.role));
  const output=()=>workpaper(pkg,state.year,work,mode,state.role);
  const doc=output();
  const title=doc.title;
  const controls=box('toolbar',button('Tambah butir',()=>edit(target,work,{},null,state.repaint),''),
    button('Excel kertas kerja',()=>exportSheets(output().sheets,mode.toUpperCase()+'-'+state.year,wp,mode==='kka'?'L-0':undefined)),button('Word',async()=>{
    const name=outputFilename(mode.toUpperCase()+'-'+state.year,'docx',wp);
    try{download(await createDocx(output()),name);}catch(e){notice(e.message,true);}
  }),button('Cetak / PDF',()=>printOutput(output())));
  const summary=work.rows.filter(r=>r.status==='Selesai').length+' dari '+count(work.rows.length)+' butir selesai.';
  target.append(card(title,el('p','Hasil pengujian · '+summary,'hint'),controls,dataTable(reports,{wp,name:'Lembar kerja',openRow:r=>{
    const i=reports.indexOf(r),row=work.rows[i];
    if(row.kkpLine)editIndexLine(index().byId.get(row.kkpLine),work,state.repaint,wp);
    else edit(target,work,row,i,state.repaint);
  },empty:'Belum ada butir. Tambahkan butir pengujian atau pilih fakta dari data sumber di bawah.'})));
  if(mode==='kka'){
    const grid=box('formgrid');
    for(const [key,title] of Object.entries(analysisFields)){
      const input=el('textarea');input.value=work.analysis[key]??'';input.oninput=()=>{work.analysis[key]=input.value;};input.onchange=()=>markEdit(work,'analysis',key);
      grid.append(field(title,input));
    }
    target.append(card('Kriteria dan usulan KKA',grid));
  }
  const choice=select(scopeOptions,work.scopes[mode],value=>{work.scopes[mode]=value;markEdit(work,'scopes',mode);state.repaint();},'Temuan yang dimasukkan');
  const excluded=potentialSummary(doc.excluded);
  const omittedAmount=excluded.some(x=>x['Pokok terisi (Rp)']!==null)?
    ' Pokok indikatif terisi yang dikeluarkan Rp'+count(excluded.reduce((s,x)=>s+(x['Pokok terisi (Rp)']??0),0))+'.':'';
  target.append(card('Lingkup keluaran '+mode.toUpperCase(),choice,
    el('p',doc.selected.length+' butir disertakan. '+doc.excluded.length+' butir indikatif dikeluarkan.'+omittedAmount),
    dataTable(doc.summary,{wp,name:'Potensi pokok per jenis',empty:'Belum ada butir dalam pilihan ini.'})));
  const audit=doc.all.map(f=>({Klasifikasi:f.status,Jenis:f.kind,Periode:f.period,Rincian:f.detail,Sumber:f.source,
    'Potensi pokok (Rp)':f.amount===''?null:f.amount,Penelaahan:work.dispositions[findingKey(f)]||reviewOptions[0]}));
  target.append(card('Rincian dan penelaahan temuan',dataTable(audit,{wp,name:'Daftar temuan',openRow:r=>{
    const finding=doc.all[audit.indexOf(r)],id=findingKey(finding);
    const picker=select(reviewOptions,r.Penelaahan,v=>{work.dispositions[id]=v;markEdit(work,'dispositions',id);
      document.getElementById('dialog').close();state.repaint();},'Hasil penelaahan');
    showDialog('Penelaahan temuan',box('stack',el('p',r.Rincian),el('p',r.Sumber),picker));
  }})));
  const facts=issues(pkg,state.year);target.append(card('Gunakan fakta dari paket',dataTable(facts,{wp,name:'Fakta sumber',openRow:r=>edit(target,work,{topik:r.Butir,sumber:r.Sumber,fakta:r.Fakta+' · '+r.Periode},null,state.repaint)})));
}
