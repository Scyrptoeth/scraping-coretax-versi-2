import {compare,count,issues,label,payloads,periodFacts,rowsOf,typeNames} from './model.js';
import {box,button,card,dataTable,detail,el,select,toggleSet} from './ui.js';
import {renderProfile} from './profile.js';
import {renderComparison,renderFinancialRatios} from './comparison.js';
import {renderAdvanced} from './advanced-dashboard.js';
import {renderDataTables} from './read-tables.js';
import {dashboardMetrics} from './dashboard-metrics.js';
import {dashboardFollowUp} from './dashboard-follow-up.js';
import {dashboardIndicationReview} from './work.js';
import {exportControls,financialPosition,formPanel,formReceipts,indicativeDates,openForm,periodTitle,printSptList,reportDateBasis,summaryPanels} from './spt-forms.js';
import {fieldValue,presentRows} from './display-fields.js';
import {normalizeId} from '../app-data.js';
import {planSptDetails,rangeIsValid,sptListContext} from '../app-spt-plan.js';

function yearPicker(state,show) {
  if (!state.pkg.years.length) return el('span','Periode mengikuti isi paket.','hint');
  return select(state.pkg.years,state.year,value=>{state.year=value;show();},'Tahun pajak');
}
const printer=()=>button('Cetak / PDF',()=>window.print());
function integerCard(name,value,status='') {
  return box('kpi',el('small',name),el('b',value==null?'—':count(value)),status&&el('small',status));
}
function summation(rows,key) {
  const items=rows.filter(r=>Object.hasOwn(r,key));
  if(!items.length || items.some(r=>typeof r[key]!=='number'))return null;
  return items.reduce((total,r)=>total+r[key],0);
}
function ledger(pkg,year) {
  const seen=new Set(), rows=[];
  for(const e of pkg.entries.filter(e=>e.path.startsWith('bukubesar/')&&(!year||e.path.includes('/'+year+'-')))){
    for(const row of rowsOf(e)){
      if(row.RecordId && seen.has(row.RecordId))continue;
      if(row.RecordId)seen.add(row.RecordId); rows.push(row);
    }
  }
  return rows;
}
function counterparties(pkg,year) {
  const byPartner=new Map();
  for(const form of pkg.forms.filter(f=>f.latest&&f.type==='PPN'&&(!year||f.year===year))){
    for(const [part,kind] of [['a2','Keluaran'],['b2','Masukan']]){
      for(const row of rowsOf(form.parts.get(part))){
        const id=String(row.TIN??'');const name=String(row.Name??'');const key=JSON.stringify([kind,id,name]);
        if(!byPartner.has(key))byPartner.set(key,{Jenis:kind,NPWP:id,Nama:name,Faktur:0,DPP:null,PPN:null,_dpp:true,_vat:true});
        const p=byPartner.get(key);p.Faktur++;
        for(const [col,valid,field] of [['DPP','_dpp','TaxBase'],['PPN','_vat','VAT']]){
          if(typeof row[field]==='number')p[col]=(p[col]??0)+row[field];else p[valid]=false;
        }
      }
    }
  }
  return [...byPartner.values()].map(({_dpp,_vat,...r})=>({...r,DPP:_dpp?r.DPP:null,PPN:_vat?r.PPN:null})).sort((a,b)=>b.Faktur-a.Faktur);
}
export function renderDashboard(target,state) {
  const pkg=state.pkg,wp=pkg.manifest.wp;
  const modes=[['ringkasan','Ringkasan'],['butir','Semua butir'],['grafik','Laporan grafik'],['keuangan','Keuangan'],['ppn','PPN & lawan'],['potput','PPh potput & buku besar'],['lanjutan','Lanjutan'],['banding','Perbandingan antar-WP']];
  const mode=modes.some(x=>x[0]===state.section)?state.section:'ringkasan';
  const facts=periodFacts(pkg,state.year), current=pkg.forms.filter(f=>f.year===state.year && f.latest);
  const issuesFound=issues(pkg,state.year);
  const scope=el('p',[wp?.nama,wp?.npwp&&'NPWP '+wp.npwp,state.year&&'Tahun pajak '+state.year,state.role&&'Peran '+state.role].filter(Boolean).join(' · '),'hint');
  target.append(card('Dasbor',scope,box('toolbar',yearPicker(state,state.repaint),printer()),toggleSet(modes,mode,s=>state.go('ringkas',s))));
  if(mode==='banding'){renderComparison(target,state);return;}
  if(mode==='lanjutan'){renderAdvanced(target,state);return;}
  if(mode==='ringkasan'){
    const signature=el('p',pkg.report.valid?'Semua sidik jari yang diperiksa cocok.':'Paket memiliki peringatan integritas.','notice');
    const annual=current.find(f=>f.type==='OP' || f.type==='BADAN');
    const annualFact=annual&&facts.find(r=>r.Jenis===typeNames[annual.type]);
    const allMetrics=dashboardMetrics(pkg,state.year);
    const corporate=pkg.forms.some(f=>f.type==='BADAN')||allMetrics.find(m=>m.id==='sales').sources.length>0;
    const coverage=[integerCard('Masa dan jenis SPT tersedia',current.length),integerCard('Pembetulan terakhir',current.filter(f=>f.version>0).length),
      integerCard('PPN keluaran dari induk yang tersedia',summation(facts,'PPN keluaran')),integerCard('PPN masukan dari induk yang tersedia',summation(facts,'PPN masukan'))];
    const metrics=allMetrics.filter(m=>corporate||(['payments','outstanding'].includes(m.id)&&m.sources.length));
    const display=metrics.map(m=>{
      const value=m.value??m.observedValue??null;
      return {...m,displayValue:value,status:value===null?'Belum dapat dihitung':m.incomplete?'Data sebagian':'Sesuai cakupan paket'};
    });
    const evidence=display.map(m=>({Indikator:m.label,'Nilai (Rp)':m.displayValue,Cakupan:m.status,
      Perhitungan:m.detail,'Berkas sumber':m.sources.join('\n')}));
    const overview=corporate?[]:[integerCard('PPh terutang tahunan',annualFact?.['PPh terutang']),
      integerCard('Penyerahan PPN pada induk yang tersedia',summation(facts,'Penyerahan')),...coverage];
    const summary=card('Ringkasan '+(state.year||''),signature,box('grid',...overview,
      ...display.map(m=>integerCard(m.label,m.displayValue,m.incomplete||m.displayValue===null?m.status:''))));
    if(evidence.length)summary.append(detail('Perhitungan dan sumber indikator',dataTable(evidence,{wp,name:'Sumber indikator dasbor'})));
    if(corporate)summary.append(detail('Cakupan SPT tahun ini',box('grid',...coverage)));
    target.append(summary);
    target.append(dashboardFollowUp(state));
    target.append(card('Butir yang dapat ditelusuri',el('p','Pemeriksaan ini mencakup pembetulan, tanggal pelaporan pada paket, dan kelengkapan berkas.','hint'),dataTable(issuesFound,{wp,name:'Butir',filename:'Butir-'+state.year})));
  } else if(mode==='butir'){
    target.append(card('Butir dari data sumber',dataTable(issuesFound,{wp,name:'Butir',filename:'Butir-'+state.year})),dashboardIndicationReview(state));
  } else if(mode==='ppn'){
    target.append(card('Induk PPN per masa',dataTable(facts.filter(r=>r.Jenis==='PPN'),{wp,name:'PPN'})),card('Lawan transaksi · lampiran A2 dan B2',dataTable(counterparties(pkg,state.year),{wp,name:'Lawan transaksi'})));
  } else if(mode==='potput'){
    target.append(card('PPh potong/pungut per masa',dataTable(facts.filter(r=>r.Jenis==='PPh 21/26'||r.Jenis==='PPh Unifikasi'),{wp,name:'Potput'})),card('Transaksi buku besar',dataTable(ledger(pkg,state.year),{wp,name:'Buku besar'})));
  } else if(mode==='keuangan'){
    const annual=facts.filter(r=>r.Jenis===typeNames.OP||r.Jenis===typeNames.BADAN);
    target.append(card('Angka pada SPT tahunan',dataTable(annual,{wp,name:'SPT tahunan'})));
    renderFinancialRatios(target,state);
    for(const f of current.filter(f=>f.type==='BADAN')){
      const payload=payloads(f.parts.get('induk'))[0];const accounts=[];
      function walk(value){if(!value || typeof value!=='object')return;if(value.AccountCode&&value.Description){accounts.push(value);return;}Object.values(value).forEach(walk);}
      walk(payload);target.append(card('Akun laporan keuangan',dataTable(accounts,{wp,name:'Akun keuangan'})));
    }
  } else {
    const monthly=facts.filter(r=>r.Jenis==='PPN').sort((a,b)=>compare(a.Periode,b.Periode));
    const chart=box('chart');const values=monthly.map(r=>r.Penyerahan).filter(x=>typeof x==='number'&&x>=0);
    const max=Math.max(1,...values);
    for(const r of monthly.filter(r=>typeof r.Penyerahan==='number'&&r.Penyerahan>=0)){
      const meter=el('meter');meter.min=0;meter.max=max;meter.value=r.Penyerahan;meter.setAttribute('aria-label','Penyerahan '+r.Periode);
      chart.append(box('row',el('span',r.Periode),meter,el('strong',count(r.Penyerahan))));
    }
    target.append(card('Penyerahan PPN per masa',chart,dataTable(monthly,{wp,name:'Gambar penyerahan'})));
  }
}
export function renderEntries(target,state,profile=false) {
  if(profile)return renderProfile(target,state);
  return renderDataTables(target,state);
}

