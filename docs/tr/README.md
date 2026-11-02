<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../images/OpenCreator_logo_vector_dark.svg" />
    <img src="../images/OpenCreator_logo_vector.svg" alt="OpenCreator" width="380" />
  </picture>
  <br />
  İçerik üreticileri için açık kaynaklı yapay zekâ çalışma alanı ve Skills
</h1>

<p>Senaryoları, videoları, görselleri, sesi, avatarları, çeviriyi ve düzenlemeyi; görsel araçları, yeniden kullanılabilir Skills ve Agents ile tek bir çalışma alanında birleştirir.</p>

<p><strong>OpenCreator daha önce KrillinAI adıyla biliniyordu.</strong></p>

<a href="https://trendshift.io/repositories/13360" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13360" alt="OpenCreator, eski adıyla KrillinAI: Trendshift Günün 1 Numaralı Deposu" width="250" height="55" /></a>

[English](../../README.md) | [简体中文](../zh/README.md) | [日本語](../ja/README.md) | [한국어](../ko/README.md) | [Bahasa Indonesia](../id/README.md) | [Español](../es/README.md) | [Français](../fr/README.md) | [Deutsch](../de/README.md) | [Português](../pt/README.md) | [Русский](../ru/README.md) | [العربية](../ar/README.md) | [ภาษาไทย](../th/README.md) | **Türkçe** | [हिन्दी](../hi/README.md) | [বাংলা](../bn/README.md) | [اردو](../ur/README.md) | [Tiếng Việt](../vi/README.md) | [Filipino](../fil/README.md)

