<div dir="rtl">

<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../images/OpenCreator_logo_vector_dark.svg" />
    <img src="../images/OpenCreator_logo_vector.svg" alt="OpenCreator" width="380" />
  </picture>
  <br />
  تخلیق کاروں کے لیے اوپن سورس AI ورک اسپیس اور Skills
</h1>

<p>اسکرپٹ، ویڈیو، تصاویر، آواز، ترجمے اور تدوین کے لیے بصری ترتیبات، دوبارہ استعمال ہونے والے Skills اور Agent کو ایک ورک اسپیس میں یکجا کریں۔</p>

<p><strong>OpenCreator کا سابقہ نام KrillinAI تھا۔</strong></p>

<a href="https://trendshift.io/repositories/13360" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13360" alt="OpenCreator، سابقہ KrillinAI: Trendshift پر دن کی سرفہرست ریپوزٹری" width="250" height="55" /></a>

[English](../../README.md) | [简体中文](../zh/README.md) | [日本語](../ja/README.md) | [한국어](../ko/README.md) | [Bahasa Indonesia](../id/README.md) | [Español](../es/README.md) | [Français](../fr/README.md) | [Deutsch](../de/README.md) | [Português](../pt/README.md) | [Русский](../ru/README.md) | [العربية](../ar/README.md) | [ภาษาไทย](../th/README.md) | [Türkçe](../tr/README.md) | [हिन्दी](../hi/README.md) | [বাংলা](../bn/README.md) | **اردو** | [Tiếng Việt](../vi/README.md) | [Filipino](../fil/README.md)

