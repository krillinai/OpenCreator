<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../images/OpenCreator_logo_vector_dark.svg" />
    <img src="../images/OpenCreator_logo_vector.svg" alt="OpenCreator" width="380" />
  </picture>
  <br />
  Ruang kerja AI sumber terbuka & Skills untuk kreator
</h1>

<p>Gabungkan alat kreasi visual, Skills yang dapat digunakan kembali, dan Agent untuk naskah, video, gambar, suara, avatar, penerjemahan, dan penyuntingan—semuanya dalam satu ruang kerja.</p>

<p><strong>OpenCreator sebelumnya bernama KrillinAI.</strong></p>

<a href="https://trendshift.io/repositories/13360" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13360" alt="OpenCreator (sebelumnya KrillinAI): Repositori Terbaik Hari Ini peringkat 1 di Trendshift" width="250" height="55" /></a>

[English](../../README.md) | [简体中文](../zh/README.md) | [日本語](../ja/README.md) | [한국어](../ko/README.md) | **Bahasa Indonesia** | [Español](../es/README.md) | [Français](../fr/README.md) | [Deutsch](../de/README.md) | [Português](../pt/README.md) | [Русский](../ru/README.md) | [العربية](../ar/README.md) | [ภาษาไทย](../th/README.md) | [Türkçe](../tr/README.md) | [हिन्दी](../hi/README.md) | [বাংলা](../bn/README.md) | [اردو](../ur/README.md) | [Tiếng Việt](../vi/README.md) | [Filipino](../fil/README.md)