[![GitHub Stars](https://badgen.net/github/stars/krillinai/OpenCreator?icon=github&label=Stars&color=EAB308)](https://github.com/krillinai/OpenCreator/stargazers)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Bilibili](https://img.shields.io/badge/dynamic/json?label=Bilibili&query=%24.data.follower&suffix=%E7%B2%89%E4%B8%9D&url=https%3A%2F%2Fapi.bilibili.com%2Fx%2Frelation%2Fstat%3Fvmid%3D242124650&logo=bilibili&color=00A1D6&labelColor=FE7398&logoColor=FFFFFF)](https://space.bilibili.com/242124650)
[![AtomGit G-Star](https://img.shields.io/badge/AtomGit-G--Star-DA203E?style=flat)](https://atomgit.com/krillinai/OpenCreator)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/fUNvbqDaw)
[![QQ Grubu](https://img.shields.io/badge/QQ%20群-754069680-green?logo=tencent-qq)](https://qm.qq.com/q/W4YC0PLMeA)

[Öne Çıkanlar](#proje-özellikleri) · [İçerik Üretim Araçları](#içerik-üretim-araçları) · [Skills](#skills) · [Örnekler](#örnekler) · [Hızlı Başlangıç](#hızlı-başlangıç) · [Desktop](#desktop) · [Belgeler](#belgeler) · [Topluluk](#topluluk)

</div>

![OpenCreator Agent çalışma alanı](../images/opencreator-home-en.png)

## Proje Özeti

OpenCreator, yaratıcı ve yazılım geliştirme çalışmalarını yerel bilgisayarında sürdürmek isteyen bireyler ve ekipler için tasarlanmıştır. Yeni bir Agent döngüsü geliştirmek yerine Codex CLI'ı yürütme motoru olarak kullanır; bunun çevresine kararlı bir yerel Runtime, görsel bir çalışma alanı ve Desktop uygulaması ekler.

OpenCreator birbirine bağlı iki çalışma biçimi sunar:

- **İçerik çalışma alanı:** Video çevirme ve indirme, görsel ve video üretimi, seslendirme, makale ve sosyal medya gönderisi yazımı, kısa video senaryosu ve çöp adam animasyonu için görsel araçları ve üretim şablonlarını kullanın.
- **Agent görüşmesi:** Yaratıcı veya teknik görevleri doğal dille başlatın ve yönetin; görüşmeleri projelere göre düzenleyin; Runs işlemlerini arka planda sürdürün; onayları, ekleri, dosyaları, Skills, MCP'yi, zamanlamaları, bildirimleri, belleği ve tanılama bilgilerini tek yerden yönetin.

Web, tek frontend uygulamasıdır. Desktop aynı Web derlemesini yükler ve yalnızca klasör seçimi, pencere yaşam döngüsü, sistem tepsisi ve yerel bildirimler gibi işletim sistemi gerektiren yetenekleri ekler. Aynı veri ve içerik görünümü kullanıldığı için iki platform da ortak kullanıcı arayüzünü ve Runtime davranışını paylaşır.

## Proje Özellikleri

- 🤖 **Codex Native:** İkinci bir yürütme motoru geliştirmeden Codex Agent döngüsünü, modellerini, akıl yürütme yeteneklerini, araç çağrılarını, görüşmeleri, Skills ve MCP'yi kullanın.
- 🚀 **Kullanıma hazır Desktop uygulaması:** Codex CLI içeren Desktop uygulamasını doğrudan başlatın; yerel Runtime gerektiğinde çalışır ve varsayılan projeyi otomatik hazırlar.
- ⚙️ **Codex ayarlarını yeniden kullanır:** İlk açılışta yerel Codex yapılandırmasını tarar ve çalışan ChatGPT oturumunu veya API anahtarı ayarını yeniden kullanmayı önerir. Diğer model sağlayıcıları için yönlendirmeli bir form sunar.
- 🔄 **Yönetilen Runtime bileşenleri:** Paketlenmiş, etkin ve en yeni yt-dlp sürümlerini inceleyin; güncellemeleri denetleyin ve güncelleme başarısız olursa çalışan sürümü koruyarak elle güncelleyin.
- 🎨 **Çoklu ortam üretimi:** Video, görsel, ses, altyazı ve belgeleri tek bir bağlı iş akışında oluşturun ve yönetin.
- 🧩 **Üretim şablonları:** Komutları ve ayarları her seferinde sıfırdan kurmadan yeniden kullanılabilir şablonlarla görsel ve video üretimine başlayın.
- 🔗 **İki modlu iş akışı:** Görsel çalışma alanı veya Agent görüşmesi üzerinden çalışın; ortak durum makinesi adımları, ilerlemeyi ve sonuçları senkronize eder.
- 🕘 **Sürümleme:** Her revizyon önceki ayarları ve çıktıları koruyan yeni bir sürüm oluşturur.
- 🧩 **Yeniden kullanılabilir Skills:** Video iş akışı Skills'lerini kullanın, kendi Skills'inizi ekleyin ve MCP'yi Codex yerel yapılandırmasıyla yönetin.
- 🧠 **Bellek:** Genel, proje ve konu belleğini özetler ve tekrar üretilebilir Run giriş anlık görüntüleriyle saklayın.
- 🔐 **Yerel güvenlik:** Verileri, ekleri ve günlükleri varsayılan olarak yerel tutun; onaylar ve hassas bilgileri ayıklanmış tanılama günlükleri kullanın.
- 🌐 **Çok dilli arayüz**: Web ve Desktop 43 dil, sistem dilini algılama, elle seçim ve Arapça, Farsça, Urduca ile İbranice için sağdan sola düzen sunar.

## İçerik Üretim Araçları

Mevcut sürüm on içerik üretim aracı içerir. Kullanılabilir modeller ve servisler yerel Codex ortamınıza ve AI servisi ayarlarınıza bağlıdır.

Dashboard'u açarak makale, Xiaohongshu gönderisi ve kısa video senaryosu yazın; çöp adam animasyonu oluşturun; video çevirin veya indirin; küçük resim, görsel ve video üretin; Text to Speech ile seslendirme yapın.

![OpenCreator içerik üretim paneli](../images/product/opencreator-dashboard-en.png)

> Yeni içerik üretim araçları sürekli eklenmektedir.

**Video çevirisi 123 kaynak dili ve Pinyin çıktısı dahil 124 hedef seçeneği sunar.** Yerel ad, İngilizce ad, Çince ad veya dil koduyla arayın. Konuşma tanıma ve ses sentezi kapsamı seçilen hizmet ve modele bağlıdır.

- **Yalnızca altyazı çevirisi**: SRT dosyasını içe aktarın, önizleyin ve kaynak video, dublaj veya video oluşturma olmadan çevirin.

- **Gelişmiş altyazı düzenleme**: Oynatmayla eşleşen dalga biçimi ve zaman çizelgesine sahip tam ekran düzenleyicide zamanlamayı ayarlayın, altyazıları bölün veya birleştirin ve metin bulup değiştirin. Stilleri videoda önizleyin, dil, ses ve çıktı ayarlarını değiştirip önceki sonuçları koruyarak yeni sürüm oluşturun.

- **Tek sayfada oluşturma**: Görsel, video ve Text to Speech ayarlarını tek sayfada tamamlayın; model seçimi, referans önizlemesi, modele özgü görsel seçenekleri ve aranabilir ses kitaplığını kullanın.

- **Çok dilli çıktı ve ilerleme**: Dahili yedek yazı tipleri karmaşık yazıları ve sağdan sola altyazıları iyileştirir. Mevcut olduğunda tamamlanan ve toplam öğe sayılarıyla yazıya dökme, çeviri, dublaj ve işleme ilerlemesini izleyin.

| Çalışma alanı | Durum | Yetenekler |
| --- | --- | --- |
| Video Translation | ✅ Kullanılabilir | Yerel veya herkese açık videoları içe aktarma; bulut ya da yerel Whisper ile transkripsiyon; altyazı bölümlendirme, hizalama, terminoloji ve çeviri için LLM bağlamı; çift dilli altyazı, dublaj, özel ses örneği, altyazı stili ve yatay/dikey kompozisyon; SRT, ses veya video dışa aktarma |
| Video Downloader | ✅ Kullanılabilir | YouTube, Bilibili, X, TikTok, Instagram, Douyin, Facebook, Xiaohongshu, Pinterest ve Reddit'teki tekil herkese açık videoları analiz etme; formatları karşılaştırma; video veya ses indirme. Bazı kaynaklar platform çerezleri gerektirebilir. Platform altyazı sağlıyorsa listeyi görüntüleyip SRT indirebilirsiniz; önce İngilizce, ardından mevcutsa arayüz dili gösterilir. |
| Thumbnail Generator | ✅ Kullanılabilir | Konu, video bağlantısı ve isteğe bağlı referans görselden küçük resim varyasyonları üretme |
| Image Generation | ✅ Kullanılabilir | İstem ve isteğe bağlı referans görselle GPT Image / Seedream / Kling Image / Gemini kullanarak görsel üretme; oran ve çıktı sayısını ayarlama; görselleri tek tek önizleme ve indirme |
| Article Writer | ✅ Kullanılabilir | Konu, bağlantı, video veya belgelerden konu seçenekleri, taslak ve makale üretme; görseller ekleyip Markdown, HTML veya PDF dışa aktarma |
| Xiaohongshu Posts | ✅ Kullanılabilir | Konu veya kaynak materyalden hedef kitle, gönderi türü ve uzunluk kontrolleriyle eksiksiz Xiaohongshu gönderisi üretme; sonucu kopyalama veya indirme |
| Short Video Script | ✅ Kullanılabilir | Konu veya kaynak materyalden kitle, platform, süre ve tona göre çekime hazır bölümlendirilmiş kısa video senaryosu oluşturma; düzenleme, kopyalama veya indirme |
| Stick Figure Animation | ✅ Kullanılabilir | Metin veya YouTube içeriğini anlatım, ses, storyboard görselleri, altyazı ve indirilebilir animasyona dönüştürme |
| Auto Clips | Geliştiriliyor | Uzun videoları analiz ederek öne çıkan bölümleri yeniden kullanılabilir kısa kliplere dönüştürme |
| Text to Speech | ✅ Kullanılabilir | Seçilebilir ses, tempo ve duygu kontrolleriyle senaryoları seslendirme |
| Video Generation | ✅ Kullanılabilir | İstem ve referans görsellerden Seedance / Kling / Veo ile video üretme; her sürümü önizleme, yeniden üretme ve indirme |
| Digital Avatar | Geliştiriliyor | Senaryo, ses ve avatar sunumunu birleştirerek konuşan kişi videoları üretme |

## Üretim Şablonları

Her istemi ve ayarı sıfırdan oluşturmak yerine bir şablonla üretime başlayın. Video üretimi ve görsel tasarım gibi kategorilerde öne çıkan şablonları inceleyerek fikrinize uygun bir başlangıç noktası bulun.

Koleksiyon, OpenCreator ve bağımsız üreticiler tarafından hazırlanan şablonları bir araya getirir. Üçüncü taraf şablonlar, ayrıntı sayfasında üreticilerini belirtir ve özgün kaynağa bağlantı verir.

Bir şablonu açarak örnek sonucu, istemi, ayarları, etiketleri, yazarı ve özgün kaynağı inceleyin. Kendi çalışmanızı başlatmak için **Use this template** seçeneğini kullanın, ardından girdileri çalışmanıza göre ayarlayın.

![Örnek sonuç, ayarlar ve istem içeren görsel üretim şablonu ayrıntıları](../images/product/creation-templates-detail-apex-summit-en.png)

## Skills

İçerik üretim araçları görsel kontroller sunar; Skills ise Agent'a yeniden kullanılabilir talimatlar ve araç iş akışları sağlar. Depo, video üretim Skills'lerinin yanı sıra yerel Codex Skills'lerini yönetme desteği içerir.

Depodaki [skills/](../../skills/) klasörü, gömülü KrillinAI CLI ile çalışan Agent'lar için yeniden kullanılabilir talimatlar içerir.

| Skill | Yetenekler |
| --- | --- |
| [KrillinAI CLI](../../skills/krillinai-cli/SKILL.md) | Komut seçme, yapılandırmayı denetleme, ilerleme, manifest, çıktı ve hataları yorumlama |
| [Subtitle](../../skills/krillinai-subtitle/SKILL.md) | Platform altyazılarını indirme veya medyayı yazıya dökme, altyazı çevirme, çift dilli ve kısa dikey altyazı üretme |
| [TTS](../../skills/krillinai-tts/SKILL.md) | Altyazılardan hedef dil dublajı üretme ve isteğe bağlı dublajlı video oluşturma |
| [Landscape Render](../../skills/krillinai-render-horizontal/SKILL.md) | Çift dilli altyazı veya dublajlı ses ve hedef dil altyazılarıyla yatay video oluşturma |
| [Portrait Render](../../skills/krillinai-render-vertical/SKILL.md) | Başlık, çift dilli altyazı veya dublajla dikey video oluşturma |
| [Cover](../../skills/krillinai-cover/SKILL.md) | Eksiksiz bir metin isteminden kapak görseli üretme ve son istemi kaydetme |
| [Pipeline Plan](../../skills/krillinai-pipeline/SKILL.md) | Çok aşamalı çıktı planını deneme modunda doğrulama; gerçek işi aşama Skills'leriyle yürütme |

### Kendi Skills'lerinizi Genişletin

OpenCreator, sabit araçlarla sınırlı kalmadan `SKILL.md` ile tanımlanan yerel Codex Skills'lerini destekler. Kullanılabilirlik etkin Codex home ve yüklü Skills'e bağlıdır; video iş akışı Skills'leri CLI ve ilgili servislerin yapılandırılmasını gerektirir. Bir Skill'in depoda bulunması, otomatik olarak yüklendiği veya tüm harici servislerin pakete dahil olduğu anlamına gelmez.

## Görüşme ve Çalışma Alanı Birlikte İlerler

Görevleri doğal dille anlatın, gerektiğinde ayrıntılı kontrol için görsel araçlara geçin.

![OpenCreator görüşmesi ve görsel çalışma alanı birlikte çalışır](../images/examples/opencreator-auto-clips-en.png)

### Ayrıntılı çalışma alanı kontrolleri

Altyazıları, sahneleri, sesi ve üretim ayarlarını hassas biçimde düzenleyin.

### Görüşmeyle esnek düzenleme

Agent'a neyi değiştirmesi gerektiğini söyleyin ve sonucu doğal dille iyileştirin.

### Senkronize durum

Görüşme ve çalışma alanı güncel görev durumunu paylaşır; hiçbir şeyi tekrar anlatmanız gerekmez.

### Bağımsız sürümler

Her revizyon önceki sonuçları veya ayarları ezmeden ayrı bir sürüm oluşturur.

## Desteklenen Modeller

Dil modeli kullanılabilirliği Codex model kataloğuna veya OpenAI uyumlu sağlayıcınıza bağlıdır. Görsel, video, ses ve transkripsiyon modelleri **Settings → AI Services** bölümünde yapılandırdığınız servisleri kullanır.

Gösterilen sağlayıcılar örnektir; gerçek kullanılabilirlik kimlik bilgilerinize, sağlayıcı hesabınıza ve platforma bağlıdır.

### Dil modelleri

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

### Görsel

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

### Ses ve transkripsiyon

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

Yerel transkripsiyon için kullanılabilir olduğunda faster-whisper, WhisperKit ve whisper.cpp de desteklenir.

## Örnekler

### Video Çevirisi

Aşağıdaki herkese açık örnekler, OpenCreator hâlâ KrillinAI adıyla bilinirken üretildi. OpenCreator'ın Video Translation çalışma alanının daha geniş Agent iş akışına taşıdığı altyazı hizalama, çeviri, dublaj ve dikey video iş akışını gösterirler.

Proje, aşağıdaki altyazı dosyasını 46 dakikalık yerel bir videodan tek çalıştırmada, elle altyazı düzeltmesi yapmadan oluşturdu. Yayımlanan sonuç; tam kapsam, üst üste binmeyen satırlar, doğal bölümlendirme ve yüksek kaliteli çeviri sunar.

![OpenCreator altyazı hizalama örneği](../images/examples/krillinai-subtitle-alignment.png)

<table width="100%">
<tr>
<td width="33%">

#### Altyazı Çevirisi

https://github.com/user-attachments/assets/bba1ac0a-fe6b-4947-b58d-ba99306d0339

</td>
<td width="33%">

#### Dublaj

https://github.com/user-attachments/assets/0b32fad3-c3ad-4b6a-abf0-0865f0dd2385

</td>
<td width="33%">

#### Dikey Mod

https://github.com/user-attachments/assets/c2c7b528-0ef8-4ba9-b8ac-f9f92f6d4e71

</td>
</tr>
</table>

> Bu video örnekleri ve altyazı hizalama görseli, OpenCreator hâlâ KrillinAI adını kullanırken üretildi.

### Video İndirme

Desteklenen 10 platformdaki herkese açık video bağlantılarını analiz edin, kullanılabilir formatları karşılaştırın ve video ya da sesi doğrudan projenize indirin.

Desteklenen video kaynakları:

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

Kullanılabilirlik videoya ve bölgeye göre değişir; bazı kaynaklar platform çerezleri gerektirebilir.

![OpenCreator Video Downloader format seçimi](../images/examples/video-downloader-formats-and-subtitles-en.png)

### Video Üretimi

Seedance ile metin istemi veya referans görselden video üretin; model, en-boy oranı, çözünürlük ve süreyi ayarlayın, ardından her sürümü önizleyin, yeniden üretin veya indirin.

![Seedance ile OpenCreator video üretimi](../images/examples/video-generation-seedance-en.png)

### Çöp Adam Animasyonu

OpenCreator, bu özgün karakter koleksiyonunu [Stickman on Behance](https://www.behance.net/gallery/254715463/Stickman) eserinin yaratıcısı [Harbor Hsia](https://www.behance.net/xiaheyuan1) ile birlikte geliştirdi. Yerleşik karakter kadrosu, animasyon iş akışı boyunca karakter kimliklerini tutarlı tutar.

![Sanatçılarla birlikte geliştirilen OpenCreator çöp adam karakterleri](../images/examples/stick-figure-characters.webp)

Metin veya YouTube içeriğini; senaryo incelemesi, anlatım, zamanlama, storyboard görselleri, altyazılar, render ve indirilebilir video çıktısı içeren yönlendirmeli bir iş akışıyla eksiksiz animasyona dönüştürün.

![OpenCreator çöp adam animasyonu örnek karesi](../images/examples/stick-figure-animation-frame.jpg)

## Hızlı Başlangıç

### Desktop Uygulamasını Kurma

[En yeni OpenCreator sürümünden](https://github.com/krillinai/OpenCreator/releases/latest) platformunuza uygun yükleyiciyi indirin (macOS Apple Silicon, macOS Intel veya Windows x64). Kurup uygulamayı açın; Desktop uygulamasını kullanmak için Node.js veya pnpm gerekmez. Desktop paketi Codex CLI içerir; gerçek model görevleri için kullanılabilir bir ChatGPT oturumu veya API anahtarı yapılandırması gerekir.

İlk açılışta Desktop yerel Runtime'ı başlatır, varsayılan projeyi hazırlar ve yerel Codex yapılandırmanızı denetler. Kullanılabilir bir oturum veya API anahtarı ve model ayarları bulursa bunları yeniden kullanmak için **Use local Codex and continue** seçeneğini onaylayın. Aynı başlangıç akışında başka bir sağlayıcı da yapılandırabilirsiniz:

![OpenCreator Desktop ilk açılış model sağlayıcısı kurulumu](../images/product/opencreator-codex-setup.png)

Kurulumdan sonra görevi başlatmak için giriş alanına isteğinizi yazın. Sorun yaşarsanız [kullanıcı kılavuzu ve sorun giderme](../opencreator-user-guide-and-troubleshooting.md) belgesine bakın.

### Web'i Kaynaktan Çalıştırma

Geliştirme veya tarayıcı üzerinden kullanım için kurun:

- Node.js 22 veya daha yeni bir sürüm
- Deponun `packageManager` alanında sabitlenen pnpm 9.15.0
- Terminalinizden erişilebilen bir Codex CLI çalıştırılabilir dosyası
- Gerçek model görevleri için geçerli bir Codex CLI oturumu

Önce yerel ortamınızı denetleyin:

~~~bash
node --version
pnpm --version
codex --version
~~~

~~~bash
git clone https://github.com/krillinai/OpenCreator.git
cd OpenCreator
corepack enable
pnpm install
pnpm web:dev
~~~

`http://127.0.0.1:19861/` adresini açın. Geliştirme sunucusu yerel daemon'ı gerektiğinde başlatır ve aynı kaynaktan çalışan proxy üzerinden geçici bir Runtime token'ı sağlar; bağlantı token'ını elle kopyalamanız gerekmez.

İlk açılışta Runtime varsayılan projeyi hazırlar ve yerel Codex ayarlarını denetler. Yerel Codex'i kullanmak için mevcut ChatGPT oturumunu veya API anahtarını onaylayın ya da bir sağlayıcı seçerek model, endpoint ve API anahtarını girin. Kurulumdan sonra giriş alanı hazırdır. Yalnızca daemon üzerinde çalışmak için:

~~~bash
pnpm daemon:dev
~~~

Daemon yalnızca loopback adresinde dinler ve bağlantı adresiyle geçici token'ı standart çıktıya bir kez yazar.

## Desktop

Desktop ve tarayıcı, `apps/web` içindeki aynı React frontend'i kullanır. Ortak proje, görüşme, görev ve ayarlar aynı Daemon/API'yi çağırır. Electron yalnızca gerçek sistem yolları, pencere kontrolleri, sistem tepsisi ve yerel bildirimler ekler.

### Geliştirme Modu

~~~bash
pnpm desktop:dev
~~~

### Yerel Paketleme

| Komut | Çıktı |
| --- | --- |
| `pnpm desktop:package` | Yerel doğrulama için mevcut platformda çalıştırılabilir bir klasör |
| `pnpm desktop:dist` | Mevcut platform için bir yükleyici |
| `pnpm desktop:release` | Resmî sürüm paketleme giriş noktası |
| `pnpm --filter @opencreator/desktop verify:package` | Mevcut Desktop paketinin doğrulanması |
| `pnpm krillinai:package` | Seçili platform için ayrı KrillinAI Server ve CLI arşivleri |

Desktop paketleme, mevcut çalışma alanından Web'i yeniden derler; commit, dirty durumu, platform, mimari ve Web hash'ini kaydeder; `apps/web/dist` ile uygulamaya gömülen kaynakları karşılaştırır. Fark varsa paketleme başarısız olur. İmzalama, noter onayı, Windows derlemeleri ve yayın gereksinimleri için [Desktop yayın kılavuzuna](../operations/opencreator-desktop-release-runbook.md) bakın.

## Temel İş Akışları

### Görüşmeler ve Runs

1. Bir proje seçin veya yeni bir görüşme başlatın.
2. Görevi girin; izin düzeyini, Profile'ı, modeli ve akıl yürütme düzeyini seçin.
3. Run çalışırken takip görevlerini sıraya alın veya görevi kesip hemen devam edin.
4. Timeline üzerinden akıl yürütme özetlerini, araç çağrılarını, dosya değişikliklerini, onayları ve sonuçları inceleyin.
5. Görev merkezinden çalışan, tamamlanan, başarısız olan ve onay bekleyen görevleri genel olarak izleyin.

### Skills ve MCP

- Eklenti merkezinden Skill pazarını, kurulum geçmişini ve yerelde kullanılabilir Skills'i inceleyin.
- Bir sonraki görevin iş akışını izlemesi için giriş alanından `/` veya ekleme menüsüyle bir Skill seçin.
- MCP yönetimi, ikinci bir yürütme motoru yerine Codex'in kendi komutları ve yapılandırmasını kullanır.
- OpenCreator varsayılan olarak etkin `$CODEX_HOME` dizinini kullanır; genel Skills veya MCP yapılandırmasını değiştirmeden önce etkisini doğrulayın.

### Zamanlamalar ve Özel Görev Konuları

- Her zamanlama, kalıcı ve kendisine ayrılmış bir OpenCreator görüşmesine sahiptir.
- Otomatik tetiklemeler, elle çalıştırmalar ve kullanıcı takip görevleri aynı görüşmeyi yeniden kullanır; `queue` veya `skip` politikasıyla sırayla çalışır.
- Zamanlamanın silinmesi, ayrılmış görüşmeyi arşivler; mevcut Runs, sonuçlar ve temel Codex geçmişini korur.
- Temel Codex thread'inin yenilenmesi veya kurtarılması, OpenCreator görev girişini veya sayfa yolunu değiştirmez.

## OpenCreator Sistem Mimarisi

OpenCreator, görsel çalışma alanını ve Agent görüşmesini aynı yaratıcı görevin iki arayüzü olarak ele alır. Her içerik üretim iş akışı bir state machine olarak modellenir: kaynak girdisi, yapılandırma, üretim, inceleme, revizyon ve dışa aktarma açık durumlara ve olaylara dönüşür. Çalışma alanı eylemleri ve görüşme komutları aynı state machine'e girer; güncel adım, yapılandırma, ilerleme, sürümler ve sonuçlar iki arayüze de yansıtılır. Böylece ikinci bir doğruluk kaynağı oluşturmadan çalışma alanı ve görüşme senkronize kalır.

Yaratıcı çalışmalar yinelemelidir; revizyonlar mevcut sonucu ezmez. Her düzeltme veya yeniden üretim, mevcut iş akışı durumundan yeni bir sürüm oluşturur ve önceki sürümlerin ayarlarını ve çıktılarını inceleme, karşılaştırma ve geliştirmeye devam etmek için korur.

~~~text
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
~~~

| OpenCreator Bileşeni | Sorumluluk | Uygulama |
| --- | --- | --- |
| Creator Experience | Dashboard, içerik üretim araçları, Agent görüşmesi, ayarlar ve dosyalar | `apps/web` · React 18 · Vite · TypeScript |
| Collaboration Core | Çalışma alanı adımlarını, görüşme bağlamını, ilerlemeyi, sonuçları ve revizyonları senkronize tutar | Ortak iş akışı durumu · `CreatorCollaborationPanel` · sürüm geçmişi |
| Local Runtime | Projeleri, Runs, onayları, zamanlamaları, belleği ve bildirimleri yönetir | `apps/daemon` · Fastify · Runtime API · SSE |
| Runtime bileşenleri | Paketlenmiş, etkin ve en yeni sürümleri takip eder; düzenli denetler ve yalnızca kullanıcının istediği güncellemeleri kurar | yt-dlp nightly · güncelleme doğrulama · çalışan sürüme geri dönüş |
| Codex Engine | Agent döngüsü, oturumlar, akıl yürütme, araçlar, Skills ve MCP | Codex CLI · app-server |
| Medya araç zinciri | Yaratıcı medyayı indirir, yazıya döker, dönüştürür, üretir ve dışa aktarır | yt-dlp · Whisper · FFmpeg · yapılandırılmış AI servisleri |
| Yerel veri | Proje verilerini, Runs, ekleri, çıktıları ve kimlik bilgilerini yerelde saklar | SQLite · dosya sistemi · sistem kimlik bilgisi deposu |
| Desktop Host | Ortak Web derlemesini yükler ve işletim sistemi yeteneklerini ekler | `apps/desktop` · Electron · Preload Bridge |

Temel ilkeler:

- Çalışma alanı ve Agent görüşmesi aynı iş akışı durumunun senkronize görünümleridir; paralel görev durumları tutmak yerine aynı state machine'e olay gönderirler.
- Revizyonlar eski sonuçların üzerine yazmak yerine yeni sürümler oluşturur; her yaratıcı yinelemenin bağlamını ve çıktısını korur.
- Frontend doğrudan Codex başlatmaz ve ham Codex JSONL olaylarına bağlı değildir.
- Daemon süreç yaşam döngüsünü, olayların normalleştirilmesini, kalıcılığı, onayları ve bildirim kuyruğunu yönetir.
- Codex, Agent döngüsü, Skills ve MCP için yürütmenin kaynağı olmaya devam eder.
- Browser Bridge ve Desktop Bridge genel ürün mantığını ayrı ayrı uygulamaz.

## Depo Yapısı

~~~text
OpenCreator/
├── apps/
│   ├── web/          # Tek React frontend uygulaması
│   ├── daemon/       # Yerel Fastify Runtime ve Codex adaptörü
│   ├── desktop/      # Electron Main, Preload, yerel yetenekler ve paketleme
│   └── harness/      # Runtime komut satırı doğrulama aracı
├── packages/
│   ├── protocol/     # Web, Daemon ve Desktop arasında paylaşılan sözleşmeler
│   └── skill-market/ # Skill pazaryeri modelleri ve ortak mantık
├── docs/             # Tasarım belgeleri, API referansları ve çalışma kılavuzları
├── scripts/          # Depo seviyesindeki denetimler
└── .runtime/         # İlk çalıştırmada oluşturulan yerel Runtime verileri
~~~

## Yapılandırma

### AI Servisi API Anahtarları

Kullanılan model, transkripsiyon, ses ve görsel sağlayıcılarını **Settings → AI Services** bölümünden yapılandırın. Seçilen sağlayıcıya göre Base URL, API Key, model, proxy veya sağlayıcıya özel kimlik bilgileri istenir.

![OpenCreator AI Services ayarları](../images/product/opencreator-ai-services-en.png)

Kimlik bilgileri yerel Runtime'ın sistem kimlik bilgisi deposunda saklanır ve depoya kesinlikle commit edilmemelidir. Edge TTS gibi bazı yerel veya sistem tabanlı sağlayıcılar API anahtarı gerektirmez.

### Hesaplar ve Abonelikler

Kişisel merkez; hesabınızı, doğrulanmış aboneliğinizi ve kullanılabilir kredilerinizi gösterir. Oturum açma işlemi tarayıcınızda `https://www.open-creator.ai/device` adresini açar. Web sitesinde oturum açıp cihazı onaylayın; yerel Daemon kendi oturumunu alır. Tarayıcı ve istemci aynı hesabı paylaşır ancak bağımsız oturumlar kullanır.

Abonelik planları OpenCreator içinde seçilir. Satın alma Stripe Checkout'u, abonelik yönetimi ise Stripe Billing Portal'ı açar. İstemci ödeme dönüşleri, web sitesi oturumu gerektirmeden sitenin `/billing/return` sayfasını kullanır. OpenCreator, doğrulanmış Stripe bildirimlerinden sonra hakları Gateway üzerinden yeniler. Web sitesinin `/pricing` ve `/account` sayfaları aynı abonelik altyapısına başka bir satın alma girişi sağlar.

### Üçüncü Taraf Runtime Bileşenleri

**Settings → Third-party Components** bölümünden kullanılan yt-dlp nightly sürümünü, OpenCreator ile paketlenmiş sürümü, kaynağını ve en yeni sürümü inceleyin. OpenCreator yedi günde bir güncelleme kontrolü yapar ancak otomatik kurulum yapmaz. Güncellemeler açık kullanıcı eylemi gerektirir; indirme, doğrulama veya kurulum başarısız olursa çalışan sürüm korunur.

![OpenCreator üçüncü taraf bileşen ayarları](../images/product/opencreator-third-party-components-en.png)

### Runtime Ortam Değişkenleri

Çoğu kullanıcı ortam değişkenlerine ihtiyaç duymaz. Yalıtılmış veri, belirli bir Codex çalıştırılabilir dosyası veya özel proje dizini gerektiğinde kullanabilirsiniz:

| Değişken | Varsayılan | Amaç |
| --- | --- | --- |
| `OPENCREATOR_DATA_DIR` | `.runtime` | OpenCreator veritabanı, Runs, ekler ve yönetilen çalışma alanları |
| `OPENCREATOR_GATEWAY_ORIGIN` | `https://www.open-creator.ai` | Hesap oturumu, abonelikler, krediler ve resmî model servisleri için Gateway; yerel Gateway kullanmak için değiştirilebilir |
| `OPENCREATOR_CODEX_BIN` | `codex` | Codex CLI çalıştırılabilir dosyasının yolu |
| `CODEX_HOME` | `~/.codex` | Codex oturumları, yapılandırma, Skills, MCP ve Profiles için doğruluk kaynağı |
| `OPENCREATOR_DEFAULT_CWD` | Geçerli çalışma dizini | Varsayılan daemon çalışma dizini |
| `OPENCREATOR_DEFAULT_PROJECT_ROOT` | Runtime'ın varsayılan politikası | Yönetilen proje kökü; ayarlandığında OpenCreator bunun `OpenCreator/` alt dizinini kullanır |
| `OPENCREATOR_CODEX_THREAD_ROTATION_RUN_THRESHOLD` | `50` | Uzun süreli zamanlamanın Codex thread'ini yenilemek için sonlanmış Run eşiği; `0` ile proaktif yenileme kapatılır |

Örnek:

~~~bash
OPENCREATOR_DATA_DIR=/path/to/opencreator-data \
CODEX_HOME=/path/to/codex-home \
pnpm web:dev
~~~

## Veri ve Güvenlik

Runtime verileri varsayılan olarak depo kökündeki `.runtime/` altında saklanır:

| Yol | İçerik |
| --- | --- |
| `.runtime/app.sqlite` | Projeler, görüşmeler, Runs, olaylar, zamanlamalar, bildirimler, ek meta verileri, onaylar, bellek ve özetler |
| `.runtime/runs/` | Hassas bilgileri ayıklanmış günlükler, tanılama verileri ve Run meta verileri |
| `.runtime/attachments/` | Kontrollü ek dosyaları |
| `.runtime/workspaces/` | Runtime tarafından yönetilen proje çalışma alanları |

Codex oturumları ve yapılandırması `$CODEX_HOME` içinde kalır; `.runtime/` klasöründen ayrı yedeklenmelidir.

Güvenlik sınırları:

- Daemon yalnızca 127.0.0.1 üzerinde dinler; sağlık denetimi dışındaki API'ler Bearer token gerektirir.
- HTML önizleme komut dosyalarını, gezinmeyi ve açılır pencereleri varsayılan olarak devre dışı bırakır; yalnızca aynı çalışma alanındaki kontrollü göreli kaynaklara izin verir.
- Hassas bellek ikinci bir onay gerektirir; OpenCreator doğrulanmamış önerileri kalıcı olarak otomatik saklamaz.
- Tanılama ve Run günlükleri döndürülmeden veya dışa aktarılmadan önce hassas bilgileri ayıklar.
- Desktop paketlerinde ASAR bütünlüğü ve çerez şifrelemesi etkinleştirilir; RunAsNode, NODE_OPTIONS ve Node CLI Inspector devre dışıdır.

Yedekleme, geri yükleme, temizleme ve sıfırlama için [kullanıcı kılavuzuna ve sorun giderme referansına](../opencreator-user-guide-and-troubleshooting.md) bakın.

## Geliştirme

### Sık Kullanılan Komutlar

| Komut | Amaç |
| --- | --- |
| `pnpm web:dev` | Web'i başlatır ve yerel daemon'ı gerektiğinde açar |
| `pnpm daemon:dev` | Yalnızca daemon'ı başlatır |
| `pnpm desktop:dev` | Bağımlılıkları derler ve Electron'u geliştirme modunda açar |
| `pnpm test` | Workspace birim ve entegrasyon testlerini çalıştırır |
| `pnpm typecheck` | Depodaki TypeScript kontrollerini çalıştırır |
| `pnpm build` | Tüm workspace'leri derler |
| `pnpm e2e` | Web Playwright E2E testlerini çalıştırır |
| `pnpm smoke:ci` | Sahte Codex Runtime smoke testini çalıştırır |
| `pnpm perf:check` | Kayıtlı performans temelini kontrol eder |

Değişiklik göndermeden önce [katkı rehberinde](../../CONTRIBUTING.md#what-reviewers-check) açıklandığı gibi etkisine uygun doğrulamayı seçin. Belgeleme, metin ve stil değişiklikleri için ilgili kontroller yeterlidir; ortak davranış ve Runtime değişiklikleri hedefli modül testleri ve typecheck gerektirir. Etkilenen kapsam gerektirdiğinde tüm workspace testlerini veya derlemelerini çalıştırın ve PR açıklamasında çalıştırdığınız kontrolleri belirtin.

Desktop, Host Bridge, Runtime proxy veya ortak frontend iş akışlarındaki değişiklikler ayrıca Web/Desktop tutarlılık testleri, paketlenmiş uygulama E2E testleri ve Web derleme hash doğrulaması gerektirir. Yalnızca Web birim testlerinin geçmesi, Desktop sürümünün hazır olduğunu göstermez.

Gerçek Codex smoke testi varsayılan olarak kapalıdır. Açıkça etkinleştirmek için:

~~~bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
~~~

## Belgeler

- **OpenCreator'ı kullanın:** [Hızlı Başlangıç](#hızlı-başlangıç) · [Kullanıcı kılavuzu ve sorun giderme](../opencreator-user-guide-and-troubleshooting.md)
- **Geliştirin ve genişletin:** [Katkı rehberi](../../CONTRIBUTING.md) · [Davranış kuralları](../../CODE_OF_CONDUCT.md) · [Skill katkısı](../contributing/skills-contributing.md) · [Üretim şablonu katkısı](../contributing/templates-contributing.md) · [Runtime API v1](../runtime-api-for-ui-v1.md) · [Görsel bileşen yönergeleri](../visual-component-guidelines.md)
- **Bakım ve yayın:** [Codex-native Runtime tasarımı](../2026-07-03-codex-native-agent-runtime-design.md) · [Desktop yayın kılavuzu](../operations/opencreator-desktop-release-runbook.md) · [Windows Desktop yayın rehberi](../operations/opencreator-desktop-windows-release.md)

## Çeviri İlkesi

Kök `README.md` dosyası kanonik İngilizce belgedir. Bakımı yapılan çeviriler `docs/<locale>/README.md` altında tutulur. Bir dili seçiciye yalnızca belge tamamen çevrildikten ve İngilizce yapıyla senkronize edildikten sonra ekleyin.

## Topluluk

<p>GitHub'da OpenCreator'a <strong>en az 107 ülke ve bölgeden</strong> kullanıcı yıldız vermiştir.</p>

<img src="../images/star-coverage-map.svg" alt="OpenCreator GitHub yıldızlarının geldiği ülke ve bölgeleri gösteren dünya haritası" width="760" />

### Ekip

Her ekip üyesi kendi alanından, standartlarından, katkı incelemelerinden ve topluluk desteğinden sorumludur.

<table border="1" cellpadding="12">
  <tr>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/wulien.svg" width="64" height="64" alt="wulien avatar" /><br /><a href="https://github.com/wulien">wulien</a><br />Kod ve hata düzeltmeleri</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/dle-kb.svg" width="64" height="64" alt="DLe-kb avatar" /><br /><a href="https://github.com/DLe-kb">DLe-kb</a><br />Üretim şablonları</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/xiaheyuan.svg" width="64" height="64" alt="xiaheyuan avatar" /><br /><a href="https://github.com/xiaheyuan">xiaheyuan</a><br />Tasarım ve varlıklar</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/krillinai.svg" width="64" height="64" alt="krillinai avatar" /><br /><a href="https://github.com/krillinai">krillinai</a><br />Skills ve belgeler</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/hbxugang.svg" width="64" height="64" alt="hbxugang avatar" /><br /><a href="https://github.com/hbxugang">hbxugang</a><br />Kurumsal dağıtım</td>
  </tr>
</table>

### Katkıda Bulunanlar

Kod, belge, geri bildirim, issue, Skills, çizimler ve fikirleriyle katkı sağlayan herkese teşekkürler. Bu README listesi, GitHub'ın otomatik oluşturduğu Contributors grafiğinden bağımsız olarak yönetilir.

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

### Katkı Sağlama

Katkılar şu alanlarda memnuniyetle karşılanır:

| Tür | Katkı | Konum | Gönderim biçimi |
| --- | --- | --- | --- |
| Kod | Hata düzeltmeleri, üretim iş akışları ve ortak özellikler | `apps/web/`, `apps/daemon/` | Test içeren tek odaklı PR |
| Skills | Yeniden kullanılabilir Agent iş akışları | [skills/](../../skills/) | `SKILL.md` ve isteğe bağlı referanslar içeren tek klasör → [rehber](../contributing/skills-contributing.md) |
| Üretim şablonları | Görsel, video veya kapak şablonları | [template/](../../template/) | `template.json` ve varlıkları içeren klasör → [rehber](../contributing/templates-contributing.md) |
| Görsel ve tasarım | Özgün çizimler, ikonlar veya UI tasarımları | Kararlaştırılan varlık konumu | Önizleme, kaynak dosya ve lisans içeren PR |
| Üçüncü taraf servisleri | AI veya medya sağlayıcısı desteği | İlgili Web veya Daemon modülü | Hata yönetimi, kimlik bilgisi güvenliği ve testler |
| Belgeler ve çeviriler | Belge geliştirmeleri veya yeni yerel ayarlar | `README.md`, `docs/`, `docs/<locale>/` | Tek PR |

Yerel kurulum, inceleme ölçütleri ve sık reddedilme nedenleri için [CONTRIBUTING.md](../../CONTRIBUTING.md) dosyasına bakın ([10 dilde](../zh/CONTRIBUTING.md) mevcuttur).

## Star Geçmişi

OpenCreator daha önce KrillinAI olarak adlandırılıyordu. Bu grafik, yeniden adlandırma öncesi ve sonrasındaki depo geçmişini kapsar.

[![OpenCreator Star Geçmişi](https://api.star-history.com/svg?repos=krillinai/OpenCreator&type=date)](https://www.star-history.com/?type=date&repos=krillinai%2FOpenCreator)

## İlgili Projeler

| Proje | Rol |
| --- | --- |
| [OpenAI Codex](https://github.com/openai/codex) | Model erişimi, akıl yürütme, araç çağrıları, oturumlar, Skills ve MCP entegrasyonunun arkasındaki Agent yürütme motoru |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Herkese açık medya bağlantılarını analiz eder ve içerik iş akışları için video veya ses indirir |
| [FFmpeg](https://ffmpeg.org/) | Medya dönüştürme, kompozisyon, kare çıkarma ve çıktı doğrulama |
| [Whisper](https://github.com/openai/whisper), [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [faster-whisper](https://github.com/SYSTRAN/faster-whisper) ve [WhisperKit](https://github.com/argmaxinc/WhisperKit) | Yerel ve bulut tabanlı konuşma transkripsiyonu seçenekleri |
| [React](https://react.dev/) | Web ve Desktop deneyimlerinin ortak kullanıcı arayüzü temeli |
| [Fastify](https://fastify.dev/) | Yerel Runtime'ın HTTP ve API temeli |
| [Electron](https://www.electronjs.org/) | Yerel yetenekler, uygulama yaşam döngüsü ve paketleme için Desktop host |
| [SQLite](https://www.sqlite.org/) | Projeler, görüşmeler, Runs, zamanlamalar, bellek ve çalışma alanı verileri için yerel kalıcılık |
| [Model Context Protocol](https://modelcontextprotocol.io/) | Harici araçları ve servisleri Agent çalışma alanına bağlayan açık protokol |

---

<div align="center">

**OpenCreator · Yerel üret, kesintisiz çalış.**

</div>
