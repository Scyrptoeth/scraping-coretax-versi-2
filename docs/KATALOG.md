# Katalog kegiatan dan peraturan

Kedua edisi KBLI dapat dicari saat komputer sedang offline. Kode disimpan sebagai teks supaya angka nol di depan tetap terbaca. Kode dan judul diambil dari sumber publik BPS. Seluruh isi katalog dibangun dari sumber ini secara terpisah dari ekstensi acuan.

| Edisi | Kategori | Golongan pokok | Golongan | Subgolongan | Kelompok |
| --- | ---: | ---: | ---: | ---: | ---: |
| KBLI 2020 | 21 | 88 | 245 | 567 | 1.789 |
| KBLI 2025 | 22 | 87 | 257 | 519 | 1.559 |

Sumber angka pembanding dan publikasi tersedia di [Kamus Pembakuan Statistik BPS](https://klasifikasi.web.bps.go.id/app/kbli), [publikasi BPS 2020](https://ppid.bps.go.id/upload/doc/Klasifikasi_Baku_Lapangan_Usaha_Indonesia_2020_1713495028.pdf) dan [Peraturan BPS Nomor 7 Tahun 2025](https://peraturan.go.id/files/peraturan-bps-no-7-tahun-2025.pdf).

Katalog juga memuat 60 kode KLU kategori Z bagi WP orang pribadi. Lampiran bagian A memuat satu kategori, sembilan golongan pokok, 14 golongan, 18 subgolongan dan 18 kelompok. Ketik kode seperti `Z2200` atau nama seperti “pegawai swasta”. Filter **Acuan klasifikasi** dan **Tingkat** dapat membatasi hasil. Rincian menampilkan nama, jenjang serta halaman sumber. [Lampiran PER-12/PJ/2022, bagian A, halaman 1–5](https://www.pajak.go.id/sites/default/files/lampiran/Lampiran%20PER_12_PJ_2022.pdf)

Tampilan **Untuk WP ini** membaca KLU yang tersedia pada bagian registrasi paket. Untuk kode Z yang dikenali, tombol **Lihat di katalog DJP** membuka rujukan dari lampiran. Pengguna dapat memilih acuan lain selama sesi. Panduan penelusuran usaha disusun untuk prarilis ini. Cakupannya masih berbeda dari 254 profil khusus, analisis modus, hubungan dengan putusan dan pencocokan silang profil berbasis transaksi pada acuan.

**Uji KLU utama** menjumlahkan peredaran bruto atau penghasilan tahun pajak sebelumnya menurut kategori, lalu memilih golongan pokok, golongan, subgolongan, dan kelompok di dalam cabang terpilih. Masukkan kode kelompok KBLI 2020 atau KLU Z dan rupiah utuh untuk tiap kegiatan. Nominal besar tetap dihitung secara tepat. Layar menampilkan jumlah dan persentase tiap pilihan. Jika kode belum tersedia, pengguna masih dapat membandingkan nilai kegiatan berdasarkan nama. Penentuan berjenjang memerlukan kode kelompok. Kasus nilai seri, usaha yang belum berjalan, instansi pemerintah dan badan nirlaba mempunyai keterangan tersendiri. [PER-12/PJ/2022, Pasal 4 dan 5](https://www.pajak.go.id/id/peraturan/klasifikasi-lapangan-usaha-wajib-pajak-2)

Untuk golongan pokok 46 dan 47, perhitungan mengikuti cabang perdagangan dalam lampiran. Ambang 50% serta jumlah subgolongan dengan kontribusi sedikitnya 5% dihitung terhadap total golongan pokok terkait. Bila hasil mengarah ke perdagangan nonkhusus tetapi rincian kelompoknya belum tersedia, pengguna dapat melihat sampai tingkat mana data sudah mendukung klasifikasi. [Lampiran bagian B, halaman PDF 11–18](https://www.pajak.go.id/sites/default/files/lampiran/Lampiran%20PER_12_PJ_2022.pdf#page=11)

Uji contoh pertama menghasilkan **28221**. Angka untuk 28210 di tabel awal halaman 6 tertulis 21.000, sedangkan rincian halaman 7 dan 9 memakai 3.000, dalam jutaan rupiah. Uji menggunakan tabel rincian yang menghasilkan total 100.000. Contoh kedua menghasilkan **47420**. Rincian dua kegiatan dalam golongan 474 berjumlah 23.000 atau 23% dari total, meskipun tabel ringkasan pada halaman cetak 17 menuliskan 230.000. [Lampiran bagian B, mulai halaman PDF 6](https://www.pajak.go.id/sites/default/files/lampiran/Lampiran%20PER_12_PJ_2022.pdf#page=6)

Indeks awal peraturan memuat 84 entri metadata dari penelusuran katalog DJP pada 18 November 2026. Kolom status mencerminkan keterangan pada sumber saat pengambilan. Gunakan tautan naskah resmi untuk memeriksa perubahan berikutnya. Pengguna bisa menyaring nomor, judul, jenis, tanggal dan status, serta mengekspor hasil ke Excel, Word atau melalui dialog cetak PDF. Ringkasan hukum per pasal, riwayat aturan per masa pajak, dan pengaitan otomatis dengan program pemeriksaan masih terbuka. [Katalog dokumen peraturan DJP](https://www.pajak.go.id/id/peraturan)

Untuk membangun ulang katalog, jalankan `python3 scripts/build-kbli.py <pdf-2020> <pdf-2025>` dengan PyMuPDF dan Poppler, atau `python3 scripts/build-regulations.py` dengan Beautiful Soup dan curl untuk indeks DJP. Kedua proses ini hanya diperlukan pengembang saat memperbarui katalog. Jalankan `node --test tests/catalog.test.mjs` sesudahnya.
