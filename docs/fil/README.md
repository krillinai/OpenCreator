<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../images/OpenCreator_logo_vector_dark.svg" />
    <img src="../images/OpenCreator_logo_vector.svg" alt="OpenCreator" width="380" />
  </picture>
  <br />
  Open-source na AI workspace at Skills para sa mga creator
</h1>

<p>Pagsamahin ang mga biswal na setting, muling magagamit na Skills, at Agent para sa script, video, larawan, boses, pagsasalin, at pag-edit sa iisang workspace.</p>

<p><strong>Dating kilala ang OpenCreator bilang KrillinAI.</strong></p>

<a href="https://trendshift.io/repositories/13360" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13360" alt="OpenCreator, dating KrillinAI: nangungunang repository ng araw sa Trendshift" width="250" height="55" /></a>

[English](../../README.md) | [简体中文](../zh/README.md) | [日本語](../ja/README.md) | [한국어](../ko/README.md) | [Bahasa Indonesia](../id/README.md) | [Español](../es/README.md) | [Français](../fr/README.md) | [Deutsch](../de/README.md) | [Português](../pt/README.md) | [Русский](../ru/README.md) | [العربية](../ar/README.md) | [ภาษาไทย](../th/README.md) | [Türkçe](../tr/README.md) | [हिन्दी](../hi/README.md) | [বাংলা](../bn/README.md) | [اردو](../ur/README.md) | [Tiếng Việt](../vi/README.md) | **Filipino**

