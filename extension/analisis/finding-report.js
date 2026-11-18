import {directFindings} from './direct-findings.js';
import {indicativeFindings} from './indicative-findings.js';

export const findingModels={tl:directFindings,ti:indicativeFindings};
export function packageFindingReports(pkg,year,work,index){
  return {tl:directFindings(pkg,year,work,index),ti:indicativeFindings(pkg,year,work,index)};
}

export const findingOutputs={
  tl:{title:'Temuan berbukti langsung dan sanksi',sheet:'Temuan Langsung',file:'Temuan-Langsung',excel:'Excel temuan langsung',heading:'direct-findings-title'},
  ti:{title:'Temuan indikatif',sheet:'Temuan Indikatif',file:'Temuan-Indikatif',excel:'Excel temuan indikatif',heading:'indicative-findings-title'}
};

export function findingReportSheet(mode,report,pkg,year,work){
  const info=findingOutputs[mode],wp=pkg.manifest.wp||{};
  const rows=[[info.title],['Nama WP',wp.nama],['NPWP',wp.npwp],['Tahun pajak',year],
    ['Tanggal rencana ketetapan',work.simulation?.end||'Belum diisi']];
  for(const item of report.totals||[])rows.push([item.label,item.value??null,item.note||'']);
  for(const table of report.tables)rows.push([],[table.title],table.columns,...(table.rows.length?table.rows:[['Belum ada butir pada bagian ini.']]));
  for(const note of report.notes)rows.push([note]);
  return {name:info.sheet,rows};
}
