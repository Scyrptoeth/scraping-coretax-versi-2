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

Pembaca ZIP mendukung ZIP32 tanpa kompresi dan Deflate. Saat membuka, batas ukuran sebelum dekompresi selesai adalah 256 MiB per anggota dan 512 MiB total isi. ZIP64, ZIP multivolume dan ZIP yang memakai enkripsi internal berada di luar dukungan pembaca. Untuk `.sedotax`, pemutar menerima amplop CAPX1 dan CAPX2 dengan AES-GCM, PBKDF2 dan SHA-256. Ekspor terenkripsi menggunakan CAPX2 dengan salt dan IV acak serta 600.000 iterasi. Pengujian CAPX1 menggunakan paket sintetis yang dibungkus terpisah dari eksportir. Keempat contoh referensi berbentuk ZIP terbuka.

Berkas kerja XLSX berisi workbook OOXML dan menyimpan teks sebagai teks, termasuk nomor identitas dengan nol di depan. Nilai numerik yang diberikan sebagai angka tetap numerik. DOCX berisi paragraf dan tabel Word yang dapat disunting. CSV memakai UTF-8 dengan BOM, pemisah koma dan petik ganda. Ekspor CSV memberi awalan petik tunggal pada teks yang dapat dibaca sebagai rumus oleh spreadsheet.

### Bukti uji

Pada pemutar Versi 2, **Muat paket → Rincian mutu data** memisahkan masalah integritas, peringatan cakupan dan keterangan penarik. Di bagian **Cocokkan tabel dengan ekspor Coretax**, pilih tabel paket dan CSV dari tampilan yang sama. Pasangkan nama kolom yang berbeda, lalu pilih **Cocokkan baris dan isi**. Pembanding mempertahankan urutan baris, nol di depan dan kemunculan baris kembar. Format tanggal atau angka yang tampil berbeda memerlukan pemeriksaan pada sumber. Keterangan **Seluruh baris dan kolom cocok** mensyaratkan semua kolom pada kedua sumber berpasangan dan seluruh nilai cocok. Excel memuat ringkasan, pasangan kolom dan perbedaan.

Jalankan `node --test tests/archive.test.mjs tests/document.test.mjs`. Uji mencakup empat paket referensi bila tersedia lokal, ekspor dan pembacaan ulang, deteksi ketidaksesuaian, enkripsi, kata sandi keliru, tipe sel, serta isi DOCX. Workbook dan dokumen sintetis juga telah dibuka dengan pembaca independen `openpyxl` dan `python-docx`. Contoh referensi tetap berada di workspace lokal. Pembukaan paket buatan Versi 2 di pemutar VERITAX asli belum diuji.