[![GitHub Stars](https://badgen.net/github/stars/krillinai/OpenCreator?icon=github&label=Stars&color=EAB308)](https://github.com/krillinai/OpenCreator/stargazers)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Bilibili](https://img.shields.io/badge/dynamic/json?label=Bilibili&query=%24.data.follower&suffix=%E7%B2%89%E4%B8%9D&url=https%3A%2F%2Fapi.bilibili.com%2Fx%2Frelation%2Fstat%3Fvmid%3D242124650&logo=bilibili&color=00A1D6&labelColor=FE7398&logoColor=FFFFFF)](https://space.bilibili.com/242124650)
[![AtomGit G-Star](https://img.shields.io/badge/AtomGit-G--Star-DA203E?style=flat)](https://atomgit.com/krillinai/OpenCreator)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/fUNvbqDaw)
[![Grup QQ](https://img.shields.io/badge/QQ%20群-754069680-green?logo=tencent-qq)](https://qm.qq.com/q/W4YC0PLMeA)

[Sorotan](#sorotan-proyek) · [Alat](#alat-kreasi) · [Skills](#skills) · [Contoh](#contoh) · [Mulai](#mulai-cepat) · [Desktop](#desktop) · [Dokumen](#dokumentasi) · [Komunitas](#komunitas)

</div>

![Ruang kerja Agent OpenCreator](../images/opencreator-home-en.png)

## Ikhtisar Proyek

OpenCreator dibuat untuk individu dan tim yang ingin menjalankan pekerjaan kreatif dan pengembangan secara lokal. Alih-alih mengimplementasikan ulang loop Agent, OpenCreator menggunakan Codex CLI sebagai mesin eksekusi dan menambahkan Runtime lokal yang stabil, ruang kerja visual, serta host Desktop di sekelilingnya.

OpenCreator menyediakan dua cara kerja yang saling terhubung:

- **Ruang kerja konten**: gunakan alat visual dan templat kreasi untuk menerjemahkan dan mengunduh video, membuat thumbnail dan gambar, serta mengerjakan kreasi lainnya.
- **Percakapan Agent**: mulai dan arahkan tugas kreatif atau pengembangan dengan bahasa alami, atur percakapan berdasarkan proyek, biarkan Runs tetap berjalan di latar belakang, dan kelola persetujuan, lampiran, file, Skills, MCP, jadwal, notifikasi, memori, serta diagnostik dari satu tempat.

Web adalah satu-satunya implementasi frontend. Desktop memuat build Web yang sama dan hanya menambahkan kemampuan yang memerlukan sistem operasi, seperti pemilihan direktori, siklus hidup jendela, perilaku baki sistem, dan notifikasi native. Dengan data dan viewport konten yang sama, kedua platform menggunakan UI umum dan perilaku Runtime yang sama.

## Sorotan Proyek

- 🤖 **Native Codex**: gunakan kembali loop Agent, model, penalaran, pemanggilan alat, percakapan, Skills, dan MCP dari Codex tanpa memelihara mesin eksekusi kedua.

- 🚀 **Aplikasi Desktop Siap Pakai**: jalankan OpenCreator langsung dari aplikasi Desktop yang sudah menyertakan Codex CLI; Runtime lokal dimulai sesuai kebutuhan dan menyiapkan proyek default secara otomatis.

- ⚙️ **Deteksi Konfigurasi Codex Lokal**: saat Desktop pertama kali dibuka, konfigurasi Codex yang ada diperiksa agar login ChatGPT atau API key yang siap digunakan dapat dipakai kembali. Penyedia model lain juga dapat diatur melalui panduan awal.

- 🔄 **Komponen Runtime Terkelola**: lihat versi yt-dlp bawaan, aktif, dan terbaru, periksa pembaruan secara berkala, lalu perbarui secara manual sambil mempertahankan versi yang sedang berfungsi jika pembaruan gagal.

- 🎨 **Kreasi Multimodal**: buat dan kelola video, gambar, audio, subtitel, dan dokumen melalui satu alur kerja yang terhubung.

- 🧩 **Templat Kreasi**: buat gambar dan video dari templat yang dapat digunakan kembali tanpa menyiapkan prompt dan pengaturan dari awal.

- 🔗 **Alur Kerja Dua Mode**: bekerja melalui ruang kerja visual atau percakapan Agent, sementara satu mesin status bersama menjaga langkah, progres, dan hasil tetap tersinkronisasi.

- 🕘 **Pengelolaan Versi**: setiap revisi membuat versi baru sambil mempertahankan pengaturan dan hasil sebelumnya untuk ditinjau dan dibandingkan.

- 🧩 **Skills yang dapat digunakan kembali**: gunakan Skills alur kerja video, perluas kemampuan Agent dengan Skills sendiri, dan kelola MCP melalui konfigurasi native Codex.

- 🧠 **Memori**: simpan memori global, proyek, dan thread beserta ringkasan dan snapshot input Run yang dapat direproduksi.

- 🔐 **Keamanan Lokal**: simpan data, lampiran, dan log secara lokal secara default, dengan persetujuan dan diagnostik yang telah menyamarkan informasi sensitif.

- 🌐 **Antarmuka multibahasa**: Web dan Desktop mendukung 43 bahasa, deteksi bahasa sistem, pilihan manual, serta tata letak kanan ke kiri untuk bahasa Arab, Persia, Urdu, dan Ibrani.

## Alat Kreasi

Rilis saat ini mencakup enam alat kreasi. Model dan layanan yang tersedia bergantung pada lingkungan Codex lokal dan pengaturan layanan AI Anda.

Buka Dashboard untuk menerjemahkan atau mengunduh video, membuat thumbnail atau gambar, menghasilkan sulih suara dengan Text to Speech, atau membuat video dengan Seedance.

![Dashboard Kreasi OpenCreator](../images/product/opencreator-dashboard-en.png)

> Alat kreasi baru terus ditambahkan.

**Terjemahan video menyediakan 123 bahasa sumber dan 124 opsi target, termasuk keluaran Pinyin.** Cari dengan nama asli, nama Inggris, nama Mandarin, atau kode bahasa. Cakupan pengenalan dan sintesis suara bergantung pada layanan dan model yang dipilih.

- **Terjemahan subtitle saja**: Impor dan pratinjau SRT, lalu terjemahkan tanpa video sumber, sulih suara, atau rendering video.

- **Penyuntingan subtitle lanjutan**: Gunakan editor imersif dengan gelombang audio dan lini masa yang mengikuti pemutaran untuk mengatur waktu, memisahkan atau menggabungkan subtitle, serta mencari dan mengganti teks. Pratinjau gaya pada video, ubah bahasa, suara, dan keluaran, lalu buat versi baru tanpa menghapus hasil sebelumnya.

- **Pembuatan satu halaman**: Atur pembuatan gambar, video, dan Text to Speech dalam satu halaman, dengan pemilihan model, pratinjau referensi, opsi gambar sesuai model, dan pustaka suara yang dapat dicari.

- **Keluaran multibahasa dan progres**: Font cadangan bawaan meningkatkan rendering aksara kompleks dan subtitle kanan ke kiri. Pantau progres transkripsi, terjemahan, sulih suara, dan rendering beserta jumlah selesai dan total jika tersedia.

<table width="100%">
<thead>
<tr>
<th width="18%">Alat kreasi</th>
<th width="14%">Status</th>
<th width="68%">Kemampuan</th>
</tr>
</thead>
<tbody>
<tr><td valign="top">Penerjemahan Video</td><td valign="top">✅ Tersedia</td><td>Impor video lokal atau publik; transkripsikan dengan layanan Whisper cloud atau lokal; gunakan konteks LLM untuk segmentasi dan penyelarasan subtitel, pengelolaan istilah, dan penerjemahan; atur subtitel dwibahasa, sulih suara atau sampel suara khusus, gaya subtitel, komposisi lanskap atau potret, lalu ekspor SRT, audio, atau video</td></tr>
<tr><td valign="top">Pengunduh Video</td><td valign="top">✅ Tersedia</td><td>Analisis video publik individual dari YouTube, Bilibili, X, TikTok, Instagram, Douyin, Facebook, Xiaohongshu, Pinterest, dan Reddit; bandingkan format yang tersedia dan unduh video atau audio. Beberapa platform mungkin memerlukan cookie. Jika platform menyediakan subtitle, lihat daftarnya dan unduh SRT; bahasa Inggris ditampilkan lebih dahulu, lalu bahasa antarmuka jika tersedia.</td></tr>
<tr><td valign="top">Pembuatan Thumbnail</td><td valign="top">✅ Tersedia</td><td>Gabungkan topik, tautan video, dan gambar referensi opsional untuk membuat dan membandingkan beberapa variasi thumbnail konten</td></tr>
<tr><td valign="top">Pembuatan Gambar</td><td valign="top">✅ Tersedia</td><td>Buat gambar dengan GPT Image / Seedream / Kling Image / Gemini dari prompt dan gambar referensi opsional, atur rasio aspek dan jumlah hasil, lalu pratinjau dan unduh setiap gambar</td></tr>
<tr><td valign="top">Penulis Artikel</td><td valign="top">✅ Tersedia</td><td>Ubah topik, tautan, video, atau dokumen menjadi pilihan tema, kerangka, dan artikel yang dapat diedit; tambahkan gambar dan ekspor Markdown, HTML, atau PDF.</td></tr>
<tr><td valign="top">Posting Xiaohongshu</td><td valign="top">✅ Tersedia</td><td>Buat posting dari topik atau bahan sumber dengan pilihan audiens, jenis posting, dan panjang, lalu salin atau unduh hasilnya.</td></tr>
<tr><td valign="top">Naskah Video Pendek</td><td valign="top">✅ Tersedia</td><td>Buat naskah per segmen siap produksi dari topik atau bahan sumber sesuai audiens, platform, durasi, dan gaya; edit atau ekspor hasilnya.</td></tr>
<tr><td valign="top">Animasi Figur Stik</td><td valign="top">✅ Tersedia</td><td>Ubah teks atau konten YouTube menjadi narasi, suara, visual storyboard dengan karakter konsisten, subtitle, dan animasi figur stik yang dapat diunduh.</td></tr>
<tr><td valign="top">Klip Otomatis</td><td valign="top">Dalam pengembangan</td><td>Analisis video panjang, temukan sorotan, dan ubah bagian terpilih menjadi klip pendek yang dapat digunakan kembali</td></tr>
<tr><td valign="top">Text to Speech</td><td valign="top">✅ Tersedia</td><td>Ubah naskah menjadi sulih suara dengan pilihan suara, tempo, dan kontrol emosi</td></tr>
<tr><td valign="top">Pembuatan Video</td><td valign="top">✅ Tersedia</td><td>Buat video dengan Seedance / Kling / Veo dari prompt dan gambar referensi, lalu pratinjau, buat ulang, atau unduh setiap versi</td></tr>
<tr><td valign="top">Avatar Digital</td><td valign="top">Dalam pengembangan</td><td>Gabungkan naskah, suara, dan presentasi avatar untuk membuat video berbicara</td></tr>
</tbody>
</table>

## Templat Kreasi

Mulai berkarya dari templat tanpa harus menyusun prompt dan pengaturan dari awal. Jelajahi templat unggulan berdasarkan kategori, termasuk kreasi video dan desain gambar.

Koleksi ini memadukan templat buatan OpenCreator dan kreator independen. Untuk templat dari pihak ketiga, halaman detail mencantumkan pembuat dan tautan ke sumber aslinya.

Buka templat untuk melihat contoh hasil, prompt, pengaturan, tag, pembuat, dan sumber aslinya. Pilih **Gunakan templat ini** untuk langsung memulai kreasi, lalu sesuaikan input sesuai kebutuhan.

![Detail templat kreasi gambar dengan contoh hasil, pengaturan, dan prompt](../images/product/creation-templates-detail-apex-summit-en.png)

## Skills

Alat kreasi menyediakan kontrol visual; Skills memberi Agent instruksi dan alur kerja alat yang dapat digunakan kembali. OpenCreator menyertakan Skills produksi video di repositori serta mendukung pengelolaan Skills lokal Codex.

Direktori [`skills/`](../../skills/) di repositori berisi instruksi yang dapat digunakan kembali oleh Agent untuk menjalankan KrillinAI CLI yang terintegrasi.

| Skill | Kemampuan |
| --- | --- |
| [KrillinAI CLI](../../skills/krillinai-cli/SKILL.md) | Memilih perintah, memeriksa konfigurasi, serta memahami progres, manifes, keluaran, dan kesalahan |
| [Subtitle](../../skills/krillinai-subtitle/SKILL.md) | Mengunduh subtitle platform atau mentranskripsikan media, menerjemahkan subtitle, dan menghasilkan subtitle dwibahasa atau subtitle pendek untuk video vertikal |
| [TTS](../../skills/krillinai-tts/SKILL.md) | Menghasilkan sulih suara bahasa target dari subtitle dan secara opsional membuat video dengan sulih suara |
| [Render horizontal](../../skills/krillinai-render-horizontal/SKILL.md) | Merender video horizontal dengan subtitle dwibahasa atau audio sulih suara dan subtitle bahasa target |
| [Render vertikal](../../skills/krillinai-render-vertical/SKILL.md) | Menyusun video vertikal dengan judul, subtitle dwibahasa, atau sulih suara |
| [Sampul](../../skills/krillinai-cover/SKILL.md) | Menghasilkan gambar sampul dari prompt teks lengkap serta menyimpan gambar dan prompt akhir |
| [Perencanaan pipeline](../../skills/krillinai-pipeline/SKILL.md) | Memvalidasi rencana keluaran beberapa tahap dalam mode dry-run; menjalankan pekerjaan nyata melalui Skills masing-masing tahap |

### Perluas dengan Skills sendiri

OpenCreator mendukung Skills lokal Codex yang didefinisikan melalui `SKILL.md`, sehingga Anda dapat menambahkan metode dan alur kerja sendiri tanpa hanya bergantung pada alat kreasi tetap. Ketersediaan Skills bergantung pada Codex home yang aktif dan Skills yang terpasang; Skills video memerlukan konfigurasi CLI dan layanan terkait. Adanya Skill di repositori tidak berarti Skill tersebut otomatis terpasang atau semua layanan eksternal disertakan.

## Percakapan dan ruang kerja, bergerak bersama

Jelaskan tugas secara alami, lalu beralih ke alat visual saat Anda memerlukan kontrol yang presisi.

Penyedia dan model yang ditampilkan adalah contoh; ketersediaan nyata bergantung pada kredensial, akses akun penyedia, dan platform.

### Kontrol ruang kerja yang terperinci

Sesuaikan subtitel, shot, audio, dan pengaturan pembuatan secara presisi.

### Pengeditan percakapan yang fleksibel

Beri tahu Agent apa yang perlu diubah dan sempurnakan hasilnya dengan bahasa alami.

### Status tersinkronisasi

Percakapan dan ruang kerja berbagi status tugas saat ini, sehingga tidak perlu mengulang penjelasan.

### Versi independen

Setiap revisi membuat versi terpisah tanpa menimpa hasil atau pengaturan sebelumnya.

## Model yang Didukung

Ketersediaan model bahasa mengikuti katalog model Codex atau penyedia kompatibel OpenAI yang Anda gunakan. Model gambar, video, suara, dan transkripsi menggunakan layanan yang dikonfigurasi di **Pengaturan → Layanan AI**.

Tabel berikut menampilkan preset penyedia dan model yang direkomendasikan; ketersediaan nyata bergantung pada kredensial, akses akun penyedia, dan platform.

### Model bahasa

<table>
<tr>
<td align="center" width="20%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>GPT</strong></td>
<td align="center" width="20%"><img src="../images/models/deepseek.png" alt="DeepSeek" width="40" height="40" /><br /><strong>DeepSeek</strong></td>
<td align="center" width="20%"><img src="https://github.com/QwenLM.png?size=80" alt="Qwen" width="40" height="40" /><br /><strong>Qwen</strong></td>
<td align="center" width="20%"><img src="https://github.com/MoonshotAI.png?size=80" alt="Kimi" width="40" height="40" /><br /><strong>Kimi</strong></td>
<td align="center" width="20%"><img src="https://github.com/zai-org.png?size=80" alt="Z.ai" width="40" height="40" /><br /><strong>GLM</strong></td>
</tr>
<tr>
<td align="center" width="20%"><img src="https://github.com/xai-org.png?size=80" alt="xAI" width="40" height="40" /><br /><strong>Grok</strong></td>
<td align="center" width="20%"><img src="../images/models/doubao.svg" alt="Doubao" width="40" height="40" /><br /><strong>Doubao</strong></td>
<td align="center" width="20%"><img src="../images/models/ernie.png" alt="ERNIE" width="40" height="40" /><br /><strong>ERNIE</strong></td>
<td align="center" width="20%"><img src="https://github.com/Tencent-Hunyuan.png?size=80" alt="Tencent Hunyuan" width="40" height="40" /><br /><strong>Hunyuan</strong></td>
<td align="center" width="20%"><img src="https://github.com/MiniMax-AI.png?size=80" alt="MiniMax" width="40" height="40" /><br /><strong>MiniMax</strong></td>
</tr>
</table>

### Gambar

<table>
<tr>
<td align="center" width="25%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>GPT Image</strong></td>
<td align="center" width="25%"><img src="../images/models/jimeng.png" alt="Jimeng" width="40" height="40" /><br /><strong>Seedream 4.0</strong><br />Jimeng</td>
<td align="center" width="25%"><img src="../images/models/kling.png" alt="Kling" width="40" height="40" /><br /><strong>Kling v2.1</strong><br />Kling Image</td>
<td align="center" width="25%"><img src="../images/models/gemini.png" alt="Gemini" width="40" height="40" /><br /><strong>Nano Banana</strong><br />Gemini 2.5 Flash Image</td>
</tr>
</table>

### Video

<table>
<tr>
<td align="center" width="33%"><img src="../images/models/seedance.png" alt="Seedance" width="40" height="40" /><br /><strong>Seedance 2.5</strong></td>
<td align="center" width="33%"><img src="../images/models/kling.png" alt="Kling" width="40" height="40" /><br /><strong>Kling v2.1 Master</strong></td>
<td align="center" width="33%"><img src="../images/models/gemini.png" alt="Gemini" width="40" height="40" /><br /><strong>Veo 3.1</strong></td>
</tr>
</table>

### Suara dan transkripsi

<table>
<tr>
<td align="center" width="16%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>Whisper</strong></td>
<td align="center" width="16%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>OpenAI TTS</strong></td>
<td align="center" width="16%"><img src="https://github.com/MiniMax-AI.png?size=80" alt="MiniMax" width="40" height="40" /><br /><strong>MiniMax</strong></td>
<td align="center" width="16%"><img src="https://github.com/microsoft.png?size=80" alt="Microsoft" width="40" height="40" /><br /><strong>Edge TTS</strong></td>
<td align="center" width="16%"><img src="https://github.com/aliyun.png?size=80" alt="Alibaba Cloud" width="40" height="40" /><br /><strong>Aliyun Speech</strong></td>
<td align="center" width="16%"><img src="https://github.com/volcengine.png?size=80" alt="Volcengine" width="40" height="40" /><br /><strong>Volcengine Speech</strong></td>
</tr>
</table>

Transkripsi lokal juga mendukung faster-whisper, WhisperKit, dan whisper.cpp pada platform yang sesuai.

## Contoh

### Penerjemahan Video

Contoh publik di bawah ini dibuat saat OpenCreator masih bernama KrillinAI. Contoh tersebut menunjukkan alur kerja penyelarasan subtitel, penerjemahan, sulih suara, dan video potret yang telah teruji dan kini dibawa oleh ruang kerja Penerjemahan Video OpenCreator ke dalam alur Agent yang lebih luas.

Proyek ini menghasilkan file subtitel di bawah dari video lokal berdurasi 46 menit dalam satu kali proses, tanpa penyesuaian subtitel secara manual. Hasil yang dipublikasikan mencakup seluruh bagian, tanpa baris yang tumpang tindih, dengan segmentasi alami dan terjemahan berkualitas tinggi.

![Contoh penyelarasan subtitel OpenCreator](../images/examples/krillinai-subtitle-alignment.png)

<table width="100%">
<tr>
<td width="33%">

#### Terjemahan Subtitel

https://github.com/user-attachments/assets/bba1ac0a-fe6b-4947-b58d-ba99306d0339

</td>
<td width="33%">

#### Sulih Suara

https://github.com/user-attachments/assets/0b32fad3-c3ad-4b6a-abf0-0865f0dd2385

</td>
<td width="33%">

#### Mode Potret

https://github.com/user-attachments/assets/c2c7b528-0ef8-4ba9-b8ac-f9f92f6d4e71

</td>
</tr>
</table>

> Contoh video dan gambar penyelarasan subtitel ini dibuat saat OpenCreator masih menggunakan nama KrillinAI.

### Pengunduh Video

Analisis tautan video publik dari 10 platform yang didukung, bandingkan format yang tersedia, lalu unduh video atau audio langsung ke proyek.

Sumber video yang didukung:

<table align="center">
  <tr>
    <td align="center" width="48"><img src="../images/platforms/youtube.png" alt="YouTube" width="24" height="24" /><br /><small><small>YouTube</small></small></td>
    <td align="center" width="48"><img src="../images/platforms/bilibili.png" alt="Bilibili" width="24" height="24" /><br /><small><small>Bilibili</small></small></td>
    <td align="center" width="48"><img src="../images/platforms/x.png" alt="X" width="24" height="24" /><br /><small><small>X</small></small></td>
    <td align="center" width="48"><img src="../images/platforms/tiktok.png" alt="TikTok" width="24" height="24" /><br /><small><small>TikTok</small></small></td>
    <td align="center" width="48"><img src="../images/platforms/instagram.png" alt="Instagram" width="24" height="24" /><br /><small><small>Instagram</small></small></td>
    <td align="center" width="48"><img src="../images/platforms/douyin.png" alt="Douyin" width="24" height="24" /><br /><small><small>Douyin</small></small></td>
    <td align="center" width="48"><img src="../images/platforms/facebook.png" alt="Facebook" width="24" height="24" /><br /><small><small>Facebook</small></small></td>
    <td align="center" width="48"><img src="../images/platforms/xiaohongshu.png" alt="Xiaohongshu" width="24" height="24" /><br /><small><small>Xiaohongshu</small></small></td>
    <td align="center" width="48"><img src="../images/platforms/pinterest.png" alt="Pinterest" width="24" height="24" /><br /><small><small>Pinterest</small></small></td>
    <td align="center" width="48"><img src="../images/platforms/reddit.png" alt="Reddit" width="24" height="24" /><br /><small><small>Reddit</small></small></td>
  </tr>
</table>

Ketersediaan bergantung pada video dan wilayah; beberapa sumber mungkin memerlukan cookie platform. OpenCreator tidak mengimpor cookie peramban secara otomatis.

![Pemilihan format Pengunduh Video OpenCreator](../images/examples/video-downloader-formats-and-subtitles-en.png)

### Pembuatan Video

Buat video AI dari prompt teks atau gambar referensi dengan Seedance. Atur model, rasio aspek, resolusi, dan durasi, lalu pratinjau, buat ulang, atau unduh setiap versi dari ruang kerja proyek.

![Pembuatan Video OpenCreator dengan Seedance](../images/examples/video-generation-seedance-en.png)

### Animasi Figur Stik

OpenCreator mengembangkan koleksi karakter orisinal ini bersama seniman [Harbor Hsia](https://www.behance.net/xiaheyuan1), kreator [Stickman di Behance](https://www.behance.net/gallery/254715463/Stickman). Karakter bawaan menjaga identitas karakter tetap konsisten selama pembuatan animasi.

![Karakter figur stik OpenCreator yang dikembangkan bersama seniman](../images/examples/stick-figure-characters.webp)

Ubah teks atau konten YouTube menjadi animasi melalui peninjauan naskah, narasi, pengaturan waktu, storyboard, subtitle, rendering, dan unduhan video.

![Contoh frame animasi figur stik OpenCreator](../images/examples/stick-figure-animation-frame.jpg)

## Mulai Cepat

### Pasang Aplikasi Desktop

Unduh penginstal macOS Apple Silicon, macOS Intel, atau Windows x64 dari [rilis terbaru](https://github.com/krillinai/OpenCreator/releases/latest). Aplikasi Desktop tidak memerlukan Node.js atau pnpm dan sudah menyertakan Codex CLI. Tugas model yang nyata memerlukan login ChatGPT atau konfigurasi API key yang dapat digunakan.

Saat pertama dibuka, Desktop memulai Runtime lokal, menyiapkan proyek default, dan memeriksa konfigurasi Codex di komputer Anda. Jika login atau API key serta pengaturan model yang dapat digunakan ditemukan, pilih **Gunakan Codex lokal dan lanjutkan** untuk memakainya kembali. Anda juga dapat mengatur penyedia model lain dalam panduan awal yang sama.

![Pengaturan penyedia model saat pertama kali menjalankan OpenCreator Desktop](../images/product/opencreator-codex-setup.png)

Setelah pengaturan selesai, masukkan permintaan untuk memulai tugas. Jika ada masalah, lihat [panduan pengguna](../opencreator-user-guide-and-troubleshooting.md).

### Menjalankan Web dari Kode Sumber

Untuk pengembangan atau penggunaan di browser, siapkan:

- Node.js 22 atau yang lebih baru
- pnpm 9.15.0, ditetapkan melalui kolom `packageManager` repositori
- Executable Codex CLI yang tersedia di terminal Anda
- Login Codex CLI yang valid untuk tugas model nyata

Periksa lingkungan lokal Anda terlebih dahulu:

```bash
node --version
pnpm --version
codex --version
```

```bash
git clone https://github.com/krillinai/OpenCreator.git
cd OpenCreator
corepack enable
pnpm install
pnpm web:dev
```

Buka `http://127.0.0.1:19861/`. Server pengembangan memulai daemon lokal sesuai kebutuhan dan menyuntikkan token Runtime sementara melalui proxy same-origin, sehingga token koneksi tidak perlu disalin secara manual.

Pada peluncuran pertama, Runtime menyiapkan proyek default. Kotak input siap digunakan segera setelah koneksi selesai. Untuk bekerja hanya pada daemon:

```bash
pnpm daemon:dev
```

Daemon hanya mendengarkan pada alamat loopback dan mencetak alamat koneksi serta token sementaranya ke stdout satu kali.

## Desktop

Desktop dan browser menggunakan frontend React yang sama dari `apps/web`. Perilaku umum untuk proyek, percakapan, tugas, dan pengaturan memanggil Daemon/API yang sama. Electron hanya menambahkan path sistem nyata, kontrol jendela, perilaku baki sistem, dan notifikasi native.

### Mode Pengembangan

```bash
pnpm desktop:dev
```

### Pengemasan Lokal

| Perintah | Keluaran |
| --- | --- |
| `pnpm desktop:package` | Direktori yang dapat dijalankan untuk platform saat ini, ditujukan untuk verifikasi lokal |
| `pnpm desktop:dist` | Installer untuk platform saat ini |
| `pnpm desktop:release` | Titik masuk pengemasan untuk rilis resmi |
| `pnpm --filter @opencreator/desktop verify:package` | Verifikasi paket Desktop yang sudah ada |

Pengemasan Desktop membangun ulang Web dari ruang kerja saat ini, mencatat commit, status dirty, platform, arsitektur, dan hash Web, lalu membandingkan `apps/web/dist` dengan resource yang disematkan dalam aplikasi. Pengemasan gagal jika keduanya berbeda. Lihat [panduan operasional rilis Desktop](../operations/opencreator-desktop-release-runbook.md) untuk penandatanganan, notarisasi, build Windows, dan persyaratan rilis.

## Alur Kerja Inti

### Percakapan dan Runs

1. Pilih proyek atau mulai percakapan baru.
2. Masukkan tugas dan pilih tingkat izin, Profile, model, serta upaya penalaran.
3. Saat Run aktif, antrekan tugas lanjutan atau hentikan Run dan lanjutkan segera.
4. Gunakan Timeline untuk memeriksa ringkasan penalaran, pemanggilan alat, perubahan file, persetujuan, dan hasil akhir.
5. Gunakan pusat tugas untuk melacak tugas yang berjalan, selesai, gagal, dan terblokir oleh persetujuan secara menyeluruh.

### Skills dan MCP

- Telusuri marketplace Skill, riwayat instalasi, dan Skills yang tersedia secara lokal di pusat plugin.
- Pilih Skill dari kotak input dengan `/` atau menu tambah agar tugas berikutnya mengikuti alur kerjanya.
- Pengelolaan MCP menggunakan perintah dan konfigurasi native Codex, bukan memelihara mesin eksekusi kedua.
- OpenCreator menggunakan `$CODEX_HOME` aktif secara default, jadi periksa dampaknya sebelum mengubah Skills global atau konfigurasi MCP.

### Jadwal dan Thread Tugas Khusus

- Setiap jadwal memiliki percakapan OpenCreator yang persisten dan khusus.
- Pemicu otomatis, eksekusi manual, dan tindak lanjut pengguna menggunakan kembali percakapan tersebut dan berjalan secara serial sesuai kebijakan `queue` atau `skip`.
- Menghapus jadwal akan mengarsipkan percakapan khususnya sambil mempertahankan Runs, hasil, dan riwayat Codex yang mendasarinya.
- Merotasi atau memulihkan thread Codex yang mendasarinya tidak mengubah entri tugas atau rute halaman OpenCreator.

## Struktur Sistem OpenCreator

OpenCreator memperlakukan ruang kerja visual dan percakapan Agent sebagai dua antarmuka untuk tugas kreatif yang sama, bukan dua alur kerja terpisah. Setiap alur kerja kreator dimodelkan sebagai mesin status: input sumber, konfigurasi, pembuatan, peninjauan, revisi, dan ekspor menjadi status serta peristiwa yang eksplisit. Tindakan di ruang kerja dan perintah percakapan masuk ke mesin status yang sama, sedangkan langkah saat ini, konfigurasi, progres, versi, dan hasil diproyeksikan kembali ke kedua antarmuka. Hal ini menjaga ruang kerja dan percakapan tetap sinkron tanpa menghadirkan sumber kebenaran kedua.

Pekerjaan kreatif bersifat iteratif, sehingga revisi tidak menimpa hasil saat ini. Setiap koreksi atau pembuatan ulang menghasilkan versi baru dari status alur kerja yang ada, dengan tetap menyimpan pengaturan dan keluaran versi sebelumnya untuk ditinjau, dibandingkan, dan disempurnakan lebih lanjut.

```text
+-----------------------------+     +------------------------------------+
| Browser Access              |     | Desktop Host                       |
|                             |     | Shared Web build + Electron        |
+--------------+--------------+     +------------------+-----------------+
               |                                       |
               +-------------------+-------------------+
                                   v
+----------------------------------------------------------------------------+
| Creator Experience / apps/web                                              |
| Dashboard / Creator Tools / Agent Conversation / Settings / Files          |
+-------------------------------------+--------------------------------------+
                                      |
+-------------------------------------v--------------------------------------+
| Collaboration Core                                                         |
| Shared workflow state / Steps / Progress / Results / Versions              |
+-------------------------------------+--------------------------------------+
                                      | Runtime API + SSE
+-------------------------------------v--------------------------------------+
| Local Runtime / apps/daemon                                                 |
| Projects / Runs / Approvals / Schedules / Memory / Notifications           |
| Component status / Update checks / Verified updates / Safe fallback        |
+-------------+------------------------+------------------------+-------------+
              |                        |                        |
              v                        v                        v
+---------------------+  +---------------------+  +-------------------------+
| Local Data          |  | Codex Engine        |  | Media Toolchain         |
| SQLite / Files      |  | CLI / app-server    |  | FFmpeg / yt-dlp         |
| System credentials  |  | Skills / MCP        |  | Whisper / AI services   |
+---------------------+  +---------------------+  +-------------------------+
```

| Komponen OpenCreator | Tanggung jawab | Implementasi |
| --- | --- | --- |
| Pengalaman Kreator | Dashboard, alat kreasi, percakapan Agent, pengaturan, dan file | `apps/web` · React 18 · Vite · TypeScript |
| Inti Kolaborasi | Menyinkronkan langkah ruang kerja, konteks percakapan, progres, hasil, dan revisi | Status alur kerja bersama · `CreatorCollaborationPanel` · riwayat versi |
| Runtime Lokal | Mengelola proyek, Runs, persetujuan, jadwal, memori, dan notifikasi | `apps/daemon` · Fastify · Runtime API · SSE |
| Komponen Runtime | Melacak versi bawaan, aktif, dan terbaru; memeriksa berkala dan hanya memasang pembaruan yang diminta pengguna | yt-dlp nightly · verifikasi pembaruan · fallback versi berfungsi |
| Mesin Codex | Menyediakan loop Agent, sesi, penalaran, alat, Skills, dan MCP | Codex CLI · app-server |
| Rangkaian Alat Media | Mengunduh, mentranskripsi, mengubah, membuat, dan mengekspor media kreatif | yt-dlp · Whisper · FFmpeg · layanan AI terkonfigurasi |
| Data Lokal | Menyimpan data proyek, Runs, lampiran, output, dan kredensial secara lokal | SQLite · sistem file · penyimpanan kredensial sistem |
| Host Desktop | Memuat build Web bersama dan menambahkan kemampuan sistem operasi | `apps/desktop` · Electron · Preload Bridge |

Prinsip inti:

- Ruang kerja dan percakapan Agent adalah proyeksi tersinkronisasi dari status alur kerja yang sama; keduanya mengirim peristiwa ke mesin status yang sama alih-alih mempertahankan status tugas paralel.
- Revisi membuat versi baru, bukan menggantikan hasil yang ada, sehingga konteks dan keluaran setiap iterasi kreatif tetap tersimpan.
- Frontend tidak menjalankan Codex secara langsung dan tidak bergantung pada format peristiwa JSONL mentah dari Codex.
- Daemon mengelola siklus hidup proses, normalisasi peristiwa, persistensi, persetujuan, jadwal, dan kotak keluar notifikasi.
- Codex tetap menjadi sumber kebenaran eksekusi untuk loop Agent, Skills, dan MCP.
- Browser Bridge dan Desktop Bridge tidak mengimplementasikan salinan terpisah dari logika produk umum.

## Tata Letak Repositori

```text
OpenCreator/
├── apps/
│   ├── web/          # Satu-satunya implementasi frontend React
│   ├── daemon/       # Runtime Fastify lokal dan adaptor Codex
│   ├── desktop/      # Electron Main, Preload, kemampuan native, dan pengemasan
│   └── harness/      # Alat baris perintah untuk verifikasi Runtime
├── packages/
│   ├── protocol/     # Kontrak Runtime yang digunakan bersama oleh Web, Daemon, dan Desktop
│   └── skill-market/ # Model marketplace Skill dan logika bersama
├── docs/             # Dokumen desain, referensi API, panduan operasional, dan laporan pengujian
├── scripts/          # Pemeriksaan tingkat repositori
└── .runtime/         # Data Runtime lokal, dibuat pada peluncuran pertama
```

## Konfigurasi

### Kunci API Layanan AI

Buka **Pengaturan → Layanan AI** untuk mengonfigurasi penyedia model, transkripsi, audio, dan gambar yang digunakan ruang kerja saat ini. Kategori layanan tambahan mungkin muncul sebagai persiapan untuk alat kreasi mendatang. Setiap kategori hanya menampilkan kolom yang diperlukan oleh penyedia terpilih, termasuk Base URL, API Key, model, proxy, atau kredensial khusus penyedia.

![Pengaturan Kunci API Layanan AI OpenCreator](../images/product/opencreator-ai-services-en.png)

Kredensial disimpan melalui penyimpanan kredensial sistem milik Runtime lokal dan tidak boleh pernah dimasukkan ke repositori. Beberapa penyedia lokal atau berbasis sistem, seperti Edge TTS, tidak memerlukan API Key.

### Komponen Runtime Pihak Ketiga

Buka **Pengaturan → Komponen Pihak Ketiga** untuk melihat versi yt-dlp nightly yang sedang digunakan, versi bawaan OpenCreator, sumbernya, dan rilis terbaru yang tersedia. OpenCreator memeriksa pembaruan setiap tujuh hari, tetapi tidak pernah memasangnya secara otomatis. Pembaruan memerlukan tindakan pengguna secara eksplisit, dan versi yang sedang berfungsi tetap tersedia jika pengunduhan, verifikasi, atau pemasangan gagal.

![Pengaturan Komponen Pihak Ketiga OpenCreator](../images/product/opencreator-third-party-components-en.png)
### Variabel Lingkungan Runtime

Sebagian besar pengguna tidak memerlukan variabel lingkungan. Gunakan variabel berikut saat Anda memerlukan data terisolasi, executable Codex tertentu, atau direktori proyek terkelola khusus:

| Variabel lingkungan | Default | Tujuan |
| --- | --- | --- |
| `OPENCREATOR_DATA_DIR` | `.runtime` | Database OpenCreator, Runs, lampiran, dan ruang kerja terkelola |
| `OPENCREATOR_CODEX_BIN` | `codex` | Path ke executable Codex CLI |
| `CODEX_HOME` | `~/.codex` | Sumber kebenaran untuk sesi, konfigurasi, Skills, MCP, dan Profiles Codex |
| `OPENCREATOR_DEFAULT_CWD` | Direktori kerja saat ini | Direktori kerja default daemon |
| `OPENCREATOR_DEFAULT_PROJECT_ROOT` | Kebijakan default Runtime | Root proyek terkelola; jika diatur, OpenCreator menggunakan subdirektori `OpenCreator/` di dalamnya |
| `OPENCREATOR_CODEX_THREAD_ROTATION_RUN_THRESHOLD` | `50` | Ambang Runs terminal untuk merotasi thread Codex di balik jadwal berdurasi panjang; gunakan `0` untuk menonaktifkan rotasi proaktif |

Contohnya, untuk mengisolasi data Runtime dan lingkungan Codex sekaligus:

```bash
OPENCREATOR_DATA_DIR=/path/to/opencreator-data \
CODEX_HOME=/path/to/codex-home \
pnpm web:dev
```

## Data dan Keamanan

Data Runtime disimpan di `.runtime/` pada root repositori secara default:

| Path | Isi |
| --- | --- |
| `.runtime/app.sqlite` | Proyek, thread, Runs, peristiwa, jadwal, notifikasi, metadata lampiran, persetujuan, memori, dan ringkasan |
| `.runtime/runs/` | Log yang telah menyamarkan informasi sensitif, diagnostik, dan metadata untuk setiap Run |
| `.runtime/attachments/` | File lampiran terkontrol |
| `.runtime/workspaces/` | Ruang kerja proyek yang dikelola Runtime |

Sesi dan konfigurasi Codex tetap berada di `$CODEX_HOME` dan harus dicadangkan secara terpisah dari `.runtime/`.

Batas keamanan mencakup:

- Daemon hanya mendengarkan pada `127.0.0.1`; setiap API kecuali pemeriksaan kesehatan memerlukan token Bearer.
- Pratinjau HTML menonaktifkan skrip, navigasi, dan pop-up secara default serta hanya mengizinkan resource relatif terkontrol dari ruang kerja yang sama.
- Memori sensitif memerlukan konfirmasi kedua. OpenCreator tidak pernah menyimpan saran yang belum dikonfirmasi secara otomatis dan permanen.
- Diagnostik dan log Run disamarkan sebelum dikembalikan atau diekspor.
- Paket Desktop mengaktifkan integritas ASAR dan enkripsi cookie sambil menonaktifkan RunAsNode, `NODE_OPTIONS`, dan Node CLI Inspector.

Lihat [panduan pengguna dan pemecahan masalah](../opencreator-user-guide-and-troubleshooting.md) untuk prosedur pencadangan, pemulihan, pembersihan, dan pengaturan ulang yang lengkap.

## Pengembangan

### Perintah Umum

| Perintah | Tujuan |
| --- | --- |
| `pnpm web:dev` | Menjalankan Web dan memulai daemon lokal sesuai kebutuhan |
| `pnpm daemon:dev` | Menjalankan daemon saja |
| `pnpm desktop:dev` | Membangun dependensi dan memulai Electron dalam mode pengembangan |
| `pnpm test` | Menjalankan pengujian unit dan integrasi workspace |
| `pnpm typecheck` | Menjalankan pemeriksaan TypeScript di seluruh repositori |
| `pnpm build` | Membangun setiap workspace |
| `pnpm e2e` | Menjalankan pengujian E2E Playwright untuk Web |
| `pnpm smoke:ci` | Menjalankan smoke test Runtime dengan Codex palsu |
| `pnpm perf:check` | Memeriksa baseline performa yang tercatat |

Sebelum mengirim perubahan, pilih verifikasi sesuai dampaknya seperti dijelaskan dalam [panduan kontribusi](../../CONTRIBUTING.md#what-reviewers-check). Dokumentasi, teks, dan gaya hanya perlu pemeriksaan terkait; perilaku bersama dan Runtime memerlukan pengujian modul terkait serta pemeriksaan tipe. Jalankan pengujian atau build seluruh workspace hanya jika diperlukan dan laporkan yang benar-benar dijalankan di PR.

Perubahan pada Desktop, Host Bridge, proxy Runtime, atau alur kerja frontend bersama juga memerlukan pengujian konsistensi Web/Desktop, E2E aplikasi terkemas, dan verifikasi hash build Web. Lulus pengujian unit Web saja tidak membuktikan bahwa rilis Desktop telah siap.

Smoke test dengan Codex nyata dinonaktifkan secara default. Aktifkan secara eksplisit dengan:

```bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

## Dokumentasi

- **Menggunakan OpenCreator:** [Mulai Cepat](#mulai-cepat) · [Panduan pengguna dan pemecahan masalah](../opencreator-user-guide-and-troubleshooting.md)
- **Mengembangkan dan memperluas:** [Panduan kontribusi](../../CONTRIBUTING.md) · [Kontribusi Skill](../contributing/skills-contributing.md) · [Kontribusi template kreasi](../contributing/templates-contributing.md) · [Runtime API v1](../runtime-api-for-ui-v1.md) · [Pedoman komponen visual](../visual-component-guidelines.md)
- **Pemeliharaan dan rilis:** [Desain Runtime native Codex](../2026-07-03-codex-native-agent-runtime-design.md) · [Panduan operasional rilis Desktop](../operations/opencreator-desktop-release-runbook.md) · [Panduan rilis Desktop untuk Windows](../operations/opencreator-desktop-windows-release.md)

## Konvensi Penerjemahan

File `README.md` di root adalah dokumen bahasa Inggris kanonis. Terjemahan yang dipelihara berada di `docs/<locale>/README.md`. Tambahkan bahasa ke pemilih hanya setelah seluruh dokumen diterjemahkan dan disinkronkan dengan struktur bahasa Inggris.

## Komunitas

<p>Pengguna GitHub dari <strong>setidaknya 107 negara dan wilayah</strong> telah memberi Star kepada OpenCreator.</p>

<img src="../images/star-coverage-map.svg" alt="Peta dunia yang menandai negara dan wilayah pengguna GitHub yang memberi Star pada OpenCreator" width="760" />

### Tim Inti

Setiap anggota bertanggung jawab atas standar, peninjauan dan penggabungan kontribusi, serta dukungan komunitas di bidangnya.

<table border="1" cellpadding="12">
  <tr>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/wulien.svg" width="64" height="64" alt="wulien avatar" /><br /><a href="https://github.com/wulien">wulien</a><br />Kode &amp; perbaikan bug</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/dle-kb.svg" width="64" height="64" alt="DLe-kb avatar" /><br /><a href="https://github.com/DLe-kb">DLe-kb</a><br />Template kreasi</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/xiaheyuan.svg" width="64" height="64" alt="xiaheyuan avatar" /><br /><a href="https://github.com/xiaheyuan">xiaheyuan</a><br />Desain &amp; aset</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/krillinai.svg" width="64" height="64" alt="krillinai avatar" /><br /><a href="https://github.com/krillinai">krillinai</a><br />Skills &amp; dokumentasi</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/hbxugang.svg" width="64" height="64" alt="hbxugang avatar" /><br /><a href="https://github.com/hbxugang">hbxugang</a><br />Deployment perusahaan</td>
  </tr>
</table>

### Kontributor

Terima kasih kepada semua orang yang telah berkontribusi melalui kode, dokumentasi, umpan balik, laporan masalah, Skills, desain, dan ide.

<div>
  <a href="https://github.com/maranello-o"><img src="../images/contributors/maranello-o.svg" width="48" height="48" alt="maranello-o" /></a>
  <a href="https://github.com/wulien"><img src="../images/contributors/wulien.svg" width="48" height="48" alt="wulien" /></a>
  <a href="https://github.com/puji4810"><img src="../images/contributors/puji4810.svg" width="48" height="48" alt="puji4810" /></a>
  <a href="https://github.com/krillinai"><img src="../images/contributors/krillinai.svg" width="48" height="48" alt="krillinai" /></a>
  <a href="https://github.com/PairZhu"><img src="../images/contributors/pairzhu.svg" width="48" height="48" alt="PairZhu" /></a>
  <a href="https://github.com/Mijaelx"><img src="../images/contributors/mijaelx.svg" width="48" height="48" alt="Mijaelx" /></a>
  <a href="https://github.com/OutisLi"><img src="../images/contributors/outisli.svg" width="48" height="48" alt="OutisLi" /></a>
  <a href="https://github.com/yeager"><img src="../images/contributors/yeager.svg" width="48" height="48" alt="yeager" /></a>
  <a href="https://github.com/catwithtudou"><img src="../images/contributors/catwithtudou.svg" width="48" height="48" alt="catwithtudou" /></a>
  <a href="https://github.com/newdee"><img src="../images/contributors/newdee.svg" width="48" height="48" alt="newdee" /></a>
  <a href="https://github.com/scwf"><img src="../images/contributors/scwf.svg" width="48" height="48" alt="scwf" /></a>
  <a href="https://github.com/xiaheyuan"><img src="../images/contributors/xiaheyuan.svg" width="48" height="48" alt="xiaheyuan" /></a>
  <a href="https://github.com/hbxugang"><img src="../images/contributors/hbxugang.svg" width="48" height="48" alt="hbxugang" /></a>
  <a href="https://github.com/kapil971390"><img src="../images/contributors/kapil971390.svg" width="48" height="48" alt="kapil971390" /></a>
  <a href="https://github.com/octo-patch"><img src="../images/contributors/octo-patch.svg" width="48" height="48" alt="octo-patch" /></a>
  <a href="https://github.com/yuanjinghh"><img src="../images/contributors/yuanjinghh.svg" width="48" height="48" alt="yuanjinghh" /></a>
  <a href="https://github.com/DLe-kb"><img src="../images/contributors/dle-kb.svg" width="48" height="48" alt="DLe-kb" /></a>
  <a href="https://github.com/liupig"><img src="../images/contributors/liupig.svg" width="48" height="48" alt="liupig" /></a>
  <a href="https://github.com/alextavares" title="alextavares"><img src="../images/contributors/alextavares.svg" width="48" height="48" alt="alextavares" /></a>
  <a href="https://github.com/krillinai/OpenCreator/commit/a89cff0ac5d91540f03e361af50b286ee57691ae" title="卡皮巴拉"><img src="../images/contributors/kapibala.svg" width="48" height="48" alt="卡皮巴拉" /></a>
  <a href="https://github.com/mifan100g" title="mifan100g (米饭二两)"><img src="../images/contributors/mifan100g.svg" width="48" height="48" alt="mifan100g (米饭二两)" /></a>
  <a href="https://github.com/askalf"><img src="../images/contributors/askalf.svg" width="48" height="48" alt="askalf" /></a>
  <a href="https://github.com/Yi-111-a"><img src="../images/contributors/yi-111-a.svg" width="48" height="48" alt="Yi-111-a" /></a>
</div>

### Berkontribusi

Anda dapat berkontribusi ke OpenCreator dengan berbagai cara, tidak hanya lewat kode:

| Jenis | Kontribusi | Yang perlu disiapkan | Tempat mengirim |
| --- | --- | --- | --- |
| Kode | Perbaikan bug, alur kreasi, fitur bersama | Perubahan terfokus, demo atau langkah reproduksi, pengujian | [Issue][contribute-issue] → [PR][contribute-pr]; `apps/web/` atau `apps/daemon/` |
| Skills | Alur kerja Agent yang dapat digunakan kembali | `SKILL.md`, prasyarat, dan contoh penggunaan | [Issue][contribute-issue] → [PR][contribute-pr] di `skills/` |
| Templat kreasi | Templat gambar, video, atau sampul yang dapat digunakan kembali | `template.json`, sampul dan contoh, prompt, pengaturan, atribusi, dan hak penggunaan | [PR][contribute-pr] di [`template/`](../../template/); diskusikan format baru di [Issue][contribute-issue] |
| Ilustrasi dan desain | Ilustrasi, ikon, atau UI orisinal | Pratinjau, berkas sumber yang dapat diedit, dan lisensi | [Issue][contribute-issue] → [PR][contribute-pr] di lokasi aset yang disepakati |
| Integrasi layanan pihak ketiga | Dukungan layanan AI atau media | Kegunaan, pengaturan, penanganan kesalahan, keamanan kredensial, pengujian | [Issue][contribute-issue] → [PR][contribute-pr] di modul Web / Daemon |

Simpan setiap templat dan asetnya di `template/<module>/<id>/<version>/template.json`. Modul yang tersedia saat ini ialah `image-generation`, `video-generation`, dan `cover-generator`. Sertakan judul serta deskripsi berbahasa Mandarin dan Inggris, lalu jalankan `pnpm templates:validate` sebelum mengirim PR.

Cara berkontribusi:

1. Jelaskan masalah, kasus penggunaan, dan perilaku yang diharapkan di [Issues](https://github.com/krillinai/OpenCreator/issues).
2. Buat branch fitur atau perbaikan yang terfokus dari branch pengembangan terbaru.
3. Ikuti arsitektur yang ada: implementasikan kemampuan produk umum satu kali di Web dan Daemon, lalu pisahkan perbedaan native di balik capabilities yang eksplisit.
4. Tambahkan cakupan unit, integrasi, atau E2E yang sesuai untuk perubahan perilaku, dan cantumkan verifikasi yang diselesaikan maupun dilewati dalam Pull Request.
5. Jangan pernah memasukkan `.runtime/`, kredensial lokal, sesi Codex, cache build, atau data pengguna lainnya ke dalam commit.

[contribute-issue]: https://github.com/krillinai/OpenCreator/issues
[contribute-pr]: https://github.com/krillinai/OpenCreator/pulls

## Riwayat Star

OpenCreator sebelumnya bernama KrillinAI. Grafik ini mencakup seluruh riwayat repositori sebelum dan sesudah perubahan nama.

[![Riwayat Star OpenCreator](https://api.star-history.com/svg?repos=krillinai/OpenCreator&type=date)](https://www.star-history.com/?type=date&repos=krillinai%2FOpenCreator)

## Proyek Terkait

| Proyek | Peran |
| --- | --- |
| [OpenAI Codex](https://github.com/openai/codex) | Mesin eksekusi Agent yang mendukung akses model, penalaran, pemanggilan alat, sesi, Skills, dan integrasi MCP. |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Memeriksa tautan media publik yang didukung, menampilkan format yang tersedia, dan mengunduh video atau audio untuk alur kreasi. |
| [FFmpeg](https://ffmpeg.org/) | FFmpeg dan ffprobe menangani konversi media, komposisi, ekstraksi frame, dan validasi output. |
| [Whisper](https://github.com/openai/whisper), [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [faster-whisper](https://github.com/SYSTRAN/faster-whisper), dan [WhisperKit](https://github.com/argmaxinc/WhisperKit) | Pilihan transkripsi suara cloud dan lokal khusus platform yang dipilih sesuai kemampuan Runtime yang tersedia. |
| [React](https://react.dev/) | Fondasi antarmuka pengguna bersama untuk Web dan Desktop. |
| [Fastify](https://fastify.dev/) | Fondasi HTTP dan API untuk Runtime lokal. |
| [Electron](https://www.electronjs.org/) | Host Desktop untuk kemampuan sistem native, siklus hidup aplikasi, dan pengemasan. |
| [SQLite](https://www.sqlite.org/) | Penyimpanan lokal untuk proyek, percakapan, Runs, jadwal, memori, dan data ruang kerja lainnya. |
| [Model Context Protocol](https://modelcontextprotocol.io/) | Protokol terbuka untuk menghubungkan alat dan layanan eksternal ke ruang kerja Agent. |

---

<div align="center">

**OpenCreator · Berkreasi secara lokal, bekerja tanpa henti.**

</div>
