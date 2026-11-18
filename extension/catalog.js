import {kbli} from './catalog-data.js';
import {kluAttachment,kluZ} from './klu-z.js';
import {codeTitle,hierarchicalKlu,percentage} from './klu-calculator.js';
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
const zEdition='KLU Z';
const zRecords=Object.fromEntries(Object.values(kluZ).map(r=>[r.code,{...r,year:zEdition,
  cells:[r.code,r.title,zEdition,levels[r.code.length]],lookup:normalize(r.code+' '+r.title+' '+zEdition+' PER-12/PJ/2022')}]));
const businessCodes=[...allCodes,...Object.values(zRecords)];
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
  const out=box('stack');out.setAttribute('role','status');
  function add() {
    const code=el('input'),name=el('input'),amount=el('input');amount.inputMode='numeric';
    code.maxLength=5;code.placeholder='Misalnya 28221';
    const row=box('toolbar',field('Kode kelompok',code),field('Nama kegiatan (opsional)',name),field('Peredaran bruto atau penghasilan (Rp)',amount));
    row.append(button('Hapus baris',()=>{row.remove();out.textContent='';}));entries.append(row);
  }
  function run(){
    const activities=[...entries.children].map(row=>{
      const [code,name,amount]=row.querySelectorAll('input');
      return {code:code.value.trim(),name:name.value.trim(),amount:amount.value.trim()};
    });
    const taxpayerKind=kind.querySelector('select').value;
    if(taxpayerKind!=='WP dengan beberapa kegiatan'){
      out.replaceChildren(el('p',activityResult([],taxpayerKind)));return;
    }
    if(activities.length && activities.every(a=>!a.code && a.name)){
      out.replaceChildren(el('p',activityResult(activities,taxpayerKind)),
        el('p','Lengkapi kode kelompok setiap kegiatan untuk menghitung KLU secara berjenjang.'));return;
    }
    const result=hierarchicalKlu(activities);
    out.replaceChildren(el('p',result.message));
    if(!result.steps.length)return;
    out.append(el('p','Total nilai kegiatan · Rp'+result.total.toLocaleString('id-ID')));
    for(const step of result.steps){
      const node=el('details');node.open=true;
      node.append(el('summary',step.title+(step.winner?' · '+step.winner:'')));
      if(step.note)node.append(el('p',step.note));
      const table=el('table'),head=el('tr');
      for(const label of ['Kode atau cabang','Nilai (Rp)',step.divisionShare?'Persen dari golongan pokok':'Persen dari total'])head.append(el('th',label));
      table.append(head);
      for(const {code,amount} of step.candidates){
        const tr=el('tr'),title=codeTitle(code);
        for(const value of [title?code+' · '+title:code,amount.toLocaleString('id-ID'),percentage(amount,step.base)])tr.append(el('td',value));
        table.append(tr);
      }
      node.append(box('scroll',table));out.append(node);
    }
  }
  add();add(); entries.oninput=()=>{out.textContent='';};
  return card('Uji KLU utama',el('p','Masukkan kode kelompok KBLI 2020 atau KLU Z dan nilai bruto tiap kegiatan pada tahun pajak sebelumnya. Gabungkan tahap kegiatan yang terintegrasi. Periksa ketentuan keluarga serta pusat dan cabang.'),kind,entries,
    box('toolbar',button('Tambah kegiatan',()=>{add();out.textContent='';}),button('Hitung',run)),
    out,link('Contoh perhitungan berjenjang dalam lampiran DJP',kluAttachment+'#page=6'),link('Baca Pasal 4 dan 5 PER-12/PJ/2022',sourceKLU));
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
    const isZ=row.year===zEdition;
    const rows=[[isZ?'Acuan':'Edisi KBLI',isZ?'PER-12/PJ/2022, Lampiran bagian A':row.year],['Kode',row.code],['Nama',row.title]];
    for(let n=isZ?1:2;n<row.code.length;n++){
      const code=row.code.slice(0,n);
      const title=isZ?kluZ[code]?.title:kbli[row.year][code];
      if(title)rows.push([levels[n],code+' · '+title]);
    }
    if(isZ)rows.push(['Halaman lampiran',row.first===row.last?String(row.first):row.first+'–'+row.last]);
    const content=box('stack',...rows.map(([a,b])=>el('p',a+' · '+b)));
    if(!isZ && row.code.length>=2) {
      const [flow,check]=publicGuide(row.code);
      content.append(card('Panduan penelusuran awal',el('p',flow),el('p',check),el('small','Sesuaikan langkah ini dengan kegiatan dan bukti yang benar-benar tersedia.')));
    }
    if(options.manifest && row.code.length===5) content.append(button('Jadikan acuan WP pada sesi ini',()=>{
      assigned.set(options.manifest,row);document.getElementById('dialog').close();mode='wp';draw();
    }));
    content.append(exportBar(isZ?'Rincian KLU Z':'Rincian KBLI',['Keterangan','Nilai'],rows),
      isZ?link('Buka lampiran resmi DJP',kluAttachment+'#page='+row.first):link('Kamus klasifikasi BPS',sourceKBLI));
    showDialog(row.code+' · '+row.title,content);
  }
  function draw(){
    const panel=box('');container.replaceChildren(el('h1','Proses bisnis dan KLU'),
      toggleSet([['wp','Untuk WP ini'],['search','Cari KLU/KBLI']],mode,m=>{mode=m;draw();}),panel);
    if(mode==='search') {
      registryList(panel,{title:'Hasil pencarian KLU dan KBLI',placeholder:'Kode atau nama kegiatan',query:options.query,rows:businessCodes,
        columns:['Kode','Nama kegiatan','Acuan','Tingkat'],filters:[
          {key:'year',label:'Acuan klasifikasi',initial:'current',options:[['current','KBLI 2025 dan KLU Z'],['','Semua acuan'],['2025','KBLI 2025'],['2020','KBLI 2020'],[zEdition,'KLU Z · PER-12/PJ/2022']]},
          {key:'level',label:'Tingkat',initial:kluZ[String(options.query||'').toUpperCase()]?String(options.query.length):'5',options:levels.map((v,i)=>[i?String(i):'',v])}],
        filter:(r,v)=>(v.year==='current'?r.year==='2025'||r.year===zEdition:!v.year||r.year===v.year)&&(!v.level||r.code.length===Number(v.level)),open:showRecord});
      return;
    }
    const entries=(options.entries||[]).filter(e=>/(?:^|\/)klu\.json$/i.test(e.path));
    const items=entries.flatMap(rowsOf).filter(r=>r.TradeClassificationCode);
    const picked=options.manifest && assigned.get(options.manifest);
    const detail=card('KLU di paket',el('p',options.manifest?(items.length?'Kode dan periode berikut berasal dari registrasi dalam paket.':'Paket ini belum memuat daftar KLU registrasi.'):'Buka paket untuk melihat KLU WP.'));
    for(const r of items) {
      detail.append(el('p',[r.TradeClassificationCode,r.ActivityDescription,r.IsMainEconomicCode===true?'Utama sesuai registrasi':'',r.ValidFrom?.slice(0,10),r.ValidTo?.slice(0,10)].filter(Boolean).join(' · ')));
      const z=zRecords[String(r.TradeClassificationCode).trim().toUpperCase()];
      if(z)detail.append(button('Lihat '+z.code+' di katalog DJP',()=>showRecord(z)));
    }
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
