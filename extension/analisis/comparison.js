import {periodFields,receiptFields,rowsOf,sourceAmount,typeNames,worksheet} from './model.js';
import {box,button,card,dataTable,el,exportSheets,select,showDialog} from './ui.js';
import {annualRatios,measures,peerBenchmark,ratioEvidence,taxpayerId} from './peer-analysis.js';
const formKey=f=>f.type+'/'+f.period;
const versionName=n=>n?'Pembetulan '+n:'Normal';
const title=p=>[p.manifest.wp?.nama,p.manifest.wp?.npwp,p.fileName].filter(Boolean).join(' · ');
function source(pkg,kind,period,role){
  const versions=pkg.forms.filter(f=>f.type===kind&&f.period===period);
  const version=Math.max(...versions.map(f=>f.version)),latest=versions.filter(f=>f.version===version);
  const f=latest.length===1?latest[0]:null,induk=f?.parts.get('induk');
  const data=rowsOf(induk)[0]||{};
  const codes=[data.CurrencyCode,data.MainFormData?.CurrencyCode,f?.meta.CurrencyCode]
    .filter(c=>typeof c==='string'&&/^[A-Za-z]{3}$/.test(c)).map(c=>c.toUpperCase());
  const currency=codes.length&&new Set(codes).size===1?codes[0]:null;
  let condition='Induk tersedia';
  if(!f)condition='Nomor versi terakhir ganda pada sumber';
  else if(!induk||!rowsOf(induk).length)condition='Induk versi ini belum tersedia';
  else if(induk.cap?.lengkap===false)condition='Berkas induk ditandai belum lengkap';
  const basis={Peran:role,'Nama WP':pkg.manifest.wp?.nama,NPWP:pkg.manifest.wp?.npwp,Paket:pkg.fileName,
    Jenis:typeNames[kind]||kind,Masa:period,Versi:versionName(version),'Berkas induk':induk?.path,
    ...receiptFields(f?.meta),'Mata uang':currency,'Kondisi sumber':condition,'Integritas paket':pkg.report.valid?'Konsisten':'Ada peringatan'};
  return {basis,currency,form:f};
}
function comparePackages(active,other,kind,period){
  const left=source(active,kind,period,'WP aktif'),right=source(other,kind,period,'WP pembanding');
  const compatible=left.currency&&left.currency===right.currency;
  const activeCol='WP aktif · '+(active.manifest.wp?.nama||active.manifest.wp?.npwp);
  const otherCol='WP pembanding · '+(other.manifest.wp?.nama||other.manifest.wp?.npwp);
  const rows=[];
  for(const [key,path] of Object.entries(periodFields[kind]||{})){
    const a=left.form?sourceAmount(left.form,path):null,b=right.form?sourceAmount(right.form,path):null;
    const diff=compatible&&a!==null&&b!==null?a-b:null;
    rows.push({Isian:key,[activeCol]:a,[otherCol]:b,Selisih:diff,'Selisih terhadap pembanding (%)':diff===null||b===0?null:100*diff/Math.abs(b),'Kode isian induk':path});
  }
  return {sources:[left.basis,right.basis],rows,compatible};
}

const selection=new WeakMap();
function inspectRatio(state,people,metric,wp) {
  const rows=people.map(person=>ratioEvidence(person,metric));
  const content=box('',dataTable(rows,{wp,name:'Komponen rasio per WP'}));
  for(const person of people) {
    if(!person.form?.parts.has('induk'))continue;
    const pkg=person.pkg,index=pkg.forms.indexOf(person.form);
    content.append(button('Buka induk · '+(pkg.manifest.wp?.nama||pkg.manifest.wp?.npwp),()=>{
      document.getElementById('dialog').close();
      state.go('spt','form-'+pkg.formNamespace+'-'+(index+1));
    }));
  }
  showDialog(metric[1]+' · '+state.year,content);
}

export function renderFinancialRatios(target,state) {
  const result=annualRatios(state.pkg,state.year);
  const wp=state.pkg.manifest.wp;
  if(!result.form && !state.pkg.forms.some(f=>f.type==='BADAN'))return;
  const rows=measures.map(([key,label,unit,n,d])=>({Ukuran:label,Nilai:result.ratios[key],Satuan:unit,Pembilang:result.values[n].name,Penyebut:result.values[d].name}));
  target.append(card('Rasio keuangan SPT Badan',el('p',result.condition+' · '+state.year),
    dataTable(rows,{wp,name:'Rasio keuangan WP aktif',openRow:row=>inspectRatio(state,[result],measures.find(m=>m[1]===row.Ukuran),wp)})));
}

