import {monthlyRates} from './tarif-sanksi.js';

const storageKey='scv2-rate-update-v1';
let active=null;

export function readRateUpdate(raw){
  if(!raw || raw.format!=='SEDOTAX-REGULASI' || String(raw.versi)!=='1')throw Error('Pilih berkas pembaruan regulasi versi 1.');
  const source=typeof raw.sumber==='string'?raw.sumber.trim():'';
  const date=raw.tanggal;
  const iso=typeof date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(date)?new Date(date+'T00:00:00Z'):null;
  if(!source || !iso || !Number.isFinite(iso.getTime()) || iso.toISOString().slice(0,10)!==date)throw Error('Isi sumber dan tanggal pembaruan yang valid.');
  if(!raw.tarif || typeof raw.tarif!=='object' || Array.isArray(raw.tarif))throw Error('Daftar tarif per bulan belum tersedia.');
  const rates=new Map();
  for(const [month,item] of Object.entries(raw.tarif)){
    if(!/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(month) || !item || typeof item!=='object' || Array.isArray(item))throw Error('Periksa bulan dan isi tarif di berkas.');
    if(item._hapus===true){rates.set(month,null);continue;}
    if(!Object.hasOwn(item,'p13_2'))continue;
    const value=item.p13_2,bp=Math.round(value*100);
    const decision=typeof item.kmk==='string'?item.kmk.trim():'';
    if(typeof value!=='number' || value<0 || !Number.isSafeInteger(bp) || Math.abs(bp/100-value)>1e-9 || !/\d/.test(decision))throw Error('Periksa nomor KMK dan tarif Pasal 13 ayat (2) untuk '+month+'. Tarif memakai persen dengan paling banyak dua angka desimal.');
    let url='';
    if(item.url){
      try{const link=new URL(item.url);if(link.protocol!=='https:' || link.username || link.password)throw Error();url=link.href;}
      catch{throw Error('Periksa tautan HTTPS keputusan untuk '+month+'.');}
    }
    rates.set(month,{basisPoints:bp,decision,url,source,date});
  }
  if(!rates.size)throw Error('Berkas ini belum memuat perubahan tarif Pasal 13 ayat (2).');
  return {source,date,rates};
}

export function savedRateUpdate(){const text=globalThis.localStorage?.getItem(storageKey);return text?JSON.parse(text):null;}
export function hasSavedRates(){try{return !!globalThis.localStorage?.getItem(storageKey);}catch{return false;}}
export function saveRateUpdate(raw){
  const {source,date,rates}=readRateUpdate(raw);
  const tarif=Object.fromEntries([...rates].map(([month,rate])=>[month,rate?{kmk:rate.decision,p13_2:rate.basisPoints/100,url:rate.url}:{_hapus:true}]));
  globalThis.localStorage.setItem(storageKey,JSON.stringify({format:'SEDOTAX-REGULASI',versi:'1',sumber:source,tanggal:date,tarif}));
}
export function forgetRateUpdate(){globalThis.localStorage.removeItem(storageKey);active=null;}
export function useRateUpdate(raw){active=raw?readRateUpdate(raw):null;}
export function activeRateUpdate(){return active;}
export function rateSourceLabel(){return active?active.source+' · '+active.date:'Tarif bawaan';}
export function rateForMonth(month){return active?.rates.has(month)?active.rates.get(month):monthlyRates.get(month);}
