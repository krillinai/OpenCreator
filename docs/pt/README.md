<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../images/OpenCreator_logo_vector_dark.svg" />
    <img src="../images/OpenCreator_logo_vector.svg" alt="OpenCreator" width="380" />
  </picture>
  <br />
  O espaço de trabalho de IA open source e Skills para criadores
</h1>

<p>Reúna ferramentas visuais de criação, Skills reutilizáveis e Agents para roteiros, vídeos, imagens, voz, avatares, tradução e edição — tudo em um único espaço de trabalho.</p>

<p><strong>O OpenCreator se chamava anteriormente KrillinAI.</strong></p>

<a href="https://trendshift.io/repositories/13360" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13360" alt="OpenCreator (anteriormente KrillinAI): repositório n.º 1 do dia no Trendshift" width="250" height="55" /></a>

[English](../../README.md) | [简体中文](../zh/README.md) | [日本語](../ja/README.md) | [한국어](../ko/README.md) | [Bahasa Indonesia](../id/README.md) | [Español](../es/README.md) | [Français](../fr/README.md) | [Deutsch](../de/README.md) | **Português** | [Русский](../ru/README.md) | [العربية](../ar/README.md) | [ภาษาไทย](../th/README.md) | [Türkçe](../tr/README.md) | [हिन्दी](../hi/README.md) | [বাংলা](../bn/README.md) | [اردو](../ur/README.md) | [Tiếng Việt](../vi/README.md) | [Filipino](../fil/README.md)