function submittedList(pkg) {
  const entries=pkg.entries.filter(entry=>entry.path==='spt/daftar.json'||entry.cap?.sumber==='sptdaftar');
  const records=entries.flatMap(rowsOf);
  if(!records.length)return null;
  const captured=new Map();
  for(const form of pkg.forms.filter(form=>form.listedRow)){
    const row=form.listedRow;
    captured.set(row,captured.has(row)?null:form);
  }
  const readable=(key,value,unknown)=>{
    const displayed=fieldValue(key,value);
    return /^[A-Z0-9]+(?:_[A-Z0-9]+)+$/.test(displayed)?unknown:displayed;
  };
  const links=new Map();
  const items=records.map(row=>{
    const {form,period,revision,typeConflict}=sptListContext(row);
    const selected=captured.get(row);
    const parent=selected?.parts.get('induk');
    const data={
      'Jenis SPT':form&&!typeConflict?readable('ReturnSheetTypeCode',form,'Jenis belum dikenali'):'Jenis belum dikenali',
      'Masa pajak':period?periodTitle(period.label):row['Masa Pajak']||null,
      Versi:revision===null?'Versi belum diketahui':revision===0?'Normal':'Pembetulan '+revision,
      'Status pelaporan':readable('ReturnSheetStatusCode',row.ReturnSheetStatusCode??row['Status SPT'],'Status belum dikenali'),
      'Nomor bukti penerimaan':row['Nomor Bukti Penerimaan']??row.BpsNo??row.DocumentReceiptNumber??null,
      ...(pkg.forms.length?{'Isi SPT':parent?(parent.cap?.konteks?.cuplikanTampilan?'Cuplikan induk':'Induk tersedia'):
        selected?'Lampiran tersedia':captured.has(row)?'Perlu dicocokkan':'Belum tercocok dengan paket'}:{})
    };
    if(selected)links.set(data,selected);
    return {year:period?.year?.toString(),data};
  });
  const years=[...new Set(items.map(item=>item.year).filter(Boolean))].sort().reverse();
  const kinds=[...new Set(items.map(item=>item.data['Jenis SPT']))].sort(compare);
  const table=box(''),total=el('p',null,'hint');
  let year='',kind='';
  const repaint=()=>{
    const shown=items.filter(item=>(!year||item.year===year)&&(!kind||item.data['Jenis SPT']===kind)).map(item=>item.data);
    total.textContent=count(shown.length)+' dari '+count(items.length)+' baris daftar SPT ditampilkan.';
    table.replaceChildren(dataTable(shown,{wp:pkg.manifest.wp,name:'Daftar pelaporan SPT',filename:'Daftar-pelaporan-SPT',csv:true,
      rowAction:pkg.forms.length?{title:'Rincian',control:row=>links.has(row)?
        button('Buka',()=>openForm(links.get(row),pkg)):el('span','—')}:undefined}));
  };
  const wp=normalizeId(pkg.manifest.wp?.npwp),period=pkg.manifest.opsi?.periode;
  const planned=!pkg.forms.length&&wp&&rangeIsValid(period)?planSptDetails({wp,period,items:entries,strictReceipts:true}).counts.versions:0;
  repaint();
  return box('',el('p',pkg.forms.length?'Daftar pelaporan mencakup masa dan versi yang tercatat pada sumber. Kolom Isi SPT menunjukkan formulir yang dapat dicocokkan dengan paket.':
    planned?count(planned)+' versi dalam periode tarikan tercatat pada daftar. Induk dan lampirannya masih perlu ditarik.':
    'Daftar pelaporan tersedia dalam paket. Induk dan lampiran dapat dilihat setelah berhasil ditarik.','hint'),
    box('toolbar',select([['','Semua tahun'],...years],'',value=>{year=value;repaint();},'Tahun pajak'),
      select([['','Semua jenis SPT'],...kinds],'',value=>{kind=value;repaint();},'Jenis SPT')),
    total,table);
}

