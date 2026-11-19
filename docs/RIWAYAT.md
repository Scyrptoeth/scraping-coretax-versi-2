# Riwayat Scraping Coretax Versi 2

## 19 November 2026 WIB · Prarilis 0.18.0

Pengguna memulai dari beranda Coretax yang sudah login. Ekstensi mencari satu WP, membuka sumber yang dipilih, dan menyusun ZIP untuk diperiksa di Analisis. Berita acara dan catatan penarikan membantu petugas melihat sumber yang masih kurang. [Hasil pengujian dan batas cakupan](KESETARAAN.md#hasil-prarilis-0180)

## 19 November 2026 WIB · Prarilis 0.17.1

Nama jenis pajak pada tabel dan hasil ekspornya mengikuti tampilan Coretax. Kode asli tetap dapat diperiksa pada berkas sumber. [Pemeriksaan terhadap tabel SPT Dilaporkan](KESETARAAN.md#hasil-prarilis-0171)

## 19 November 2026 WIB · Prarilis 0.17.0

Pemutar menyajikan profil WP dan formulir SPT dengan nama isian dalam bahasa Indonesia. Daftar SPT menampilkan versi terakhir untuk seluruh tahun saat paket dibuka. Di Data mentah, petugas dapat memilih tabel lintas berkas, memeriksa rincian buku besar, menulis catatan pada baris dan mengekspor hasil. [Hasil perbandingan dengan Studio](KESETARAAN.md#hasil-prarilis-0170)

## 19 November 2026 WIB · Prarilis 0.16.0

Penarik dapat mengikuti rentang halaman pada tabel profil dan registrasi untuk satu WP. Excel KKA Badan memuat lembar pengurus dan pihak terkait. Setoran pada Tabel 5.3 mengikuti tanggal transaksi dan menjelaskan cakupan pembayaran yang terbaca. Dua ZIP dari WP yang sama dapat dibandingkan kembali di laptop dengan program yang disertakan di repositori. [Hasil pengujian dan batas cakupan](KESETARAAN.md#hasil-prarilis-0160)

## 19 November 2026 WIB · Prarilis 0.15.0

**Mulai tarik** membaca sumber yang dapat dikenali dari tab Coretax yang terbuka untuk satu WP. Penarik memakai rencana versi SPT yang sama pada pratinjau dan penarikan. Berita acara dan pemutar menunjukkan sumber yang menghasilkan berkas. [Hasil pengujian dan batas cakupan](KESETARAAN.md#hasil-prarilis-0150)

## 19 November 2026 WIB · Prarilis 0.14.0

Pratinjau satu WP menampilkan profil dan jumlah versi SPT per tahun dan jenis. Penarik menyimpan pilihan penyertaan transaksi buku besar yang dibatalkan serta jejaknya pada tiap halaman. Pemutar mencocokkan saldo per periode. KKA memakai butir yang sama untuk menghitung rekap potensi di L-7 dan rasio kemampuan membayar di L-13. Word menaut ke kedua lembar Excel. [Hasil pengujian dan selisih](KESETARAAN.md#hasil-prarilis-0140)

## 19 November 2026 WIB · Prarilis 0.13.0

Penarik dapat melanjutkan induk dan lampiran SPT dari hasil sebelumnya untuk satu NPWP. Di pemutar, petugas dapat membuka laporan temuan langsung dan indikatif, menelusuri bukti, menyimpan telaah, dan mengekspor laporan ke Excel atau cetak. Simulasi membedakan kredit yang telah dipasangkan dengan perkiraan yang masih memerlukan rincian Lampiran 3. [Hasil perbandingan dengan Studio](KESETARAAN.md#hasil-prarilis-0130)

## 19 November 2026 WIB · Prarilis 0.12.0

Penarik dapat mencocokkan tabel profil, registrasi, dokumen dan buku besar pada tab yang sudah terbuka untuk satu NPWP. Di **KKP → Keluaran**, tersedia permintaan dokumen dan lingkup SP2, daftar temuan sementara serta simulasi ketetapan dengan penelusuran kompensasi PPN antarmasa. [Uji pembanding dan selisih dengan Studio](KESETARAAN.md#hasil-prarilis-0120)

## 19 November 2026 WIB · Prarilis 0.11.0

Pemutar menyediakan **JD · Jadwal pemeriksaan** dengan empat jenis pemeriksaan. Petugas dapat melihat dasar setiap tenggat, memasukkan hari libur, mengunduh Excel dan mencetak jadwal. Isian melekat pada paket WP dan tahun pajak. Fitur ini memperhitungkan tanggal pemeriksaan yang dapat berbeda dari tahun pajak berkas kerja. [Panduan jadwal](ANALISIS.md#jadwal-pemeriksaan)

Penarik dapat menyimpan kemajuan pratinjau daftar SPT untuk penugasan yang dipilih. Pembacaan yang berhenti di tengah dapat diperiksa dari halaman yang sudah tersimpan. Jumlah baris sumber dan cakupan masih terlihat ketika petugas memuatnya secara luring. [Cara menggunakan simpanan](SCRAPING.md#hasil-integritas-dan-retensi) · [Batas pembandingan](KESETARAAN.md#hasil-prarilis-0110)

## 19 November 2026 WIB · Prarilis 0.10.0

**Penarik.** Pratinjau WP dapat menemukan daftar SPT dilaporkan pada tab Coretax yang sudah terbuka untuk satu NPWP. Jumlah halaman dan baris sumber ditampilkan bersama cakupannya. Pilihan versi SPT mengikuti jenis dan periode. Alur ini sudah diuji di Chrome dengan tabel fiktif hingga ZIP dibuka di pemutar. Pembacaan langsung pada tab operasional masih perlu dicocokkan. [Penggunaan pratinjau](SCRAPING.md#mengambil-sumber)

**Pemutar.** Filter tahun, jenis dan versi memudahkan pencarian SPT. Pada contoh Badan fiktif, menu SPT menghitung 76 baris daftar dan filter **Versi terakhir** menampilkan 73 formulir. Daftar indeks KKP menyediakan seluruh 20 kode indeks pajak yang diperiksa pada lima kelompok. Kelompok **Keluaran** di Studio masih berbeda. [Hasil dan batas pembandingan](KESETARAAN.md#hasil-prarilis-0100)

**Kertas kerja.** Baris pemotongan pada C, G dan K dapat diuji lewat induk atau lewat C.2.2, G.2.2 dan K.2.2. Hasilnya masuk satu kali ke temuan. Petugas juga dapat mengembalikan satu baris ke **Belum diuji** dengan jejak audit. Pada contoh Badan 2026 tanpa SPT Tahunan dalam daftar terverifikasi, induk B menampilkan subtotal penyerahan PPN yang dapat ditelusuri per masa dan pembanding enam kelompok. Koreksi baru tercatat setelah petugas menyimpan pengujiannya. [Panduan KKP](ANALISIS.md#kertas-kerja)

## 19 November 2026 · Prarilis 0.9.0

Pratinjau WP dapat memakai kembali bagian SPT yang sudah terbukti tersedia dalam antrean. Pengguna dapat melanjutkan pembacaan bagian lain atau memilih **Ambil ulang semua bagian versi yang dipilih**. [Cara melanjutkan](SCRAPING.md)

Kertas kerja PPh Pasal 22 memisahkan objek pada D1-BPU (E.2.1) dan PPh yang dipotong atau dipungut pada induk Unifikasi (E.2.2). Jika ada bukti batal, rincian dan Excel juga memuat jumlah yang tercantum sebelum mengeluarkan bukti itu. [Panduan analisis](ANALISIS.md)

Induk KKP Badan menelusuri laba, penghasilan neto fiskal, PKP dan saldo PPh sampai ke akun atau isian sumber. Empat kontrol dapat dihitung kembali di Excel dari angka yang tersedia. [Cakupan pengujian](KESETARAAN.md)

## 19 November 2026 · Prarilis 0.8.0

Di pratinjau WP, pilih beberapa versi SPT untuk membaca induk dan lampiran dalam satu antrean. Penarik memeriksa kembali WP, masa dan pembetulan setelah daftar berubah. Jika sebagian dokumen belum terbaca, alasannya tercantum bersama hasil yang sudah tersimpan. [Cara memakai antrean](SCRAPING.md)

Indeks N.3, G.2.1 dan K.2.1 menghubungkan DPP per masa ke induk PPN atau bukti potong Unifikasi. Pada SPT Tahunan Badan, B.1.4 menyandingkan peredaran usaha dengan penyerahan PPN dan B.7 merinci koreksi fiskal positif. Kertas kerja gabungan juga memuat proses bisnis, uji KLU dan, apabila ada SPT Badan, rasio serta simulasi benchmark. [Cara membaca hasil](ANALISIS.md)

## 18 November 2026 · Prarilis 0.7.0

Pilih **Ambil induk dan lampiran** di pratinjau untuk membaca beberapa bagian dari satu versi SPT. Penarik memeriksa identitas WP dan dokumen saat berpindah bagian atau halaman, serta menyimpan catatan jika pembacaan berhenti di tengah. [Penarik](SCRAPING.md)

Pada pemutar, formulir PPh 21/26 dan Unifikasi menampilkan rincian penghitungan dan sumbernya. Di mode pengembang, empat jenis impor appportal dapat dicocokkan dengan lampiran PPN untuk WP dan tahun aktif. [Formulir dan kertas kerja](ANALISIS.md) · [Impor appportal](FORMAT.md)

Excel gabungan KKP memuat lembar kepatuhan, hasil penelaahan dan jejak audit. Tautan pada daftar isi menghubungkan semua lembar. Nilai SPT dan koreksi yang sudah diuji dapat ditelusuri melalui rumus lintas lembar. [Bukti pengujian dan selisih](KESETARAAN.md)

## 18 November 2026 · Prarilis 0.6.0

Jika beberapa ekspor memuat lampiran yang sama pada satu pembetulan, penarik menyimpan satu sumber untuk analisis dan menampilkan ekspor lain sebagai pembanding. Urutan halaman dari satu proses paginasi tetap dipertahankan. [Penanganan cuplikan SPT](SCRAPING.md)

Saat membuka satu versi SPT Masa PPN, pemutar menunjukkan berkas yang diterima untuk delapan bagian dan bukti kelengkapannya. Lampiran yang belum dikirim, respons gagal, tabel dengan nol baris, dan total yang dikirim tanpa angka dapat ditelusuri di layar dan Excel. [Cakupan SPT PPN](ANALISIS.md)

Petugas dapat memilih saran dokumen dari Probis, mengirimkannya ke indeks KKP untuk WP dan tahun aktif, lalu mengunduh Excel DOK beserta asal permintaan. Menu Bantuan memuat 13 prosedur yang dapat dicari tanpa membuka paket. [Probis dan program pengujian](KATALOG.md)

## 18 November 2026 · Prarilis 0.5.1

Pada perbandingan pembetulan SPT, pemutar memasangkan faktur dan bukti potong menurut nomor dokumen. Mengurutkan ulang baris saja menghasilkan nol perubahan. Jika nomor kosong atau berulang, layar dan Excel menunjukkan baris sumber yang perlu diperiksa. [Perbandingan lampiran](ANALISIS.md)

Saat pengguna menambahkan sumber sebelum mengonfirmasi WP dan masa, penarik mengarahkan pengguna ke kotak yang perlu dicentang pada **Cara menarik**. [Mengambil sumber](SCRAPING.md)

## 18 November 2026 · Prarilis 0.5.0

Dari pratinjau satu WP, penarik dapat membuka tampilan SPT melalui tindakan baca yang dapat dikenali pada baris sumber. Penarik mencocokkan dokumen kembali di halaman tujuan dan menyimpan bagian yang tersedia beserta asalnya. Uji Chrome memakai halaman Coretax fiktif dengan navigasi di tab yang sama dan di tab baru. [Penarik](SCRAPING.md)

Pemutar membuka ZIP64 satu volume, mengenali nomor bukti penerimaan dari dua kolom Coretax dan menyediakan pilihan nama berkas keluaran. KKP OP dapat menyajikan pembanding B-8 dan B-17 saat ketiadaan SPT Tahunan OP dapat ditelusuri. Petugas dapat mempratinjau perubahan tarif bunga, menerapkannya untuk sesi berjalan dan memeriksa sumbernya di simulasi. [Format ZIP](FORMAT.md) · [Pemutar dan kertas kerja](ANALISIS.md)

## 18 November 2026 · Prarilis 0.4.0

Daftar SPT memakai versi terakhir sebagai pilihan awal. Pemutar menampilkan dasar nilai untuk tiap jenis formulir, memilih tanggal penerimaan yang valid saat tanggal utama masih berisi tahun penanda, dan memisahkan batas sumber dari batas setelah akhir pekan. Rekap PPN dan PPh menyajikan masa, jumlah, dan rujukan untuk menelusuri perbedaan. Dasbor WP Badan menyertakan enam indikator dan berkas sumbernya.

Penarik dapat mengikuti halaman berikut pada daftar SPT yang menampilkan identitas WP di panel halaman. Penarik memeriksa identitas dan bentuk tabel saat berpindah. Uji ekstensi terpasang memakai Coretax fiktif dengan beberapa masa, penggantian WP dan perubahan struktur tabel. Pencocokan seluruh lampiran hasil tarikan operasional Versi 2 masih terbuka. [Penarik](SCRAPING.md) · [Analisis](ANALISIS.md) · [Matriks kesetaraan](KESETARAAN.md)

Pratinjau memperinci versi SPT dalam antrean dan bagian yang masih perlu diambil. Dalam uji ZIP fiktif, VERITAX Studio 1.32.0 berhasil membaca kembali enam sumber termasuk arsip SPT, saldo, induk PPN dan lampiran A2. KKP Badan menampilkan kode pilihan pengembalian sebagai keterangan dan menyimpan hasil telaah terdahulu dalam riwayat. [Format ZIP](FORMAT.md) · [KKP](ANALISIS.md)

## 18 November 2026 · Prarilis 0.3.0

Setiap tarikan memakai satu NPWP. Ketika satu tabel memuat beberapa jenis SPT, penarik mengenali jenis pada setiap baris, menerapkan pilihan pengguna dan mempertahankan urutan kolom sumber. Antrean lama dapat dilanjutkan per WP. Pemutar menambah rincian mutu, pencocokan CSV, buku besar gabungan, rasio pembanding, garis waktu dan peta hubungan. KKP per indeks terhubung ke KKA dan SP2DK. Penggabungan berkas kerja memakai pratinjau dan menampilkan konflik sebelum isian digabung.

Uji profil Chrome terisolasi menggunakan ekstensi terpasang. Lima baris dan 17 kolom dari tabel SPT fiktif cocok saat dibaca dari ZIP dan ditampilkan di pemutar. Pengujian ini dilakukan terpisah dari pengamatan tabel produksi. [Bukti per fitur dan selisih](KESETARAAN.md)

## 18 November 2026 · Prarilis 0.2.0

Penarik dapat mengambil beberapa tabel dari tab yang terbuka dan membaca CSV asli Daftar Kasus Aktif. Penarik membedakan judul kolom dari kotak filter serta pesan tabel kosong. Jika tabel administratif tidak mencantumkan masa pajak, pengguna dapat mempertahankan keterangan tersebut di paket.

- **Profil dan SPT.** Pemutar membedakan profil Badan dan OP, mencocokkan saham dan pembayaran, serta menampilkan riwayat KLU. Lima jenis SPT diuji dari paket contoh. Jenis keenam, PPN non-PKP/pemungut, diuji dengan paket sintetis. Dasbor membandingkan dua WP dengan jenis dan masa SPT yang sama. [Pemutar](ANALISIS.md)
- **Kertas kerja dan konsep.** KKP, KKA, SP2DK dan BAP2DK membawa pilihan temuan berbukti atau indikatif ke keluaran masing-masing. Excel KKP memuat rumus selisih. KKA menyajikan perbandingan dua tahun dan rincian potensi per jenis pajak. [Kertas kerja](ANALISIS.md) · [Konsep dokumen](KONSEP.md)
- **Simulasi SKPKB.** Pengguna dapat mengisi pokok hasil pengujian dan penggunaan kompensasi per masa. Simulator membandingkan bunga dengan kenaikan jika kedua sanksi berlaku pada satu ketetapan PPN/PPnBM. Tarif bunga Pasal 13 ayat (2) tersedia untuk Januari 2023–November 2026. Hasil uji sintetis cocok di layar dan Excel. [Dasar dan batas simulasi](ANALISIS.md)
- **Katalog KLU.** Pencarian mencakup 60 kode kategori Z. Kalkulator omzet berjenjang menghasilkan 28221 dan 47420 untuk dua contoh DJP. Catatan sumber menjelaskan selisih angka cetak di lampiran. [Katalog kegiatan](KATALOG.md)

**Uji intranet.** Ekspor resmi Daftar Kasus Aktif yang sesuai penugasan dicocokkan dari CSV hingga ZIP dibuka di pemutar. Tanggal diperiksa sampai tingkat hari yang ditampilkan dan indikator ditangguhkan dicocokkan dengan keadaan kotak centang. Isi kasus dan rincian hasil uji tersimpan secara privat di perangkat pengguna.

**Pelajaran.** Coretax menyertakan dua token presentasi pada header CSV, sementara setiap baris data dimulai dengan nomor kasus. Penarik memeriksa kontrak tersebut sebelum membaca nilai. Pada HTML, satu baris pesan dapat mengisi seluruh lebar tabel kosong. Jumlah elemen baris saja tidak menunjukkan jumlah data.

**Tindakan berikutnya.** Uji pembacaan langsung satu tabel SPT dan lampirannya pada tab produksi milik WP yang ditugaskan. Bandingkan masa, pembetulan dan jumlah baris dengan tampilan sumber. Langkah ini memperluas bukti ke jalur pengambilan yang berbeda dari impor CSV kasus aktif.

## 18 November 2026 · Prarilis 0.1.0

Proyek mandiri, penarik, pemutar, dukungan paket, konsep dokumen, katalog serta situs distribusi dibuat dari awal. Dua skill lokal disiapkan untuk membuka konteks proyek dan mencatat pembaruan berikutnya. Pemilik memilih menerbitkan prarilis dengan selisih yang dinyatakan terbuka.

Pada empat contoh fiktif, pemutar memeriksa 2.003 berkas data. Uji Chromium memeriksa penarikan dengan sumber sintetis, paginasi, pengalihan WP, pemutar, kertas kerja dan konsep dokumen. Uji paket rilis memakai profil Chrome for Testing baru. [Hasil dan batas tiap bagian](KESETARAAN.md)

**Pelajaran.** Impor paket acuan dan pembacaan paket baru oleh pemutar Versi 2 menguji dua jalur yang berbeda. Bukti keduanya harus dicatat terpisah dari penerimaan paket oleh pemutar rujukan. Pembacaan satu tabel juga perlu mempertahankan identitas WP dan berhenti saat konteksnya berubah.

**Tindakan berikutnya.** Bandingkan satu alur penarikan pada halaman Coretax yang diizinkan dengan hasil manual untuk WP dan masa yang sama. Catat kategori sumber, jumlah baris, urutan halaman dan bagian yang tidak terbaca secara lokal. Hasilnya menentukan modul otomatisasi mana yang perlu dikembangkan lebih dahulu.
