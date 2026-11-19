# Scraping Coretax Versi 2

**Prarilis 0.18.2.** Setelah login di beranda Coretax, isi satu NPWP dan periode di ekstensi. **Mulai tarik** mencari WP dan membuka sumber pilihan di tab kerja. Di pemutar, Anda dapat memeriksa profil, SPT dan transaksi buku besar. Rincian mutu data menunjukkan sumber yang masih kurang.

[Unduh dan pasang melalui GitHub Pages](https://scyrptoeth.github.io/scraping-coretax-versi-2/) · [Situs Vercel](https://scraping-coretax-versi-2.vercel.app/) · [Paket prarilis GitHub](https://github.com/Scyrptoeth/scraping-coretax-versi-2/releases/tag/v0.18.2)

## Mencoba ekstensi

1. Unduh dan ekstrak ZIP. Buka `chrome://extensions`, aktifkan Mode developer, klik **Muat yang belum dipaketkan**, lalu pilih folder yang memuat `manifest.json`.
2. Buka beranda Coretax dan login di profil Chrome yang sama. Pada ekstensi, isi penugasan dan satu NPWP. Pilih periode, jenis SPT, serta sumber. Centang pernyataan kerahasiaan.
3. **Pratinjau WP** memperlihatkan WP dan versi SPT dalam periode pilihan. Anda juga dapat langsung memilih **Mulai tarik**. Untuk membaca formulir, sertakan **Induk dan lampiran SPT**. Periksa catatan sumber yang belum terbaca.
4. Pilih **Unduh paket** untuk menyimpan hasil atau **Buka di Analisis** untuk memeriksanya. Untuk paket yang sudah tersedia, buka **Buka Analisis**, lalu pilih berkas.
5. Periksa integritas, identitas dan cakupan sebelum membaca angka. Simpan isian kerja yang diperlukan sebelum menutup pemutar.

## Cakupan dan bukti

Prarilis ini dikembangkan secara mandiri dengan acuan VERITAX v1.32.0. Penarikan seluruh modul Coretax dalam satu perintah, kesetaraan seluruh UI, perhitungan fiskal, dan kelengkapan kertas kerja masih memerlukan pengembangan dan pembandingan.

Pemutar mencocokkan saldo buku besar dengan baris sumber per periode. Di **Kertas Kerja → KKA**, Anda dapat menelusuri angka potensi per jenis pajak sampai ke butir dan bukti yang mendasarinya. Lima tautan di Word membuka rekap potensi, perbandingan SPT, rasio, dan kemampuan membayar di Excel. [Hasil dan batas pengujian](docs/KESETARAAN.md#hasil-prarilis-0140)

- [Matriks kesetaraan dan sumber bukti](docs/KESETARAAN.md)
- [Penggunaan penarik, paginasi dan simpanan lokal](docs/SCRAPING.md)
- [Pemutar, profil WP, SPT dan kertas kerja](docs/ANALISIS.md)
- [Format ZIP, integritas serta enkripsi](docs/FORMAT.md)
- [Konsep dokumen dan berita acara](docs/KONSEP.md)
- [Sumber KLU, KBLI dan peraturan](docs/KATALOG.md)
- [Riwayat dan rekomendasi](docs/RIWAYAT.md)

## Menjalankan pemeriksaan

Jalankan `node --test tests/*.test.mjs` dari akar repo. Bangun paket dengan `python3 scripts/build-release.py`. Situs statis, ZIP, dan SHA-256 akan tersedia di `dist/site/`. Dengan Node 22+, Playwright dan Chrome for Testing, jalankan `node tests/release-browser.mjs` untuk memeriksa pemasangan ZIP di profil sementara. Gunakan `PLAYWRIGHT_MODULE` dan `CHROMIUM_PATH` jika instalasi alat berada di lokasi khusus. Pengujian dengan arsip referensi memerlukan empat paket contoh yang disimpan terpisah oleh pemiliknya.
