import {box,button,el,field,showDialog} from './ui.js';

export function rowNotes(pkg,table,rows){
  const positions=new WeakMap(rows.map((row,i)=>[row,i]));
  return {title:'Catatan',control(row){
    const key='scv2-row-note/'+JSON.stringify([pkg.formNamespace||pkg.fileKey,...table.origin(positions.get(row))]);
    const read=()=>localStorage.getItem(key)||'';
    const control=button('+',()=>{
      const input=el('textarea'),error=el('p');error.setAttribute('role','alert');
      const dialog=showDialog('Catatan baris',box('',el('p',table.title),field('Catatan Anda',input),
        el('p','Catatan yang Anda simpan dapat dibuka kembali di browser ini bersama paket yang sama. Kosongkan isinya dan simpan untuk menghapus catatan.','hint'),
        error,box('toolbar',button('Batal',()=>dialog.close()),button('Simpan',()=>{
          try{
            if(input.value.trim())localStorage.setItem(key,input.value);else localStorage.removeItem(key);
            refresh();dialog.close();
          }catch{error.textContent='Catatan belum tersimpan. Periksa izin dan ruang penyimpanan browser.';}
        },''))));
      try{input.value=read();}catch{error.textContent='Browser membatasi akses ke catatan di perangkat ini.';}
      input.focus();
    });
    function refresh(){
      let saved=false;try{saved=Boolean(read());}catch{/* The editor reports an unavailable store. */}
      const label=saved?'Ubah catatan baris':'Tambah catatan baris';
      control.textContent=saved?'Ubah':'+';control.setAttribute('aria-label',label);control.title=label;
    }
    refresh();return control;
  }};
}
