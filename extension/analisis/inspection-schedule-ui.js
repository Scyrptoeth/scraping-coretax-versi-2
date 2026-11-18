import {buildSchedule,scheduleSource,validateSchedule} from './inspection-schedule.js';
import {markEdit} from './team-work.js';
import {printOutput} from './drafts.js';
import {box,button,card,el,exportSheets,field,notice,select} from './ui.js';

const types=[['lengkap','Pemeriksaan lengkap'],['terfokus','Pemeriksaan terfokus'],['spesifik','Pemeriksaan spesifik'],
  ['konkret','Pemeriksaan spesifik dengan data konkret']];
const extensionReasons=[['','Belum dipilih'],['grup','Wajib Pajak grup'],
  ['transfer','Indikasi transfer pricing atau transaksi khusus yang terindikasi rekayasa transaksi keuangan']];
const dateFields=[
  ['spp','Tanggal penyampaian SPP'],['request','Tanggal penyampaian surat permintaan dokumen'],
  ['sphp','Tanggal penyampaian SPHP'],['sphpReceived','Tanggal SPHP diterima Wajib Pajak'],
  ['minutes','Tanggal risalah pembahasan ditandatangani WP dan pemeriksa'],['sealed','Tanggal penyegelan']
];
const headers=['Tanggal','Tahap','Dasar','Sisa hari','Keterangan'];
const fmtDate=new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
const formatDate=date=>date?fmtDate.format(new Date(date+'T00:00:00Z')):'Belum dapat dihitung';
const localDay=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
const textFor=row=>[row.status,row.note].filter(Boolean).join(' · ');
const outputRow=r=>[r.date??'',r.label,r.basis,r.daysRemaining??'',textFor(r)];

function scheduleTable(rows){
  const table=el('table'),head=el('thead'),columns=el('tr'),body=el('tbody');
  table.setAttribute('aria-label','Jadwal pemeriksaan');
  for(const label of headers){const th=el('th',label);th.scope='col';columns.append(th);}
  head.append(columns);
  for(const r of rows){
    const tr=el('tr'),date=el('td');
    if(r.date){const time=el('time',formatDate(r.date));time.dateTime=r.date;date.append(time);}
    else date.textContent='Belum dapat dihitung';
    tr.append(date,el('td',r.label),el('td',r.basis),el('td',r.daysRemaining??'—'),el('td',textFor(r)));
    body.append(tr);
  }
  table.append(head,body);return box('scroll',table);
}

