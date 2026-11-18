import {packageLedger} from './profile.js';
import {rowsOf,sptDay,submittedDay,worksheet} from './model.js';
import {box,button,card,dataTable,el,exportSheets,select,showDialog} from './ui.js';

function sourceRows(pkg,source,path) {
  return pkg.entries.filter(e=>e.cap?.sumber===source||e.path===path)
    .flatMap(e=>rowsOf(e).map(r=>({...r,'Berkas sumber':e.path})));
}
function isoDay(value) {
  const text=String(value??'').slice(0,10);
  if(!/^(19|20)\d{2}-\d{2}-\d{2}$/.test(text))return '';
  const date=new Date(text+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===text?text:'';
}
function periodYear(value) {
  const period=String(value??'');
  if(/^\d{4}(?:-\d\d)?$/.test(period))return period.slice(0,4);
  return /^\d{4}\d{4}$/.test(period)?period.slice(-4):'';
}
export function eventsFor(pkg,year) {
  const events=[];
  function add(date,group,caption,source,taxYear='',reference='') {
    const day=isoDay(date);
    if(!day || (year&&taxYear&&taxYear!==year))return;
    events.push({Tanggal:day,Kelompok:group,Peristiwa:caption,'Tahun pajak':taxYear||null,Rujukan:reference||null,'Berkas sumber':source});
  }
  for(const row of sourceRows(pkg,'info','profil/informasi-umum.json')){
    const info=row.GeneralInformation||{};
    add(info.RegistrationDate,'Registrasi','WP terdaftar',row['Berkas sumber']);
    add(info.ActivationDate,'Registrasi','Aktivasi akun',row['Berkas sumber']);
  }
  const registration=[
    ['jenispajak','jenis-pajak','Jenis pajak',['TaxTypeName','TaxTypeCode'],['RegistrationDate','ValidFrom'],['DeregistrationDate','RevocationDate','ValidTo']],
    ['alamat','alamat','Lokasi kegiatan',['ActivityName','AddressDetail'],['ValidFrom'],['ValidTo']],
    ['sertel','sertifikat-elektronik','Sertifikat elektronik',['CertificateType','Status'],['ValidFrom','IssueDate'],['ValidTo','ExpiryDate']],
    ['klu','klu','KLU',['TradeClassificationCode'],['ValidFrom'],['ValidTo']]
  ];
  for(const [id,path,label,labels,from,to] of registration){
    for(const r of sourceRows(pkg,id,'profil/'+path+'.json')){
      const caption=labels.map(k=>r[k]).find(Boolean)||'';
      for(const [term,keys] of [['Mulai',from],['Berakhir',to]]){
        add(keys.map(k=>r[k]).find(v=>isoDay(v)),'Registrasi',[term,label,caption].filter(Boolean).join(' · '),r['Berkas sumber']);
      }
    }
  }
  for(const r of sourceRows(pkg,'flag','profil/flag-wp.json'))if(r.FlagValue===true||r.FlagValue==='true')add(r.ValidFrom||r.StartDate||r.CreatedDate,'Penanda',r.FlagType,r['Berkas sumber'],periodYear(r.TaxPeriod),r.CaseNumber);
  for(const r of sourceRows(pkg,'dokumen','profil/dokumen.json'))add(r.DocumentDate||r.IssueDate||r.CreatedDate,'Dokumen',r.DocumentTitle||r.DocumentTypeCode||'Dokumen',r['Berkas sumber'],'',r.DocumentNumber);
  const kinds={VAT_VATR:'PPN',VAT_VATTRNTEVATC:'PPN pemungut',ICT_RCITR:'PPh Badan',ICT_PITR:'PPh OP',ICT_WITR:'PPh 21/26',ICT_WTR:'PPh Unifikasi'};
  for(const r of sourceRows(pkg,'sptdaftar','spt/daftar.json')){
    const reported=submittedDay(r), due=sptDay(r.ExpectedReturnDate);
    const late=due && reported>due;
    const amendment=/amend|pembetulan|correction/i.test(r.ReturnSheetModel||'');
    const group=amendment?'Pembetulan SPT':late?'SPT melewati tanggal pada sumber':'Pelaporan SPT';
    add(reported,group,[kinds[r.ReturnSheetTypeCode]||r.ReturnSheetTypeCode,r.TaxPeriodCode,r.ReturnSheetModel].filter(Boolean).join(' · '),r['Berkas sumber'],periodYear(r.TaxPeriodCode),r.DocumentReceiptNumber);
  }
  for(const r of packageLedger(pkg)){
    if(r.IsCancelled===true||r.IsCancelled==='true')continue;
    if(r.AccountingTypeCode!=='TaxNotice'&&!['TaxAssessment','NoticeOfTaxCollection'].includes(r.ReferenceType))continue;
    add(r.PostingDate||r.TransactionDate,'Ketetapan dan tagihan',[r.ReferenceType||r.AccountingTypeCode,r.RevenueCode].filter(Boolean).join(' · '),
      r['Berkas sumber'],periodYear(r.PeriodCode),r.ReferenceNumber);
  }
  return events.sort((a,b)=>a.Tanggal.localeCompare(b.Tanggal));
}

const normalizeName=value=>String(value??'').normalize('NFKC').toLocaleUpperCase('id').replace(/\b(?:PT|CV|TBK|PERSERO|UD|FA)\b\.?/g,'').replace(/[^\p{L}\p{N}]/gu,'');
const endpoints=new WeakMap();
const point=(kind,id,label)=>({key:JSON.stringify([kind,id||label]),label});
export function linksFor(pkg,year) {
  const rows=[],partners=new Map(),me=point('wp','wp',pkg.manifest.wp?.nama||'WP aktif');
  function row(from,to,type,name,id,path,amount=null,count=null) {
    const record={Dari:from.label,Ke:to.label,Jenis:type,'Nama pihak':name,Identitas:id||null,'Dasar pengenaan':amount,Dokumen:count,'Berkas sumber':path};
    endpoints.set(record,[from,to]);rows.push(record);
  }
  const inYear=r=>(!year||(!isoDay(r.ValidFrom)||isoDay(r.ValidFrom)<=year+'-12-31')&&(!isoDay(r.ValidTo)||isoDay(r.ValidTo)>=year+'-01-01'));
  for(const r of sourceRows(pkg,'pihak','profil/pihak-terkait.json').filter(inYear))if(r.PersonName){
    row(me,point('pihak',r.PersonNIKTIN,r.PersonName),'Pihak terkait',r.PersonName,r.PersonNIKTIN,r['Berkas sumber']);
  }
  for(const r of sourceRows(pkg,'alamat','profil/alamat.json').filter(inYear)){
    if(r.TypeOfAddress==='NATIONAL')continue;
    const address=[r.ActivityName,r.AddressDetail].filter(Boolean).join(' · ');if(!address)continue;
    const place=point('alamat','',address);
    row(me,place,'Lokasi kegiatan',address,'',r['Berkas sumber']);
    if(r.LandLordName)row(point('pemilik','',r.LandLordName),place,'Pemilik lokasi',r.LandLordName,'',r['Berkas sumber']);
  }
  function addPartner(kind,id,name,base,path) {
    if(!name&&!id)return;
    const key=JSON.stringify([kind,id||String(name).toLocaleUpperCase('id').trim()]);
    if(!partners.has(key))partners.set(key,{kind,id,names:new Set(),total:0,complete:true,count:0,paths:new Set()});
    const p=partners.get(key);p.names.add(name||id);p.paths.add(path);p.count++;
    if(typeof base==='number'&&Number.isFinite(base))p.total+=base;else p.complete=false;
  }
  const current=new Map();
  for(const f of pkg.forms.filter(f=>f.type==='PPN'&&(!year||f.year===year))){
    const past=current.get(f.period);
    if(!past||f.version>past[0].version)current.set(f.period,[f]);
    else if(f.version===past[0].version)past.push(f);
  }
  for(const versions of current.values())if(versions.length===1) {
    for(const [part,label] of [['a2','Pembeli'],['b2','Pemasok']]){
      const entry=versions[0].parts.get(part);
      for(const r of rowsOf(entry))addPartner(label,r.TIN,r.Name,r.TaxBase,entry.path);
    }
  }
  for(const entry of pkg.entries.filter(e=>e.cap?.sumber==='bplawan'||e.path.startsWith('bukti-potong-lawan/'))){
    for(const r of rowsOf(entry))if(!year||String(r.__Y||periodYear(r.TaxPeriodCode))===year)addPartner('Pemotong',r.WitholderTin,r.WitholderName,r.TaxBase,entry.path);
  }
  const organizers=rows.filter(r=>['Pihak terkait','Pemilik lokasi'].includes(r.Jenis));
  for(const kind of ['Pembeli','Pemasok','Pemotong']){
    const sorted=[...partners.values()].filter(p=>p.kind===kind).sort((a,b)=>Number(b.complete)-Number(a.complete)||b.total-a.total||b.count-a.count);
    for(const p of sorted.slice(0,6)){
      const name=[...p.names].join(' / '),path=[...p.paths].join('\n');
      const partner=point(kind,p.id,name);
      row(kind==='Pembeli'?me:partner,kind==='Pembeli'?partner:me,kind,name,p.id,path,p.complete?p.total:null,p.count);
      if(p.names.size!==1)continue;
      const key=normalizeName(name);
      for(const r of organizers)if(key && key===normalizeName(r['Nama pihak'])){
        const organizer=endpoints.get(r)[r.Jenis==='Pihak terkait'?1:0];
        row(organizer,partner,'Nama serupa · periksa identitas',name,p.id,[r['Berkas sumber'],path].join('\n'));
      }
    }
  }
  return rows;
}

function sourceDialog(state,record) {
  const paths=String(record['Berkas sumber']||'').split('\n').filter(Boolean);
  const body=box('',dataTable(Object.entries(record).map(([Isian,Nilai])=>({Isian,Nilai})),{name:'Rincian sumber'}));
  for(const path of new Set(paths)){
    const entry=state.pkg.entries.find(e=>e.path===path);if(!entry)continue;
    const form=state.pkg.forms.find(f=>[...f.parts.values()].includes(entry));
    body.append(button('Buka '+path,()=>showDialog(path,dataTable(rowsOf(entry),{name:'Tabel sumber'}))));
    if(form)body.append(button('Buka formulir '+form.type+' · '+form.period,()=>{
      document.getElementById('dialog').close();state.go('spt','form-'+state.pkg.formNamespace+'-'+(state.pkg.forms.indexOf(form)+1));
    }));
  }
  showDialog(record.Peristiwa||record.Jenis||'Rincian',body);
}

function svg(name,attributes) {
  const node=document.createElementNS('http://www.w3.org/2000/svg',name);
  for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);
  return node;
}
function yearChart(rows,year,onSelect) {
  if(!rows.length)return el('p','Belum ada tanggal untuk ditampilkan.','hint');
  const buckets=new Map();
  for(const row of rows){
    if(year&&!row.Tanggal.startsWith(year))continue;
    const period=row.Tanggal.slice(0,year?7:4);
    buckets.set(period,(buckets.get(period)||0)+1);
  }
  const values=[...buckets].sort(([a],[b])=>a.localeCompare(b));
  if(!values.length)return el('p','Belum ada peristiwa pada tahun ini.','hint');
  const position=value=>Number(year?value.slice(5):value);
  const start=year?1:position(values[0][0]),end=year?12:position(values.at(-1)[0]);
  const chart=svg('svg',{width:'100%',viewBox:'0 0 720 92',role:'group','aria-label':year?'Garis waktu per bulan':'Garis waktu per tahun'});
  chart.append(svg('line',{x1:26,x2:694,y1:54,y2:54,stroke:'currentColor','stroke-opacity':'0.45'}));
  const max=Math.max(...buckets.values());let lastLabel=-80;
  for(const [period,count] of values){
    const x=end===start?360:32+655*(position(period)-start)/(end-start);
    const size=8+24*Math.sqrt(count/max),caption=period+' · '+count+' peristiwa';
    const point=svg('g',{role:'button',tabindex:'0','aria-label':caption});
    const title=svg('title',{});title.textContent=caption;point.append(title);
    point.append(svg('line',{x1:x,y1:54,x2:x,y2:54-size,stroke:'currentColor'}),svg('circle',{cx:x,cy:54-size,r:6,fill:'var(--accent)'}));
    if(x-lastLabel>=48){
      const label=svg('text',{x,y:76,'text-anchor':'middle','font-size':13,fill:'currentColor'});
      label.textContent=year?period.slice(5):period;point.append(label);lastLabel=x;
    }
    point.onclick=()=>onSelect(period);point.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(period);}};
    chart.append(point);
  }
  return chart;
}
function relationshipDiagram(rows,wp,open) {
  if(!rows.length)return el('p','Belum ada pihak atau lokasi yang dapat dipetakan.','hint');
  const me=point('wp','wp',wp),points=new Map();
  for(const row of rows)for(const node of endpoints.get(row)){
    if(node.key!==me.key&&!points.has(node.key))points.set(node.key,{...node,row});
  }
  const height=Math.max(105,Math.ceil(points.size/2)*46+22);
  const graph=svg('svg',{viewBox:'0 0 720 '+height,width:'100%',role:'group','aria-label':'Diagram hubungan WP'});
  const positions=new Map([[me.key,[360,height/2]]]);
  [...points.keys()].forEach((k,i)=>positions.set(k,[i%2===0?145:575,28+Math.floor(i/2)*46]));
  for(const r of rows){
    const [left,right]=endpoints.get(r);
    const a=positions.get(left.key),b=positions.get(right.key);
    const match=r.Jenis.startsWith('Nama serupa');
    graph.append(svg('line',{x1:a[0],y1:a[1],x2:b[0],y2:b[1],stroke:'currentColor','stroke-opacity':match?'0.85':'0.3','stroke-dasharray':match?'6 4':'none'}));
  }
  for(const [key,[x,y]] of positions){
    const identity=key===me.key,rel=points.get(key)?.row,name=points.get(key)?.label||wp;
    const node=svg('g',rel?{role:'button',tabindex:'0','aria-label':'Rincian '+name}:{});
    node.append(svg('circle',{cx:x,cy:y,r:identity?10:6,fill:'currentColor'}));
    const caption=svg('text',{x,y:y+17,'text-anchor':'middle','font-size':12,fill:'currentColor'});
    const title=svg('title',{});title.textContent=name;
    caption.textContent=name.length>33?name.slice(0,31)+'…':name;
    node.append(caption,title);if(rel){node.onclick=()=>open(rel);node.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();open(rel);}};}
    graph.append(node);
  }
  return graph;
}
export function renderAdvanced(target,state) {
  const events=eventsFor(state.pkg,state.year),links=linksFor(state.pkg,state.year);
  const timeline=box(''),chart=box(''),periods=box('toolbar'),categories=[...new Set(events.map(r=>r.Kelompok))];
  let category='',byDate='',month='';
  const categoriesControl=select([['','Semua jenis peristiwa'],...categories],category,value=>{category=value;byDate='';month='';paint();},'Jenis peristiwa');
  function paint(){
    const available=events.filter(r=>!category||r.Kelompok===category);
    const years=[...new Set(available.map(r=>r.Tanggal.slice(0,4)))];
    periods.replaceChildren(...[['','Semua tahun kejadian'],...years.map(y=>[y,y])].map(([y,txt])=>{
      const b=button(txt,()=>{byDate=y;month='';paint();},y===byDate?'':'secondary');b.setAttribute('aria-pressed',String(y===byDate));return b;
    }));
    chart.replaceChildren(yearChart(available,byDate,p=>{byDate=p.slice(0,4);month=p.length===7?p:'';paint();}));
    const period=month||byDate;
    timeline.replaceChildren();
    if(month)timeline.append(el('p','Peristiwa bulan '+month));
    timeline.append(dataTable(available.filter(r=>!period||r.Tanggal.startsWith(period)),{name:'Kronologi peristiwa',openRow:r=>sourceDialog(state,r)}));
  }
  target.append(card('Garis waktu WP',el('p','Lihat riwayat registrasi dan dokumen bersama pelaporan serta ketetapan tahun pajak terpilih. Pilih titik untuk menelusuri tahun atau bulan kejadian.','hint'),categoriesControl,periods,chart,timeline));
  paint();
  target.append(card('Peta hubungan WP',el('p','Peta mencakup pihak terkait, lokasi, pemilik lokasi dan hingga enam lawan transaksi per kelompok. Kecocokan nama perlu dikonfirmasi melalui identitas dan dokumen.','hint'),
    relationshipDiagram(links,state.pkg.manifest.wp?.nama||'WP aktif',r=>sourceDialog(state,r)),dataTable(links,{name:'Hubungan dan sumber',openRow:r=>sourceDialog(state,r)}),
    button('Excel garis waktu dan hubungan',()=>exportSheets([{name:'Garis waktu',rows:worksheet(events)},{name:'Hubungan',rows:worksheet(links)}],'RAHASIA-Riwayat-Hubungan-'+state.year))));
}
