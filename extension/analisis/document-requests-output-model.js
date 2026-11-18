import {isRegisteredProbisCode,publicGuide,probisRequestKey} from '../probis-guide.js';
import {checkIdentity,normalizeId} from '../app-data.js';
import {annualBusinessCodes} from './profile.js';
import {rowsOf} from './model.js';
import {buildSchedule} from './inspection-schedule.js';

export const inspectionTypes=[['lengkap','Lengkap'],['terfokus','Terfokus'],['spesifik','Spesifik']];
export const documentTaxes=[['B','PPh Badan'],['OP','PPh Orang Pribadi'],['N','PPN'],['C','PPh 21/26'],
  ['G','PPh 23/26'],['K','PPh Pasal 4 ayat (2)'],['E','PPh Pasal 22'],['F','PPh Pasal 15']];
const families=new Map(documentTaxes);
export function validateDocumentScope(input={type:'lengkap',taxes:[...families.keys()]}){
  if(!input||typeof input!=='object'||!inspectionTypes.some(([key])=>key===input.type)||!Array.isArray(input.taxes)||
    input.taxes.some(key=>!families.has(key))||new Set(input.taxes).size!==input.taxes.length)
    throw Error('Periksa jenis pemeriksaan dan jenis pajak pada cakupan SP2.');
  return {type:input.type,taxes:[...families.keys()].filter(key=>input.type==='lengkap'||input.taxes.includes(key))};
}

