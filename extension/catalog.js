import {kbli} from './catalog-data.js';
import {regulations} from './regulation-data.js';
import {rowsOf} from './analisis/model.js';
import {el, box, button, field, select, card, download, showDialog, toggleSet, notice} from './analisis/ui.js';
import {createXlsx} from './archive/table.js';
import {createDocx} from './archive/document.js';

const sourceKBLI = 'https://klasifikasi.web.bps.go.id/app/kbli';
const sourceKLU = 'https://www.pajak.go.id/id/peraturan/klasifikasi-lapangan-usaha-wajib-pajak-2';
const levels = ['Semua tingkat','Kategori','Golongan pokok','Golongan','Subgolongan','Kelompok'];
const assigned = new WeakMap();
const normalize = text => String(text ?? '').toLocaleLowerCase('id').trim();

function link(label, url) {
  const a = el('a', label);
  a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  return a;
}

function exportBar(title, headings, items) {
  const rows = [headings, ...items];
  async function save(format) {
    try {
      const file = format === 'xlsx' ? await createXlsx({sheets:[{name:'Hasil',rows}]})
        : await createDocx({title,tables:[{title:'Hasil pencarian',rows}]});
      download(file, title + '.' + format);
    } catch (error) { notice(error.message, true); }
  }
  return box('toolbar',button('Excel',()=>save('xlsx')),button('Word',()=>save('docx')),
    button('Cetak / PDF',()=>{
      const table=el('table');
      for(const [index,values] of rows.entries()){
        const tr=el('tr');
        for(const text of values) tr.append(el(index ? 'td' : 'th',text));
        table.append(tr);
      }
      const body=box('print-catalog',el('h1',title),table);
      document.body.append(body); document.body.classList.add('print-catalog-active');
      try { window.print(); } finally { body.remove();document.body.classList.remove('print-catalog-active'); }
    }));
}

function registryList(container, config) {
  const search = el('input'); search.type='search';search.placeholder=config.placeholder;
  search.value=config.query || '';
  const results=box('card'), filters=box('toolbar',field('Kata kunci',search));
  const values=Object.fromEntries(config.filters.map(f=>[f.key,f.initial || '']));
  let page=0;
  for (const f of config.filters) filters.append(select(f.options,values[f.key],value=>{
    values[f.key]=value; page=0; render();
  },f.label));
  for (const f of config.dates || []) {
    const input=el('input'); input.type='date';
    input.oninput=()=>{values[f.key]=input.value;page=0;render();};
    filters.append(field(f.label,input));
  }
  function render() {
    const terms=normalize(search.value).split(/\s+/).filter(Boolean);
    const rows=config.rows.filter(row=>config.filter(row,values) && terms.every(term=>row.lookup.includes(term)));
    const size=30, last=Math.max(0,Math.ceil(rows.length/size)-1);
    page=Math.min(page,last);
    const table=el('table'), header=el('tr'), thead=el('thead'), tbody=el('tbody');
    for(const col of config.columns) header.append(el('th',col));
    thead.append(header); table.append(thead,tbody);
    for(const row of rows.slice(page*size,(page+1)*size)) {
      const tr=el('tr');
      row.cells.forEach((value,i)=>{const td=el('td');td.append(i===0?button(value,()=>config.open(row)):document.createTextNode(value));tr.append(td);});
      tbody.append(tr);
    }
    const prev=button('Sebelumnya',()=>{page--;render();});prev.disabled=page===0;
    const next=button('Berikutnya',()=>{page++;render();});next.disabled=page>=last;
    results.replaceChildren(el('p',rows.length.toLocaleString('id-ID')+' hasil'),
      ...(rows.length?[exportBar(config.title,config.columns,rows.map(r=>r.cells)),box('scroll',table),
        box('pager',prev,el('span',`Halaman ${page+1} dari ${last+1}`),next)]:[el('p','Coba kata kunci lain atau longgarkan filter.')]));
  }
  search.oninput=()=>{page=0;render();};
  container.append(filters,results);render();
}

const allCodes=Object.entries(kbli).flatMap(([year,records])=>Object.entries(records).map(([code,title])=>({
  year,code,title,cells:[code,title,year,levels[code.length]],lookup:normalize(code+' '+title+' '+year)
}))).sort((a,b)=>b.year.localeCompare(a.year)||a.code.localeCompare(b.code));
const allRegs=regulations.map(cells=>({cells:cells.slice(0,5),url:cells[5],lookup:normalize(cells.slice(0,5).join(' '))}));

