import {findingModels,findingOutputs,findingReportSheet} from './finding-report.js';
import {reviewStates,validateLoanRate} from './indication-review.js';
import {markEdit} from './team-work.js';
import {assessmentDateField} from './sanksi.js';
import {printOutput} from './drafts.js';
import {box,button,card,dataTable,detail,el,exportSheets,field,select} from './ui.js';

function loanRateField(work,repaint){
  const percent=el('input'),source=el('input'),error=el('p',null,'error');
  percent.type='number';percent.min='0';percent.step='any';percent.value=work.indicationLoanRate?.percent??'';
  source.value=work.indicationLoanRate?.source||'';error.setAttribute('role','alert');error.hidden=true;
  function set(next){
    const previous=work.indicationLoanRate??null;
    work.indicationLoanRate=next;markEdit(work,'indicationLoanRate','rate',previous,next);repaint();
  }
  const save=button('Simpan acuan bunga',()=>{
    try{set(validateLoanRate({percent:percent.valueAsNumber,source:source.value}));}
    catch(err){error.hidden=false;error.textContent=err.message;}
  });
  const form=box('stack',box('formgrid',field('Bunga tahunan untuk skenario (%)',percent),field('Rujukan bunga atau asumsi',source)),
    box('toolbar',save,button('Gunakan contoh 8%',()=>set({percent:8,source:'Asumsi contoh simulasi 8%'})),
      work.indicationLoanRate?button('Hapus acuan bunga',()=>set(null)):null),error);
  return detail('Acuan bunga untuk piutang afiliasi',form);
}
export function renderFindingReport(target,state,work,index,mode){
  const {pkg,year}=state,wp=pkg.manifest.wp||{},info=findingOutputs[mode];
  const report=findingModels[mode](pkg,year,work,index);
  const excel=button(info.excel,()=>exportSheets([findingReportSheet(mode,report,pkg,year,work)],info.file+'-'+year,wp));
  const totals=report.totals||[],format=n=>Number.isFinite(n)?new Intl.NumberFormat('id-ID',{maximumFractionDigits:2}).format(n):'Belum dapat dihitung';
  const print=button('Cetak / PDF',()=>printOutput({title:info.title,paragraphs:[[wp.nama,wp.npwp,year].filter(Boolean).join(' · '),
    'Tanggal rencana ketetapan '+(work.simulation?.end||'belum diisi'),...totals.map(t=>[t.label,format(t.value),t.note].filter(Boolean).join(' · ')),...report.notes],
    tables:report.tables.map(t=>({title:t.title,rows:[t.columns,...(t.rows.length?t.rows:[['Belum ada butir pada bagian ini.']])]}))}));
  const panel=card(info.title,el('p','Tahun pajak '+year),box('toolbar',assessmentDateField(work,year,state.repaint),excel,print));
  const heading=panel.querySelector('h2');heading.id=info.heading;heading.tabIndex=-1;
  if(mode==='ti')appendIndicationControls(panel,report,work,state);
  target.append(panel);
  if(totals.length)target.append(box('grid',...totals.map(t=>box('kpi',el('small',t.label),el('b',format(t.value)),t.note?el('p',t.note,'hint'):null))));
  for(const t of report.tables){
    const rows=t.rows.map(cells=>Object.fromEntries(t.columns.map((key,i)=>[key,cells[i]])));
    target.append(card(t.title,dataTable(rows,{name:t.title,wp,filename:info.file+'-'+year,empty:'Belum ada butir pada bagian ini.'})));
  }
  if(report.notes.length)target.append(card('Dasar dan cakupan',...report.notes.map(note=>el('p',note,'hint'))));
}

export function appendIndicationControls(panel,report,work,state){
  if(report.candidates?.length){
    const reviews=box('formgrid');reviews.setAttribute('aria-label','Status telaah indikasi');
    for(const {ruleId,title} of report.candidates){
      const control=select(reviewStates,work.indicationReviews?.[ruleId]??'pending',value=>{
        const map=work.indicationReviews??={},previous=map[ruleId]??'pending';
        map[ruleId]=value;markEdit(work,'indicationReviews',ruleId,previous,value);state.repaint();
        document.getElementById('review-'+ruleId)?.focus();
      },'Telaah '+title);
      control.querySelector('select').id='review-'+ruleId;reviews.append(control);
    }
    panel.append(el('h3','Telaah indikasi'),reviews);
    if(report.candidates.some(c=>c.ruleId==='related-loan'))panel.append(loanRateField(work,state.repaint));
  }
}