// Each rule names the index where its document can support a particular check.
const rules=[
  ['SP2/UMUM','dokumen-sp2','Surat Perintah Pemeriksaan dan perubahan yang berlaku'],
  ['SP2/UMUM','daftar-bukti','Daftar buku, catatan, dan dokumen yang diserahkan'],
  ['BADAN/B','laporan-keuangan','Laporan keuangan dan catatan atas laporan keuangan'],
  ['BADAN/B.1','jurnal-penjualan','Rincian jurnal penjualan untuk tahun yang diperiksa'],
  ['BADAN/B.1.4','rincian-ekualisasi','Rekonsiliasi omzet dan penyerahan PPN menurut masa, termasuk penjelasan selisih'],
  ['BADAN/B.2','mutasi-persediaan','Kartu persediaan dan rincian perhitungan harga pokok penjualan'],
  ['BADAN/B.3','biaya-usaha','Rincian biaya usaha per akun beserta bukti transaksi terpilih'],
  ['BADAN/B.7','rincian-koreksi','Perhitungan koreksi fiskal per akun dan daftar penyusutan terkait'],
  ['BADAN/B.10','rugi-fiskal','Rincian kompensasi kerugian fiskal per tahun asal'],
  ['BADAN/B.13','angsuran','Daftar angsuran PPh beserta bukti pembayaran'],
  ['OP/B','catatan-penghasilan','Rekap penghasilan setahun dan dokumen pendukungnya'],
  ['PPN/N.2','penyerahan-ekspor','Pemberitahuan ekspor dan dokumen pengangkutan terkait'],
  ['PPN/N.3','penyerahan-dalam-negeri','Rincian penyerahan dalam negeri dan faktur keluaran terkait'],
  ['PPN/N.5','fasilitas-ppn','Dokumen fasilitas PPN atas penyerahan yang diperiksa'],
  ['PPN/N.8.1','impor-masukan','Pemberitahuan impor dan bukti pembayaran PPN impor'],
  ['PPN/N.10','perolehan-dalam-negeri','Daftar pembelian dan faktur masukan untuk transaksi terpilih'],
  ['PPH2126/C','rekap-penggajian','Rekap penggajian dan bukti pemotongan per masa'],
  ['PPH2126/C.2.1','imbalan-tenaga','Daftar komponen penghasilan dan pembayaran kepada penerima'],
  ['UNIFIKASI/E.2.1','objek-pemungutan','Rincian transaksi dan bukti pemungutan PPh Pasal 22'],
  ['UNIFIKASI/E.2.2','setoran-pemungutan','Rekap PPh Pasal 22 yang dipungut serta bukti penyetoran'],
  ['UNIFIKASI/G.2.1','imbalan-jasa','Kontrak jasa, tagihan, dan bukti potong yang bersangkutan'],
  ['UNIFIKASI/K.2.1','bukti-final','Daftar pembayaran yang dikenai PPh final dan bukti pemotongannya'],
  ['UNIFIKASI/K.2.2','pajak-final','Rekap PPh final terutang beserta bukti pemotongan atau pembayaran']
];
const ruleById=new Map(rules.map(r=>[r[1],r]));
export function validateDocumentOrigin(value,indexKey){
  const rule=ruleById.get(value?.rule);
  if(value?.kind!=='kkp'||!rule||rule[0] !== (value.index??indexKey))throw Error('Sumber saran dokumen tidak cocok dengan indeks atau cakupan SP2.');
  return {kind:'kkp',rule:rule[1],index:rule[0]};
}
function groupTax(key){
  const [form,ref]=key.split('/');
  return form==='OP'?'OP':form==='BADAN'?'B':form==='SP2'?ref:ref?.charAt(0);
}
export function documentIndexLabel(key,index,notes={}){
  if(key==='SP2/UMUM')return 'Cakupan umum SP2';
  const [form,tax]=key.split('/');
  if(form==='SP2')return 'Cakupan SP2 · '+families.get(tax);
  const group=index.groups.find(g=>g.key===key);
  const revision=notes[key]?.revision;
  return (group?.ref||tax)+(revision?' (P'+revision+')':'');
}
export function targetOptions(index,scope){
  const selected=validateDocumentScope(scope).taxes;
  const available=index.groups.filter(g=>selected.includes(groupTax(g.key)));
  return [['SP2/UMUM','Cakupan umum SP2'],...available.map(g=>[g.key,g.ref+' · '+g.title]),
    ...selected.map(key=>['SP2/'+key,'Cakupan SP2 · '+families.get(key)])];
}
export function registeredDocumentBusiness(pkg,year){
  const owner=normalizeId(pkg?.manifest?.wp?.npwp);
  if(!owner||pkg.report?.valid===false)return;
  const entries=(pkg.entries||[]).filter(entry=>entry.cap?.sumber==='klu'||/(?:^|\/)profil\/klu\.json$/iu.test(entry.path));
  if(!entries.length||entries.some(e=>e.cap?.lengkap!==true||normalizeId(e.cap?.konteks?.npwp)!==owner||e.pages?.some(p=>p?.IsSuccessful===false)))return;
  const rows=entries.flatMap(rowsOf);
  try{checkIdentity(rows,owner);}catch{return;}
  const codes=new Set(annualBusinessCodes(rows,[String(year)],'').map(r=>r.KLU));
  if(codes.size!==1)return;
  const [code]=codes;
  if(!isRegisteredProbisCode(code))return;
  return {code,edition:'Registrasi Coretax'};
}
export function suggestedRequests(index,scope,year,business,registered){
  const selected=validateDocumentScope(scope).taxes;
  const known=new Set(index.groups.map(g=>g.key));
  const result=rules.filter(([key])=>key==='SP2/UMUM'||(known.has(key)&&selected.includes(groupTax(key))))
    .map(([index,rule,name])=>({index,name,origin:{kind:'kkp',rule,index}}));
  const ref=business?.reference||registered;
  if(ref){
    const guide=publicGuide(ref.code);
    for(const [id,name] of guide.documents){
      result.push({index:'SP2/UMUM',name,probis:{klu:ref.code,edition:ref.edition,year:String(year),
        procedure:guide.code,check:guide.check,document:id}});
    }
  }
  return result;
}
export function duplicateRequest(docs,candidate){
  const normalized=s=>s.trim().replace(/\s+/gu,' ').toLocaleLowerCase('id-ID');
  return docs.find(d=>d.number!==candidate.number&&((candidate.origin&&candidate.origin.rule===d.origin?.rule)||
    (d.index===candidate.index&&((candidate.probis&&d.probis&&probisRequestKey(d.index,d.probis)===probisRequestKey(candidate.index,candidate.probis))||
      normalized(candidate.name)===normalized(d.name)))));
}
export function requestSource(d){
  if(d.probis){
    const basis=d.probis.edition==='Registrasi Coretax'?'registrasi Coretax, edisi belum diketahui':d.probis.edition;
    return 'ProBis · '+d.probis.procedure+' · '+d.probis.klu+' ('+basis+') · '+d.probis.document;
  }
  if(d.origin){const key=ruleById.get(d.origin.rule)?.[0];return key==='SP2/UMUM'?'Saran umum SP2':'Saran KKP · '+key?.split('/')[1];}
  return 'Isian petugas';
}
export function requestOutput(wp,year,index,work){
  const scope=validateDocumentScope(work.documentScope);
  const deadline=work.schedule?buildSchedule(work.schedule).rows.find(r=>r.id==='documents-due')?.date:null;
  const summary=[['Nama WP',wp.nama||''],['NPWP',wp.npwp||''],['Tahun pajak',String(year)],
    ['Jenis pemeriksaan',inspectionTypes.find(([key])=>key===scope.type)[1]],['Jenis pajak pada SP2',scope.taxes.map(k=>families.get(k)).join(', ')||'Belum dipilih'],
    ['Batas pemenuhan menurut jadwal pemeriksaan',deadline||'Belum tersedia']];
  const docs=[...(work.indexDocuments||[])].sort((a,b)=>a.number-b.number);
  const extra=[['due','Tenggat tercatat'],['reference','Rujukan bukti']].filter(([key])=>docs.some(d=>d[key]));
  const rows=[['Kode','Dokumen','Terkait KKP atau SP2','Status','Diminta','Diterima','Catatan','Sumber saran',...extra.map(v=>v[1])],
    ...docs.map(d=>['DOK.'+d.number,d.name,documentIndexLabel(d.index,index,work.indexNotes),d.status,d.date,d.received||'',d.notes||'',requestSource(d),...extra.map(([key])=>d[key]||'')])];
  return {summary,rows};
}