export function activityResult(activities, taxpayerKind) {
  if(taxpayerKind==='Instansi pemerintah') return 'Gunakan kategori administrasi pemerintahan, pertahanan, dan jaminan sosial wajib sesuai kegiatan instansi.';
  if(taxpayerKind==='Badan nirlaba') return 'Tentukan KLU dari kegiatan yang dijalankan badan.';
  if(activities.some(a=>!a.name.trim() || !/^\d+$/.test(a.amount))) return 'Isi setiap kegiatan dan nilai bruto tahun sebelumnya dalam rupiah utuh.';
  if(!activities.length) return 'Tambahkan setidaknya satu kegiatan.';
  const nums=activities.map(a=>BigInt(a.amount)),max=nums.reduce((a,b)=>a>b?a:b);
  if(max===0n) return 'Seluruh nilai nol. Jika usaha belum berjalan, WP menentukan KLU utama.';
  const largest=activities.filter((_,i)=>nums[i]===max).map(a=>a.name.trim());
  return largest.length===1?'Kegiatan dengan nilai terbesar: '+largest[0]+'.':
    'Nilai tertinggi sama pada '+largest.join(', ')+'. WP menentukan KLU utama.';
}

function calculator() {
  const entries=box(''),kind=select(['WP dengan beberapa kegiatan','Instansi pemerintah','Badan nirlaba'],'WP dengan beberapa kegiatan',()=>{out.textContent='';},'Jenis WP');
  const out=el('p');out.setAttribute('role','status');
  function add() {
    const name=el('input'),amount=el('input');amount.inputMode='numeric';
    const row=box('toolbar',field('Kegiatan',name),field('Peredaran bruto atau penghasilan (Rp)',amount));
    row.append(button('Hapus baris',()=>{row.remove();out.textContent='';}));entries.append(row);
  }
  add();add(); entries.oninput=()=>{out.textContent='';};
  return card('Uji KLU utama',el('p','Gunakan jumlah per kegiatan dari tahun pajak sebelumnya. Gabungkan tahap kegiatan yang terintegrasi dan perhatikan ketentuan untuk keluarga serta pusat dan cabang.'),kind,entries,
    box('toolbar',button('Tambah kegiatan',()=>{add();out.textContent='';}),button('Hitung',()=>{
      const activities=[...entries.children].map(row=>{const [name,amount]=row.querySelectorAll('input');return {name:name.value,amount:amount.value};});
      out.textContent=activityResult(activities,kind.querySelector('select').value);
    })),out,link('Baca Pasal 4 dan 5 PER-12/PJ/2022',sourceKLU));
}

function publicGuide(code) {
  const division=Number(code.slice(0,2));
  if(division>0 && division<=3) return ['Produksi atau budidaya, panen, penyimpanan, penjualan.','Bandingkan catatan jumlah panen, stok dan penjualan untuk periode yang sama.'];
  if(division>=5 && division<=9) return ['Ekstraksi, pengolahan awal, pengangkutan dan penjualan.','Telusuri satu pengiriman dari catatan volume dan dokumen angkut sampai faktur.'];
  if(division>=10 && division<=33) return ['Pembelian bahan, produksi, persediaan barang jadi dan penjualan.','Rekonsiliasi pemakaian bahan dengan hasil produksi. Catat sisa bahan, retur dan perbedaan satuan.'];
  if(division>=41 && division<=43) return ['Kontrak pekerjaan, pelaksanaan, tagihan termin dan serah terima.','Cocokkan nilai dan tanggal kontrak, perubahan pekerjaan, termin dan berita acara.'];
  if(division>=45 && division<=47) return ['Pembelian barang, penyimpanan, penjualan dan retur.','Telusuri sampel penjualan sampai pengiriman dan penerimaan pembayaran.'];
  if(division>=49 && division<=53) return ['Pemesanan, pelaksanaan layanan angkutan atau penyimpanan, penagihan.','Cocokkan pesanan dengan bukti layanan dan tagihan per perjalanan atau periode.'];
  if(division===55||division===56) return ['Reservasi atau pemesanan, pemberian layanan, penerimaan pembayaran.','Bandingkan catatan pemesanan dengan penjualan harian dan penyelesaian pembayaran.'];
  if(division>=64 && division<=66) return ['Perjanjian layanan, pencatatan transaksi dan pelaporan.','Bedakan dana yang dikelola dengan pendapatan jasa berdasarkan perjanjian dan catatan transaksi.'];
  return ['Identifikasi kegiatan aktual, pihak yang terlibat, waktu penyerahan, serta dasar penagihan.','Telusuri satu transaksi dari kontrak atau pesanan sampai bukti pelaksanaan dan pembayaran.'];
}