function renderPeers(target,state,saved) {
  const content=box('');
  saved.peerFiles??=new Map();
  target.append(card('Pembanding lintas paket',content));
  function paint(){
    content.replaceChildren();
    if(!state.year){content.append(el('p','Pilih tahun pajak untuk membandingkan rasio tahunan.'));return;}
    const group=peerBenchmark(state.pkg,state.packages.values(),state.year,saved.peerFiles);
    for(const [id,files] of group.alternatives){
      if(files.length<2)continue;
      const name=files[0].manifest.wp?.nama||id;
      const field=el('label','Paket pembanding untuk '+name);
      field.append(select([['','Pilih satu paket'],...files.map(p=>[p.fileKey,p.fileName])],
        saved.peerFiles.get(id)||'',v=>{saved.peerFiles.set(id,v);paint();},'Paket sumber '+name));
      content.append(field);
    }
    if(!group.rows.length){content.append(el('p','Muat paket untuk sedikitnya tiga NPWP berbeda, termasuk WP aktif. Setiap WP menyumbang satu paket.'));return;}
    const members=[group.current,...group.members];
    const groupLabel=group.sameSector?'KLU '+group.current.klu.code:'KLU campuran';
    content.append(el('p','Kelompok tahun '+state.year+' mencakup '+group.members.length+' WP pembanding · '+groupLabel+'.'),
      el('p','Median dihitung dari pembanding yang memiliki nilai untuk tiap ukuran. Deviasi di atas 50% atau di bawah −50% ditandai untuk ditelusuri. Periksa komponen dan formulir asal sebelum menarik simpulan.','hint'),
      dataTable(group.rows,{name:'Median dan rentang kelompok',openRow:row=>inspectRatio(state,members,measures.find(m=>m[1]===row.Ukuran))}));
    const roster=members.map((p,i)=>({Peran:i?'Pembanding':'WP aktif',WP:p.pkg.manifest.wp?.nama,NPWP:p.pkg.manifest.wp?.npwp,
      KLU:p.klu.code,'Dasar KLU':p.klu.basis,'Berkas KLU':p.klu.path,Paket:p.pkg.fileName,'Kondisi sumber':p.condition}));
    content.append(el('h3','WP dalam perbandingan'),dataTable(roster,{name:'Keanggotaan kelompok'}),
      button('Excel pembanding lintas paket',()=>exportSheets([
        {name:'Median dan rentang',rows:worksheet(group.rows)}, {name:'Anggota kelompok',rows:worksheet(roster)},
        {name:'Sumber dan komponen',rows:worksheet(members.flatMap(p=>measures.map(m=>ratioEvidence(p,m))))}
      ],'RAHASIA-Pembanding-Lintas-Paket-'+state.year)));
  }
  paint();
}

export function renderComparison(target,state){
  const pkg=state.pkg,id=taxpayerId(pkg);
  const options=[...state.packages.values()].filter(p=>id&&taxpayerId(p)&&taxpayerId(p)!==id);
  if(!options.length){
    target.append(card('Perbandingan antar-WP',el('p',id?'Muat paket dengan NPWP berbeda untuk membandingkan SPT.':'Paket aktif perlu memuat NPWP agar identitas kedua WP dapat dibedakan.'),button('Muat paket',()=>state.go('muat'))));
    if(id)renderPeers(target,state,{});return;
  }
  const saved=selection.get(pkg)||{};selection.set(pkg,saved);
  if(!options.some(p=>p.fileKey===saved.other))saved.other='';
  const content=box(''),picker=select([['','Pilih WP pembanding'],...options.map(p=>[p.fileKey,title(p)])],saved.other,v=>{saved.other=v;paint();},'Paket WP pembanding');
  target.append(card('Perbandingan antar-WP',el('p','WP aktif · '+title(pkg)),picker,content));
  renderPeers(target,state,saved);
  function paint(){
    content.replaceChildren();const other=options.find(p=>p.fileKey===saved.other);if(!other)return;
    const inYear=f=>!state.year||f.year===state.year;
    const peerKeys=new Set(other.forms.filter(inYear).map(formKey));
    const common=pkg.forms.filter(f=>inYear(f)&&typeNames[f.type]&&peerKeys.has(formKey(f)));
    if(!common.length){content.append(el('p','Kedua paket belum memuat jenis dan masa SPT yang sama pada tahun yang dipilih.'));return;}
    const kinds=[...new Set(common.map(f=>f.type))];
    const kind=kinds.includes(saved.kind)?saved.kind:kinds[0];
    const periods=[...new Set(common.filter(f=>f.type===kind).map(f=>f.period))].sort().reverse();
    const period=periods.includes(saved.period)?saved.period:periods[0];
    const result=comparePackages(pkg,other,kind,period);
    const controls=box('toolbar',
      select(kinds.map(t=>[t,typeNames[t]]),kind,v=>{saved.kind=v;paint();},'Jenis SPT pembanding'),
      select(periods,period,v=>{saved.period=v;paint();},'Masa atau tahun SPT'),
      button('Excel perbandingan',()=>exportSheets([{name:'Sumber kedua WP',rows:worksheet(result.sources)},{name:'Angka perbandingan',rows:worksheet(result.rows)}],'RAHASIA-Perbandingan-WP')));
    const note=result.compatible?'Selisih adalah nilai WP aktif dikurangi nilai WP pembanding. Persentase memakai nilai absolut pembanding sebagai penyebut.':
      'Nilai ditampilkan seperti tercatat di masing-masing induk. Selisih tersedia bila kedua sumber mencantumkan mata uang yang sama.';
    const flagged=result.rows.filter(r=>Math.abs(r['Selisih terhadap pembanding (%)'])>50).map(r=>r.Isian);
    content.append(controls,el('p','Perbandingan memakai versi terakhir yang tersedia pada masing-masing paket. '+note,'hint'));
    if(flagged.length)content.append(el('p','Selisih relatif melampaui 50% pada '+flagged.join(', ')+'.','notice'));
    content.append(
      dataTable(result.rows,{name:'Angka perbandingan',filename:'Angka-perbandingan',empty:'Belum ada isian yang dapat dibandingkan dari kedua sumber.'}),
      el('h3','Sumber kedua WP'),dataTable(result.sources,{name:'Sumber kedua WP',filename:'Sumber-perbandingan'}));
  }
  paint();
}
