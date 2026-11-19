import {kbli} from '../catalog-data.js';
import {kluZ} from '../klu-z.js';
import {hierarchicalKlu,percentage} from '../klu-calculator.js';
import {publicGuide} from '../probis-guide.js';
import {rowsOf,worksheet} from './model.js';
import {annualBusinessCodes,registeredCorrespondence} from './profile.js';

export const taxpayerKinds=['WP dengan beberapa kegiatan','Instansi pemerintah','Badan nirlaba'];
// Excel retains at most 15 significant decimal digits in a numeric cell.
const excelAmount=value=>BigInt(value)>999999999999999n?String(value):Number(value);
export function activityResult(activities,kind){
  if(kind==='Instansi pemerintah')return 'Gunakan kategori administrasi pemerintahan, pertahanan, dan jaminan sosial wajib sesuai kegiatan instansi.';
  if(kind==='Badan nirlaba')return 'Tentukan KLU dari kegiatan yang dijalankan badan.';
  if(activities.some(a=>!a.name.trim()||!/^\d+$/.test(a.amount)))return 'Isi setiap kegiatan dan nilai bruto tahun sebelumnya dalam rupiah utuh.';
  if(!activities.length)return 'Tambahkan setidaknya satu kegiatan.';
  const values=activities.map(a=>BigInt(a.amount)),max=values.reduce((a,b)=>a>b?a:b);
  if(!max)return 'Seluruh nilai nol. Jika usaha belum berjalan, WP menentukan KLU utama.';
  const largest=activities.filter((_,i)=>values[i]===max).map(a=>a.name.trim());
  return largest.length===1?'Kegiatan dengan nilai terbesar: '+largest[0]+'.':'Nilai tertinggi sama pada '+largest.join(', ')+'. WP menentukan KLU utama.';
}
function classify(code,edition){
  if(!/^(?:\d{5}|Z\d{4})$/.test(code))return undefined;
  if(edition==='KLU Z')return kluZ[code]?.title;
  return kbli[edition]?.[code];
}
export function validateBusiness(value={}){
  const fail=()=>{throw Error('Periksa kode acuan, kegiatan dan rujukan pada uji KLU.');};
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['reference','activity'].includes(k)))fail();
  const result={};
  if(value.reference!==undefined){
    const r=value.reference;
    if(!r||!['KLU Z','2020','2025'].includes(r.edition)||typeof r.code!=='string'||!/^(?:\d{5}|Z\d{4})$/.test(r.code)||!classify(r.code,r.edition))fail();
    result.reference={code:r.code,edition:r.edition};
  }
  if(value.activity!==undefined){
    const a=value.activity;
    if(!a||!taxpayerKinds.includes(a.kind)||!Array.isArray(a.activities)||typeof a.evidence!=='string'||typeof a.conclusion!=='string')fail();
    const edition=a.edition??'2020';
    if(!['2020','2025','auto'].includes(edition))fail();
    const activities=a.activities.map(r=>{
      if(!r||typeof r.code!=='string'||typeof r.name!=='string'||typeof r.amount!=='string'||!/^\d+$/.test(r.amount))fail();
      if(r.code?!/^(?:\d{5}|Z\d{4})$/.test(r.code)||![...(edition==='auto'?['2020','2025']:[edition]),'KLU Z'].some(e=>classify(r.code,e)):!r.name.trim())fail();
      return {code:r.code,name:r.name,amount:r.amount};
    });
    if(a.kind===taxpayerKinds[0]&&(!activities.length||activities.some(r=>r.code)&&activities.some(r=>!r.code)))fail();
    result.activity={kind:a.kind,edition,activities,evidence:a.evidence,conclusion:a.conclusion};
  }
  return result;
}

