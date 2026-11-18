# Riwayat Scraping Coretax Versi 2

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
