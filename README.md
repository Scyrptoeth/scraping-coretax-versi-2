# Scraping Coretax Versi 2

**Prarilis 0.5.1.** Setiap tarikan memakai satu NPWP. Pilih satu atau beberapa tabel untuk WP itu di tab Coretax yang sudah terbuka, atau tambahkan ekspor JSON/CSV. Pemutar lokal membantu mencocokkan baris, membandingkan SPT dan memilih temuan untuk kertas kerja. Beberapa paket yang sudah disimpan dapat dibuka untuk perbandingan.

[Unduh dan pasang melalui GitHub Pages](https://scyrptoeth.github.io/scraping-coretax-versi-2/) · [Situs Vercel](https://scraping-coretax-versi-2.vercel.app/) · [Paket prarilis GitHub](https://github.com/Scyrptoeth/scraping-coretax-versi-2/releases/tag/v0.5.1)

## Mencoba ekstensi

1. Unduh dan ekstrak ZIP. Buka `chrome://extensions`, aktifkan Mode developer, klik **Muat yang belum dipaketkan**, lalu pilih folder yang memuat `manifest.json`.
2. Buka ekstensi. Isi penugasan dan WP, pilih periode serta sumber, kemudian tambahkan tabel yang terlihat atau berkas ekspor untuk satu WP. Konfirmasikan pilihan dan mulai penarikan.
3. Pilih **Unduh paket** untuk menyimpan hasil atau **Buka di Analisis** untuk memeriksanya. Untuk paket yang sudah tersedia, buka **Buka Analisis**, lalu pilih berkas.
4. Periksa integritas, identitas dan cakupan sebelum membaca angka. Simpan isian kerja yang diperlukan sebelum menutup pemutar.

## Cakupan dan bukti

Prarilis ini dikembangkan secara mandiri dengan acuan VERITAX v1.32.0. Penarikan seluruh modul Coretax dalam satu perintah, kesetaraan seluruh UI, perhitungan fiskal, dan kelengkapan kertas kerja masih memerlukan pengembangan dan pembandingan.

- [Matriks kesetaraan dan sumber bukti](docs/KESETARAAN.md)
- [Penggunaan penarik, paginasi dan simpanan lokal](docs/SCRAPING.md)
- [Pemutar, profil WP, SPT dan kertas kerja](docs/ANALISIS.md)
- [Format ZIP, integritas serta enkripsi](docs/FORMAT.md)
- [Konsep dokumen dan berita acara](docs/KONSEP.md)
- [Sumber KLU, KBLI dan peraturan](docs/KATALOG.md)
- [Riwayat dan rekomendasi](docs/RIWAYAT.md)

## Menjalankan pemeriksaan

Jalankan `node --test tests/*.test.mjs` dari akar repo. Bangun paket dengan `python3 scripts/build-release.py`. Situs statis, ZIP, dan SHA-256 akan tersedia di `dist/site/`. Dengan Node 22+, Playwright dan Chrome for Testing, jalankan `node tests/release-browser.mjs` untuk memeriksa pemasangan ZIP di profil sementara. Gunakan `PLAYWRIGHT_MODULE` dan `CHROMIUM_PATH` jika instalasi alat berada di lokasi khusus. Pengujian dengan arsip referensi memerlukan empat paket contoh yang disimpan terpisah oleh pemiliknya.
