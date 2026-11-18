# Paket data dan berkas ekspor

Versi 2 membaca paket **CAP-PAKET versi 1** secara lokal. Kontrak diperiksa dari struktur empat ZIP contoh fiktif, manifest dan berita acaranya, serta tata letak berkas terenkripsi pada pustaka format paket referensi. Implementasi ada di `extension/archive/`.

| Contoh fiktif VERITAX 1.32.0 | Berkas data di manifest | Berkas berhasil dibaca | Hasil pemeriksaan |
| --- | ---: | ---: | --- |
| Badan migrasi | 1.004 | 1.004 | Sesuai |
| OP pekerjaan bebas | 172 | 172 | Sesuai |
| OP | 155 | 155 | Sesuai |
| Contoh umum | 672 | 672 | Sesuai |

Setiap ZIP berisi `MANIFEST.json`, `BERITA-ACARA.txt`, `MANIFEST.sha256`, dan anggota `data/<path>.json`. Nama di dalam daftar `manifest.files` relatif terhadap `data/`. Berkas data memuat metadata pengambilan di `cap` dan halaman respons di `pages`. Identitas WP disimpan sebagai teks. Nilai yang tidak tersedia dapat tetap kosong. Satu berkas dapat memuat beberapa halaman.

### Pemeriksaan integritas

Pemutar memeriksa CRC-32 setiap anggota ZIP, SHA-256 setiap berkas data terhadap manifest, SHA-256 atas serialisasi daftar berkas, serta checksum manifest dan berita acara. Pemutar melaporkan berkas yang berbeda, tambahan, hilang, dan JSON yang tidak terbaca. Beberapa label dalam berita acara juga diperiksa terhadap manifest. Untuk paket lama yang tidak memberikan checksum berita acara, `report.minutesHasChecksum` bernilai `false`.

Hash yang disertakan dalam paket membantu mendeteksi kerusakan dan ketidaksesuaian internal. Pemeriksaan ini tidak mengautentikasi pembuat paket. Hash respons asli di `cap.shaRespons` dipertahankan bila tersedia. Pada masukan berbentuk halaman JSON yang baru direkam, eksportir menghitung hash dari serialisasi halaman tersebut.

### Enkripsi dan interoperabilitas

Pemutar membaca ZIP32 dan ZIP64 satu volume, baik tanpa kompresi maupun dengan Deflate. Setiap arsip dapat memuat sampai 200.000 anggota dengan batas isi setelah dekompresi 256 MiB per anggota dan 512 MiB untuk seluruh arsip. Penulis memakai ZIP32 sampai 65.535 anggota dan beralih ke ZIP64 mulai 65.536 anggota. ZIP yang dipecah menjadi beberapa volume dan enkripsi pada anggota ZIP berada di luar dukungan.

Untuk `.sedotax`, pemutar menerima amplop CAPX1 dan CAPX2 dengan AES-GCM, PBKDF2 dan SHA-256. Ekspor terenkripsi menggunakan CAPX2 dengan salt dan IV acak serta 600.000 iterasi. Pengujian CAPX1 menggunakan paket sintetis yang dibungkus terpisah dari eksportir. Keempat contoh referensi berbentuk ZIP terbuka.

Berkas kerja XLSX berisi workbook OOXML dan menyimpan teks sebagai teks, termasuk nomor identitas dengan nol di depan. Nilai numerik yang diberikan sebagai angka tetap numerik. DOCX berisi paragraf dan tabel Word yang dapat disunting. CSV memakai UTF-8 dengan BOM, pemisah koma dan petik ganda. Ekspor CSV memberi awalan petik tunggal pada teks yang dapat dibaca sebagai rumus oleh spreadsheet.

### Rekonsiliasi appportal dalam mode pengembang

Pada **Muat paket**, aktifkan **Mode pengembang**, atau buka pemutar dengan akhiran `#pengembang`. Tab **Impor appportal** terbuka setelah satu paket WP aktif. Pilih tahun, lalu unggah CSV, TXT berpemisah, XLSX, atau tabel HTML termasuk ekspor HTML berekstensi XLS. Untuk XLS biner lama, simpan ulang sebagai XLSX. Data impor tetap berada di sesi paket itu. Memuat ulang tab atau melepas paket menghapus data sesi.

| Data appportal | Lampiran SPT PPN versi terakhir per masa | Kolom identitas pemilik bila ada |
| --- | --- | --- |
| PK | A2 | NPWP penjual |
| PM | B2 dan B3 | NPWP pembeli |
| PIB | B1 | NPWP importir |
| PEB | A1 | NPWP eksportir |

Periksa lembar, baris judul dan pemetaan kolom sebelum membaca hasil. Bentuk nomor dokumen dan NPWP sebagai teks di Excel agar nol awal tersimpan. Jika suatu baris tidak menyebut NPWP pemilik, cocokkan berkas dengan paket aktif lalu centang konfirmasi. Berkas dengan identitas pemilik yang berbeda perlu dipisahkan di sumber. Pemetaan kolom appportal dapat disimpan untuk susunan judul yang sama. Penyimpanan itu mencatat posisi kolom dan sidik jari judul.

Kedua sisi mengikuti tahun pilihan. Masa pajak yang tercantum di berkas diutamakan. Tanggal dokumen membantu menentukan masa jika tidak tercantum. Secara bawaan, pembanding memakai masa yang memiliki SPT PPN. Nomor lengkap yang unik dapat cocok walau masa dokumen dan masa pelaporan SPT berbeda. Rincian menyebut kedua masa dan sumber masing-masing. Pengguna dapat menjumlahkan beberapa baris barang untuk satu nomor dalam satu masa appportal. Nomor yang berulang tanpa pengelompokan, nominal yang tidak terbaca, dan pembanding yang belum lengkap diberi status **Perlu diperiksa**. Bila ada dua SPT dengan nomor pembetulan terakhir yang sama dalam satu masa, cakupan menandai masa tersebut. Filter status dan pencarian dalam tabel membantu menemukan selisih.

