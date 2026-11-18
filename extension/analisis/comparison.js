import {periodFields,rowsOf,sourceAmount,typeNames,worksheet} from './model.js';
import {box,button,card,dataTable,el,exportSheets,select} from './ui.js';

function taxpayerId(pkg){
  const raw=String(pkg.manifest.wp?.npwp??'').replace(/[.\s-]/g,'');
  return /^\d{15,16}$/.test(raw)&&!/^0+$/.test(raw)?raw.padStart(16,'0'):'';
}
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
    BPE:f?.meta.DocumentReceiptNumber,'Mata uang':currency,'Kondisi sumber':condition,'Integritas paket':pkg.report.valid?'Konsisten':'Ada peringatan'};
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
export function renderComparison(target,state){
  const pkg=state.pkg,id=taxpayerId(pkg);
  const options=[...state.packages.values()].filter(p=>id&&taxpayerId(p)&&taxpayerId(p)!==id);
  if(!options.length){
    target.append(card('Perbandingan antar-WP',el('p',id?'Muat paket dengan NPWP berbeda untuk membandingkan SPT.':'Paket aktif perlu memuat NPWP agar identitas kedua WP dapat dibedakan.'),button('Muat paket',()=>state.go('muat'))));return;
  }
  const saved=selection.get(pkg)||{};selection.set(pkg,saved);
  if(!options.some(p=>p.fileKey===saved.other))saved.other='';
  const content=box(''),picker=select([['','Pilih WP pembanding'],...options.map(p=>[p.fileKey,title(p)])],saved.other,v=>{saved.other=v;paint();},'Paket WP pembanding');
  target.append(card('Perbandingan antar-WP',el('p','WP aktif · '+title(pkg)),picker,content));
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
    content.append(controls,el('p','Perbandingan memakai versi terakhir yang tersedia pada masing-masing paket. '+note,'hint'),
      dataTable(result.rows,{name:'Angka perbandingan',filename:'Angka-perbandingan',empty:'Belum ada isian yang dapat dibandingkan dari kedua sumber.'}),
      el('h3','Sumber kedua WP'),dataTable(result.sources,{name:'Sumber kedua WP',filename:'Sumber-perbandingan'}));
  }
  paint();
}
