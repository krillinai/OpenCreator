<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../images/OpenCreator_logo_vector_dark.svg" />
    <img src="../images/OpenCreator_logo_vector.svg" alt="OpenCreator" width="380" />
  </picture>
  <br />
  रचनाकारों के लिए ओपन-सोर्स AI कार्यक्षेत्र और Skills
</h1>

<p>स्क्रिप्ट, वीडियो, चित्र, आवाज़, अनुवाद और संपादन के लिए दृश्य सेटिंग, दोबारा उपयोग योग्य Skills और Agent को एक ही कार्यक्षेत्र में लाएँ।</p>

<p><strong>OpenCreator का पुराना नाम KrillinAI था।</strong></p>

<a href="https://trendshift.io/repositories/13360" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13360" alt="OpenCreator, पहले KrillinAI: Trendshift पर दिन की शीर्ष रिपॉज़िटरी" width="250" height="55" /></a>

[English](../../README.md) | [简体中文](../zh/README.md) | [日本語](../ja/README.md) | [한국어](../ko/README.md) | [Bahasa Indonesia](../id/README.md) | [Español](../es/README.md) | [Français](../fr/README.md) | [Deutsch](../de/README.md) | [Português](../pt/README.md) | [Русский](../ru/README.md) | [العربية](../ar/README.md) | [ภาษาไทย](../th/README.md) | [Türkçe](../tr/README.md) | **हिन्दी** | [বাংলা](../bn/README.md) | [اردو](../ur/README.md) | [Tiếng Việt](../vi/README.md) | [Filipino](../fil/README.md)