[![GitHub Stars](https://badgen.net/github/stars/krillinai/OpenCreator?icon=github&label=Stars&color=EAB308)](https://github.com/krillinai/OpenCreator/stargazers)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Bilibili](https://img.shields.io/badge/dynamic/json?label=Bilibili&query=%24.data.follower&suffix=%E7%B2%89%E4%B8%9D&url=https%3A%2F%2Fapi.bilibili.com%2Fx%2Frelation%2Fstat%3Fvmid%3D242124650&logo=bilibili&color=00A1D6&labelColor=FE7398&logoColor=FFFFFF)](https://space.bilibili.com/242124650)
[![AtomGit G-Star](https://img.shields.io/badge/AtomGit-G--Star-DA203E?style=flat)](https://atomgit.com/krillinai/OpenCreator)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/fUNvbqDaw)
[![QQ گروپ](https://img.shields.io/badge/QQ%20群-754069680-green?logo=tencent-qq)](https://qm.qq.com/q/W4YC0PLMeA)

[نمایاں خصوصیات](#project-highlights) · [تخلیقی ٹولز](#creator-tools) · [Skills](#skills) · [مثالیں](#examples) · [آغاز](#quick-start) · [Desktop](#desktop) · [دستاویزات](#documentation) · [کمیونٹی](#community)

</div>

![OpenCreator کا Agent ورک اسپیس](../images/opencreator-home-en.png)

<a id="project-overview"></a>

## منصوبے کا تعارف

OpenCreator ان افراد اور ٹیموں کے لیے ہے جو تخلیقی اور ترقیاتی کام اپنے کمپیوٹر پر چلانا چاہتے ہیں۔ Agent لوپ دوبارہ بنانے کے بجائے یہ Codex CLI کو عملی انجن بناتا ہے، اور اس کے ساتھ مستحکم مقامی Runtime، بصری ورک اسپیس اور Desktop ہوسٹ شامل کرتا ہے۔

OpenCreator میں کام کے دو مربوط طریقے ہیں:

- **مواد کی ورک اسپیس**: بصری ٹولز اور سانچوں سے ویڈیو ترجمہ اور ڈاؤن لوڈ، تصاویر اور ویڈیو بنانا، وائس اوور، مضامین اور سوشل پوسٹ، مختصر ویڈیو کے اسکرپٹ اور اسٹک فگر اینیمیشن تیار کریں۔
- **Agent گفتگو**: عام زبان میں تخلیقی یا ترقیاتی کام شروع کریں اور رہنمائی دیں؛ گفتگو منصوبوں کے مطابق ترتیب دیں، Run پس منظر میں جاری رکھیں، اور منظوری، منسلکات، فائلیں، Skills، MCP، شیڈول، اطلاعات، یادداشت اور تشخیصی معلومات ایک جگہ سنبھالیں۔

Web واحد فرنٹ اینڈ ہے۔ Desktop وہی Web بلڈ لوڈ کرتا ہے اور صرف آپریٹنگ سسٹم کی سہولتیں شامل کرتا ہے، مثلاً فولڈر کا انتخاب، ونڈو کا دورِ حیات، سسٹم ٹرے اور مقامی اطلاعات۔ یکساں ڈیٹا اور مواد کے یکساں ویوپورٹ پر دونوں کا عمومی UI اور Runtime رویہ یکساں ہے۔

<a id="project-highlights"></a>

## نمایاں خصوصیات

- 🤖 **Codex پر مبنی**: دوسرا عملی انجن برقرار رکھے بغیر Codex کا Agent لوپ، ماڈل، استدلال، ٹول کال، گفتگو، Skills اور MCP استعمال کریں۔

- 🚀 **تیار Desktop ایپ**: Codex CLI شامل ہے؛ مقامی Runtime ضرورت پر چلتا اور طے شدہ منصوبہ خود تیار کرتا ہے۔

- ⚙️ **موجودہ Codex سیٹ اپ**: پہلی بار مقامی ترتیب دیکھ کر قابلِ استعمال ChatGPT سائن اِن یا API key دوبارہ استعمال کرنے کی پیشکش ہوتی ہے۔ دوسرے فراہم کنندگان کے لیے رہنمائی والا فارم ہے۔

- 🔄 **Runtime اجزا کا انتظام**: شامل، فعال اور تازہ ترین yt-dlp دیکھیں؛ باقاعدہ جانچ اور دستی اپ ڈیٹ کریں۔ ناکامی پر موجودہ کارآمد ورژن دستیاب رہتا ہے۔

- 🎨 **متعدد ذرائع سے تخلیق**: ویڈیو، تصاویر، آڈیو، سب ٹائٹل اور دستاویزات ایک مربوط عمل میں بنائیں اور سنبھالیں۔

- 🧩 **تخلیقی سانچے**: پرامپٹ اور ترتیبات ابتدا سے بنائے بغیر قابلِ استعمال سانچوں سے تصاویر اور ویڈیو بنائیں۔

- 🔗 **کام کے دو انداز**: بصری ورک اسپیس یا Agent گفتگو استعمال کریں؛ مشترکہ اسٹیٹ مشین مراحل، پیش رفت اور نتائج ہم آہنگ رکھتی ہے۔

- 🕘 **ورژن محفوظ رکھنا**: ہر ترمیم نیا ورژن بناتی ہے؛ پرانی ترتیبات اور نتائج جائزے اور موازنے کے لیے محفوظ رہتے ہیں۔

- 🧩 **قابلِ استعمال Skills**: ویڈیو Skills استعمال کریں، اپنے Skills سے Agent میں اضافہ کریں اور Codex کی اصل ترتیب سے MCP سنبھالیں۔

- 🧠 **یادداشت**: عالمی، منصوبے اور تھریڈ کی یادداشت، خلاصے اور دوبارہ تشکیل دیے جا سکنے والے Run ان پٹ اسنیپ شاٹ محفوظ کریں۔

- 🔐 **مقامی تحفظ**: ڈیٹا، منسلکات اور لاگ مقامی رہتے ہیں؛ منظوری اور حساس معلومات ہٹائی گئی تشخیصی رپورٹ دستیاب ہے۔

- 🌐 **کثیر لسانی انٹرفیس**: Web اور Desktop میں 43 زبانیں، سسٹم زبان کی شناخت، دستی انتخاب اور عربی، فارسی، اردو و عبرانی کے لیے دائیں سے بائیں ترتیب دستیاب ہے۔

<a id="creator-tools"></a>

## تخلیقی ٹولز

موجودہ ریلیز میں دس تخلیقی ٹولز ہیں۔ دستیاب ماڈل اور خدمات مقامی Codex ماحول اور AI خدمات کی ترتیبات پر منحصر ہیں۔

Dashboard سے مضمون، Xiaohongshu پوسٹ یا مختصر ویڈیو اسکرپٹ لکھیں؛ اسٹک فگر اینیمیشن بنائیں؛ ویڈیو ترجمہ یا ڈاؤن لوڈ کریں؛ تھمب نیل، تصاویر یا ویڈیو بنائیں؛ Text to Speech سے وائس اوور تیار کریں۔

![OpenCreator تخلیقی Dashboard](../images/product/opencreator-dashboard-en.png)

> مزید تخلیقی ٹولز مسلسل شامل ہو رہے ہیں۔

**ویڈیو ترجمے میں 123 ماخذ زبانیں اور پن یِن آؤٹ پٹ سمیت 124 ہدف اختیارات ہیں۔** مقامی، انگریزی یا چینی نام اور زبان کے کوڈ سے تلاش کریں۔ آواز کی شناخت اور تشکیل کی زبانوں کا انحصار منتخب سروس اور ماڈل پر ہے۔

- **صرف سب ٹائٹل کا ترجمہ**: SRT درآمد کرکے فوراً پیش منظر دیکھیں اور اصل ویڈیو، ڈبنگ یا ویڈیو رینڈرنگ کے بغیر ترجمہ کریں۔

- **سب ٹائٹل کی جدید تدوین**: پلے بیک سے مربوط ویوفارم اور ٹائم لائن والے مکمل اسکرین ایڈیٹر میں اوقات بدلیں، سب ٹائٹل تقسیم یا یکجا کریں اور متن تلاش کرکے بدلیں۔ ویڈیو پر انداز دیکھیں، زبان، آواز اور آؤٹ پٹ تبدیل کریں اور پرانے نتائج محفوظ رکھتے ہوئے نیا ورژن بنائیں۔

- **ایک صفحے پر تخلیق**: تصویر، ویڈیو اور Text to Speech کی ترتیبات ایک صفحے پر مکمل کریں؛ ماڈل کا انتخاب، حوالہ جاتی تصاویر کا پیش منظر، ماڈل کے مطابق تصویری اختیارات اور قابل تلاش آوازوں کا مجموعہ استعمال کریں۔

- **کثیر لسانی آؤٹ پٹ اور پیش رفت**: شامل متبادل فونٹس پیچیدہ رسم الخط اور دائیں سے بائیں سب ٹائٹل کی نمائش بہتر کرتے ہیں۔ نقل نویسی، ترجمے، ڈبنگ اور رینڈرنگ کی پیش رفت اور دستیاب ہونے پر مکمل و کل تعداد دیکھیں۔

<table width="100%">
<thead>
<tr>
<th width="18%">ورک اسپیس</th>
<th width="14%">حالت</th>
<th width="68%">صلاحیتیں</th>
</tr>
</thead>
<tbody>
<tr><td valign="top">ویڈیو ترجمہ</td><td valign="top">✅ دستیاب</td><td>مقامی یا عوامی ویڈیو درآمد؛ کلاؤڈ یا مقامی Whisper سے نقل نویسی؛ LLM سیاق سے سب ٹائٹل کی تقسیم، مطابقت، اصطلاحات اور ترجمہ؛ دو لسانی سب ٹائٹل، ڈبنگ یا اپنی آواز کا نمونہ، انداز، افقی/عمودی ترتیب؛ SRT، آڈیو یا ویڈیو برآمد</td></tr>
<tr><td valign="top">ویڈیو ڈاؤن لوڈر</td><td valign="top">✅ دستیاب</td><td>YouTube، Bilibili، X، TikTok، Instagram، Douyin، Facebook، Xiaohongshu، Pinterest اور Reddit کی انفرادی عوامی ویڈیو جانچیں؛ فارمیٹ کا موازنہ اور ویڈیو یا آڈیو ڈاؤن لوڈ۔ بعض ذرائع کو پلیٹ فارم کوکی درکار ہے. پلیٹ فارم پر سب ٹائٹل دستیاب ہوں تو فہرست دیکھیں اور SRT ڈاؤن لوڈ کریں؛ پہلے انگریزی، پھر دستیاب ہونے پر انٹرفیس کی زبان دکھائی جاتی ہے۔</td></tr>
<tr><td valign="top">تھمب نیل بنانا</td><td valign="top">✅ دستیاب</td><td>موضوع، ویڈیو لنک اور اختیاری حوالہ تصویر سے متعدد تھمب نیل بنائیں اور موازنہ کریں</td></tr>
<tr><td valign="top">تصویر بنانا</td><td valign="top">✅ دستیاب</td><td>پرامپٹ اور اختیاری حوالہ تصویر سے GPT Image / Seedream / Kling Image / Gemini؛ تناسب اور تعداد مقرر کریں؛ ہر تصویر دیکھیں اور ڈاؤن لوڈ کریں</td></tr>
<tr><td valign="top">مضمون نگاری</td><td valign="top">✅ دستیاب</td><td>موضوع، لنک، ویڈیو یا ماخذ دستاویز سے قابلِ تدوین موضوعات، خاکہ اور مکمل مضمون؛ تیار تصاویر شامل اور Markdown، HTML یا PDF برآمد کریں</td></tr>
<tr><td valign="top">Xiaohongshu پوسٹ</td><td valign="top">✅ دستیاب</td><td>موضوع یا مواد سے مکمل پوسٹ؛ قارئین، قسم اور طوالت مقرر؛ نتیجہ نقل یا ڈاؤن لوڈ کریں</td></tr>
<tr><td valign="top">مختصر ویڈیو اسکرپٹ</td><td valign="top">✅ دستیاب</td><td>موضوع یا ماخذ سے ناظرین، پلیٹ فارم، دورانیے اور لہجے کے مطابق شوٹنگ کے لیے تیار حصوں والا اسکرپٹ؛ تدوین، نقل یا ڈاؤن لوڈ</td></tr>
<tr><td valign="top">اسٹک فگر اینیمیشن</td><td valign="top">✅ دستیاب</td><td>متن یا YouTube سے بیان، آواز، یکساں کرداروں والا اسٹوری بورڈ، سب ٹائٹل اور قابلِ ڈاؤن لوڈ اینیمیشن</td></tr>
<tr><td valign="top">خودکار کلپس</td><td valign="top">زیرِ تیاری</td><td>طویل ویڈیو جانچیں، نمایاں لمحات تلاش کریں اور منتخب حصوں کو قابلِ استعمال مختصر کلپس بنائیں</td></tr>
<tr><td valign="top">Text to Speech</td><td valign="top">✅ دستیاب</td><td>آواز، رفتار اور جذبات کے انتخاب سے اسکرپٹ کو وائس اوور بنائیں</td></tr>
<tr><td valign="top">ویڈیو بنانا</td><td valign="top">✅ دستیاب</td><td>پرامپٹ اور حوالہ تصاویر سے Seedance / Kling / Veo ویڈیو؛ ہر ورژن دیکھیں، دوبارہ بنائیں اور ڈاؤن لوڈ کریں</td></tr>
<tr><td valign="top">ڈیجیٹل اوتار</td><td valign="top">زیرِ تیاری</td><td>اسکرپٹ، آواز اور اوتار سے بولتے کردار کی ویڈیو بنائیں</td></tr>
</tbody>
</table>

<a id="creation-templates"></a>

## تخلیقی سانچے

ہر پرامپٹ اور ترتیب ابتدا سے بنانے کے بجائے سانچے سے شروع کریں۔ ویڈیو اور تصویری ڈیزائن سمیت زمروں میں نمایاں سانچے دیکھیں اور اپنے خیال کا نقطۂ آغاز منتخب کریں۔

مجموعے میں OpenCreator اور آزاد تخلیق کاروں کے سانچے ہیں۔ تیسرے فریق کے سانچے کی تفصیل میں تخلیق کار کا نام اور اصل ماخذ کا لنک ہے۔

سانچہ کھول کر نمونہ نتیجہ، پرامپٹ، ترتیبات، ٹیگ، مصنف اور اصل ماخذ دیکھیں۔ **Use this template** منتخب کرکے اپنے کام کے مطابق ان پٹ بدلیں۔

![نمونہ، ترتیبات اور پرامپٹ سمیت تصویری سانچے کی تفصیل](../images/product/creation-templates-detail-apex-summit-en.png)

<a id="skills"></a>

## Skills

تخلیقی ٹولز بصری کنٹرول دیتے ہیں؛ Skills، Agent کو دوبارہ استعمال ہونے والی ہدایات اور ٹولز کے طریقۂ کار دیتے ہیں۔ ریپوزٹری میں ویڈیو بنانے کے Skills اور مقامی Codex Skills کے انتظام کی سہولت ہے۔

[`skills/`](../../skills/) میں شامل KrillinAI CLI چلانے والے Agent کے لیے قابلِ استعمال ہدایات ہیں۔

| Skill | صلاحیتیں |
| --- | --- |
| [KrillinAI CLI](../../skills/krillinai-cli/SKILL.md) | کمانڈ منتخب کریں، ترتیب جانچیں اور پیش رفت، مینی فیسٹ، نتائج اور غلطیاں سمجھیں |
| [سب ٹائٹل](../../skills/krillinai-subtitle/SKILL.md) | کیپشن ڈاؤن لوڈ یا میڈیا نقل نویسی؛ ترجمہ اور دو لسانی یا عمودی ویڈیو کے مختصر سب ٹائٹل |
| [TTS](../../skills/krillinai-tts/SKILL.md) | سب ٹائٹل سے ہدف زبان کی ڈبنگ اور اختیاری ڈب شدہ ویڈیو |
| [افقی رینڈر](../../skills/krillinai-render-horizontal/SKILL.md) | دو لسانی سب ٹائٹل یا ڈب آڈیو اور ہدف سب ٹائٹل کے ساتھ افقی ویڈیو |
| [عمودی رینڈر](../../skills/krillinai-render-vertical/SKILL.md) | عنوان، دو لسانی سب ٹائٹل یا ڈبنگ کے ساتھ عمودی ویڈیو |
| [سرورق](../../skills/krillinai-cover/SKILL.md) | مکمل متنی پرامپٹ سے سرورق بنائیں، تصویر اور آخری پرامپٹ محفوظ کریں |
| [پائپ لائن منصوبہ](../../skills/krillinai-pipeline/SKILL.md) | متعدد مراحل کے آؤٹ پٹ منصوبے کی dry-run جانچ؛ اصل کام ہر مرحلے کے Skills سے کریں |

<a id="extend-with-your-own-skills"></a>

### اپنے Skills سے توسیع

OpenCreator میں `SKILL.md` سے متعین مقامی Codex Skills کے ذریعے اپنے طریقے اور عمل شامل کر سکتے ہیں۔ دستیابی فعال Codex home اور نصب Skills پر منحصر ہے؛ ویڈیو Skills کے لیے CLI اور متعلقہ خدمات کا سیٹ اپ چاہیے۔ ریپوزٹری میں موجودگی سے ہر Skill خود نصب یا ہر بیرونی خدمت شامل نہیں ہو جاتی۔

<a id="conversation-and-workspace-moving-together"></a>

## گفتگو اور ورک اسپیس ساتھ ساتھ

کام عام زبان میں بتائیں؛ درست کنٹرول کے لیے بصری ٹولز کھولیں۔

![OpenCreator گفتگو اور بصری ورک اسپیس کا اشتراک](../images/examples/opencreator-auto-clips-en.png)

<a id="fine-grained-workspace-controls"></a>

### باریک بصری کنٹرول

سب ٹائٹل، شاٹ، آڈیو اور تخلیق کی ترتیبات درست انداز سے بدلیں۔

<a id="flexible-conversational-edits"></a>

### گفتگو سے تدوین

Agent کو تبدیلی بتائیں اور عام زبان میں نتیجہ بہتر کریں۔

<a id="synchronized-state"></a>

### ہم آہنگ حالت

گفتگو اور ورک اسپیس ایک کام کی حالت استعمال کرتے ہیں؛ بات دہرانے کی ضرورت نہیں۔

<a id="independent-versions"></a>

### الگ ورژن

ہر ترمیم الگ ورژن بناتی ہے؛ پرانے نتائج یا ترتیبات مٹتی نہیں۔

<a id="models-supported"></a>

## معاون ماڈل

زبان کے ماڈل Codex کی فہرست یا آپ کے OpenAI سے مطابقت رکھنے والے فراہم کنندہ سے آتے ہیں۔ تصویر، ویڈیو، آواز اور نقل نویسی ماڈل **Settings → AI Services** میں طے خدمات استعمال کرتے ہیں۔

دکھائے گئے ماڈل اور فراہم کنندگان مثالیں ہیں؛ حقیقی دستیابی اسناد، اکاؤنٹ کی رسائی اور پلیٹ فارم پر منحصر ہے۔

<a id="language-models"></a>

### زبان کے ماڈل

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

### تصاویر

<table>
<tr>
<td align="center" width="25%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>GPT Image</strong></td>
<td align="center" width="25%"><img src="../images/models/jimeng.png" alt="Jimeng" width="40" height="40" /><br /><strong>Seedream 4.0</strong><br />Jimeng</td>
<td align="center" width="25%"><img src="../images/models/kling.png" alt="Kling" width="40" height="40" /><br /><strong>Kling v2.1</strong><br />Kling Image</td>
<td align="center" width="25%"><img src="../images/models/gemini.png" alt="Gemini" width="40" height="40" /><br /><strong>Nano Banana</strong><br />Gemini 2.5 Flash Image</td>
</tr>
</table>

<a id="video"></a>

### ویڈیو

<table>
<tr>
<td align="center" width="33%"><img src="../images/models/seedance.png" alt="Seedance" width="40" height="40" /><br /><strong>Seedance 2.5</strong></td>
<td align="center" width="33%"><img src="../images/models/kling.png" alt="Kling" width="40" height="40" /><br /><strong>Kling v2.1 Master</strong></td>
<td align="center" width="33%"><img src="../images/models/gemini.png" alt="Gemini" width="40" height="40" /><br /><strong>Veo 3.1</strong></td>
</tr>
</table>

<a id="voice-and-transcription"></a>

### آواز اور نقل نویسی

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

دستیاب ہونے پر مقامی نقل نویسی میں faster-whisper، WhisperKit اور whisper.cpp بھی معاون ہیں۔

<a id="examples"></a>

## مثالیں

<a id="video-translation"></a>

### ویڈیو ترجمہ

درج ذیل عوامی مثالیں اس وقت بنیں جب OpenCreator کا نام KrillinAI تھا۔ یہ سب ٹائٹل مطابقت، ترجمے، ڈبنگ اور عمودی ویڈیو کا مستحکم عمل دکھاتی ہیں، جسے اب Video Translation ورک اسپیس وسیع Agent عمل سے جوڑتی ہے۔

نیچے کی سب ٹائٹل فائل 46 منٹ کی مقامی ویڈیو سے ایک Run میں بنی، بغیر دستی اصلاح کے۔ شائع شدہ نتیجے میں مکمل احاطہ، غیر متداخل سطریں، قدرتی تقسیم اور معیاری ترجمہ نظر آتا ہے۔

![OpenCreator سب ٹائٹل مطابقت کی مثال](../images/examples/krillinai-subtitle-alignment.png)

<table width="100%">
<tr>
<td width="33%">

<a id="subtitle-translation"></a>

#### سب ٹائٹل ترجمہ

https://github.com/user-attachments/assets/bba1ac0a-fe6b-4947-b58d-ba99306d0339

</td>
<td width="33%">

<a id="dubbing"></a>

#### ڈبنگ

https://github.com/user-attachments/assets/0b32fad3-c3ad-4b6a-abf0-0865f0dd2385

</td>
<td width="33%">

<a id="portrait-mode"></a>

#### عمودی انداز

https://github.com/user-attachments/assets/c2c7b528-0ef8-4ba9-b8ac-f9f92f6d4e71

</td>
</tr>
</table>

> یہ ویڈیو مثالیں اور سب ٹائٹل مطابقت کی تصویر KrillinAI نام کے دور کی ہیں۔

<a id="video-downloader"></a>

### ویڈیو ڈاؤن لوڈر

10 معاون پلیٹ فارم کے عوامی ویڈیو لنک جانچیں، فارمیٹ موازنہ کریں اور ویڈیو یا آڈیو براہِ راست منصوبے میں ڈاؤن لوڈ کریں۔

معاون ویڈیو ذرائع:

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

دستیابی ویڈیو اور خطے کے مطابق بدلتی ہے؛ بعض ذرائع کو پلیٹ فارم کوکی چاہیے۔

![OpenCreator ویڈیو ڈاؤن لوڈر میں فارمیٹ انتخاب](../images/examples/video-downloader-formats-and-subtitles-en.png)

<a id="video-generation"></a>

### ویڈیو بنانا

Seedance سے متنی پرامپٹ یا حوالہ تصویر پر AI ویڈیو بنائیں۔ ماڈل، تناسب، ریزولیوشن اور دورانیہ مقرر کرکے منصوبے میں ہر ورژن دیکھیں، دوبارہ بنائیں یا ڈاؤن لوڈ کریں۔

![Seedance سے OpenCreator ویڈیو تخلیق](../images/examples/video-generation-seedance-en.png)

<a id="stick-figure-animation"></a>

### اسٹک فگر اینیمیشن

OpenCreator نے یہ اصل کرداروں کا مجموعہ مصور [Harbor Hsia](https://www.behance.net/xiaheyuan1)، [Behance پر Stickman](https://www.behance.net/gallery/254715463/Stickman) کے خالق، کے ساتھ تیار کیا۔ شامل کردار پورے اینیمیشن عمل میں یکساں شناخت رکھتے ہیں۔

![مصور کے تعاون سے OpenCreator اسٹک فگر کردار](../images/examples/stick-figure-characters.webp)

اسکرپٹ جائزے، بیان، وقت، اسٹوری بورڈ، سب ٹائٹل اور رینڈرنگ کے رہنما عمل سے متن یا YouTube مواد کو مکمل قابلِ ڈاؤن لوڈ اینیمیشن بنائیں۔

![OpenCreator اسٹک فگر اینیمیشن کا فریم](../images/examples/stick-figure-animation-frame.jpg)

<a id="quick-start"></a>

## فوری آغاز

<a id="install-the-desktop-app"></a>

### Desktop ایپ نصب کریں

[تازہ ترین OpenCreator ریلیز](https://github.com/krillinai/OpenCreator/releases/latest) سے macOS Apple Silicon، macOS Intel یا Windows x64 کا انسٹالر لیں۔ نصب کرکے کھولیں؛ Node.js یا pnpm ضروری نہیں۔ Codex CLI شامل ہے؛ حقیقی ماڈل کام کے لیے قابلِ استعمال ChatGPT سائن اِن یا API key سیٹ اپ چاہیے۔

پہلی بار Desktop مقامی Runtime چلاتا، طے شدہ منصوبہ بناتا اور Codex ترتیب دیکھتا ہے۔ موزوں سائن اِن یا API key اور ماڈل ترتیبات ملیں تو **Use local Codex and continue** منتخب کریں۔ اسی عمل میں دوسرا فراہم کنندہ بھی طے کر سکتے ہیں:

![Desktop پہلی بار ماڈل فراہم کنندہ کا سیٹ اپ](../images/product/opencreator-codex-setup.png)

سیٹ اپ کے بعد ان پٹ خانے میں درخواست لکھیں۔ مسئلہ ہو تو [صارف رہنما اور خرابیوں کا حل](../opencreator-user-guide-and-troubleshooting.md) دیکھیں۔

<a id="run-web-from-source"></a>

### سورس سے Web چلائیں

ترقی یا براؤزر میں استعمال کے لیے نصب کریں:

- Node.js 22 یا جدید تر
- pnpm 9.15.0، ریپوزٹری کے `packageManager` میں مقرر
- ٹرمینل سے دستیاب Codex CLI کی قابلِ اجرا فائل
- حقیقی ماڈل کام کے لیے درست Codex CLI لاگ اِن

پہلے مقامی ماحول جانچیں:

<div dir="ltr">

```bash
node --version
pnpm --version
codex --version
```

</div>

<div dir="ltr">

```bash
git clone https://github.com/krillinai/OpenCreator.git
cd OpenCreator
corepack enable
pnpm install
pnpm web:dev
```

</div>

`http://127.0.0.1:19861/` کھولیں۔ ترقیاتی سرور ضرورت پر مقامی daemon چلاتا اور یکساں ماخذ کے پراکسی سے عارضی Runtime ٹوکن شامل کرتا ہے؛ دستی نقل کی ضرورت نہیں۔

پہلی بار Runtime طے شدہ منصوبہ بناتا اور Codex ترتیبات دیکھتا ہے۔ مقامی Codex کے لیے ChatGPT سائن اِن یا API key کی تصدیق کریں، یا فراہم کنندہ چن کر ماڈل، endpoint اور API key دیں۔ پھر ان پٹ خانہ تیار ہے۔ صرف daemon پر کام کے لیے:

<div dir="ltr">

```bash
pnpm daemon:dev
```

</div>

daemon صرف لوپ بیک پتے پر سنتا ہے اور رابطے کا پتہ و عارضی ٹوکن ایک بار stdout پر لکھتا ہے۔

<a id="desktop"></a>

## Desktop

Desktop اور براؤزر `apps/web` کا ایک React فرنٹ اینڈ استعمال کرتے ہیں۔ منصوبے، گفتگو، کام اور ترتیبات ایک Daemon/API کو بلاتے ہیں۔ Electron صرف حقیقی سسٹم پاتھ، ونڈو کنٹرول، ٹرے اور مقامی اطلاعات شامل کرتا ہے۔

<a id="development-mode"></a>

### ترقیاتی موڈ

<div dir="ltr">

```bash
pnpm desktop:dev
```

</div>

<a id="local-packaging"></a>

### مقامی پیکیجنگ

| کمانڈ | نتیجہ |
| --- | --- |
| `pnpm desktop:package` | مقامی جانچ کے لیے موجودہ پلیٹ فارم پر چلنے والا فولڈر |
| `pnpm desktop:dist` | موجودہ پلیٹ فارم کا انسٹالر |
| `pnpm desktop:release` | رسمی ریلیز پیکیجنگ کا نقطۂ آغاز |
| `pnpm --filter @opencreator/desktop verify:package` | موجود Desktop پیکیج کی جانچ |
| `pnpm krillinai:package` | منتخب پلیٹ فارم کے الگ KrillinAI Server اور CLI آرکائیو |

Desktop پیکیجنگ موجودہ ورک اسپیس سے Web دوبارہ بناتی؛ commit، commit نہ کی گئی تبدیلیوں کی حالت، پلیٹ فارم، ساخت اور Web hash درج کرتی؛ اور `apps/web/dist` کو ایپ کے شامل وسائل سے ملاتی ہے۔ فرق ہو تو پیکیجنگ ناکام ہوتی ہے۔ دستخط، notarization، Windows بلڈ اور ریلیز شرائط کے لیے [Desktop ریلیز رہنما](../operations/opencreator-desktop-release-runbook.md) دیکھیں۔

<a id="core-workflows"></a>

## بنیادی طریقۂ کار

<a id="conversations-and-runs"></a>

### گفتگو اور Run

1. منصوبہ منتخب یا نئی گفتگو شروع کریں۔
2. کام لکھیں؛ اجازت کی سطح، Profile، ماڈل اور استدلال کی کوشش منتخب کریں۔
3. فعال Run کے دوران اگلے کام قطار میں دیں یا روک کر فوراً جاری رکھیں۔
4. Timeline میں استدلال کے خلاصے، ٹول کال، فائل تبدیلیاں، منظوری اور نتائج دیکھیں۔
5. کام کے مرکز میں تمام جاری، مکمل، ناکام اور منظوری کے منتظر کام دیکھیں۔

<a id="skills-and-mcp"></a>

### Skills اور MCP

- پلگ اِن مرکز میں Skill بازار، تنصیب کا ریکارڈ اور مقامی Skills دیکھیں۔
- ان پٹ میں `/` یا شامل کرنے کے مینو سے Skill چنیں تاکہ اگلا کام اس کا عمل اپنائے۔
- MCP انتظام Codex کی اصل کمانڈ اور ترتیب سے ہوتا ہے، الگ عملی انجن نہیں۔
- فعال `$CODEX_HOME` پہلے سے استعمال ہوتا ہے؛ عالمی Skills یا MCP بدلنے سے پہلے اثر دیکھیں۔

<a id="schedules-and-dedicated-task-threads"></a>

### شیڈول اور مخصوص کام کے تھریڈ

- ہر شیڈول کی مستقل، مخصوص OpenCreator گفتگو ہے۔
- خودکار ٹرگر، دستی Run اور اگلی درخواستیں وہی گفتگو استعمال کرتے اور `queue` یا `skip` کے تحت باری باری چلتے ہیں۔
- شیڈول مٹانے سے گفتگو آرکائیو ہوتی ہے؛ موجود Run، نتائج اور Codex تاریخ محفوظ رہتی ہے۔
- اندرونی Codex تھریڈ بدلنے یا بحال کرنے سے OpenCreator کام کی اندراج یا صفحے کا راستہ نہیں بدلتا۔

<a id="opencreator-system-architecture"></a>

## OpenCreator نظام کی ساخت

بصری ورک اسپیس اور Agent گفتگو ایک تخلیقی کام کے دو انٹرفیس ہیں۔ ہر عمل اسٹیٹ مشین ہے: ماخذ، ترتیب، تخلیق، جائزہ، ترمیم اور برآمد واضح حالتیں اور واقعات ہیں۔ بصری اقدامات اور گفتگو کی ہدایات ایک مشین میں جاتی ہیں؛ موجودہ مرحلہ، ترتیب، پیش رفت، ورژن اور نتائج دونوں انٹرفیس پر لوٹتے ہیں۔ یوں ایک مستند حالت سے ہم آہنگی برقرار رہتی ہے۔

تخلیقی کام بار بار بہتر ہوتا ہے۔ ہر اصلاح یا دوبارہ تخلیق موجودہ عمل سے نیا ورژن بناتی ہے، پرانا نتیجہ نہیں مٹاتی۔ پرانی ترتیبات اور نتائج جائزے، موازنے اور مزید بہتری کے لیے رہتے ہیں۔

<div dir="ltr">

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

</div>

| OpenCreator جزو | ذمہ داری | نفاذ |
| --- | --- | --- |
| تخلیقی تجربہ | Dashboard، ٹولز، Agent گفتگو، ترتیبات اور فائلیں | `apps/web` · React 18 · Vite · TypeScript |
| اشتراک کا مرکز | مراحل، گفتگو کا سیاق، پیش رفت، نتائج اور ترمیم ہم آہنگ رکھنا | مشترکہ عمل کی حالت · `CreatorCollaborationPanel` · ورژن کی تاریخ |
| مقامی Runtime | منصوبے، Run، منظوری، شیڈول، یادداشت اور اطلاعات | `apps/daemon` · Fastify · Runtime API · SSE |
| Runtime اجزا | شامل، فعال اور نئے ورژن؛ باقاعدہ جانچ؛ صرف صارف کے مطلوب اپ ڈیٹ | yt-dlp nightly · اپ ڈیٹ کی تصدیق · کارآمد ورژن پر واپسی |
| Codex انجن | Agent لوپ، سیشن، استدلال، ٹولز، Skills اور MCP | Codex CLI · app-server |
| میڈیا ٹولچین | ڈاؤن لوڈ، نقل نویسی، تبدیلی، تخلیق اور برآمد | yt-dlp · Whisper · FFmpeg · ترتیب شدہ AI خدمات |
| مقامی ڈیٹا | منصوبے، Run، منسلکات، نتائج اور اسناد مقامی رکھنا | SQLite · فائل سسٹم · سسٹم اسناد کا ذخیرہ |
| Desktop ہوسٹ | مشترکہ Web بلڈ لوڈ اور OS صلاحیتیں شامل کرنا | `apps/desktop` · Electron · Preload Bridge |

بنیادی اصول:

- ورک اسپیس اور Agent گفتگو ایک عمل کی حالت دکھاتے اور اسی اسٹیٹ مشین کو واقعات بھیجتے ہیں۔
- ترمیم نئے ورژن بناتی ہے، ہر تخلیقی تکرار کا سیاق اور نتیجہ محفوظ رہتا ہے۔
- فرنٹ اینڈ Codex براہِ راست نہیں چلاتا اور خام Codex JSONL واقعات پر منحصر نہیں۔
- daemon عمل کا دورِ حیات، واقعات کی یکسانیت، مستقل ذخیرہ، منظوری، شیڈول اور اطلاعات کا آؤٹ باکس سنبھالتا ہے۔
- Agent لوپ، Skills اور MCP کے اجرا کا مستند ذریعہ Codex ہے۔
- Browser Bridge اور Desktop Bridge میں عمومی منطق کی الگ نقل نہیں۔

<a id="repository-layout"></a>

## ریپوزٹری کی ترتیب

<div dir="ltr">

```text
OpenCreator/
├── apps/
│   ├── web/          # واحد React فرنٹ اینڈ
│   ├── daemon/       # مقامی Fastify Runtime اور Codex اڈاپٹر
│   ├── desktop/      # Electron Main، Preload، مقامی صلاحیتیں اور پیکیجنگ
│   └── harness/      # Runtime کی کمانڈ لائن جانچ
├── packages/
│   ├── protocol/     # Web، Daemon اور Desktop کے مشترکہ Runtime معاہدے
│   └── skill-market/ # Skill بازار کے ماڈل اور مشترکہ منطق
├── docs/             # ڈیزائن، API، عملی رہنما اور جانچ رپورٹ
├── scripts/          # ریپوزٹری سطح کی جانچ
└── .runtime/         # مقامی Runtime ڈیٹا؛ پہلی بار بنتا ہے
```

</div>

<a id="configuration"></a>

## ترتیب

<a id="ai-service-api-keys"></a>

### AI خدمات کی API key

**Settings → AI Services** میں موجودہ ورک اسپیس کے ماڈل، نقل نویسی، آواز اور تصویر کے فراہم کنندگان طے کریں۔ آئندہ ٹولز کے لیے اضافی زمرے دکھ سکتے ہیں۔ ہر زمرہ منتخب خدمت کے ضروری خانے ہی دکھاتا ہے: Base URL، API Key، ماڈل، پراکسی یا مخصوص اسناد۔

![OpenCreator AI خدمات کی API key ترتیبات](../images/product/opencreator-ai-services-en.png)

اسناد مقامی Runtime کے سسٹم ذخیرے میں محفوظ ہوتی ہیں؛ کبھی ریپوزٹری میں commit نہ کریں۔ Edge TTS جیسی کچھ مقامی یا سسٹم خدمات کو API Key نہیں چاہیے۔

<a id="account-and-subscriptions"></a>

### اکاؤنٹ اور رکنیت

ذاتی مرکز میں اکاؤنٹ، تصدیق شدہ رکنیت اور دستیاب کریڈٹ ہیں۔ سائن اِن سے `https://www.open-creator.ai/device` کھلتا ہے۔ ویب سائٹ پر لاگ اِن کرکے آلہ منظور کریں؛ مقامی Daemon اپنا سیشن پاتا ہے۔ براؤزر اور ایپ کا اکاؤنٹ ایک، سیشن الگ ہیں۔




رکنیت OpenCreator میں منتخب کریں۔ خرید سے Stripe Checkout اور انتظام سے Stripe Billing Portal کھلتا ہے۔ ادائیگی کے بعد واپسی `/billing/return` سے ہوتی ہے، ویب سیشن ضروری نہیں۔ تصدیق شدہ Stripe اطلاع کے بعد Gateway سے فوائد تازہ ہوتے ہیں۔ `/pricing` اور `/account` بھی اسی رکنیت نظام تک خرید کا راستہ دیتے ہیں۔






<a id="third-party-runtime-components"></a>

### تیسرے فریق کے Runtime اجزا

**Settings → Third-party Components** میں فعال yt-dlp nightly، شامل ورژن، ماخذ اور تازہ ریلیز دیکھیں۔ ہر سات دن جانچ ہوتی ہے، خودکار تنصیب نہیں۔ اپ ڈیٹ صارف کی واضح کارروائی سے ہوتا ہے؛ ڈاؤن لوڈ، تصدیق یا تنصیب ناکام ہو تو کارآمد ورژن رہتا ہے۔

![OpenCreator تیسرے فریق کے اجزا کی ترتیبات](../images/product/opencreator-third-party-components-en.png)

<a id="runtime-environment-variables"></a>

### Runtime ماحول کے متغیرات

اکثر صارفین کو ماحول کے متغیرات ضروری نہیں۔ الگ ڈیٹا، مخصوص Codex فائل یا حسبِ ضرورت منصوبوں کے فولڈر کے لیے استعمال کریں:

| ماحول کا متغیر | طے شدہ | مقصد |
| --- | --- | --- |
| `OPENCREATOR_DATA_DIR` | `.runtime` | OpenCreator ڈیٹابیس، Run، منسلکات اور زیرِ انتظام ورک اسپیس |
| `OPENCREATOR_GATEWAY_ORIGIN` | `https://www.open-creator.ai` | لاگ اِن، رکنیت، کریڈٹ اور آفیشل ماڈل خدمات کا Gateway؛ مقامی Gateway کے لیے بدلیں |
| `OPENCREATOR_CODEX_BIN` | `codex` | Codex CLI کی قابلِ اجرا فائل کا راستہ |
| `CODEX_HOME` | `~/.codex` | Codex سیشن، ترتیب، Skills، MCP اور Profiles کا مستند ذریعہ |
| `OPENCREATOR_DEFAULT_CWD` | موجودہ کام کا فولڈر | daemon کا طے شدہ کام کا فولڈر |
| `OPENCREATOR_DEFAULT_PROJECT_ROOT` | Runtime کی طے شدہ پالیسی | زیرِ انتظام منصوبوں کی جڑ؛ مقرر ہو تو اس کا `OpenCreator/` ذیلی فولڈر استعمال ہوتا ہے |
| `OPENCREATOR_CODEX_THREAD_ROTATION_RUN_THRESHOLD` | `50` | طویل شیڈول میں Codex تھریڈ بدلنے کی ختم شدہ Run حد؛ `0` سے پیشگی تبدیلی بند |

مثال: Runtime ڈیٹا اور Codex ماحول الگ کریں:

<div dir="ltr">

```bash
OPENCREATOR_DATA_DIR=/path/to/opencreator-data \
CODEX_HOME=/path/to/codex-home \
pnpm web:dev
```

</div>

<a id="data-and-security"></a>

## ڈیٹا اور تحفظ

Runtime ڈیٹا عموماً ریپوزٹری کی جڑ کے `.runtime/` میں رہتا ہے:

| راستہ | مواد |
| --- | --- |
| `.runtime/app.sqlite` | منصوبے، تھریڈ، Run، واقعات، شیڈول، اطلاعات، منسلکات کی تفصیل، منظوری، یادداشت اور خلاصے |
| `.runtime/runs/` | ہر Run کے حساس معلومات ہٹائے گئے لاگ، تشخیص اور میٹاڈیٹا |
| `.runtime/attachments/` | کنٹرول شدہ منسلک فائلیں |
| `.runtime/workspaces/` | Runtime کے زیرِ انتظام منصوبوں کی ورک اسپیس |

Codex سیشن اور ترتیب `$CODEX_HOME` میں رہتے ہیں؛ `.runtime/` سے الگ بیک اپ لیں۔

تحفظ کی حدود:

- daemon صرف `127.0.0.1` پر سنتا ہے؛ صحت کی جانچ کے سوا ہر API کو Bearer ٹوکن چاہیے۔
- HTML پیش منظر میں اسکرپٹ، نیویگیشن اور پاپ اپ پہلے سے بند؛ اسی ورک اسپیس کے کنٹرول شدہ نسبتی وسائل جائز ہیں۔
- حساس یادداشت کے لیے دوسری تصدیق ضروری؛ غیر تصدیق شدہ تجاویز خود مستقل محفوظ نہیں ہوتیں۔
- تشخیص اور Run لاگ واپس یا برآمد کرنے سے پہلے حساس معلومات ہٹتی ہیں۔
- Desktop میں ASAR سالمیت اور کوکی خفیہ کاری فعال؛ RunAsNode، `NODE_OPTIONS` اور Node CLI Inspector غیر فعال ہیں۔

بیک اپ، بحالی، صفائی اور ری سیٹ کے مکمل مراحل [صارف رہنما](../opencreator-user-guide-and-troubleshooting.md) میں ہیں۔

<a id="development"></a>

## ترقی

<a id="common-commands"></a>

### عام کمانڈ

| کمانڈ | مقصد |
| --- | --- |
| `pnpm web:dev` | Web اور ضرورت پر مقامی daemon شروع کریں |
| `pnpm daemon:dev` | صرف daemon شروع کریں |
| `pnpm desktop:dev` | انحصارات بنائیں اور ترقیاتی موڈ میں Electron چلائیں |
| `pnpm test` | ورک اسپیس کے یونٹ اور انضمامی ٹیسٹ |
| `pnpm typecheck` | پوری ریپوزٹری کی TypeScript جانچ |
| `pnpm build` | تمام ورک اسپیس بلڈ کریں |
| `pnpm e2e` | Web Playwright E2E ٹیسٹ |
| `pnpm smoke:ci` | فرضی Codex سے Runtime smoke test |
| `pnpm perf:check` | ریکارڈ شدہ کارکردگی کی بنیادی سطح جانچیں |

تبدیلی جمع کرنے سے پہلے اثر کے مطابق [شراکت رہنما](../../CONTRIBUTING.md#what-reviewers-check) کی جانچ منتخب کریں۔ نثر، دستاویز اور انداز کے لیے متعلقہ جانچ کافی؛ مشترکہ رویے اور Runtime کے لیے مخصوص ماڈیول ٹیسٹ اور typecheck ضروری ہیں۔ دائرہ تقاضا کرے تو مکمل ٹیسٹ یا بلڈ چلائیں اور PR میں لکھیں۔

Desktop، Host Bridge، Runtime پراکسی یا مشترکہ فرنٹ اینڈ عمل میں تبدیلی کے لیے Web/Desktop مطابقت، پیکیج ایپ E2E اور Web hash کی جانچ بھی ضروری ہے۔ صرف Web یونٹ ٹیسٹ Desktop ریلیز کی تیاری ثابت نہیں کرتے۔

حقیقی Codex smoke test پہلے سے بند ہے۔ واضح طور پر فعال کریں:

<div dir="ltr">

```bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

</div>

<a id="documentation"></a>

## دستاویزات

- **استعمال:** [فوری آغاز](#quick-start) · [رہنما اور خرابیوں کا حل](../opencreator-user-guide-and-troubleshooting.md)
- **ترقی اور توسیع:** [شراکت](../../CONTRIBUTING.md) · [ضابطۂ اخلاق](../../CODE_OF_CONDUCT.md) · [Skill شراکت](../contributing/skills-contributing.md) · [سانچے کی شراکت](../contributing/templates-contributing.md) · [Runtime API v1](../runtime-api-for-ui-v1.md) · [بصری اجزا کی رہنمائی](../visual-component-guidelines.md)
- **دیکھ بھال اور ریلیز:** [Codex پر مبنی Runtime ڈیزائن](../2026-07-03-codex-native-agent-runtime-design.md) · [Desktop ریلیز عمل](../operations/opencreator-desktop-release-runbook.md) · [Windows Desktop ریلیز](../operations/opencreator-desktop-windows-release.md)

<a id="translation-convention"></a>

## ترجمے کا اصول

اصل `README.md` مستند انگریزی دستاویز ہے۔ تراجم `docs/<locale>/README.md` میں ہیں۔ پورا متن ترجمہ اور انگریزی ساخت سے ہم آہنگ کرنے کے بعد ہی زبان فہرست میں شامل کریں۔

<a id="community"></a>

## کمیونٹی

<p><strong>کم از کم 107 ممالک اور خطوں</strong> کے GitHub صارفین نے OpenCreator کو اسٹار دیا ہے۔</p>

<img src="../images/star-coverage-map.svg" alt="OpenCreator کو GitHub اسٹار دینے والے ممالک اور خطوں کا نقشہ" width="760" />

<a id="the-crew"></a>

### ذمہ دار ٹیم

ہر رکن اپنے شعبے کے معیار، شراکت کے جائزے اور مرج اور کمیونٹی کی معاونت کا ذمہ دار ہے۔

<table border="1" cellpadding="12">
  <tr>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/wulien.svg" width="64" height="64" alt="wulien avatar" /><br /><a href="https://github.com/wulien">wulien</a><br />کوڈ اور خرابیوں کی اصلاح</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/dle-kb.svg" width="64" height="64" alt="DLe-kb avatar" /><br /><a href="https://github.com/DLe-kb">DLe-kb</a><br />تخلیقی سانچے</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/xiaheyuan.svg" width="64" height="64" alt="xiaheyuan avatar" /><br /><a href="https://github.com/xiaheyuan">xiaheyuan</a><br />ڈیزائن اور وسائل</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/krillinai.svg" width="64" height="64" alt="krillinai avatar" /><br /><a href="https://github.com/krillinai">krillinai</a><br />Skills اور دستاویزات</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/hbxugang.svg" width="64" height="64" alt="hbxugang avatar" /><br /><a href="https://github.com/hbxugang">hbxugang</a><br />اداروں میں تنصیب</td>
  </tr>
</table>

<a id="contributors"></a>

### شراکت دار

کوڈ، دستاویزات، رائے، خرابی رپورٹ، Skills، تصاویر اور خیالات سے حصہ لینے والے سب کا شکریہ۔
README کی یہ فہرست GitHub کے خودکار Contributors گراف سے الگ رکھی جاتی ہے۔

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

### شراکت

ان شعبوں میں تعاون خوش آمدید:

| قسم | کیا دیں | مقام | حجم |
| --- | --- | --- | --- |
| کوڈ | خرابی اصلاح، تخلیقی عمل، مشترکہ خصوصیات | `apps/web/`, `apps/daemon/` | ٹیسٹ سمیت ایک مرکوز PR |
| Skills | قابلِ استعمال Agent عمل | [`skills/`](../../skills/) | `SKILL.md` اور اختیاری حوالوں والا فولڈر → [رہنما](../contributing/skills-contributing.md) |
| تخلیقی سانچے | قابلِ استعمال تصویر، ویڈیو یا سرورق کی ترتیبات | [`template/`](../../template/) | `template.json` اور وسائل والا فولڈر → [رہنما](../contributing/templates-contributing.md) |
| مصورانہ کام اور ڈیزائن | اصل تصاویر، آئیکن یا UI ڈیزائن | متفقہ وسائل کا مقام | پیش منظر، سورس اور لائسنس سمیت PR |
| تیسرے فریق کا انضمام | AI یا میڈیا فراہم کنندہ کی معاونت | متعلقہ Web یا Daemon ماڈیول | خرابی انتظام، اسناد کے تحفظ اور ٹیسٹ سمیت PR |
| دستاویزات اور تراجم | دستاویز کی بہتری یا نئی زبان | `README.md`, `docs/`, `docs/<locale>/` | ایک PR |

مقامی سیٹ اپ، جائزے کے معیار اور عام رد ہونے کی وجوہ سمیت مکمل رہنما [CONTRIBUTING.md](../../CONTRIBUTING.md) میں ہے؛ [10 زبانوں](../zh/CONTRIBUTING.md) میں دستیاب ہے۔

<a id="star-history"></a>

## اسٹار کی تاریخ

OpenCreator پہلے KrillinAI تھا۔ چارٹ میں نام بدلنے سے پہلے اور بعد کی پوری تاریخ ہے۔

[![OpenCreator اسٹار کی تاریخ](https://api.star-history.com/svg?repos=krillinai/OpenCreator&type=date)](https://www.star-history.com/?type=date&repos=krillinai%2FOpenCreator)

<a id="related-projects"></a>

## متعلقہ منصوبے

| منصوبہ | کردار |
| --- | --- |
| [OpenAI Codex](https://github.com/openai/codex) | ماڈل رسائی، استدلال، ٹول کال، سیشن، Skills اور MCP کا Agent عملی انجن۔ |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | عوامی میڈیا لنک کی جانچ، فارمیٹ فہرست اور ویڈیو یا آڈیو ڈاؤن لوڈ۔ |
| [FFmpeg](https://ffmpeg.org/) | FFmpeg اور ffprobe سے میڈیا تبدیلی، ترکیب، فریم اخذ اور نتائج کی جانچ۔ |
| [Whisper](https://github.com/openai/whisper), [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [faster-whisper](https://github.com/SYSTRAN/faster-whisper) اور [WhisperKit](https://github.com/argmaxinc/WhisperKit) | Runtime صلاحیت کے مطابق کلاؤڈ اور پلیٹ فارم کی مقامی آواز کی نقل نویسی۔ |
| [React](https://react.dev/) | Web اور Desktop کے مشترکہ انٹرفیس کی بنیاد۔ |
| [Fastify](https://fastify.dev/) | مقامی Runtime کی HTTP اور API بنیاد۔ |
| [Electron](https://www.electronjs.org/) | مقامی سسٹم صلاحیت، ایپ زندگی اور پیکیجنگ کا Desktop ہوسٹ۔ |
| [SQLite](https://www.sqlite.org/) | منصوبوں، گفتگو، Run، شیڈول، یادداشت اور دوسرے ڈیٹا کا مقامی ذخیرہ۔ |
| [Model Context Protocol](https://modelcontextprotocol.io/) | بیرونی ٹولز اور خدمات کو Agent ورک اسپیس سے جوڑنے کا کھلا پروٹوکول۔ |

---

<div align="center">

**OpenCreator · مقامی تخلیق، مسلسل کام۔**

</div>

</div>
