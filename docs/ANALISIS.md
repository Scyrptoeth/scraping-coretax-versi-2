# Pemutar paket dan kertas kerja

Pada prarilis 0.2.0, pilih **Buka di Analisis** sesudah penarikan atau buka beberapa paket ZIP lokal dari tab **Muat paket**. Pilih **WP aktif**, periksa periode dan hasil pemeriksaan integritas, lalu pilih tahun pada bagian yang akan digunakan. Paket dan isian kerja berada di memori tab. Unduh berkas kerja jika isian perlu dibuka kembali bersama paket yang sama. [Format dan pemeriksaan integritas](FORMAT.md)

## Profil, SPT dan data mentah

| Bagian | Cara membaca hasil |
| --- | --- |
| Profil WP Badan | Pemegang saham pada registrasi dibandingkan dengan SPT Badan. Tabel menunjukkan data yang cocok dan yang hanya muncul pada salah satu sumber. Bagian lain memuat pengurus, penyertaan modal, tahun buku, KLU, relasi transaksi dan pembayaran sesuai isi paket. |
| Profil WP Orang Pribadi | Pilih bagian rezim, ringkasan SPT, penghasilan dan bukti potong, harta dan utang, atau keluarga dan PTKP. Data memuat tahun serta berkas sumber bila tersedia. **Excel semua bagian** mengekspor bagian profil WP aktif. |
| Riwayat KLU dan pembayaran | KLU utama per tahun memakai tanggal berlaku registrasi. Untuk pembayaran, pemutar mencari kewajiban buku besar yang merujuk SPT versi terakhir dan membandingkan setoran pada kode akun pajak serta masa yang sama. Petugas masih perlu memeriksa alokasi setoran. |
| SPT | Saring daftar menurut tahun, jenis atau pembetulan. Buka satu versi, pilih induk atau lampiran, cari nama isian, kode atau nilai, dan bandingkan satu bagian dengan versi lain. Lima jenis yang diuji ialah PPN, PPh Badan, PPh OP, PPh 21/26 dan PPh Unifikasi. Excel dan cetak tersedia untuk satu formulir atau gabungan hasil pilihan. |
| PPN non-PKP / pemungut | Jenis keenam dapat dibuka dari paket yang menyediakan induk, L1, L2 atau total L2. Ekspor Excel empat bagian diuji dengan paket sintetis. Keempat paket contoh acuan tidak memuat formulir jenis ini. |
| Ringkasan SPT dan dasbor | **Ringkasan SPT** menampilkan PPN per masa, potong/pungut dan kalender pelaporan. Untuk menilai ketepatan lapor, periksa tanggal batas di sumber, hari libur dan keadaan WP. |
| Perbandingan antar-WP | Muat dua paket WP yang berbeda, pilih jenis dan masa SPT yang sama. Dasbor menampilkan versi terakhir, nilai, isian asal, mata uang dan bukti penerimaan bila tersedia. Selisih hanya dihitung jika kedua nilai tersedia dan mata uangnya sama. Excel memuat angka pembanding dan sumber kedua WP. |
| Data mentah | Pilih sumber untuk mencari, mengurutkan dan mengekspor baris. Tabel administratif dengan masa yang tidak tercantum dapat dibuka di sini. Rincian yang tersedia mengikuti bidang pada paket. |

Gunakan **Ctrl+K** untuk mencari bagian profil, tabel sumber, atau formulir menurut jenis SPT, masa, versi, atau BPE. Membuka kembali tautan formulir memerlukan paket asal.

Pada tab **Probis**, katalog menyediakan KBLI 2020 dan 2025 serta 60 kode KLU kategori Z dari lampiran DJP. Pilih kode untuk melihat jenjang, uraian dan halaman rujukan. Kalkulator memakai omzet tiap kegiatan dan menampilkan langkah penentuan KLU per jenjang. [Cakupan dan sumber katalog](KATALOG.md)

## Kertas kerja

