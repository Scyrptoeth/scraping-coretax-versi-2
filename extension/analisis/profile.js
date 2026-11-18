import {flatten, ledgerDocumentReference, receiptFields, rowsOf, sptDay, submittedDay, typeNames, worksheet} from './model.js';
import {box, button, card, dataTable, detail, el, exportSheets} from './ui.js';

const first = rows => rows[0] || {};
const list = value => Array.isArray(value)?value:[];
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
function date(value) {
  const match = /^(19\d{2}|20\d{2})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  return match ? match[0] : '';
}
const identity = value => {
  const id = String(value ?? '').replace(/[.\s-]/g, '');
  return id && !/^0+$/.test(id) ? id : '';
};
const nameKey = name => String(name ?? '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('id');
const total = values => values.length && values.every(v=>number(v)!==null) ? values.reduce((a,b)=>a+b,0) : null;

// Match exact identifiers first. Name matching requires a unique row on each side.
export function compareShareholders(registry, reported, {hasRegistry, hasReport, asOf}) {
  const active = registry.filter(r=>number(r.Percentage)>0 &&
    (!asOf || ((!date(r.ValidTo) || date(r.ValidTo)>=asOf) && (!date(r.ValidFrom) || date(r.ValidFrom)<=asOf))));
  const left = active.map(r=>({id:identity(r.PersonNIKTIN),name:r.PersonName,pct:number(r.Percentage)}));
  const right = reported.map(r=>({id:identity(r.TIN),name:r.Name,pct:number(r.PaidInCapitalPercentage)}));
  const used = new Set();
  const matches = (a, items, f) => items.filter(b=>a!=='' && a===b[f]);
  const out=[];
  function result(a,b,status,method) {
    return {Nama:a?.name || b?.name || '', 'NPWP registrasi':a?.id || '', 'NPWP SPT':b?.id || '',
      'Porsi registrasi (%)':a?.pct ?? null,'Porsi SPT (%)':b?.pct ?? null,Status:status,Pencocokan:method};
  }
  for (const a of left) {
    let candidates = matches(a.id,right,'id');
    let method='NPWP',ambiguous=candidates.length>1 || matches(a.id,left,'id').length>1;
    if (!candidates.length && !ambiguous) {
      method='Nama';
      const byName=right.filter(b=>nameKey(a.name) && nameKey(b.name)===nameKey(a.name) && (!a.id || !b.id));
      candidates=byName;
      ambiguous=byName.length>1 || (byName.length>0 && left.filter(l=>nameKey(l.name)===nameKey(a.name)).length>1);
    }
    const b=candidates[0];
    if(ambiguous || (b && used.has(b))) out.push(result(a,null,'Perlu pencocokan','Identitas berulang'));
    else if(!b) out.push(result(a,null,hasReport?'Hanya di registrasi':'Data SPT belum tersedia',''));
    else {
      used.add(b);
      const status=a.pct===null || b.pct===null ? 'Porsi belum tersedia' : Math.abs(a.pct-b.pct)<1e-8?'Cocok':'Porsi berbeda';
      out.push(result(a,b,status,method));
    }
  }
  for(const b of right.filter(b=>!used.has(b))) {
    const repeated=matches(b.id,left,'id').length>0 || left.some(a=>nameKey(a.name) && nameKey(a.name)===nameKey(b.name) && (!a.id || !b.id));
    out.push(result(null,b,repeated?'Perlu pencocokan':hasRegistry?'Hanya di SPT Badan':'Data registrasi belum tersedia',''));
  }
  return {rows:out,registryTotal:hasRegistry?total(left.map(r=>r.pct)):null,reportTotal:hasReport?total(right.map(r=>r.pct)):null};
}

function sourceRows(entries) {
  return entries.flatMap(e=>rowsOf(e).map(r=>({...r,'Berkas sumber':e.path})));
}
function ledgerRows(entries) {
  const seen=new Set(), monthly=new Set();
  for(const e of entries) {
    const hit=/^bukubesar\/(\d{4}-\d{2})\.json$/.exec(e.path);
    if(hit && e.cap?.lengkap===true && e.pages?.every(p=>p.IsSuccessful!==false)) monthly.add(hit[1]);
  }
  return sourceRows([...entries].sort((a,b)=>Number(a.path.includes('setahun'))-Number(b.path.includes('setahun')))).filter(row=>{
    if(row.IsCancelled===true) return false;
    if(row.RecordId) {
      if(seen.has(row.RecordId)) return false;
      seen.add(row.RecordId);
      return true;
    }
    const p=String(row.PeriodCode ?? ''),month=/^\d{8}$/.test(p)?p.slice(4)+'-'+p.slice(0,2):'';
    return !(row['Berkas sumber'].includes('setahun') && monthly.has(month));
  });
}
export function packageLedger(pkg) {
  return ledgerRows(pkg.entries.filter(e=>e.cap?.sumber==='bb'||e.path.startsWith('bukubesar/')));
}
function relate(pkg) {
  const grouped=new Map();
  function add(group,r,id,name,amount,tax,path) {
    const tin=identity(r[id]),label=r[name]||'';
    const key=JSON.stringify([group,tin || nameKey(label) || 'tanpa-identitas:'+path]);
    if(!grouped.has(key)) grouped.set(key,{Jenis:group,NPWP:tin,Nama:label,'Jenis identitas':tin?'Dengan NPWP':label?'Nama saja':'Identitas tidak tersedia',
      Dokumen:0,dpp:[],tax:[],sources:new Set()});
    const g=grouped.get(key);g.Dokumen++;g.dpp.push(r[amount]);g.tax.push(r[tax]);g.sources.add(path);
  }
  for(const f of pkg.forms.filter(f=>f.latest)) for(const [part,e] of f.parts) {
    if(f.type==='PPN' && ['a2','b2'].includes(part)) {
      for(const row of rowsOf(e)) add(part==='a2'?'Pembeli PPN':'Pemasok PPN',row,'TIN','Name','TaxBase','VAT',e.path);
    } else if(f.type==='UNIFIKASI' && /^d1-/.test(part)) {
      for(const row of rowsOf(e)) add('Penerima penghasilan Unifikasi',row,'TaxIdentificationNumber','TaxpayerName','TaxBase','IncomeTax',e.path);
    }
  }
  for(const e of pkg.entries.filter(e=>e.cap?.sumber==='bplawan' || e.path.startsWith('bukti-potong-lawan/'))) {
    for(const row of rowsOf(e)) add('Pemotong di bukti potong lawan',row,'WitholderTin','WitholderName','TaxBase','IncomeTax',e.path);
  }
  return [...grouped.values()].map(({dpp,tax,sources,...row})=>({...row,'Dasar pengenaan':total(dpp),'Pajak pada dokumen':total(tax),'Berkas sumber':[...sources].join('\n')}));
}
function timeline(groups) {
  const rows=[];
  for(const [section,items,keys] of groups) for(const item of items) for(const key of keys) {
    const d=date(item[key]);if(d) rows.push({Tanggal:d,Bagian:section,Peristiwa:key,Keterangan:item.PersonName||item.ActivityDescription||item.DocumentTitle||item.TaxTypeCode||item.ActivityName||'','Berkas sumber':item['Berkas sumber']});
  }
  return rows.sort((a,b)=>b.Tanggal.localeCompare(a.Tanggal));
}
export function linkedPaymentGroups(f, ledger) {
    const refs=new Set([f.id,ledgerDocumentReference(f.meta),'SPT-'+f.id].filter(Boolean).map(String));
    const liabilities=ledger.filter(r=>r.AccountingTypeCode==='TaxReturn' && refs.has(String(r.ReferenceNumber)) &&
      number(r.Amount)!==null && r.Amount<0 && r.PeriodCode && r.RevenueCode);
    const grouped=new Map();
    for(const row of liabilities){
      const key=JSON.stringify([row.RevenueCode,row.PeriodCode]);
      if(!grouped.has(key))grouped.set(key,[]);
      grouped.get(key).push(row);
    }
    return [...grouped.values()].map(charges=>{
      const {RevenueCode,PeriodCode}=charges[0];
      const payments=ledger.filter(r=>r.AccountingTypeCode==='Payment' && r.PeriodCode===PeriodCode && r.RevenueCode===RevenueCode);
      return {charges,payments,RevenueCode};
    });
}
export function reconcilePayments(forms, ledger) {
  const rows=[];
  for(const f of forms.filter(f=>f.latest)){
    for(const {charges,payments,RevenueCode} of linkedPaymentGroups(f,ledger)){
      const debit=-total(charges.map(r=>r.Amount)),credit=total(payments.map(r=>r.Amount));
      const status=!payments.length?'Belum ada setoran dalam paket':credit===null?'Nilai setoran belum lengkap':
        credit===debit?'Sesuai':credit<debit?'Kurang setor pada pembanding':'Lebih setor pada pembanding';
      rows.push({Jenis:typeNames[f.type]||f.type,Masa:f.period,Versi:f.version,KAP:RevenueCode,
        'Kewajiban terkait SPT':debit,'Setoran masa dan KAP':credit,Status:status,
        'Berkas sumber':[...new Set([f.key,...charges.concat(payments).map(r=>r['Berkas sumber'])])].join('\n')});
    }
  }
  return rows;
}
const sourceNames={info:'informasi-umum',pihak:'pihak-terkait',bank:'rekening-bank',flag:'flag-wp',jenispajak:'jenis-pajak',alamat:'alamat',klu:'klu',nomorlain:'nomor-identitas-lain',sertel:'sertifikat-elektronik',pbb:'tanah-bangunan',login:'login-terakhir',dokumen:'dokumen'};

export function annualBusinessCodes(registry, years, captured) {
  const primary=registry.filter(r=>r.IsMainEconomicCode===true && r.TradeClassificationCode && date(r.ValidFrom));
  const current=new Set(primary.filter(r=>captured && date(r.ValidFrom)<=captured && (!date(r.ValidTo)||date(r.ValidTo)>=captured)).map(r=>r.TradeClassificationCode));
  return [...new Set(years)].sort().reverse().flatMap(year=>{
    const matches=primary.filter(r=>date(r.ValidFrom)<=year+'-12-31' && (!date(r.ValidTo) || date(r.ValidTo)>=year+'-01-01'));
    const codes=new Set(matches.map(r=>r.TradeClassificationCode));
    return matches.map(r=>({'Tahun SPT':year,KLU:r.TradeClassificationCode,Uraian:r.ActivityDescription,
      Mulai:date(r.ValidFrom),Akhir:date(r.ValidTo),Catatan:codes.size>1?'Beberapa KLU utama dalam tahun ini':
      current.size===1 && !current.has(r.TradeClassificationCode)?'Berbeda dari KLU utama pada tanggal paket':'',
      'Berkas sumber':r['Berkas sumber']}));
  });
}

export function profileSections(pkg) {
  const files=Object.fromEntries(Object.entries(sourceNames).map(([k,v])=>[k,pkg.entries.filter(e=>e.cap?.sumber===k || e.path==='profil/'+v+'.json')]));
  const input=Object.fromEntries(Object.entries(files).map(([k,arr])=>[k,sourceRows(arr)]));
  const forms=pkg.forms||[], latest=forms.filter(f=>f.latest);
  const annual=latest.filter(f=>f.type==='BADAN').sort((a,b)=>b.period.localeCompare(a.period));
  const op=latest.filter(f=>f.type==='OP'), general=first(input.info).GeneralInformation || {};
  const isOp=general.TaxpayerType==='TA001' || (!general.TaxpayerType && (general.TaxpayerCategory==='I_IN'||(op.length>0 && !annual.length)));
  const last=annual[0], body=first(rowsOf(last?.parts.get('induk'))), owned=body.ListOfOwnership;
  const sections=[];
  const reg='Identitas dan registrasi', related='Pihak terkait', obligations='Kewajiban dan kepatuhan', payment='Pembayaran dan tagihan', assets='Harta dan objek pajak';
  function add(id,group,title,rows,note='',refs=[]) {sections.push({id,group,title,rows,note,refs});}
  const fpaths=names=>names.flatMap(name=>files[name].map(f=>f.path));
  const summary=[];
  for(const key of ['info','flag','login']) for(const row of input[key]) {
    const {'Berkas sumber':path,...data}=row;
    for(const [Isian,Nilai] of flatten(data)) summary.push({Isian,Nilai,'Berkas sumber':path});
  }
  add('utama',reg,'Profil utama',summary,'',fpaths(['info','flag','login']));
  const registeredVat=input.jenispajak.filter(r=>r.TaxTypeCode==='VAT_VAT').map(r=>date(r.RegistrationDate)).filter(Boolean);
  sections[0].cards=[
    ['Status WP',general.TaxpayerStatus],['Status PKP pada profil',general.TaxablePersonForVATPurposesStatus],
    ['Tanggal registrasi PPN',[...new Set(registeredVat)].join(', ')],['Risiko CRM',general.RiskProfileCode],
    ['Jumlah pegawai',general.NumberofStaff],['Perkiraan peredaran',general.ForecastedAnnualTurnover],
    ['Penanda',input.flag.map(r=>[r.FlagType,r.FlagValue].filter(v=>v!=null).join(' · ')).filter(Boolean).join(', ')],
    ['Dalam penagihan',general.IsUnderEnforcement===true?'Ya':general.IsUnderEnforcement===false?'Tidak':general.IsUnderEnforcement]
  ];
  add('identitas',reg,'Identitas lain, sertifikat dan dokumen',[...input.nomorlain,...input.sertel,...input.dokumen],'',fpaths(['nomorlain','sertel','dokumen']));
  add('waktu',reg,'Garis waktu',timeline([['KLU',input.klu,['ValidFrom','ValidTo']],['Alamat',input.alamat,['ValidFrom','ValidTo']],['Pihak terkait',input.pihak,['ValidFrom','ValidTo']],['Jenis pajak',input.jenispajak,['RegistrationDate','DeregistrationDate']],['Dokumen',input.dokumen,['DocumentDate']]]));
  add('cabang',reg,'Cabang dan tempat kegiatan usaha',input.alamat.filter(r=>r.TypeOfAddress==='TKU'||r.ActivityType==='BRNCH'),'Alamat pusat dan alamat identitas disajikan pada Histori alamat.',fpaths(['alamat']));
  add('alamat',reg,'Histori alamat',input.alamat,'',fpaths(['alamat']));
  add('klu',reg,'Klasifikasi lapangan usaha',input.klu,'Tanggal mulai dan akhir mengikuti riwayat registrasi.',fpaths(['klu']));
  add('klu-tahun',reg,'KLU utama per tahun SPT',annualBusinessCodes(input.klu,forms.map(f=>f.year),date(pkg.manifest.dibuat)),
    'Baris ditampilkan jika paket memuat SPT tahun bersangkutan dan KLU utama dengan tanggal mulai registrasi.');
  add('kewajiban',reg,'Registrasi jenis pajak',input.jenispajak,'',fpaths(['jenispajak']));
  if(!isOp){
    const cmp=compareShareholders(input.pihak,list(owned?.ListOfShareholders),{
      hasRegistry:files.pihak.length>0 && files.pihak.every(e=>e.cap?.lengkap!==false),
      hasReport:Array.isArray(owned?.ListOfShareholders),asOf:date(pkg.manifest.dibuat)});
    const pct=v=>v===null?'belum tersedia':v.toLocaleString('id-ID')+'%'+(Math.abs(v-100)>1e-8?' (periksa total)':'');
    add('saham',related,'Pemegang saham',cmp.rows,'Porsi registrasi '+pct(cmp.registryTotal)+'. Porsi SPT '+(last?.period || '')+' '+pct(cmp.reportTotal)+'.',
      [...fpaths(['pihak']),...(last?.parts.has('induk')?[last.parts.get('induk').path]:[])]);
    add('pengurus',related,'Direksi dan komisaris',input.pihak.filter(r=>/^C_LC_(DI|CO)(_|$)/.test(r.RelatedPersonType ?? '')),'Mencakup riwayat jabatan yang tertera pada sumber.',fpaths(['pihak']));
    add('penyertaan',related,'Penyertaan modal dan subsidiari',list(owned?.InvestmentList).map(r=>({...r,'Tahun SPT':last.period,'Berkas sumber':last.parts.get('induk').path})));
    add('tahun-buku',reg,'Histori tahun buku',annual.map(f=>{const main=first(rowsOf(f.parts.get('induk'))).MainFormData||{};return {'Tahun SPT':f.year,Versi:f.version,Awal:date(main.AccountingPeriodStart),Akhir:date(main.AccountingPeriodEnd),'Berkas sumber':f.parts.get('induk')?.path};}));
  }
  add('pihak',related,'Daftar pihak terkait',input.pihak,'',fpaths(['pihak']));
  add('relasi',related,'Relasi transaksi',relate(pkg),'PPN dan Unifikasi memakai versi terakhir tiap masa dalam paket. Rekap memisahkan sumber serta identitas yang tersedia.');
  const led=packageLedger(pkg);
  const filed=sourceRows(pkg.entries.filter(e=>e.cap?.sumber==='sptdaftar'||e.path==='spt/daftar.json'));
  const dates=filed.map(row=>{
    const reported=submittedDay(row), deadline=sptDay(row.ExpectedReturnDate);
    return {Jenis:row.ReturnSheetTypeCode,Masa:row.TaxPeriodCode,Model:row.ReturnSheetModel,...receiptFields(row),'Tanggal lapor':reported,'Batas pada sumber':deadline,
      'Posisi tanggal':row.ReturnSheetModel!=='Normal'?'Pembetulan / model lain':!reported||!deadline?'Belum dapat dibandingkan':reported>deadline?'Lewat tanggal pada sumber':'Dalam tanggal pada sumber','Berkas sumber':row['Berkas sumber']};
  });
  add('lapor',obligations,'Pemenuhan pelaporan',dates,'Perbandingan memakai tanggal yang disimpan dalam paket. Masa tanpa data memerlukan pemeriksaan ketersediaan sumber.');
  add('terlambat',obligations,'Pengawasan keterlambatan lapor',dates.filter(r=>r['Posisi tanggal']==='Lewat tanggal pada sumber'),'Cocokkan hari libur, pengecualian dan STP sebelum menilai sanksi.');
  add('bank',payment,'Rekening bank',input.bank,'',fpaths(['bank']));
  add('tagihan',payment,'Sisa tagihan',led.filter(r=>number(r.AmountLeft)!==null && r.AmountLeft<0));
  add('kredit',payment,'Saldo kredit dan pengembalian',led.filter(r=>r.AccountingTypeCode==='Refund'||number(r.AmountLeft)>0));
  const deposits=led.filter(r=>r.AccountingTypeCode==='Payment');
  add('pembayaran',payment,'Rincian pembayaran',deposits);
  const grouped=new Map();
  for(const r of deposits){const y=date(r.PostingDate).slice(0,4),tax=r.RevenueCode ?? '',way=r.AccountingTypeDetailCode ?? '',k=JSON.stringify([y,tax,way]);
    if(!grouped.has(k))grouped.set(k,{Tahun:y,KAP:tax,Cara:way,values:[]});
    grouped.get(k).values.push(r.Amount);
  }
  add('rekap-bayar',payment,'Ikhtisar pembayaran',[...grouped.values()].map(({values,...r})=>({...r,Transaksi:values.length,Nilai:total(values)})));
  add('pemenuhan-bayar',payment,'Pemenuhan pembayaran',reconcilePayments(forms,led),'Hanya kewajiban buku besar yang merujuk SPT versi terakhir yang dibandingkan dengan setoran pada KAP dan masa yang sama. Kesesuaian jumlah perlu dikonfirmasi dengan alokasi pembayaran.');
  add('pbk',payment,'Pemindahbukuan',led.filter(r=>r.AccountingTypeDetailCode==='BT'||/^Balance Transfer/.test(r.ReferenceType)));
  add('produk-hukum',payment,'Produk hukum',led.filter(r=>r.AccountingTypeCode==='TaxNotice'||['NoticeOfTaxCollection','TaxAssessment'].includes(r.ReferenceType)));
  add('pbb',assets,'Objek tanah dan bangunan',input.pbb,'',fpaths(['pbb']));
  if(!isOp){
    add('harta',assets,'Harta SPT Badan',annual.flatMap(f=>sourceRows([...f.parts].filter(([p])=>/^l9-\d/.test(p)).map(([,e])=>e)).map(r=>({'Tahun SPT':f.year,...r}))));
  } else {
    const group='SPT orang pribadi', base=op.map(f=>({f,r:first(rowsOf(f.parts.get('induk')))}));
    add('op-rezim',group,'Isian rezim per tahun',base.map(({f,r})=>({'Tahun SPT':f.year,'Sumber penghasilan':r.SourceOfIncome,'Metode pembukuan':r.TypeOfBookKeeping,'Penghasilan neto usaha atau pekerjaan bebas':r.NetIncomeFromBusinessProfession,'Berkas sumber':f.parts.get('induk')?.path})));
    add('op-ringkas',group,'Ringkasan SPT OP',base.map(({f,r})=>({'Tahun SPT':f.year,Versi:f.version,'Penghasilan neto':r.AnnualNetIncome,'Penghasilan kena pajak':r.TaxableIncome,'PPh terutang':r.IncomeTaxPayable,'Kurang/(lebih) bayar':r.UnderOrOverPaymentTax,'Berkas sumber':f.parts.get('induk')?.path})));
    const partRows=re=>op.flatMap(f=>sourceRows([...f.parts].filter(([part])=>re.test(part)).map(([,e])=>e)).map(r=>({'Tahun SPT':f.year,...r})));
    add('op-penghasilan',group,'Penghasilan dan bukti potong',partRows(/^(l1-d|l1-e|l2-a)$/));
    const debts=base.flatMap(({f,r})=>list(r.PitrL1Form?.ListDebtAtTheEndOfTaxYear).map(row=>({'Tahun SPT':f.year,Jenis:'Utang',...row,'Berkas sumber':f.parts.get('induk').path})));
    add('op-harta',group,'Harta dan utang',[...partRows(/^l1-a[1-6]$/).map(r=>({...r,Jenis:'Harta'})),...debts]);
    add('op-keluarga',group,'Keluarga dan PTKP',base.flatMap(({f,r})=>[
      {'Tahun SPT':f.year,Isian:'Status PTKP',Nilai:r.TaxExemptionType,'Berkas sumber':f.parts.get('induk')?.path},
      ...rowsOf(f.parts.get('keluarga')).flatMap(x=>list(x.FamilyMembers)).map(member=>({'Tahun SPT':f.year,...member,'Berkas sumber':f.parts.get('keluarga').path})),
      ...list(r.PitrL1Form?.ListDependantsFamilyMembers).map(member=>({'Tahun SPT':f.year,...member,'Berkas sumber':f.parts.get('induk')?.path}))
    ]));
    add('op-riwayat',group,'Riwayat SPT Tahunan OP',forms.filter(f=>f.type==='OP').map(f=>({Jenis:typeNames.OP,Tahun:f.year,Versi:f.version,'Tanggal lapor':f.reportDate ?? submittedDay(f.meta),...receiptFields(f.meta),Sumber:f.key})));
  }
  return sections;
}

const cachedSections=new WeakMap();
export function indexedProfileSections(pkg) {
  if(!cachedSections.has(pkg))cachedSections.set(pkg,profileSections(pkg));
  return cachedSections.get(pkg);
}
export function renderProfile(target,state) {
  const wp=state.pkg.manifest.wp;
  const sections=indexedProfileSections(state.pkg), groups=[...new Set(sections.map(s=>s.group))];
  const sectionFromEntry=sections.find(s=>s.refs.includes(state.selectedEntry));
  const active=sections.find(s=>s.id===state.section)||sectionFromEntry||sections[0];
  const panel=card(''),rail=box('rail'),mobile=el('select');
  mobile.setAttribute('aria-label','Bagian profil WP');
  const view=matchMedia('(max-width:780px)');
  for(const group of groups) {
    const groupOptions=el('optgroup');groupOptions.label=group;mobile.append(groupOptions);
    for(const s of sections.filter(s=>s.group===group)){
      const option=el('option',s.title+' ('+s.rows.length+')');option.value=s.id;groupOptions.append(option);
    }
  }
  function paint() {
    rail.replaceChildren();
    for(const group of groups){
      rail.append(el('strong',group));for(const s of sections.filter(s=>s.group===group)){
        const b=button(s.title+' ('+s.rows.length+')',()=>state.go('profil',s.id),s===active?'':'secondary');
        b.setAttribute('aria-current',s===active?'page':'false');rail.append(b);
      }
    }
    mobile.value=active.id;
    const refs=active.refs.length?detail('Berkas sumber',el('pre',active.refs.join('\n'))):null;
    const summary=active.cards && box('grid',...active.cards.map(([name,value])=>box('kpi',el('small',name),
      el('b',value==null || value===''?'—':typeof value==='number'?value.toLocaleString('id-ID'):value))));
    panel.replaceChildren(el('h2',active.title),...(summary?[summary]:[]),...(active.note?[el('p',active.note,'hint')]:[]),
      dataTable(active.rows,{wp,name:active.title,filename:'RAHASIA-Profil-'+active.id,empty:'Belum ada baris yang dapat ditampilkan dari sumber dalam paket ini.'}),...(refs?[refs]:[]));
  }
  mobile.onchange=()=>state.go('profil',mobile.value);
  const actions=box('toolbar',button('Excel semua bagian',()=>exportSheets(sections.map(s=>({name:s.title,rows:worksheet(s.rows)})),'RAHASIA-Profil-WP',wp)),button('Cetak / PDF',()=>window.print()));
  paint();target.append(card('Profil WP',actions),box('split',view.matches?mobile:rail,panel));
}
