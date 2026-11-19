import {count,flatten,label,rowsOf,typeNames,worksheet} from './model.js';
import {box,button,card,dataTable,detail,el,exportSheets,select,toggleSet} from './ui.js';
import {compareDisplayed,fieldLabel,fieldValue,presentRows,sourceLabel} from './display-fields.js';
import {standardTables} from './standard-tables.js';
import {rowNotes} from './row-notes.js';
import {ledgerSelectionText} from '../ledger-status.js';

const amountFormatter=new Intl.NumberFormat('id-ID',{maximumFractionDigits:20});

export function sourceName(entry){
  if(entry.cap.sumber==='cari2')return 'Pencarian identitas wajib pajak';
  return entry.cap.label&&!entry.cap.label.includes('.json')?entry.cap.label:sourceLabel(entry.path);
}
function sourceRows(entry){
  const rows=rowsOf(entry);
  if(entry.cap.sumber!=='info'&&entry.cap.sumber!=='cari2'&&entry.path!=='profil/informasi-umum.json')return presentRows(rows);
  const out=[];
  for(const r of rows)for(const [path,value] of flatten(r)){
    const names=path.split('.').map(k=>/^\d+$/.test(k)?'Entri '+(Number(k)+1):fieldLabel(k));
    out.push({Bagian:names.slice(0,-1).join(' › ')||'Identitas',Isian:names.at(-1),Nilai:fieldValue(path,value)});
  }
  return out;
}
function original(entry){
  const pre=el('pre'),node=detail('Respons sumber',box('',el('p',entry.path,'hint'),pre));
  node.ontoggle=()=>{if(node.open&&!pre.textContent)pre.textContent=JSON.stringify(entry.pages,null,2);};
  return node;
}
function ledgerAudit(entry,wp){
  const choices=[...(entry.cap.halamanSumber||[]).map(p=>[p,'Tersimpan']),...(entry.cap.sumberSalinanIdentik||[]).map(p=>[p,'Salinan identik'])];
  const audit=choices.filter(([p])=>p.pemilihanBukuBesar).map(([p,usage])=>{
    const s=p.pemilihanBukuBesar;
    return {Sumber:p.asal||sourceName(entry),Pemakaian:usage,'Sertakan transaksi batal':s.ikutkanBatal?'Ya':'Tidak','Baris sumber':s.barisSumber,
      'Baris terpilih':s.barisTersimpan,'Keterangan penarik':ledgerSelectionText(s)};
  });
  return audit.length?detail('Pemilihan transaksi pada penarik',dataTable(audit,{wp,name:'Cakupan transaksi buku besar'})):null;
}

export function renderDataTables(target,state){
  const pkg=state.pkg,wp=pkg.manifest.wp;
  if(!pkg.entries.length){target.append(card('Data mentah',el('p','Paket ini belum memuat tabel.')));return;}
  const standard=standardTables(pkg),files=pkg.entries.map(entry=>({id:entry.path,title:sourceName(entry),family:'files',entry,
    rows:()=>sourceRows(entry)}));
  const index=new Map([...standard,...files].map(t=>[t.id,t]));
  let current=index.get(state.selectedEntry)||standard[0]||files[0];
  let mode=current.entry?'files':'standard';
  let showFlags=false;
  const query=el('input');query.type='search';query.placeholder='Cari bagian atau berkas';query.setAttribute('aria-label',query.placeholder);
  const rail=box('rail data-rail'),panel=card(''),top=card(''),mobile=box('data-picker');
  const familyName=g=>g==='lain'?'Buku besar dan registrasi':typeNames[g]||g;
  function choose(table){current=table;state.selectedEntry=table.id;render();}
  function switchMode(value){
    mode=value;query.value='';choose(mode==='standard'?standard[0]:files[0]);
  }
  function render(){
    const tables=mode==='files'?files:standard;
    const wanted=query.value.trim().toLocaleLowerCase('id');
    const matches=tables.filter(t=>(t.title+' '+t.id).toLocaleLowerCase('id').includes(wanted));
    top.replaceChildren(el('h2','Data mentah'),toggleSet([...(standard.length?[['standard','Tabel data standar']]:[]),['files','Berkas sumber']],mode,switchMode),
      box('toolbar',query,button(mode==='files'?'Excel semua berkas':'Excel semua tabel',()=>{
        exportSheets(tables.map(t=>({name:t.title,rows:worksheet(t.rows(showFlags))})),mode==='files'?'Berkas-sumber':'Tabel-data-standar',wp);
      }),button('Cetak / PDF',()=>window.print())));
    rail.replaceChildren();mobile.replaceChildren();panel.replaceChildren();
    if(!matches.length){panel.append(el('p','Tidak ada tabel yang cocok dengan pencarian.'));return;}
    if(!matches.includes(current)){current=matches[0];state.selectedEntry=current.id;}
    const items=matches.map(t=>[t.id,t.title]);mobile.append(select(items,current.id,id=>choose(index.get(id)),'Pilih tabel'));
    let previous='';
    for(const t of matches){
      if(t.family!==previous&&mode==='standard')rail.append(el('h3',familyName(t.family)));
      previous=t.family;
      const b=button(t.title,()=>choose(t),t===current?'':'secondary');
      b.setAttribute('aria-pressed',String(t===current));b.setAttribute('aria-label',t.title);
      if(mode==='standard')b.append(el('small',count(t.count)+' baris'));
      rail.append(b);
    }
    const t=current,rows=t.rows(showFlags);
    const name=t.entry?label(t.entry.path):t.title;
    panel.append(el('h2',t.title),el('p',t.note||count(rows.length)+' baris dari '+(t.entry?'berkas ini':count(t.members.length)+' berkas sumber')+'.','hint'));
    if(t.hasFlagDetails){
      const checkbox=el('input');checkbox.type='checkbox';checkbox.checked=showFlags;
      checkbox.onchange=()=>{showFlags=checkbox.checked;render();};
      const label=el('label');label.append(checkbox,document.createTextNode(' Tampilkan setiap penanda hukum dan penagihan'));panel.append(label);
    }
    panel.append(dataTable(rows,{wp,name,filename:t.title,incremental:true,csv:true,compareText:compareDisplayed,formatNumber:amountFormatter.format,rowAction:t.origin?rowNotes(pkg,t,rows):undefined}));
    if(t.entry){
      const audit=ledgerAudit(t.entry,wp);if(audit)panel.append(audit);
      panel.append(original(t.entry));
    }else{
      const filesList=box('toolbar');
      const sources=detail('Lihat berkas sumber',filesList);
      sources.ontoggle=()=>{
        if(!sources.open||filesList.childElementCount)return;
        for(const {entry} of t.members){
          filesList.append(button(sourceName(entry),()=>{mode='files';query.value='';choose(index.get(entry.path));}));
        }
      };
      panel.append(sources);
    }
  }
  query.oninput=()=>{render();query.focus();};
  render();target.append(top,mobile,box('split data-split',rail,panel));
}
