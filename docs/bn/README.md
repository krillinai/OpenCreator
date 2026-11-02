<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../images/OpenCreator_logo_vector_dark.svg" />
    <img src="../images/OpenCreator_logo_vector.svg" alt="OpenCreator" width="380" />
  </picture>
  <br />
  নির্মাতাদের জন্য ওপেন-সোর্স AI কর্মক্ষেত্র ও Skills
</h1>

<p>স্ক্রিপ্ট, ভিডিও, ছবি, কণ্ঠ, অনুবাদ ও সম্পাদনার জন্য ভিজ্যুয়াল সেটিংস, পুনর্ব্যবহারযোগ্য Skills এবং Agent এক কর্মক্ষেত্রে আনুন।</p>

<p><strong>OpenCreator আগে KrillinAI নামে পরিচিত ছিল।</strong></p>

<a href="https://trendshift.io/repositories/13360" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13360" alt="OpenCreator, আগে KrillinAI: Trendshift-এ দিনের শীর্ষ রিপোজিটরি" width="250" height="55" /></a>

[English](../../README.md) | [简体中文](../zh/README.md) | [日本語](../ja/README.md) | [한국어](../ko/README.md) | [Bahasa Indonesia](../id/README.md) | [Español](../es/README.md) | [Français](../fr/README.md) | [Deutsch](../de/README.md) | [Português](../pt/README.md) | [Русский](../ru/README.md) | [العربية](../ar/README.md) | [ภาษาไทย](../th/README.md) | [Türkçe](../tr/README.md) | [हिन्दी](../hi/README.md) | **বাংলা** | [اردو](../ur/README.md) | [Tiếng Việt](../vi/README.md) | [Filipino](../fil/README.md)

