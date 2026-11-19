import {checkIdentity,normalizeId} from '../app-data.js';
import {isRegisteredProbisCode,publicGuide} from '../probis-guide.js';
import {rowsOf} from './model.js';
import {annualBusinessCodes} from './profile.js';
import {directFindings} from './direct-findings.js';
import {indicativeFindings} from './indicative-findings.js';
import {buildIndex} from './kkp-index.js';
import {qualityNotes} from './quality.js';
import {box,button,card,el} from './ui.js';
import {yearWork} from './work.js';

export function dashboardBusiness(pkg,year,reference){
  if(!pkg.report?.valid||!year)return null;
  if(reference?.code&&isRegisteredProbisCode(reference.code)){
    return {code:reference.code,title:reference.title||reference.code,basis:'Acuan yang dipilih dalam kertas kerja'};
  }
  const owner=normalizeId(pkg.manifest.wp?.npwp);
  if(!owner)return null;
  const registry=[];
  for(const entry of pkg.entries){
    if(!['klu','info'].includes(entry.cap?.sumber)||normalizeId(entry.cap?.konteks?.npwp)!==owner||
      !entry.cap.lengkap||entry.pages.some(page=>page?.IsSuccessful===false||page?.Errors?.length))continue;
    const rows=rowsOf(entry);
    try{checkIdentity(rows,owner);}catch{return null;}
    for(const row of rows){
      if(entry.cap.sumber==='klu')registry.push(row);
      else if(row.MainEconomicCode&&normalizeId(row.GeneralInformation?.UniqueIdentificationNumber)===owner)
        registry.push(row.MainEconomicCode);
    }
  }
  const matches=annualBusinessCodes(registry,[String(year)],String(pkg.manifest.dibuat||'').slice(0,10));
  const codes=new Set(matches.map(row=>row.KLU));
  if(codes.size!==1)return null;
  const [code]=codes;if(!isRegisteredProbisCode(code))return null;
  return {code,title:matches.find(row=>row.Uraian)?.Uraian||code,basis:'KLU utama pada registrasi yang berlaku dalam tahun ini'};
}

function findingPanel(title,report,placeholder,link,go){
  const panel=card(title);
  if(report?.facts.length){
    const list=el('ul');
    for(const fact of report.facts.slice(0,3))list.append(el('li',[fact.kind,fact.detail,fact.period].filter(Boolean).join(' · ')));
    panel.append(el('p',report.facts.length+' butir tercantum dalam laporan tahun ini.'),list);
  }else panel.append(el('p',placeholder,'hint'));
  panel.append(button(link,go));
  return panel;
}

export function dashboardFollowUp(state){
  const {pkg,year,go}=state,work=yearWork(state,pkg,year),verified=Boolean(year&&pkg.report.valid);
  const business=dashboardBusiness(pkg,year,work.business?.reference);
  const activity=card('Proses bisnis WP');
  if(business){
    const guide=publicGuide(business.code);
    activity.append(el('h3',business.title),el('p',business.basis+' · '+business.code,'hint'),
      el('p',guide.flow),el('p',guide.check),button('Telusuri KLU di Probis',()=>{
        state.query=business.code;go('probis','klu');
      }));
  }else activity.append(el('p','KLU utama untuk tahun ini belum dapat dipastikan dari paket.','hint'),
    button('Buka Probis',()=>{state.query='';go('probis');}));
  const filings=pkg.forms.filter(form=>form.year===year&&typeof form.filingLate==='boolean');
  const late=filings.filter(form=>form.filingLate).length;
  const warnings=qualityNotes(pkg).filter(row=>row.Tingkat==='Kritis'||row.Tingkat==='Peringatan').length;
  const actions=card('Tindak lanjut',
    el('p',filings.length?late+' dari '+filings.length+' SPT normal yang dapat diperiksa dilaporkan sesudah batas pembanding.':
      'Tanggal lapor dan batas waktu SPT normal belum cukup untuk menilai ketepatan waktu.'),
    el('p',warnings?warnings+' catatan mutu di seluruh paket perlu diperiksa.':'Tidak ada peringatan atau catatan kritis pada pemeriksaan mutu paket.'),
    box('toolbar',
    button('Periksa pelaporan SPT',()=>go('profil','lapor')),
    button('Periksa mutu data',()=>go('muat','mutu')),
    button('Buka simulasi sanksi',()=>go('kerja','sim'))));
  const index=verified?(work.indexData??=buildIndex(pkg,year)):null;
  const direct=index&&directFindings(pkg,year,work,index),indications=index&&indicativeFindings(pkg,year,work,index);
  const unknown='Periksa tahun dan keutuhan paket untuk membaca ringkasan.';
  const directPanel=findingPanel('Temuan langsung',direct,verified?'Belum ada butir yang memenuhi pemeriksaan bukti dalam laporan tahun ini.':unknown,
    'Buka laporan temuan langsung',()=>go('kerja','tl'));
  const indicationsPanel=findingPanel('Temuan indikatif',indications,verified?'Belum ada indikasi yang dapat ditunjukkan dalam laporan tahun ini.':unknown,
    'Buka laporan temuan indikatif',()=>go('kerja','ti'));
  return box('dashboard-follow-up',activity,actions,directPanel,indicationsPanel);
}
