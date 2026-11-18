# Matriks kesetaraan terhadap VERITAX v1.32.0

Keterangan status per 18 November 2026. **Terverifikasi** berlaku untuk perilaku dan masukan yang disebutkan. **Berbeda** berarti ada selisih yang telah diketahui. **Belum teruji** berarti bukti pembandingan belum tersedia.

| Cakupan acuan | Status | Bukti dan batas pada prarilis |
| --- | --- | --- |
| Penugasan, pilihan WP, periode, sumber, kemajuan dan hasil | Berbeda | Lima bagian utama dan peran dapat digunakan. Pembacaan tabel dan impor membutuhkan pilihan pengguna. [Perincian kontrol](SCRAPING.md) |
| Satu penarikan otomatis untuk profil, registrasi, SPT, lampiran, faktur, bukti potong dan buku besar | Berbeda | Penarik menangani tabel terpilih dan ekspor. Jangkauan lintas modul dan jadwal permintaan acuan belum tercapai. [Sumber dan paginasi](SCRAPING.md) |
| Paginasi serta jeda, berhenti dan lanjut | Berbeda | Paginasi terarah menghentikan pembacaan pada batas, pengulangan atau perubahan WP yang terdeteksi. Sudah diuji pada tabel fiktif. [Batas cakupan](SCRAPING.md) |
| Paket per WP, ZIP, daftar hash dan berita acara | Terverifikasi | Empat contoh acuan dengan 2.003 berkas data lolos pemeriksaan integritas. Satu paket keluaran Versi 2 diuji kembali pada pemutar Versi 2. [Format paket](FORMAT.md) |
| Penerimaan paket keluaran Versi 2 oleh VERITAX asli | Belum teruji | Bukti impor empat contoh hanya membuktikan arah acuan ke Versi 2. |
| Kunci simpanan, retensi dan log | Berbeda | Enkripsi dan pembukaan simpanan, pelepasan salinan sementara, retensi dan rantai log tersedia. Pengujian sandi memakai data sintetis. [Perincian](SCRAPING.md) |
| Pengalihan dari penarik ke pemutar | Terverifikasi | Penarik mengirim hasil WP fiktif ke pemutar. WP aktif sesuai dan salinan sementara terhapus sesudah dibaca. |
| Sembilan tab, peran, pencarian cepat, tema dan pintasan | Berbeda | Penampil dan peramban mendukung navigasi, peran, tampilan dan pencarian. Kedalaman pencarian dan navigasi ke formulir belum lengkap. [Pemutar](ANALISIS.md) |
| Dasbor Badan dan OP, PPN, keuangan, potput, rasio, pemeriksaan lanjutan | Berbeda | Ada ringkasan data yang tersedia. Kelengkapan analisis sektoral, pengujian lintas sumber dan perhitungan fiskal acuan masih terbuka. |
| Profil WP, daftar SPT, pembetulan, formulir dan data mentah | Berbeda | Uji mencakup pembetulan PPN, nilai nol, kolom kosong, pencarian, pengurutan dan ekspor. Keseluruhan bagian profil dan tata letak formulir belum setara. [Perincian](ANALISIS.md) |
| Penelusuran KBLI 2020 dan 2025 | Terverifikasi | Kedua hierarki publik sesuai jumlah resmi BPS. Uji pemasangan ZIP membuka pencarian dan rincian kode pada pemutar. [Katalog](KATALOG.md) |
| Profil Probis, acuan WP, sinyal usaha, kode Z, uji KLU dan putusan | Berbeda | Ada KLU paket, pilihan acuan sesi, uji omzet dan panduan umum. 254 profil serta keterkaitan putusan dan sinyal lintas data belum setara. |
| Peraturan | Berbeda | 84 entri metadata DJP awal dapat ditelusuri dan diekspor. Cakupan seluruh korpus, isi pokok, serta peta waktu dan pengujian masih terbuka. |
| KKP SE-08, KKA ND-306, lingkup temuan, simulasi sanksi | Berbeda | Kertas kerja manual, beberapa fakta sumber dan selisih nilai tersedia. Indeks, rumus, pemilihan seluruh temuan dan simulasi sanksi acuan belum direproduksi lengkap. [Kertas kerja](ANALISIS.md) |
| Konsep SP2DK, BAP2DK, BAPK dan surat panggilan | Berbeda | Alur konsep, pertanyaan, jawaban dan unduhan diuji dengan data fiktif. Format resmi, bank pertanyaan sektor dan tenggat belum lengkap. [Konsep](KONSEP.md) |
| Penyimpanan berkas kerja, kerja tim, bantuan, pembaruan aturan dan alat analisis tambahan | Berbeda | Unduh dan impor isian kerja tersedia. Pembaruan korpus, alat pengembang dan kesetaraan seluruh alur kolaborasi masih terbuka. |
| UI terpasang VERITAX dan sesi produksi Coretax | Belum teruji | Pemeriksaan acuan memakai HTML distribusi dan screenshot di buku panduan. Akses ke dua tab ekstensi rujukan pada profil Chrome pengguna dibatasi oleh alat. Belum ada verifikasi penarikan produksi. |

Sumber lokal pembanding meliputi dua halaman HTML pada paket rujukan, panduan teks, empat arsip demo dan buku panduan PDF 68 halaman. SHA-256 buku panduan adalah `6cd53e140e6ba701a8e4ff73232144d5205a8e5ca8ac18c5e04733d3a6804e69`. Hash HTML penarik adalah `1071d1ba84b0d71fe55fdacd9665163c38749b033eae881c1fb77e14d290b017`. Hash HTML pemutar adalah `e134522148824eaa7e5bb5a8233825671cd88a5dfc60548682f823cc7ef1ad81`.