export function businessSheets(pkg,year,work={},verified){
  const registry=verified?.registry??(pkg.entries||[]).filter(e=>e.cap?.sumber==='klu'||/(?:^|\/)klu\.json$/i.test(e.path))
    .flatMap(entry=>rowsOf(entry).filter(r=>r?.TradeClassificationCode).map(r=>({...r,'Berkas sumber':entry.path})));
  const annual=verified?.annual??annualBusinessCodes(registry,[String(year)],String(pkg.manifest.dibuat||'').slice(0,10));
  const identity=[['WP',pkg.manifest.wp?.nama],['NPWP',pkg.manifest.wp?.npwp],['Tahun pajak',String(year)]];
  const business=work.business||{},reference=business.reference,activity=business.activity;
  const forward='Padanan KBLI 2025 jika kode sumber KBLI 2020',reverse='Padanan KBLI 2020 jika kode sumber KBLI 2025';
  const test=[...identity,[],['KLU pada registrasi dalam paket'],['Kode','Uraian Coretax','Utama','Berlaku sejak','Berlaku sampai','KBLI 2020','KBLI 2025','KLU Z','Berkas sumber',forward,reverse]];
  for(const r of registry){
    const code=String(r.TradeClassificationCode);
    const pairs=registeredCorrespondence(code);
    test.push([code,r.ActivityDescription,r.IsMainEconomicCode,r.ValidFrom,r.ValidTo,classify(code,'2020'),classify(code,'2025'),classify(code,'KLU Z'),r['Berkas sumber'],pairs[forward],pairs[reverse]]);
  }
  if(!registry.length)test.push(['Paket belum memuat kode registrasi yang dapat dibaca.']);
  test.push([],['KLU utama yang berlaku pada tahun pilihan']);
  if(annual.length)test.push(...worksheet(annual));else test.push(['Periode KLU utama belum dapat ditentukan dari registrasi.']);
  const picked=reference?[reference.code,classify(reference.code,reference.edition),'Pilihan petugas · '+reference.edition]:null;
  if(picked)test.push([],['Acuan kegiatan yang dipilih',...picked]);
  test.push([],['Uji KLU utama']);
  if(activity){
    test.push(['Jenis WP',activity.kind],['Tahun nilai kegiatan',String(Number(year)-1)],['Rujukan bukti',activity.evidence],['Kode kegiatan','Nama kegiatan','Nilai bruto (Rp)']);
    for(const r of activity.activities)test.push([r.code,r.name,excelAmount(r.amount)]);
    const structured=activity.kind===taxpayerKinds[0]&&activity.activities.every(r=>r.code);
    if(structured){
      const result=hierarchicalKlu(activity.activities,activity.edition);
      const primary=new Set(annual.map(r=>String(r.KLU)));
      test.push([],['Pilihan edisi',activity.edition],['Edisi hasil',result.edition],['Hasil perhitungan',result.message],['Kode hasil',result.code],
        ['Perbandingan dengan KLU terdaftar',result.code&&primary.size===1?(primary.has(result.code)?'Sama':'Berbeda'):'Belum dapat dibandingkan'],
        ['Jenjang','Kode atau cabang','Nilai (Rp)','Porsi','Pilihan pada jenjang']);
      for(const step of result.steps)for(const c of step.candidates)test.push([step.title,c.code,excelAmount(c.amount),percentage(c.amount,step.base),step.winner]);
    }else test.push(['Hasil perhitungan',activityResult(activity.activities,activity.kind)]);
    test.push(['Simpulan petugas',activity.conclusion]);
  }else test.push(['Belum ada uji kegiatan yang disimpan untuk WP dan tahun ini.']);
  const sources=picked?[picked]:(verified?.guide??annual.map(r=>[r.KLU,r.Uraian,r['Berkas sumber']]));
  const probis=[...identity,[],['KLU','Uraian','Dasar pilihan','Kode panduan','Alur kegiatan','Langkah pengujian','Sumber yang diperiksa']];
  const suggestions=[];
  for(const [code,title,basis] of sources){
    const g=publicGuide(String(code));
    probis.push([code,title,basis,g.code,g.flow,g.check,g.coretaxSources.join(', ')]);
    for(const [,name] of g.documents)suggestions.push([code,name]);
  }
  if(!sources.length)probis.push(['Pilih acuan kegiatan di Probis atau muat riwayat KLU utama dengan masa berlaku.']);
  if(suggestions.length)probis.push([],['KLU','Dokumen yang disarankan'],...suggestions);
  const requests=(work.indexDocuments||[]).filter(d=>d.probis);
  if(requests.length)probis.push([],['Permintaan tersimpan','Indeks','KLU acuan','Dokumen','Status','Rujukan'],...requests.map(d=>['DOK.'+d.number,d.index,d.probis.klu,d.name,d.status,d.reference]));
  return [{name:'Probis & Modus',rows:probis},{name:'Uji KLU',rows:test}];
}
