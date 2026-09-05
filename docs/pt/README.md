<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../images/OpenCreator_logo_vector_dark.svg" />
    <img src="../images/OpenCreator_logo_vector.svg" alt="OpenCreator" width="380" />
  </picture>
  <br />
  O espaço de trabalho de IA open source para criadores
</h1>

<p>De roteiros a vídeos, imagens, voz, avatares, tradução e edição, os Agents impulsionam todo o processo criativo em um único espaço de trabalho.</p>

<p><strong>O OpenCreator se chamava anteriormente KrillinAI.</strong></p>

<a href="https://trendshift.io/repositories/13360" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13360" alt="OpenCreator (anteriormente KrillinAI): repositório n.º 1 do dia no Trendshift" width="250" height="55" /></a>

[English](../../README.md) | [简体中文](../zh/README.md) | [日本語](../ja/README.md) | [한국어](../ko/README.md) | [Bahasa Indonesia](../id/README.md) | [Español](../es/README.md) | [Français](../fr/README.md) | [Deutsch](../de/README.md) | **Português** | [Русский](../ru/README.md) | [العربية](../ar/README.md)

[![GitHub Stars](https://img.shields.io/github/stars/krillinai/OpenCreator?style=flat&logo=github&label=Stars&color=gold)](https://github.com/krillinai/OpenCreator/stargazers)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Bilibili](https://img.shields.io/badge/dynamic/json?label=Bilibili&query=%24.data.follower&suffix=%E7%B2%89%E4%B8%9D&url=https%3A%2F%2Fapi.bilibili.com%2Fx%2Frelation%2Fstat%3Fvmid%3D242124650&logo=bilibili&color=00A1D6&labelColor=FE7398&logoColor=FFFFFF)](https://space.bilibili.com/242124650)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/3GwBGsjs8)
[![Grupo QQ](https://img.shields.io/badge/QQ%20群-754069680-green?logo=tencent-qq)](https://qm.qq.com/q/W4YC0PLMeA)

[Destaques do projeto](#destaques-do-projeto) · [Ferramentas de criação](#ferramentas-de-criação) · [Conversa e espaço de trabalho](#conversa-e-espaço-de-trabalho-avançam-juntos) · [Modelos compatíveis](#modelos-compatíveis) · [Exemplos](#exemplos) · [Início rápido](#início-rápido) · [Desktop](#desktop) · [Estrutura do sistema](#estrutura-do-sistema-opencreator) · [Desenvolvimento](#desenvolvimento) · [Documentação](#documentação) · [Colaboradores](#colaboradores) · [Histórico de Stars](#histórico-de-stars)

</div>

![Espaço de trabalho Agent do OpenCreator](../images/opencreator-home-en.png)

## Visão geral do projeto

O OpenCreator foi criado para pessoas e equipes que desejam manter o trabalho criativo e de desenvolvimento em execução local. Em vez de reimplementar um loop de Agent, ele usa o Codex CLI como mecanismo de execução e acrescenta um Runtime local estável, um espaço de trabalho visual e um host Desktop.

O produto reúne dois fluxos de trabalho conectados:

- **Criação de conteúdo com IA**: use ferramentas de criação dedicadas para tradução de vídeos, download de vídeos, geração de miniaturas e geração de imagens.
- **Espaço de trabalho Agent geral**: organize conversas por projeto, mantenha Runs em segundo plano e gerencie aprovações, anexos, arquivos, Skills, MCP, agendamentos, notificações, memória e diagnósticos em um só lugar.

Web é a única implementação do frontend. Desktop carrega a mesma compilação Web e adiciona somente os recursos que exigem o sistema operacional, como seleção de diretórios, ciclo de vida das janelas, comportamento da bandeja e notificações nativas. Com os mesmos dados e o mesmo viewport de conteúdo, as duas plataformas compartilham a mesma interface geral e o mesmo comportamento do Runtime.

## Destaques do projeto

- 🤖 **Nativo do Codex**: reutilize o loop de Agent, os modelos, o raciocínio, as chamadas de ferramentas, as conversas, Skills e MCP do Codex sem manter um segundo mecanismo de execução.

- 🚀 **Aplicativo Desktop pronto para uso**: inicie o OpenCreator diretamente pelo aplicativo Desktop, que inclui o Codex CLI; o Runtime local inicia sob demanda e prepara automaticamente um projeto padrão.

- 🔄 **Componentes de Runtime gerenciados**: consulte as versões incluída, ativa e mais recente do yt-dlp, verifique atualizações periodicamente e atualize manualmente, mantendo a versão atual disponível se uma atualização falhar.

- 🎨 **Criação multimodal**: crie e gerencie vídeos, imagens, áudio, legendas e documentos por meio de um único fluxo de trabalho conectado.

- 🔗 **Fluxo de trabalho em dois modos**: trabalhe pelo espaço de trabalho visual ou por uma conversa com o Agent, enquanto uma máquina de estados compartilhada mantém etapas, progresso e resultados sincronizados.

- 🕘 **Versionamento**: cada revisão cria uma nova versão e preserva as configurações e os resultados anteriores para análise e comparação.

- 🧩 **Skills e MCP**: explore, instale e use Skills enquanto gerencia MCP pela configuração nativa do Codex.

- 🧠 **Memória**: mantenha memória global, por projeto e por thread, com resumos e snapshots reproduzíveis das entradas de Run.

- 🔐 **Segurança local**: mantenha dados, anexos e logs localmente por padrão, com aprovações e diagnósticos que ocultam informações confidenciais.

## Ferramentas de criação

A versão atual inclui quatro ferramentas de criação. Os modelos e serviços disponíveis dependem do seu ambiente local do Codex e das configurações dos serviços de IA.

Abra o Dashboard para traduzir vídeos, baixar vídeos públicos, gerar miniaturas ou criar imagens.

![Dashboard de criação do OpenCreator](../images/product/opencreator-dashboard-en.png)

> Novas ferramentas de criação são adicionadas continuamente.

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
<tr><td valign="top">Download de vídeos</td><td valign="top">✅ Disponível</td><td>Analise links públicos compatíveis do YouTube, Bilibili e outros serviços, consulte as opções disponíveis de qualidade e formato e baixe vídeo ou áudio para fluxos de trabalho posteriores</td></tr>
<tr><td valign="top">Geração de miniaturas</td><td valign="top">✅ Disponível</td><td>Combine um tema, um link de vídeo e uma imagem de referência opcional para gerar e comparar várias opções de miniaturas de conteúdo</td></tr>
<tr><td valign="top">Geração de imagens</td><td valign="top">✅ Disponível</td><td>Gere imagens com GPT Image a partir de um prompt e de uma imagem de referência opcional, configure a proporção e a quantidade de resultados e depois visualize e baixe cada imagem</td></tr>
<tr><td valign="top">Animação de bonecos palito</td><td valign="top">Em breve</td><td>Desenvolva personagens, storyboards, locuções e animações em um fluxo de trabalho guiado</td></tr>
<tr><td valign="top">Clipes automáticos</td><td valign="top">Em desenvolvimento</td><td>Analise vídeos longos, identifique destaques e transforme os momentos escolhidos em clipes curtos reutilizáveis</td></tr>
<tr><td valign="top">Dublagem inteligente</td><td valign="top">Em desenvolvimento</td><td>Transforme roteiros em locuções com opções de voz e controles de ritmo e emoção</td></tr>
<tr><td valign="top">Geração de vídeo</td><td valign="top">Em desenvolvimento</td><td>Gere vídeo a partir de prompts e imagens de referência, visualize e exporte o resultado</td></tr>
<tr><td valign="top">Avatar digital</td><td valign="top">Em desenvolvimento</td><td>Combine roteiros, voz e apresentação de avatar para produzir vídeos de pessoas falando</td></tr>
</tbody>
</table>

## Conversa e espaço de trabalho avançam juntos

Descreva as tarefas naturalmente e passe para as ferramentas visuais sempre que precisar de controle preciso.

![A conversa e o espaço de trabalho visual do OpenCreator funcionam juntos](../images/examples/opencreator-auto-clips-en.png)

### Controles detalhados do espaço de trabalho

Ajuste com precisão legendas, cenas, áudio e configurações de geração.

### Edições flexíveis por conversa

Diga ao Agent o que deve mudar e refine o resultado em linguagem natural.

### Estado sincronizado

A conversa e o espaço de trabalho compartilham o estado da tarefa atual, sem necessidade de repetir informações.

### Versões independentes

Cada revisão cria uma versão separada sem sobrescrever resultados ou configurações anteriores.

## Modelos compatíveis

A disponibilidade dos modelos de linguagem segue o catálogo de modelos do Codex ou o provedor compatível com OpenAI configurado. Modelos de imagem, voz e transcrição usam os serviços configurados em **Configurações → Serviços de IA**.

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
<td width="20%"></td>
</tr>
</table>

### Imagem

<table>
<tr>
<td align="center"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>GPT Image</strong></td>
</tr>
</table>

### Voz e transcrição

<table>
<tr>
<td align="center" width="20%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>Whisper</strong></td>
<td align="center" width="20%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>OpenAI TTS</strong></td>
<td align="center" width="20%"><img src="https://github.com/MiniMax-AI.png?size=80" alt="MiniMax" width="40" height="40" /><br /><strong>MiniMax</strong></td>
<td align="center" width="20%"><img src="https://github.com/microsoft.png?size=80" alt="Microsoft" width="40" height="40" /><br /><strong>Edge TTS</strong></td>
<td align="center" width="20%"><img src="https://github.com/aliyun.png?size=80" alt="Alibaba Cloud" width="40" height="40" /><br /><strong>Aliyun Speech</strong></td>
</tr>
</table>

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

Analise um link de vídeo público, compare os formatos disponíveis e baixe o vídeo ou o áudio diretamente para o projeto.

![Seleção de formatos do downloader de vídeos do OpenCreator](../images/examples/video-downloader-formats-en.png)

### Animação de bonecos palito (em breve)

> Em breve. Ainda não está integrada à versão atual.

O OpenCreator desenvolveu esta coleção de personagens originais em colaboração com o artista [Harbor Hsia](https://www.behance.net/xiaheyuan1), criador de [Stickman no Behance](https://www.behance.net/gallery/254715463/Stickman). O elenco predefinido está sendo preparado para um futuro fluxo de histórias e animações com identidades de personagem consistentes.

![Personagens de bonecos palito do OpenCreator desenvolvidos com artistas](../images/examples/stick-figure-characters.webp)

O fluxo de trabalho planejado conduzirá uma ideia de personagem e história pela geração do storyboard, revisão de cenas, locução, música e saída de animação versionada.

![Quadro de exemplo de animação de bonecos palito do OpenCreator](../images/examples/stick-figure-animation-frame.jpg)

## Início rápido

### Pré-requisitos

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

### Executar Web a partir do código-fonte

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

Antes de enviar uma alteração, execute pelo menos:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Alterações no Desktop, no Host Bridge, no proxy do Runtime ou nos fluxos de trabalho compartilhados do frontend também exigem testes de consistência Web/Desktop, E2E do aplicativo empacotado e verificação do hash da compilação Web. A aprovação apenas nos testes unitários de Web não comprova que uma versão Desktop está pronta para lançamento.

O teste de fumaça com o Codex real é desativado por padrão. Ative-o explicitamente com:

```bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

## Documentação

- [Guia do usuário e solução de problemas](../opencreator-user-guide-and-troubleshooting.md)
- [Runtime API v1](../runtime-api-for-ui-v1.md)
- [Design do Runtime nativo do Codex](../2026-07-03-codex-native-agent-runtime-design.md)
- [Runbook de lançamento do Desktop](../operations/opencreator-desktop-release-runbook.md)
- [Guia de lançamento do Desktop para Windows](../operations/opencreator-desktop-windows-release.md)
- [Diretrizes de componentes visuais](../visual-component-guidelines.md)

## Convenção de tradução

O arquivo `README.md` na raiz é o documento canônico em inglês. As traduções mantidas ficam em `docs/<locale>/README.md`. Adicione um idioma ao seletor somente depois que o documento completo tiver sido traduzido e sincronizado com a estrutura em inglês.

## Como contribuir

1. Descreva o problema, o caso de uso e o comportamento esperado em [Issues](https://github.com/krillinai/OpenCreator/issues).
2. Crie uma branch específica de recurso ou correção a partir da branch de desenvolvimento mais recente.
3. Siga a arquitetura existente: implemente os recursos gerais do produto uma única vez em Web e Daemon e isole as diferenças nativas atrás de capabilities explícitas.
4. Adicione cobertura unitária, de integração ou E2E adequada para alterações de comportamento e liste no Pull Request tanto as verificações concluídas quanto as ignoradas.
5. Nunca inclua em um commit `.runtime/`, credenciais locais, sessões do Codex, caches de compilação ou outros dados do usuário.

## Colaboradores

Agradecemos a todas as pessoas que participaram com código, documentação, feedback, relatos de problemas, Skills, design e ideias.

<a href="https://github.com/krillinai/KrillinAI/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=krillinai/KrillinAI&amp;max=500&amp;columns=20" alt="OpenCreator Colaboradores" />
</a>

## Histórico de Stars

O OpenCreator se chamava anteriormente KrillinAI. Este gráfico abrange todo o histórico do repositório antes e depois da mudança de nome.

[![Histórico de Stars do OpenCreator](https://api.star-history.com/svg?repos=krillinai/KrillinAI&type=Date)](https://star-history.com/#krillinai/KrillinAI&Date)

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
