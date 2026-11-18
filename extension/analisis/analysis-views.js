import {compare,count,flatten,issues,label,payloads,periodFacts,receiptFields,rowsOf,typeNames,worksheet} from './model.js';
import {box,button,card,dataTable,detail,el,exportSheets,select,toggleSet} from './ui.js';
import {renderProfile} from './profile.js';
import {renderComparison,renderFinancialRatios} from './comparison.js';
import {renderAdvanced} from './advanced-dashboard.js';
import {combinedLedger} from './ledger-table.js';
import {dashboardMetrics} from './dashboard-metrics.js';
import {exportControls,financialPosition,indicativeDates,openForm,summaryPanels} from './spt-forms.js';

function yearPicker(state,show) {
  if (!state.pkg.years.length) return el('span','Periode mengikuti isi paket.','hint');
  return select(state.pkg.years,state.year,value=>{state.year=value;show();},'Tahun pajak');
}
const printer=()=>button('Cetak / PDF',()=>window.print());
function integerCard(name,value) {
  return box('kpi',el('small',name),el('b',value==null?'—':count(value)));
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
  target.append(card('Dasbor',box('toolbar',yearPicker(state,state.repaint),printer()),toggleSet(modes,mode,s=>state.go('ringkas',s))));
  if(mode==='banding'){renderComparison(target,state);return;}
  if(mode==='lanjutan'){renderAdvanced(target,state);return;}
  if(mode==='ringkasan'){
    const signature=el('p',pkg.report.valid?'Semua sidik jari yang diperiksa cocok.':'Paket memiliki peringatan integritas.','notice');
    const annual=current.find(f=>f.type==='OP' || f.type==='BADAN');
    const annualFact=annual&&facts.find(r=>r.Jenis===typeNames[annual.type]);
    const corporate=pkg.forms.some(f=>f.type==='BADAN');
    const coverage=[integerCard('Masa dan jenis SPT tersedia',current.length),integerCard('Pembetulan terakhir',current.filter(f=>f.version>0).length),
      integerCard('PPN keluaran dari induk yang tersedia',summation(facts,'PPN keluaran')),integerCard('PPN masukan dari induk yang tersedia',summation(facts,'PPN masukan'))];
    if(corporate){
      const metrics=dashboardMetrics(pkg,state.year);
      const evidence=metrics.map(m=>({Indikator:m.label,'Nilai (Rp)':m.value,Perhitungan:m.detail,'Berkas sumber':m.sources.join('\n')}));
      target.append(card('Ringkasan '+state.year,signature,box('grid',...metrics.map(m=>integerCard(m.label,m.value))),
        detail('Perhitungan dan sumber indikator',dataTable(evidence,{wp,name:'Sumber indikator dasbor'})),
        detail('Cakupan SPT tahun ini',box('grid',...coverage))));
    }else{
      target.append(card('Ringkasan '+(state.year||''),signature,box('grid',
        integerCard('PPh terutang tahunan',annualFact?.['PPh terutang']),integerCard('Penyerahan PPN pada induk yang tersedia',summation(facts,'Penyerahan')),...coverage)));
    }
    target.append(card('Butir yang dapat ditelusuri',el('p','Pemeriksaan ini mencakup pembetulan, tanggal pelaporan pada paket, dan kelengkapan berkas.','hint'),dataTable(issuesFound,{wp,name:'Butir',filename:'Butir-'+state.year})));
  } else if(mode==='butir'){
    target.append(card('Butir dari data sumber',dataTable(issuesFound,{wp,name:'Butir',filename:'Butir-'+state.year})));
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
  if(profile) return renderProfile(target,state);
  const pkg=state.pkg,wp=pkg.manifest.wp;
  const entries=pkg.entries.filter(e=>!e.path.startsWith('spt/'));
  if(!entries.length){target.append(card('Data mentah',el('p','Paket ini belum memuat sumber untuk bagian ini.')));return;}
  const combined=combinedLedger(entries);
  const allLedger=combined && {path:'bukubesar/gabungan',cap:{label:'Buku besar gabungan'}};
  const tables=combined?[allLedger,...entries]:entries;
  const dataFor=e=>e===allLedger?combined.rows:rowsOf(e);
  const query=el('input');query.type='search';query.placeholder='Cari bagian atau berkas';query.setAttribute('aria-label',query.placeholder);
  const rail=box('rail'),panel=card('');let active=tables.find(e=>e.path===state.selectedEntry)||entries.find(e=>e.path==='profil/informasi-umum.json')||tables[0];
  const show=()=>{
    const filtered=tables.filter(e=>(e.path+' '+(e.cap?.label||'')).toLowerCase().includes(query.value.toLowerCase()));
    rail.replaceChildren(...filtered.map(e=>button(e.cap?.label||label(e.path),()=>{active=e;state.selectedEntry=e.path;show();},e===active?'':'secondary')));
    if(!filtered.length){rail.append(el('small','Tidak ada berkas yang cocok.'));panel.replaceChildren();return;}
    if(!filtered.includes(active)){active=filtered[0];state.selectedEntry=active.path;}
    const rows=dataFor(active);
    const presentation=active.path==='profil/informasi-umum.json' ? rows.flatMap(r=>[...flatten(r)].map(([k,v])=>({Isian:k,Nilai:v}))) : rows;
    panel.replaceChildren(el('h2',active.cap?.label||label(active.path)),
      el('p',active===allLedger?combined.sourceCount+' berkas bulanan. '+combined.omitted+' salinan identik dengan ID yang sama digabung. '+combined.conflicting+' ID mempunyai isi berbeda.':active.path,'hint'),
      dataTable(presentation,{wp,name:label(active.path),filename:'Data-'+label(active.path),incremental:true}));
    if(active!==allLedger){
      const source=active,pre=el('pre'),raw=detail('Respons sumber',pre);
      raw.ontoggle=()=>{if(raw.open && !pre.textContent)pre.textContent=JSON.stringify(source.pages,null,2);};
      panel.append(raw);
    }
  };
  query.oninput=show;show();
  target.append(card('Data mentah',box('toolbar',query,button('Excel semua bagian',()=>exportSheets(tables.map(e=>({name:e===allLedger?'Buku besar gabungan':label(e.path),rows:worksheet(dataFor(e))})),'Bagian-data',wp)),printer())),box('split',rail,panel));
}
export function renderSpt(target,state) {
  const pkg=state.pkg,wp=pkg.manifest.wp,mode=state.section==='ringkasan'?'ringkasan':'daftar';
  target.append(card('SPT',box('toolbar',yearPicker(state,state.repaint),button('Kertas Kerja',()=>state.go('kerja')),printer()),toggleSet([['daftar','Daftar & isi SPT'],['ringkasan','Ringkasan SPT']],mode,key=>state.go('spt',key))));
  const forms=pkg.forms.filter(f=>!state.year||f.year===state.year);
  const native=pkg.entries.filter(e=>/^spt(daftar|arsip|belum|isi)\//.test(e.path) ||
    /^spt\/(?:daftar|arsip|belum-dilaporkan)\.json$/.test(e.path));
  if(native.length){
    target.append(card('Tabel SPT hasil tarikan',el('p','Tabel sumber mencakup seluruh periode dalam berkas. Filter tahun berlaku pada daftar formulir di bawah.','hint'),...native.map(e=>detail(e.cap?.label||e.path,box('',el('p',e.path,'hint'),dataTable(rowsOf(e),{wp,name:e.cap?.label||label(e.path)}))))));
  }
  if(mode==='ringkasan'){
    const types=[...new Set(forms.map(f=>f.type))];
    const summary=types.map(kind=>{const items=forms.filter(f=>f.type===kind);return {Jenis:typeNames[kind]||kind,'Masa tersedia':new Set(items.map(f=>f.period)).size,Versi:items.length,Pembetulan:items.filter(f=>f.amended).length,'Lewat batas pada sumber':items.filter(f=>f.late).length};});
    target.append(card('Ringkasan pelaporan',dataTable(summary,{wp,name:'Pelaporan'})),card('Angka induk per masa · versi terakhir',dataTable(periodFacts(pkg,state.year),{wp,name:'Angka induk'})),...summaryPanels(forms,state.year,wp).filter(Boolean));return;
  }
  const filters=state.sptFilters;const results=box('');
  const choices=[['','Semua jenis'],...[...new Set(forms.map(f=>f.type))].map(t=>[t,typeNames[t]||t])];
  if(!choices.some(([k])=>k===filters.type))filters.type='';
  const balances=new Map(forms.map(f=>[f,financialPosition(f)]));
  const dates=indicativeDates(forms,pkg);
  const revised=new Set(forms.filter(f=>f.amended).map(f=>f.type+'/'+f.period));
  const repaint=()=>{
    const shortlist=forms.filter(f=>(!filters.type||f.type===filters.type)&&(!filters.latest||f.latest)&&(!filters.late||f.filingLate)&&(!filters.amended||f.amended)&&(!filters.revised||revised.has(f.type+'/'+f.period))&&(!filters.balance||filters.balance===balances.get(f).status));
    const links=new Map();const rows=shortlist.map(f=>{
      const {status,amount,basis}=balances.get(f);
      const r={Jenis:typeNames[f.type]||f.type,Masa:f.period,Versi:f.version?'Pembetulan '+f.version:'Normal','Status pelaporan':f.meta.ReturnSheetStatusCode||null,'Status nilai':status,'Nilai pada induk':amount,'Dasar nilai':basis,...receiptFields(f.meta),'Tanggal lapor':f.reportDate,'Batas pada sumber':f.dueDate,'Batas setelah akhir pekan':f.filingDueDate,Ketepatan:f.filingLate==null?'—':f.filingLate?'Lewat batas':'Tepat',Kanal:f.meta.ChannelCode||null};
      if(dates.has(f))r['Tanggal setoran indikatif']=dates.get(f);
      links.set(r,f);return r;
    });
    for(const key of ['Kanal','Tanggal lapor','Batas pada sumber'])if(!rows.some(r=>r[key]))for(const r of rows)delete r[key];
    results.replaceChildren(exportControls(shortlist,pkg),dataTable(rows,{wp,name:'Daftar SPT',filename:'Daftar-SPT-'+state.year,openRow:row=>openForm(links.get(row),pkg)}));
  };
  const controls=box('toolbar',select(choices,filters.type,v=>{filters.type=v;repaint();},'Jenis'),select([['','Semua nilai'],'Nihil','Kurang bayar','Lebih bayar','Belum tersedia'],filters.balance||'',v=>{filters.balance=v;repaint();},'Status nilai pada induk'));
  for(const [key,text] of [['latest','Versi terakhir'],['late','Lewat batas setelah akhir pekan'],['amended','Pembetulan'],['revised','Masa yang pernah dibetulkan']]){
    const cb=el('input');cb.type='checkbox';cb.checked=filters[key];cb.onchange=()=>{filters[key]=cb.checked;repaint();};const title=el('label');title.append(cb,document.createTextNode(' '+text));controls.append(title);
  }
  const basisNote=forms.some(f=>f.type==='UNIFIKASI')?el('p','Untuk PPh Unifikasi, kolom nilai memakai jumlah yang disetor pada induk. Periksa buku besar untuk menentukan sisa kewajiban.','hint'):null;
  target.append(card('Daftar dan isi SPT',controls,basisNote,dates.size?el('p','Tanggal setoran berasal dari pembayaran dengan KAP dan masa yang sama dengan kewajiban SPT di buku besar. Periksa alokasi pembayaran pada dokumen sumber.','hint'):null,results));repaint();
}
