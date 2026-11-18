# Katalog kegiatan dan peraturan

Kedua edisi KBLI dapat dicari saat komputer sedang offline. Kode disimpan sebagai teks supaya angka nol di depan tetap terbaca. Kode dan judul diambil dari sumber publik BPS. Seluruh isi katalog dibangun dari sumber ini secara terpisah dari ekstensi acuan.

| Edisi | Kategori | Golongan pokok | Golongan | Subgolongan | Kelompok |
| --- | ---: | ---: | ---: | ---: | ---: |
| KBLI 2020 | 21 | 88 | 245 | 567 | 1.789 |
| KBLI 2025 | 22 | 87 | 257 | 519 | 1.559 |

Sumber angka pembanding dan publikasi tersedia di [Kamus Pembakuan Statistik BPS](https://klasifikasi.web.bps.go.id/app/kbli), [publikasi BPS 2020](https://ppid.bps.go.id/upload/doc/Klasifikasi_Baku_Lapangan_Usaha_Indonesia_2020_1713495028.pdf) dan [Peraturan BPS Nomor 7 Tahun 2025](https://peraturan.go.id/files/peraturan-bps-no-7-tahun-2025.pdf).

Tampilan **Untuk WP ini** membaca KLU yang tersedia pada bagian registrasi paket. Pengguna dapat memilih acuan lain selama sesi. Panduan penelusuran usaha disusun untuk prarilis ini. Cakupannya masih berbeda dari 254 profil khusus, analisis modus, kode Z, hubungan dengan putusan, dan pencocokan silang profil berbasis transaksi pada acuan.

Uji KLU memakai angka rupiah utuh dan mempertahankan nilai besar. Gunakan kegiatan dari tahun pajak sebelumnya. Kasus nilai seri, kegiatan yang belum berjalan, instansi pemerintah dan badan nirlaba mempunyai perlakuan tersendiri. [PER-12/PJ/2022, Pasal 4 dan 5](https://www.pajak.go.id/id/peraturan/klasifikasi-lapangan-usaha-wajib-pajak-2)

Indeks awal peraturan memuat 84 entri metadata dari penelusuran katalog DJP pada 18 November 2026. Kolom status mencerminkan keterangan pada sumber saat pengambilan. Gunakan tautan naskah resmi untuk memeriksa perubahan berikutnya. Pengguna bisa menyaring nomor, judul, jenis, tanggal dan status, serta mengekspor hasil ke Excel, Word atau melalui dialog cetak PDF. Ringkasan hukum per pasal, riwayat aturan per masa pajak, dan pengaitan otomatis dengan program pemeriksaan masih terbuka. [Katalog dokumen peraturan DJP](https://www.pajak.go.id/id/peraturan)

Untuk membangun ulang katalog, jalankan `python3 scripts/build-kbli.py <pdf-2020> <pdf-2025>` dengan PyMuPDF dan Poppler, atau `python3 scripts/build-regulations.py` dengan Beautiful Soup dan curl untuk indeks DJP. Kedua proses ini hanya diperlukan pengembang saat memperbarui katalog. Jalankan `node --test tests/catalog.test.mjs` sesudahnya.
