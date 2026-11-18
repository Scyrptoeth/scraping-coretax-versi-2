import {assessmentOutput,assessmentSheets} from './assessment-simulation.js';
import {printOutput} from './drafts.js';
import {validateSimulation} from './sanksi.js';
import {markEdit} from './team-work.js';
import {box,button,card,dataTable,el,exportSheets,field} from './ui.js';

export function renderAssessmentSimulation(target,state,work,index){
  const {pkg,year}=state,wp=pkg.manifest.wp||{};
  const output=assessmentOutput(pkg,year,work,index),sheets=assessmentSheets(output);
  const date=el('input');date.type='date';date.value=work.simulation?.end||'';
  date.onchange=()=>{
    if(!date.validity.valid)return;
    const previous=validateSimulation(work.simulation,year);
    const next=validateSimulation({...previous,end:date.value},year);
    work.simulation=next;markEdit(work,'simulation','sim',previous,next);state.repaint();
  };
  const excel=button('Excel simulasi',()=>exportSheets(sheets,'Simulasi-Ketetapan-'+year,wp));
  const print=button('Cetak / PDF',()=>printOutput({title:'Simulasi ketetapan',paragraphs:[
    [wp.nama,wp.npwp,year].filter(Boolean).join(' · '),...output.notes],tables:sheets.map(s=>({title:s.name,rows:s.rows}))}));
  const panel=card('Simulasi ketetapan',el('p','Tahun pajak '+year),
    field('Tanggal rencana ketetapan',date),box('toolbar',excel,print,button('Buka simulasi sanksi manual',()=>state.go('kerja','sim'))),
    ...output.notes.map(note=>el('p',note,'hint')));
  const heading=panel.querySelector('h2');heading.id='assessment-simulation-title';heading.tabIndex=-1;
  target.append(panel,card('Ringkasan per jenis pajak',dataTable(output.lines,{name:'Ringkasan simulasi ketetapan',wp,
    empty:'Paket dan hasil uji tahun ini belum memuat dasar simulasi yang didukung.'})));
  if(output.comparison.length)target.append(card('Pembanding PPh Badan',dataTable(output.comparison,{name:'Pembanding PPh Badan',wp})));
  target.append(card('Kaskade PPN',el('p','Baca setiap masa dari PK dan PM hingga saldo serta kompensasi ke masa berikutnya. Nilai kosong menunjukkan angka yang masih perlu dilengkapi.'),
    dataTable(output.cascade,{name:'Kaskade PPN',wp,empty:'Paket tidak memuat masa PPN untuk tahun ini.'})));
}