Untuk PK dan PM, nomor faktur dengan awalan berbeda dapat berstatus **Cocok sebagian** bila 13 digit terakhir hanya menunjuk pada satu kemungkinan di masing-masing sumber dan nominal sesuai. Kedua nomor tetap terlihat. Pencocokan memberi toleransi Rp1 pada setiap nominal yang dibandingkan. Rincian menampilkan selisihnya meskipun masih dalam toleransi.

**Excel rekonsiliasi** memuat lembar Info, Ringkasan, Per masa dan Rincian dengan akhiran PK, PM, PIB, atau PEB. Daftar Isi memberi tautan ke keempat lembar. Lembar Info menyimpan identitas WP, peran pengguna, waktu impor dan ekspor, tahun, cakupan, pemetaan serta sidik jari SHA-256 berkas appportal dan manifest paket. Selisih dihitung dari nominal lampiran SPT dikurangi nominal appportal. Nilai yang tidak tersedia tetap kosong.

Jalankan `node --test tests/appportal.test.mjs` dan `node tests/appportal-browser.mjs` untuk menguji contoh fiktif. Jika distribusi Studio tersedia lokal, arahkan `VERITAX_STUDIO` ke berkas HTML-nya untuk menyertakan pembanding luring. Pengujian ini menggunakan ekspor buatan dengan judul dan nilai terkontrol. Susunan ekspor appportal operasional masih perlu dipastikan dari berkas yang benar-benar diunduh.

### Bukti uji

Beberapa respons Coretax mengisi `TotalRecords` dengan angka yang sama dengan `Rows` pada permintaan. Pemutar memberi satu catatan informatif bila penarik mencatat berkas lengkap, jumlah baris dan halaman cocok, serta ada respons berisi data dan halaman akhir kosong untuk sumber dan batas permintaan yang sama. Baris yang persis mencapai batas tanpa halaman penutup tetap memunculkan peringatan. Selisih jumlah yang belum terjelaskan bisa diperiksa dengan ekspor independen. Catatan **MASA-KOSONG** berasal dari hasil pencarian SPT per masa.

Pada pemutar Versi 2, **Muat paket → Rincian mutu data** memisahkan masalah integritas, peringatan cakupan dan keterangan penarik. Di bagian **Cocokkan tabel dengan ekspor Coretax**, pilih tabel paket dan CSV dari tampilan yang sama. Pasangkan nama kolom yang berbeda, lalu pilih **Cocokkan baris dan isi**. Pembanding mempertahankan urutan baris, nol di depan dan kemunculan baris kembar. Format tanggal atau angka yang tampil berbeda memerlukan pemeriksaan pada sumber. Keterangan **Seluruh baris dan kolom cocok** mensyaratkan semua kolom pada kedua sumber berpasangan dan seluruh nilai cocok. Excel memuat ringkasan, pasangan kolom dan perbedaan.

Jalankan `node --test tests/archive.test.mjs tests/document.test.mjs`. Uji mencakup empat paket referensi bila tersedia lokal, ekspor dan pembacaan ulang, deteksi ketidaksesuaian, enkripsi, kata sandi keliru, tipe sel, serta isi DOCX. Workbook dan dokumen sintetis juga telah dibuka dengan pembaca independen `openpyxl` dan `python-docx`. Contoh referensi tetap berada di workspace lokal.

Untuk mengulang uji arah **Versi 2 → VERITAX Studio 1.32.0**, arahkan `VERITAX_STUDIO` ke berkas HTML Studio yang tersedia lokal, lalu jalankan `node tests/veritax-interop-browser.mjs`. Penarik Versi 2 menerima enam sumber JSON fiktif melalui **Tambahkan JSON atau CSV → Mulai tarik → Unduh paket**. Studio dibuka secara luring dan memeriksa ulang enam SHA-256. Nomor rekening tetap berawalan nol, arsip masuk ke daftar SPT, saldo buku besar dan nomor dokumen A2 tampil di tabel masing-masing. Pada daftar isi SPT, masa, pembetulan, bukti penerimaan, tanggal lapor dan nilai dari induk cocok dengan contoh. Uji ini mencakup ZIP biasa serta konteks formulir yang diketahui. Seluruh variasi transaksi, formulir dan tata letak sumber masih perlu dibandingkan.

Kedua pemutar membuka paket CAPX2 buatan aplikasi lainnya serta contoh CAPX1 fiktif dengan kata sandi yang diketahui. Kata sandi keliru atau tag autentikasi yang berubah ditolak oleh Versi 2. Kedua pemutar juga berhasil memuat empat ZIP demo independen dalam satu sesi. Keduanya menolak berkas ZIP yang dipecah menjadi segmen `.z01`, `.z02` dan `.zip` pada pengujian ini.

Penulis dan pembaca arsip Studio 1.32.0 diuji dengan 65.535 anggota ZIP32 dan 65.536 anggota ZIP64 satu volume. Prarilis 0.4.0 menolak kedua arsip tersebut. Pada kode pengembangan, pemutar di Chrome berhasil membuka paket ZIP64 buatan Studio dan mencocokkan SHA-256 seluruh 65.533 berkas data dengan manifest. Pembaca arsip Studio juga mencocokkan CRC seluruh 65.536 anggota yang dikemas ulang oleh penulis Versi 2. Jalankan `node --test tests/archive-zip64.test.mjs` untuk menguji batas jumlah anggota, ukuran dan posisi anggota dalam contoh ZIP64 dari Python, serta penolakan arsip yang melampaui batas.
