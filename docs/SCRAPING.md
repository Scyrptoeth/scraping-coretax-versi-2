# Penarik data Coretax

Buka ekstensi melalui ikon Chrome. Pada bagian Penugasan, isi nama penarik dan daftar NPWP. NPWP 15 digit memperoleh awalan nol. Pilih masa, jenis SPT dan sumber. Pilihan peran, jenis surat, masa, sumber, SPT dan deduplikasi diingat. Formulir baru dimulai dengan identitas penarik, nomor penugasan dan daftar WP kosong.

## Mengambil sumber

Pada bagian **Cara menarik**, pilih satu WP pemilik dan kategori sumber, lalu cocokkan identitas serta masa pada tampilan atau berkas. Centang pernyataan pencocokan. Setiap penambahan memiliki pemilik dan cakupan periode sendiri.

- **Tabel di tab Coretax.** Pilih tab, klik **Daftar tabel di halaman**, pilih tabel, kemudian **Tambahkan tabel**. Tabel dan sel yang disembunyikan oleh halaman dikecualikan. Nama kolom dan teks sel dipertahankan. Untuk komponen yang belum terbaca, gunakan ekspor JSON/CSV yang disediakan aplikasi sumber.
- **Tabel berpaginasi.** Jika ekstensi menemukan tombol halaman berikut yang terhubung ke tabel secara jelas, buka **Ambil beberapa halaman** dan tentukan batas 1–100. Halaman yang sedang terbuka dihitung sebagai halaman pertama. Pembacaan berikutnya mensyaratkan kolom NPWP pemilik yang cocok untuk setiap baris. Ekstensi berhenti pada halaman terakhir, halaman berulang, perubahan NPWP atau perubahan tampilan yang menghalangi pencocokan. Gunakan jeda atau hentikan untuk mengakhiri pada batas halaman. Item yang sudah masuk tetap berada dalam antrean.
- **Berkas ekspor.** Pilih satu atau lebih JSON/CSV milik WP dan periode terpilih. CSV menerima koma, titik koma atau tab, termasuk nilai dengan tanda kutip dan baris baru. Seluruh nilai CSV disimpan sebagai teks. Respons JSON dengan objek `Payload` dipertahankan. Ekspor sederhana dibungkus dalam `Payload.Data`. Bila tersedia kolom identitas WP yang dikenali, isi yang bertentangan dengan WP pilihan ditolak. Untuk struktur sumber lain, pengguna mencocokkan identitas dan periode sebelum menambahkan.

Centang pernyataan kerahasiaan untuk membuka **Pratinjau WP** dan **Mulai tarik**. Pratinjau memperlihatkan jumlah sumber dan baris terpilih. Hilangkan centang WP yang ingin dilewati. Sumber di luar daftar WP, masa, jenis SPT, atau kategori terpilih dikecualikan. Deduplikasi memeriksa isi dari sumber dan jenis SPT yang sama dalam tarikan ini.

## Hasil, integritas dan retensi

Satu WP menghasilkan satu paket per tarikan. Perakitan menyimpan kemajuan setiap selesai satu WP. Tarikan yang dihentikan atau terputus setelah antreannya tersimpan dapat dilanjutkan dari halaman penarik. Hasil terbaru tampil pada kartu WP. Buka **Tarikan sebelumnya** untuk mengakses periode yang pernah disimpan. Gunakan **Unduh paket** untuk menyimpan ZIP atau mengunci paket dengan kata sandi minimal 10 karakter menjadi `.sedotax`. Setiap paket memiliki manifest, sidik jari, dan berita acara. Selisih jumlah baris yang dinyatakan sumber dan yang diterima ditampilkan pada kartu hasil.

**Buka di Analisis** membuat salinan serah terima terenkripsi dengan kunci sementara. Pemutar menghapus salinan itu setelah berhasil membacanya. Salinan kedaluwarsa setelah sepuluh menit dan dibersihkan saat halaman dibuka atau alarm ekstensi berjalan. Unduhan yang sudah disimpan pengguna berada di luar retensi ekstensi.

Enkripsi simpanan lokal mengubah hasil, antrean, dan rincian jejak audit yang sudah tersimpan menggunakan AES-GCM 256-bit dengan kunci turunan PBKDF2-SHA256 600.000 putaran. Kata sandi diperlukan kembali setelah halaman terkunci atau dimuat ulang. Tanggal, urutan peristiwa, dan metadata teknis retensi tersedia untuk pemeliharaan simpanan. Jejak audit tetap tersedia setelah penghapusan data WP. Retensi bawaan 90 hari dapat diatur menjadi 7–730 hari. Pembersihan diperiksa ketika halaman dibuka, saat Chrome dimulai dan setiap enam jam selama ekstensi berjalan.

