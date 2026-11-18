import {compare,count,differences,flatten,issues,label,payloads,periodFacts,rowsOf,typeNames,worksheet} from './model.js';
import {box,button,card,dataTable,detail,el,exportSheets,select,showDialog,toggleSet} from './ui.js';

function yearPicker(state,show) {
  if (!state.pkg.years.length) return el('span','Periode mengikuti isi paket.','hint');
  return select(state.pkg.years,state.year,value=>{state.year=value;show();},'Tahun pajak');
}
const printer=()=>button('Cetak / PDF',()=>window.print());
const hdate=s=>String(s || '').slice(0,10);
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
  const pkg=state.pkg;
  const modes=[['ringkasan','Ringkasan'],['butir','Semua butir'],['grafik','Laporan grafik'],['keuangan','Keuangan'],['ppn','PPN & lawan'],['potput','PPh potput & buku besar']];
  const mode=modes.some(x=>x[0]===state.section)?state.section:'ringkasan';
  const facts=periodFacts(pkg,state.year), current=pkg.forms.filter(f=>f.year===state.year && f.latest);
  const issuesFound=issues(pkg,state.year);
  target.append(card('Dasbor',box('toolbar',yearPicker(state,state.repaint),printer()),toggleSet(modes,mode,s=>state.go('ringkas',s))));
  if(mode==='ringkasan'){
    const signature=el('p',pkg.report.valid?'Semua sidik jari yang diperiksa cocok.':'Paket memiliki peringatan integritas.','notice');
    const annual=current.find(f=>f.type==='OP' || f.type==='BADAN');
    const annualFact=annual&&facts.find(r=>r.Jenis===typeNames[annual.type]);
    target.append(card('Ringkasan '+(state.year||''),signature,box('grid',
      integerCard('Masa dan jenis SPT tersedia',current.length),integerCard('Pembetulan terakhir',current.filter(f=>f.version>0).length),
      integerCard('PPh terutang tahunan',annualFact?.['PPh terutang']),integerCard('Penyerahan PPN pada induk yang tersedia',summation(facts,'Penyerahan')),
      integerCard('PPN keluaran dari induk yang tersedia',summation(facts,'PPN keluaran')),integerCard('PPN masukan dari induk yang tersedia',summation(facts,'PPN masukan')))));
    target.append(card('Butir yang dapat ditelusuri',el('p','Pemeriksaan ini mencakup pembetulan, tanggal pelaporan pada paket, dan kelengkapan berkas.','hint'),dataTable(issuesFound,{name:'Butir',filename:'Butir-'+state.year})));
  } else if(mode==='butir'){
    target.append(card('Butir dari data sumber',dataTable(issuesFound,{name:'Butir',filename:'Butir-'+state.year})));
  } else if(mode==='ppn'){
    target.append(card('Induk PPN per masa',dataTable(facts.filter(r=>r.Jenis==='PPN'),{name:'PPN'})),card('Lawan transaksi · lampiran A2 dan B2',dataTable(counterparties(pkg,state.year),{name:'Lawan transaksi'})));
  } else if(mode==='potput'){
    target.append(card('PPh potong/pungut per masa',dataTable(facts.filter(r=>r.Jenis==='PPh 21/26'||r.Jenis==='PPh Unifikasi'),{name:'Potput'})),card('Transaksi buku besar',dataTable(ledger(pkg,state.year),{name:'Buku besar'})));
  } else if(mode==='keuangan'){
    const annual=facts.filter(r=>r.Jenis===typeNames.OP||r.Jenis===typeNames.BADAN);
    target.append(card('Angka pada SPT tahunan',dataTable(annual,{name:'SPT tahunan'})));
    for(const f of current.filter(f=>f.type==='BADAN')){
      const payload=payloads(f.parts.get('induk'))[0];const accounts=[];
      function walk(value){if(!value || typeof value!=='object')return;if(value.AccountCode&&value.Description){accounts.push(value);return;}Object.values(value).forEach(walk);}
      walk(payload);target.append(card('Akun laporan keuangan',dataTable(accounts,{name:'Akun keuangan'})));
    }
  } else {
    const monthly=facts.filter(r=>r.Jenis==='PPN').sort((a,b)=>compare(a.Periode,b.Periode));
    const chart=box('chart');const values=monthly.map(r=>r.Penyerahan).filter(x=>typeof x==='number'&&x>=0);
    const max=Math.max(1,...values);
    for(const r of monthly.filter(r=>typeof r.Penyerahan==='number'&&r.Penyerahan>=0)){
      const meter=el('meter');meter.min=0;meter.max=max;meter.value=r.Penyerahan;meter.setAttribute('aria-label','Penyerahan '+r.Periode);
      chart.append(box('row',el('span',r.Periode),meter,el('strong',count(r.Penyerahan))));
    }
    target.append(card('Penyerahan PPN per masa',chart,dataTable(monthly,{name:'Gambar penyerahan'})));
  }
}
export function renderEntries(target,state,profile=false) {
  const pkg=state.pkg;
  const profileKinds=new Set(['info','pihak','bank','flag','jenispajak','alamat','klu','nomorlain','sertel','pbb','login','dokumen']);
  const entries=pkg.entries.filter(e=>profile?(e.path.startsWith('profil/')||profileKinds.has(e.cap?.sumber)):!e.path.startsWith('spt/'));
  if(!entries.length){target.append(card(profile?'Profil WP':'Data mentah',el('p','Paket ini belum memuat sumber untuk bagian ini.')));return;}
  const query=el('input');query.type='search';query.placeholder='Cari bagian atau berkas';query.setAttribute('aria-label',query.placeholder);
  const rail=box('rail'),panel=card('');let active=entries.find(e=>e.path===state.selectedEntry)||entries.find(e=>e.path==='profil/informasi-umum.json')||entries[0];
  const show=()=>{
    const filtered=entries.filter(e=>(e.path+' '+(e.cap?.label||'')).toLowerCase().includes(query.value.toLowerCase()));
    rail.replaceChildren(...filtered.map(e=>button(e.cap?.label||label(e.path),()=>{active=e;state.selectedEntry=e.path;show();},e===active?'':'secondary')));
    if(!filtered.length){rail.append(el('small','Tidak ada berkas yang cocok.'));panel.replaceChildren();return;}
    if(!filtered.includes(active)){active=filtered[0];state.selectedEntry=active.path;}
    const rows=rowsOf(active);
    const presentation=active.path==='profil/informasi-umum.json' ? rows.flatMap(r=>[...flatten(r)].map(([k,v])=>({Isian:k,Nilai:v}))) : rows;
    panel.replaceChildren(el('h2',active.cap?.label||label(active.path)),el('p',active.path,'hint'),dataTable(presentation,{name:label(active.path),filename:'Data-'+label(active.path)}),detail('Respons sumber',el('pre',JSON.stringify(active.pages,null,2))));
  };
  query.oninput=show;show();
  target.append(card(profile?'Profil WP':'Data mentah',box('toolbar',query,button('Excel semua bagian',()=>exportSheets(entries.map(e=>({name:label(e.path),rows:worksheet(rowsOf(e))})),'Bagian-data')),printer())),box('split',rail,panel));
}
function formDataView(f, part){
  const e=f.parts.get(part);const raw=rowsOf(e);
  if(part==='induk')return raw.flatMap(r=>[...flatten(r)].map(([Isian,Nilai])=>({Isian,Nilai})));
  return raw;
}
function formDialog(form,pkg,state) {
  const body=box('form-body');
  let part=form.parts.has('induk')?'induk':form.parts.keys().next().value;
  const versions=pkg.forms.filter(other=>other.type===form.type&&other.period===form.period).sort((a,b)=>b.version-a.version);
  function paint(){
    body.replaceChildren(el('p',form.key,'hint'));
    const selectPart=select([...form.parts.keys()].map(k=>[k,label(k)]),part,s=>{part=s;paint();},'Induk / lampiran');
    const version=select(versions.map(v=>[v.key,v.version?'Pembetulan '+v.version:'Normal']),form.key,k=>{form=versions.find(v=>v.key===k);part=form.parts.has(part)?part:form.parts.keys().next().value;paint();},'Versi');
    const controls=box('toolbar',version,selectPart,button('Excel formulir',()=>exportSheets([...form.parts.keys()].map(k=>({name:label(k),rows:worksheet(formDataView(form,k))})),'SPT-'+form.type+'-'+form.period+'-P'+form.version)),
      button('Cetak / PDF',()=>{document.body.classList.add('print-dialog');window.print();document.body.classList.remove('print-dialog');}));
    const before=versions.find(v=>v.version<form.version);
    const table=dataTable(formDataView(form,part),{name:label(part)});
    if(before){controls.append(button('Bandingkan versi',()=>{
      const differencesRows=differences(payloads(before.parts.get(part)),payloads(form.parts.get(part)));
      body.replaceChildren(el('h3','P'+before.version+' → P'+form.version+' · '+part),dataTable(differencesRows,{name:'Perubahan',empty:'Tidak ada perbedaan pada bagian ini.'}),button('Kembali ke formulir',paint));
    }));}
    body.append(controls,table);
  }
  paint();showDialog((typeNames[form.type]||form.type)+' · '+form.period,body);
}
export function renderSpt(target,state) {
  const pkg=state.pkg,mode=state.section==='ringkasan'?'ringkasan':'daftar';
  target.append(card('SPT',box('toolbar',yearPicker(state,state.repaint),button('Kertas Kerja',()=>state.go('kerja')),printer()),toggleSet([['daftar','Daftar & isi SPT'],['ringkasan','Ringkasan SPT']],mode,key=>state.go('spt',key))));
  const forms=pkg.forms.filter(f=>!state.year||f.year===state.year);
  const native=pkg.entries.filter(e=>/^spt(daftar|arsip|belum|isi)\//.test(e.path) &&
    (!state.year || !e.cap?.konteks?.periode || String(e.cap.konteks.periode).includes(state.year)));
  if(native.length){
    target.append(card('Tabel SPT hasil tarikan',...native.map(e=>detail(e.cap?.label||e.path,box('',el('p',e.path,'hint'),dataTable(rowsOf(e),{name:e.cap?.label||label(e.path)}))))));
  }
  if(mode==='ringkasan'){
    const types=[...new Set(forms.map(f=>f.type))];
    const summary=types.map(kind=>{const items=forms.filter(f=>f.type===kind);return {Jenis:typeNames[kind]||kind,'Masa tersedia':new Set(items.map(f=>f.period)).size,Versi:items.length,Pembetulan:items.filter(f=>f.amended).length,'Lewat batas pada sumber':items.filter(f=>f.late).length};});
    target.append(card('Ringkasan pelaporan',dataTable(summary,{name:'Pelaporan'})),card('Angka induk per masa · versi terakhir',dataTable(periodFacts(pkg,state.year),{name:'Angka induk'})));return;
  }
  const filters=state.sptFilters;const results=box('');
  const choices=[['','Semua jenis'],...[...new Set(forms.map(f=>f.type))].map(t=>[t,typeNames[t]||t])];
  if(!choices.some(([k])=>k===filters.type))filters.type='';
  const repaint=()=>{
    const shortlist=forms.filter(f=>(!filters.type||f.type===filters.type)&&(!filters.latest||f.latest)&&(!filters.late||f.late)&&(!filters.amended||f.amended));
    const links=new Map();const rows=shortlist.map(f=>{
      const r={Jenis:typeNames[f.type]||f.type,Masa:f.period,Versi:f.version,Status:f.meta.ReturnSheetStatusCode||null,BPE:f.meta.DocumentReceiptNumber||null,'Tanggal lapor':hdate(f.meta.ReturnDate),'Batas pada sumber':hdate(f.meta.ExpectedReturnDate),Ketepatan:f.late===null?'—':f.late?'Lewat batas':'Tepat','Kanal':f.meta.ChannelCode||null};
      links.set(r,f);return r;
    });
    results.replaceChildren(dataTable(rows,{name:'Daftar SPT',filename:'Daftar-SPT-'+state.year,openRow:row=>formDialog(links.get(row),pkg,state)}));
  };
  const controls=box('toolbar',select(choices,filters.type,v=>{filters.type=v;repaint();},'Jenis'));
  for(const [key,text] of [['latest','Versi terakhir'],['late','Lewat batas pada sumber'],['amended','Pembetulan']]){
    const cb=el('input');cb.type='checkbox';cb.checked=filters[key];cb.onchange=()=>{filters[key]=cb.checked;repaint();};const title=el('label');title.append(cb,document.createTextNode(' '+text));controls.append(title);
  }
  target.append(card('Daftar dan isi SPT',controls,results));repaint();
}
