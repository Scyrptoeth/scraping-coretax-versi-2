import {kbli} from './catalog-data.js';
import {kluZ} from './klu-z.js';

// KBLI 2020 table of contents, from the first to last division of each category.
const divisions2020=[
  ['A',1,3],['B',5,9],['C',10,33],['D',35,35],['E',36,39],['F',41,43],['G',45,47],
  ['H',49,53],['I',55,56],['J',58,63],['K',64,66],['L',68,68],['M',69,75],['N',77,82],
  ['O',84,84],['P',85,85],['Q',86,88],['R',90,93],['S',94,96],['T',97,98],['U',99,99]
];
// Division ranges in the annex to BPS Regulation 7/2025, checked for all 87 divisions.
const divisions2025=[...divisions2020.slice(0,6),['G',46,47],['H',49,53],['I',55,56],['J',58,60],['K',61,63],
  ['L',64,66],['M',68,68],['N',69,75],['O',77,82],['P',84,84],['Q',85,85],['R',86,88],['S',90,93],['T',94,96],['U',97,98],['V',99,99]];
const levelNames=['Kategori','Golongan pokok','Golongan','Subgolongan','Kelompok'];
export const codeTitle=(code,edition='2020')=>kluZ[code]?.title||kbli[edition]?.[code]||'';

function editionOf(activities,choice){
  if(['2020','2025'].includes(choice))return choice;
  if(choice!=='auto')return '';
  const editions=new Set();
  const normalize=s=>String(s||'').toLocaleUpperCase('id-ID').replace(/[^\p{L}\p{N}]/gu,'');
  for(const r of activities){
    const code=String(r.code||'').trim().toUpperCase();
    if(kluZ[code])continue;
    const available=['2020','2025'].filter(y=>Object.hasOwn(kbli[y],code));
    if(available.length===1)editions.add(available[0]);
    if(available.length===2&&r.name){
      const matches=available.filter(y=>normalize(kbli[y][code])===normalize(r.name));
      if(matches.length===1)editions.add(matches[0]);
    }
  }
  return editions.size>1?'':editions.values().next().value||'2025';
}
function category(code,edition) {
  if(code.startsWith('Z'))return 'Z';
  const division=Number(code.slice(0,2));
  const divisions=edition==='2025'?divisions2025:divisions2020;
  return divisions.find(([,from,to])=>division>=from && division<=to)?.[0];
}
function totals(rows,key) {
  const sums=new Map();
  for(const row of rows) {
    const label=key(row);
    sums.set(label,(sums.get(label)||0n)+row.amount);
  }
  return [...sums].map(([code,amount])=>({code,amount})).sort((a,b)=>
    a.amount===b.amount?a.code.localeCompare(b.code):a.amount>b.amount?-1:1);
}