[![GitHub Stars](https://badgen.net/github/stars/krillinai/OpenCreator?icon=github&label=Stars&color=EAB308)](https://github.com/krillinai/OpenCreator/stargazers)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Bilibili](https://img.shields.io/badge/dynamic/json?label=Bilibili&query=%24.data.follower&suffix=%E7%B2%89%E4%B8%9D&url=https%3A%2F%2Fapi.bilibili.com%2Fx%2Frelation%2Fstat%3Fvmid%3D242124650&logo=bilibili&color=00A1D6&labelColor=FE7398&logoColor=FFFFFF)](https://space.bilibili.com/242124650)
[![AtomGit G-Star](https://img.shields.io/badge/AtomGit-G--Star-DA203E?style=flat)](https://atomgit.com/krillinai/OpenCreator)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/fUNvbqDaw)
[![Grupo sa QQ](https://img.shields.io/badge/QQ%20群-754069680-green?logo=tencent-qq)](https://qm.qq.com/q/W4YC0PLMeA)

[Mga tampok](#project-highlights) · [Mga tool](#creator-tools) · [Skills](#skills) · [Mga halimbawa](#examples) · [Pagsisimula](#quick-start) · [Desktop](#desktop) · [Dokumentasyon](#documentation) · [Komunidad](#community)

</div>

![Agent workspace ng OpenCreator](../images/opencreator-home-en.png)

<a id="project-overview"></a>

## Pangkalahatang ideya ng proyekto

Ang OpenCreator ay para sa mga indibidwal at pangkat na gustong gawin nang lokal ang paglikha at pag-develop. Ginagamit nito ang Codex CLI bilang execution engine at dinaragdagan ito ng matatag na lokal na Runtime, biswal na workspace, at Desktop host, sa halip na buuing muli ang Agent loop.

May dalawang magkaugnay na paraan ng pagtatrabaho sa OpenCreator:

- **Content workspace**: gumamit ng biswal na tool at template para sa pagsasalin at pag-download ng video, pagbuo ng larawan at video, voiceover, pagsulat ng artikulo at social post, script ng maikling video, at stick figure animation.
- **Pag-uusap sa Agent**: magsimula at gumabay ng malikhaing gawain o pag-develop gamit ang natural na wika; ayusin ang usapan ayon sa proyekto, hayaang tumakbo sa background ang mga Run, at pamahalaan ang pag-apruba, attachment, file, Skills, MCP, iskedyul, notification, memorya, at diagnostic sa iisang lugar.

Web ang nag-iisang implementasyon ng frontend. Parehong Web build ang nilo-load ng Desktop, na nagdaragdag ng mga kakayahang nangangailangan ng operating system: pagpili ng directory, lifecycle ng window, system tray, at native notification. Kapag pareho ang datos at laki ng content viewport, pareho rin ang pangkalahatang UI at kilos ng Runtime sa dalawang platform.

<a id="project-highlights"></a>

## Mga tampok ng proyekto

- 🤖 **Nakabatay sa Codex**: muling gamitin ang Agent loop, modelo, reasoning, tool call, usapan, Skills, at MCP ng Codex nang walang ikalawang execution engine na kailangang panatilihin.

- 🚀 **Desktop app na handang gamitin**: kasama na ang Codex CLI; kusang nagsisimula ang lokal na Runtime kapag kailangan at naghahanda ng default na proyekto.

- ⚙️ **Muling paggamit ng Codex setup**: sa unang pagbukas, sinusuri ang lokal na Codex configuration at iniaalok ang gumaganang ChatGPT sign-in o API key. May gabay na form para sa ibang provider.

- 🔄 **Pinamamahalaang Runtime component**: tingnan ang kasamang, aktibo, at pinakabagong yt-dlp; suriin ang update nang pana-panahon at manu-manong mag-update. Nananatiling magagamit ang gumaganang bersyon kung pumalya ang update.

- 🎨 **Multimodal na paglikha**: gumawa at mamahala ng video, larawan, audio, subtitle, at dokumento sa magkaugnay na daloy.

- 🧩 **Mga template**: magsimulang gumawa ng larawan at video mula sa muling magagamit na template nang hindi inuulit ang prompt at setting mula sa simula.

- 🔗 **Dalawang paraan ng paggawa**: gamitin ang biswal na workspace o usapan sa Agent; isang shared state machine ang nagsasabay ng hakbang, progreso, at resulta.

- 🕘 **Mga bersyon**: bawat rebisyon ay bagong bersyon; pinananatili ang lumang setting at output para sa pagsusuri at paghahambing.

- 🧩 **Muling magagamit na Skills**: gamitin ang Skills para sa video, palawakin ang Agent gamit ang sariling Skills, at pamahalaan ang MCP sa katutubong configuration ng Codex.

- 🧠 **Memorya**: global, proyekto, at thread na memorya na may buod at snapshot ng input ng Run na maaaring muling likhain.

- 🔐 **Lokal na seguridad**: lokal ang datos, attachment, at log bilang default, na may pag-apruba at diagnostic na tinanggalan ng sensitibong detalye.

- 🌐 **Multilingual na interface**: May 43 wika ang Web at Desktop, na may pagtukoy sa wika ng system, manu-manong pagpili, at kanan-pakaliwang layout para sa Arabic, Persian, Urdu, at Hebrew.

<a id="creator-tools"></a>

## Mga tool para sa creator

May sampung tool para sa creator ang kasalukuyang release. Nakadepende ang mga magagamit na modelo at serbisyo sa lokal na Codex environment at AI service setting.

Buksan ang Dashboard para magsulat ng artikulo, Xiaohongshu post, o script ng maikling video; gumawa ng stick figure animation; magsalin o mag-download ng video; bumuo ng thumbnail, larawan, o video; at lumikha ng voiceover sa Text to Speech.

![Creator Dashboard ng OpenCreator](../images/product/opencreator-dashboard-en.png)

> Patuloy na nadaragdagan ang mga tool para sa creator.

**May 123 pinagmulang wika at 124 target na opsyon ang pagsasalin ng video, kasama ang Pinyin na output.** Maghanap gamit ang katutubong pangalan, Ingles, Tsino, o code ng wika. Nakadepende sa napiling serbisyo at modelo ang saklaw ng pagkilala at pagbuo ng boses.

- **Subtitle lang ang isasalin**: Mag-import at mag-preview ng SRT, saka isalin ito nang walang source video, dubbing, o pag-render ng video.

- **Advanced na pag-edit ng subtitle**: Gumamit ng immersive editor na may waveform at timeline na kasabay ng playback upang ayusin ang oras, hatiin o pagsamahin ang subtitle, at maghanap at magpalit ng teksto. I-preview ang estilo sa video, baguhin ang wika, boses, at output, saka gumawa ng bagong bersyon habang pinapanatili ang mga naunang resulta.

- **Paglikha sa isang pahina**: Itakda ang image generation, video generation, at Text to Speech sa isang pahina, na may pagpili ng modelo, reference preview, mga opsyon ng larawan ayon sa modelo, at voice library na may paghahanap.

- **Multilingual na output at progreso**: Pinapahusay ng kasamang fallback font ang komplikadong script at kanan-pakaliwang subtitle. Subaybayan ang transcription, pagsasalin, dubbing, at pag-render, kasama ang bilang ng natapos at kabuuan kapag available.

<table width="100%">
<thead>
<tr>
<th width="18%">Workspace</th>
<th width="14%">Katayuan</th>
<th width="68%">Mga kakayahan</th>
</tr>
</thead>
<tbody>
<tr><td valign="top">Pagsasalin ng video</td><td valign="top">✅ Magagamit</td><td>Mag-import ng lokal o pampublikong video; mag-transcribe sa cloud o lokal na Whisper; gamitin ang konteksto ng LLM para sa paghahati, pag-align, termino, at pagsasalin ng subtitle; itakda ang bilingguwal na subtitle, dubbing o sariling voice sample, estilo, pahalang/patayong komposisyon; mag-export ng SRT, audio, o video</td></tr>
<tr><td valign="top">Pag-download ng video</td><td valign="top">✅ Magagamit</td><td>Suriin ang indibidwal na pampublikong video mula sa YouTube, Bilibili, X, TikTok, Instagram, Douyin, Facebook, Xiaohongshu, Pinterest, at Reddit; ihambing ang format at mag-download ng video o audio. Maaaring kailanganin ang platform cookie. Kung may subtitle ang platform, tingnan ang listahan at mag-download ng SRT; inuuna ang Ingles, saka ang wika ng interface kung available.</td></tr>
<tr><td valign="top">Pagbuo ng thumbnail</td><td valign="top">✅ Magagamit</td><td>Pagsamahin ang paksa, video link, at opsyonal na reference image para bumuo at maghambing ng mga bersyon ng thumbnail</td></tr>
<tr><td valign="top">Pagbuo ng larawan</td><td valign="top">✅ Magagamit</td><td>Gamitin ang GPT Image / Seedream / Kling Image / Gemini mula sa prompt at opsyonal na reference image; itakda ang aspect ratio at dami, saka i-preview at i-download ang bawat larawan</td></tr>
<tr><td valign="top">Pagsulat ng artikulo</td><td valign="top">✅ Magagamit</td><td>Gawing mae-edit na mga paksa, outline, at buong artikulo ang paksa, link, video, o source document; magdagdag ng nabuong larawan at mag-export ng Markdown, HTML, o PDF</td></tr>
<tr><td valign="top">Mga post sa Xiaohongshu</td><td valign="top">✅ Magagamit</td><td>Gumawa ng buong post mula sa paksa o sanggunian, itakda ang audience, uri, at haba, saka kopyahin o i-download</td></tr>
<tr><td valign="top">Script ng maikling video</td><td valign="top">✅ Magagamit</td><td>Gumawa ng nahating script na handang kunan mula sa paksa o sanggunian, ayon sa audience, platform, tagal, at tono; i-edit, kopyahin, o i-download</td></tr>
<tr><td valign="top">Stick figure animation</td><td valign="top">✅ Magagamit</td><td>Gawing salaysay, boses, storyboard na pare-pareho ang karakter, subtitle, at nada-download na animation ang teksto o YouTube content</td></tr>
<tr><td valign="top">Awtomatikong clip</td><td valign="top">Ginagawa pa</td><td>Suriin ang mahabang video, hanapin ang highlight, at gawing muling magagamit na maikling clip ang mga napiling sandali</td></tr>
<tr><td valign="top">Text to Speech</td><td valign="top">✅ Magagamit</td><td>Gawing voiceover ang script na may pagpili ng boses, bilis, at emosyon</td></tr>
<tr><td valign="top">Pagbuo ng video</td><td valign="top">✅ Magagamit</td><td>Gumawa ng video gamit ang Seedance / Kling / Veo mula sa prompt at reference image; i-preview, buuing muli, at i-download ang bawat bersyon</td></tr>
<tr><td valign="top">Digital na avatar</td><td valign="top">Ginagawa pa</td><td>Pagsamahin ang script, boses, at avatar upang gumawa ng video ng nagsasalitang tauhan</td></tr>
</tbody>
</table>

<a id="creation-templates"></a>

## Mga template para sa paglikha

Magsimula sa template sa halip na buuin ang bawat prompt at setting mula sa simula. Hanapin ang angkop na panimula sa mga tampok na template ayon sa kategorya, kabilang ang video at disenyo ng larawan.

Kasama sa koleksiyon ang mga template ng OpenCreator at ng mga independiyenteng creator. Kinikilala ng pahina ng detalye ang gumawa ng third-party template at may link sa orihinal na sanggunian.

Buksan ang template upang makita ang halimbawang resulta, prompt, setting, tag, may-akda, at orihinal na sanggunian. Piliin ang **Use this template**, saka baguhin ang input para sa iyong gawain.

![Detalye ng template ng larawan na may resulta, setting, at prompt](../images/product/creation-templates-detail-apex-summit-en.png)

<a id="skills"></a>

## Skills

May biswal na kontrol ang mga tool; nagbibigay naman ang Skills ng muling magagamit na tagubilin at daloy ng paggamit ng tool sa Agent. Kasama sa repository ang Skills para sa video production at pamamahala ng lokal na Codex Skills.

Nasa [`skills/`](../../skills/) ang muling magagamit na tagubilin para sa Agent na gumagamit ng naka-embed na KrillinAI CLI.

| Skill | Mga kakayahan |
| --- | --- |
| [KrillinAI CLI](../../skills/krillinai-cli/SKILL.md) | Pumili ng command, suriin ang configuration, at unawain ang progreso, manifest, output, at error |
| [Subtitle](../../skills/krillinai-subtitle/SKILL.md) | Mag-download ng caption o mag-transcribe, magsalin ng subtitle, at gumawa ng bilingguwal o maikling subtitle para sa patayong video |
| [TTS](../../skills/krillinai-tts/SKILL.md) | Gumawa ng dubbing sa target na wika mula sa subtitle at opsyonal na dubbed video |
| [Pahalang na render](../../skills/krillinai-render-horizontal/SKILL.md) | Mag-render ng pahalang na video na may bilingguwal na subtitle o dubbed audio at target-language subtitle |
| [Patayong render](../../skills/krillinai-render-vertical/SKILL.md) | Gumawa ng patayong video na may pamagat, bilingguwal na subtitle, o dubbing |
| [Pabalat](../../skills/krillinai-cover/SKILL.md) | Bumuo ng pabalat mula sa buong text prompt at i-save ang larawan at huling prompt |
| [Plano ng pipeline](../../skills/krillinai-pipeline/SKILL.md) | Suriin ang planong may maraming yugto sa dry-run; gawin ang aktuwal na trabaho sa Skills ng bawat yugto |

<a id="extend-with-your-own-skills"></a>

### Palawakin gamit ang sariling Skills

Sinusuportahan ng OpenCreator ang lokal na Codex Skills na may `SKILL.md`, kaya maaari kang magdagdag ng sariling paraan at daloy. Nakadepende ang magagamit na Skills sa aktibong Codex home at mga naka-install na Skill; kailangan ng video Skills ang naka-configure na CLI at kaugnay na serbisyo. Ang pagkakasama sa repository ay hindi nangangahulugang awtomatikong naka-install ang lahat ng Skill o kasama ang lahat ng panlabas na serbisyo.

<a id="conversation-and-workspace-moving-together"></a>

## Magkasabay ang usapan at workspace

Ilarawan ang gawain nang natural, saka lumipat sa biswal na tool kapag kailangan ng eksaktong kontrol.

![Magkaugnay na usapan at biswal na workspace ng OpenCreator](../images/examples/opencreator-auto-clips-en.png)

<a id="fine-grained-workspace-controls"></a>

### Detalyadong kontrol

Eksaktong ayusin ang subtitle, shot, audio, at generation setting.

<a id="flexible-conversational-edits"></a>

### Pag-edit sa usapan

Sabihin sa Agent ang babaguhin at pinuhin ang resulta sa natural na wika.

<a id="synchronized-state"></a>

### Magkasabay na estado

Pareho ang kasalukuyang estado ng gawain sa usapan at workspace, kaya walang kailangang ulitin.

<a id="independent-versions"></a>

### Hiwalay na mga bersyon

Bawat rebisyon ay hiwalay na bersyon na hindi pinapatungan ang lumang resulta o setting.

<a id="models-supported"></a>

## Mga sinusuportahang modelo

Ang mga language model ay mula sa katalogo ng Codex o sa iyong OpenAI-compatible provider. Ginagamit ng larawan, video, boses, at transcription ang serbisyong itinakda sa **Settings → AI Services**.

Mga halimbawa ang ipinakitang provider at modelo; nakadepende ang aktuwal na availability sa credential, access ng account, at platform.

<a id="language-models"></a>

### Mga language model

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

<a id="image"></a>

### Larawan

<table>
<tr>
<td align="center" width="25%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>GPT Image</strong></td>
<td align="center" width="25%"><img src="../images/models/jimeng.png" alt="Jimeng" width="40" height="40" /><br /><strong>Seedream 4.0</strong><br />Jimeng</td>
<td align="center" width="25%"><img src="../images/models/kling.png" alt="Kling" width="40" height="40" /><br /><strong>Kling v2.1</strong><br />Kling Image</td>
<td align="center" width="25%"><img src="../images/models/gemini.png" alt="Gemini" width="40" height="40" /><br /><strong>Nano Banana</strong><br />Gemini 2.5 Flash Image</td>
</tr>
</table>

<a id="video"></a>

### Video

<table>
<tr>
<td align="center" width="33%"><img src="../images/models/seedance.png" alt="Seedance" width="40" height="40" /><br /><strong>Seedance 2.5</strong></td>
<td align="center" width="33%"><img src="../images/models/kling.png" alt="Kling" width="40" height="40" /><br /><strong>Kling v2.1 Master</strong></td>
<td align="center" width="33%"><img src="../images/models/gemini.png" alt="Gemini" width="40" height="40" /><br /><strong>Veo 3.1</strong></td>
</tr>
</table>

<a id="voice-and-transcription"></a>

### Boses at transcription

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

Sinusuportahan din ang lokal na transcription gamit ang faster-whisper, WhisperKit, at whisper.cpp kung magagamit.

<a id="examples"></a>

## Mga halimbawa

<a id="video-translation"></a>

### Pagsasalin ng video

Ginawa ang mga pampublikong halimbawa noong KrillinAI pa ang pangalan ng OpenCreator. Ipinapakita nila ang matatag na daloy ng subtitle alignment, pagsasalin, dubbing, at patayong video na bahagi na ngayon ng mas malawak na Agent workflow sa Video Translation.

Nabuo ang subtitle sa ibaba mula sa 46-minutong lokal na video sa isang Run, nang walang manu-manong pag-aayos. Makikita ang buong saklaw, walang nagsasapawang linya, natural na paghahati, at mahusay na pagsasalin.

![Halimbawa ng subtitle alignment ng OpenCreator](../images/examples/krillinai-subtitle-alignment.png)

<table width="100%">
<tr>
<td width="33%">

<a id="subtitle-translation"></a>

#### Pagsasalin ng subtitle

https://github.com/user-attachments/assets/bba1ac0a-fe6b-4947-b58d-ba99306d0339

</td>
<td width="33%">

<a id="dubbing"></a>

#### Dubbing

https://github.com/user-attachments/assets/0b32fad3-c3ad-4b6a-abf0-0865f0dd2385

</td>
<td width="33%">

<a id="portrait-mode"></a>

#### Patayong mode

https://github.com/user-attachments/assets/c2c7b528-0ef8-4ba9-b8ac-f9f92f6d4e71

</td>
</tr>
</table>

> Ginawa ang mga video at larawan ng subtitle alignment noong KrillinAI pa ang pangalan ng OpenCreator.

<a id="video-downloader"></a>

### Pag-download ng video

Suriin ang pampublikong video link mula sa 10 sinusuportahang platform, ihambing ang format, at i-download ang video o audio diretso sa proyekto.

Mga sinusuportahang pinagmumulan:

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

Nag-iiba ang availability ayon sa video at rehiyon; maaaring kailanganin ang platform cookie.

![Pagpili ng format sa Video Downloader](../images/examples/video-downloader-formats-and-subtitles-en.png)

<a id="video-generation"></a>

### Pagbuo ng video

Gumawa ng AI video mula sa text prompt o reference image gamit ang Seedance. Itakda ang modelo, aspect ratio, resolution, at tagal; i-preview, buuing muli, o i-download ang bawat bersyon sa workspace ng proyekto.

![Pagbuo ng video sa OpenCreator gamit ang Seedance](../images/examples/video-generation-seedance-en.png)

<a id="stick-figure-animation"></a>

### Stick figure animation

Binuo ng OpenCreator ang orihinal na koleksiyon ng karakter kasama ang artist na si [Harbor Hsia](https://www.behance.net/xiaheyuan1), gumawa ng [Stickman sa Behance](https://www.behance.net/gallery/254715463/Stickman). Pinananatili ng mga kasamang karakter ang pare-parehong pagkakakilanlan sa buong paggawa ng animation.

![Mga karakter na binuo ng OpenCreator kasama ang artist](../images/examples/stick-figure-characters.webp)

Gawing buong animation ang teksto o YouTube content sa gabay na daloy ng pagsusuri ng script, salaysay, timing, storyboard, subtitle, rendering, at nada-download na video.

![Halimbawang frame ng stick figure animation](../images/examples/stick-figure-animation-frame.jpg)

<a id="quick-start"></a>

## Mabilis na pagsisimula

<a id="install-the-desktop-app"></a>

### I-install ang Desktop app

I-download ang installer mula sa [pinakabagong OpenCreator release](https://github.com/krillinai/OpenCreator/releases/latest) para sa macOS Apple Silicon, macOS Intel, o Windows x64. I-install at buksan; hindi kailangan ang Node.js o pnpm. Kasama ang Codex CLI; kailangan ng gumaganang ChatGPT sign-in o API key para sa tunay na model task.

Sa unang pagbukas, pinapatakbo ng Desktop ang lokal na Runtime, naghahanda ng default na proyekto, at sinusuri ang Codex configuration. Kung may gumaganang sign-in o API key at model setting, piliin ang **Use local Codex and continue**. Maaari ring mag-configure ng ibang provider sa parehong proseso:

![Pag-set up ng provider sa unang pagbukas ng Desktop](../images/product/opencreator-codex-setup.png)

Pagkatapos ng setup, ilagay ang kahilingan sa composer upang magsimula. Tingnan ang [gabay at pag-aayos ng problema](../opencreator-user-guide-and-troubleshooting.md) kung may aberya.

<a id="run-web-from-source"></a>

### Patakbuhin ang Web mula sa source

Para sa pag-develop o paggamit sa browser, i-install ang:

- Node.js 22 o mas bago
- pnpm 9.15.0, nakapirmi sa `packageManager` ng repository
- Codex CLI executable na matatawag mula sa terminal
- Wastong Codex CLI login para sa tunay na model task

Suriin muna ang lokal na environment:

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

Buksan ang `http://127.0.0.1:19861/`. Sinisimulan ng development server ang lokal na daemon kung kailangan at naglalagay ng pansamantalang Runtime token sa same-origin proxy; walang token na kailangang kopyahin.

Sa unang pagbukas, naghahanda ang Runtime ng default na proyekto at sinusuri ang Codex setting. Kumpirmahin ang ChatGPT sign-in o API key para sa lokal na Codex, o pumili ng provider at ilagay ang modelo, endpoint, at API key. Handa ang composer pagkatapos. Para sa daemon lamang:

```bash
pnpm daemon:dev
```

Sa loopback address lamang nakikinig ang daemon; isang beses nitong inilalabas sa stdout ang address at pansamantalang token.

<a id="desktop"></a>

## Desktop

Parehong React frontend mula sa `apps/web` ang ginagamit ng Desktop at browser. Parehong Daemon/API ang tinatawag para sa proyekto, usapan, gawain, at setting. Nagdaragdag lamang ang Electron ng tunay na system path, window control, tray, at native notification.

<a id="development-mode"></a>

### Development mode

```bash
pnpm desktop:dev
```

<a id="local-packaging"></a>

### Lokal na pag-package

| Command | Output |
| --- | --- |
| `pnpm desktop:package` | Directory na mapapatakbo sa kasalukuyang platform para sa lokal na pagsusuri |
| `pnpm desktop:dist` | Installer para sa kasalukuyang platform |
| `pnpm desktop:release` | Opisyal na command para sa release packaging |
| `pnpm --filter @opencreator/desktop verify:package` | Pagsusuri ng umiiral na Desktop package |
| `pnpm krillinai:package` | Magkahiwalay na KrillinAI Server at CLI archive para sa napiling platform |

Muling bina-build ng Desktop packaging ang Web mula sa kasalukuyang workspace, itinatala ang commit, dirty state, platform, architecture, at Web hash, at inihahambing ang `apps/web/dist` sa naka-embed na resource. Nabibigo ang packaging kung magkaiba. Tingnan ang [Desktop release runbook](../operations/opencreator-desktop-release-runbook.md) para sa signing, notarization, Windows build, at release requirement.

<a id="core-workflows"></a>

## Pangunahing mga daloy

<a id="conversations-and-runs"></a>

### Mga usapan at Run

1. Pumili ng proyekto o magsimula ng bagong usapan.
2. Ilagay ang gawain at piliin ang pahintulot, Profile, modelo, at antas ng reasoning.
3. Habang aktibo ang Run, ipila ang susunod na gawain o ihinto ito at magpatuloy agad.
4. Sa Timeline, tingnan ang buod ng reasoning, tool call, pagbabago sa file, pag-apruba, at resulta.
5. Sa task center, subaybayan ang lahat ng tumatakbo, tapos, bigo, at naghihintay ng pag-apruba na gawain.

<a id="skills-and-mcp"></a>

### Skills at MCP

- Tingnan ang Skill marketplace, kasaysayan ng pag-install, at lokal na Skills sa plugin center.
- Pumili ng Skill sa composer gamit ang `/` o add menu para sundin ito ng susunod na gawain.
- Katutubong command at configuration ng Codex ang namamahala sa MCP, walang ikalawang execution engine.
- Aktibong `$CODEX_HOME` ang default; suriin ang epekto bago baguhin ang global Skills o MCP configuration.

<a id="schedules-and-dedicated-task-threads"></a>

### Mga iskedyul at nakalaang task thread

- Bawat iskedyul ay may sarili at patuloy na naka-save na usapan sa OpenCreator.
- Ginagamit muli ng awtomatikong trigger, manu-manong Run, at follow-up ang usapan; sunod-sunod ang takbo ayon sa `queue` o `skip`.
- Ina-archive ng pagtanggal ng iskedyul ang usapan habang pinananatili ang Run, resulta, at kasaysayan ng Codex.
- Hindi binabago ng pag-rotate o pagbawi ng Codex thread ang task entry o page route ng OpenCreator.

<a id="opencreator-system-architecture"></a>

## Arkitektura ng OpenCreator

Ang biswal na workspace at usapan sa Agent ay dalawang interface ng iisang malikhaing gawain. Bawat daloy ay state machine: may malinaw na estado at event para sa input, configuration, generation, review, revision, at export. Sa iisang state machine pumapasok ang biswal na kilos at utos sa usapan; ibinabalik sa parehong interface ang kasalukuyang hakbang, setting, progreso, bersyon, at resulta. Nagsasabay sila gamit ang iisang pinagmumulan ng estado.

Paulit-ulit ang paglikha, kaya hindi pinapatungan ng rebisyon ang resulta. Bawat pagwawasto o regeneration ay bagong bersyon mula sa kasalukuyang workflow state, na pinananatili ang lumang setting at output para sa pagsusuri, paghahambing, at pagpino.

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

| Bahagi ng OpenCreator | Tungkulin | Implementasyon |
| --- | --- | --- |
| Karanasan ng creator | Dashboard, tool, usapan sa Agent, setting, at file | `apps/web` · React 18 · Vite · TypeScript |
| Ubod ng kolaborasyon | Isinasabay ang hakbang, konteksto, progreso, resulta, at rebisyon | Shared workflow state · `CreatorCollaborationPanel` · kasaysayan ng bersyon |
| Lokal na Runtime | Proyekto, Run, pag-apruba, iskedyul, memorya, at notification | `apps/daemon` · Fastify · Runtime API · SSE |
| Runtime component | Sinusubaybayan ang kasama, aktibo, at bagong bersyon; regular na sumusuri; nag-i-install kapag hiniling | yt-dlp nightly · beripikasyon ng update · pagbabalik sa gumaganang bersyon |
| Codex engine | Agent loop, session, reasoning, tool, Skills, at MCP | Codex CLI · app-server |
| Mga media tool | Pag-download, transcription, conversion, generation, at export | yt-dlp · Whisper · FFmpeg · naka-configure na AI service |
| Lokal na datos | Lokal na proyekto, Run, attachment, output, at credential | SQLite · filesystem · system credential storage |
| Desktop host | Nilo-load ang shared Web build at dinaragdagan ng kakayahan ng OS | `apps/desktop` · Electron · Preload Bridge |

Pangunahing prinsipyo:

- Iisang workflow state ang ipinapakita ng workspace at Agent; parehong nagpapadala ng event sa iisang state machine.
- Bagong bersyon ang rebisyon, na pinananatili ang konteksto at output ng bawat paglikha.
- Hindi direktang pinapatakbo ng frontend ang Codex at hindi ito umaasa sa hilaw na Codex JSONL event.
- Daemon ang may hawak ng process lifecycle, event normalization, persistence, pag-apruba, iskedyul, at notification outbox.
- Codex ang awtoridad sa execution ng Agent loop, Skills, at MCP.
- Walang hiwalay na kopya ng pangkalahatang product logic sa Browser Bridge at Desktop Bridge.

<a id="repository-layout"></a>

## Ayos ng repository

```text
OpenCreator/
├── apps/
│   ├── web/          # Nag-iisang React frontend
│   ├── daemon/       # Lokal na Fastify Runtime at Codex adapter
│   ├── desktop/      # Electron Main, Preload, native capability, at packaging
│   └── harness/      # Command-line tool sa pagsusuri ng Runtime
├── packages/
│   ├── protocol/     # Shared Runtime contract ng Web, Daemon, at Desktop
│   └── skill-market/ # Skill marketplace model at shared logic
├── docs/             # Disenyo, API, runbook, at ulat ng pagsusuri
├── scripts/          # Mga pagsusuri sa repository
└── .runtime/         # Lokal na Runtime data, ginagawa sa unang pagbukas
```

<a id="configuration"></a>

## Configuration

<a id="ai-service-api-keys"></a>

### Mga API key ng AI service

Buksan ang **Settings → AI Services** upang itakda ang provider ng modelo, transcription, boses, at larawan para sa workspace. Maaaring may karagdagang kategorya para sa paparating na tool. Mga kailangang field lamang ng napiling provider ang ipinapakita: Base URL, API Key, modelo, proxy, o natatanging credential.

![Mga API key setting ng AI service](../images/product/opencreator-ai-services-en.png)

Sa system credential storage ng lokal na Runtime naka-save ang credential; huwag itong i-commit sa repository. Hindi kailangan ng ilang lokal o system-backed provider gaya ng Edge TTS ang API Key.

<a id="account-and-subscriptions"></a>

### Account at subscription

Ipinapakita ng personal center ang account, kumpirmadong subscription, at magagamit na credit. Binubuksan ng sign-in ang `https://www.open-creator.ai/device`. Mag-sign in sa website at aprubahan ang device; nakakakuha ang lokal na Daemon ng sariling session. Pareho ang account sa browser at app, ngunit hiwalay ang session.




Piliin ang plano sa OpenCreator. Binubuksan ng pagbili ang Stripe Checkout; sa Stripe Billing Portal pinamamahalaan ang subscription. Ang pagbabalik sa app mula sa billing ay sa `/billing/return`, na hindi nangangailangan ng website session. Nirerefresh ng OpenCreator ang benepisyo mula sa Gateway pagkatapos ng beripikadong Stripe notification. May isa pang daan sa pagbili sa `/pricing` at `/account`, gamit ang parehong subscription backend.






<a id="third-party-runtime-components"></a>

### Third-party Runtime component

Buksan ang **Settings → Third-party Components** para makita ang ginagamit na yt-dlp nightly, kasamang bersyon, pinagmulan, at pinakabagong release. Bawat pitong araw nagsusuri ang OpenCreator ngunit hindi kusang nag-i-install. Kailangan ng tahasang utos ng user; nananatili ang gumaganang bersyon kung pumalya ang download, beripikasyon, o pag-install.

![Setting ng third-party component](../images/product/opencreator-third-party-components-en.png)

<a id="runtime-environment-variables"></a>

### Mga environment variable ng Runtime

Hindi kailangan ng karamihan ang environment variable. Gamitin kapag kailangan ng hiwalay na datos, partikular na Codex executable, o sariling managed-project directory:

| Environment variable | Default | Layunin |
| --- | --- | --- |
| `OPENCREATOR_DATA_DIR` | `.runtime` | Database, Run, attachment, at managed workspace ng OpenCreator |
| `OPENCREATOR_GATEWAY_ORIGIN` | `https://www.open-creator.ai` | Gateway para sa login, subscription, credit, at opisyal na modelo; palitan para sa lokal na Gateway |
| `OPENCREATOR_CODEX_BIN` | `codex` | Path ng Codex CLI executable |
| `CODEX_HOME` | `~/.codex` | Awtoridad para sa Codex session, configuration, Skills, MCP, at Profile |
| `OPENCREATOR_DEFAULT_CWD` | Kasalukuyang working directory | Default na working directory ng daemon |
| `OPENCREATOR_DEFAULT_PROJECT_ROOT` | Default na patakaran ng Runtime | Ugat ng managed project; ginagamit ang subdirectory na `OpenCreator/` kung itinakda |
| `OPENCREATOR_CODEX_THREAD_ROTATION_RUN_THRESHOLD` | `50` | Bilang ng tapos na Run bago i-rotate ang Codex thread ng pangmatagalang iskedyul; `0` para patayin ang maagap na rotation |

Halimbawa, paghiwalayin ang Runtime data at Codex environment:

```bash
OPENCREATOR_DATA_DIR=/path/to/opencreator-data \
CODEX_HOME=/path/to/codex-home \
pnpm web:dev
```

<a id="data-and-security"></a>

## Datos at seguridad

Bilang default, nasa `.runtime/` sa ugat ng repository ang Runtime data:

| Path | Nilalaman |
| --- | --- |
| `.runtime/app.sqlite` | Proyekto, thread, Run, event, iskedyul, notification, attachment metadata, pag-apruba, memorya, at buod |
| `.runtime/runs/` | Log na inalisan ng sensitibong detalye, diagnostic, at metadata ng bawat Run |
| `.runtime/attachments/` | Kontroladong attachment file |
| `.runtime/workspaces/` | Project workspace na pinamamahalaan ng Runtime |

Nasa `$CODEX_HOME` pa rin ang Codex session at configuration; hiwalay ang backup nito sa `.runtime/`.

Kasama sa hangganan ng seguridad:

- Sa `127.0.0.1` lamang nakikinig ang daemon; kailangan ng Bearer token ang lahat ng API maliban sa health check.
- Naka-off ang script, navigation, at popup sa HTML preview bilang default; kontroladong relative resource lamang sa parehong workspace ang pinapayagan.
- Kailangan ng ikalawang kumpirmasyon ang sensitibong memorya. Hindi kusang permanenteng iniimbak ang hindi kumpirmadong mungkahi.
- Inaalis ang sensitibong detalye sa diagnostic at Run log bago ibalik o i-export.
- Naka-on ang ASAR integrity at cookie encryption sa Desktop package; naka-off ang RunAsNode, `NODE_OPTIONS`, at Node CLI Inspector.

Nasa [gabay at pag-aayos ng problema](../opencreator-user-guide-and-troubleshooting.md) ang buong proseso ng backup, restore, cleanup, at reset.

<a id="development"></a>

## Pag-develop

<a id="common-commands"></a>

### Karaniwang command

| Command | Layunin |
| --- | --- |
| `pnpm web:dev` | Simulan ang Web at lokal na daemon kapag kailangan |
| `pnpm daemon:dev` | Simulan lamang ang daemon |
| `pnpm desktop:dev` | I-build ang dependency at simulan ang Electron sa development mode |
| `pnpm test` | Patakbuhin ang unit at integration test ng workspace |
| `pnpm typecheck` | Suriin ang TypeScript sa buong repository |
| `pnpm build` | I-build ang lahat ng workspace |
| `pnpm e2e` | Patakbuhin ang Web Playwright E2E test |
| `pnpm smoke:ci` | Patakbuhin ang Runtime smoke test gamit ang pekeng Codex |
| `pnpm perf:check` | Suriin ang naitalang performance baseline |

Bago mag-submit, pumili ng pagsusuring akma sa epekto ayon sa [gabay sa kontribusyon](../../CONTRIBUTING.md#what-reviewers-check). Kaugnay na pagsusuri lamang ang kailangan para sa dokumento, teksto, at estilo; kailangan ng targeted module test at typecheck para sa shared behavior at Runtime. Patakbuhin ang buong test o build kung kailangan ng saklaw, at ilahad ang pinatakbo sa PR.

Kailangan din ng pagbabago sa Desktop, Host Bridge, Runtime proxy, o shared frontend workflow ang Web/Desktop consistency test, packaged-app E2E, at Web build hash verification. Hindi sapat ang Web unit test upang patunayang handa ang Desktop release.

Naka-off bilang default ang tunay na Codex smoke test. Tahasang buksan gamit ang:

```bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

<a id="documentation"></a>

## Dokumentasyon

- **Paggamit:** [Pagsisimula](#quick-start) · [Gabay at pag-aayos ng problema](../opencreator-user-guide-and-troubleshooting.md)
- **Pag-develop at pagpapalawak:** [Kontribusyon](../../CONTRIBUTING.md) · [Alituntunin sa asal](../../CODE_OF_CONDUCT.md) · [Pag-ambag ng Skill](../contributing/skills-contributing.md) · [Pag-ambag ng template](../contributing/templates-contributing.md) · [Runtime API v1](../runtime-api-for-ui-v1.md) · [Gabay sa UI component](../visual-component-guidelines.md)
- **Pagpapanatili at release:** [Disenyo ng Codex-native Runtime](../2026-07-03-codex-native-agent-runtime-design.md) · [Desktop release runbook](../operations/opencreator-desktop-release-runbook.md) · [Gabay sa Windows Desktop release](../operations/opencreator-desktop-windows-release.md)

<a id="translation-convention"></a>

## Patakaran sa pagsasalin

Ang root na `README.md` ang pamantayang dokumento sa English. Nasa `docs/<locale>/README.md` ang pinananatiling salin. Idagdag lamang ang wika sa switcher kapag kumpleto na ang salin at kapareho ng istruktura ng English.

<a id="community"></a>

## Komunidad

<p>May GitHub user mula sa <strong>hindi bababa sa 107 bansa at rehiyon</strong> na nag-star sa OpenCreator.</p>

<img src="../images/star-coverage-map.svg" alt="Mapa ng mga bansa at rehiyon na may nag-star sa OpenCreator sa GitHub" width="760" />

<a id="the-crew"></a>

### Pangkat na namamahala

Bawat kasapi ang responsable sa pamantayan, pagsusuri at pag-merge ng kontribusyon, at tulong sa komunidad sa sariling larangan.

<table border="1" cellpadding="12">
  <tr>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/wulien.svg" width="64" height="64" alt="wulien avatar" /><br /><a href="https://github.com/wulien">wulien</a><br />Code &amp; pag-aayos ng bug</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/dle-kb.svg" width="64" height="64" alt="DLe-kb avatar" /><br /><a href="https://github.com/DLe-kb">DLe-kb</a><br />Mga template</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/xiaheyuan.svg" width="64" height="64" alt="xiaheyuan avatar" /><br /><a href="https://github.com/xiaheyuan">xiaheyuan</a><br />Disenyo &amp; asset</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/krillinai.svg" width="64" height="64" alt="krillinai avatar" /><br /><a href="https://github.com/krillinai">krillinai</a><br />Skills &amp; dokumentasyon</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/hbxugang.svg" width="64" height="64" alt="hbxugang avatar" /><br /><a href="https://github.com/hbxugang">hbxugang</a><br />Enterprise deployment</td>
  </tr>
</table>

<a id="contributors"></a>

### Mga nag-ambag

Salamat sa lahat ng nag-ambag ng code, dokumentasyon, puna, ulat ng problema, Skills, ilustrasyon, at ideya.
Hiwalay na pinananatili ang listahang ito sa awtomatikong Contributors graph ng GitHub.

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

<a id="contributing"></a>

### Pag-ambag

Malugod na tinatanggap ang ambag sa:

| Uri | Maiaambag | Lokasyon | Laki |
| --- | --- | --- | --- |
| Code | Pag-aayos ng bug, daloy ng creator, shared feature | `apps/web/`, `apps/daemon/` | Isang nakatuong PR na may test |
| Skills | Muling magagamit na Agent workflow | [`skills/`](../../skills/) | Isang folder na may `SKILL.md` at opsyonal na sanggunian → [gabay](../contributing/skills-contributing.md) |
| Mga template | Muling magagamit na preset ng larawan, video, o pabalat | [`template/`](../../template/) | Isang folder na may `template.json` at asset → [gabay](../contributing/templates-contributing.md) |
| Ilustrasyon at disenyo | Orihinal na ilustrasyon, icon, o UI design | Napagkasunduang lokasyon | Isang PR na may preview, source file, at lisensya |
| Third-party integration | Suporta sa AI o media provider | Kaugnay na Web o Daemon module | Isang PR na may error handling, ligtas na credential, at test |
| Dokumentasyon at pagsasalin | Pagpapahusay ng dokumento o bagong wika | `README.md`, `docs/`, `docs/<locale>/` | Isang PR |

Nasa [CONTRIBUTING.md](../../CONTRIBUTING.md) ang buong gabay sa lokal na setup, review criteria, at karaniwang dahilan ng pagtanggi; may [10 wika](../zh/CONTRIBUTING.md).

<a id="star-history"></a>

## Kasaysayan ng star

Dating KrillinAI ang OpenCreator. Saklaw ng chart ang buong kasaysayan ng repository bago at pagkatapos ng pagpapalit ng pangalan.

[![Kasaysayan ng star ng OpenCreator](https://api.star-history.com/svg?repos=krillinai/OpenCreator&type=date)](https://www.star-history.com/?type=date&repos=krillinai%2FOpenCreator)

<a id="related-projects"></a>

## Mga kaugnay na proyekto

| Proyekto | Tungkulin |
| --- | --- |
| [OpenAI Codex](https://github.com/openai/codex) | Agent execution engine para sa access sa modelo, reasoning, tool call, session, Skills, at MCP. |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Sinusuri ang pampublikong media link, inililista ang format, at nagda-download ng video o audio. |
| [FFmpeg](https://ffmpeg.org/) | FFmpeg at ffprobe para sa media conversion, komposisyon, pagkuha ng frame, at pagpapatunay ng output. |
| [Whisper](https://github.com/openai/whisper), [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [faster-whisper](https://github.com/SYSTRAN/faster-whisper) at [WhisperKit](https://github.com/argmaxinc/WhisperKit) | Cloud at lokal na speech transcription ayon sa platform at magagamit na kakayahan ng Runtime. |
| [React](https://react.dev/) | Pundasyon ng iisang interface ng Web at Desktop. |
| [Fastify](https://fastify.dev/) | Pundasyon ng HTTP at API ng lokal na Runtime. |
| [Electron](https://www.electronjs.org/) | Desktop host para sa native system capability, lifecycle ng app, at packaging. |
| [SQLite](https://www.sqlite.org/) | Lokal na imbakan ng proyekto, usapan, Run, iskedyul, memorya, at ibang datos. |
| [Model Context Protocol](https://modelcontextprotocol.io/) | Bukas na protocol para ikonekta ang panlabas na tool at serbisyo sa Agent workspace. |

---

<div align="center">

**OpenCreator · Lumikha nang lokal, magtrabaho nang tuloy-tuloy.**

</div>
