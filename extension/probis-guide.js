// The process descriptions and checks are project-authored guidance. The classification
// code identifies a business activity; it does not establish an obligation or finding.
import {kbli} from './catalog-data.js';
import {kluZ} from './klu-z.js';
export const probisPrograms=[
  {first:1,last:3,code:'PB-PANEN',title:'Jumlah panen, stok, dan penjualan',
    coretaxSources:["Daftar faktur keluaran bila tersedia"],
    flow:"Produksi atau budidaya, panen, penyimpanan, penjualan.",check:"Bandingkan catatan jumlah panen, stok dan penjualan untuk periode yang sama.",
    documents:[["panen","Rekap panen per komoditas"],["stok","Catatan mutasi persediaan hasil panen"]]},
  {first:5,last:9,code:'PB-ANGKUT',title:'Volume penjualan dan pengiriman',
    coretaxSources:["Daftar faktur keluaran bila tersedia"],
    flow:"Ekstraksi, pengolahan awal, pengangkutan dan penjualan.",check:"Telusuri satu pengiriman dari catatan volume dan dokumen angkut sampai faktur.",
    documents:[["volume","Catatan volume barang yang dikirim"],["angkut","Dokumen angkut pengiriman terpilih"]]},
  {first:10,last:33,code:'PB-PRODUKSI',title:'Pemakaian bahan dan hasil produksi',
    coretaxSources:["SPT PPh Badan dan lampiran bila tersedia"],
    flow:"Pembelian bahan, produksi, persediaan barang jadi dan penjualan.",check:"Rekonsiliasi pemakaian bahan dengan hasil produksi. Catat sisa bahan, retur dan perbedaan satuan.",
    documents:[["bahan","Kartu pemakaian bahan baku"],["hasil","Laporan hasil produksi per periode"]]},
  {first:41,last:43,code:'PB-TERMIN',title:'Tagihan termin pekerjaan',
    coretaxSources:["Daftar faktur keluaran bila tersedia"],
    flow:"Kontrak pekerjaan, pelaksanaan, tagihan termin dan serah terima.",check:"Cocokkan nilai dan tanggal kontrak, perubahan pekerjaan, termin dan berita acara.",
    documents:[["kontrak","Kontrak pekerjaan berikut perubahannya"],["termin","Tagihan termin dan berita acara pekerjaan"]]},
  {first:45,last:47,code:'PB-PENJUALAN',title:'Penjualan, pengiriman, dan pembayaran',
    coretaxSources:["Daftar faktur keluaran bila tersedia"],
    flow:"Pembelian barang, penyimpanan, penjualan dan retur.",check:"Telusuri sampel penjualan sampai pengiriman dan penerimaan pembayaran.",
    documents:[["kirim","Bukti pengiriman atas penjualan terpilih"],["bayar","Bukti penerimaan pembayaran pelanggan"]]},
  {first:49,last:53,code:'PB-LAYANAN',title:'Pesanan dan tagihan jasa',
    coretaxSources:["Daftar faktur keluaran bila tersedia"],
    flow:"Pemesanan, pelaksanaan layanan angkutan atau penyimpanan, penagihan.",check:"Cocokkan pesanan dengan bukti layanan dan tagihan per perjalanan atau periode.",
    documents:[["pesanan","Daftar pesanan jasa per periode"],["layanan","Bukti penyelesaian layanan dan tagihan"]]},
  {first:55,last:56,code:'PB-RESERVASI',title:'Reservasi dan penerimaan harian',
    coretaxSources:[],
    flow:"Reservasi atau pemesanan, pemberian layanan, penerimaan pembayaran.",check:"Bandingkan catatan pemesanan dengan penjualan harian dan penyelesaian pembayaran.",
    documents:[["reservasi","Rekap reservasi dan pembatalan"],["penerimaan","Rekap penerimaan harian"]]},
  {first:64,last:66,code:'PB-JASA',title:'Dana yang dikelola dan imbalan jasa',
    coretaxSources:[],
    flow:"Perjanjian layanan, pencatatan transaksi dan pelaporan.",check:"Bedakan dana yang dikelola dengan pendapatan jasa berdasarkan perjanjian dan catatan transaksi.",
    documents:[["jasa","Perjanjian layanan yang dipilih"],["imbalan","Rincian imbalan jasa per transaksi"]]},
  {first:null,last:null,code:'PB-TRANSAKSI',title:'Penelusuran satu transaksi',
    coretaxSources:[],
    flow:"Identifikasi kegiatan aktual, pihak yang terlibat, waktu penyerahan, serta dasar penagihan.",check:"Telusuri satu transaksi dari kontrak atau pesanan sampai bukti pelaksanaan dan pembayaran.",
    documents:[["pesanan","Pesanan atau kontrak transaksi terpilih"],["pelaksanaan","Bukti pelaksanaan dan pembayaran transaksi"]]},
];

export function publicGuide(code) {
  const division=Number(code.slice(0,2));
  return probisPrograms.find(g=>g.first!==null && division>=g.first && division<=g.last) || probisPrograms.at(-1);
}
export function probisSourceFields(source) {
  if(!source)return {};
  return {'KLU acuan':source.klu,'Edisi klasifikasi':source.edition,'Tahun pajak':source.year,
    'Prosedur Probis':source.procedure,'Langkah penelusuran':source.check,'Kode saran dokumen':source.document};
}
export function isRegisteredProbisCode(code){
  return typeof code==='string'&&/^(?:\d{5}|Z\d{4})$/.test(code)&&[kbli['2020'],kbli['2025'],kluZ].some(c=>Object.hasOwn(c,code));
}
export function validatedProbisSource(source,year) {
  const fail=()=>{throw Error('Periksa asal saran Probis, tahun, serta kode dokumen.');};
  if(!source || typeof source.klu!=='string' || typeof source.year!=='string' || !/^(?:19|20)\d{2}$/.test(source.year) ||
    (year!==undefined && String(year)!==source.year))fail();
  if(source.edition==='Registrasi Coretax'){
    if(!isRegisteredProbisCode(source.klu))fail();
  }else{
    if(!['2020','2025','KLU Z'].includes(source.edition)||!(source.edition==='KLU Z'?/^Z\d{4}$/:/^\d{5}$/).test(source.klu))fail();
    const catalog=source.edition==='KLU Z'?kluZ:kbli[source.edition];
    if(!Object.hasOwn(catalog,source.klu))fail();
  }
  const guide=publicGuide(source.klu);
  if(source.procedure!==guide.code || !guide.documents.some(([id])=>id===source.document))fail();
  if(typeof source.check!=='string' || !source.check.trim() || source.check.length>500)fail();
  return {klu:source.klu,edition:source.edition,year:source.year,procedure:source.procedure,check:source.check,document:source.document};
}
export const probisRequestKey=(index,s)=>JSON.stringify([index,s.klu,s.edition,s.year,s.procedure,s.document]);