[![GitHub Stars](https://badgen.net/github/stars/krillinai/OpenCreator?icon=github&label=Stars&color=EAB308)](https://github.com/krillinai/OpenCreator/stargazers)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Bilibili](https://img.shields.io/badge/dynamic/json?label=Bilibili&query=%24.data.follower&suffix=%E7%B2%89%E4%B8%9D&url=https%3A%2F%2Fapi.bilibili.com%2Fx%2Frelation%2Fstat%3Fvmid%3D242124650&logo=bilibili&color=00A1D6&labelColor=FE7398&logoColor=FFFFFF)](https://space.bilibili.com/242124650)
[![AtomGit G-Star](https://img.shields.io/badge/AtomGit-G--Star-DA203E?style=flat)](https://atomgit.com/krillinai/OpenCreator)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/fUNvbqDaw)
[![Grupo QQ](https://img.shields.io/badge/QQ%20群-754069680-green?logo=tencent-qq)](https://qm.qq.com/q/W4YC0PLMeA)

[Destaques](#destaques-do-projeto) · [Ferramentas](#ferramentas-de-criação) · [Skills](#skills) · [Exemplos](#exemplos) · [Começar](#início-rápido) · [Desktop](#desktop) · [Docs](#documentação) · [Comunidade](#comunidade)

</div>

![Espaço de trabalho Agent do OpenCreator](../images/opencreator-home-en.png)

## Visão geral do projeto

O OpenCreator foi criado para pessoas e equipes que desejam manter o trabalho criativo e de desenvolvimento em execução local. Em vez de reimplementar um loop de Agent, ele usa o Codex CLI como mecanismo de execução e acrescenta um Runtime local estável, um espaço de trabalho visual e um host Desktop.

O OpenCreator oferece duas formas de trabalho conectadas:

- **Espaço de trabalho de conteúdo**: use ferramentas visuais e modelos de criação para traduzir e baixar vídeos, gerar miniaturas e imagens e realizar outras tarefas criativas.
- **Conversa com o Agent**: inicie e conduza tarefas criativas ou de desenvolvimento em linguagem natural, organize conversas por projeto, mantenha Runs em segundo plano e gerencie aprovações, anexos, arquivos, Skills, MCP, agendamentos, notificações, memória e diagnósticos em um só lugar.

Web é a única implementação do frontend. Desktop carrega a mesma compilação Web e adiciona somente os recursos que exigem o sistema operacional, como seleção de diretórios, ciclo de vida das janelas, comportamento da bandeja e notificações nativas. Com os mesmos dados e o mesmo viewport de conteúdo, as duas plataformas compartilham a mesma interface geral e o mesmo comportamento do Runtime.

## Destaques do projeto

- 🤖 **Nativo do Codex**: reutilize o loop de Agent, os modelos, o raciocínio, as chamadas de ferramentas, as conversas, Skills e MCP do Codex sem manter um segundo mecanismo de execução.

- 🚀 **Aplicativo Desktop pronto para uso**: inicie o OpenCreator diretamente pelo aplicativo Desktop, que inclui o Codex CLI; o Runtime local inicia sob demanda e prepara automaticamente um projeto padrão.

- ⚙️ **Detecção da configuração local do Codex**: na primeira abertura, o Desktop verifica a configuração existente e oferece a opção de reutilizar um login do ChatGPT ou uma chave de API válida. Outros provedores de modelos podem ser configurados no assistente inicial.

- 🔄 **Componentes de Runtime gerenciados**: consulte as versões incluída, ativa e mais recente do yt-dlp, verifique atualizações periodicamente e atualize manualmente, mantendo a versão atual disponível se uma atualização falhar.

- 🎨 **Criação multimodal**: crie e gerencie vídeos, imagens, áudio, legendas e documentos por meio de um único fluxo de trabalho conectado.

- 🧩 **Modelos de criação**: crie imagens e vídeos a partir de modelos reutilizáveis sem preparar prompts e configurações do zero.

- 🔗 **Fluxo de trabalho em dois modos**: trabalhe pelo espaço de trabalho visual ou por uma conversa com o Agent, enquanto uma máquina de estados compartilhada mantém etapas, progresso e resultados sincronizados.

- 🕘 **Versionamento**: cada revisão cria uma nova versão e preserva as configurações e os resultados anteriores para análise e comparação.

- 🧩 **Skills reutilizáveis**: use Skills de fluxo de trabalho de vídeo, amplie o Agent com seus próprios Skills e gerencie MCP pela configuração nativa do Codex.

- 🧠 **Memória**: mantenha memória global, por projeto e por thread, com resumos e snapshots reproduzíveis das entradas de Run.

- 🔐 **Segurança local**: mantenha dados, anexos e logs localmente por padrão, com aprovações e diagnósticos que ocultam informações confidenciais.

- 🌐 **Interface multilíngue**: Web e Desktop oferecem 43 idiomas, detecção do idioma do sistema, seleção manual e layout da direita para a esquerda para árabe, persa, urdu e hebraico.

## Ferramentas de criação

A versão atual inclui seis ferramentas de criação. Os modelos e serviços disponíveis dependem do seu ambiente local do Codex e das configurações dos serviços de IA.

Abra o Dashboard para traduzir ou baixar vídeos, gerar miniaturas ou imagens, criar locuções com Text to Speech ou gerar vídeos com Seedance.

![Dashboard de criação do OpenCreator](../images/product/opencreator-dashboard-en.png)

> Novas ferramentas de criação são adicionadas continuamente.

**A tradução de vídeos oferece 123 idiomas de origem e 124 opções de destino, incluindo saída em pinyin.** Pesquise pelo nome nativo, inglês, chinês ou código do idioma. A cobertura do reconhecimento e da síntese de voz depende do serviço e modelo escolhidos.

- **Tradução apenas de legendas**: Importe e visualize um SRT e traduza sem vídeo de origem, dublagem ou renderização de vídeo.

- **Edição avançada de legendas**: Use um editor imersivo com forma de onda e linha do tempo sincronizadas com a reprodução para ajustar tempos, dividir ou unir legendas e localizar e substituir texto. Visualize estilos no vídeo, ajuste idioma, voz e saída e gere uma nova versão preservando as anteriores.

- **Criação em uma página**: Configure geração de imagens, vídeos e Text to Speech em uma página, com seleção de modelos, prévia de referências, opções de imagem por modelo e biblioteca de vozes com busca.

- **Saída multilíngue e progresso**: Fontes alternativas incluídas melhoram escritas complexas e legendas da direita para a esquerda. Acompanhe transcrição, tradução, dublagem e renderização com contagens concluídas e totais quando disponíveis.

<table width="100%">
<thead>
<tr>
<th width="18%">Ferramenta</th>
<th width="14%">Status</th>
<th width="68%">Recursos</th>
</tr>
</thead>
<tbody>
<tr><td valign="top">Tradução de vídeos</td><td valign="top">✅ Disponível</td><td>Importe vídeos locais ou públicos; transcreva com serviços Whisper locais ou na nuvem; use o contexto de um LLM para segmentar e alinhar legendas, gerenciar terminologia e traduzir; configure legendas bilíngues, dublagem ou uma amostra de voz personalizada, estilos de legenda e composição horizontal ou vertical, e exporte SRT, áudio ou vídeo</td></tr>
<tr><td valign="top">Download de vídeos</td><td valign="top">✅ Disponível</td><td>Analise vídeos públicos individuais do YouTube, Bilibili, X, TikTok, Instagram, Douyin, Facebook, Xiaohongshu, Pinterest e Reddit; compare os formatos disponíveis e baixe vídeo ou áudio. Algumas plataformas podem exigir cookies. Quando a plataforma oferece legendas, consulte a lista e baixe SRT; o inglês aparece primeiro, seguido pelo idioma da interface quando disponível.</td></tr>
<tr><td valign="top">Geração de miniaturas</td><td valign="top">✅ Disponível</td><td>Combine um tema, um link de vídeo e uma imagem de referência opcional para gerar e comparar várias opções de miniaturas de conteúdo</td></tr>
<tr><td valign="top">Geração de imagens</td><td valign="top">✅ Disponível</td><td>Gere imagens com GPT Image / Seedream / Kling Image / Gemini a partir de um prompt e de uma imagem de referência opcional, configure a proporção e a quantidade de resultados e depois visualize e baixe cada imagem</td></tr>
<tr><td valign="top">Redação de artigos</td><td valign="top">✅ Disponível</td><td>Transforme temas, links, vídeos ou documentos em opções de tema, esboço e artigo editáveis; adicione imagens e exporte Markdown, HTML ou PDF.</td></tr>
<tr><td valign="top">Posts do Xiaohongshu</td><td valign="top">✅ Disponível</td><td>Crie posts a partir de temas ou materiais com controles de público, tipo e tamanho; copie ou baixe o resultado.</td></tr>
<tr><td valign="top">Roteiro para vídeo curto</td><td valign="top">✅ Disponível</td><td>Crie um roteiro segmentado pronto para gravar a partir de um tema ou material, ajustado ao público, plataforma, duração e tom; edite ou exporte.</td></tr>
<tr><td valign="top">Animação de bonecos palito</td><td valign="top">✅ Disponível</td><td>Transforme texto ou conteúdo do YouTube em narração, voz, imagens de storyboard com personagens consistentes, legendas e uma animação para download.</td></tr>
<tr><td valign="top">Clipes automáticos</td><td valign="top">Em desenvolvimento</td><td>Analise vídeos longos, identifique destaques e transforme os momentos escolhidos em clipes curtos reutilizáveis</td></tr>
<tr><td valign="top">Text to Speech</td><td valign="top">✅ Disponível</td><td>Transforme roteiros em locuções com opções de voz e controles de ritmo e emoção</td></tr>
<tr><td valign="top">Geração de vídeo</td><td valign="top">✅ Disponível</td><td>Gere vídeos com Seedance / Kling / Veo a partir de prompts e imagens de referência e depois visualize, gere novamente ou baixe cada versão</td></tr>
<tr><td valign="top">Avatar digital</td><td valign="top">Em desenvolvimento</td><td>Combine roteiros, voz e apresentação de avatar para produzir vídeos de pessoas falando</td></tr>
</tbody>
</table>

## Modelos de criação

Comece a criar a partir de um modelo, sem precisar preparar cada prompt e configuração do zero. Explore os modelos em destaque por categoria, incluindo criação de vídeos e design de imagens.

A coleção reúne modelos originais do OpenCreator e de criadores independentes. Para modelos de terceiros, a página de detalhes identifica o autor e inclui um link para a fonte original.

Abra um modelo para visualizar um resultado de exemplo e consultar prompt, configurações, tags, autor e fonte original. Selecione **Usar este modelo** para começar a criar e ajuste as entradas para o seu projeto.

![Detalhes de um modelo de imagem com resultado de exemplo, configurações e prompt](../images/product/creation-templates-detail-apex-summit-en.png)

## Skills

As ferramentas de criação oferecem controles visuais; os Skills fornecem ao Agent instruções e fluxos de trabalho reutilizáveis. O OpenCreator inclui Skills de produção de vídeo no repositório e oferece suporte ao gerenciamento de Skills locais do Codex.

O diretório [`skills/`](../../skills/) do repositório contém instruções reutilizáveis para Agents que operam a CLI integrada do KrillinAI.

| Skill | Recursos |
| --- | --- |
| [KrillinAI CLI](../../skills/krillinai-cli/SKILL.md) | Escolher comandos, verificar a configuração e interpretar progresso, manifestos, saídas e erros |
| [Legendas](../../skills/krillinai-subtitle/SKILL.md) | Baixar legendas das plataformas ou transcrever mídia, traduzir legendas e produzir legendas bilíngues ou curtas para vídeos verticais |
| [TTS](../../skills/krillinai-tts/SKILL.md) | Gerar dublagem no idioma de destino a partir de legendas e, opcionalmente, produzir um vídeo dublado |
| [Renderização horizontal](../../skills/krillinai-render-horizontal/SKILL.md) | Renderizar vídeos horizontais com legendas bilíngues ou áudio dublado e legendas no idioma de destino |
| [Renderização vertical](../../skills/krillinai-render-vertical/SKILL.md) | Compor vídeos verticais com títulos, legendas bilíngues ou dublagem |
| [Capa](../../skills/krillinai-cover/SKILL.md) | Gerar uma imagem de capa a partir de um prompt de texto completo e salvar a imagem e o prompt final |
| [Planejamento do pipeline](../../skills/krillinai-pipeline/SKILL.md) | Validar um plano de saídas de várias etapas no modo dry-run; executar o trabalho real pelos Skills de cada etapa |

### Amplie com seus próprios Skills

O OpenCreator oferece suporte a Skills locais do Codex definidos por `SKILL.md`, permitindo adicionar seus próprios métodos e fluxos de trabalho sem depender apenas de ferramentas de criação fixas. A disponibilidade depende do Codex home ativo e dos Skills instalados; os Skills de vídeo exigem a configuração da CLI e dos serviços relacionados. A inclusão de um Skill no repositório não significa que ele será instalado automaticamente nem que todos os serviços externos estão incluídos.

## Conversa e espaço de trabalho avançam juntos

Descreva as tarefas naturalmente e passe para as ferramentas visuais sempre que precisar de controle preciso.

Os provedores e modelos mostrados são exemplos; a disponibilidade real depende de credenciais, acesso da conta e plataforma.

### Controles detalhados do espaço de trabalho

Ajuste com precisão legendas, cenas, áudio e configurações de geração.

### Edições flexíveis por conversa

Diga ao Agent o que deve mudar e refine o resultado em linguagem natural.

### Estado sincronizado

A conversa e o espaço de trabalho compartilham o estado da tarefa atual, sem necessidade de repetir informações.

### Versões independentes

Cada revisão cria uma versão separada sem sobrescrever resultados ou configurações anteriores.

## Modelos compatíveis

A disponibilidade dos modelos de linguagem segue o catálogo de modelos do Codex ou o provedor compatível com OpenAI configurado. Modelos de imagem, vídeo, voz e transcrição usam os serviços configurados em **Configurações → Serviços de IA**.

As tabelas mostram provedores integrados e modelos recomendados; a disponibilidade real depende de credenciais, acesso da conta e plataforma.

### Modelos de linguagem

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

### Imagem

<table>
<tr>
<td align="center" width="25%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>GPT Image</strong></td>
<td align="center" width="25%"><img src="../images/models/jimeng.png" alt="Jimeng" width="40" height="40" /><br /><strong>Seedream 4.0</strong><br />Jimeng</td>
<td align="center" width="25%"><img src="../images/models/kling.png" alt="Kling" width="40" height="40" /><br /><strong>Kling v2.1</strong><br />Kling Image</td>
<td align="center" width="25%"><img src="../images/models/gemini.png" alt="Gemini" width="40" height="40" /><br /><strong>Nano Banana</strong><br />Gemini 2.5 Flash Image</td>
</tr>
</table>

### Vídeo

<table>
<tr>
<td align="center" width="33%"><img src="../images/models/seedance.png" alt="Seedance" width="40" height="40" /><br /><strong>Seedance 2.5</strong></td>
<td align="center" width="33%"><img src="../images/models/kling.png" alt="Kling" width="40" height="40" /><br /><strong>Kling v2.1 Master</strong></td>
<td align="center" width="33%"><img src="../images/models/gemini.png" alt="Gemini" width="40" height="40" /><br /><strong>Veo 3.1</strong></td>
</tr>
</table>

### Voz e transcrição

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

A transcrição local também oferece faster-whisper, WhisperKit e whisper.cpp nas plataformas compatíveis.

## Exemplos

### Tradução de vídeos

Os exemplos públicos abaixo foram produzidos quando o OpenCreator ainda se chamava KrillinAI. Eles demonstram o fluxo de trabalho consolidado de alinhamento de legendas, tradução, dublagem e vídeo vertical que o espaço de Tradução de vídeos do OpenCreator incorpora a um fluxo de Agent mais amplo.

O projeto gerou o arquivo de legendas abaixo a partir de um vídeo local de 46 minutos em uma única execução, sem ajustes manuais. O resultado publicado apresenta cobertura completa, nenhuma linha sobreposta, segmentação natural e tradução de alta qualidade.

![Exemplo de alinhamento de legendas do OpenCreator](../images/examples/krillinai-subtitle-alignment.png)

<table width="100%">
<tr>
<td width="33%">

#### Tradução de legendas

https://github.com/user-attachments/assets/bba1ac0a-fe6b-4947-b58d-ba99306d0339

</td>
<td width="33%">

#### Dublagem

https://github.com/user-attachments/assets/0b32fad3-c3ad-4b6a-abf0-0865f0dd2385

</td>
<td width="33%">

#### Modo vertical

https://github.com/user-attachments/assets/c2c7b528-0ef8-4ba9-b8ac-f9f92f6d4e71

</td>
</tr>
</table>

> Estes exemplos de vídeo e a imagem de alinhamento de legendas foram produzidos quando o OpenCreator ainda usava o nome KrillinAI.

### Download de vídeos

Analise links de vídeo públicos de 10 plataformas compatíveis, compare os formatos disponíveis e baixe o vídeo ou o áudio diretamente para o projeto.

Fontes de vídeo compatíveis:

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

A disponibilidade depende do vídeo e da região; algumas fontes podem exigir cookies da plataforma. O OpenCreator não importa automaticamente os cookies do navegador.

![Seleção de formatos do downloader de vídeos do OpenCreator](../images/examples/video-downloader-formats-and-subtitles-en.png)

### Geração de vídeos

Gere um vídeo com IA a partir de um prompt de texto ou de uma imagem de referência com o Seedance. Configure o modelo, a proporção, a resolução e a duração; depois, visualize, gere novamente ou baixe cada versão no espaço de trabalho do projeto.

![Geração de vídeos no OpenCreator com Seedance](../images/examples/video-generation-seedance-en.png)

### Animação de bonecos palito

O OpenCreator desenvolveu esta coleção de personagens originais em colaboração com o artista [Harbor Hsia](https://www.behance.net/xiaheyuan1), criador de [Stickman no Behance](https://www.behance.net/gallery/254715463/Stickman). Os personagens integrados mantêm identidades consistentes durante a animação.

![Personagens de bonecos palito do OpenCreator desenvolvidos com artistas](../images/examples/stick-figure-characters.webp)

Transforme texto ou conteúdo do YouTube em animação com revisão do roteiro, narração, ajuste de tempo, storyboard, legendas, renderização e vídeo para download.

![Quadro de exemplo de animação de bonecos palito do OpenCreator](../images/examples/stick-figure-animation-frame.jpg)

## Início rápido

### Instalar o aplicativo Desktop

Baixe o instalador para macOS Apple Silicon, macOS Intel ou Windows x64 na [versão mais recente](https://github.com/krillinai/OpenCreator/releases/latest). O Desktop não requer Node.js nem pnpm e inclui o Codex CLI. Tarefas reais com modelos exigem um login do ChatGPT ou uma configuração de chave de API válida.

Na primeira inicialização, o Desktop inicia o Runtime local, prepara um projeto padrão e verifica a configuração local do Codex. Se encontrar um login ou uma chave de API e configurações de modelo utilizáveis, selecione **Usar o Codex local e continuar** para reutilizá-los. Também é possível configurar outro provedor de modelos no mesmo assistente inicial.

![Configuração do provedor de modelos na primeira inicialização do OpenCreator Desktop](../images/product/opencreator-codex-setup.png)

Após a configuração, digite seu pedido para iniciar uma tarefa. Se houver problemas, consulte o [guia do usuário](../opencreator-user-guide-and-troubleshooting.md).

### Executar Web a partir do código-fonte

Para desenvolver ou usar Web a partir do código-fonte, prepare:

- Node.js 22 ou posterior
- pnpm 9.15.0, fixado pelo campo `packageManager` do repositório
- Um executável do Codex CLI disponível no terminal
- Um login válido no Codex CLI para tarefas reais com modelos

Primeiro, verifique seu ambiente local:

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

Abra `http://127.0.0.1:19861/`. O servidor de desenvolvimento inicia o daemon local sob demanda e injeta um token temporário do Runtime por meio de um proxy de mesma origem, portanto não é necessário copiar manualmente nenhum token de conexão.

Na primeira inicialização, o Runtime prepara um projeto padrão. O campo de entrada fica disponível assim que a conexão é concluída. Para trabalhar somente no daemon:

```bash
pnpm daemon:dev
```

O daemon escuta somente em um endereço de loopback e imprime uma vez no stdout seu endereço de conexão e o token temporário.

## Desktop

Desktop e o navegador usam o mesmo frontend React de `apps/web`. O comportamento geral de projetos, conversas, tarefas e configurações chama o mesmo Daemon/API. O Electron acrescenta somente caminhos reais do sistema, controles de janela, comportamento da bandeja e notificações nativas.

### Modo de desenvolvimento

```bash
pnpm desktop:dev
```

### Empacotamento local

| Comando | Saída |
| --- | --- |
| `pnpm desktop:package` | Um diretório executável para a plataforma atual, destinado à verificação local |
| `pnpm desktop:dist` | Um instalador para a plataforma atual |
| `pnpm desktop:release` | O ponto de entrada de empacotamento para uma versão oficial |
| `pnpm --filter @opencreator/desktop verify:package` | Verificação de um pacote Desktop existente |

O empacotamento do Desktop recompila Web a partir do espaço de trabalho atual, registra o commit, o estado dirty, a plataforma, a arquitetura e o hash de Web e compara `apps/web/dist` com os recursos incorporados ao aplicativo. O empacotamento falha se houver diferenças. Consulte o [runbook de lançamento do Desktop](../operations/opencreator-desktop-release-runbook.md) para informações sobre assinatura, notarização, compilações para Windows e requisitos de lançamento.

## Fluxos de trabalho principais

### Conversas e Runs

1. Selecione um projeto ou inicie uma nova conversa.
2. Digite uma tarefa e escolha o nível de permissão, o Profile, o modelo e o esforço de raciocínio.
3. Enquanto um Run estiver ativo, coloque tarefas de acompanhamento na fila ou interrompa-o e continue imediatamente.
4. Use a Timeline para consultar resumos de raciocínio, chamadas de ferramentas, alterações em arquivos, aprovações e resultados finais.
5. Use a central de tarefas para acompanhar globalmente tarefas em execução, concluídas, com falha e bloqueadas por aprovação.

### Skills e MCP

- Explore o marketplace de Skills, o histórico de instalações e as Skills disponíveis localmente na central de plugins.
- Selecione uma Skill no campo de entrada usando `/` ou o menu de adição para que a próxima tarefa siga seu fluxo de trabalho.
- O gerenciamento de MCP usa os comandos e a configuração nativos do Codex em vez de manter um segundo mecanismo de execução.
- O OpenCreator usa o `$CODEX_HOME` ativo por padrão, portanto verifique o impacto antes de alterar as Skills globais ou a configuração de MCP.

### Agendamentos e threads de tarefas dedicados

- Cada agendamento tem uma conversa persistente e dedicada do OpenCreator.
- Acionamentos automáticos, execuções manuais e acompanhamentos do usuário reutilizam essa conversa e são executados em série de acordo com a política `queue` ou `skip`.
- Excluir um agendamento arquiva sua conversa dedicada, mas preserva Runs, resultados e o histórico subjacente do Codex.
- Rotacionar ou recuperar uma thread subjacente do Codex não altera a entrada da tarefa nem a rota da página do OpenCreator.

## Estrutura do sistema OpenCreator

O OpenCreator trata o espaço de trabalho visual e a conversa com o Agent como duas interfaces para a mesma tarefa criativa, e não como dois fluxos de trabalho separados. Cada fluxo de criação é modelado como uma máquina de estados: entrada de origem, configuração, geração, revisão, alteração e exportação tornam-se estados e eventos explícitos. As ações no espaço de trabalho e os comandos de conversa entram na mesma máquina de estados, enquanto a etapa atual, a configuração, o progresso, as versões e os resultados são projetados de volta nas duas interfaces. Isso mantém o espaço de trabalho e a conversa sincronizados sem introduzir uma segunda fonte de verdade.

O trabalho criativo é iterativo, portanto as revisões não substituem o resultado atual. Cada correção ou nova geração cria uma versão a partir do estado existente do fluxo de trabalho, mantendo as configurações e os resultados das versões anteriores para análise, comparação e aprimoramento contínuo.

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

| Componente do OpenCreator | Responsabilidade | Implementação |
| --- | --- | --- |
| Experiência de criação | Dashboard, ferramentas de criação, conversa com Agent, configurações e arquivos | `apps/web` · React 18 · Vite · TypeScript |
| Núcleo de colaboração | Sincroniza etapas do espaço de trabalho, contexto da conversa, progresso, resultados e revisões | Estado de fluxo compartilhado · `CreatorCollaborationPanel` · histórico de versões |
| Runtime local | Gerencia projetos, Runs, aprovações, agendamentos, memória e notificações | `apps/daemon` · Fastify · Runtime API · SSE |
| Componentes do Runtime | Acompanha versões incluída, ativa e mais recente, verifica periodicamente e instala apenas atualizações solicitadas | yt-dlp nightly · verificação de atualização · fallback para versão funcional |
| Mecanismo Codex | Fornece loop de Agent, sessões, raciocínio, ferramentas, Skills e MCP | Codex CLI · app-server |
| Ferramentas de mídia | Baixa, transcreve, transforma, gera e exporta mídia criativa | yt-dlp · Whisper · FFmpeg · serviços de IA configurados |
| Dados locais | Armazena localmente dados de projetos, Runs, anexos, resultados e credenciais | SQLite · sistema de arquivos · armazenamento de credenciais do sistema |
| Host Desktop | Carrega a compilação Web compartilhada e adiciona recursos do sistema operacional | `apps/desktop` · Electron · Preload Bridge |

Princípios fundamentais:

- O espaço de trabalho e a conversa com o Agent são projeções sincronizadas do mesmo estado do fluxo de trabalho; ambos enviam eventos para a mesma máquina de estados em vez de manter estados de tarefa paralelos.
- As revisões criam novas versões em vez de substituir os resultados existentes, preservando o contexto e a saída de cada iteração criativa.
- O frontend não inicia o Codex diretamente e não depende do formato bruto de eventos JSONL do Codex.
- O daemon gerencia o ciclo de vida dos processos, a normalização de eventos, a persistência, as aprovações, os agendamentos e a caixa de saída de notificações.
- O Codex continua sendo a fonte de verdade para a execução do loop de Agent, Skills e MCP.
- Browser Bridge e Desktop Bridge não implementam cópias separadas da lógica geral do produto.

## Estrutura do repositório

```text
OpenCreator/
├── apps/
│   ├── web/          # A única implementação do frontend React
│   ├── daemon/       # Runtime Fastify local e adaptador do Codex
│   ├── desktop/      # Electron Main, Preload, recursos nativos e empacotamento
│   └── harness/      # Ferramenta de linha de comando para verificação do Runtime
├── packages/
│   ├── protocol/     # Contratos do Runtime compartilhados por Web, Daemon e Desktop
│   └── skill-market/ # Modelos do marketplace de Skills e lógica compartilhada
├── docs/             # Documentos de design, referências de API, runbooks e relatórios de testes
├── scripts/          # Verificações no nível do repositório
└── .runtime/         # Dados locais do Runtime, criados na primeira inicialização
```

## Configuração

### Chaves de API dos serviços de IA

Abra **Configurações → Serviços de IA** para configurar os provedores de modelo, transcrição, áudio e imagem usados pelos espaços de trabalho atuais. Categorias adicionais de serviços podem aparecer como preparação para futuras ferramentas de criação. Cada categoria exibe somente os campos exigidos pelo provedor selecionado, incluindo Base URL, API Key, modelo, proxy ou credenciais específicas do provedor.

![Configurações de chaves de API dos serviços de IA do OpenCreator](../images/product/opencreator-ai-services-en.png)

As credenciais são salvas pelo armazenamento de credenciais do sistema do Runtime local e nunca devem ser enviadas ao repositório. Alguns provedores locais ou integrados ao sistema, como o Edge TTS, não exigem uma API Key.

### Componentes de Runtime de terceiros

Abra **Configurações → Componentes de terceiros** para consultar a versão nightly do yt-dlp em uso, a versão incluída no OpenCreator, sua origem e a versão mais recente disponível. O OpenCreator verifica atualizações a cada sete dias, mas nunca as instala automaticamente. As atualizações exigem uma ação explícita do usuário, e a versão funcional atual permanece disponível se o download, a verificação ou a instalação falhar.

![Configurações de componentes de terceiros do OpenCreator](../images/product/opencreator-third-party-components-en.png)
### Variáveis de ambiente do Runtime

A maioria dos usuários não precisa de variáveis de ambiente. Use-as quando precisar de dados isolados, de um executável específico do Codex ou de um diretório personalizado para projetos gerenciados:

| Variável de ambiente | Padrão | Finalidade |
| --- | --- | --- |
| `OPENCREATOR_DATA_DIR` | `.runtime` | Banco de dados do OpenCreator, Runs, anexos e espaços de trabalho gerenciados |
| `OPENCREATOR_CODEX_BIN` | `codex` | Caminho para o executável do Codex CLI |
| `CODEX_HOME` | `~/.codex` | Fonte de verdade para sessões, configurações, Skills, MCP e Profiles do Codex |
| `OPENCREATOR_DEFAULT_CWD` | Diretório de trabalho atual | Diretório de trabalho padrão do daemon |
| `OPENCREATOR_DEFAULT_PROJECT_ROOT` | Política padrão do Runtime | Raiz dos projetos gerenciados; quando definida, o OpenCreator usa seu subdiretório `OpenCreator/` |
| `OPENCREATOR_CODEX_THREAD_ROTATION_RUN_THRESHOLD` | `50` | Limite de Runs encerrados para rotacionar a thread do Codex por trás de um agendamento de longa duração; use `0` para desativar a rotação proativa |

Por exemplo, para isolar tanto os dados do Runtime quanto o ambiente do Codex:

```bash
OPENCREATOR_DATA_DIR=/path/to/opencreator-data \
CODEX_HOME=/path/to/codex-home \
pnpm web:dev
```

## Dados e segurança

Por padrão, os dados do Runtime são armazenados em `.runtime/` na raiz do repositório:

| Caminho | Conteúdo |
| --- | --- |
| `.runtime/app.sqlite` | Projetos, threads, Runs, eventos, agendamentos, notificações, metadados de anexos, aprovações, memória e resumos |
| `.runtime/runs/` | Logs com informações confidenciais ocultadas, diagnósticos e metadados de Runs individuais |
| `.runtime/attachments/` | Arquivos de anexo controlados |
| `.runtime/workspaces/` | Espaços de trabalho de projetos gerenciados pelo Runtime |

As sessões e configurações do Codex permanecem em `$CODEX_HOME` e devem ser copiadas separadamente de `.runtime/`.

Os limites de segurança incluem:

- O daemon escuta somente em `127.0.0.1`; todas as APIs, exceto a verificação de integridade, exigem um token Bearer.
- A visualização HTML desativa scripts, navegação e pop-ups por padrão e permite somente recursos relativos controlados do mesmo espaço de trabalho.
- A memória sensível exige uma segunda confirmação. O OpenCreator nunca armazena automaticamente e de forma permanente sugestões não confirmadas.
- Os diagnósticos e logs de Runs têm as informações confidenciais ocultadas antes de serem retornados ou exportados.
- Os pacotes Desktop ativam a integridade ASAR e a criptografia de cookies, desativando RunAsNode, `NODE_OPTIONS` e o Node CLI Inspector.

Consulte o [guia do usuário e de solução de problemas](../opencreator-user-guide-and-troubleshooting.md) para conhecer os procedimentos completos de backup, restauração, limpeza e redefinição.

## Desenvolvimento

### Comandos comuns

| Comando | Finalidade |
| --- | --- |
| `pnpm web:dev` | Iniciar Web e abrir o daemon local sob demanda |
| `pnpm daemon:dev` | Iniciar somente o daemon |
| `pnpm desktop:dev` | Compilar as dependências e iniciar o Electron no modo de desenvolvimento |
| `pnpm test` | Executar testes unitários e de integração dos workspaces |
| `pnpm typecheck` | Executar verificações do TypeScript em todo o repositório |
| `pnpm build` | Compilar todos os workspaces |
| `pnpm e2e` | Executar testes E2E do Playwright para Web |
| `pnpm smoke:ci` | Executar o teste de fumaça do Runtime com um Codex simulado |
| `pnpm perf:check` | Verificar a linha de base de desempenho registrada |

Antes de enviar uma alteração, escolha verificações proporcionais ao impacto, conforme o [guia de contribuição](../../CONTRIBUTING.md#what-reviewers-check). Mudanças em documentação, texto e estilo requerem apenas verificações pertinentes; comportamento compartilhado e Runtime exigem testes direcionados e checagem de tipos. Execute testes ou builds completos apenas se necessário e informe no PR o que foi realmente verificado.

Alterações no Desktop, no Host Bridge, no proxy do Runtime ou nos fluxos de trabalho compartilhados do frontend também exigem testes de consistência Web/Desktop, E2E do aplicativo empacotado e verificação do hash da compilação Web. A aprovação apenas nos testes unitários de Web não comprova que uma versão Desktop está pronta para lançamento.

O teste de fumaça com o Codex real é desativado por padrão. Ative-o explicitamente com:

```bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

## Documentação

- **Usar o OpenCreator:** [Início rápido](#início-rápido) · [Guia do usuário e solução de problemas](../opencreator-user-guide-and-troubleshooting.md)
- **Desenvolver e ampliar:** [Guia de contribuição](../../CONTRIBUTING.md) · [Contribuir com Skill](../contributing/skills-contributing.md) · [Contribuir com modelo de criação](../contributing/templates-contributing.md) · [Runtime API v1](../runtime-api-for-ui-v1.md) · [Diretrizes de componentes visuais](../visual-component-guidelines.md)
- **Manter e lançar:** [Design do Runtime nativo do Codex](../2026-07-03-codex-native-agent-runtime-design.md) · [Runbook de lançamento do Desktop](../operations/opencreator-desktop-release-runbook.md) · [Guia de lançamento do Desktop para Windows](../operations/opencreator-desktop-windows-release.md)

## Convenção de tradução

O arquivo `README.md` na raiz é o documento canônico em inglês. As traduções mantidas ficam em `docs/<locale>/README.md`. Adicione um idioma ao seletor somente depois que o documento completo tiver sido traduzido e sincronizado com a estrutura em inglês.

## Comunidade

<p>Usuários do GitHub de <strong>pelo menos 107 países e regiões</strong> deram uma estrela ao OpenCreator.</p>

<img src="../images/star-coverage-map.svg" alt="Mapa-múndi com países e regiões de usuários do GitHub que deram uma estrela ao OpenCreator" width="760" />

### A equipe

Cada integrante é responsável pelos padrões, pela revisão e integração de contribuições e pelo suporte à comunidade em sua área.

<table border="1" cellpadding="12">
  <tr>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/wulien.svg" width="64" height="64" alt="wulien avatar" /><br /><a href="https://github.com/wulien">wulien</a><br />Código e correções de bugs</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/dle-kb.svg" width="64" height="64" alt="DLe-kb avatar" /><br /><a href="https://github.com/DLe-kb">DLe-kb</a><br />Modelos de criação</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/xiaheyuan.svg" width="64" height="64" alt="xiaheyuan avatar" /><br /><a href="https://github.com/xiaheyuan">xiaheyuan</a><br />Design e recursos</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/krillinai.svg" width="64" height="64" alt="krillinai avatar" /><br /><a href="https://github.com/krillinai">krillinai</a><br />Skills e documentação</td>
    <td align="center" valign="middle" width="160" height="160"><img src="../images/contributors/hbxugang.svg" width="64" height="64" alt="hbxugang avatar" /><br /><a href="https://github.com/hbxugang">hbxugang</a><br />Implantação empresarial</td>
  </tr>
</table>

### Colaboradores

Agradecemos a todas as pessoas que participaram com código, documentação, feedback, relatos de problemas, Skills, design e ideias.

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

### Como contribuir

Você pode contribuir com o OpenCreator de várias maneiras, não apenas com código:

| Tipo | O que contribuir | Como preparar | Onde enviar |
| --- | --- | --- | --- |
| Código | Correções, fluxos de criação, recursos compartilhados | Mudança focada, demonstração ou reprodução, testes | [Issue][contribute-issue] → [PR][contribute-pr]; `apps/web/` ou `apps/daemon/` |
| Skills | Fluxos reutilizáveis para Agents | `SKILL.md`, pré-requisitos e exemplos | [Issue][contribute-issue] → [PR][contribute-pr] em `skills/` |
| Modelos de criação | Modelos reutilizáveis de imagem, vídeo ou capa | `template.json`, capa e exemplos, prompts, configurações, atribuição e direitos de uso | [PR][contribute-pr] em [`template/`](../../template/); discuta novos formatos em uma [Issue][contribute-issue] |
| Ilustração e design | Ilustrações, ícones ou interfaces originais | Prévia, arquivos-fonte editáveis e licença | [Issue][contribute-issue] → [PR][contribute-pr] no local de recursos acordado |
| Integrações de serviços de terceiros | Serviços de IA ou mídia | Caso de uso, configuração, erros, segurança das credenciais e testes | [Issue][contribute-issue] → [PR][contribute-pr] nos módulos Web / Daemon |

Coloque cada modelo e seus arquivos em `template/<module>/<id>/<version>/template.json`. Os módulos atuais são `image-generation`, `video-generation` e `cover-generator`. Inclua título e descrição em chinês e inglês e execute `pnpm templates:validate` antes de enviar um PR.

Como participar:

1. Descreva o problema, o caso de uso e o comportamento esperado em [Issues](https://github.com/krillinai/OpenCreator/issues).
2. Crie uma branch específica de recurso ou correção a partir da branch de desenvolvimento mais recente.
3. Siga a arquitetura existente: implemente os recursos gerais do produto uma única vez em Web e Daemon e isole as diferenças nativas atrás de capabilities explícitas.
4. Adicione cobertura unitária, de integração ou E2E adequada para alterações de comportamento e liste no Pull Request tanto as verificações concluídas quanto as ignoradas.
5. Nunca inclua em um commit `.runtime/`, credenciais locais, sessões do Codex, caches de compilação ou outros dados do usuário.

[contribute-issue]: https://github.com/krillinai/OpenCreator/issues
[contribute-pr]: https://github.com/krillinai/OpenCreator/pulls

## Histórico de Stars

O OpenCreator se chamava anteriormente KrillinAI. Este gráfico abrange todo o histórico do repositório antes e depois da mudança de nome.

[![Histórico de Stars do OpenCreator](https://api.star-history.com/svg?repos=krillinai/OpenCreator&type=date)](https://www.star-history.com/?type=date&repos=krillinai%2FOpenCreator)

## Projetos relacionados

| Projeto | Função |
| --- | --- |
| [OpenAI Codex](https://github.com/openai/codex) | Mecanismo de execução do Agent responsável por acesso a modelos, raciocínio, chamadas de ferramentas, sessões, Skills e integração com MCP. |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Inspeciona links públicos de mídia compatíveis, lista os formatos disponíveis e baixa vídeo ou áudio para fluxos de criação. |
| [FFmpeg](https://ffmpeg.org/) | FFmpeg e ffprobe cuidam da conversão e composição de mídia, extração de quadros e validação de resultados. |
| [Whisper](https://github.com/openai/whisper), [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [faster-whisper](https://github.com/SYSTRAN/faster-whisper) e [WhisperKit](https://github.com/argmaxinc/WhisperKit) | Opções de transcrição de voz na nuvem e locais específicas de plataforma, selecionadas conforme os recursos disponíveis do Runtime. |
| [React](https://react.dev/) | Base da interface compartilhada entre Web e Desktop. |
| [Fastify](https://fastify.dev/) | Base HTTP e API do Runtime local. |
| [Electron](https://www.electronjs.org/) | Host Desktop para recursos nativos do sistema, ciclo de vida do aplicativo e empacotamento. |
| [SQLite](https://www.sqlite.org/) | Persistência local de projetos, conversas, Runs, agendamentos, memória e outros dados do espaço de trabalho. |
| [Model Context Protocol](https://modelcontextprotocol.io/) | Protocolo aberto para conectar ferramentas e serviços externos ao espaço de trabalho Agent. |

---

<div align="center">

**OpenCreator · Crie localmente, trabalhe sem interrupções.**

</div>