export function hierarchicalKlu(activities,choice='2020') {
  const edition=editionOf(activities,choice);
  const result={code:'',message:'',total:0n,steps:[],edition};
  const rows=[];
  if(!activities.length){result.message='Tambahkan kegiatan untuk menguji KLU utama.';return result;}
  if(!edition){result.message='Kode atau uraian kegiatan berasal dari edisi KBLI berbeda. Samakan edisi seluruh kegiatan sebelum menghitung.';return result;}
  for(const [index,activity] of activities.entries()){
    const code=String(activity.code||'').trim().toUpperCase(), amount=String(activity.amount??'').trim();
    if(!/^(?:\d{5}|Z\d{4})$/.test(code) || !codeTitle(code,edition) || !category(code,edition)) {
      result.message='Baris '+(index+1)+' memerlukan kode kelompok yang terdapat dalam KBLI '+edition+' atau KLU Z.';return result;
    }
    if(!/^\d+$/.test(amount)) {
      result.message='Isi nilai bruto tahun sebelumnya dalam rupiah utuh pada baris '+(index+1)+'.';return result;
    }
    const value=BigInt(amount);rows.push({code,amount:value});result.total+=value;
  }
  if(result.total===0n){
    result.message='Seluruh nilai nol. Jika usaha belum berjalan, WP menentukan KLU utama.';return result;
  }
  let active=rows.filter(r=>r.amount>0n);
  function choose(title,key) {
    const candidates=totals(active,key), top=candidates[0].amount;
    const tied=candidates.filter(c=>c.amount===top);
    const winner=tied.length===1?tied[0].code:'';
    result.steps.push({title,candidates,base:result.total,winner});
    if(!winner) {
      result.message='Nilai tertinggi pada tingkat '+title.toLowerCase()+' sama untuk '+tied.map(c=>c.code).join(', ')+'. Periksa pilihan WP untuk melanjutkan penentuan KLU.';return '';
    }
    active=active.filter(row=>key(row)===winner);return winner;
  }

  function trade(division) {
    const wholesale=division==='46';
    const own='462–469 · Perdagangan besar yang dilakukan sendiri', agency='461 · Balas jasa atau kontrak';
    const shop=edition==='2025'?'471–478 · Penjualan eceran':'471–477 · Eceran di toko';
    const outside=edition==='2025'?'479 · Jasa intermediasi eceran':'478–479 · Eceran di luar toko';
    const totalDivision=active.reduce((sum,r)=>sum+r.amount,0n);
    const route=choose('Cabang perdagangan',r=>wholesale?(r.code.startsWith('461')?agency:own):
      (Number(r.code.slice(0,3))<=(edition==='2025'?478:477)?shop:outside));
    if(!route)return false;
    if(route===agency || route===outside)return true;
    const general=wholesale?'469':'471';
    const subs=totals(active,r=>r.code.slice(0,4));
    const special=subs.filter(s=>!s.code.startsWith(general));
    const dominant=subs.filter(s=>s.amount*2n>=totalDivision);
    const kinds=new Set(dominant.map(s=>s.code.startsWith(general)?'umum':'khusus'));
    const significant=special.filter(s=>s.amount*20n>=totalDivision).length;
    const title='Perdagangan barang khusus atau '+(wholesale?'berbagai macam barang':'nonkhusus');
    const step={title,candidates:subs,base:totalDivision,divisionShare:true,winner:'',note:''};result.steps.push(step);
    if(kinds.size>1) {
      result.message='Dua jenis perdagangan masing-masing mencapai 50% dari golongan pokok. Periksa klasifikasi kegiatan sebelum menentukan kelompok.';return false;
    }
    const onlyGeneral=special.length===0;
    const isSpecial=kinds.size?[...kinds][0]==='khusus':!onlyGeneral && significant<=4;
    const target=isSpecial?'barang khusus':wholesale?'berbagai macam barang':'barang nonkhusus';
    step.note=kinds.size?'Ada subgolongan dengan sedikitnya 50% dari nilai golongan pokok.':onlyGeneral?
      'Seluruh rincian dalam cabang ini berada pada golongan '+general+'.':
      significant+' subgolongan barang khusus masing-masing menyumbang sedikitnya 5% dari nilai golongan pokok.';
    step.note+=' Hasil klasifikasi perdagangan adalah '+target+'.';
    active=active.filter(r=>isSpecial?!r.code.startsWith(general):r.code.startsWith(general));
    if(!active.length) {
      result.message='Hasil klasifikasi mengarah ke perdagangan '+target+'. Rincian kode kelompok untuk cabang tersebut belum tersedia pada masukan.';return false;
    }
    return true;
  }
  if(!choose(levelNames[0],r=>category(r.code,edition)))return result;
  const division=choose(levelNames[1],r=>r.code.slice(0,2));
  if(!division)return result;
  if(['46','47'].includes(division) && !trade(division))return result;
  for(let length=3;length<=5;length++){
    const chosen=choose(levelNames[length-1],r=>r.code.slice(0,length));
    if(!chosen)return result;
    if(length===5)result.code=chosen;
  }
  result.message='Kelompok hasil uji · '+result.code+' · '+codeTitle(result.code,edition);
  return result;
}

export function percentage(amount,base) {
  if(!base)return '—';
  const hundredths=(amount*10000n+base/2n)/base;
  return (hundredths/100n).toString()+','+(hundredths%100n).toString().padStart(2,'0')+'%';
}
