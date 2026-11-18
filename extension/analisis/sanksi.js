import {rateForMonth} from './rate-updates.js';
import {markEdit} from './team-work.js';
import {worksheet} from './model.js';
import {findingsFor,findingKey,reviewOptions} from './findings.js';
import {box,button,card,dataTable,el,exportSheets,field,select,showDialog} from './ui.js';

const law='https://pajak.go.id/id/peraturan/harmonisasi-peraturan-perpajakan';
const example='https://pajak.go.id/index.php/id/peraturan/tata-cara-pelaksanaan-hak-dan-pemenuhan-kewajiban-perpajakan';
const articles={
  interest:'Bunga · Pasal 13 ayat (2)',
  increase:'Kenaikan PPN/PPnBM · Pasal 13 ayat (1) c dan (3) c',
  compare:'Bunga dan kenaikan PPN/PPnBM · pilih yang tertinggi menurut Pasal 13 ayat (3a)'
};
const taxes=['PPN','PPnBM','PPh Badan','PPh Orang Pribadi','PPh Pasal 21','PPh Pasal 22','PPh Pasal 23','PPh Pasal 26','PPh Pasal 4 ayat (2)','PPh Pasal 15'];
const monthPattern=/^[1-9]\d{3}-(0[1-9]|1[0-2])$/;
const moneyPattern=/^(?:0|[1-9]\d{0,17})$/;
function dateValid(s){
  if(typeof s!=='string'||!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(s))return false;
  const d=new Date(s+'T00:00:00Z');
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;
}
const asMonth=s=>Number(s.slice(0,4))*12+Number(s.slice(5,7))-1;
function firstFollowing(period){
  const m=asMonth(period)+1;
  return Math.floor(m/12)+'-'+String(m%12+1).padStart(2,'0')+'-01';
}
function checkedCase(row){
  if(!row||!taxes.includes(row.tax)||!Object.hasOwn(articles,row.article)||typeof row.period!=='string'||!monthPattern.test(row.period)||
    typeof row.principal!=='string'||(row.principal!==''&&!moneyPattern.test(row.principal))||
    typeof row.basis!=='string'||!Array.isArray(row.transfers))throw Error('Isian simulasi tidak dikenali.');
  if(row.article!=='interest'&&!['PPN','PPnBM'].includes(row.tax))throw Error('Kenaikan ini hanya berlaku untuk PPN atau PPnBM.');
  if(row.article==='interest'&&row.transfers.length||row.article==='increase'&&row.principal!=='')throw Error('Dasar sanksi berbeda dari pasal yang dipilih.');
  const seen=new Set();
  for(const t of row.transfers){
    if(!t||typeof t.to!=='string'||!monthPattern.test(t.to)||t.to<=row.period||seen.has(t.to)||
       typeof t.amount!=='string'||(t.amount!==''&&!moneyPattern.test(t.amount)))throw Error('Periksa masa penerima dan nilai kompensasi. Setiap masa penerima hanya boleh dicatat sekali.');
    seen.add(t.to);
  }
  return {tax:row.tax,period:row.period,article:row.article,principal:row.principal,basis:row.basis,
    transfers:row.transfers.map(t=>({to:t.to,amount:t.amount}))};
}
export function validateSimulation(input,year){
  if(input===undefined)return {end:'',cases:[]};
  if(!input||typeof input.end!=='string'||(input.end!==''&&!dateValid(input.end))||!Array.isArray(input.cases))throw Error('Tanggal atau daftar simulasi tidak dikenali.');
  const cases=input.cases.map(checkedCase),keys=new Set();
  for(const row of cases){
    if(year&&row.period.slice(0,4)!==String(year))throw Error('Masa yang diuji harus dalam tahun kertas kerja.');
    const k=row.tax+' '+row.period;
    if(keys.has(k))throw Error('Gabungkan dasar sanksi untuk jenis pajak dan masa yang sama dalam satu baris.');
    keys.add(k);
  }
  return {end:input.end,cases};
}
// This model covers assessments whose interest begins after a tax period/year ends.
// Amounts use 1/10,000 rupiah so no fractional result is rounded in intermediate steps.
export function simulate(row,end){
  const item=checkedCase(row),start=firstFollowing(item.period);
  const useInterest=item.article!=='increase',useIncrease=item.article!=='interest';
  const rate=useInterest?rateForMonth(start.slice(0,7)):null;
  const output={start,months:null,rate,interest:null,increase:null,principal:null,sanction:null,total:null,applied:'',reason:''};
  if(!dateValid(end))return {...output,reason:'Isi tanggal rencana ketetapan.'};
  if(end<start)return {...output,reason:'Tanggal rencana mendahului akhir masa yang diuji.'};
  if(asMonth(end)-asMonth(start)>=60)return {...output,reason:'Tanggal rencana melampaui jangka waktu umum lima tahun dalam Pasal 13 ayat (1).'};
  if(item.period<'2022-01')return {...output,reason:'Ketentuan peralihan untuk masa ini belum dimodelkan.'};
  if(useInterest){
    output.months=Math.min(24,asMonth(end)-asMonth(start)+1);
    if(!rate)return {...output,reason:'Tarif resmi untuk '+start.slice(0,7)+' belum tersedia.'};
    if(item.principal==='')return {...output,reason:'Isi dasar bunga sesuai hasil pengujian.'};
    output.interest=BigInt(item.principal)*BigInt(rate.basisPoints)*BigInt(output.months);
  }
  let credit=0n;
  if(useIncrease){
    if(!item.transfers.length||item.transfers.some(t=>t.amount===''))return {...output,reason:'Lengkapi masa penerima dan nilai kompensasi yang tidak semestinya.'};
    if(item.transfers.some(t=>t.to>end.slice(0,7)))return {...output,reason:'Masa penerima kompensasi melampaui tanggal rencana.'};
    credit=item.transfers.reduce((s,t)=>s+BigInt(t.amount),0n);
    output.increase=credit*7500n;
  }
  if(!item.basis.trim())return {...output,reason:'Isi rujukan hasil pengujian yang mendukung pokok dan pasal.'};
  output.principal=((useInterest?BigInt(item.principal):0n)+credit)*10000n;
  if(output.interest!==null&&(output.increase===null||output.interest>=output.increase)){
    output.sanction=output.interest;
    output.applied=output.interest===output.increase?'Nilai bunga dan kenaikan sama, diterapkan sekali':'Bunga Pasal 13 ayat (2)';
  }else{
    output.sanction=output.increase;
    output.applied='Kenaikan Pasal 13 ayat (3) huruf c';
  }
  output.total=output.principal+output.sanction;
  return output;
}
// Excel retains 15 significant digits. Preserve longer exact amounts as decimal text.
function decimal(n){
  if(n===null)return null;
  const whole=n/10000n, fraction=String(n%10000n).padStart(4,'0').replace(/0+$/,'');
  const value=String(whole)+(fraction?'.'+fraction:'');
  return value.replace('.','').replace(/^0+/,'').length>15?value:Number(value);
}
function official(label,url){
  const link=el('a',label);link.href=url;link.target='_blank';link.rel='noreferrer';return link;
}
export function simulationTables(sim){
  const byTax=new Map(),detail=[],transfers=[],sources=new Map();
  for(const row of sim.cases){
    const x=simulate(row,sim.end), group=byTax.get(row.tax)||{count:0,pending:0,principal:0n,sanction:0n,total:0n};
    group.count++;
    if(x.total===null)group.pending++;
    else for(const key of ['principal','sanction','total'])group[key]+=x[key];
    byTax.set(row.tax,group);
    if(x.rate)sources.set(x.start.slice(0,7),x.rate);
    detail.push({'Jenis pajak':row.tax,'Masa akhir':row.period,Pasal:articles[row.article],'Rencana ketetapan':sim.end,
      'Mulai bunga':row.article==='increase'?null:x.start,'Bulan dikenai':x.months,'Tarif bunga (% per bulan)':x.rate?x.rate.basisPoints/100:null,
      ...(x.rate?.source?{'Sumber tarif sesi':x.rate.decision+' · '+x.rate.source+' · '+x.rate.date}:{}),
      'Dasar bunga (Rp)':row.principal===''?null:decimal(BigInt(row.principal)*10000n),'Bunga (Rp)':decimal(x.interest),'Kenaikan 75% (Rp)':decimal(x.increase),
      'Pokok (Rp)':decimal(x.principal),'Sanksi terpilih (Rp)':decimal(x.sanction),'Pokok + sanksi (Rp)':decimal(x.total),Keterangan:x.reason||x.applied,'Rujukan pengujian':row.basis});
    for(const t of row.transfers)transfers.push({'Jenis pajak':row.tax,'Masa yang diuji':row.period,'Masa penerima':t.to,'Kompensasi tidak semestinya yang digunakan (Rp)':t.amount===''?null:decimal(BigInt(t.amount)*10000n),'Rujukan pengujian':row.basis});
  }
  const summary=[...byTax].map(([tax,g])=>({'Jenis pajak':tax,'Masa diuji':g.count,'Belum dapat dihitung':g.pending,
    'Pokok (Rp)':g.pending?null:decimal(g.principal),'Sanksi terpilih (Rp)':g.pending?null:decimal(g.sanction),'Pokok + sanksi (Rp)':g.pending?null:decimal(g.total)}));
  const references=[{Dokumen:'UU 7/2021 · Pasal 13 UU KUP',Periode:'',URL:law},{Dokumen:'PP 50/2022 · Penjelasan Pasal 20',Periode:'',URL:example},
    ...[...sources].map(([period,rate])=>({Dokumen:'KMK '+rate.decision,Periode:period,URL:rate.url,
      ...(rate.source?{'Pembaruan pengguna':rate.source+' · '+rate.date}:{})}))];
  return {summary,detail,transfers,references};
}

