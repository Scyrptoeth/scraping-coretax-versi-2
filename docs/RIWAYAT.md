# Riwayat Scraping Coretax Versi 2

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

**Uji intranet.** Satu baris untuk satu WP dipilih melalui daftar kasus aktif sesuai jabatan. Tabel mempunyai 16 kolom termasuk prioritas dan kontrol aksi. CSV resmi menyertakan 14 bidang data. Semua isinya dipertahankan hingga ZIP dibuka di pemutar. Dua tanggal di layar hanya menampilkan hari, dan indikator ditangguhkan ditampilkan sebagai kotak centang. Isi kasus dan paket uji tetap berada di perangkat pengguna.

**Pelajaran.** Coretax menyertakan dua token presentasi pada header CSV, sementara setiap baris data dimulai dengan nomor kasus. Penarik memeriksa kontrak tersebut sebelum membaca nilai. Pada HTML, satu baris pesan dapat mengisi seluruh lebar tabel kosong. Jumlah elemen baris saja tidak menunjukkan jumlah data.

**Tindakan berikutnya.** Uji pembacaan langsung satu tabel SPT dan lampirannya pada tab produksi milik WP yang ditugaskan. Bandingkan masa, pembetulan dan jumlah baris dengan tampilan sumber. Langkah ini memperluas bukti ke jalur pengambilan yang berbeda dari impor CSV kasus aktif.

## 18 November 2026 · Prarilis 0.1.0

Proyek mandiri, penarik, pemutar, dukungan paket, konsep dokumen, katalog serta situs distribusi dibuat dari awal. Dua skill lokal disiapkan untuk membuka konteks proyek dan mencatat pembaruan berikutnya. Pemilik memilih menerbitkan prarilis dengan selisih yang dinyatakan terbuka.

Pada empat contoh fiktif, pemutar memeriksa 2.003 berkas data. Uji Chromium memeriksa penarikan dengan sumber sintetis, paginasi, pengalihan WP, pemutar, kertas kerja dan konsep dokumen. Uji paket rilis memakai profil Chrome for Testing baru. [Hasil dan batas tiap bagian](KESETARAAN.md)

**Pelajaran.** Impor paket acuan dan pembacaan paket baru oleh pemutar Versi 2 menguji dua jalur yang berbeda. Bukti keduanya harus dicatat terpisah dari penerimaan paket oleh pemutar rujukan. Pembacaan satu tabel juga perlu mempertahankan identitas WP dan berhenti saat konteksnya berubah.

**Tindakan berikutnya.** Bandingkan satu alur penarikan pada halaman Coretax yang diizinkan dengan hasil manual untuk WP dan masa yang sama. Catat kategori sumber, jumlah baris, urutan halaman dan bagian yang tidak terbaca secara lokal. Hasilnya menentukan modul otomatisasi mana yang perlu dikembangkan lebih dahulu.
