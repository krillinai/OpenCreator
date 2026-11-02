<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../images/OpenCreator_logo_vector_dark.svg" />
    <img src="../images/OpenCreator_logo_vector.svg" alt="OpenCreator" width="380" />
  </picture>
  <br />
  مساحة عمل ذكاء اصطناعي مفتوحة المصدر وSkills للمبدعين
</h1>

<p>اجمع أدوات الإنشاء المرئية وSkills القابلة لإعادة الاستخدام وAgents لإنشاء النصوص والفيديو والصور والصوت والصور الرمزية والترجمة والتحرير، كل ذلك في مساحة عمل واحدة.</p>

<p><strong>كان OpenCreator يُعرف سابقًا باسم KrillinAI.</strong></p>

<a href="https://trendshift.io/repositories/13360" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13360" alt="OpenCreator (المعروف سابقًا باسم KrillinAI): المستودع رقم 1 لهذا اليوم على Trendshift" width="250" height="55" /></a>

[English](../../README.md) | [简体中文](../zh/README.md) | [日本語](../ja/README.md) | [한국어](../ko/README.md) | [Bahasa Indonesia](../id/README.md) | [Español](../es/README.md) | [Français](../fr/README.md) | [Deutsch](../de/README.md) | [Português](../pt/README.md) | [Русский](../ru/README.md) | **العربية** | [ภาษาไทย](../th/README.md) | [Türkçe](../tr/README.md) | [हिन्दी](../hi/README.md) | [বাংলা](../bn/README.md) | [اردو](../ur/README.md) | [Tiếng Việt](../vi/README.md) | [Filipino](../fil/README.md)