function textInput(type,value){
  const input=el('input');input.type=type;input.value=value;
  if(type==='text')input.autocomplete='off';
  return input;
}
function amountInput(value){
  const input=textInput('text',value);input.inputMode='numeric';input.pattern='0|[1-9][0-9]{0,17}';
  input.placeholder='Rupiah penuh';return input;
}
function editCase(state,work,index){
  const sim=work.simulation,old=sim.cases[index];
  const row=old?structuredClone(old):{tax:'PPN',article:'interest',period:'',principal:'',transfers:[],basis:''};
  const period=textInput('month',row.period),principal=amountInput(row.principal),basis=el('textarea');
  period.min=state.year+'-01';period.max=state.year+'-12';period.required=true;basis.value=row.basis;
  const form=el('form'),fields=box('formgrid'),creditPanel=box('stack'),amountFields=box('stack');
  const mode=select(Object.entries(articles),row.article,v=>{row.article=v;draw();},'Dasar pengenaan');
  const tax=select(taxes,row.tax,v=>{row.tax=v;if(!['PPN','PPnBM'].includes(v))row.article='interest';draw();},'Jenis pajak yang diuji');
  fields.append(tax,field('Bulan akhir masa atau tahun pajak yang diuji',period),mode);
  const eligible=findingsFor(state.pkg,state.year,work.rows).filter(r=>r.status==='berbukti'&&Number.isSafeInteger(r.amount)&&r.amount>=0&&
    (!work.dispositions[findingKey(r)]||work.dispositions[findingKey(r)]===reviewOptions[0]));
  if(eligible.length){
    const choose=select([['','Pilih butir'],...eligible.map((r,i)=>[String(i),r.kind+' · '+r.detail])],'',i=>{
      if(i==='')return;
      const src=eligible[Number(i)];
      principal.value=String(src.amount);basis.value=[src.source,src.detail].filter(Boolean).join(' · ');
    },'Salin dasar bunga dari butir berbukti');
    amountFields.append(choose);
  }
  amountFields.append(field('Dasar bunga dari hasil pengujian (Rp)',principal));
  const addTransfer=()=>{row.transfers.push({to:'',amount:''});drawCredits();};
  function drawCredits(){
    creditPanel.replaceChildren(el('p','Catat kompensasi yang menurut bukti benar-benar digunakan dan tidak semestinya. Kelompokkan nilai menurut masa penerima.','hint'));
    for(const [i,t] of row.transfers.entries()){
      const to=textInput('month',t.to),amount=amountInput(t.amount);
      to.required=true;to.oninput=()=>{t.to=to.value;};amount.oninput=()=>{t.amount=amount.value;};
      creditPanel.append(box('row',field('Masa penerima '+(i+1),to),field('Dasar kenaikan (Rp) '+(i+1),amount),
        button('Hapus masa penerima '+(i+1),()=>{row.transfers.splice(i,1);drawCredits();})));
    }
    creditPanel.append(button('Tambah masa penerima',addTransfer));
  }
  function draw(){
    const vat=['PPN','PPnBM'].includes(row.tax),control=mode.querySelector('select');
    for(const option of control.options)option.disabled=!vat&&option.value!=='interest';
    control.value=row.article;amountFields.hidden=row.article==='increase';
    principal.disabled=amountFields.hidden;creditPanel.hidden=row.article==='interest';
    if(creditPanel.hidden)creditPanel.replaceChildren();
    else {
      if(!row.transfers.length)row.transfers.push({to:'',amount:''});
      drawCredits();
    }
  }
  const save=el('button','Simpan masa');save.type='submit';
  form.append(fields,amountFields,creditPanel,field('Rujukan hasil pengujian',basis),save);
  if(old)form.append(button('Hapus masa dari simulasi',()=>{
    if(window.confirm('Hapus masa ini dari simulasi?')){sim.cases.splice(index,1);document.getElementById('dialog').close();state.repaint();}
  }));
  form.onsubmit=e=>{
    e.preventDefault();
    row.period=period.value;row.principal=row.article==='increase'?'':principal.value.trim();row.basis=basis.value.trim();
    const prepared={...row,transfers:row.article==='interest'?[]:row.transfers};
    const cases=sim.cases.slice();if(old)cases[index]=prepared;else cases.push(prepared);
    try{
      work.simulation=validateSimulation({...sim,cases},state.year);
      document.getElementById('dialog').close();state.repaint();
    }catch(error){const status=form.querySelector('[role=alert]')||el('p');status.setAttribute('role','alert');status.textContent=error.message;form.append(status);}
  };
  draw();showDialog(old?'Ubah masa simulasi':'Tambah masa simulasi',form);
}
export function assessmentDateField(work,year,repaint){
  const date=textInput('date',work.simulation?.end||'');
  date.onchange=()=>{
    if(!date.validity.valid)return;
    const previous=validateSimulation(work.simulation,year);
    const next=validateSimulation({...previous,end:date.value},year);
    work.simulation=next;markEdit(work,'simulation','sim',previous,next);repaint();
  };
  return field('Tanggal rencana ketetapan',date);
}
export function renderSanksi(target,state,work){
  const wp=state.pkg.manifest.wp;
  const sim=work.simulation;
  const tables=simulationTables(sim);
  const formatNumber=new Intl.NumberFormat('id-ID',{maximumFractionDigits:4}).format;
  const download=button('Excel simulasi',()=>{
    const sections=[['Ringkasan',tables.summary],['Rincian per masa',tables.detail],['Kompensasi PPN',tables.transfers],['Dasar hukum dan tarif',tables.references]];
    return exportSheets(sections.map(([name,rows])=>({name,rows:worksheet(rows)})),'Simulasi-SKPKB-'+state.year,wp);
  });
  download.disabled=!sim.cases.length;
  target.append(card('Simulasi SKPKB',
    el('p','Gunakan pokok yang sudah diuji untuk satu ketetapan per jenis pajak dan masa. Model ini mencakup bunga yang mulai setelah masa atau tahun pajak berakhir.'),
    box('toolbar',assessmentDateField(work,state.year,state.repaint),button('Tambah masa simulasi',()=>editCase(state,work,-1)),download),
    el('p','Hasil adalah perkiraan sebelum pembulatan rupiah. Dasar bunga dan dasar kenaikan diisi terpisah. Jika kedua sanksi berlaku untuk satu ketetapan PPN atau PPnBM, simulasi memilih nilai tertinggi.','hint')),
    card('Ringkasan per jenis pajak',dataTable(tables.summary,{wp,name:'Ringkasan simulasi',formatNumber,empty:'Tambahkan masa untuk mulai menghitung.'})),
    card('Penghitungan per masa',dataTable(tables.detail,{wp,name:'Penghitungan sanksi',formatNumber,openRow:r=>editCase(state,work,tables.detail.indexOf(r))})));
  if(tables.transfers.length)target.append(card('Penelusuran kompensasi PPN',dataTable(tables.transfers,{wp,name:'Kompensasi yang digunakan'})));
  target.append(card('Dasar hukum dan tarif',el('p','Tarif Pasal 13 ayat (2) mengikuti KMK pada bulan pertama penghitungan. Tabel memuat Januari 2023 hingga November 2026.'),
    box('stack',...tables.references.map(r=>{
      const description=[r.Dokumen,r.Periode,r['Pembaruan pengguna']].filter(Boolean).join(' · ');
      return r.URL?official(description,r.URL):el('span',description);
    }))));
}