## Matriks pembanding halaman penarik

Acuan lokal adalah VERITAX 1.32.0, khususnya `ekstensi-veritax/app.html` bagian 1–5, katalog label sumber, dan `PANDUAN.txt` baris 212–325. Pengujian browser memakai data fiktif. Status terverifikasi pada tabel berarti perilaku yang disebut teramati pada implementasi Versi 2 dan dapat dicocokkan dengan kontrak tertulis acuan. Perbandingan visual dan perilaku langsung dengan tab referensi serta Coretax produksi masih terbuka.

| Kemampuan | Status | Bukti atau selisih |
|---|---|---|
| Identitas penugasan, normalisasi NPWP, daftar teks, enam jenis SPT dan dua puluh sumber pilihan | Terverifikasi sebagian | Lima bagian utama dan dua puluh kontrol sumber dirender di Chromium. Normalisasi, duplikat, format salah, dan nol awal diuji. Versi 2 memakai nama petugas yang diisi manual. |
| Koneksi Coretax dan otorisasi penugasan | Berbeda | Indikator melaporkan keberadaan tab resmi. Nama akun dan status login tidak dibaca. Pratinjau dan perakitan mensyaratkan pernyataan kerahasiaan. |
| Penemuan WP, estimasi tarikan dan cakupan sumber | Berbeda | Pratinjau menghitung sumber dan baris yang disiapkan untuk tiap WP. Daftar WP yang belum punya data terlihat. Estimasi permintaan API, klasifikasi profil otomatis, dan penemuan SPT per WP belum tersedia. |
| Pengambilan, paginasi dan batas WP | Berbeda | Ada pembacaan tabel terpilih dan paginasi melalui tombol halaman berikut, pembatas halaman, jeda, penghentian dan pencocokan NPWP. Uji fixture mencakup batas pengguna, akhir tabel, tombol di luar paginator dan perpindahan WP. Navigasi produksi masih belum teruji. |
| Pembacaan otomatis profil, registrasi, dokumen, daftar/isi SPT per versi dan seluruh lampiran, buku besar serta bukti potong melalui katalog API VERITAX | Berbeda | Dua puluh pilihan mengklasifikasikan sumber yang dimasukkan pengguna. Versi ini mengambil tabel tampak atau ekspor. Pengambilan otomatis lewat seluruh titik akses referensi, rincian transaksi batal, dan pemilihan lampiran per masa belum tersedia. |
| Kecepatan jaringan adaptif, respons 403, pemulihan sesi, opsi jaga sesi, cache SPT per versi | Berbeda | Paginasi berjalan berurutan dan deduplikasi berlaku pada isi dalam satu tarikan. Antrean perakitan disimpan setiap selesai satu WP. Perilaku khusus sesi dan penjadwalan permintaan API referensi masih terbuka. |
| Pemisahan WP, kecocokan jumlah sumber, ekspor ZIP dan pemeriksaan integritas | Terverifikasi sebagian | Uji browser mengimpor dua salinan, mempratinjau dua WP, mengecualikan yang kosong, menyimpan satu berkas setelah deduplikasi dan membaca ulang ZIP dengan pemeriksaan hash. Selisih jumlah sumber diberi keterangan. Seluruh rangkaian pemeriksaan mutu asli belum dipetakan menjadi perhitungan yang sama. |
| Simpanan terenkripsi, buka kunci, dan log berantai | Terverifikasi sebagian | Uji browser memeriksa migrasi hasil dan jejak audit, kunci dan pembukaan ulang, penolakan sandi yang salah dan unduhan CSV dengan rantai utuh. |
| Buka hasil langsung di Analisis | Terverifikasi untuk data fiktif | Dari kartu WP, uji membuka Analisis, mencocokkan NPWP aktif dan memeriksa bahwa salinan terenkripsi sudah dihapus setelah berhasil dibaca. |
| Retensi terjadwal dan kesesuaian tampilan | Belum teruji di lingkungan operasional | Retensi memakai alarm Chrome. Observasi berjangka enam jam di profil pengguna belum dilakukan. Tata letak mengikuti urutan bagian formulir referensi dan menyesuaikan kontrol untuk sumber yang terlihat atau berkas ekspor. |

Uji unit dapat diulang dengan `node --test tests/scraper.test.mjs`. Untuk pengujian browser, jalankan `node tests/scraper-browser.mjs` dengan modul Playwright dan Chromium yang tersedia. Variabel `PLAYWRIGHT_MODULE` dan `CHROMIUM_PATH` dapat menunjuk instalasi lokal.
