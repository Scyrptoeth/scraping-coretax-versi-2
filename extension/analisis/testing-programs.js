import {probisPrograms} from '../probis-guide.js';
import {box,button,card,el,exportSheets,field} from './ui.js';

const packageChecks=[
  {
    code:'SPT-VERSI',tax:'Lintas jenis',title:'Cocokkan versi SPT yang digunakan',
    check:'Kelompokkan daftar SPT menurut jenis dan masa. Bandingkan nomor pembetulan terakhir dengan versi yang digunakan di rekap.',
    data:'Daftar SPT dilaporkan, identitas versi dan masa pajak',place:'SPT → Daftar & isi SPT'
  },
  {
    code:'PPN-FAKTUR',tax:'PPN',title:'Telusuri perubahan faktur pada pembetulan',
    check:'Pasangkan faktur menurut nomor dokumen. Periksa selisih DPP dan PPN serta catat nomor yang kosong atau berulang.',
    data:'Dua versi lampiran faktur untuk masa yang sama',place:'SPT → Bandingkan versi'
  },
  {
    code:'PPN-REKAP',tax:'PPN',title:'Telusuri sumber pajak keluaran bulanan',
    check:'Bandingkan nilai pajak keluaran pada rekap dengan induk SPT masa yang sama. Catat isian yang dipakai jika ada nilai pengganti.',
    data:'Induk SPT Masa PPN dan rekap PPN',place:'SPT → Ringkasan SPT'
  },
  {
    code:'PPH-POTPUT',tax:'PPh',title:'Cocokkan potongan dan pungutan per pasal',
    check:'Pilih satu masa dan satu pasal yang datanya tersedia. Telusuri angka rekap ke bagian SPT asal dan cocokkan jumlahnya.',
    data:'Rekap PPh potong/pungut dan bagian SPT asal',place:'SPT → Ringkasan SPT'
  }
];

const procedureRows=[
  ...probisPrograms.map(p=>({
    code:p.code,title:p.title,tax:'Lintas jenis',step:'Penelusuran kegiatan',check:p.check,
    data:[...p.documents.map(([,name])=>name),...p.coretaxSources].join(' · '),
    place:'Probis → Untuk WP ini',coretaxOnly:false
  })),
  ...packageChecks.map(p=>({...p,step:'Pencocokan SPT',coretaxOnly:true}))
];

export function renderTestingPrograms(root){
  const query=el('input');
  query.type='search';
  const only=el('input');
  only.type='checkbox';
  const filter=el('label');
  filter.append(only,document.createTextNode(' Dapat dilakukan dengan data Coretax saja'));
  const header=['Kode','Tahap','Pajak','Nama','Prosedur','Data yang diperlukan','Menu di pemutar'];
  const result=el('p');
  result.setAttribute('role','status');
  const content=box('scroll');
  let rows=[];
  const exportButton=button('Unduh hasil ke Excel',()=>exportSheets([{name:'Program pengujian',rows:[header,...rows]}],'Program pengujian'));
  function render(){
    const terms=query.value.toLocaleLowerCase('id').trim().split(/\s+/).filter(Boolean);
    rows=procedureRows.filter(p=>!only.checked||p.coretaxOnly)
      .map(p=>[p.code,p.step,p.tax,p.title,p.check,p.data,p.place])
      .filter(cells=>terms.every(term=>cells.join(' ').toLocaleLowerCase('id').includes(term)));
    exportButton.disabled=!rows.length;
    result.textContent=rows.length+' dari '+procedureRows.length+' prosedur Versi 2';
    if(!rows.length){
      content.replaceChildren(el('p','Tidak ada prosedur yang cocok. Ubah kata kunci atau saringan.'));
      return;
    }
    const table=el('table');
    table.setAttribute('aria-label','Program pengujian');
    const heading=table.createTHead().insertRow();
    for(const label of header){
      const cell=el('th',label);cell.scope='col';heading.append(cell);
    }
    const body=table.createTBody();
    for(const cells of rows){
      const row=body.insertRow();
      for(const value of cells)row.insertCell().textContent=value;
    }
    content.replaceChildren(table);
  }
  query.oninput=render;only.onchange=render;
  root.append(card('Program pengujian',el('p','Pilih prosedur sesuai tujuan penelaahan. Kolom data menunjukkan sumber yang diperlukan untuk menjalankan langkahnya.'),
    box('toolbar',field('Cari prosedur',query),filter,exportButton),result,content));
  render();
}
