# Pemutar paket dan kertas kerja

Buka pemutar dari **Buka di Analisis** pada hasil penarikan, atau buka halaman analisis ekstensi dan pilih satu atau beberapa paket lokal. Setelah berkas terbaca, pilih **WP aktif** dan periksa identitas, periode, serta mutu paket. Berkas paket dan isian kerja berada di memori tab. Unduh berkas kerja sebelum menutup tab jika isian perlu digunakan kembali.

## Acuan dan bukti

Pembanding lokal untuk Versi 2 adalah navigasi pada berkas distribusi VERITAX v1.32.0 \`ekstensi-veritax/analisis/index.html\`, bab 4–9 dalam \`PANDUAN.txt\`, serta bab 9 dan 11–26 dalam buku panduan PDF. Paket fiktif digunakan sebagai masukan pengujian. Contoh tersebut tetap berada di folder referensi lokal.

Status **terverifikasi** di tabel berikut berlaku pada perilaku yang disebutkan dalam baris itu. **Berbeda** berarti ada selisih fungsi yang diketahui. **Belum teruji** berarti bukti perbandingan belum tersedia.

| Bagian | Status | Hasil pada versi ini |
|---|---|---|
| Buka dan periksa paket | Terverifikasi | Pemutar menerima keempat paket ZIP fiktif dari acuan. Uji peramban juga membuka paket sintetis terenkripsi dengan kata sandi, menampilkan laporan sidik jari, serta mengganti paket aktif. Rincian format dan verifikasi ada di FORMAT.md. |
| Navigasi, peran dan tampilan | Berbeda | Sembilan tab utama mengikuti urutan acuan. Tab yang memerlukan data terbuka setelah impor. Ada pilihan Pemeriksa, AR dan Penelaah, Cari cepat, riwayat tab, tema, ukuran, kontras dan pintasan papan ketik. Pencarian lintas indeks kertas kerja dan tautan dalam ke formulir individual belum tersedia. |
| Profil WP dan data mentah | Berbeda | Berkas dapat dipilih berdasarkan sumber, ditelusuri, disaring, diurutkan, dan diekspor ke Excel. Informasi umum ditampilkan sebagai pasangan isian dan nilai. Pengelompokan 23 bagian profil Badan dan menu khusus OP pada acuan belum direproduksi seluruhnya. |
| Daftar dan isi SPT | Berbeda | Daftar terstruktur mendukung jenis, tahun, versi terakhir, pembetulan, dan tanggal lapor melewati batas yang dicantumkan sumber. Formulir menampilkan induk, lampiran dan perubahan versi. Excel dan cetak tersedia. Tata letak formulir pajak resmi, penautan pembayaran dan cetak gabungan semua formulir belum setara. |
| Ringkasan dasbor | Berbeda | Tersedia enam bagian. Angka induk menggunakan pembetulan tertinggi per jenis dan periode. Indikator bersumber dari berkas, mencakup nilai induk PPN, PPh tahunan, potong/pungut, buku besar, lawan transaksi dan akun keuangan yang dikenali. Nilai kosong dipertahankan. Grafik dan panel indikasi belum mencakup seluruh materi acuan. |
| Butir pengujian dan analisis lanjutan | Berbeda | Pemutar menunjukkan pembetulan, keterlambatan menurut tanggal di sumber dan berkas bertanda belum lengkap. Analisis rasio sektoral, uji 3M, ekualisasi lintas pajak, simulasi sanksi, rekonsiliasi temuan, peta hubungan dan perbandingan antar-WP belum tersedia sebagai mesin pengujian lengkap. |
| Kertas kerja | Berbeda | Pengguna dapat memasukkan fakta, sumber, dua angka pembanding, simpulan, petugas dan status. Selisih dihitung saat kedua angka terisi. Excel, Word dan cetak tersedia. Isian dan draf berita acara dapat dibawa ke sesi berikutnya melalui JSON yang terikat pada paket dan tahun. Format lengkap SE-08/ND-306, daftar indeks, kalibrasi dan rumus silang acuan memerlukan implementasi lanjutan. |
| Konsep dokumen dan katalog | Berbeda | Baca KONSEP.md untuk alur SP2DK, BAP2DK, BAPK dan keluaran. Baca KATALOG.md untuk cakupan peraturan, klasifikasi kegiatan ekonomi, profil Probis dan sumbernya. |
| Bantuan dan mode pengembang | Berbeda | Bantuan menjelaskan alur paket, SPT, kertas kerja, data lokal dan pintasan. Alat eksperimental impor appportal dan sanitasi HAR serta pembaruan aturan melalui berkas tidak disertakan pada prarilis ini. |
| Perbandingan visual dan hasil fiskal keseluruhan | Belum teruji | Tata letak mengikuti hierarki, kontrol dan alur pada berkas statis serta buku panduan. Kesetaraan tiap piksel dengan dua tab Chrome terpasang dan kesamaan semua perhitungan pajak pada seluruh kombinasi data belum diverifikasi. |

## Jalur pengujian

- \`node --test tests/viewer.test.mjs\` memeriksa pembetulan tertinggi, batas menurut tanggal sumber, nilai nol, kolom kosong, identitas berawalan nol dan perbedaan isian.
- \`node tests/viewer-browser.mjs\` menjalankan pemutar baru pada Chromium terisolasi melalui loopback. Cakupannya meliputi profil, pembetulan PPN, kertas kerja manual, unduhan Excel, simpan JSON, navigasi dasbor, pencarian cepat, tampilan ponsel 390 piksel dan paket terenkripsi. Untuk menjalankan kembali perbandingan format dengan keempat contoh, arahkan \`VERITAX_FIXTURES\` ke direktori contoh lokal. Lingkungan memerlukan Playwright dan Chromium. \`PLAYWRIGHT_MODULE\` serta \`CHROMIUM_PATH\` dapat menunjuk instalasi yang sudah tersedia.
- Dalam pengujian 18 November 2026, kedua uji model dan alur Chromium di atas berhasil, termasuk impor empat paket contoh Badan, Badan migrasi, OP, dan OP pekerjaan bebas.
