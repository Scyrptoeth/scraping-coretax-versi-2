# Konsep surat dan berita acara

Di **Kertas Kerja → Berita acara**, peran **AR** dapat menyiapkan SP2DK dan BAP2DK. Pilih tahun pajak sebelum membuat konsep. SP2DK baru mengambil fakta paket dan butir kerja yang masih dalam pengujian. Baris membawa status berbukti atau indikatif dari sumbernya. Baris yang ditambahkan secara manual dimulai sebagai indikatif. Periksa uraian dan rujukan sebelum menetapkan status atau nilai penelitian.

SP2DK baru dimulai dengan pilihan **Berbukti + indikatif**. Untuk membatasi keluarannya, ubah **Temuan yang dimasukkan** menjadi **Berbukti saja**. Jika draf sudah berisi baris, aplikasi meminta konfirmasi sebelum menyusun ulang daftar dari sumbernya. Proses ini mengganti suntingan baris dan isian pembahasan. Uraian umum pada konsep tetap tersimpan. [Pemilihan dan penelaahan temuan](ANALISIS.md)

Saat membuat BAP2DK dari SP2DK, aplikasi membawa daftar data, sumber, nilai penelitian, pilihan cakupan serta identitas surat asal untuk WP dan tahun yang sama. Isikan tanggapan WP, angka sesudah pembahasan, dan jumlah yang disetujui sesuai hasil pertemuan. Ketiga isian tersebut dimulai kosong dan menerima angka nol jika petugas memang mengisinya.

Peran **Pemeriksa** dapat menyusun BAPK dan surat panggilan. Tambahkan pertanyaan secara manual atau gunakan usulan yang merujuk kegiatan usaha, pembetulan SPT, dan butir kertas kerja yang tersedia. Pilih pertanyaan yang akan tercetak. Unduhan Word berisi pertanyaan terpilih. Pada **Naskah tanpa jawaban**, bagian jawaban dikosongkan. Catatan internal dan ID pertanyaan tersedia pada lembar Excel **Kendali pertanyaan**. Untuk membawa jawaban yang telah diisi di Excel, buka **Impor jawaban dari Excel**. Pasangan jawaban dan pertanyaan mengikuti ID lokal.

Tombol **Unduh Word**, **Cetak / PDF**, dan **Unduh Excel** bekerja pada dokumen terpilih. Gunakan **Unduh berkas kerja** pada halaman Kertas Kerja untuk menyimpan draf dan memuatnya kembali pada sesi berikutnya.

### Cakupan perbandingan

Acuan fitur adalah panduan VERITAX v1.32.0, khususnya bagian Berita Acara dan pilihan temuan. Uji model mencakup peran, transfer data antardokumen, nilai kosong dan nol, pemilihan pertanyaan, catatan internal dan pencocokan jawaban Excel. Pada Chromium terisolasi, `tests/drafts-browser.mjs` menguji SP2DK ke BAP2DK, BAPK, impor jawaban XLSX dan isi unduhan DOCX. Uji `tests/findings-browser.mjs` memeriksa penyusunan ulang baris ketika petugas mengubah lingkup temuan dan memastikan uraian draf tetap terbaca.

Keluaran Word merupakan konsep lokal dengan tabel yang dapat disunting. Kesetaraan terhadap seluruh kolom baku lampiran, model surat, pilihan penandatanganan, bank pertanyaan sektoral, dan perhitungan tenggat resmi masih terbuka. Petugas mengisi penomoran, kesimpulan dan persetujuan substantif.
