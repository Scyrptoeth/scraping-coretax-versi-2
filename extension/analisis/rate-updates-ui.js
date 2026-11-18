import {monthlyRates} from './tarif-sanksi.js';
import {activeRateUpdate,forgetRateUpdate,readRateUpdate,saveRateUpdate,savedRateUpdate,useRateUpdate} from './rate-updates.js';
import {box,button,card,dataTable,download,el,field,notice} from './ui.js';

export function rateUpdateTools(root,repaint){
  let saved;
  try{saved=savedRateUpdate();}catch{notice('Berkas tarif tersimpan tidak dapat dibaca.',true);}
  const panel=card('Pembaruan tarif bunga'),preview=box('stack'),input=el('input');
  input.type='file';input.accept='.json,application/json';
  const current=activeRateUpdate();
  panel.append(el('p',current?'Tarif aktif untuk sesi ini · '+current.source+' · '+current.date:'Simulasi memakai tarif bawaan.'),
    el('p','Gunakan berkas JSON pembaruan regulasi versi 1. Pratinjau dan penerapan di sini mencakup tarif bulanan Pasal 13 ayat (2).'),
    field('Buka berkas pembaruan tarif',input),preview);
  function show(raw){
    const {source,date,rates}=readRateUpdate(raw);
    const changes=[...rates].sort(([a],[b])=>a.localeCompare(b)).map(([month,rate])=>{
      const base=monthlyRates.get(month);
      return {Bulan:month,'Tarif bawaan (%)':base?base.basisPoints/100:null,'Tarif usulan (%)':rate?rate.basisPoints/100:null,
        Keputusan:rate?.decision||'Tarif dicabut untuk sesi ini'};
    });
    preview.replaceChildren(el('h3','Pratinjau tarif'),el('p',source+' · '+date),
      el('p','Saat diterapkan, berkas ini menjadi satu-satunya pembaruan yang disimpan. Bulan di luar daftar memakai tarif bawaan.'),
      dataTable(changes,{name:'Perubahan tarif bulanan'}),
      button('Terapkan tarif untuk sesi ini',()=>{
        try{saveRateUpdate(raw);useRateUpdate(raw);repaint();notice('Tarif yang dipilih berlaku di tab ini.');}
        catch(error){notice(error.message,true);}
      }));
  }
  input.onchange=async()=>{
    const file=input.files[0];if(!file)return;
    preview.replaceChildren();
    try{show(JSON.parse(await file.text()));}
    catch(error){notice('Berkas tarif belum dapat digunakan. '+error.message,true);}
    input.value='';
  };
  if(saved){try{show(saved);}catch{preview.replaceChildren(el('p','Isi tarif tersimpan perlu diperiksa.'));}}
  const actions=box('toolbar',button('Unduh templat tarif',()=>{
    const sample={format:'SEDOTAX-REGULASI',versi:'1',tanggal:new Date().toISOString().slice(0,10),sumber:'',
      catatan:'Isi sumber, nomor KMK dan tarif resmi dalam persen. Ganti bulan contoh dengan masa keputusan.',tarif:{'2026-01':{kmk:'',p13_2:null,url:''}}};
    download(new Blob([JSON.stringify(sample,null,2)],{type:'application/json'}),'Templat-tarif-bunga.json');
  }));
  if(current)actions.append(button('Gunakan tarif bawaan untuk sesi ini',()=>{useRateUpdate(null);repaint();}));
  if(saved)actions.append(button('Hapus pembaruan tarif tersimpan',()=>{forgetRateUpdate();repaint();}));
  panel.append(actions);root.append(panel);
}