1. Di **KKP** atau **KKA**, pilih **Tambah butir**. Catat fakta, sumber, nilai menurut WP dan petugas, simpulan, klasifikasi serta status penelaahan. Pokok hasil pengujian mempunyai isian tersendiri. Klasifikasi berbukti memerlukan fakta dan rujukan.
2. Periksa **Rincian dan penelaahan temuan**. Tanggal lapor dan sisa tagihan menunjukkan fakta sumber. Faktur dengan nomor, pemasok dan tanggal yang sama di B2 versi terakhir pada beberapa masa merupakan petunjuk untuk pengujian hak pengkreditan. Butir yang ditandai terjelaskan atau tidak relevan dikeluarkan dari keluaran.
3. Tentukan **Temuan yang dimasukkan**. KKP dimulai dengan **Berbukti saja**. KKA dan konsep SP2DK baru dimulai dengan **Berbukti + indikatif**. Setiap dokumen memiliki pilihannya sendiri.
4. Gunakan **Excel kertas kerja**, **Word**, atau **Cetak / PDF**. Excel KKP memuat rumus selisih untuk dua nilai pembanding yang terisi. KKA memuat profil, kriteria pemilihan WP, perbandingan SPT dua tahun pada Tabel 4.1, potensi per jenis dan rinciannya pada Tabel 5 dan 5.1, serta usulan petugas. Pilihan indikatif menambahkan Lampiran L-9. [Konsep surat dan berita acara](KONSEP.md)
5. Gunakan **Unduh berkas kerja** untuk menyimpan pilihan, catatan, draf dan simulasi. **Buka berkas kerja** mencocokkan paket dan tahun. Berkas lama dapat dibuka dengan pilihan awal untuk bidang yang belum ada pada versi sebelumnya.

## Simulasi SKPKB

Di **Kertas Kerja → Simulasi sanksi**, isi tanggal rencana ketetapan dan tambahkan satu baris per jenis pajak dan masa yang diuji. Isi dasar bunga dari hasil pengujian atau salin dari butir berbukti. Untuk simulasi kenaikan atas kompensasi, masukkan masa penerima dan jumlah yang menurut bukti benar-benar digunakan secara tidak semestinya.

Simulator mencakup bunga Pasal 13 ayat (2) untuk penghitungan yang dimulai sesudah masa atau tahun pajak berakhir, serta kenaikan 75% PPN/PPnBM untuk kasus kompensasi yang sesuai. Jika kedua sanksi berlaku pada satu ketetapan PPN/PPnBM, simulator membandingkan keduanya dan memakai nilai tertinggi menurut Pasal 13 ayat (3a). Bunga memakai tarif resmi pada bulan pertama penghitungan, dengan bagian bulan dihitung penuh dan batas 24 bulan. Tarif tersedia untuk Januari 2023–November 2026. [UU HPP](https://pajak.go.id/id/peraturan/harmonisasi-peraturan-perpajakan) · [Penjelasan Pasal 20 PP 50/2022](https://pajak.go.id/index.php/id/peraturan/tata-cara-pelaksanaan-hak-dan-pemenuhan-kewajiban-perpajakan) · [KMK November 2026](https://jdih.kemenkeu.go.id/dok/kmk-52mkef22026)

**Excel simulasi** memuat ringkasan per jenis, rincian per masa, penelusuran kompensasi dan rujukan. Pokok kosong, sumber yang belum diisi atau tarif yang belum tersedia membuat hasil terkait tetap kosong. Nominal yang dapat dihitung merupakan perkiraan sebelum pembulatan rupiah. Penghitungan yang dimulai pada tanggal transaksi dan aliran koreksi otomatis dari seluruh kertas kerja pendukung masih di luar cakupan.

## Pengujian dan batas perbandingan

Uji pemutar menggunakan empat paket fiktif acuan, meliputi Badan, Badan migrasi, OP dan OP pekerjaan bebas. Untuk mengulangi uji, jalankan `node --test tests/*.test.mjs`. Uji peramban profil, formulir, kertas kerja dan draf tersedia di `tests/profile-browser.mjs`, `tests/spt-browser.mjs`, `tests/findings-browser.mjs` dan `tests/drafts-browser.mjs`. Jalankan dengan Node, Playwright dan Chromium. Untuk uji profil dan SPT, arahkan `VERITAX_FIXTURES` ke direktori empat arsip fiktif. Bila perlu, tentukan `PLAYWRIGHT_MODULE` dan `CHROMIUM_PATH` untuk instalasi lokal.

Uji intranet memakai satu baris Daftar Kasus Aktif melalui ekspor resmi di Chrome. Ke-14 bidang data cocok di CSV, ZIP dan pemutar. Pengujian tersebut mencakup alur impor CSV. Paginasi dan pembacaan langsung oleh ekstensi di tab Coretax produksi masih memerlukan pengujian tersendiri.

Urutan sembilan tab, pilihan peran, tampilan dan pintasan mengacu pada distribusi dan buku panduan VERITAX v1.32.0. Perbandingan menyeluruh terhadap dua tab ekstensi rujukan yang terpasang, seluruh tata letak formulir resmi, rumus silang KKP/KKA, analisis sektor serta pembaruan aturan dari berkas masih terbuka. [Matriks kesetaraan](KESETARAAN.md)
