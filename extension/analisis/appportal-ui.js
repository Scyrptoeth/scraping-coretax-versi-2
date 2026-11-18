import {delimitedRows} from '../app-data.js';
import {readXlsx} from '../archive/read-table.js';
import {sha256} from '../archive/package.js';
import {fieldCaption,fieldsFor,inferHeader,inferMapping,inferType,mappingLabels,portalSheets,portalTypes,reconcileAppportal} from './appportal.js';
import {readPref,setPref} from './preferences.js';
import {box,button,card,dataTable,detail,el,exportSheets,field,notice,select} from './ui.js';

const sessions=new WeakMap();
function checkbox(label,checked,change){
  const input=el('input');input.type='checkbox';input.checked=checked;
  input.onchange=()=>change(input.checked);
  const wrap=el('label');wrap.append(input,document.createTextNode(' '+label));return wrap;
}
function decode(bytes){
  const enc=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
  return new TextDecoder(enc,{fatal:true}).decode(bytes);
}
export async function readPortalFile(file){
  const bytes=new Uint8Array(await file.arrayBuffer()),hash=await sha256(bytes);
  let sheets;
  if(bytes[0]===80&&bytes[1]===75)sheets=await readXlsx(bytes,{includeLayout:true});
  else{
    if(bytes[0]===0xd0&&bytes[1]===0xcf)throw Error('Buka XLS biner di Excel lalu simpan sebagai XLSX atau CSV.');
    let text;try{text=decode(bytes);}catch{throw Error('Simpan teks sebagai CSV UTF-8 atau workbook XLSX.');}
    if(/^\s*</.test(text)&&/<table[\s>]/i.test(text)){
      // Template contents stay inert, including resources and links in an HTML export.
      const fragment=el('template');fragment.innerHTML=text;
      sheets=[...fragment.content.querySelectorAll('table')].filter(t=>!t.parentElement?.closest('table')).map((table,i)=>({
        name:'Tabel '+(i+1),rows:[...table.rows].map(row=>[...row.cells].map(cell=>cell.textContent.trim()))
      }));
    }else{
      if(!/\.(?:csv|txt)$/i.test(file.name))throw Error('Gunakan XLSX, CSV, TXT atau tabel HTML.');
      const lines=text.split(/\r?\n/).slice(0,40);
      const header=lines.find(line=>/(?:nomor|faktur|document.?number|no[. _]?(?:pib|peb))/i.test(line)&&/[,;\t]/.test(line))
        ||lines.find(line=>/[,;\t]/.test(line));
      sheets=[{name:'Tabel',rows:delimitedRows(text,header,true)}];
    }
  }
  sheets=sheets.filter(s=>s.rows.some(row=>row.some(v=>String(v??'').trim())));
  if(!sheets.length)throw Error('Berkas belum memuat lembar dengan judul kolom.');
  const type=inferType(file.name,sheets[0].rows.slice(0,5).flat().slice(0,160));
  const f={name:file.name,hash,imported:new Date().toISOString(),sheets,type,sheetIndex:0,scope:true,group:false,confirmed:false};
  changeTable(f);await restoreMapping(f);return f;
}
function changeTable(f,header){
  const sheet=f.sheets[f.sheetIndex];f.rows=sheet.rows;f.rowNumbers=sheet.rowNumbers;f.date1904=sheet.date1904;
  f.header=header??inferHeader(f.rows,f.type);
  f.mapping=inferMapping(f.rows[f.header],f.type);f.packageMapping={};f.confirmed=false;
}
async function prefKey(f){
  const schema=f.rows[f.header].map(v=>String(v??'').trim().toLowerCase());
  return 'portal-mapping-'+f.type+'-'+await sha256(JSON.stringify(schema));
}
async function restoreMapping(f){
  const header=f.rows[f.header],type=f.type,signature=await prefKey(f),text=readPref(signature);
  if(!text||f.rows[f.header]!==header||f.type!==type)return false;
  let stored;try{stored=JSON.parse(text);}catch{return false;}
  if(!fieldsFor(f.type).every(k=>Number.isInteger(stored?.[k])&&stored[k]>=-1&&stored[k]<header.length))return false;
  f.mapping=stored;f.confirmed=false;return true;
}
function filePanel(f,pkg,state,session){
  const panel=card(f.name),settings=box(''),results=box('');
  const redraw=()=>draw();
  function draw(){
    settings.replaceChildren();results.replaceChildren();
    settings.append(select(Object.entries(portalTypes).map(([t,v])=>[t,v.label]),f.type,v=>{f.type=v;changeTable(f);redraw();},'Jenis data appportal'));
    if(f.sheets.length>1)settings.append(select(f.sheets.map((s,i)=>[i,s.name]),f.sheetIndex,v=>{f.sheetIndex=Number(v);changeTable(f);redraw();},'Lembar sumber'));
    const header=el('input');header.type='number';header.min=1;header.max=f.rowNumbers?.at(-1)??f.rows.length;header.value=f.rowNumbers?.[f.header]??f.header+1;
    header.onchange=()=>{
      const index=f.rowNumbers?f.rowNumbers.indexOf(header.valueAsNumber):header.valueAsNumber-1;
      if(Number.isInteger(index)&&index>=0&&index<f.rows.length)changeTable(f,index);
      redraw();
    };
    settings.append(field('Baris judul kolom',header));
    const headerRow=f.rows[f.header],columns=[[-1,'Tidak dipakai'],...Array.from(headerRow,(name,i)=>[i,(i+1)+' · '+String(name??'')])];
    const fields=box('toolbar');for(const k of fieldsFor(f.type)){
      fields.append(select(columns,f.mapping[k],v=>{f.mapping[k]=Number(v);f.confirmed=false;redraw();},fieldCaption(f.type,k)));
    }
    const save=button('Simpan pemetaan',async()=>{const mapping=JSON.stringify(f.mapping),signature=await prefKey(f);setPref(signature,mapping);notice('Pemetaan tersimpan untuk susunan kolom ini.');});
    const restore=button('Gunakan pemetaan tersimpan',async()=>{
      if(!await restoreMapping(f)){notice('Belum ada pemetaan tersimpan untuk susunan kolom ini.');return;}
      redraw();notice('Pemetaan diterapkan.');
    });
    settings.append(fields,box('toolbar',save,restore));
    results.append(checkbox('Hanya masa yang SPT-nya ada di paket',f.scope,v=>{f.scope=v;redraw();}),
      checkbox('Jumlahkan baris barang per nomor dokumen',f.group,v=>{f.group=v;redraw();}),
      checkbox('Saya sudah mencocokkan WP pemilik berkas dengan WP aktif',f.confirmed,v=>{f.confirmed=v;redraw();}));
    let report;
    try{report=reconcileAppportal(pkg,{...f,year:state.year});}
    catch(e){results.append(el('p',e.message,'notice'));return;}
    const sourceFields=box('toolbar');
    for(const k of ['number','base','vat'])sourceFields.append(select([['','Otomatis'],...report.columns],f.packageMapping[k]||'',
      v=>{f.packageMapping[k]=v;redraw();},'Kolom SPT · '+mappingLabels[k]));
    settings.append(sourceFields);
    const opts={...f,year:state.year,wp:pkg.manifest.wp,role:state.role,sheet:f.sheets[f.sheetIndex].name,manifestHash:pkg.report.manifestHash};
    const exclude=report.excluded;
    results.append(el('p',report.left+' baris appportal dalam cakupan · '+report.right+' baris lampiran SPT · '+portalTypes[f.type].parts.join(' + ').toUpperCase()),
      el('p',exclude.tahun+' baris di luar tahun, '+exclude.masa+' tanpa masa yang terbaca, '+exclude.tanpaSpt+' pada masa tanpa SPT dan '+exclude.versiGanda+' pada masa dengan dua versi terakhir.','hint'),
      box('toolbar',button('Excel rekonsiliasi',()=>{
        exportSheets(portalSheets(report,{...opts,date:new Date().toISOString()}),'Rekonsiliasi-'+opts.type+'-'+opts.year,opts.wp);
      })),dataTable(report.summary,{name:'Ringkasan '+f.type,wp:opts.wp}),
      detail('Periksa panjang nomor dokumen',dataTable(report.diagnostics,{name:'Panjang nomor '+f.type,wp:opts.wp})),
      detail('Rincian per masa',dataTable(report.months,{name:'Per masa '+f.type,wp:opts.wp})),
      detail('Cakupan lampiran SPT',dataTable(report.coverage,{name:'Cakupan '+f.type,wp:opts.wp})));
    let selected='';
    const rows=box('');const paint=()=>rows.replaceChildren(dataTable(selected?report.details.filter(r=>r.Status===selected):report.details,
      {name:'Rincian '+f.type,filename:'Rincian-'+f.type+'-'+opts.year,wp:opts.wp,empty:'Kedua sumber belum memuat dokumen dalam cakupan ini.'}));
    results.append(select([['','Semua status'],...report.summary.map(r=>r.Status)],selected,s=>{selected=s;paint();},'Status pencocokan'),rows);paint();
  }
  draw();
  panel.append(el('p','Diimpor '+new Date(f.imported).toLocaleString('id')+' · '+f.sheets.length+' lembar','hint'),detail('SHA-256 berkas appportal',el('pre',f.hash)),
    detail('Pengaturan berkas dan pemetaan kolom',settings),results,button('Hapus berkas appportal',()=>{session.delete(f.hash);state.repaint();}));
  return panel;
}
export function renderAppportal(root,state){
  const pkg=state.pkg,wp=pkg?.manifest?.wp;
  if(!pkg?.report?.valid||!wp?.npwp||!pkg.years.length){
    root.append(card('Impor appportal',el('p','Muat paket untuk satu WP dengan integritas yang sesuai dan tahun pajak yang tersedia.')));return;
  }
  let session=sessions.get(pkg);if(!session){session=new Map();sessions.set(pkg,session);}
  const input=el('input');input.type='file';input.multiple=true;input.accept='.xlsx,.xls,.csv,.txt,.html,.htm';
  input.onchange=async()=>{
    const items=[...input.files];input.value='';const problems=[];
    for(const file of items){
      try{const f=await readPortalFile(file);if(!session.has(f.hash))session.set(f.hash,f);}
      catch(e){problems.push(file.name+' · '+e.message);}
    }
    if(state.pkg===pkg&&state.tab==='impor'){state.repaint();if(problems.length)notice(problems.join(' '),true);}
  };
  root.append(card('Impor appportal',el('p','Bandingkan faktur keluaran dan masukan, PIB, atau PEB dengan lampiran SPT PPN. Berkas tersimpan dalam sesi WP ini sampai paket dilepas atau tab ditutup.'),
    el('p',[wp.npwp,wp.nama,state.role].filter(Boolean).join(' · ')),
    select(pkg.years,state.year,y=>{state.year=y;state.repaint();},'Tahun pajak appportal'),field('Pilih berkas appportal',input)));
  if(!session.size)root.append(el('p','Belum ada berkas appportal untuk paket ini.','hint'));
  for(const f of session.values())root.append(filePanel(f,pkg,state,session));
}