function business(container, options) {
  let mode=options.manifest && !options.query?'wp':'search';
  function showRecord(row) {
    const map=kbli[row.year],rows=[['Edisi KBLI',row.year],['Kode',row.code],['Nama',row.title]];
    for(let n=2;n<row.code.length;n++){const code=row.code.slice(0,n);if(map[code])rows.push([levels[n],code+' · '+map[code]]);}
    const content=box('stack',...rows.map(([a,b])=>el('p',a+' · '+b)));
    if(row.code.length>=2) {
      const [flow,check]=publicGuide(row.code);
      content.append(card('Panduan penelusuran awal',el('p',flow),el('p',check),el('small','Sesuaikan langkah ini dengan kegiatan dan bukti yang benar-benar tersedia.')));
    }
    if(options.manifest && row.code.length===5) content.append(button('Jadikan acuan WP pada sesi ini',()=>{
      assigned.set(options.manifest,row);document.getElementById('dialog').close();mode='wp';draw();
    }));
    content.append(exportBar('Rincian KBLI',['Keterangan','Nilai'],rows),link('Kamus klasifikasi BPS',sourceKBLI));
    showDialog(row.code+' · '+row.title,content);
  }
  function draw(){
    const panel=box('');container.replaceChildren(el('h1','Proses bisnis dan KLU'),
      toggleSet([['wp','Untuk WP ini'],['search','Cari KLU/KBLI']],mode,m=>{mode=m;draw();}),panel);
    if(mode==='search') {
      registryList(panel,{title:'Hasil pencarian KBLI',placeholder:'Kode atau nama kegiatan',query:options.query,rows:allCodes,
        columns:['Kode','Nama kegiatan','Edisi','Tingkat'],filters:[
          {key:'year',label:'Edisi KBLI',initial:'2025',options:[['','Semua edisi'],'2025','2020']},
          {key:'level',label:'Tingkat',initial:'5',options:levels.map((v,i)=>[i?String(i):'',v])}],
        filter:(r,v)=>(!v.year||r.year===v.year)&&(!v.level||r.code.length===Number(v.level)),open:showRecord});
      return;
    }
    const entries=(options.entries||[]).filter(e=>/(?:^|\/)klu\.json$/i.test(e.path));
    const items=entries.flatMap(rowsOf).filter(r=>r.TradeClassificationCode);
    const picked=options.manifest && assigned.get(options.manifest);
    const detail=card('KLU di paket',el('p',options.manifest?(items.length?'Kode dan periode berikut berasal dari registrasi dalam paket.':'Paket ini belum memuat daftar KLU registrasi.'):'Buka paket untuk melihat KLU WP.'));
    for(const r of items) detail.append(el('p',[r.TradeClassificationCode,r.ActivityDescription,r.IsMainEconomicCode===true?'Utama sesuai registrasi':'',r.ValidFrom?.slice(0,10),r.ValidTo?.slice(0,10)].filter(Boolean).join(' · ')));
    if(picked)detail.append(button('Acuan sesi ini · '+picked.code+' '+picked.title,()=>showRecord(picked)));
    detail.append(button('Pilih acuan dari katalog',()=>{mode='search';draw();}));
    panel.append(detail,calculator());
  }
  draw();
}

export function renderCatalog(container, kind, options={}) {
  if(kind==='probis'){ business(container,options);return; }
  container.replaceChildren(el('h1','Peraturan'),el('p','Cari metadata yang tersimpan di perangkat. Buka naskah resmi untuk memeriksa isi dan riwayat aturan.'));
  const distinct=i=>[['','Semua'],...[...new Set(allRegs.map(r=>r.cells[i]).filter(Boolean))].sort()];
  registryList(container,{title:'Hasil pencarian peraturan',placeholder:'Nomor, judul, atau kata kunci',query:options.query,
    rows:allRegs,columns:['Nomor','Judul','Jenis','Tanggal','Status pada sumber'],
    filters:[{key:'type',label:'Jenis',options:distinct(2)},{key:'state',label:'Status',options:distinct(4)}],
    dates:[{key:'start',label:'Tanggal awal'},{key:'end',label:'Tanggal akhir'}],
    filter:(r,v)=>(!v.type||r.cells[2]===v.type)&&(!v.state||v.state===r.cells[4])&&(!v.start||r.cells[3]>=v.start)&&(!v.end||r.cells[3]<=v.end),
    open:r=>showDialog(r.cells[0],box('stack',el('h3',r.cells[1]),el('p',r.cells.slice(2).join(' · ')),
      link('Buka naskah di situs DJP',r.url),exportBar('Rincian peraturan',['Nomor','Judul','Jenis','Tanggal','Status','Sumber'],[[...r.cells,r.url]])))});
}