[![GitHub Stars](https://badgen.net/github/stars/krillinai/OpenCreator?icon=github&label=Stars&color=EAB308)](https://github.com/krillinai/OpenCreator/stargazers)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Bilibili](https://img.shields.io/badge/dynamic/json?label=Bilibili&query=%24.data.follower&suffix=%E7%B2%89%E4%B8%9D&url=https%3A%2F%2Fapi.bilibili.com%2Fx%2Frelation%2Fstat%3Fvmid%3D242124650&logo=bilibili&color=00A1D6&labelColor=FE7398&logoColor=FFFFFF)](https://space.bilibili.com/242124650)
[![AtomGit G-Star](https://img.shields.io/badge/AtomGit-G--Star-DA203E?style=flat)](https://atomgit.com/krillinai/OpenCreator)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/fUNvbqDaw)
[![QQ গ্রুপ](https://img.shields.io/badge/QQ%20群-754069680-green?logo=tencent-qq)](https://qm.qq.com/q/W4YC0PLMeA)

[বিশেষত্ব](#project-highlights) · [নির্মাণ টুল](#creator-tools) · [Skills](#skills) · [উদাহরণ](#examples) · [শুরু করুন](#quick-start) · [Desktop](#desktop) · [নথি](#documentation) · [কমিউনিটি](#community)

</div>

![OpenCreator Agent কর্মক্ষেত্র](../images/opencreator-home-en.png)

<a id="project-overview"></a>

## প্রকল্প পরিচিতি

OpenCreator তাঁদের জন্য, যাঁরা ব্যক্তিগতভাবে বা দলগতভাবে সৃজনশীল ও উন্নয়নমূলক কাজ নিজের কম্পিউটারে চালাতে চান। Agent লুপ নতুন করে না বানিয়ে এটি Codex CLI-কে নির্বাহ ইঞ্জিন হিসেবে ব্যবহার করে, সঙ্গে স্থিতিশীল স্থানীয় Runtime, ভিজ্যুয়াল কর্মক্ষেত্র এবং Desktop হোস্ট যোগ করে।

OpenCreator-এ কাজ করার দুটি সংযুক্ত পদ্ধতি আছে:

- **কনটেন্ট কর্মক্ষেত্র**: ভিজ্যুয়াল টুল ও টেমপ্লেট দিয়ে ভিডিও অনুবাদ ও ডাউনলোড, ছবি ও ভিডিও তৈরি, ভয়েসওভার, নিবন্ধ ও সামাজিক পোস্ট, ছোট ভিডিওর স্ক্রিপ্ট এবং স্টিক-ফিগার অ্যানিমেশন তৈরি করুন।
- **Agent কথোপকথন**: স্বাভাবিক ভাষায় সৃজনশীল বা উন্নয়ন কাজ শুরু ও পরিচালনা করুন; প্রকল্প অনুযায়ী আলোচনা সাজান, Run পটভূমিতে চালান এবং অনুমোদন, সংযুক্তি, ফাইল, Skills, MCP, সময়সূচি, বিজ্ঞপ্তি, মেমরি ও ডায়াগনস্টিক এক জায়গায় সামলান।

Web-ই একমাত্র ফ্রন্টএন্ড। Desktop একই Web বিল্ড লোড করে, সঙ্গে ফোল্ডার নির্বাচন, উইন্ডোর জীবনচক্র, সিস্টেম ট্রে ও নেটিভ বিজ্ঞপ্তির মতো OS-নির্ভর সুবিধা যোগ করে। একই ডেটা ও কনটেন্ট ভিউপোর্টে দুই প্ল্যাটফর্মের সাধারণ UI ও Runtime আচরণ এক থাকে।

<a id="project-highlights"></a>

## প্রকল্পের বিশেষত্ব

- 🤖 **Codex-ভিত্তিক**: আলাদা নির্বাহ ইঞ্জিন না রেখে Codex-এর Agent লুপ, মডেল, যুক্তি, টুল কল, কথোপকথন, Skills ও MCP পুনর্ব্যবহার করুন।

- 🚀 **প্রস্তুত Desktop অ্যাপ**: Codex CLI অন্তর্ভুক্ত; প্রয়োজনে স্থানীয় Runtime চালু হয় এবং ডিফল্ট প্রকল্প নিজে তৈরি করে।

- ⚙️ **বিদ্যমান Codex সেটআপ**: প্রথমবার স্থানীয় কনফিগারেশন দেখে কার্যকর ChatGPT সাইন-ইন বা API key পুনর্ব্যবহারের প্রস্তাব দেয়। অন্য প্রদানকারীর জন্য নির্দেশিত ফর্ম আছে।

- 🔄 **Runtime উপাদান ব্যবস্থাপনা**: অন্তর্ভুক্ত, সক্রিয় ও সর্বশেষ yt-dlp দেখুন; নিয়মিত যাচাই ও নিজে আপডেট করুন। ব্যর্থ হলে বর্তমান কার্যকর সংস্করণ থাকে।

- 🎨 **বহুমাধ্যমে সৃষ্টি**: সংযুক্ত কর্মপ্রবাহে ভিডিও, ছবি, অডিও, সাবটাইটেল ও নথি তৈরি এবং পরিচালনা করুন।

- 🧩 **সৃজনশীল টেমপ্লেট**: প্রতিবার প্রম্পট ও সেটিংস নতুন করে না বানিয়ে টেমপ্লেট থেকে ছবি ও ভিডিও তৈরি করুন।

- 🔗 **দুটি কাজের মোড**: ভিজ্যুয়াল কর্মক্ষেত্র বা Agent আলোচনায় কাজ করুন; অভিন্ন স্টেট মেশিন ধাপ, অগ্রগতি ও ফলাফল সমন্বিত রাখে।

- 🕘 **সংস্করণ সংরক্ষণ**: প্রতিটি সংশোধনে নতুন সংস্করণ হয়; আগের সেটিংস ও আউটপুট পর্যালোচনা এবং তুলনার জন্য থাকে।

- 🧩 **পুনর্ব্যবহারযোগ্য Skills**: ভিডিও Skills ব্যবহার করুন, নিজের Skills দিয়ে Agent বাড়ান এবং Codex-এর নিজস্ব কনফিগারেশনে MCP পরিচালনা করুন।

- 🧠 **মেমরি**: সারাংশ ও পুনরুৎপাদনযোগ্য Run ইনপুট স্ন্যাপশটসহ গ্লোবাল, প্রকল্প ও থ্রেড মেমরি রাখুন।

- 🔐 **স্থানীয় নিরাপত্তা**: ডেটা, সংযুক্তি ও লগ ডিফল্টভাবে স্থানীয় থাকে; অনুমোদন এবং সংবেদনশীল তথ্য বাদ দেওয়া ডায়াগনস্টিক আছে।

- 🌐 **বহুভাষিক ইন্টারফেস**: Web ও Desktop-এ 43টি ভাষা, সিস্টেমের ভাষা শনাক্তকরণ, নিজে ভাষা নির্বাচন এবং আরবি, ফারসি, উর্দু ও হিব্রুর জন্য ডান থেকে বাম বিন্যাস রয়েছে।

<a id="creator-tools"></a>

## নির্মাতাদের টুল

বর্তমান রিলিজে দশটি নির্মাণ টুল আছে। মডেল ও পরিষেবার প্রাপ্যতা স্থানীয় Codex পরিবেশ এবং AI পরিষেবার সেটিংসের ওপর নির্ভর করে।

Dashboard-এ নিবন্ধ, Xiaohongshu পোস্ট বা ছোট ভিডিওর স্ক্রিপ্ট লিখুন; স্টিক-ফিগার অ্যানিমেশন তৈরি করুন; ভিডিও অনুবাদ বা ডাউনলোড করুন; থাম্বনেইল, ছবি বা ভিডিও তৈরি করুন; Text to Speech দিয়ে ভয়েসওভার বানান।

![OpenCreator নির্মাণ Dashboard](../images/product/opencreator-dashboard-en.png)

> নতুন নির্মাণ টুল নিয়মিত যোগ হচ্ছে।

**ভিডিও অনুবাদে 123টি উৎস ভাষা এবং পিনইন আউটপুটসহ 124টি লক্ষ্য বিকল্প রয়েছে।** স্থানীয় নাম, ইংরেজি নাম, চীনা নাম বা ভাষা কোড দিয়ে খুঁজুন। বাক্ শনাক্তকরণ ও সংশ্লেষণের ভাষা সমর্থন নির্বাচিত পরিষেবা ও মডেলের ওপর নির্ভর করে।

- **শুধু সাবটাইটেল অনুবাদ**: SRT আমদানি করে সঙ্গে সঙ্গে প্রিভিউ দেখুন ও অনুবাদ করুন; মূল ভিডিও, ডাবিং বা ভিডিও রেন্ডারিং প্রয়োজন নেই।

- **উন্নত সাবটাইটেল সম্পাদনা**: প্লেব্যাকের সঙ্গে যুক্ত ওয়েভফর্ম ও টাইমলাইনসহ পূর্ণপর্দার সম্পাদক দিয়ে সময় বদলান, সাবটাইটেল ভাগ বা যুক্ত করুন এবং টেক্সট খুঁজে প্রতিস্থাপন করুন। ভিডিওতে শৈলী দেখুন, ভাষা, কণ্ঠ ও আউটপুট ঠিক করে আগের ফলাফল রেখে নতুন সংস্করণ তৈরি করুন।

- **এক পৃষ্ঠায় তৈরি**: ছবি, ভিডিও ও Text to Speech-এর সেটিং এক পৃষ্ঠায় করুন। মডেল নির্বাচন, রেফারেন্স প্রিভিউ, মডেল অনুযায়ী ছবির বিকল্প ও অনুসন্ধানযোগ্য কণ্ঠের সংগ্রহ ব্যবহার করুন।

- **বহুভাষিক আউটপুট ও অগ্রগতি**: অন্তর্ভুক্ত বিকল্প ফন্ট জটিল লিপি ও ডান থেকে বাম সাবটাইটেলের প্রদর্শন উন্নত করে। প্রতিলিপি, অনুবাদ, ডাবিং ও রেন্ডারিংয়ের অগ্রগতি এবং পাওয়া গেলে সম্পন্ন ও মোট সংখ্যা দেখুন।

<table width="100%">
<thead>
<tr>
<th width="18%">কর্মক্ষেত্র</th>
<th width="14%">অবস্থা</th>
<th width="68%">সুবিধা</th>
</tr>
</thead>
<tbody>
<tr><td valign="top">ভিডিও অনুবাদ</td><td valign="top">✅ উপলব্ধ</td><td>স্থানীয় বা সর্বজনীন ভিডিও আনুন; ক্লাউড বা স্থানীয় Whisper-এ প্রতিলিপি; LLM প্রসঙ্গে সাবটাইটেল ভাগ, সারিবিন্যাস, পরিভাষা ও অনুবাদ; দ্বিভাষিক সাবটাইটেল, ডাবিং বা নিজস্ব কণ্ঠের নমুনা, সাবটাইটেল শৈলী, অনুভূমিক/উল্লম্ব বিন্যাস; SRT, অডিও বা ভিডিও রপ্তানি</td></tr>
<tr><td valign="top">ভিডিও ডাউনলোড</td><td valign="top">✅ উপলব্ধ</td><td>YouTube, Bilibili, X, TikTok, Instagram, Douyin, Facebook, Xiaohongshu, Pinterest ও Reddit-এর পৃথক সর্বজনীন ভিডিও বিশ্লেষণ; ফরম্যাট তুলনা করে ভিডিও বা অডিও ডাউনলোড। কিছু উৎসে প্ল্যাটফর্ম কুকি লাগতে পারে। প্ল্যাটফর্মে সাবটাইটেল থাকলে তালিকা দেখুন ও SRT ডাউনলোড করুন; প্রথমে ইংরেজি, তারপর পাওয়া গেলে ইন্টারফেসের ভাষা দেখানো হয়।</td></tr>
<tr><td valign="top">থাম্বনেইল তৈরি</td><td valign="top">✅ উপলব্ধ</td><td>বিষয়, ভিডিও লিংক ও ঐচ্ছিক রেফারেন্স ছবি থেকে একাধিক থাম্বনেইল তৈরি ও তুলনা</td></tr>
<tr><td valign="top">ছবি তৈরি</td><td valign="top">✅ উপলব্ধ</td><td>প্রম্পট ও ঐচ্ছিক রেফারেন্স থেকে GPT Image / Seedream / Kling Image / Gemini ব্যবহার; অনুপাত ও সংখ্যা নির্ধারণ; প্রতিটি ছবি দেখা ও ডাউনলোড</td></tr>
<tr><td valign="top">নিবন্ধ লেখা</td><td valign="top">✅ উপলব্ধ</td><td>বিষয়, লিংক, ভিডিও বা নথি থেকে সম্পাদনাযোগ্য বিষয়ের বিকল্প, রূপরেখা ও পূর্ণ নিবন্ধ; তৈরি ছবি যোগ এবং Markdown, HTML বা PDF রপ্তানি</td></tr>
<tr><td valign="top">Xiaohongshu পোস্ট</td><td valign="top">✅ উপলব্ধ</td><td>বিষয় বা উৎস থেকে পূর্ণ পোস্ট তৈরি; পাঠক, পোস্টের ধরন ও দৈর্ঘ্য নির্ধারণ; কপি বা ডাউনলোড</td></tr>
<tr><td valign="top">ছোট ভিডিওর স্ক্রিপ্ট</td><td valign="top">✅ উপলব্ধ</td><td>বিষয় বা উৎস থেকে দর্শক, প্ল্যাটফর্ম, সময় ও সুর অনুযায়ী শুটিং-উপযোগী ভাগ করা স্ক্রিপ্ট; সম্পাদনা, কপি বা ডাউনলোড</td></tr>
<tr><td valign="top">স্টিক-ফিগার অ্যানিমেশন</td><td valign="top">✅ উপলব্ধ</td><td>লেখা বা YouTube থেকে বর্ণনা, কণ্ঠ, একই পরিচয়ের চরিত্রসহ স্টোরিবোর্ড, সাবটাইটেল ও ডাউনলোডযোগ্য অ্যানিমেশন</td></tr>
<tr><td valign="top">স্বয়ংক্রিয় ক্লিপ</td><td valign="top">নির্মাণাধীন</td><td>দীর্ঘ ভিডিও বিশ্লেষণ, গুরুত্বপূর্ণ মুহূর্ত খোঁজা ও নির্বাচিত অংশ থেকে পুনর্ব্যবহারযোগ্য ছোট ক্লিপ</td></tr>
<tr><td valign="top">Text to Speech</td><td valign="top">✅ উপলব্ধ</td><td>কণ্ঠ, গতি ও আবেগ নিয়ন্ত্রণসহ স্ক্রিপ্ট থেকে ভয়েসওভার</td></tr>
<tr><td valign="top">ভিডিও তৈরি</td><td valign="top">✅ উপলব্ধ</td><td>প্রম্পট ও রেফারেন্স ছবি দিয়ে Seedance / Kling / Veo ভিডিও; প্রতিটি সংস্করণ দেখা, পুনরায় তৈরি ও ডাউনলোড</td></tr>
<tr><td valign="top">ডিজিটাল অবতার</td><td valign="top">নির্মাণাধীন</td><td>স্ক্রিপ্ট, কণ্ঠ ও অবতার মিলিয়ে কথা বলা ব্যক্তির ভিডিও</td></tr>
</tbody>
</table>

<a id="creation-templates"></a>

## সৃজনশীল টেমপ্লেট

প্রতিটি প্রম্পট ও সেটিং শুরু থেকে না বানিয়ে টেমপ্লেট থেকে শুরু করুন। ভিডিও তৈরি ও ছবি ডিজাইনসহ বিভিন্ন বিভাগে বাছাই করা টেমপ্লেট দেখুন।

সংগ্রহে OpenCreator ও স্বাধীন নির্মাতাদের টেমপ্লেট আছে। তৃতীয় পক্ষের টেমপ্লেটের বিবরণে নির্মাতার কৃতিত্ব ও মূল উৎসের লিংক থাকে।

টেমপ্লেট খুলে নমুনা ফলাফল, প্রম্পট, সেটিংস, ট্যাগ, লেখক ও মূল উৎস দেখুন। **Use this template** বেছে নিজের কাজের জন্য ইনপুট বদলান।

![উদাহরণ, সেটিংস ও প্রম্পটসহ ছবি তৈরির টেমপ্লেট](../images/product/creation-templates-detail-apex-summit-en.png)

<a id="skills"></a>

## Skills

নির্মাণ টুল ভিজ্যুয়াল নিয়ন্ত্রণ দেয়; Skills দেয় Agent-এর জন্য পুনর্ব্যবহারযোগ্য নির্দেশনা ও টুলের কর্মপ্রবাহ। রিপোজিটরিতে ভিডিও নির্মাণ Skills আছে এবং স্থানীয় Codex Skills পরিচালনা করা যায়।

[`skills/`](../../skills/) ফোল্ডারে সংযুক্ত KrillinAI CLI চালানোর জন্য Agent-এর পুনর্ব্যবহারযোগ্য নির্দেশনা আছে।

| Skill | সুবিধা |
| --- | --- |
| [KrillinAI CLI](../../skills/krillinai-cli/SKILL.md) | কমান্ড নির্বাচন, কনফিগারেশন যাচাই এবং অগ্রগতি, ম্যানিফেস্ট, আউটপুট ও ত্রুটি বোঝা |
| [সাবটাইটেল](../../skills/krillinai-subtitle/SKILL.md) | ক্যাপশন ডাউনলোড বা প্রতিলিপি, অনুবাদ এবং দ্বিভাষিক বা উল্লম্ব ভিডিওর ছোট সাবটাইটেল |
| [TTS](../../skills/krillinai-tts/SKILL.md) | সাবটাইটেল থেকে লক্ষ্য ভাষায় ডাবিং এবং ঐচ্ছিক ডাব করা ভিডিও |
| [অনুভূমিক রেন্ডার](../../skills/krillinai-render-horizontal/SKILL.md) | দ্বিভাষিক সাবটাইটেল বা ডাব অডিও ও লক্ষ্য ভাষার সাবটাইটেলসহ অনুভূমিক ভিডিও |
| [উল্লম্ব রেন্ডার](../../skills/krillinai-render-vertical/SKILL.md) | শিরোনাম, দ্বিভাষিক সাবটাইটেল বা ডাবিংসহ উল্লম্ব ভিডিও |
| [কভার](../../skills/krillinai-cover/SKILL.md) | পূর্ণ টেক্সট প্রম্পট থেকে কভার তৈরি, ছবি ও চূড়ান্ত প্রম্পট সংরক্ষণ |
| [পাইপলাইন পরিকল্পনা](../../skills/krillinai-pipeline/SKILL.md) | বহু-ধাপ আউটপুট পরিকল্পনা dry-run-এ যাচাই; বাস্তব কাজ সংশ্লিষ্ট ধাপের Skills দিয়ে চালানো |

<a id="extend-with-your-own-skills"></a>

### নিজের Skills দিয়ে সম্প্রসারণ

OpenCreator-এ `SKILL.md` দিয়ে সংজ্ঞায়িত স্থানীয় Codex Skills ব্যবহার করে নিজস্ব পদ্ধতি ও কর্মপ্রবাহ যোগ করা যায়। প্রাপ্যতা সক্রিয় Codex home ও ইনস্টল করা Skills-এর ওপর নির্ভর করে; ভিডিও Skills-এর জন্য CLI ও সংশ্লিষ্ট পরিষেবা সেট করতে হয়। রিপোজিটরিতে থাকা মানেই সব Skill স্বয়ংক্রিয়ভাবে ইনস্টল হওয়া বা সব বাইরের পরিষেবা অন্তর্ভুক্ত থাকা নয়।

<a id="conversation-and-workspace-moving-together"></a>

## কথোপকথন ও কর্মক্ষেত্র একসঙ্গে

স্বাভাবিকভাবে কাজের বর্ণনা দিন; সুনির্দিষ্ট নিয়ন্ত্রণ চাইলে ভিজ্যুয়াল টুল খুলুন।

![OpenCreator কথোপকথন ও ভিজ্যুয়াল কর্মক্ষেত্রের সমন্বয়](../images/examples/opencreator-auto-clips-en.png)

<a id="fine-grained-workspace-controls"></a>

### সূক্ষ্ম নিয়ন্ত্রণ

সাবটাইটেল, শট, অডিও ও তৈরি করার সেটিংস নির্ভুলভাবে বদলান।

<a id="flexible-conversational-edits"></a>

### কথোপকথনে সম্পাদনা

Agent-কে পরিবর্তন বলুন এবং স্বাভাবিক ভাষায় ফলাফল পরিমার্জন করুন।

<a id="synchronized-state"></a>

### সমন্বিত অবস্থা

আলোচনা ও কর্মক্ষেত্রে একই কাজের অবস্থা থাকে; তথ্য পুনরায় বলতে হয় না।

<a id="independent-versions"></a>

### স্বতন্ত্র সংস্করণ

প্রতি সংশোধনে নতুন সংস্করণ হয়; আগের ফলাফল বা সেটিংস মুছে যায় না।

<a id="models-supported"></a>

## সমর্থিত মডেল

ভাষা মডেল Codex তালিকা বা আপনার OpenAI-সামঞ্জস্যপূর্ণ প্রদানকারী থেকে আসে। ছবি, ভিডিও, কণ্ঠ ও প্রতিলিপি মডেল **Settings → AI Services**-এ নির্ধারিত পরিষেবা ব্যবহার করে।

প্রদর্শিত প্রদানকারী ও মডেল উদাহরণ; বাস্তব প্রাপ্যতা শংসাপত্র, অ্যাকাউন্টের অনুমতি ও প্ল্যাটফর্মের ওপর নির্ভরশীল।

<a id="language-models"></a>

### ভাষা মডেল

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

### ছবি

<table>
<tr>
<td align="center" width="25%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>GPT Image</strong></td>
<td align="center" width="25%"><img src="../images/models/jimeng.png" alt="Jimeng" width="40" height="40" /><br /><strong>Seedream 4.0</strong><br />Jimeng</td>
<td align="center" width="25%"><img src="../images/models/kling.png" alt="Kling" width="40" height="40" /><br /><strong>Kling v2.1</strong><br />Kling Image</td>
<td align="center" width="25%"><img src="../images/models/gemini.png" alt="Gemini" width="40" height="40" /><br /><strong>Nano Banana</strong><br />Gemini 2.5 Flash Image</td>
</tr>
</table>

<a id="video"></a>

### ভিডিও

<table>
<tr>
<td align="center" width="33%"><img src="../images/models/seedance.png" alt="Seedance" width="40" height="40" /><br /><strong>Seedance 2.5</strong></td>
<td align="center" width="33%"><img src="../images/models/kling.png" alt="Kling" width="40" height="40" /><br /><strong>Kling v2.1 Master</strong></td>
<td align="center" width="33%"><img src="../images/models/gemini.png" alt="Gemini" width="40" height="40" /><br /><strong>Veo 3.1</strong></td>
</tr>
</table>

<a id="voice-and-transcription"></a>

### কণ্ঠ ও প্রতিলিপি

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

উপলব্ধ থাকলে স্থানীয় প্রতিলিপিতে faster-whisper, WhisperKit ও whisper.cpp-ও সমর্থিত।

<a id="examples"></a>

## উদাহরণ

<a id="video-translation"></a>

### ভিডিও অনুবাদ

নিচের প্রকাশ্য উদাহরণগুলো OpenCreator-এর KrillinAI নাম থাকার সময় তৈরি। এগুলো সাবটাইটেল সারিবিন্যাস, অনুবাদ, ডাবিং ও উল্লম্ব ভিডিওর প্রতিষ্ঠিত কর্মপ্রবাহ দেখায়, যা এখন Video Translation কর্মক্ষেত্রের মাধ্যমে বৃহত্তর Agent কর্মপ্রবাহে যুক্ত।

৪৬ মিনিটের স্থানীয় ভিডিও থেকে এক Run-এ নিচের সাবটাইটেল ফাইল তৈরি হয়, কোনো হাতে সংশোধন ছাড়া। প্রকাশিত ফলাফলে সম্পূর্ণ বিষয়বস্তু, ওভারল্যাপহীন লাইন, স্বাভাবিক বিভাজন ও উন্নত অনুবাদ দেখা যায়।

![OpenCreator সাবটাইটেল সারিবিন্যাসের উদাহরণ](../images/examples/krillinai-subtitle-alignment.png)

<table width="100%">
<tr>
<td width="33%">

<a id="subtitle-translation"></a>

#### সাবটাইটেল অনুবাদ

https://github.com/user-attachments/assets/bba1ac0a-fe6b-4947-b58d-ba99306d0339

</td>
<td width="33%">

<a id="dubbing"></a>

#### ডাবিং

https://github.com/user-attachments/assets/0b32fad3-c3ad-4b6a-abf0-0865f0dd2385

</td>
<td width="33%">

<a id="portrait-mode"></a>

#### উল্লম্ব মোড

https://github.com/user-attachments/assets/c2c7b528-0ef8-4ba9-b8ac-f9f92f6d4e71

</td>
</tr>
</table>

> ভিডিও উদাহরণ ও সাবটাইটেল সারিবিন্যাসের ছবিটি KrillinAI নাম থাকার সময় তৈরি।

<a id="video-downloader"></a>

### ভিডিও ডাউনলোড

১০টি সমর্থিত প্ল্যাটফর্মের সর্বজনীন ভিডিও লিংক বিশ্লেষণ, ফরম্যাট তুলনা এবং সরাসরি প্রকল্পে ভিডিও বা অডিও ডাউনলোড করুন।

সমর্থিত ভিডিও উৎস:

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

ভিডিও ও অঞ্চল অনুযায়ী প্রাপ্যতা বদলায়; কিছু উৎসে প্ল্যাটফর্ম কুকি লাগে।

![OpenCreator ভিডিও ডাউনলোডের ফরম্যাট নির্বাচন](../images/examples/video-downloader-formats-and-subtitles-en.png)

<a id="video-generation"></a>

### ভিডিও তৈরি

Seedance-এ টেক্সট প্রম্পট বা রেফারেন্স ছবি থেকে AI ভিডিও তৈরি করুন। মডেল, অনুপাত, রেজল্যুশন ও সময় নির্ধারণ করে প্রকল্পে প্রতিটি সংস্করণ দেখুন, আবার তৈরি বা ডাউনলোড করুন।

![Seedance দিয়ে OpenCreator ভিডিও তৈরি](../images/examples/video-generation-seedance-en.png)

<a id="stick-figure-animation"></a>

### স্টিক-ফিগার অ্যানিমেশন

এই মৌলিক চরিত্রসমষ্টি OpenCreator শিল্পী [Harbor Hsia](https://www.behance.net/xiaheyuan1)-এর সঙ্গে তৈরি করেছে, যিনি [Behance-এর Stickman](https://www.behance.net/gallery/254715463/Stickman)-এর স্রষ্টা। অন্তর্ভুক্ত চরিত্রগুলোর পরিচয় পুরো অ্যানিমেশন কর্মপ্রবাহে একই থাকে।

![শিল্পীর সহযোগিতায় OpenCreator স্টিক-ফিগার চরিত্র](../images/examples/stick-figure-characters.webp)

স্ক্রিপ্ট পর্যালোচনা, বর্ণনা, সময়, স্টোরিবোর্ড, সাবটাইটেল ও রেন্ডারিংয়ের নির্দেশিত ধাপ দিয়ে লেখা বা YouTube কনটেন্টকে পূর্ণ ডাউনলোডযোগ্য অ্যানিমেশনে রূপ দিন।

![OpenCreator স্টিক-ফিগার অ্যানিমেশনের ফ্রেম](../images/examples/stick-figure-animation-frame.jpg)

<a id="quick-start"></a>

## দ্রুত শুরু

<a id="install-the-desktop-app"></a>

### Desktop অ্যাপ ইনস্টল

[সর্বশেষ OpenCreator রিলিজ](https://github.com/krillinai/OpenCreator/releases/latest) থেকে macOS Apple Silicon, macOS Intel বা Windows x64 ইনস্টলার নামান। ইনস্টল করে খুলুন; Node.js বা pnpm লাগে না। Codex CLI অন্তর্ভুক্ত; বাস্তব মডেল কাজের জন্য কার্যকর ChatGPT সাইন-ইন বা API key সেটআপ লাগবে।

প্রথমবার Desktop স্থানীয় Runtime চালায়, ডিফল্ট প্রকল্প তৈরি করে এবং Codex কনফিগারেশন দেখে। কার্যকর সাইন-ইন বা API key ও মডেল সেটিংস পেলে **Use local Codex and continue** বেছে নিন। একই ধাপে অন্য প্রদানকারীও সেট করা যায়:

![প্রথমবার Desktop-এর মডেল প্রদানকারী সেটআপ](../images/product/opencreator-codex-setup.png)

সেটআপের পরে ইনপুট বক্সে অনুরোধ লিখুন। সমস্যা হলে [ব্যবহার নির্দেশিকা ও সমস্যা সমাধান](../opencreator-user-guide-and-troubleshooting.md) দেখুন।

<a id="run-web-from-source"></a>

### সোর্স থেকে Web চালান

ডেভেলপমেন্ট বা ব্রাউজারে ব্যবহারের জন্য ইনস্টল করুন:

- Node.js 22 বা নতুন
- pnpm 9.15.0, রিপোজিটরির `packageManager`-এ নির্ধারিত
- টার্মিনাল থেকে চালানো যায় এমন Codex CLI executable
- বাস্তব মডেল কাজের জন্য বৈধ Codex CLI লগইন

আগে স্থানীয় পরিবেশ দেখুন:

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

`http://127.0.0.1:19861/` খুলুন। ডেভেলপমেন্ট সার্ভার প্রয়োজনে স্থানীয় daemon চালিয়ে একই উৎসের প্রক্সি দিয়ে অস্থায়ী Runtime টোকেন যোগ করে; হাতে টোকেন কপি করতে হয় না।

প্রথমবার Runtime ডিফল্ট প্রকল্প বানিয়ে Codex সেটিংস দেখে। স্থানীয় Codex-এর জন্য বর্তমান ChatGPT সাইন-ইন বা API key নিশ্চিত করুন, অথবা প্রদানকারী বেছে মডেল, endpoint ও API key দিন। তারপর ইনপুট বক্স প্রস্তুত। শুধু daemon নিয়ে কাজ করতে:

```bash
pnpm daemon:dev
```

daemon শুধু লুপব্যাক ঠিকানায় শোনে এবং সংযোগের ঠিকানা ও অস্থায়ী টোকেন একবার stdout-এ দেখায়।

<a id="desktop"></a>

## Desktop

Desktop ও ব্রাউজার `apps/web`-এর একই React ফ্রন্টএন্ড ব্যবহার করে। প্রকল্প, আলোচনা, কাজ ও সেটিংস একই Daemon/API ডাকে। Electron কেবল আসল সিস্টেম পাথ, উইন্ডো নিয়ন্ত্রণ, ট্রে ও নেটিভ বিজ্ঞপ্তি যোগ করে।

<a id="development-mode"></a>

### ডেভেলপমেন্ট মোড

```bash
pnpm desktop:dev
```

<a id="local-packaging"></a>

### স্থানীয় প্যাকেজিং

| কমান্ড | আউটপুট |
| --- | --- |
| `pnpm desktop:package` | স্থানীয় যাচাইয়ের জন্য বর্তমান প্ল্যাটফর্মে চালানো যায় এমন ফোল্ডার |
| `pnpm desktop:dist` | বর্তমান প্ল্যাটফর্মের ইনস্টলার |
| `pnpm desktop:release` | আনুষ্ঠানিক রিলিজ প্যাকেজিংয়ের প্রবেশপথ |
| `pnpm --filter @opencreator/desktop verify:package` | বিদ্যমান Desktop প্যাকেজ যাচাই |
| `pnpm krillinai:package` | নির্বাচিত প্ল্যাটফর্মের পৃথক KrillinAI Server ও CLI আর্কাইভ |

Desktop প্যাকেজিং বর্তমান কর্মক্ষেত্র থেকে Web পুনর্নির্মাণ করে; commit, কমিট না করা পরিবর্তন, প্ল্যাটফর্ম, আর্কিটেকচার ও Web hash লেখে; `apps/web/dist`-কে অ্যাপে অন্তর্ভুক্ত রিসোর্সের সঙ্গে মেলায়। অমিল হলে প্যাকেজিং ব্যর্থ হয়। স্বাক্ষর, notarization, Windows বিল্ড ও রিলিজের শর্তের জন্য [Desktop রিলিজ নির্দেশিকা](../operations/opencreator-desktop-release-runbook.md) দেখুন।

<a id="core-workflows"></a>

## মূল কর্মপ্রবাহ

<a id="conversations-and-runs"></a>

### কথোপকথন ও Run

1. প্রকল্প বাছুন বা নতুন আলোচনা শুরু করুন।
2. কাজ লিখে অনুমতির স্তর, Profile, মডেল ও যুক্তির প্রচেষ্টা বাছুন।
3. Run চলার সময় পরের কাজ সারিতে দিন বা থামিয়ে সঙ্গে সঙ্গে এগোন।
4. Timeline-এ যুক্তির সারাংশ, টুল কল, ফাইল পরিবর্তন, অনুমোদন ও ফল দেখুন।
5. কাজের কেন্দ্রে সব চলমান, সম্পূর্ণ, ব্যর্থ ও অনুমোদন-অপেক্ষমাণ কাজ অনুসরণ করুন।

<a id="skills-and-mcp"></a>

### Skills ও MCP

- প্লাগইন কেন্দ্রে Skill বাজার, ইনস্টল ইতিহাস ও স্থানীয় Skills দেখুন।
- ইনপুট বক্সে `/` বা যোগ করার মেনুতে Skill বাছুন; পরের কাজ তার কর্মপ্রবাহ মেনে চলবে।
- MCP ব্যবস্থাপনা Codex-এর নিজস্ব কমান্ড ও কনফিগারেশনে হয়; আলাদা নির্বাহ ইঞ্জিন নেই।
- সক্রিয় `$CODEX_HOME` ডিফল্ট; গ্লোবাল Skills বা MCP বদলানোর আগে প্রভাব যাচাই করুন।

<a id="schedules-and-dedicated-task-threads"></a>

### সময়সূচি ও নির্দিষ্ট কাজের থ্রেড

- প্রতিটি সময়সূচির নিজস্ব স্থায়ী OpenCreator আলোচনা থাকে।
- স্বয়ংক্রিয় ট্রিগার, হাতে চালানো ও পরবর্তী অনুরোধ একই আলোচনায় `queue` বা `skip` নীতিতে ক্রমানুসারে চলে।
- সময়সূচি মুছলে আলোচনা আর্কাইভ হয়; আগের Run, ফলাফল ও Codex ইতিহাস থাকে।
- ভেতরের Codex থ্রেড বদলানো বা উদ্ধার করলে OpenCreator কাজের এন্ট্রি বা পৃষ্ঠার রুট বদলায় না।

<a id="opencreator-system-architecture"></a>

## OpenCreator সিস্টেম স্থাপত্য

ভিজ্যুয়াল কর্মক্ষেত্র ও Agent আলোচনা একই সৃজনশীল কাজের দুটি ইন্টারফেস। প্রতিটি কর্মপ্রবাহ স্টেট মেশিন: ইনপুট, কনফিগারেশন, তৈরি, পর্যালোচনা, সংশোধন ও রপ্তানি স্পষ্ট অবস্থা এবং ইভেন্ট। ভিজ্যুয়াল কাজ ও আলোচনার নির্দেশ একই মেশিনে যায়; বর্তমান ধাপ, সেটিংস, অগ্রগতি, সংস্করণ ও ফলাফল দুই ইন্টারফেসে ফেরে। তাই অভিন্ন প্রামাণিক অবস্থা থেকে সমন্বয় বজায় থাকে।

সৃজনশীল কাজে পুনরাবৃত্তি দরকার। প্রতিটি সংশোধন বা পুনরায় তৈরি বর্তমান কর্মপ্রবাহ থেকে নতুন সংস্করণ বানায়; পুরনো ফল মুছে দেয় না। আগের সেটিংস ও আউটপুট পর্যালোচনা, তুলনা ও আরও পরিমার্জনের জন্য থাকে।

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

| OpenCreator উপাদান | দায়িত্ব | বাস্তবায়ন |
| --- | --- | --- |
| নির্মাণ অভিজ্ঞতা | Dashboard, টুল, Agent আলোচনা, সেটিংস ও ফাইল | `apps/web` · React 18 · Vite · TypeScript |
| সহযোগিতা কেন্দ্র | ধাপ, আলোচনার প্রসঙ্গ, অগ্রগতি, ফল ও সংশোধন সমন্বয় | অভিন্ন কর্মপ্রবাহের অবস্থা · `CreatorCollaborationPanel` · সংস্করণের ইতিহাস |
| স্থানীয় Runtime | প্রকল্প, Run, অনুমোদন, সময়সূচি, মেমরি ও বিজ্ঞপ্তি | `apps/daemon` · Fastify · Runtime API · SSE |
| Runtime উপাদান | অন্তর্ভুক্ত, সক্রিয় ও নতুন সংস্করণ অনুসরণ; নিয়মিত যাচাই; শুধু অনুরোধে আপডেট | yt-dlp nightly · আপডেট যাচাই · কার্যকর সংস্করণে ফেরত |
| Codex ইঞ্জিন | Agent লুপ, সেশন, যুক্তি, টুল, Skills ও MCP | Codex CLI · app-server |
| মিডিয়া টুলচেইন | ডাউনলোড, প্রতিলিপি, রূপান্তর, তৈরি ও রপ্তানি | yt-dlp · Whisper · FFmpeg · কনফিগার করা AI পরিষেবা |
| স্থানীয় ডেটা | প্রকল্প, Run, সংযুক্তি, আউটপুট ও শংসাপত্র স্থানীয়ভাবে রাখা | SQLite · ফাইলসিস্টেম · সিস্টেম শংসাপত্র ভান্ডার |
| Desktop হোস্ট | অভিন্ন Web বিল্ড লোড ও OS সুবিধা যোগ | `apps/desktop` · Electron · Preload Bridge |

মূল নীতি:

- কর্মক্ষেত্র ও Agent আলোচনা একই কর্মপ্রবাহের অবস্থা দেখায় এবং একই স্টেট মেশিনে ইভেন্ট পাঠায়।
- সংশোধনে নতুন সংস্করণ হয়; প্রতিবারের প্রসঙ্গ ও আউটপুট রাখা হয়।
- ফ্রন্টএন্ড সরাসরি Codex চালায় না বা কাঁচা Codex JSONL ইভেন্টের ওপর নির্ভর করে না।
- daemon প্রক্রিয়ার জীবনচক্র, ইভেন্ট স্বাভাবিকীকরণ, স্থায়ী সংরক্ষণ, অনুমোদন, সময়সূচি ও বিজ্ঞপ্তির আউটবক্স সামলায়।
- Agent লুপ, Skills ও MCP নির্বাহের প্রামাণিক উৎস Codex।
- Browser Bridge ও Desktop Bridge-এ সাধারণ পণ্য-লজিকের আলাদা অনুলিপি নেই।

<a id="repository-layout"></a>

## রিপোজিটরির বিন্যাস

```text
OpenCreator/
├── apps/
│   ├── web/          # একমাত্র React ফ্রন্টএন্ড
│   ├── daemon/       # স্থানীয় Fastify Runtime ও Codex অ্যাডাপ্টার
│   ├── desktop/      # Electron Main, Preload, নেটিভ সুবিধা ও প্যাকেজিং
│   └── harness/      # Runtime কমান্ড-লাইন যাচাই টুল
├── packages/
│   ├── protocol/     # Web, Daemon ও Desktop-এর অভিন্ন Runtime চুক্তি
│   └── skill-market/ # Skill বাজারের মডেল ও অভিন্ন লজিক
├── docs/             # ডিজাইন, API, পরিচালনা নির্দেশিকা ও পরীক্ষার রিপোর্ট
├── scripts/          # রিপোজিটরি স্তরের যাচাই
└── .runtime/         # স্থানীয় Runtime ডেটা; প্রথমবার তৈরি হয়
```

<a id="configuration"></a>

## কনফিগারেশন

<a id="ai-service-api-keys"></a>

### AI পরিষেবার API key

**Settings → AI Services**-এ বর্তমান কর্মক্ষেত্রের মডেল, প্রতিলিপি, কণ্ঠ ও ছবি প্রদানকারী সেট করুন। আসন্ন টুলের জন্য অতিরিক্ত বিভাগ থাকতে পারে। প্রতি বিভাগ নির্বাচিত প্রদানকারীর প্রয়োজনীয় ক্ষেত্রই দেখায়: Base URL, API Key, মডেল, প্রক্সি বা বিশেষ শংসাপত্র।

![OpenCreator AI পরিষেবার API key সেটিংস](../images/product/opencreator-ai-services-en.png)

শংসাপত্র স্থানীয় Runtime-এর সিস্টেম ভান্ডারে থাকে; কখনো রিপোজিটরিতে commit করবেন না। Edge TTS-এর মতো কিছু স্থানীয় বা সিস্টেম-ভিত্তিক প্রদানকারীর API Key লাগে না।

<a id="account-and-subscriptions"></a>

### অ্যাকাউন্ট ও সাবস্ক্রিপশন

ব্যক্তিগত কেন্দ্রে অ্যাকাউন্ট, নিশ্চিত সাবস্ক্রিপশন ও অবশিষ্ট ক্রেডিট দেখা যায়। সাইন-ইনে `https://www.open-creator.ai/device` খোলে। ওয়েবসাইটে ঢুকে ডিভাইস অনুমোদন করুন; স্থানীয় Daemon নিজের সেশন পায়। ব্রাউজার ও অ্যাপের অ্যাকাউন্ট এক, সেশন আলাদা।




OpenCreator-এ পরিকল্পনা বাছুন। কিনতে Stripe Checkout, পরিচালনায় Stripe Billing Portal খোলে। পেমেন্টের পরে অ্যাপে ফেরা `/billing/return` দিয়ে হয়; ওয়েবসাইট সেশন লাগে না। যাচাইকৃত Stripe বিজ্ঞপ্তির পরে Gateway থেকে সুবিধা হালনাগাদ হয়। `/pricing` ও `/account` পৃষ্ঠাও একই সাবস্ক্রিপশন ব্যবস্থায় কেনার পথ দেয়।






<a id="third-party-runtime-components"></a>

### তৃতীয় পক্ষের Runtime উপাদান

**Settings → Third-party Components**-এ সক্রিয় yt-dlp nightly, অন্তর্ভুক্ত সংস্করণ, উৎস ও সর্বশেষ রিলিজ দেখুন। প্রতি সাত দিনে যাচাই হয়, স্বয়ংক্রিয় ইনস্টল নয়। ব্যবহারকারীর স্পষ্ট নির্দেশে আপডেট হয়; ডাউনলোড, যাচাই বা ইনস্টল ব্যর্থ হলে কার্যকর সংস্করণ থাকে।

![OpenCreator তৃতীয় পক্ষের উপাদানের সেটিংস](../images/product/opencreator-third-party-components-en.png)

<a id="runtime-environment-variables"></a>

### Runtime এনভায়রনমেন্ট ভেরিয়েবল

বেশির ভাগ ব্যবহারকারীর এনভায়রনমেন্ট ভেরিয়েবল লাগে না। আলাদা ডেটা, নির্দিষ্ট Codex executable বা নিজস্ব পরিচালিত প্রকল্পের ফোল্ডারের জন্য ব্যবহার করুন:

| এনভায়রনমেন্ট ভেরিয়েবল | ডিফল্ট | উদ্দেশ্য |
| --- | --- | --- |
| `OPENCREATOR_DATA_DIR` | `.runtime` | OpenCreator ডেটাবেস, Run, সংযুক্তি ও পরিচালিত কর্মক্ষেত্র |
| `OPENCREATOR_GATEWAY_ORIGIN` | `https://www.open-creator.ai` | লগইন, সাবস্ক্রিপশন, ক্রেডিট ও অফিশিয়াল মডেল পরিষেবার Gateway; স্থানীয় Gateway হলে বদলান |
| `OPENCREATOR_CODEX_BIN` | `codex` | Codex CLI executable-এর পাথ |
| `CODEX_HOME` | `~/.codex` | Codex সেশন, কনফিগারেশন, Skills, MCP ও Profiles-এর প্রামাণিক উৎস |
| `OPENCREATOR_DEFAULT_CWD` | বর্তমান কাজের ফোল্ডার | daemon-এর ডিফল্ট কাজের ফোল্ডার |
| `OPENCREATOR_DEFAULT_PROJECT_ROOT` | Runtime-এর ডিফল্ট নীতি | পরিচালিত প্রকল্পের মূল ফোল্ডার; নির্ধারিত হলে এর `OpenCreator/` সাবফোল্ডার ব্যবহার হয় |
| `OPENCREATOR_CODEX_THREAD_ROTATION_RUN_THRESHOLD` | `50` | দীর্ঘমেয়াদি সময়সূচির Codex থ্রেড বদলানোর সমাপ্ত Run সীমা; `0` দিলে আগাম বদল বন্ধ |

উদাহরণ: Runtime ডেটা ও Codex পরিবেশ আলাদা করুন:

```bash
OPENCREATOR_DATA_DIR=/path/to/opencreator-data \
CODEX_HOME=/path/to/codex-home \
pnpm web:dev
```

<a id="data-and-security"></a>

## ডেটা ও নিরাপত্তা

ডিফল্টভাবে Runtime ডেটা রিপোজিটরির মূল `.runtime/`-এ থাকে:

| পাথ | বিষয়বস্তু |
| --- | --- |
| `.runtime/app.sqlite` | প্রকল্প, থ্রেড, Run, ইভেন্ট, সময়সূচি, বিজ্ঞপ্তি, সংযুক্তির মেটাডেটা, অনুমোদন, মেমরি ও সারাংশ |
| `.runtime/runs/` | প্রতি Run-এর সংবেদনশীল তথ্য বাদ দেওয়া লগ, ডায়াগনস্টিক ও মেটাডেটা |
| `.runtime/attachments/` | নিয়ন্ত্রিত সংযুক্তি ফাইল |
| `.runtime/workspaces/` | Runtime পরিচালিত প্রকল্প কর্মক্ষেত্র |

Codex সেশন ও কনফিগারেশন `$CODEX_HOME`-এ থাকে; `.runtime/` থেকে আলাদা ব্যাকআপ নিন।

নিরাপত্তার সীমা:

- daemon শুধু `127.0.0.1`-এ শোনে; health check ছাড়া সব API-তে Bearer টোকেন লাগে।
- HTML প্রিভিউতে স্ক্রিপ্ট, নেভিগেশন ও পপআপ ডিফল্টে বন্ধ; একই কর্মক্ষেত্রের নিয়ন্ত্রিত আপেক্ষিক রিসোর্সই অনুমোদিত।
- সংবেদনশীল মেমরিতে দ্বিতীয় নিশ্চিতকরণ লাগে; অনিশ্চিত পরামর্শ নিজে থেকে স্থায়ী হয় না।
- ফেরত বা রপ্তানির আগে ডায়াগনস্টিক ও Run লগের সংবেদনশীল তথ্য বাদ দেওয়া হয়।
- Desktop প্যাকেজে ASAR অখণ্ডতা ও কুকি এনক্রিপশন চালু; RunAsNode, `NODE_OPTIONS` ও Node CLI Inspector বন্ধ।

ব্যাকআপ, পুনরুদ্ধার, পরিষ্কার ও রিসেটের পূর্ণ ধাপ [ব্যবহার নির্দেশিকা](../opencreator-user-guide-and-troubleshooting.md)-এ আছে।

<a id="development"></a>

## ডেভেলপমেন্ট

<a id="common-commands"></a>

### সাধারণ কমান্ড

| কমান্ড | উদ্দেশ্য |
| --- | --- |
| `pnpm web:dev` | Web চালু ও প্রয়োজনে স্থানীয় daemon শুরু |
| `pnpm daemon:dev` | শুধু daemon চালু |
| `pnpm desktop:dev` | নির্ভরতা বিল্ড করে ডেভেলপমেন্ট মোডে Electron চালু |
| `pnpm test` | কর্মক্ষেত্রের ইউনিট ও ইন্টিগ্রেশন পরীক্ষা |
| `pnpm typecheck` | সমস্ত রিপোজিটরিতে TypeScript যাচাই |
| `pnpm build` | সব কর্মক্ষেত্র বিল্ড |
| `pnpm e2e` | Web Playwright E2E পরীক্ষা |
| `pnpm smoke:ci` | নকল Codex দিয়ে Runtime smoke test |
| `pnpm perf:check` | নথিভুক্ত পারফরম্যান্স ভিত্তিরেখা যাচাই |

পরিবর্তন জমার আগে প্রভাব অনুযায়ী [অবদান নির্দেশিকা](../../CONTRIBUTING.md#what-reviewers-check) মেনে যাচাই বাছুন। নথি, ভাষা ও শৈলীতে প্রাসঙ্গিক যাচাই যথেষ্ট; অভিন্ন আচরণ ও Runtime-এ নির্দিষ্ট মডিউল পরীক্ষা ও typecheck লাগে। প্রভাবের পরিসর চাইলে পূর্ণ পরীক্ষা বা বিল্ড চালিয়ে PR-এ জানান।

Desktop, Host Bridge, Runtime প্রক্সি বা অভিন্ন ফ্রন্টএন্ড কর্মপ্রবাহে পরিবর্তনের জন্য Web/Desktop সামঞ্জস্য পরীক্ষা, প্যাকেজ অ্যাপ E2E ও Web hash যাচাইও লাগে। শুধু Web ইউনিট পরীক্ষায় Desktop রিলিজের প্রস্তুতি প্রমাণ হয় না।

বাস্তব Codex smoke test ডিফল্টে বন্ধ। স্পষ্টভাবে চালু করুন:

```bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

<a id="documentation"></a>

## নথিপত্র

- **ব্যবহার:** [দ্রুত শুরু](#quick-start) · [নির্দেশিকা ও সমস্যা সমাধান](../opencreator-user-guide-and-troubleshooting.md)
- **উন্নয়ন ও সম্প্রসারণ:** [অবদান](../../CONTRIBUTING.md) · [আচরণবিধি](../../CODE_OF_CONDUCT.md) · [Skill অবদান](../contributing/skills-contributing.md) · [টেমপ্লেট অবদান](../contributing/templates-contributing.md) · [Runtime API v1](../runtime-api-for-ui-v1.md) · [ভিজ্যুয়াল উপাদান নির্দেশিকা](../visual-component-guidelines.md)
- **রক্ষণাবেক্ষণ ও রিলিজ:** [Codex-ভিত্তিক Runtime ডিজাইন](../2026-07-03-codex-native-agent-runtime-design.md) · [Desktop রিলিজ প্রক্রিয়া](../operations/opencreator-desktop-release-runbook.md) · [Windows Desktop রিলিজ](../operations/opencreator-desktop-windows-release.md)

<a id="translation-convention"></a>

## অনুবাদের নিয়ম

মূল `README.md` প্রামাণিক ইংরেজি নথি। অনুবাদ থাকে `docs/<locale>/README.md`-এ। পুরো নথি অনুবাদ ও ইংরেজি কাঠামোর সঙ্গে সমন্বিত হওয়ার পরেই ভাষার তালিকায় যোগ করুন।

<a id="community"></a>

## কমিউনিটি

<p><strong>অন্তত 107 দেশ ও অঞ্চলের</strong> GitHub ব্যবহারকারী OpenCreator-কে স্টার দিয়েছেন।</p>

<img src="../images/star-coverage-map.svg" alt="OpenCreator-কে GitHub স্টার দেওয়া দেশ ও অঞ্চলের মানচিত্র" width="760" />

<a id="the-crew"></a>

### দায়িত্বপ্রাপ্ত দল

প্রতিটি সদস্য নিজের ক্ষেত্রের মানদণ্ড, অবদান পর্যালোচনা ও মার্জ এবং কমিউনিটি সহায়তার দায়িত্বে আছেন।

<table border="1" cellpadding="12">
  <tr>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/wulien.svg" width="64" height="64" alt="wulien avatar" /><br /><a href="https://github.com/wulien">wulien</a><br />কোড ও ত্রুটি সংশোধন</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/dle-kb.svg" width="64" height="64" alt="DLe-kb avatar" /><br /><a href="https://github.com/DLe-kb">DLe-kb</a><br />সৃজনশীল টেমপ্লেট</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/xiaheyuan.svg" width="64" height="64" alt="xiaheyuan avatar" /><br /><a href="https://github.com/xiaheyuan">xiaheyuan</a><br />ডিজাইন ও রিসোর্স</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/krillinai.svg" width="64" height="64" alt="krillinai avatar" /><br /><a href="https://github.com/krillinai">krillinai</a><br />Skills ও নথি</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/hbxugang.svg" width="64" height="64" alt="hbxugang avatar" /><br /><a href="https://github.com/hbxugang">hbxugang</a><br />এন্টারপ্রাইজ স্থাপন</td>
  </tr>
</table>

<a id="contributors"></a>

### অবদানকারী

কোড, নথি, মতামত, সমস্যা রিপোর্ট, Skills, চিত্র ও ধারণা দিয়ে অংশ নেওয়া সবাইকে ধন্যবাদ।
এই README তালিকা GitHub-এর স্বয়ংক্রিয় Contributors গ্রাফ থেকে আলাদাভাবে রাখা হয়।

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

### অবদান

এসব ক্ষেত্রে অবদান স্বাগত:

| ধরন | কী দেবেন | অবস্থান | পরিসর |
| --- | --- | --- | --- |
| কোড | ত্রুটি সংশোধন, নির্মাণ কর্মপ্রবাহ, অভিন্ন সুবিধা | `apps/web/`, `apps/daemon/` | পরীক্ষাসহ একটি নির্দিষ্ট PR |
| Skills | পুনর্ব্যবহারযোগ্য Agent কর্মপ্রবাহ | [`skills/`](../../skills/) | `SKILL.md` ও ঐচ্ছিক রেফারেন্সসহ একটি ফোল্ডার → [নির্দেশিকা](../contributing/skills-contributing.md) |
| সৃজনশীল টেমপ্লেট | পুনর্ব্যবহারযোগ্য ছবি, ভিডিও বা কভার প্রিসেট | [`template/`](../../template/) | `template.json` ও রিসোর্সসহ ফোল্ডার → [নির্দেশিকা](../contributing/templates-contributing.md) |
| চিত্র ও ডিজাইন | মৌলিক চিত্র, আইকন বা UI ডিজাইন | সম্মত রিসোর্স অবস্থান | প্রিভিউ, সোর্স ও লাইসেন্সসহ PR |
| তৃতীয় পক্ষের সংযোগ | AI বা মিডিয়া প্রদানকারী সমর্থন | সংশ্লিষ্ট Web বা Daemon মডিউল | ত্রুটি ব্যবস্থাপনা, শংসাপত্র সুরক্ষা ও পরীক্ষাসহ PR |
| নথি ও অনুবাদ | নথির উন্নতি বা নতুন ভাষা | `README.md`, `docs/`, `docs/<locale>/` | একটি PR |

স্থানীয় সেটআপ, পর্যালোচনার মানদণ্ড ও সাধারণ প্রত্যাখ্যানের কারণসহ পূর্ণ নির্দেশিকা [CONTRIBUTING.md](../../CONTRIBUTING.md)-এ; [১০ ভাষায়](../zh/CONTRIBUTING.md) পাওয়া যায়।

<a id="star-history"></a>

## স্টারের ইতিহাস

OpenCreator-এর পুরনো নাম KrillinAI। চার্টে নাম বদলের আগে ও পরের পুরো রিপোজিটরি ইতিহাস আছে।

[![OpenCreator স্টারের ইতিহাস](https://api.star-history.com/svg?repos=krillinai/OpenCreator&type=date)](https://www.star-history.com/?type=date&repos=krillinai%2FOpenCreator)

<a id="related-projects"></a>

## সম্পর্কিত প্রকল্প

| প্রকল্প | ভূমিকা |
| --- | --- |
| [OpenAI Codex](https://github.com/openai/codex) | মডেল ব্যবহার, যুক্তি, টুল কল, সেশন, Skills ও MCP-এর Agent নির্বাহ ইঞ্জিন। |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | প্রকাশ্য মিডিয়া লিংক যাচাই, ফরম্যাট তালিকা এবং ভিডিও বা অডিও ডাউনলোড। |
| [FFmpeg](https://ffmpeg.org/) | FFmpeg ও ffprobe দিয়ে মিডিয়া রূপান্তর, সংযোজন, ফ্রেম নেওয়া ও আউটপুট যাচাই। |
| [Whisper](https://github.com/openai/whisper), [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [faster-whisper](https://github.com/SYSTRAN/faster-whisper) ও [WhisperKit](https://github.com/argmaxinc/WhisperKit) | Runtime ক্ষমতা অনুযায়ী ক্লাউড ও প্ল্যাটফর্ম-নির্দিষ্ট স্থানীয় কণ্ঠ প্রতিলিপি। |
| [React](https://react.dev/) | Web ও Desktop-এর অভিন্ন ইন্টারফেসের ভিত্তি। |
| [Fastify](https://fastify.dev/) | স্থানীয় Runtime-এর HTTP ও API ভিত্তি। |
| [Electron](https://www.electronjs.org/) | নেটিভ সিস্টেম সুবিধা, অ্যাপ জীবনচক্র ও প্যাকেজিংয়ের Desktop হোস্ট। |
| [SQLite](https://www.sqlite.org/) | প্রকল্প, আলোচনা, Run, সময়সূচি, মেমরি ও অন্য ডেটার স্থানীয় সংরক্ষণ। |
| [Model Context Protocol](https://modelcontextprotocol.io/) | বাইরের টুল ও পরিষেবা Agent কর্মক্ষেত্রে যুক্ত করার উন্মুক্ত প্রোটোকল। |

---

<div align="center">

**OpenCreator · স্থানীয়ভাবে তৈরি করুন, অবিরত কাজ করুন।**

</div>