[![GitHub Stars](https://badgen.net/github/stars/krillinai/OpenCreator?icon=github&label=Stars&color=EAB308)](https://github.com/krillinai/OpenCreator/stargazers)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Bilibili](https://img.shields.io/badge/dynamic/json?label=Bilibili&query=%24.data.follower&suffix=%E7%B2%89%E4%B8%9D&url=https%3A%2F%2Fapi.bilibili.com%2Fx%2Frelation%2Fstat%3Fvmid%3D242124650&logo=bilibili&color=00A1D6&labelColor=FE7398&logoColor=FFFFFF)](https://space.bilibili.com/242124650)
[![AtomGit G-Star](https://img.shields.io/badge/AtomGit-G--Star-DA203E?style=flat)](https://atomgit.com/krillinai/OpenCreator)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/fUNvbqDaw)
[![QQ समूह](https://img.shields.io/badge/QQ%20群-754069680-green?logo=tencent-qq)](https://qm.qq.com/q/W4YC0PLMeA)

[विशेषताएँ](#project-highlights) · [रचना उपकरण](#creator-tools) · [Skills](#skills) · [उदाहरण](#examples) · [शुरुआत](#quick-start) · [Desktop](#desktop) · [दस्तावेज़](#documentation) · [समुदाय](#community)

</div>

![OpenCreator Agent कार्यक्षेत्र](../images/opencreator-home-en.png)

<a id="project-overview"></a>

## परियोजना परिचय

OpenCreator उन व्यक्तियों और टीमों के लिए है जो रचनात्मक और विकास कार्य स्थानीय रूप से करना चाहते हैं। Agent लूप को फिर बनाने के बजाय यह Codex CLI को निष्पादन इंजन बनाता है और उसके साथ स्थिर स्थानीय Runtime, दृश्य कार्यक्षेत्र और Desktop होस्ट जोड़ता है।

OpenCreator में काम करने के दो जुड़े तरीके हैं:

- **सामग्री कार्यक्षेत्र**: दृश्य उपकरण और रचना टेम्पलेट से वीडियो अनुवाद और डाउनलोड, चित्र और वीडियो निर्माण, वॉइसओवर, लेख और सोशल पोस्ट, छोटे वीडियो की स्क्रिप्ट और स्टिक-फिगर एनीमेशन बनाएँ।
- **Agent बातचीत**: स्वाभाविक भाषा में रचना या विकास कार्य शुरू करें और दिशा दें; परियोजना के अनुसार बातचीत व्यवस्थित करें, Run को पृष्ठभूमि में चलने दें और अनुमोदन, संलग्नक, फ़ाइलें, Skills, MCP, समय-सारणी, सूचनाएँ, मेमोरी और निदान एक जगह सँभालें।

Web ही एकमात्र फ़्रंटएंड है। Desktop वही Web बिल्ड लोड करता है और फ़ोल्डर चयन, विंडो जीवनचक्र, सिस्टम ट्रे और मूल सूचनाओं जैसी OS-आधारित क्षमताएँ जोड़ता है। समान डेटा और सामग्री व्यूपोर्ट पर दोनों का सामान्य UI और Runtime व्यवहार समान रहता है।

<a id="project-highlights"></a>

## परियोजना की विशेषताएँ

- 🤖 **Codex आधारित**: दूसरा निष्पादन इंजन बनाए बिना Codex Agent लूप, मॉडल, तर्क, टूल कॉल, बातचीत, Skills और MCP दोबारा उपयोग करें।

- 🚀 **तैयार Desktop ऐप**: Codex CLI साथ आता है; स्थानीय Runtime ज़रूरत पर शुरू होकर डिफ़ॉल्ट परियोजना अपने-आप तैयार करता है।

- ⚙️ **मौजूदा Codex सेटअप**: पहली शुरुआत पर स्थानीय Codex कॉन्फ़िगरेशन जाँचकर काम करने वाला ChatGPT साइन-इन या API key दोबारा उपयोग करने का विकल्प मिलता है। दूसरे प्रदाताओं के लिए मार्गदर्शित फ़ॉर्म है।

- 🔄 **Runtime घटक प्रबंधन**: साथ आए, सक्रिय और नवीनतम yt-dlp संस्करण देखें; नियमित जाँच और मैनुअल अपडेट करें। अपडेट विफल होने पर चालू संस्करण उपलब्ध रहता है।

- 🎨 **बहु-माध्यम रचना**: वीडियो, चित्र, ऑडियो, उपशीर्षक और दस्तावेज़ एक जुड़े कार्यप्रवाह में बनाएँ और सँभालें।

- 🧩 **रचना टेम्पलेट**: प्रॉम्प्ट और सेटिंग शुरू से बनाए बिना पुनः उपयोग योग्य टेम्पलेट से चित्र और वीडियो बनाएँ।

- 🔗 **दो कार्य मोड**: दृश्य कार्यक्षेत्र या Agent बातचीत में काम करें; साझा स्टेट मशीन चरण, प्रगति और परिणाम समन्वित रखती है।

- 🕘 **संस्करण प्रबंधन**: हर संशोधन नया संस्करण बनाता है; पुरानी सेटिंग और आउटपुट समीक्षा और तुलना के लिए सुरक्षित रहते हैं।

- 🧩 **पुनः उपयोग योग्य Skills**: वीडियो कार्यप्रवाह Skills उपयोग करें, अपने Skills से Agent बढ़ाएँ और Codex के मूल कॉन्फ़िगरेशन से MCP सँभालें।

- 🧠 **मेमोरी**: वैश्विक, परियोजना और थ्रेड मेमोरी के साथ सारांश और दोहराने योग्य Run इनपुट स्नैपशॉट रखें।

- 🔐 **स्थानीय सुरक्षा**: डेटा, संलग्नक और लॉग डिफ़ॉल्ट रूप से स्थानीय रहते हैं; अनुमोदन और संवेदनशील जानकारी हटाए गए निदान उपलब्ध हैं।

- 🌐 **बहुभाषी इंटरफ़ेस**: Web और Desktop में 43 भाषाएँ, सिस्टम भाषा की पहचान, मैन्युअल चयन और अरबी, फ़ारसी, उर्दू व हिब्रू के लिए दाएँ से बाएँ लेआउट उपलब्ध हैं।

<a id="creator-tools"></a>

## रचना उपकरण

वर्तमान रिलीज़ में दस रचना उपकरण हैं। उपलब्ध मॉडल और सेवाएँ स्थानीय Codex वातावरण और AI सेवा सेटिंग पर निर्भर हैं।

Dashboard खोलकर लेख, Xiaohongshu पोस्ट या छोटे वीडियो की स्क्रिप्ट लिखें; स्टिक-फिगर एनीमेशन बनाएँ; वीडियो अनुवाद या डाउनलोड करें; थंबनेल, चित्र या वीडियो बनाएँ; Text to Speech से वॉइसओवर बनाएँ।

![OpenCreator रचना Dashboard](../images/product/opencreator-dashboard-en.png)

> नए रचना उपकरण लगातार जोड़े जा रहे हैं।

**वीडियो अनुवाद में 123 स्रोत भाषाएँ और पिनयिन आउटपुट सहित 124 लक्ष्य विकल्प हैं।** मूल नाम, अंग्रेज़ी नाम, चीनी नाम या भाषा कोड से खोजें। वाक् पहचान और वाक् संश्लेषण का भाषा समर्थन चुनी गई सेवा और मॉडल पर निर्भर है।

- **केवल उपशीर्षक अनुवाद**: SRT आयात करें, तुरंत पूर्वावलोकन देखें और स्रोत वीडियो, डबिंग या वीडियो रेंडरिंग के बिना अनुवाद करें।

- **उन्नत उपशीर्षक संपादन**: प्लेबैक से जुड़े वेवफ़ॉर्म और टाइमलाइन वाले पूर्ण-स्क्रीन संपादक में समय बदलें, उपशीर्षक विभाजित या जोड़ें और टेक्स्ट खोजें व बदलें। वीडियो पर शैली का पूर्वावलोकन करें, भाषा, आवाज़ और आउटपुट बदलें और पुराने परिणाम रखते हुए नया संस्करण बनाएँ।

- **एक पेज पर निर्माण**: चित्र, वीडियो और Text to Speech की सेटिंग एक पेज पर पूरी करें। मॉडल चयन, संदर्भ पूर्वावलोकन, मॉडल के अनुसार चित्र विकल्प और खोज योग्य आवाज़ संग्रह उपलब्ध हैं।

- **बहुभाषी आउटपुट और प्रगति**: अंतर्निहित वैकल्पिक फ़ॉन्ट जटिल लिपियों और दाएँ से बाएँ उपशीर्षकों का प्रदर्शन सुधारते हैं। लिप्यंतरण, अनुवाद, डबिंग और रेंडरिंग की प्रगति तथा उपलब्ध होने पर पूर्ण और कुल संख्या देखें।

<table width="100%">
<thead>
<tr>
<th width="18%">कार्यक्षेत्र</th>
<th width="14%">स्थिति</th>
<th width="68%">क्षमताएँ</th>
</tr>
</thead>
<tbody>
<tr><td valign="top">वीडियो अनुवाद</td><td valign="top">✅ उपलब्ध</td><td>स्थानीय या सार्वजनिक वीडियो आयात करें; क्लाउड या स्थानीय Whisper से लिप्यंतरण; LLM संदर्भ से उपशीर्षक विभाजन, संरेखण, शब्दावली और अनुवाद; द्विभाषी उपशीर्षक, डबिंग या अपना आवाज़ नमूना, उपशीर्षक शैली, क्षैतिज/ऊर्ध्वाधर संयोजन; SRT, ऑडियो या वीडियो निर्यात</td></tr>
<tr><td valign="top">वीडियो डाउनलोडर</td><td valign="top">✅ उपलब्ध</td><td>YouTube, Bilibili, X, TikTok, Instagram, Douyin, Facebook, Xiaohongshu, Pinterest और Reddit के अलग-अलग सार्वजनिक वीडियो जाँचें; प्रारूप तुलना कर वीडियो या ऑडियो डाउनलोड करें। कुछ स्रोतों को प्लेटफ़ॉर्म कुकी चाहिए। प्लेटफ़ॉर्म पर उपशीर्षक होने पर सूची देखें और SRT डाउनलोड करें; पहले अंग्रेज़ी, फिर उपलब्ध होने पर इंटरफ़ेस की भाषा दिखाई जाती है।</td></tr>
<tr><td valign="top">थंबनेल निर्माण</td><td valign="top">✅ उपलब्ध</td><td>विषय, वीडियो लिंक और वैकल्पिक संदर्भ चित्र से कई थंबनेल बनाएँ और तुलना करें</td></tr>
<tr><td valign="top">चित्र निर्माण</td><td valign="top">✅ उपलब्ध</td><td>प्रॉम्प्ट और वैकल्पिक संदर्भ चित्र से GPT Image / Seedream / Kling Image / Gemini उपयोग करें; अनुपात और संख्या तय करें; हर चित्र देखें और डाउनलोड करें</td></tr>
<tr><td valign="top">लेख लेखन</td><td valign="top">✅ उपलब्ध</td><td>विषय, लिंक, वीडियो या स्रोत दस्तावेज़ से संपादन योग्य विषय विकल्प, रूपरेखा और पूरा लेख बनाएँ; बनाए गए चित्र जोड़ें और Markdown, HTML या PDF निर्यात करें</td></tr>
<tr><td valign="top">Xiaohongshu पोस्ट</td><td valign="top">✅ उपलब्ध</td><td>विषय या स्रोत सामग्री से पूरा पोस्ट बनाएँ; पाठक, पोस्ट प्रकार और लंबाई तय करें; परिणाम कॉपी या डाउनलोड करें</td></tr>
<tr><td valign="top">छोटे वीडियो की स्क्रिप्ट</td><td valign="top">✅ उपलब्ध</td><td>विषय या सामग्री से दर्शक, प्लेटफ़ॉर्म, अवधि और लहजे के अनुसार शूटिंग के लिए तैयार खंडित स्क्रिप्ट बनाएँ; संपादित, कॉपी या डाउनलोड करें</td></tr>
<tr><td valign="top">स्टिक-फिगर एनीमेशन</td><td valign="top">✅ उपलब्ध</td><td>पाठ या YouTube सामग्री से कथन, आवाज़, एकसमान पात्रों वाले स्टोरीबोर्ड, उपशीर्षक और डाउनलोड योग्य एनीमेशन बनाएँ</td></tr>
<tr><td valign="top">स्वचालित क्लिप</td><td valign="top">विकासाधीन</td><td>लंबे वीडियो जाँचें, मुख्य अंश ढूँढें और चुने क्षणों को दोबारा उपयोग योग्य छोटे क्लिप में बदलें</td></tr>
<tr><td valign="top">Text to Speech</td><td valign="top">✅ उपलब्ध</td><td>स्क्रिप्ट से वॉइसओवर बनाएँ; आवाज़, गति और भाव चुनें</td></tr>
<tr><td valign="top">वीडियो निर्माण</td><td valign="top">✅ उपलब्ध</td><td>प्रॉम्प्ट और संदर्भ चित्र से Seedance / Kling / Veo वीडियो बनाएँ; हर संस्करण देखें, दोबारा बनाएँ और डाउनलोड करें</td></tr>
<tr><td valign="top">डिजिटल अवतार</td><td valign="top">विकासाधीन</td><td>स्क्रिप्ट, आवाज़ और अवतार से बोलते व्यक्ति वाले वीडियो बनाएँ</td></tr>
</tbody>
</table>

<a id="creation-templates"></a>

## रचना टेम्पलेट

हर प्रॉम्प्ट और सेटिंग शुरू से बनाने के बजाय टेम्पलेट से शुरुआत करें। वीडियो निर्माण और चित्र डिज़ाइन सहित श्रेणियों में चुनिंदा टेम्पलेट खोजें।

संग्रह में OpenCreator और स्वतंत्र रचनाकारों के टेम्पलेट हैं। तृतीय-पक्ष टेम्पलेट के विवरण में रचनाकार का श्रेय और मूल स्रोत का लिंक मिलता है।

टेम्पलेट खोलकर उदाहरण परिणाम, प्रॉम्प्ट, सेटिंग, टैग, लेखक और मूल स्रोत देखें। **Use this template** चुनें, फिर अपने काम के अनुसार इनपुट बदलें।

![उदाहरण, सेटिंग और प्रॉम्प्ट सहित चित्र टेम्पलेट](../images/product/creation-templates-detail-apex-summit-en.png)

<a id="skills"></a>

## Skills

रचना उपकरण दृश्य नियंत्रण देते हैं; Skills, Agent को पुनः उपयोग योग्य निर्देश और टूल कार्यप्रवाह देते हैं। रिपॉज़िटरी में वीडियो निर्माण Skills और स्थानीय Codex Skills प्रबंधन का समर्थन है।

[`skills/`](../../skills/) में एम्बेडेड KrillinAI CLI चलाने वाले Agent के लिए पुनः उपयोग योग्य निर्देश हैं।

| Skill | क्षमताएँ |
| --- | --- |
| [KrillinAI CLI](../../skills/krillinai-cli/SKILL.md) | कमांड चुनें, कॉन्फ़िगरेशन जाँचें और प्रगति, मैनिफ़ेस्ट, आउटपुट व त्रुटियाँ समझें |
| [उपशीर्षक](../../skills/krillinai-subtitle/SKILL.md) | प्लेटफ़ॉर्म कैप्शन डाउनलोड या मीडिया लिप्यंतरण करें; अनुवाद और द्विभाषी या ऊर्ध्वाधर वीडियो के छोटे उपशीर्षक बनाएँ |
| [TTS](../../skills/krillinai-tts/SKILL.md) | उपशीर्षक से लक्ष्य भाषा की डबिंग और वैकल्पिक डब किया वीडियो बनाएँ |
| [क्षैतिज रेंडर](../../skills/krillinai-render-horizontal/SKILL.md) | द्विभाषी उपशीर्षक या डब ऑडियो और लक्ष्य भाषा उपशीर्षक वाले क्षैतिज वीडियो रेंडर करें |
| [ऊर्ध्वाधर रेंडर](../../skills/krillinai-render-vertical/SKILL.md) | शीर्षक, द्विभाषी उपशीर्षक या डबिंग वाले ऊर्ध्वाधर वीडियो बनाएँ |
| [कवर](../../skills/krillinai-cover/SKILL.md) | पूरे पाठ प्रॉम्प्ट से कवर बनाएँ और चित्र व अंतिम प्रॉम्प्ट सहेजें |
| [पाइपलाइन योजना](../../skills/krillinai-pipeline/SKILL.md) | बहु-चरण आउटपुट योजना का dry-run सत्यापन करें; वास्तविक काम अलग-अलग चरणों के Skills से करें |

<a id="extend-with-your-own-skills"></a>

### अपने Skills से विस्तार

OpenCreator, `SKILL.md` से परिभाषित स्थानीय Codex Skills का समर्थन करता है, ताकि आप अपने तरीके और कार्यप्रवाह जोड़ सकें। उपलब्धता सक्रिय Codex home और स्थापित Skills पर निर्भर है; वीडियो Skills के लिए CLI और संबंधित सेवाओं का सेटअप चाहिए। रिपॉज़िटरी में होना सभी Skills के स्वतः स्थापित होने या बाहरी सेवाओं के साथ आने की गारंटी नहीं है।

<a id="conversation-and-workspace-moving-together"></a>

## बातचीत और कार्यक्षेत्र साथ-साथ

काम स्वाभाविक भाषा में बताएँ और सटीक नियंत्रण के लिए दृश्य उपकरण खोलें।

![OpenCreator बातचीत और दृश्य कार्यक्षेत्र का समन्वय](../images/examples/opencreator-auto-clips-en.png)

<a id="fine-grained-workspace-controls"></a>

### सूक्ष्म दृश्य नियंत्रण

उपशीर्षक, शॉट, ऑडियो और निर्माण सेटिंग सटीक ढंग से बदलें।

<a id="flexible-conversational-edits"></a>

### बातचीत से संपादन

Agent को बदलाव बताएँ और स्वाभाविक भाषा से परिणाम सुधारें।

<a id="synchronized-state"></a>

### समन्वित स्थिति

बातचीत और कार्यक्षेत्र में एक ही कार्य स्थिति रहती है; जानकारी दोहरानी नहीं पड़ती।

<a id="independent-versions"></a>

### स्वतंत्र संस्करण

हर संशोधन अलग संस्करण बनाता है; पुराने परिणाम और सेटिंग नहीं मिटते।

<a id="models-supported"></a>

## समर्थित मॉडल

भाषा मॉडल Codex सूची या आपके OpenAI-संगत प्रदाता से मिलते हैं। चित्र, वीडियो, आवाज़ और लिप्यंतरण मॉडल **Settings → AI Services** में तय सेवाओं का उपयोग करते हैं।

दिखाए गए प्रदाता और मॉडल उदाहरण हैं; वास्तविक उपलब्धता क्रेडेंशियल, खाते की पहुँच और प्लेटफ़ॉर्म पर निर्भर है।

<a id="language-models"></a>

### भाषा मॉडल

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

### चित्र

<table>
<tr>
<td align="center" width="25%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>GPT Image</strong></td>
<td align="center" width="25%"><img src="../images/models/jimeng.png" alt="Jimeng" width="40" height="40" /><br /><strong>Seedream 4.0</strong><br />Jimeng</td>
<td align="center" width="25%"><img src="../images/models/kling.png" alt="Kling" width="40" height="40" /><br /><strong>Kling v2.1</strong><br />Kling Image</td>
<td align="center" width="25%"><img src="../images/models/gemini.png" alt="Gemini" width="40" height="40" /><br /><strong>Nano Banana</strong><br />Gemini 2.5 Flash Image</td>
</tr>
</table>

<a id="video"></a>

### वीडियो

<table>
<tr>
<td align="center" width="33%"><img src="../images/models/seedance.png" alt="Seedance" width="40" height="40" /><br /><strong>Seedance 2.5</strong></td>
<td align="center" width="33%"><img src="../images/models/kling.png" alt="Kling" width="40" height="40" /><br /><strong>Kling v2.1 Master</strong></td>
<td align="center" width="33%"><img src="../images/models/gemini.png" alt="Gemini" width="40" height="40" /><br /><strong>Veo 3.1</strong></td>
</tr>
</table>

<a id="voice-and-transcription"></a>

### आवाज़ और लिप्यंतरण

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

उपलब्ध होने पर स्थानीय लिप्यंतरण में faster-whisper, WhisperKit और whisper.cpp भी समर्थित हैं।

<a id="examples"></a>

## उदाहरण

<a id="video-translation"></a>

### वीडियो अनुवाद

नीचे के सार्वजनिक उदाहरण तब बने थे जब OpenCreator का नाम KrillinAI था। इनमें उपशीर्षक संरेखण, अनुवाद, डबिंग और ऊर्ध्वाधर वीडियो का स्थापित कार्यप्रवाह दिखता है, जिसे अब Video Translation कार्यक्षेत्र व्यापक Agent कार्यप्रवाह में लाता है।

नीचे की उपशीर्षक फ़ाइल 46 मिनट के स्थानीय वीडियो से एक Run में बनी, बिना मैनुअल बदलाव। प्रकाशित परिणाम में पूरा कवरेज, बिना ओवरलैप वाली पंक्तियाँ, स्वाभाविक विभाजन और गुणवत्तापूर्ण अनुवाद है।

![OpenCreator उपशीर्षक संरेखण उदाहरण](../images/examples/krillinai-subtitle-alignment.png)

<table width="100%">
<tr>
<td width="33%">

<a id="subtitle-translation"></a>

#### उपशीर्षक अनुवाद

https://github.com/user-attachments/assets/bba1ac0a-fe6b-4947-b58d-ba99306d0339

</td>
<td width="33%">

<a id="dubbing"></a>

#### डबिंग

https://github.com/user-attachments/assets/0b32fad3-c3ad-4b6a-abf0-0865f0dd2385

</td>
<td width="33%">

<a id="portrait-mode"></a>

#### ऊर्ध्वाधर मोड

https://github.com/user-attachments/assets/c2c7b528-0ef8-4ba9-b8ac-f9f92f6d4e71

</td>
</tr>
</table>

> ये वीडियो उदाहरण और उपशीर्षक संरेखण चित्र KrillinAI नाम के समय बनाए गए थे।

<a id="video-downloader"></a>

### वीडियो डाउनलोडर

10 समर्थित प्लेटफ़ॉर्म के सार्वजनिक वीडियो लिंक जाँचें, प्रारूप तुलना करें और सीधे परियोजना में वीडियो या ऑडियो डाउनलोड करें।

समर्थित वीडियो स्रोत:

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

उपलब्धता वीडियो और क्षेत्र के अनुसार बदलती है; कुछ स्रोतों को प्लेटफ़ॉर्म कुकी चाहिए।

![OpenCreator वीडियो डाउनलोडर प्रारूप चयन](../images/examples/video-downloader-formats-and-subtitles-en.png)

<a id="video-generation"></a>

### वीडियो निर्माण

Seedance से पाठ प्रॉम्प्ट या संदर्भ चित्र के आधार पर AI वीडियो बनाएँ। मॉडल, अनुपात, रिज़ॉल्यूशन और अवधि तय करें; परियोजना कार्यक्षेत्र में हर संस्करण देखें, दोबारा बनाएँ या डाउनलोड करें।

![Seedance से OpenCreator वीडियो निर्माण](../images/examples/video-generation-seedance-en.png)

<a id="stick-figure-animation"></a>

### स्टिक-फिगर एनीमेशन

OpenCreator ने यह मूल पात्र संग्रह कलाकार [Harbor Hsia](https://www.behance.net/xiaheyuan1), [Behance पर Stickman](https://www.behance.net/gallery/254715463/Stickman) के रचनाकार, के साथ बनाया। अंतर्निहित पात्र पूरे एनीमेशन कार्यप्रवाह में अपनी पहचान बनाए रखते हैं।

![कलाकार के सहयोग से बने OpenCreator स्टिक-फिगर पात्र](../images/examples/stick-figure-characters.webp)

स्क्रिप्ट समीक्षा, कथन, समय-निर्धारण, स्टोरीबोर्ड, उपशीर्षक और रेंडरिंग के मार्गदर्शित कार्यप्रवाह से पाठ या YouTube सामग्री को पूर्ण, डाउनलोड योग्य एनीमेशन में बदलें।

![OpenCreator स्टिक-फिगर एनीमेशन का फ़्रेम](../images/examples/stick-figure-animation-frame.jpg)

<a id="quick-start"></a>

## त्वरित शुरुआत

<a id="install-the-desktop-app"></a>

### Desktop ऐप स्थापित करें

[नवीनतम OpenCreator रिलीज़](https://github.com/krillinai/OpenCreator/releases/latest) से macOS Apple Silicon, macOS Intel या Windows x64 का इंस्टॉलर डाउनलोड करें। ऐप स्थापित करके खोलें; Node.js या pnpm नहीं चाहिए। Codex CLI साथ आता है; वास्तविक मॉडल कार्यों के लिए काम करने वाला ChatGPT साइन-इन या API key सेटअप चाहिए।

पहली शुरुआत पर Desktop स्थानीय Runtime और डिफ़ॉल्ट परियोजना तैयार कर Codex कॉन्फ़िगरेशन जाँचता है। उपयोग योग्य साइन-इन या API key और मॉडल सेटिंग मिलने पर **Use local Codex and continue** चुनें। इसी प्रक्रिया में अन्य प्रदाता भी सेट कर सकते हैं:

![Desktop की पहली शुरुआत पर मॉडल प्रदाता सेटअप](../images/product/opencreator-codex-setup.png)

सेटअप के बाद इनपुट बॉक्स में अनुरोध लिखें। समस्या होने पर [उपयोगकर्ता मार्गदर्शिका और समस्या समाधान](../opencreator-user-guide-and-troubleshooting.md) देखें।

<a id="run-web-from-source"></a>

### स्रोत से Web चलाएँ

विकास या ब्राउज़र उपयोग के लिए स्थापित करें:

- Node.js 22 या नया
- pnpm 9.15.0, रिपॉज़िटरी के `packageManager` में निर्धारित
- टर्मिनल से उपलब्ध Codex CLI निष्पादन योग्य फ़ाइल
- वास्तविक मॉडल कार्यों के लिए वैध Codex CLI लॉगिन

पहले स्थानीय वातावरण जाँचें:

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

`http://127.0.0.1:19861/` खोलें। विकास सर्वर ज़रूरत पर स्थानीय daemon शुरू करके समान-ऑरिजिन प्रॉक्सी से अस्थायी Runtime टोकन जोड़ता है; टोकन मैनुअल कॉपी नहीं करना पड़ता।

पहली शुरुआत में Runtime डिफ़ॉल्ट परियोजना बनाकर स्थानीय Codex सेटिंग जाँचता है। ChatGPT साइन-इन या API key की पुष्टि करें, या प्रदाता चुनकर मॉडल, endpoint और API key भरें। सेटअप के बाद इनपुट बॉक्स तैयार है। केवल daemon पर काम करने के लिए:

```bash
pnpm daemon:dev
```

daemon केवल लूपबैक पते पर सुनता है और कनेक्शन पता व अस्थायी टोकन stdout पर एक बार दिखाता है।

<a id="desktop"></a>

## Desktop

Desktop और ब्राउज़र `apps/web` का एक ही React फ़्रंटएंड उपयोग करते हैं। परियोजना, बातचीत, कार्य और सेटिंग समान Daemon/API से चलते हैं। Electron केवल वास्तविक सिस्टम पथ, विंडो नियंत्रण, ट्रे और मूल सूचनाएँ जोड़ता है।

<a id="development-mode"></a>

### विकास मोड

```bash
pnpm desktop:dev
```

<a id="local-packaging"></a>

### स्थानीय पैकेजिंग

| कमांड | आउटपुट |
| --- | --- |
| `pnpm desktop:package` | स्थानीय सत्यापन के लिए वर्तमान प्लेटफ़ॉर्म पर चलने योग्य फ़ोल्डर |
| `pnpm desktop:dist` | वर्तमान प्लेटफ़ॉर्म का इंस्टॉलर |
| `pnpm desktop:release` | औपचारिक रिलीज़ पैकेजिंग का प्रवेश बिंदु |
| `pnpm --filter @opencreator/desktop verify:package` | मौजूदा Desktop पैकेज का सत्यापन |
| `pnpm krillinai:package` | चुने प्लेटफ़ॉर्म के अलग KrillinAI Server और CLI आर्काइव |

Desktop पैकेजिंग वर्तमान कार्यक्षेत्र से Web दोबारा बनाती है; commit, कमिट न किए गए बदलाव, प्लेटफ़ॉर्म, आर्किटेक्चर और Web hash दर्ज करती है; `apps/web/dist` को ऐप में एम्बेड संसाधनों से मिलाती है। अंतर होने पर पैकेजिंग विफल होती है। हस्ताक्षर, notarization, Windows बिल्ड और रिलीज़ शर्तों के लिए [Desktop रिलीज़ प्रक्रिया](../operations/opencreator-desktop-release-runbook.md) देखें।

<a id="core-workflows"></a>

## मुख्य कार्यप्रवाह

<a id="conversations-and-runs"></a>

### बातचीत और Run

1. परियोजना चुनें या नई बातचीत शुरू करें।
2. कार्य लिखें; अनुमति स्तर, Profile, मॉडल और तर्क-प्रयास चुनें।
3. सक्रिय Run के दौरान अगले कार्य कतार में रखें या रोककर तुरंत आगे बढ़ें।
4. Timeline में तर्क सारांश, टूल कॉल, फ़ाइल बदलाव, अनुमोदन और अंतिम परिणाम देखें।
5. कार्य केंद्र में सभी चल रहे, पूर्ण, विफल और अनुमोदन की प्रतीक्षा वाले कार्य देखें।

<a id="skills-and-mcp"></a>

### Skills और MCP

- प्लगइन केंद्र में Skill बाज़ार, स्थापना इतिहास और स्थानीय Skills देखें।
- इनपुट बॉक्स में `/` या जोड़ने के मेनू से Skill चुनें ताकि अगला कार्य उसका कार्यप्रवाह अपनाए।
- MCP प्रबंधन Codex के मूल कमांड और कॉन्फ़िगरेशन से होता है; अलग निष्पादन इंजन नहीं है।
- डिफ़ॉल्ट में सक्रिय `$CODEX_HOME` उपयोग होता है; वैश्विक Skills या MCP बदलने से पहले असर जाँचें।

<a id="schedules-and-dedicated-task-threads"></a>

### समय-सारणी और समर्पित कार्य थ्रेड

- हर समय-सारणी की स्थायी, समर्पित OpenCreator बातचीत होती है।
- स्वचालित ट्रिगर, मैनुअल Run और आगे के अनुरोध उसी बातचीत में `queue` या `skip` नीति से क्रम में चलते हैं।
- समय-सारणी मिटाने पर उसकी बातचीत संग्रहित होती है; पुराने Run, परिणाम और Codex इतिहास सुरक्षित रहते हैं।
- अंतर्निहित Codex थ्रेड बदलने या बहाल करने से OpenCreator कार्य प्रविष्टि या पेज रूट नहीं बदलता।

<a id="opencreator-system-architecture"></a>

## OpenCreator सिस्टम संरचना

दृश्य कार्यक्षेत्र और Agent बातचीत एक ही रचनात्मक कार्य के दो इंटरफ़ेस हैं। हर कार्यप्रवाह स्टेट मशीन है: स्रोत इनपुट, कॉन्फ़िगरेशन, निर्माण, समीक्षा, संशोधन और निर्यात स्पष्ट स्थिति और घटनाएँ बनते हैं। दृश्य क्रियाएँ और बातचीत के आदेश उसी मशीन में जाते हैं; वर्तमान चरण, सेटिंग, प्रगति, संस्करण और परिणाम दोनों इंटरफ़ेस पर लौटते हैं। इससे एक ही प्रामाणिक स्थिति पर समन्वय बना रहता है।

रचनात्मक काम में पुनरावृत्ति होती है। हर सुधार या दोबारा निर्माण वर्तमान कार्यप्रवाह से नया संस्करण बनाता है; पुराने परिणाम नहीं मिटते। उनकी सेटिंग और आउटपुट समीक्षा, तुलना और आगे सुधार के लिए सुरक्षित रहते हैं।

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

| OpenCreator घटक | ज़िम्मेदारी | कार्यान्वयन |
| --- | --- | --- |
| रचना अनुभव | Dashboard, रचना उपकरण, Agent बातचीत, सेटिंग और फ़ाइलें | `apps/web` · React 18 · Vite · TypeScript |
| सहयोग केंद्र | कार्यक्षेत्र चरण, संदर्भ, प्रगति, परिणाम और संशोधन समन्वित रखना | साझा कार्यप्रवाह स्थिति · `CreatorCollaborationPanel` · संस्करण इतिहास |
| स्थानीय Runtime | परियोजना, Run, अनुमोदन, समय-सारणी, मेमोरी और सूचनाएँ | `apps/daemon` · Fastify · Runtime API · SSE |
| Runtime घटक | साथ आए, सक्रिय और नवीनतम संस्करण देखें; नियमित जाँच; केवल अनुरोधित अपडेट स्थापित करें | yt-dlp nightly · अपडेट सत्यापन · चालू संस्करण पर वापसी |
| Codex इंजन | Agent लूप, सत्र, तर्क, उपकरण, Skills और MCP | Codex CLI · app-server |
| मीडिया टूलचेन | मीडिया डाउनलोड, लिप्यंतरण, रूपांतरण, निर्माण और निर्यात | yt-dlp · Whisper · FFmpeg · कॉन्फ़िगर की गई AI सेवाएँ |
| स्थानीय डेटा | परियोजना, Run, संलग्नक, आउटपुट और क्रेडेंशियल स्थानीय रखना | SQLite · फ़ाइल सिस्टम · सिस्टम क्रेडेंशियल भंडार |
| Desktop होस्ट | साझा Web बिल्ड लोड करना और OS क्षमताएँ जोड़ना | `apps/desktop` · Electron · Preload Bridge |

मुख्य सिद्धांत:

- कार्यक्षेत्र और Agent बातचीत समान कार्यप्रवाह स्थिति दिखाते और उसी स्टेट मशीन में घटनाएँ भेजते हैं।
- संशोधन नया संस्करण बनाते हैं; हर रचनात्मक चरण का संदर्भ और आउटपुट सुरक्षित रहता है।
- फ़्रंटएंड Codex सीधे शुरू नहीं करता और कच्चे Codex JSONL इवेंट प्रारूप पर निर्भर नहीं है।
- daemon प्रक्रिया जीवनचक्र, इवेंट सामान्यीकरण, स्थायी भंडारण, अनुमोदन, समय-सारणी और सूचना आउटबॉक्स सँभालता है।
- Agent लूप, Skills और MCP के निष्पादन का प्रामाणिक स्रोत Codex है।
- Browser Bridge और Desktop Bridge में सामान्य उत्पाद तर्क की अलग प्रतियाँ नहीं हैं।

<a id="repository-layout"></a>

## रिपॉज़िटरी संरचना

```text
OpenCreator/
├── apps/
│   ├── web/          # एकमात्र React फ़्रंटएंड
│   ├── daemon/       # स्थानीय Fastify Runtime और Codex एडाप्टर
│   ├── desktop/      # Electron Main, Preload, मूल क्षमताएँ और पैकेजिंग
│   └── harness/      # Runtime कमांड-लाइन सत्यापन उपकरण
├── packages/
│   ├── protocol/     # Web, Daemon और Desktop के साझा Runtime अनुबंध
│   └── skill-market/ # Skill बाज़ार मॉडल और साझा तर्क
├── docs/             # डिज़ाइन दस्तावेज़, API संदर्भ, संचालन प्रक्रिया और परीक्षण रिपोर्ट
├── scripts/          # रिपॉज़िटरी स्तर की जाँच
└── .runtime/         # स्थानीय Runtime डेटा; पहली शुरुआत पर बनता है
```

<a id="configuration"></a>

## कॉन्फ़िगरेशन

<a id="ai-service-api-keys"></a>

### AI सेवा API key

**Settings → AI Services** में वर्तमान कार्यक्षेत्र के मॉडल, लिप्यंतरण, आवाज़ और चित्र प्रदाता सेट करें। आने वाले उपकरणों के लिए अतिरिक्त श्रेणियाँ दिख सकती हैं। हर श्रेणी चुने प्रदाता के आवश्यक फ़ील्ड ही दिखाती है: Base URL, API Key, मॉडल, प्रॉक्सी या विशेष क्रेडेंशियल।

![OpenCreator AI सेवा API key सेटिंग](../images/product/opencreator-ai-services-en.png)

क्रेडेंशियल स्थानीय Runtime के सिस्टम क्रेडेंशियल भंडार में सहेजे जाते हैं; इन्हें कभी रिपॉज़िटरी में commit न करें। Edge TTS जैसी कुछ स्थानीय या सिस्टम-आधारित सेवाओं को API Key नहीं चाहिए।

<a id="account-and-subscriptions"></a>

### खाता और सदस्यता

व्यक्तिगत केंद्र में खाता, पुष्ट सदस्यता और उपलब्ध क्रेडिट दिखते हैं। साइन-इन से ब्राउज़र में `https://www.open-creator.ai/device` खुलता है। वेबसाइट पर लॉगिन करके डिवाइस मंज़ूर करें; स्थानीय Daemon को अपना सत्र मिलता है। ब्राउज़र और ऐप का खाता समान, सत्र अलग हैं।




सदस्यता योजना OpenCreator में चुनें। खरीद से Stripe Checkout और प्रबंधन से Stripe Billing Portal खुलता है। भुगतान के बाद वापसी वेबसाइट के `/billing/return` पेज से होती है, जिसके लिए वेबसाइट सत्र नहीं चाहिए। सत्यापित Stripe सूचना के बाद OpenCreator, Gateway से लाभ अपडेट करता है। `/pricing` और `/account` पेज भी उसी सदस्यता बैकएंड में खरीद का मार्ग देते हैं।






<a id="third-party-runtime-components"></a>

### तृतीय-पक्ष Runtime घटक

**Settings → Third-party Components** में सक्रिय yt-dlp nightly, ऐप के साथ आए संस्करण, स्रोत और नवीनतम रिलीज़ देखें। OpenCreator हर सात दिन जाँचता है, अपने-आप स्थापित नहीं करता। अपडेट उपयोगकर्ता की स्पष्ट कार्रवाई से होता है; डाउनलोड, सत्यापन या स्थापना विफल होने पर चालू संस्करण उपलब्ध रहता है।

![OpenCreator तृतीय-पक्ष घटक सेटिंग](../images/product/opencreator-third-party-components-en.png)

<a id="runtime-environment-variables"></a>

### Runtime वातावरण चर

अधिकांश उपयोगकर्ताओं को वातावरण चर नहीं चाहिए। अलग डेटा, विशेष Codex फ़ाइल या कस्टम प्रबंधित-परियोजना फ़ोल्डर के लिए उपयोग करें:

| वातावरण चर | डिफ़ॉल्ट | उद्देश्य |
| --- | --- | --- |
| `OPENCREATOR_DATA_DIR` | `.runtime` | OpenCreator डेटाबेस, Run, संलग्नक और प्रबंधित कार्यक्षेत्र |
| `OPENCREATOR_GATEWAY_ORIGIN` | `https://www.open-creator.ai` | लॉगिन, सदस्यता, क्रेडिट और आधिकारिक मॉडल सेवाओं का Gateway; स्थानीय Gateway के लिए बदलें |
| `OPENCREATOR_CODEX_BIN` | `codex` | Codex CLI निष्पादन योग्य फ़ाइल का पथ |
| `CODEX_HOME` | `~/.codex` | Codex सत्र, कॉन्फ़िगरेशन, Skills, MCP और Profiles का प्रामाणिक स्रोत |
| `OPENCREATOR_DEFAULT_CWD` | वर्तमान कार्य फ़ोल्डर | daemon का डिफ़ॉल्ट कार्य फ़ोल्डर |
| `OPENCREATOR_DEFAULT_PROJECT_ROOT` | Runtime की डिफ़ॉल्ट नीति | प्रबंधित परियोजनाओं का मूल फ़ोल्डर; सेट होने पर उसका `OpenCreator/` उपफ़ोल्डर उपयोग होता है |
| `OPENCREATOR_CODEX_THREAD_ROTATION_RUN_THRESHOLD` | `50` | लंबी समय-सारणी में Codex थ्रेड बदलने की पूर्ण Run सीमा; `0` से सक्रिय रोटेशन बंद |

उदाहरण: Runtime डेटा और Codex वातावरण अलग रखें:

```bash
OPENCREATOR_DATA_DIR=/path/to/opencreator-data \
CODEX_HOME=/path/to/codex-home \
pnpm web:dev
```

<a id="data-and-security"></a>

## डेटा और सुरक्षा

डिफ़ॉल्ट में Runtime डेटा रिपॉज़िटरी के मूल `.runtime/` में रहता है:

| पथ | सामग्री |
| --- | --- |
| `.runtime/app.sqlite` | परियोजना, थ्रेड, Run, इवेंट, समय-सारणी, सूचनाएँ, संलग्नक मेटाडेटा, अनुमोदन, मेमोरी और सारांश |
| `.runtime/runs/` | हर Run के संवेदनशील जानकारी हटाए गए लॉग, निदान और मेटाडेटा |
| `.runtime/attachments/` | नियंत्रित संलग्नक फ़ाइलें |
| `.runtime/workspaces/` | Runtime-प्रबंधित परियोजना कार्यक्षेत्र |

Codex सत्र और कॉन्फ़िगरेशन `$CODEX_HOME` में रहते हैं; `.runtime/` से अलग बैकअप लें।

सुरक्षा सीमाएँ:

- daemon केवल `127.0.0.1` पर सुनता है; स्वास्थ्य जाँच के अलावा हर API को Bearer टोकन चाहिए।
- HTML पूर्वावलोकन में डिफ़ॉल्ट रूप से स्क्रिप्ट, नेविगेशन और पॉपअप बंद हैं; केवल उसी कार्यक्षेत्र के नियंत्रित सापेक्ष संसाधन अनुमत हैं।
- संवेदनशील मेमोरी के लिए दूसरी पुष्टि चाहिए। बिना पुष्टि के सुझाव स्थायी रूप से अपने-आप नहीं सहेजे जाते।
- निदान और Run लॉग लौटाने या निर्यात से पहले संवेदनशील जानकारी हटाई जाती है।
- Desktop पैकेज में ASAR अखंडता और कुकी एन्क्रिप्शन चालू; RunAsNode, `NODE_OPTIONS` और Node CLI Inspector बंद रहते हैं।

बैकअप, बहाली, सफ़ाई और रीसेट की पूरी प्रक्रिया [उपयोगकर्ता मार्गदर्शिका](../opencreator-user-guide-and-troubleshooting.md) में है।

<a id="development"></a>

## विकास

<a id="common-commands"></a>

### सामान्य कमांड

| कमांड | उद्देश्य |
| --- | --- |
| `pnpm web:dev` | Web शुरू करें और ज़रूरत पर स्थानीय daemon चलाएँ |
| `pnpm daemon:dev` | केवल daemon शुरू करें |
| `pnpm desktop:dev` | निर्भरताएँ बिल्ड करके विकास मोड में Electron चलाएँ |
| `pnpm test` | कार्यक्षेत्र इकाई और एकीकरण परीक्षण |
| `pnpm typecheck` | पूरी रिपॉज़िटरी की TypeScript जाँच |
| `pnpm build` | सभी कार्यक्षेत्र बिल्ड करें |
| `pnpm e2e` | Web Playwright E2E परीक्षण |
| `pnpm smoke:ci` | नकली Codex से Runtime smoke test |
| `pnpm perf:check` | दर्ज प्रदर्शन आधाररेखा जाँचें |

बदलाव भेजने से पहले उसके प्रभाव के अनुसार [योगदान मार्गदर्शिका](../../CONTRIBUTING.md#what-reviewers-check) के परीक्षण चुनें। दस्तावेज़, शब्द और शैली के लिए संबंधित जाँच पर्याप्त हैं; साझा व्यवहार और Runtime के लिए लक्षित मॉड्यूल परीक्षण और typecheck चाहिए। प्रभाव-क्षेत्र की माँग पर पूरे परीक्षण या बिल्ड चलाएँ और PR में किए परीक्षण लिखें।

Desktop, Host Bridge, Runtime प्रॉक्सी या साझा फ़्रंटएंड कार्यप्रवाह के बदलाव के लिए Web/Desktop समानता परीक्षण, पैकेज ऐप E2E और Web बिल्ड hash सत्यापन भी चाहिए। केवल Web इकाई परीक्षण Desktop रिलीज़ की तैयारी सिद्ध नहीं करता।

वास्तविक Codex smoke test डिफ़ॉल्ट में बंद है। इसे स्पष्ट रूप से चालू करें:

```bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

<a id="documentation"></a>

## दस्तावेज़

- **उपयोग:** [त्वरित शुरुआत](#quick-start) · [मार्गदर्शिका और समस्या समाधान](../opencreator-user-guide-and-troubleshooting.md)
- **विकास और विस्तार:** [योगदान](../../CONTRIBUTING.md) · [आचार संहिता](../../CODE_OF_CONDUCT.md) · [Skill योगदान](../contributing/skills-contributing.md) · [टेम्पलेट योगदान](../contributing/templates-contributing.md) · [Runtime API v1](../runtime-api-for-ui-v1.md) · [दृश्य घटक निर्देश](../visual-component-guidelines.md)
- **रखरखाव और रिलीज़:** [Codex आधारित Runtime डिज़ाइन](../2026-07-03-codex-native-agent-runtime-design.md) · [Desktop रिलीज़ प्रक्रिया](../operations/opencreator-desktop-release-runbook.md) · [Windows Desktop रिलीज़](../operations/opencreator-desktop-windows-release.md)

<a id="translation-convention"></a>

## अनुवाद नियम

मूल `README.md` प्रामाणिक अंग्रेज़ी दस्तावेज़ है। अनुवाद `docs/<locale>/README.md` में रखे जाते हैं। पूरा दस्तावेज़ अनूदित और अंग्रेज़ी संरचना से समन्वित होने पर ही भाषा चयन में जोड़ें।

<a id="community"></a>

## समुदाय

<p><strong>कम-से-कम 107 देशों और क्षेत्रों</strong> के GitHub उपयोगकर्ताओं ने OpenCreator को स्टार दिया है।</p>

<img src="../images/star-coverage-map.svg" alt="OpenCreator को GitHub स्टार देने वाले देशों और क्षेत्रों का मानचित्र" width="760" />

<a id="the-crew"></a>

### ज़िम्मेदार टीम

हर सदस्य अपने क्षेत्र के मानक, योगदान समीक्षा और मर्ज तथा समुदाय सहायता का ज़िम्मेदार है।

<table border="1" cellpadding="12">
  <tr>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/wulien.svg" width="64" height="64" alt="wulien avatar" /><br /><a href="https://github.com/wulien">wulien</a><br />कोड और त्रुटि सुधार</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/dle-kb.svg" width="64" height="64" alt="DLe-kb avatar" /><br /><a href="https://github.com/DLe-kb">DLe-kb</a><br />रचना टेम्पलेट</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/xiaheyuan.svg" width="64" height="64" alt="xiaheyuan avatar" /><br /><a href="https://github.com/xiaheyuan">xiaheyuan</a><br />डिज़ाइन और संसाधन</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/krillinai.svg" width="64" height="64" alt="krillinai avatar" /><br /><a href="https://github.com/krillinai">krillinai</a><br />Skills और दस्तावेज़</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/hbxugang.svg" width="64" height="64" alt="hbxugang avatar" /><br /><a href="https://github.com/hbxugang">hbxugang</a><br />एंटरप्राइज़ परिनियोजन</td>
  </tr>
</table>

<a id="contributors"></a>

### योगदानकर्ता

कोड, दस्तावेज़, प्रतिक्रिया, समस्या रिपोर्ट, Skills, चित्रण और विचारों से योगदान देने वाले सभी लोगों का धन्यवाद।
README की यह सूची GitHub के स्वतः बने Contributors ग्राफ़ से अलग रखी जाती है।

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

### योगदान

इन क्षेत्रों में योगदान का स्वागत है:

| प्रकार | योगदान | स्थान | आकार |
| --- | --- | --- | --- |
| कोड | त्रुटि सुधार, रचना कार्यप्रवाह, साझा सुविधाएँ | `apps/web/`, `apps/daemon/` | परीक्षण सहित एक केंद्रित PR |
| Skills | पुनः उपयोग योग्य Agent कार्यप्रवाह | [`skills/`](../../skills/) | `SKILL.md` और वैकल्पिक संदर्भों वाला एक फ़ोल्डर → [मार्गदर्शिका](../contributing/skills-contributing.md) |
| रचना टेम्पलेट | पुनः उपयोग योग्य चित्र, वीडियो या कवर प्रीसेट | [`template/`](../../template/) | `template.json` और संसाधन वाला एक फ़ोल्डर → [मार्गदर्शिका](../contributing/templates-contributing.md) |
| चित्रण और डिज़ाइन | मूल चित्र, आइकन या UI डिज़ाइन | सहमति वाला संसाधन स्थान | पूर्वावलोकन, स्रोत फ़ाइल और लाइसेंस सहित एक PR |
| तृतीय-पक्ष एकीकरण | AI या मीडिया प्रदाता समर्थन | संबंधित Web या Daemon मॉड्यूल | त्रुटि प्रबंधन, क्रेडेंशियल सुरक्षा और परीक्षण वाला एक PR |
| दस्तावेज़ और अनुवाद | दस्तावेज़ सुधार या नई भाषाएँ | `README.md`, `docs/`, `docs/<locale>/` | एक PR |

स्थानीय सेटअप, समीक्षा मानदंड और आम अस्वीकृति कारणों की पूरी मार्गदर्शिका [CONTRIBUTING.md](../../CONTRIBUTING.md) में है; [10 भाषाओं](../zh/CONTRIBUTING.md) में उपलब्ध है।

<a id="star-history"></a>

## स्टार इतिहास

OpenCreator का पुराना नाम KrillinAI था। चार्ट नाम बदलने से पहले और बाद का पूरा रिपॉज़िटरी इतिहास दिखाता है।

[![OpenCreator स्टार इतिहास](https://api.star-history.com/svg?repos=krillinai/OpenCreator&type=date)](https://www.star-history.com/?type=date&repos=krillinai%2FOpenCreator)

<a id="related-projects"></a>

## संबंधित परियोजनाएँ

| परियोजना | भूमिका |
| --- | --- |
| [OpenAI Codex](https://github.com/openai/codex) | मॉडल पहुँच, तर्क, टूल कॉल, सत्र, Skills और MCP के लिए Agent निष्पादन इंजन। |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | सार्वजनिक मीडिया लिंक की जाँच, प्रारूप सूची और वीडियो या ऑडियो डाउनलोड। |
| [FFmpeg](https://ffmpeg.org/) | FFmpeg और ffprobe मीडिया रूपांतरण, संयोजन, फ़्रेम निकालने और आउटपुट सत्यापन के लिए। |
| [Whisper](https://github.com/openai/whisper), [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [faster-whisper](https://github.com/SYSTRAN/faster-whisper) और [WhisperKit](https://github.com/argmaxinc/WhisperKit) | Runtime क्षमताओं के अनुसार क्लाउड और प्लेटफ़ॉर्म-विशिष्ट स्थानीय वाणी लिप्यंतरण। |
| [React](https://react.dev/) | Web और Desktop का साझा UI आधार। |
| [Fastify](https://fastify.dev/) | स्थानीय Runtime का HTTP और API आधार। |
| [Electron](https://www.electronjs.org/) | मूल सिस्टम क्षमता, ऐप जीवनचक्र और पैकेजिंग का Desktop होस्ट। |
| [SQLite](https://www.sqlite.org/) | परियोजना, बातचीत, Run, समय-सारणी, मेमोरी और कार्यक्षेत्र डेटा का स्थानीय भंडारण। |
| [Model Context Protocol](https://modelcontextprotocol.io/) | बाहरी उपकरण और सेवाओं को Agent कार्यक्षेत्र से जोड़ने का खुला प्रोटोकॉल। |

---

<div align="center">

**OpenCreator · स्थानीय रचना, निरंतर काम।**

</div>
