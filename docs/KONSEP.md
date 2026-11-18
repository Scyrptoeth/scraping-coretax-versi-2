# Konsep surat dan berita acara

Di **Kertas Kerja → Berita acara**, peran **AR** dapat menyiapkan SP2DK dan BAP2DK. Pilih tahun pajak sebelum membuat konsep. SP2DK dapat memakai butir kertas kerja dan fakta dari paket. Periksa setiap uraian dan rujukan. Status awal butir yang diusulkan adalah *indikatif*. Petugas dapat menambah baris, menyuntingnya, menetapkan status berdasarkan bukti, dan memilih **Berbukti saja** atau **Berbukti + indikatif**.

Saat membuat BAP2DK dari SP2DK, aplikasi membawa daftar data, sumber, nilai penelitian, pilihan cakupan serta identitas surat asal untuk WP dan tahun yang sama. Isikan tanggapan WP, angka sesudah pembahasan, dan jumlah yang disetujui sesuai hasil pertemuan. Ketiga isian tersebut dimulai kosong dan menerima angka nol jika petugas memang mengisinya.

Peran **Pemeriksa** dapat menyusun BAPK dan surat panggilan. Tambahkan pertanyaan secara manual atau gunakan usulan yang merujuk kegiatan usaha, pembetulan SPT, dan butir kertas kerja yang tersedia. Pilih pertanyaan yang akan tercetak. Unduhan Word berisi pertanyaan terpilih. Pada **Naskah tanpa jawaban**, bagian jawaban dikosongkan. Catatan internal dan ID pertanyaan tersedia pada lembar Excel **Kendali pertanyaan**. Untuk membawa jawaban yang telah diisi di Excel, buka **Impor jawaban dari Excel**. Pasangan jawaban dan pertanyaan mengikuti ID lokal.

Tombol **Unduh Word**, **Cetak / PDF**, dan **Unduh Excel** bekerja pada dokumen terpilih. Gunakan **Unduh berkas kerja** pada halaman Kertas Kerja untuk menyimpan draf dan memuatnya kembali pada sesi berikutnya.

### Cakupan perbandingan

Acuan fitur adalah panduan VERITAX v1.32.0, khususnya bagian Berita Acara dan pilihan temuan. Uji model mencakup peran, transfer data antardokumen, data yang tetap kosong, pemilihan pertanyaan, pemisahan catatan internal, dan pencocokan jawaban Excel. Pada Chromium terisolasi, `tests/drafts-browser.mjs` menguji SP2DK ke BAP2DK, lalu membuat BAPK, mengimpor jawaban dari XLSX, dan memeriksa isi unduhan DOCX. Keluaran Word merupakan konsep lokal dengan tabel yang dapat disunting. Kesetaraan terhadap seluruh kolom baku lampiran, seluruh model surat, pilihan penandatanganan, bank pertanyaan sektoral, dan perhitungan tenggat resmi belum terverifikasi. Penomoran, kesimpulan, dan persetujuan substantif diisi oleh petugas.
