import {directCreditFindings} from './direct-finding-credits.js';
import {directLaw} from './direct-finding-calendar.js';
import {directStp} from './direct-finding-stp.js';
import {observedTransferRows} from './direct-finding-transfers.js';

// Credit differences reduce the declared balance when positive. The second
// calculation isolates additional principal relative to the original balance.
function balanceScenario(reported,change){
  const projected=reported-change;
  const additional=Math.max(0,projected)-Math.max(0,reported);
  return Number.isSafeInteger(projected)&&Number.isSafeInteger(additional)?{projected,additional:Math.max(0,additional)}:null;
}
function assessmentTable(credits){
  const {assessment:a,scenario:s}=credits;
  const table={title:'Perkiraan dampak terhadap saldo PPh Badan',columns:['Dasar','Saldo menurut SPT (Rp)','Perubahan kredit (Rp)',
    'Saldo KB/(LB) setelah perubahan (Rp)','Tambahan pokok positif (Rp)','Sumber','Keterangan'],rows:[]};
  const compare=(label,reported,delta,source,note)=>{
    const balance=Number.isSafeInteger(reported)&&Number.isSafeInteger(delta)?balanceScenario(reported,delta):null;
    table.rows.push([label,reported,delta,balance?.projected??null,balance?.additional??null,source,note]);
    return balance;
  };
  const actual=a.ready?compare('Kredit dan angsuran dengan dasar sejenis',a.reportedBalance,a.creditDifference,a.source,a.reason):null;
  if(!actual&&s)compare('Skenario dengan asumsi cakupan kredit',s.reportedBalance,s.creditChange,s.source,s.assumption);
  return {table,actual};
}

export function directFindings(pkg,year,work={},index={groups:[],byId:new Map()}){
  const credits=directCreditFindings(pkg,String(year),index),stp=directStp(pkg,String(year),work);
  const transfers=observedTransferRows(pkg,String(year),work.simulation?.end);
  const {table,actual}=assessmentTable(credits);
  const observed=(key,label)=>{
    const values=stp.observations.map(r=>r[key]).filter(Number.isSafeInteger);
    const amount=values.reduce((s,n)=>s+n,0);
    return {label,value:values.length&&Number.isSafeInteger(amount)?amount:null,note:values.length+' baris dengan nilai yang terkonfirmasi.'};
  };
  const totals=[
    {label:'Perkiraan tambahan pokok PPh Badan',value:actual?.additional??null,note:credits.assessment.reason},
    observed('newAmount','Estimasi sanksi baru dari baris yang dapat dihitung'),
    observed('booked','STP yang sudah tercatat dan cocok dengan peristiwa'),
    observed('balance','Sisa pokok yang tercatat pada buku besar')
  ];
  const notes=[...credits.notes,...stp.notes,
    'Denda, bunga, dan sisa pokok dipisahkan. Periksa dokumen penetapan, pengecualian atau penghapusan sanksi, relaksasi, hari libur setempat, serta alokasi pembayaran sebelum menindaklanjuti.',
    'Penghitungan setoran mencakup SPT Masa PPN, PPh 21/26 dan Unifikasi dengan masa, KAP, KJS, setoran kas serta kewajiban yang dapat dipasangkan. Kalender nasional yang tersedia mencakup 2025 dan 2026.',
    'Dasar UU KUP · '+directLaw.kup,'Batas pembayaran dan hari kerja · '+directLaw.coretax,'Penerbitan STP · '+directLaw.collection,
    'Kalender 2025 · '+directLaw.holidays2025,'Kalender 2026 · '+directLaw.holidays2026];
  const creditFacts=credits.facts.map(f=>({...f,key:'tl/credit/'+year+'/'+f.ruleId,sourceKey:'tl/credit/'+year+'/'+f.ruleId}));
  if(transfers.rows.length)notes.push('Tabel pemindahbukuan mencakup transaksi yang tanggal buku besarnya melewati batas umum dan alokasinya cocok dengan satu kewajiban. Cocokkan tanggal bayar pada BPN atau Bukti Pemindahbukuan. Periksa sebab pembetulan dan relaksasi sebelum menghitung sanksi. Jumlah ini tidak masuk total sanksi.');
  return {tables:[credits.table,table,stp.table,...(transfers.rows.length?[transfers]:[])],totals,notes,facts:[...creditFacts,...stp.facts]};
}
