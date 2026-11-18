import {printOutput} from './drafts.js';
import {scopeDefaults,scopeOptions} from './findings.js';
import {markEdit} from './team-work.js';
import {temporaryFindings,temporaryFindingsSheet} from './temporary-findings.js';
import {packageFindingReports} from './finding-report.js';
import {box,button,card,dataTable,el,exportSheets,select} from './ui.js';

export function renderTemporaryFindings(target,state,work,index) {
  const {pkg,year}=state,wp=pkg.manifest.wp||{};
  const evidence=packageFindingReports(pkg,year,work,index),report=temporaryFindings(pkg,year,work,index,evidence);
  const scope=select(scopeOptions,report.scope,value=>{
    work.scopes??={...scopeDefaults};work.scopes.kkp=value;
    markEdit(work,'scopes','kkp');state.repaint();
  },'Temuan yang dimasukkan');
  const excel=button('Excel daftar temuan sementara',()=>exportSheets(
    [temporaryFindingsSheet(pkg,year,work,index,evidence)],'Daftar-Temuan-Sementara-'+year,wp));
  const print=button('Cetak / PDF',()=>printOutput({title:'Daftar temuan sementara',
    paragraphs:[[wp.nama,wp.npwp,report.year].filter(Boolean).join(' · '),...report.summary],
    tables:report.tables.map(t=>({title:t.title,rows:[t.columns,...(t.rows.length?t.rows:[['Belum ada butir.']])]}))}));
  const panel=card('Daftar temuan sementara',el('p','Tahun pajak '+report.year),scope,box('toolbar',excel,print),
    ...report.summary.slice(1).map(s=>el('p',s,'hint')));
  const heading=panel.querySelector('h2');heading.id='temporary-findings-title';heading.tabIndex=-1;
  for(const t of report.tables) {
    const records=t.rows.map(r=>Object.fromEntries(t.columns.map((key,i)=>[key,r[i]])));
    panel.append(el('h3',t.title),dataTable(records,{name:t.title,filename:'TS-'+report.year+'-'+t.title,wp,
      empty:'Belum ada butir pada bagian ini.'}));
  }
  target.append(panel);
}