export function renderInspectionSchedule(target,state,work){
  const wp=state.pkg.manifest.wp||{},form=el('form'),editors={};
  form.noValidate=true;form.className='inspection-schedule-form';
  const current=()=>validateSchedule(work.schedule??{});
  const initial=current(),year=String(state.year),today=localDay();
  function calendar(id,title){
    const input=el('input');input.type='date';input.value=initial[id];editors[id]=input;
    return field(title,input);
  }
  function choice(id,title,options){
    const label=select(options,initial[id],()=>{},title);
    editors[id]=label.querySelector('select');return label;
  }
  const type=choice('type','Jenis pemeriksaan',types);
  const dates=box('formgrid',...dateFields.map(([id,title])=>calendar(id,title)));
  const extension=el('input');extension.type='number';extension.min='0';extension.max='4';extension.step='1';
  extension.value=String(initial.extensionMonths);editors.extensionMonths=extension;
  const extensionFields=box('formgrid',field('Lama perpanjangan (bulan, 0–4)',extension),
    choice('extensionBasis','Dasar perpanjangan',extensionReasons),calendar('extensionNotice','Tanggal pemberitahuan tertulis perpanjangan disampaikan kepada WP'));
  const eligible=el('input');eligible.type='checkbox';eligible.checked=initial.qaEligible;
  const qaLabel=el('label',null,'schedule-condition');
  qaLabel.append(eligible,document.createTextNode('Semua syarat permohonan pembahasan dengan Tim Quality Assurance pada Pasal 19 ayat (1) terpenuhi'));
  const holidays=el('textarea');holidays.rows=3;holidays.placeholder='2026-01-01';holidays.value=initial.holidays.join('\n');editors.holidays=holidays;
  const save=el('button','Simpan jadwal');save.type='submit';
  const status=el('p','','hint');status.setAttribute('role','status');
  const problem=el('p','','error');problem.setAttribute('role','alert');problem.hidden=true;
  form.append(type,dates,qaLabel,
    el('h3','Perpanjangan'),extensionFields,
    field('Hari libur dan cuti bersama (satu tanggal YYYY-MM-DD per baris)',holidays),problem,box('toolbar',save,status));
  const results=el('div'),rules=el('div');
  let preview=null;
  function read(){
    if(Object.values(editors).some(i=>i.validity?.badInput))throw Error('Lengkapi isian angka atau tanggal yang sedang disunting.');
    return validateSchedule({type:editors.type.value,...Object.fromEntries(dateFields.map(([id])=>[id,editors[id].value])),
      extensionMonths:extension.value===''?0:Number(extension.value),extensionBasis:editors.extensionBasis.value,
      extensionNotice:editors.extensionNotice.value,qaEligible:eligible.checked,holidays:holidays.value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)});
  }
  function exportDetails(){
    const {data,rows,notes,dirty}=preview;
    const summary=[
      [wp.nama,wp.npwp].filter(Boolean).join(' · '),'Tahun pajak berkas kerja '+year,
      (types.find(([code])=>code===data.type)||[])[1],'Tanggal acuan '+today,
      data.holidays.length+' tanggal dalam daftar hari libur dan cuti bersama','PMK 15 Tahun 2025 · '+scheduleSource
    ].filter(Boolean);
    if(dirty)summary.push('Pratinjau perubahan yang belum disimpan.');
    return {summary,notes,rows:[headers,...rows.map(outputRow)]};
  }
  const excel=button('Excel jadwal',()=>{
    if(!preview)return;
    const {summary,notes,rows}=exportDetails();
    exportSheets([{name:'Jadwal Pemeriksaan',rows:[['Jadwal pemeriksaan'],...summary.map(s=>[s]),[],...rows,
      ...(notes.length?[[],['Catatan penghitungan'],...notes.map(n=>[n])]:[])]}],'Jadwal-Pemeriksaan-'+year,wp);
  });
  const print=button('Cetak / PDF',()=>{
    if(!preview)return;
    const {summary,notes,rows}=exportDetails();
    printOutput({title:'Jadwal pemeriksaan',paragraphs:[...summary,...notes],tables:[{title:'Tahap dan tenggat',rows}]});
  });
  function refresh(){
    problem.hidden=true;problem.textContent='';
    try{
      const data=read(),{rows,notes}=buildSchedule(data,today);
      const dirty=JSON.stringify(data)!==JSON.stringify(current());
      preview={data,rows,notes,dirty};
      save.disabled=!dirty;excel.disabled=print.disabled=!rows.length;
      status.textContent=dirty?'Pratinjau perubahan yang belum disimpan.':'';
      rules.replaceChildren(...notes.map(n=>el('p',n,'hint')));
      results.replaceChildren(rows.length?scheduleTable(rows):el('p','Isi tanggal pada dokumen untuk menampilkan tahap dan tenggat.'));
    }catch(error){
      preview=null;save.disabled=excel.disabled=print.disabled=true;
      problem.textContent=error.message;problem.hidden=false;status.textContent='';
      rules.replaceChildren();results.replaceChildren();
    }
  }
  form.addEventListener('input',refresh);form.addEventListener('change',refresh);
  form.addEventListener('submit',event=>{
    event.preventDefault();refresh();
    if(!preview?.dirty)return;
    const before=work.schedule,after=preview.data;
    work.schedule=after;markEdit(work,'schedule','jadwal',before,after);
    refresh();notice('Jadwal tahun pajak '+year+' tersimpan dalam sesi. Pilih Unduh berkas kerja untuk menyimpannya ke berkas.');
  });
  const panel=card('Jadwal pemeriksaan',el('p','Tahun pajak berkas kerja '+year+' · Tanggal acuan '+formatDate(today), 'hint'),
    form,el('h3','Tahap dan tenggat'),box('toolbar',excel,print),rules,results);
  const source=el('a','PMK Nomor 15 Tahun 2025 di JDIH Kementerian Keuangan');
  source.href=scheduleSource;source.target='_blank';source.rel='noopener noreferrer';const reference=el('p');reference.append(source);panel.append(reference);
  const heading=panel.querySelector('h2');heading.id='inspection-schedule-title';heading.tabIndex=-1;
  target.append(panel);refresh();
}