[![GitHub Stars](https://badgen.net/github/stars/krillinai/OpenCreator?icon=github&label=Stars&color=EAB308)](https://github.com/krillinai/OpenCreator/stargazers)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Bilibili](https://img.shields.io/badge/dynamic/json?label=Bilibili&query=%24.data.follower&suffix=%E7%B2%89%E4%B8%9D&url=https%3A%2F%2Fapi.bilibili.com%2Fx%2Frelation%2Fstat%3Fvmid%3D242124650&logo=bilibili&color=00A1D6&labelColor=FE7398&logoColor=FFFFFF)](https://space.bilibili.com/242124650)
[![AtomGit G-Star](https://img.shields.io/badge/AtomGit-G--Star-DA203E?style=flat)](https://atomgit.com/krillinai/OpenCreator)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/fUNvbqDaw)
[![مجموعة QQ](https://img.shields.io/badge/QQ%20群-754069680-green?logo=tencent-qq)](https://qm.qq.com/q/W4YC0PLMeA)

[الميزات](#أبرز-ميزات-المشروع) · [الأدوات](#أدوات-الإنشاء) · [Skills](#skills) · [أمثلة](#أمثلة) · [البدء](#البدء-السريع) · [Desktop](#desktop) · [الوثائق](#الوثائق) · [المجتمع](#المجتمع)

</div>

![مساحة عمل Agent في OpenCreator](../images/opencreator-home-en.png)

## نظرة عامة على المشروع

صُمم OpenCreator للأفراد والفرق الذين يرغبون في إبقاء أعمالهم الإبداعية والتطويرية قيد التشغيل محليًا. وبدلًا من إعادة تنفيذ حلقة Agent، يستخدم Codex CLI كمحرك للتنفيذ ويضيف إليه Runtime محليًا مستقرًا ومساحة عمل مرئية ومضيف Desktop.

يقدّم OpenCreator طريقتين مترابطتين للعمل:

- **مساحة عمل المحتوى**: استخدم الأدوات المرئية وقوالب الإنشاء لترجمة الفيديو وتنزيله وإنشاء الصور المصغرة وتوليد الصور وغير ذلك من المهام الإبداعية.
- **محادثة Agent**: ابدأ مهام الإبداع أو التطوير ووجّهها باللغة الطبيعية، ونظّم المحادثات حسب المشروع، وأبقِ Runs قيد العمل في الخلفية، وأدر الموافقات والمرفقات والملفات وSkills وMCP والجداول الزمنية والإشعارات والذاكرة والتشخيصات من مكان واحد.

يمثل Web تطبيق الواجهة الأمامية الوحيد. يحمّل Desktop بناء Web نفسه ولا يضيف سوى الإمكانات التي تتطلب نظام التشغيل، مثل اختيار المجلدات ودورة حياة النوافذ وسلوك علبة النظام والإشعارات الأصلية. وعند استخدام البيانات نفسها وأبعاد عرض المحتوى نفسها، تشترك المنصتان في الواجهة العامة وسلوك Runtime ذاتهما.

## أبرز ميزات المشروع

- 🤖 **تكامل أصلي مع Codex**: أعد استخدام حلقة Agent والنماذج والاستدلال واستدعاءات الأدوات والمحادثات وSkills وMCP في Codex دون الحاجة إلى صيانة محرك تنفيذ ثانٍ.

- 🚀 **تطبيق Desktop جاهز للاستخدام**: شغّل OpenCreator مباشرة من تطبيق Desktop الذي يتضمن Codex CLI؛ يبدأ Runtime المحلي عند الطلب ويُجهز مشروعًا افتراضيًا تلقائيًا.

- ⚙️ **اكتشاف إعدادات Codex المحلية**: عند تشغيل Desktop لأول مرة، يفحص إعدادات Codex الموجودة ويتيح إعادة استخدام تسجيل دخول ChatGPT أو مفتاح API صالح. ويمكن إعداد مزوّد نماذج آخر عبر خطوات الإعداد الأولى.

- 🔄 **مكونات Runtime مُدارة**: اعرض إصدارات yt-dlp المضمّنة والنشطة والأحدث، وتحقق دوريًا من التحديثات وحدّث يدويًا، مع إبقاء الإصدار الحالي العامل متاحًا إذا فشل التحديث.

- 🎨 **إنشاء متعدد الوسائط**: أنشئ الفيديو والصور والصوت والترجمات والوثائق وأدرها ضمن مسار عمل واحد مترابط.

- 🧩 **قوالب الإنشاء**: أنشئ الصور والفيديوهات باستخدام قوالب قابلة لإعادة الاستخدام دون إعداد الأوصاف والإعدادات من الصفر.

- 🔗 **مسار عمل بوضعين**: اعمل من مساحة العمل المرئية أو من محادثة Agent، بينما تحافظ آلة حالات مشتركة على مزامنة الخطوات والتقدم والنتائج.

- 🕘 **إدارة الإصدارات**: ينشئ كل تعديل إصدارًا جديدًا مع الاحتفاظ بالإعدادات والمخرجات السابقة للمراجعة والمقارنة.

- 🧩 **Skills قابلة لإعادة الاستخدام**: استخدم Skills لسير عمل الفيديو، ووسّع قدرات Agent باستخدام Skills الخاصة بك، وأدر MCP عبر إعدادات Codex الأصلية.

- 🧠 **الذاكرة**: احتفظ بذاكرة عامة وذاكرة لكل مشروع ولكل سلسلة محادثة، إلى جانب الملخصات ولقطات مدخلات Run القابلة لإعادة الإنتاج.

- 🔐 **الأمان المحلي**: احتفظ بالبيانات والمرفقات والسجلات محليًا بشكل افتراضي، مع الموافقات والتشخيصات المنقحة لإخفاء المعلومات الحساسة.

- 🌐 **واجهة متعددة اللغات**: يدعم Web وDesktop عددًا قدره 43 لغة، مع اكتشاف لغة النظام والاختيار اليدوي وتخطيط من اليمين إلى اليسار للعربية والفارسية والأردية والعبرية.

## أدوات الإنشاء

يتضمن الإصدار الحالي ست أدوات إنشاء. تعتمد النماذج والخدمات المتاحة على بيئة Codex المحلية وإعدادات خدمات الذكاء الاصطناعي.

افتح Dashboard لترجمة الفيديو أو تنزيله، أو إنشاء الصور المصغرة والصور، أو إنتاج تعليق صوتي بText to Speech، أو توليد فيديو باستخدام Seedance.

![لوحة أدوات الإنشاء في OpenCreator](../images/product/opencreator-dashboard-en.png)

> تُضاف أدوات إنشاء جديدة باستمرار.

**توفر ترجمة الفيديو 123 لغة مصدر و124 خيار إخراج، بما في ذلك البينيين.** ابحث بالاسم الأصلي أو الإنجليزي أو الصيني أو رمز اللغة. تعتمد تغطية التعرف على الكلام وتوليد الصوت على الخدمة والنموذج المحددين.

- **ترجمة ملفات الترجمة فقط**: استورد ملف SRT وعاينه ثم ترجمه دون فيديو مصدر أو دبلجة أو تصيير فيديو.

- **تحرير متقدم للترجمة**: استخدم محررًا غامرًا مع موجة صوتية وخط زمني متزامنين مع التشغيل لضبط التوقيت وتقسيم المقاطع ودمجها والبحث عن النص واستبداله. عاين الأنماط على الفيديو، واضبط اللغة والصوت والإخراج، ثم أنشئ إصدارًا جديدًا مع الاحتفاظ بالنتائج السابقة.

- **إنشاء في صفحة واحدة**: اضبط توليد الصور والفيديو وText to Speech في صفحة واحدة، مع اختيار النموذج ومعاينة الصور المرجعية وخيارات الصور الخاصة بكل نموذج ومكتبة أصوات قابلة للبحث.

- **إخراج متعدد اللغات وتقدم مفصل**: تحسن الخطوط البديلة المضمنة عرض الكتابات المعقدة والترجمات من اليمين إلى اليسار. تابع تقدم التفريغ والترجمة والدبلجة والتصيير مع عدد العناصر المكتملة والإجمالي عند توفره.

<table width="100%">
<thead>
<tr>
<th width="18%">الأداة</th>
<th width="14%">الحالة</th>
<th width="68%">الإمكانات</th>
</tr>
</thead>
<tbody>
<tr><td valign="top">ترجمة الفيديو</td><td valign="top">✅ متاح</td><td>استورد مقاطع فيديو محلية أو عامة؛ وحوّل الكلام إلى نص باستخدام خدمات Whisper السحابية أو المحلية؛ واستخدم سياق LLM لتقسيم الترجمات ومحاذاتها ومعالجة المصطلحات والترجمة؛ واضبط الترجمات ثنائية اللغة أو الدبلجة أو عينة صوت مخصصة وأنماط الترجمة والتنسيق الأفقي أو العمودي، ثم صدّر SRT أو الصوت أو الفيديو</td></tr>
<tr><td valign="top">تنزيل الفيديو</td><td valign="top">✅ متاح</td><td>حلّل مقاطع الفيديو العامة الفردية من YouTube وBilibili وX وTikTok وInstagram وDouyin وFacebook وXiaohongshu وPinterest وReddit، وقارن التنسيقات المتاحة ونزّل الفيديو أو الصوت. قد تتطلب بعض المنصات ملفات تعريف الارتباط. عندما توفر المنصة ترجمات، اعرض القائمة ونزّل SRT؛ تظهر الإنجليزية أولًا ثم لغة الواجهة عند توفرها.</td></tr>
<tr><td valign="top">إنشاء الصور المصغرة</td><td valign="top">✅ متاح</td><td>ادمج موضوعًا ورابط فيديو وصورة مرجعية اختيارية لإنشاء عدة خيارات من الصور المصغرة للمحتوى ومقارنتها</td></tr>
<tr><td valign="top">توليد الصور</td><td valign="top">✅ متاح</td><td>أنشئ صورًا باستخدام GPT Image / Seedream / Kling Image / Gemini انطلاقًا من prompt وصورة مرجعية اختيارية، واضبط نسبة العرض إلى الارتفاع وعدد النتائج، ثم عاين كل صورة ونزّلها</td></tr>
<tr><td valign="top">كتابة المقالات</td><td valign="top">✅ متاح</td><td>حوّل موضوعًا أو روابط أو فيديوهات أو مستندات إلى أفكار ومخطط ومقال قابل للتحرير؛ أضف صورًا وصدّر بصيغ Markdown أو HTML أو PDF.</td></tr>
<tr><td valign="top">منشورات Xiaohongshu</td><td valign="top">✅ متاح</td><td>أنشئ منشورًا من موضوع أو مصدر مع ضبط الجمهور ونوع المنشور وطوله، ثم انسخ النتيجة أو نزّلها.</td></tr>
<tr><td valign="top">نص فيديو قصير</td><td valign="top">✅ متاح</td><td>أنشئ نصًا مقسمًا جاهزًا للتصوير من موضوع أو مادة مصدر، مناسبًا للجمهور والمنصة والمدة والنبرة؛ عدّله أو صدّره.</td></tr>
<tr><td valign="top">رسوم شخصيات العصا المتحركة</td><td valign="top">✅ متاح</td><td>حوّل النص أو محتوى YouTube إلى سرد وصوت ولوحات قصصية بشخصيات متسقة وترجمات ورسوم متحركة قابلة للتنزيل.</td></tr>
<tr><td valign="top">المقاطع التلقائية</td><td valign="top">قيد التطوير</td><td>حلّل مقاطع الفيديو الطويلة وحدد أبرز اللحظات وحوّل المقاطع المختارة إلى مقاطع قصيرة قابلة لإعادة الاستخدام</td></tr>
<tr><td valign="top">Text to Speech</td><td valign="top">✅ متاح</td><td>حوّل النصوص إلى تعليق صوتي مع اختيار الصوت وضبط الإيقاع والعاطفة</td></tr>
<tr><td valign="top">توليد الفيديو</td><td valign="top">✅ متاح</td><td>أنشئ فيديو باستخدام Seedance / Kling / Veo من الأوامر النصية والصور المرجعية، ثم عاين كل إصدار وأعد إنشاءه ونزّله</td></tr>
<tr><td valign="top">الصورة الرمزية الرقمية</td><td valign="top">قيد التطوير</td><td>ادمج النص والصوت وعرض الصورة الرمزية لإنتاج فيديوهات ناطقة</td></tr>
</tbody>
</table>

## قوالب الإنشاء

ابدأ الإنشاء مباشرةً من قالب بدلًا من كتابة كل وصف وضبط كل إعداد من البداية. تصفّح القوالب المميزة حسب الفئة، بما في ذلك إنشاء الفيديو وتصميم الصور.

تجمع المكتبة بين القوالب الأصلية من OpenCreator وقوالب المبدعين المستقلين. وتذكر صفحة تفاصيل قوالب الجهات الخارجية اسم المؤلف ورابط المصدر الأصلي.

افتح القالب لمعاينة مثال للنتيجة والاطلاع على الوصف والإعدادات والوسوم والمؤلف والمصدر الأصلي. اختر **استخدم هذا القالب** لبدء الإنشاء منه، ثم عدّل المدخلات بما يناسب عملك.

![تفاصيل قالب إنشاء الصور مع مثال للنتيجة والإعدادات والوصف](../images/product/creation-templates-detail-apex-summit-en.png)

## Skills

توفر أدوات الإنشاء عناصر تحكم مرئية، بينما تمنح Skills تعليمات وسير عمل قابلين لإعادة الاستخدام لـAgent. يتضمن مستودع OpenCreator Skills لإنتاج الفيديو، إلى جانب دعم إدارة Skills المحلية في Codex.

يحتوي دليل [`skills/`](../../skills/) في المستودع على تعليمات قابلة لإعادة الاستخدام لـAgents التي تشغّل KrillinAI CLI المضمّن.

| Skill | القدرات |
| --- | --- |
| [KrillinAI CLI](../../skills/krillinai-cli/SKILL.md) | اختيار الأوامر والتحقق من الإعدادات وتفسير التقدم وملفات بيان النتائج والمخرجات والأخطاء |
| [الترجمة النصية](../../skills/krillinai-subtitle/SKILL.md) | تنزيل ترجمات المنصات أو تفريغ الوسائط وترجمة النصوص وإنتاج ترجمات ثنائية اللغة أو قصيرة للفيديو العمودي |
| [TTS](../../skills/krillinai-tts/SKILL.md) | إنشاء دبلجة باللغة المستهدفة من الترجمة النصية، مع إمكانية إنتاج فيديو مدبلج |
| [إخراج أفقي](../../skills/krillinai-render-horizontal/SKILL.md) | إخراج فيديو أفقي بترجمة ثنائية اللغة أو بصوت مدبلج وترجمة باللغة المستهدفة |
| [إخراج عمودي](../../skills/krillinai-render-vertical/SKILL.md) | تركيب فيديو عمودي يتضمن عناوين أو ترجمة ثنائية اللغة أو دبلجة |
| [الغلاف](../../skills/krillinai-cover/SKILL.md) | إنشاء صورة غلاف من وصف نصي كامل وحفظ الصورة والوصف النهائي |
| [تخطيط المراحل](../../skills/krillinai-pipeline/SKILL.md) | التحقق من خطة مخرجات متعددة المراحل في وضع dry-run؛ تنفيذ العمل الفعلي باستخدام Skills الخاصة بكل مرحلة |

### التوسّع باستخدام Skills الخاصة بك

يدعم OpenCreator Skills المحلية في Codex المعرّفة بواسطة `SKILL.md`، مما يتيح إضافة أساليب وسير عمل خاصة بك بدلًا من الاقتصار على أدوات إنشاء ثابتة. يعتمد توفر Skills على دليل Codex home النشط وSkills المثبّتة؛ وتتطلب Skills لسير عمل الفيديو إعداد CLI والخدمات ذات الصلة. وجود Skill في المستودع لا يعني تثبيتها تلقائيًا أو تضمين كل خدمة خارجية.

## المحادثة ومساحة العمل تتقدمان معًا

صِف المهام بلغة طبيعية، ثم انتقل إلى الأدوات المرئية عندما تحتاج إلى تحكم دقيق.

المزوّدون والنماذج المعروضة أمثلة؛ ويتوقف التوفر الفعلي على بيانات الاعتماد وصلاحيات الحساب والمنصة.

### عناصر تحكم دقيقة في مساحة العمل

اضبط الترجمات واللقطات والصوت وإعدادات التوليد بدقة.

### تعديلات مرنة عبر المحادثة

أخبر Agent بما تريد تغييره وحسّن النتيجة باستخدام اللغة الطبيعية.

### حالة متزامنة

تتشارك المحادثة ومساحة العمل حالة المهمة الحالية، فلا حاجة إلى تكرار المعلومات.

### إصدارات مستقلة

ينشئ كل تعديل إصدارًا منفصلًا دون الكتابة فوق النتائج أو الإعدادات السابقة.

## النماذج المدعومة

يعتمد توفر النماذج اللغوية على كتالوج نماذج Codex أو مزود متوافق مع OpenAI قمت بإعداده. تستخدم نماذج الصور والفيديو والصوت والنسخ الخدمات المُعدّة في **الإعدادات ← خدمات الذكاء الاصطناعي**.

تعرض الجداول إعدادات المزوّدين المدمجة والنماذج الموصى بها؛ ويتوقف التوفر الفعلي على بيانات الاعتماد وصلاحيات الحساب والمنصة.

### النماذج اللغوية

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

### الصور

<table>
<tr>
<td align="center" width="25%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>GPT Image</strong></td>
<td align="center" width="25%"><img src="../images/models/jimeng.png" alt="Jimeng" width="40" height="40" /><br /><strong>Seedream 4.0</strong><br />Jimeng</td>
<td align="center" width="25%"><img src="../images/models/kling.png" alt="Kling" width="40" height="40" /><br /><strong>Kling v2.1</strong><br />Kling Image</td>
<td align="center" width="25%"><img src="../images/models/gemini.png" alt="Gemini" width="40" height="40" /><br /><strong>Nano Banana</strong><br />Gemini 2.5 Flash Image</td>
</tr>
</table>

### الفيديو

<table>
<tr>
<td align="center" width="33%"><img src="../images/models/seedance.png" alt="Seedance" width="40" height="40" /><br /><strong>Seedance 2.5</strong></td>
<td align="center" width="33%"><img src="../images/models/kling.png" alt="Kling" width="40" height="40" /><br /><strong>Kling v2.1 Master</strong></td>
<td align="center" width="33%"><img src="../images/models/gemini.png" alt="Gemini" width="40" height="40" /><br /><strong>Veo 3.1</strong></td>
</tr>
</table>

### الصوت والنسخ

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

تدعم الكتابة الصوتية المحلية أيضًا faster-whisper وWhisperKit وwhisper.cpp على المنصات المتوافقة.

## أمثلة

### ترجمة الفيديو

أُنتجت الأمثلة العامة أدناه عندما كان OpenCreator لا يزال يحمل اسم KrillinAI. وهي توضح مسار العمل الراسخ لمحاذاة الترجمات والترجمة والدبلجة والفيديو العمودي الذي تضيفه مساحة عمل ترجمة الفيديو في OpenCreator إلى مسار Agent أوسع.

أنشأ المشروع ملف الترجمة أدناه من فيديو محلي مدته 46 دقيقة في عملية تشغيل واحدة، دون أي تعديلات يدوية على الترجمة. تغطي النتيجة المنشورة الفيديو كاملًا دون تداخل الأسطر، مع تقسيم طبيعي وترجمة عالية الجودة.

![مثال على محاذاة الترجمات في OpenCreator](../images/examples/krillinai-subtitle-alignment.png)

<table width="100%">
<tr>
<td width="33%">

#### ترجمة النصوص

https://github.com/user-attachments/assets/bba1ac0a-fe6b-4947-b58d-ba99306d0339

</td>
<td width="33%">

#### الدبلجة

https://github.com/user-attachments/assets/0b32fad3-c3ad-4b6a-abf0-0865f0dd2385

</td>
<td width="33%">

#### الوضع العمودي

https://github.com/user-attachments/assets/c2c7b528-0ef8-4ba9-b8ac-f9f92f6d4e71

</td>
</tr>
</table>

> أُنتجت أمثلة الفيديو هذه وصورة محاذاة الترجمات عندما كان OpenCreator لا يزال يستخدم اسم KrillinAI.

### تنزيل الفيديو

حلّل روابط الفيديو العامة من 10 منصات مدعومة، وقارن التنسيقات المتاحة، ثم نزّل الفيديو أو الصوت مباشرةً إلى المشروع.

مصادر الفيديو المدعومة:

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

يعتمد توفر التنزيل على الفيديو والمنطقة؛ وقد تتطلب بعض المصادر ملفات تعريف الارتباط الخاصة بالمنصة. لا يستورد OpenCreator ملفات تعريف الارتباط من المتصفح تلقائيًا.

![اختيار تنسيق تنزيل الفيديو في OpenCreator](../images/examples/video-downloader-formats-and-subtitles-en.png)

### إنشاء الفيديو

أنشئ فيديو بالذكاء الاصطناعي من مطالبة نصية أو صورة مرجعية باستخدام Seedance. اضبط النموذج ونسبة العرض إلى الارتفاع والدقة والمدة، ثم عاين كل إصدار أو أعد إنشاءه أو نزّله من مساحة عمل المشروع.

![إنشاء فيديو في OpenCreator باستخدام Seedance](../images/examples/video-generation-seedance-en.png)

### رسوم شخصيات العصا المتحركة

طوّر OpenCreator هذه المجموعة الأصلية من الشخصيات بالتعاون مع الفنان [Harbor Hsia](https://www.behance.net/xiaheyuan1)، مبتكر [Stickman على Behance](https://www.behance.net/gallery/254715463/Stickman). تحافظ الشخصيات المدمجة على هويتها طوال إنتاج الرسوم المتحركة.

![شخصيات العصا في OpenCreator التي طُورت بالتعاون مع فنانين](../images/examples/stick-figure-characters.webp)

حوّل النص أو محتوى YouTube إلى رسوم متحركة عبر مراجعة النص والسرد وضبط التوقيت واللوحات القصصية والترجمات والتصيير وتنزيل الفيديو.

![إطار نموذجي لرسوم شخصيات العصا المتحركة في OpenCreator](../images/examples/stick-figure-animation-frame.jpg)

## البدء السريع

### تثبيت تطبيق Desktop

نزّل المثبّت لنظام macOS Apple Silicon أو macOS Intel أو Windows x64 من [أحدث إصدار](https://github.com/krillinai/OpenCreator/releases/latest). لا يحتاج Desktop إلى Node.js أو pnpm، ويتضمن Codex CLI. تتطلب مهام النماذج الفعلية تسجيل دخول صالحًا إلى ChatGPT أو إعداد مفتاح API قابل للاستخدام.

عند التشغيل لأول مرة، يبدأ Desktop تشغيل Runtime المحلي، ويُجهز مشروعًا افتراضيًا، ويفحص إعدادات Codex المحلية. إذا عثر على تسجيل دخول أو مفتاح API وإعدادات نموذج قابلة للاستخدام، فاختر **استخدام Codex المحلي والمتابعة** لإعادة استخدامها. ويمكنك أيضًا إعداد مزوّد نماذج آخر ضمن خطوات البدء نفسها.

![إعداد مزوّد النماذج عند تشغيل OpenCreator Desktop لأول مرة](../images/product/opencreator-codex-setup.png)

بعد الإعداد، أدخل طلبك لبدء مهمة. عند مواجهة مشكلة، راجع [دليل المستخدم](../opencreator-user-guide-and-troubleshooting.md).

### تشغيل Web من الشفرة المصدرية

للتطوير أو استخدام Web من الشفرة المصدرية، جهّز ما يلي:

- Node.js 22 أو أحدث
- pnpm 9.15.0، المثبّت عبر حقل `packageManager` في المستودع
- ملف Codex CLI تنفيذي متاح في الطرفية
- تسجيل دخول صالح إلى Codex CLI لتنفيذ مهام حقيقية باستخدام النماذج

تحقق أولًا من بيئتك المحلية:

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

افتح `http://127.0.0.1:19861/`. يشغّل خادم التطوير daemon المحلي عند الطلب، ويحقن رمز Runtime مؤقتًا عبر وكيل من المصدر نفسه، لذلك لا حاجة إلى نسخ رمز الاتصال يدويًا.

عند التشغيل الأول، يُجهّز Runtime مشروعًا افتراضيًا. يصبح مربع الإدخال جاهزًا بمجرد اكتمال الاتصال. للعمل على daemon فقط:

```bash
pnpm daemon:dev
```

لا يستمع daemon إلا على عنوان loopback، ويطبع عنوان الاتصال والرمز المؤقت إلى stdout مرة واحدة.

## Desktop

يستخدم Desktop والمتصفح واجهة React الأمامية نفسها من `apps/web`. تستدعي العمليات العامة للمشاريع والمحادثات والمهام والإعدادات Daemon/API نفسها. ولا يضيف Electron سوى مسارات النظام الحقيقية وعناصر التحكم في النوافذ وسلوك علبة النظام والإشعارات الأصلية.

### وضع التطوير

```bash
pnpm desktop:dev
```

### الحزم المحلية

| الأمر | الناتج |
| --- | --- |
| `pnpm desktop:package` | مجلد قابل للتشغيل للمنصة الحالية، مخصص للتحقق المحلي |
| `pnpm desktop:dist` | برنامج تثبيت للمنصة الحالية |
| `pnpm desktop:release` | نقطة الدخول لحزم الإصدار الرسمي |
| `pnpm --filter @opencreator/desktop verify:package` | التحقق من حزمة Desktop موجودة |

تعيد عملية حزم Desktop بناء Web من مساحة العمل الحالية، وتسجل commit وحالة dirty والمنصة والبنية وhash الخاص بـ Web، ثم تقارن `apps/web/dist` بالموارد المضمنة في التطبيق. تفشل عملية الحزم إذا اختلفت. راجع [دليل تشغيل إصدارات Desktop](../operations/opencreator-desktop-release-runbook.md) لمعرفة متطلبات التوقيع والتوثيق وبناء Windows والإصدار.

## مسارات العمل الأساسية

### المحادثات وRuns

1. اختر مشروعًا أو ابدأ محادثة جديدة.
2. أدخل مهمة واختر مستوى الصلاحية وProfile والنموذج ومستوى الاستدلال.
3. أثناء نشاط Run، أضف مهام المتابعة إلى قائمة الانتظار أو أوقفه وتابع فورًا.
4. استخدم Timeline لاستعراض ملخصات الاستدلال واستدعاءات الأدوات وتغييرات الملفات والموافقات والنتائج النهائية.
5. استخدم مركز المهام لتتبع المهام قيد التشغيل والمكتملة والفاشلة والمحجوبة بانتظار الموافقة على مستوى النظام.

### Skills وMCP

- تصفح سوق Skills وسجل التثبيت وSkills المتاحة محليًا في مركز الإضافات.
- اختر Skill من مربع الإدخال باستخدام `/` أو قائمة الإضافة لتتبع المهمة التالية مسار عملها.
- تمر إدارة MCP عبر أوامر Codex وإعداداته الأصلية بدلًا من صيانة محرك تنفيذ ثانٍ.
- يستخدم OpenCreator قيمة `$CODEX_HOME` النشطة افتراضيًا، لذا تحقق من التأثير قبل تغيير Skills العامة أو إعدادات MCP.

### الجداول الزمنية وسلاسل المهام المخصصة

- يمتلك كل جدول زمني محادثة OpenCreator دائمة ومخصصة.
- تعيد المشغلات التلقائية وعمليات التشغيل اليدوية ومتابعات المستخدم استخدام تلك المحادثة وتعمل بالتتابع وفق سياسة `queue` أو `skip`.
- تؤدي إزالة جدول زمني إلى أرشفة محادثته المخصصة مع الاحتفاظ بـ Runs والنتائج وسجل Codex الأساسي.
- لا يؤدي تدوير سلسلة Codex الأساسية أو استردادها إلى تغيير إدخال مهمة OpenCreator أو مسار الصفحة.

## بنية نظام OpenCreator

يتعامل OpenCreator مع مساحة العمل المرئية ومحادثة Agent باعتبارهما واجهتين للمهمة الإبداعية نفسها، لا مساري عمل منفصلين. يُنمذج كل مسار إنشاء كآلة حالات: تصبح مدخلات المصدر والإعداد والتوليد والمراجعة والتعديل والتصدير حالات وأحداثًا صريحة. تدخل إجراءات مساحة العمل وأوامر المحادثة إلى آلة الحالات نفسها، بينما تُعرض الخطوة الحالية والإعداد والتقدم والإصدارات والنتائج في كلتا الواجهتين. يحافظ ذلك على مزامنة مساحة العمل والمحادثة دون تقديم مصدر بيانات ثانٍ.

العمل الإبداعي تكراري، لذلك لا تستبدل التعديلات النتيجة الحالية. ينشئ كل تصحيح أو إعادة توليد إصدارًا جديدًا من حالة مسار العمل الحالية، مع الاحتفاظ بإعدادات الإصدارات السابقة ومخرجاتها للمراجعة والمقارنة ومواصلة التحسين.

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

| مكوّن OpenCreator | المسؤولية | التنفيذ |
| --- | --- | --- |
| تجربة الإنشاء | Dashboard وأدوات الإنشاء ومحادثة Agent والإعدادات والملفات | `apps/web` · React 18 · Vite · TypeScript |
| نواة التعاون | تزامن خطوات مساحة العمل وسياق المحادثة والتقدم والنتائج والمراجعات | حالة مسار عمل مشتركة · `CreatorCollaborationPanel` · سجل الإصدارات |
| Runtime المحلي | يدير المشاريع وRuns والموافقات والجداول والذاكرة والإشعارات | `apps/daemon` · Fastify · Runtime API · SSE |
| مكونات Runtime | تتبع الإصدارات المضمّنة والنشطة والأحدث، وتتحقق دوريًا ولا تثبت إلا التحديثات التي يطلبها المستخدم | yt-dlp nightly · التحقق من التحديث · الرجوع إلى الإصدار العامل |
| محرك Codex | يوفر حلقة Agent والجلسات والاستدلال والأدوات وSkills وMCP | Codex CLI · app-server |
| سلسلة أدوات الوسائط | تنزّل الوسائط الإبداعية وتنسخها وتحولها وتولدها وتصدرها | yt-dlp · Whisper · FFmpeg · خدمات الذكاء الاصطناعي المُعدّة |
| البيانات المحلية | تخزن بيانات المشاريع وRuns والمرفقات والمخرجات وبيانات الاعتماد محليًا | SQLite · نظام الملفات · مخزن بيانات اعتماد النظام |
| مضيف Desktop | يحمّل بناء Web المشترك ويضيف إمكانات نظام التشغيل | `apps/desktop` · Electron · Preload Bridge |

المبادئ الأساسية:

- مساحة العمل ومحادثة Agent عرضان متزامنان لحالة مسار العمل نفسها؛ يرسل كلاهما الأحداث إلى آلة الحالات نفسها بدلًا من الاحتفاظ بحالات مهام متوازية.
- تنشئ التعديلات إصدارات جديدة بدلًا من استبدال النتائج الحالية، ما يحافظ على سياق كل دورة إبداعية ومخرجاتها.
- لا تشغّل الواجهة الأمامية Codex مباشرة ولا تعتمد على تنسيق أحداث JSONL الخام في Codex.
- يدير daemon دورة حياة العمليات وتوحيد الأحداث والتخزين الدائم والموافقات والجداول الزمنية وصندوق إرسال الإشعارات.
- يظل Codex مصدر التنفيذ الأساسي لحلقة Agent وSkills وMCP.
- لا ينفذ Browser Bridge وDesktop Bridge نسختين منفصلتين من منطق المنتج العام.

## بنية المستودع

```text
OpenCreator/
├── apps/
│   ├── web/          # التطبيق الوحيد لواجهة React الأمامية
│   ├── daemon/       # Runtime محلي باستخدام Fastify ومهايئ Codex
│   ├── desktop/      # Electron Main وPreload والإمكانات الأصلية والحزم
│   └── harness/      # أداة سطر أوامر للتحقق من Runtime
├── packages/
│   ├── protocol/     # عقود Runtime المشتركة بين Web وDaemon وDesktop
│   └── skill-market/ # نماذج سوق Skills والمنطق المشترك
├── docs/             # مستندات التصميم ومراجع API وأدلة التشغيل وتقارير الاختبار
├── scripts/          # عمليات التحقق على مستوى المستودع
└── .runtime/         # بيانات Runtime المحلية التي تُنشأ عند التشغيل الأول
```

## الإعداد

### مفاتيح API لخدمات الذكاء الاصطناعي

افتح **الإعدادات ← خدمات الذكاء الاصطناعي** لإعداد موفري النماذج والنسخ الصوتي والصوت والصور الذين تستخدمهم مساحات العمل الحالية. قد تظهر فئات خدمات إضافية استعدادًا لأدوات الإنشاء القادمة. لا تعرض كل فئة إلا الحقول المطلوبة للموفر المحدد، بما في ذلك Base URL وAPI Key والنموذج والوكيل وبيانات الاعتماد الخاصة بالموفر.

![إعداد مفاتيح API لخدمات الذكاء الاصطناعي في OpenCreator](../images/product/opencreator-ai-services-en.png)

تُحفظ بيانات الاعتماد عبر مخزن بيانات اعتماد النظام في Runtime المحلي، ويجب عدم إضافتها إلى المستودع مطلقًا. لا يحتاج بعض الموفرين المحليين أو المدعومين من النظام، مثل Edge TTS، إلى API Key.

### مكونات Runtime التابعة لجهات خارجية

افتح **الإعدادات ← مكونات الجهات الخارجية** لعرض إصدار yt-dlp nightly المستخدم حاليًا، والإصدار المضمّن مع OpenCreator، ومصدره، وأحدث إصدار متاح. يتحقق OpenCreator من التحديثات كل سبعة أيام، لكنه لا يثبتها تلقائيًا. تتطلب التحديثات إجراءً صريحًا من المستخدم، ويظل الإصدار الحالي العامل متاحًا إذا فشل التنزيل أو التحقق أو التثبيت.

![إعدادات مكونات الجهات الخارجية في OpenCreator](../images/product/opencreator-third-party-components-en.png)
### متغيرات بيئة Runtime

لا يحتاج معظم المستخدمين إلى متغيرات البيئة. استخدمها عندما تحتاج إلى بيانات معزولة أو ملف Codex تنفيذي محدد أو مجلد مخصص للمشاريع المُدارة:

| متغير البيئة | القيمة الافتراضية | الغرض |
| --- | --- | --- |
| `OPENCREATOR_DATA_DIR` | `.runtime` | قاعدة بيانات OpenCreator وRuns والمرفقات ومساحات العمل المُدارة |
| `OPENCREATOR_CODEX_BIN` | `codex` | مسار ملف Codex CLI التنفيذي |
| `CODEX_HOME` | `~/.codex` | المصدر الأساسي لجلسات Codex وإعداداته وSkills وMCP وProfiles |
| `OPENCREATOR_DEFAULT_CWD` | مجلد العمل الحالي | مجلد العمل الافتراضي لـ daemon |
| `OPENCREATOR_DEFAULT_PROJECT_ROOT` | سياسة Runtime الافتراضية | جذر المشاريع المُدارة؛ عند تعيينه يستخدم OpenCreator المجلد الفرعي `OpenCreator/` داخله |
| `OPENCREATOR_CODEX_THREAD_ROTATION_RUN_THRESHOLD` | `50` | حد Runs النهائية لتدوير سلسلة Codex وراء جدول زمني طويل الأمد؛ استخدم `0` لتعطيل التدوير الاستباقي |

على سبيل المثال، لعزل بيانات Runtime وبيئة Codex معًا:

```bash
OPENCREATOR_DATA_DIR=/path/to/opencreator-data \
CODEX_HOME=/path/to/codex-home \
pnpm web:dev
```

## البيانات والأمان

تُحفظ بيانات Runtime افتراضيًا ضمن `.runtime/` في جذر المستودع:

| المسار | المحتوى |
| --- | --- |
| `.runtime/app.sqlite` | المشاريع والسلاسل وRuns والأحداث والجداول الزمنية والإشعارات والبيانات الوصفية للمرفقات والموافقات والذاكرة والملخصات |
| `.runtime/runs/` | السجلات المنقحة والتشخيصات والبيانات الوصفية لكل Run |
| `.runtime/attachments/` | ملفات المرفقات الخاضعة للتحكم |
| `.runtime/workspaces/` | مساحات عمل المشاريع التي يديرها Runtime |

تبقى جلسات Codex وإعداداته في `$CODEX_HOME` ويجب نسخها احتياطيًا بشكل منفصل عن `.runtime/`.

تشمل حدود الأمان ما يلي:

- لا يستمع daemon إلا على `127.0.0.1`؛ وتتطلب كل واجهات API، باستثناء فحص الصحة، رمز Bearer.
- تعطل معاينة HTML البرامج النصية والتنقل والنوافذ المنبثقة افتراضيًا، ولا تسمح إلا بالموارد النسبية الخاضعة للتحكم من مساحة العمل نفسها.
- تتطلب الذاكرة الحساسة تأكيدًا ثانيًا. لا يخزن OpenCreator الاقتراحات غير المؤكدة تلقائيًا وبشكل دائم أبدًا.
- تُنقح التشخيصات وسجلات Runs قبل إعادتها أو تصديرها.
- تفعّل حزم Desktop تكامل ASAR وتشفير ملفات تعريف الارتباط، مع تعطيل RunAsNode و`NODE_OPTIONS` وNode CLI Inspector.

راجع [دليل المستخدم واستكشاف الأخطاء وإصلاحها](../opencreator-user-guide-and-troubleshooting.md) للاطلاع على إجراءات النسخ الاحتياطي والاستعادة والتنظيف وإعادة الضبط كاملة.

## التطوير

### الأوامر الشائعة

| الأمر | الغرض |
| --- | --- |
| `pnpm web:dev` | تشغيل Web وبدء daemon المحلي عند الطلب |
| `pnpm daemon:dev` | تشغيل daemon فقط |
| `pnpm desktop:dev` | بناء التبعيات وتشغيل Electron في وضع التطوير |
| `pnpm test` | تشغيل اختبارات الوحدة والتكامل لمساحات العمل |
| `pnpm typecheck` | تشغيل فحوصات TypeScript في المستودع بأكمله |
| `pnpm build` | بناء جميع workspaces |
| `pnpm e2e` | تشغيل اختبارات Playwright الشاملة لـ Web |
| `pnpm smoke:ci` | تشغيل اختبار smoke لـ Runtime باستخدام Codex محاكى |
| `pnpm perf:check` | فحص خط الأداء الأساسي المسجل |

قبل إرسال أي تغيير، اختر التحقق المناسب لأثره وفق [دليل المساهمة](../../CONTRIBUTING.md#what-reviewers-check). تغييرات التوثيق والنصوص والتنسيق تحتاج فحوصًا ذات صلة فقط؛ والسلوك المشترك أو Runtime يحتاج اختبارات موجهة وفحص الأنواع. شغّل الاختبارات أو البناء الكامل عند الحاجة فقط واذكر في طلب الدمج ما تحققته فعليًا.

تتطلب التغييرات في Desktop أو Host Bridge أو وكيل Runtime أو مسارات العمل المشتركة للواجهة الأمامية أيضًا اختبارات اتساق Web/Desktop واختبارات شاملة للتطبيق المحزّم والتحقق من hash بناء Web. لا يكفي اجتياز اختبارات الوحدة في Web وحدها لإثبات جاهزية إصدار Desktop.

يكون اختبار smoke باستخدام Codex الحقيقي معطلًا افتراضيًا. فعّله صراحةً باستخدام:

```bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

## الوثائق

- **استخدام OpenCreator:** [البدء السريع](#البدء-السريع) · [دليل المستخدم واستكشاف الأخطاء وإصلاحها](../opencreator-user-guide-and-troubleshooting.md)
- **التطوير والتوسعة:** [دليل المساهمة](../../CONTRIBUTING.md) · [المساهمة بمهارة Skill](../contributing/skills-contributing.md) · [المساهمة بقالب إنشاء](../contributing/templates-contributing.md) · [Runtime API v1](../runtime-api-for-ui-v1.md) · [إرشادات المكونات المرئية](../visual-component-guidelines.md)
- **الصيانة والإصدار:** [تصميم Runtime الأصلي لـ Codex](../2026-07-03-codex-native-agent-runtime-design.md) · [دليل تشغيل إصدارات Desktop](../operations/opencreator-desktop-release-runbook.md) · [دليل إصدار Desktop لنظام Windows](../operations/opencreator-desktop-windows-release.md)

## قواعد الترجمة

يمثل ملف `README.md` في الجذر المستند الإنجليزي الأساسي. توجد الترجمات المُصانة في `docs/<locale>/README.md`. لا تضف لغة إلى أداة التبديل إلا بعد ترجمة مستندها كاملًا ومزامنته مع بنية النسخة الإنجليزية.

## المجتمع

<p>منح مستخدمو GitHub من <strong>107 دولة ومنطقة على الأقل</strong> مشروع OpenCreator نجمة.</p>

<img src="../images/star-coverage-map.svg" alt="خريطة عالمية تُبرز بلدان ومناطق مستخدمي GitHub الذين منحوا OpenCreator نجمة" width="760" />

### الفريق

يتولى كل عضو معايير مجاله ومراجعة المساهمات ودمجها ودعم المجتمع.

<table border="1" cellpadding="12">
  <tr>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/wulien.svg" width="64" height="64" alt="wulien avatar" /><br /><a href="https://github.com/wulien">wulien</a><br />الشفرة وإصلاح الأخطاء</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/dle-kb.svg" width="64" height="64" alt="DLe-kb avatar" /><br /><a href="https://github.com/DLe-kb">DLe-kb</a><br />قوالب الإنشاء</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/xiaheyuan.svg" width="64" height="64" alt="xiaheyuan avatar" /><br /><a href="https://github.com/xiaheyuan">xiaheyuan</a><br />التصميم والأصول</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/krillinai.svg" width="64" height="64" alt="krillinai avatar" /><br /><a href="https://github.com/krillinai">krillinai</a><br />Skills والوثائق</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/hbxugang.svg" width="64" height="64" alt="hbxugang avatar" /><br /><a href="https://github.com/hbxugang">hbxugang</a><br />النشر المؤسسي</td>
  </tr>
</table>

### المساهمون

شكرًا لكل من شارك عبر الشفرة والوثائق والملاحظات وتقارير المشكلات وSkills والتصميمات والأفكار.

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

### المساهمة

يمكنك المساهمة في OpenCreator بطرق عديدة، وليس عبر الشفرة فقط:

| النوع | ماذا تقدم | كيف تجهزها | أين تقدمها |
| --- | --- | --- | --- |
| الشفرة | إصلاحات وأدوات إنشاء وميزات مشتركة | تغيير محدد مع عرض أو خطوات إعادة الإنتاج واختبارات | [Issue][contribute-issue] ثم [PR][contribute-pr]؛ `apps/web/` أو `apps/daemon/` |
| Skills | سير عمل Agent قابلة لإعادة الاستخدام | `SKILL.md` مع المتطلبات والأمثلة | [Issue][contribute-issue] ثم [PR][contribute-pr] في `skills/` |
| قوالب الإنشاء | قوالب قابلة لإعادة الاستخدام للصور والفيديو والأغلفة | `template.json` وملفات الغلاف والمعاينة والوصف والإعدادات ونسب العمل وحقوق الاستخدام | قدّم [PR][contribute-pr] في [`template/`](../../template/)؛ ناقش الصيغ الجديدة في [Issue][contribute-issue] |
| الرسوم والتصميم | رسوم وأيقونات وواجهات أصلية | معاينة وملفات مصدر قابلة للتعديل وترخيص | [Issue][contribute-issue] ثم [PR][contribute-pr] في موقع الأصول المتفق عليه |
| تكامل خدمات الجهات الخارجية | دعم خدمات الذكاء الاصطناعي أو الوسائط | حالة استخدام وإعدادات ومعالجة الأخطاء وحماية بيانات الاعتماد واختبارات | [Issue][contribute-issue] ثم [PR][contribute-pr] في وحدات Web / Daemon |

ضع كل قالب مع ملفاته في `template/<module>/<id>/<version>/template.json`. الوحدات الحالية هي `image-generation` و`video-generation` و`cover-generator`. قدّم العنوان والوصف بالصينية والإنجليزية، وشغّل `pnpm templates:validate` قبل إرسال PR.

كيفية المساهمة:

1. صِف المشكلة وحالة الاستخدام والسلوك المتوقع في [Issues](https://github.com/krillinai/OpenCreator/issues).
2. أنشئ فرعًا محددًا للميزة أو الإصلاح انطلاقًا من أحدث فرع تطوير.
3. اتبع البنية الحالية: نفّذ إمكانات المنتج العامة مرة واحدة في Web وDaemon، واعزل الاختلافات الأصلية خلف capabilities صريحة.
4. أضف تغطية مناسبة باختبارات الوحدة أو التكامل أو الاختبارات الشاملة لتغييرات السلوك، واذكر في Pull Request عمليات التحقق المكتملة والمتجاوزة.
5. لا تضف مطلقًا `.runtime/` أو بيانات الاعتماد المحلية أو جلسات Codex أو ذاكرات البناء المؤقتة أو بيانات المستخدم الأخرى إلى commit.

[contribute-issue]: https://github.com/krillinai/OpenCreator/issues
[contribute-pr]: https://github.com/krillinai/OpenCreator/pulls

## سجل Stars

كان OpenCreator يُعرف سابقًا باسم KrillinAI. يغطي هذا المخطط سجل المستودع كاملًا قبل تغيير الاسم وبعده.

[![سجل Stars في OpenCreator](https://api.star-history.com/svg?repos=krillinai/OpenCreator&type=date)](https://www.star-history.com/?type=date&repos=krillinai%2FOpenCreator)

## المشاريع ذات الصلة

| المشروع | الدور |
| --- | --- |
| [OpenAI Codex](https://github.com/openai/codex) | محرك تنفيذ Agent الذي يوفر الوصول إلى النماذج والاستدلال واستدعاءات الأدوات والجلسات وSkills وتكامل MCP. |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | يفحص روابط الوسائط العامة المدعومة ويسرد التنسيقات المتاحة وينزّل الفيديو أو الصوت لمسارات الإنشاء. |
| [FFmpeg](https://ffmpeg.org/) | يتولى FFmpeg وffprobe تحويل الوسائط وتركيبها واستخراج الإطارات والتحقق من المخرجات. |
| [Whisper](https://github.com/openai/whisper) و[whisper.cpp](https://github.com/ggml-org/whisper.cpp) و[faster-whisper](https://github.com/SYSTRAN/faster-whisper) و[WhisperKit](https://github.com/argmaxinc/WhisperKit) | خيارات نسخ صوتي سحابية ومحلية خاصة بالمنصة، تُختار وفق إمكانات Runtime المتاحة. |
| [React](https://react.dev/) | أساس واجهة المستخدم المشتركة لتجربتي Web وDesktop. |
| [Fastify](https://fastify.dev/) | أساس HTTP وAPI لـ Runtime المحلي. |
| [Electron](https://www.electronjs.org/) | مضيف Desktop لإمكانات النظام الأصلية ودورة حياة التطبيق والحزم. |
| [SQLite](https://www.sqlite.org/) | التخزين المحلي للمشاريع والمحادثات وRuns والجداول والذاكرة وبيانات مساحة العمل الأخرى. |
| [Model Context Protocol](https://modelcontextprotocol.io/) | بروتوكول مفتوح لربط الأدوات والخدمات الخارجية بمساحة عمل Agent. |

---

<div align="center">

**OpenCreator · أنشئ محليًا، واعمل باستمرار.**

</div>