export function renderSpt(target,state) {
  const pkg=state.pkg,wp=pkg.manifest.wp,mode=state.section==='ringkasan'?'ringkasan':'daftar';
  target.append(card('SPT',box('toolbar',mode==='ringkasan'?yearPicker(state,state.repaint):null,button('KKP',()=>state.go('kerja','kkp')),button('KKA',()=>state.go('kerja','kka')),printer()),toggleSet([['daftar','Daftar & isi SPT'],['ringkasan','Ringkasan SPT']],mode,key=>state.go('spt',key))));
  const native=pkg.entries.filter(e=>/^spt(daftar|arsip|belum|isi)\//.test(e.path) ||
    /^spt\/(?:daftar|arsip|belum-dilaporkan)\.json$/.test(e.path));
  const archiveTables=native.length?detail('Tabel SPT hasil tarikan',box('',el('p','Tabel sumber mencakup seluruh periode dalam berkas.','hint'),...native.map(e=>detail(e.cap?.label||label(e.path),dataTable(presentRows(rowsOf(e)),{wp,name:e.cap?.label||label(e.path)}))))):null;
  if(mode==='ringkasan'){
    const forms=pkg.forms.filter(f=>!state.year||f.year===state.year);
    const types=[...new Set(forms.map(f=>f.type))];
    const summary=types.map(kind=>{const items=forms.filter(f=>f.type===kind);return {Jenis:typeNames[kind]||kind,'Masa tersedia':new Set(items.map(f=>f.period)).size,Versi:items.length,Pembetulan:items.filter(f=>f.amended).length,'Lewat batas pada sumber':items.filter(f=>f.late).length};});
    target.append(card('Ringkasan pelaporan',dataTable(summary,{wp,name:'Pelaporan'})),card('Angka induk per masa · versi terakhir',dataTable(periodFacts(pkg,state.year),{wp,name:'Angka induk'})),...summaryPanels(forms,state.year,wp).filter(Boolean));
    if(archiveTables)target.append(archiveTables);
    return;
  }
  const forms=pkg.forms;
  if(!forms.length){
    const list=submittedList(pkg);
    target.append(card('Daftar dan isi SPT',list??el('p','Paket ini belum memuat induk atau lampiran SPT yang bisa dibuka.','hint'),archiveTables));
    return;
  }
  const filters=state.sptFilters;const results=box('');
  const submitted=submittedList(pkg);
  const kinds=[...new Set(forms.map(f=>f.type))].sort((a,b)=>compare(typeNames[a]||a,typeNames[b]||b));
  if(!kinds.includes(filters.type))filters.type='';
  const position=new Map();
  function balance(form){
    if(!position.has(form))position.set(form,financialPosition(form,wp));
    return position.get(form);
  }
  const dates=indicativeDates(forms,pkg);
  const revised=new Set(forms.filter(f=>f.amended).map(f=>f.type+'/'+f.period));
  const selectedYear=()=>filters.allYears?'':state.year;
  const years=filterCounts('Tahun pajak','Semua tahun',pkg.years.map(y=>[y,y]),v=>{
    filters.allYears=!v;if(v)state.year=v;repaint();
  });
  const types=filterCounts('Jenis','Semua jenis',kinds.map(t=>[t,typeNames[t]||t]),v=>{filters.type=v;repaint();});
  const repaint=()=>{
    const candidates=forms.filter(f=>(!filters.latest||f.latest)&&(!filters.late||f.filingLate)&&(!filters.amended||f.amended)&&(!filters.revised||revised.has(f.type+'/'+f.period))&&(!filters.balance||filters.balance===balance(f).status));
    const yr=selectedYear(),byYear=candidates.filter(f=>!yr||f.year===yr),byType=candidates.filter(f=>!filters.type||f.type===filters.type);
    types.update(filters.type,byYear,'type');years.update(yr,byType,'year');
    const shortlist=byYear.filter(f=>!filters.type||f.type===filters.type);
    const links=new Map();const rows=shortlist.map(f=>{
      const {status,amount,basis}=balance(f);
      const r={Jenis:typeNames[f.type]||f.type,Masa:f.period,Versi:f.version?'Pembetulan '+f.version:'Normal','Status nilai':status,'Nilai pada induk':amount,
        ...formReceipts(f.meta),'Status pelaporan':fieldValue('ReturnSheetStatusCode',f.meta.ReturnSheetStatusCode)||null,'Dasar nilai':basis,
        'Tanggal lapor':f.reportDate,'Batas pada sumber':f.dueDate,'Batas setelah akhir pekan':f.filingDueDate,
        Ketepatan:f.filingLate==null?'—':f.filingLate?'Lewat batas':'Tepat',Kanal:fieldValue('ChannelCode',f.meta.ChannelCode)||null,
        'Dasar tanggal lapor':reportDateBasis(f)};
      if(dates.has(f))r['Tanggal setoran indikatif']=dates.get(f);
      links.set(r,f);return r;
    });
    for(const key of ['Kanal','Tanggal lapor','Batas pada sumber','Dasar tanggal lapor'])if(!rows.some(r=>r[key]))for(const r of rows)delete r[key];
    const panel=el('section',null,'spt-preview-panel'),list=box('spt-result-list');
    panel.setAttribute('aria-label','Formulir SPT pilihan');panel.id='spt-selected-form';panel.tabIndex=-1;
    const mark=form=>{
      filters.active=form.key;
      for(const control of list.querySelectorAll('.spt-period'))control.setAttribute('aria-pressed',String(control.dataset.key===form.key));
    };
    function preview(form,fromList=false){
      const back=button('Kembali ke daftar SPT',()=>list.querySelector('.spt-period[aria-pressed="true"]')?.focus(),'spt-back');
      mark(form);panel.replaceChildren(back,el('h3',(typeNames[form.type]||form.type)+' · '+periodTitle(form.period)),formPanel(form,pkg,mark));
      if(fromList&&window.matchMedia('(max-width:900px)').matches)panel.focus();
    }
    const full=el('input');full.type='checkbox';full.checked=Boolean(filters.columns);
    const columns=el('label',null,'spt-list-columns');columns.append(full,document.createTextNode(' Tampilkan semua kolom'));
    full.onchange=()=>{filters.columns=full.checked;list.classList.toggle('spt-compact-list',!full.checked);};
    list.classList.toggle('spt-compact-list',!full.checked);
    const table=dataTable(rows,{wp,name:'Daftar SPT',filename:'Daftar-SPT-'+(yr||'semua-tahun'),
      printRows:items=>printSptList(items,wp),
      openRow:row=>{const form=links.get(row);preview(form);openForm(form,pkg);},
      decorateRow:(tr,row)=>{
        const form=links.get(row),cell=tr.cells[2],pick=button(periodTitle(form.period),()=>preview(form,true),'spt-period');
        pick.dataset.key=form.key;pick.dataset.period=form.period;pick.setAttribute('aria-controls',panel.id);pick.setAttribute('aria-pressed',String(filters.active===form.key));
        pick.title='Tampilkan '+row.Jenis+' · '+periodTitle(form.period)+' · '+row.Versi;
        cell.replaceChildren(pick);
        tr.addEventListener('click',e=>{if(!e.target.closest('button,a,input'))preview(form,true);});
      }});
    if(rows.length){
      list.append(columns,table);
      preview(shortlist.find(f=>f.key===filters.active)||shortlist[0]);
      results.replaceChildren(exportControls(shortlist,pkg),box('spt-workspace',list,panel));
    }else results.replaceChildren(el('p','Tidak ada formulir yang cocok dengan filter.','hint'));
  };
  const controls=box('toolbar',select([['','Semua nilai'],'Nihil','Kurang bayar','Lebih bayar','Belum tersedia'],filters.balance||'',v=>{filters.balance=v;repaint();},'Status nilai pada induk'));
  for(const [key,text] of [['latest','Versi terakhir'],['late','Lewat batas setelah akhir pekan'],['amended','Pembetulan'],['revised','Masa yang pernah dibetulkan']]){
    const cb=el('input');cb.type='checkbox';cb.checked=filters[key];cb.onchange=()=>{filters[key]=cb.checked;repaint();};const title=el('label');title.append(cb,document.createTextNode(' '+text));controls.append(title);
  }
  const basisNote=forms.some(f=>f.type==='UNIFIKASI')?el('p','Untuk PPh Unifikasi, kolom nilai memakai jumlah yang disetor pada induk. Periksa buku besar untuk menentukan sisa kewajiban.','hint'):null;
  const later=forms.some(f=>f.laterListed)?el('p','Sebagian masa memiliki versi lebih baru pada daftar pelaporan. Lepaskan centang Versi terakhir untuk melihat formulir yang sudah tersedia.','hint'):null;
  target.append(card('Daftar dan isi SPT',years.element,types.element,controls,later,results,basisNote,dates.size?el('p','Tanggal setoran berasal dari pembayaran dengan KAP dan masa yang sama dengan kewajiban SPT di buku besar. Periksa alokasi pembayaran pada dokumen sumber.','hint'):null,
    submitted?detail('Daftar pelaporan dan ketersediaan formulir',submitted):null,archiveTables));repaint();
}

function filterCounts(title,all,values,change){
  const choices=[['',all],...values],picker=select(choices,'',change,title),buttons=box('chips spt-filter-buttons');
  buttons.setAttribute('role','group');buttons.setAttribute('aria-label','Filter '+title.toLowerCase()+' SPT');
  const items=choices.map(([value,label])=>{
    const choice=button(label,()=>change(value)),badge=el('span','0','spt-count');
    choice.append(badge);buttons.append(choice);return {value,label,choice,badge};
  });
  return {element:box('spt-filter-row',picker,buttons),update(current,forms,field){
    const counts=new Map([['',forms.length]]);
    for(const f of forms)counts.set(f[field],(counts.get(f[field])||0)+1);
    picker.querySelector('select').value=current;
    for(const {value,label,choice,badge} of items){
      const n=count(counts.get(value)||0);badge.textContent=n;
      choice.setAttribute('aria-pressed',String(value===current));choice.setAttribute('aria-label',label+', '+n+' formulir SPT');
    }
  }};
}
