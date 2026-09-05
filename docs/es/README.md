<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../images/OpenCreator_logo_vector_dark.svg" />
    <img src="../images/OpenCreator_logo_vector.svg" alt="OpenCreator" width="380" />
  </picture>
  <br />
  El espacio de trabajo de IA de código abierto para creadores
</h1>

<p>Desde guiones hasta vídeo, imágenes, voz, avatares, traducción y edición, los Agents impulsan todo el proceso creativo en un único espacio de trabajo.</p>

<p><strong>OpenCreator se llamaba anteriormente KrillinAI.</strong></p>

<a href="https://trendshift.io/repositories/13360" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13360" alt="OpenCreator (antes KrillinAI): repositorio n.º 1 del día en Trendshift" width="250" height="55" /></a>

[English](../../README.md) | [简体中文](../zh/README.md) | [日本語](../ja/README.md) | [한국어](../ko/README.md) | [Bahasa Indonesia](../id/README.md) | **Español** | [Français](../fr/README.md) | [Deutsch](../de/README.md) | [Português](../pt/README.md) | [Русский](../ru/README.md) | [العربية](../ar/README.md)

[![GitHub Stars](https://img.shields.io/github/stars/krillinai/OpenCreator?style=flat&logo=github&label=Stars&color=gold)](https://github.com/krillinai/OpenCreator/stargazers)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Bilibili](https://img.shields.io/badge/dynamic/json?label=Bilibili&query=%24.data.follower&suffix=%E7%B2%89%E4%B8%9D&url=https%3A%2F%2Fapi.bilibili.com%2Fx%2Frelation%2Fstat%3Fvmid%3D242124650&logo=bilibili&color=00A1D6&labelColor=FE7398&logoColor=FFFFFF)](https://space.bilibili.com/242124650)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/3GwBGsjs8)
[![Grupo de QQ](https://img.shields.io/badge/QQ%20群-754069680-green?logo=tencent-qq)](https://qm.qq.com/q/W4YC0PLMeA)

[Características principales](#características-principales) · [Herramientas de creación](#herramientas-de-creación) · [Conversación y espacio de trabajo](#conversación-y-espacio-de-trabajo-avanzan-juntos) · [Modelos compatibles](#modelos-compatibles) · [Ejemplos](#ejemplos) · [Inicio rápido](#inicio-rápido) · [Desktop](#desktop) · [Estructura del sistema](#estructura-del-sistema-opencreator) · [Desarrollo](#desarrollo) · [Documentación](#documentación) · [Colaboradores](#colaboradores) · [Historial de Stars](#historial-de-stars)

</div>

![Espacio de trabajo Agent de OpenCreator](../images/opencreator-home-en.png)

## Descripción del proyecto

OpenCreator está diseñado para personas y equipos que desean mantener sus tareas creativas y de desarrollo en ejecución local. En lugar de volver a implementar un bucle de Agent, utiliza Codex CLI como motor de ejecución y añade un Runtime local estable, un espacio de trabajo visual y un host Desktop.

El producto reúne dos flujos de trabajo conectados:

- **Creación de contenido con IA**: utiliza herramientas de creación específicas para traducir vídeos, descargar vídeos, generar miniaturas y crear imágenes.
- **Espacio de trabajo Agent general**: organiza las conversaciones por proyecto, mantiene los Runs en segundo plano y gestiona aprobaciones, archivos adjuntos, archivos, Skills, MCP, programaciones, notificaciones, memoria y diagnósticos desde un solo lugar.

Web es la única implementación del frontend. Desktop carga la misma compilación Web y solo añade las capacidades que requieren el sistema operativo, como la selección de directorios, el ciclo de vida de las ventanas, el comportamiento de la bandeja y las notificaciones nativas. Con los mismos datos y el mismo viewport de contenido, ambas plataformas comparten la misma interfaz general y el mismo comportamiento del Runtime.

## Características principales

- 🤖 **Nativo de Codex**: reutiliza el bucle de Agent, los modelos, el razonamiento, las llamadas a herramientas, las conversaciones, Skills y MCP de Codex sin mantener un segundo motor de ejecución.

- 🚀 **Aplicación Desktop lista para usar**: inicia OpenCreator directamente desde la aplicación Desktop, que incluye Codex CLI; el Runtime local se inicia cuando es necesario y prepara automáticamente un proyecto predeterminado.

- 🔄 **Componentes del Runtime gestionados**: consulta las versiones incluida, activa y más reciente de yt-dlp, busca actualizaciones periódicamente y actualiza manualmente, manteniendo disponible la versión actual si una actualización falla.

- 🎨 **Creación multimodal**: crea y gestiona vídeos, imágenes, audio, subtítulos y documentos mediante un único flujo de trabajo conectado.

- 🔗 **Flujo de trabajo de doble modo**: trabaja desde el espacio de trabajo visual o desde una conversación con el Agent, mientras una máquina de estados compartida mantiene sincronizados los pasos, el progreso y los resultados.

- 🕘 **Control de versiones**: cada revisión crea una nueva versión y conserva la configuración y los resultados anteriores para revisarlos y compararlos.

- 🧩 **Skills y MCP**: explora, instala y utiliza Skills mientras gestionas MCP mediante la configuración nativa de Codex.

- 🧠 **Memoria**: conserva memoria global, por proyecto y por hilo, junto con resúmenes e instantáneas reproducibles de la entrada de cada Run.

- 🔐 **Seguridad local**: conserva los datos, los archivos adjuntos y los registros localmente de forma predeterminada, con aprobaciones y diagnósticos que ocultan información confidencial.

## Herramientas de creación

La versión actual incluye cuatro herramientas de creación. Los modelos y servicios disponibles dependen del entorno local de Codex y de la configuración de los servicios de IA.

Abre el Dashboard para traducir vídeos, descargar vídeos públicos, generar miniaturas o crear imágenes.

![Dashboard de creación de OpenCreator](../images/product/opencreator-dashboard-en.png)

> Continuamente se añaden nuevas herramientas de creación.

<table width="100%">
<thead>
<tr>
<th width="18%">Herramienta</th>
<th width="14%">Estado</th>
<th width="68%">Capacidades</th>
</tr>
</thead>
<tbody>
<tr><td valign="top">Traducción de vídeos</td><td valign="top">✅ Disponible</td><td>Importa vídeos locales o públicos; transcribe con servicios Whisper locales o en la nube; utiliza el contexto de un LLM para segmentar y alinear subtítulos, gestionar terminología y traducir; configura subtítulos bilingües, doblaje o una muestra de voz personalizada, estilos de subtítulos y composición horizontal o vertical, y exporta SRT, audio o vídeo</td></tr>
<tr><td valign="top">Descarga de vídeos</td><td valign="top">✅ Disponible</td><td>Analiza enlaces públicos compatibles de YouTube, Bilibili y otros servicios, consulta las opciones de calidad y formato disponibles y descarga vídeo o audio para flujos de trabajo posteriores</td></tr>
<tr><td valign="top">Generación de miniaturas</td><td valign="top">✅ Disponible</td><td>Combina un tema, un enlace de vídeo y una imagen de referencia opcional para generar y comparar varias propuestas de miniaturas de contenido</td></tr>
<tr><td valign="top">Generación de imágenes</td><td valign="top">✅ Disponible</td><td>Genera imágenes con GPT Image a partir de un prompt y una imagen de referencia opcional, configura la relación de aspecto y la cantidad de resultados y, después, previsualiza y descarga cada imagen</td></tr>
<tr><td valign="top">Animación de figuras de palitos</td><td valign="top">Próximamente</td><td>Desarrolla personajes, guiones gráficos, voces y animación mediante un flujo guiado</td></tr>
<tr><td valign="top">Clips automáticos</td><td valign="top">En desarrollo</td><td>Analiza vídeos largos, identifica los momentos destacados y convierte las escenas elegidas en clips cortos reutilizables</td></tr>
<tr><td valign="top">Doblaje inteligente</td><td valign="top">En desarrollo</td><td>Convierte guiones en voces en off con opciones de voz, ritmo y emoción</td></tr>
<tr><td valign="top">Generación de vídeo</td><td valign="top">En desarrollo</td><td>Genera vídeo a partir de prompts e imágenes de referencia y, después, previsualiza y exporta el resultado</td></tr>
<tr><td valign="top">Avatar digital</td><td valign="top">En desarrollo</td><td>Combina guiones, voz y presentación de avatar para producir vídeos con una persona hablando</td></tr>
</tbody>
</table>

## Conversación y espacio de trabajo, avanzan juntos

Describe las tareas con naturalidad y pasa a las herramientas visuales cuando necesites un control preciso.

![La conversación y el espacio de trabajo visual de OpenCreator funcionan juntos](../images/examples/opencreator-auto-clips-en.png)

### Controles detallados del espacio de trabajo

Ajusta con precisión los subtítulos, las escenas, el audio y la configuración de generación.

### Ediciones conversacionales flexibles

Indica al Agent qué debe cambiar y perfecciona el resultado con lenguaje natural.

### Estado sincronizado

La conversación y el espacio de trabajo comparten el estado de la tarea actual, por lo que no necesitas repetir nada.

### Versiones independientes

Cada revisión crea una versión separada sin sobrescribir los resultados ni la configuración anteriores.

## Modelos compatibles

La disponibilidad de los modelos de lenguaje depende del catálogo de modelos de Codex o de tu proveedor compatible con OpenAI. Los modelos de imagen, voz y transcripción utilizan los servicios configurados en **Configuración → Servicios de IA**.

### Modelos de lenguaje

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

### Imagen

<table>
<tr>
<td align="center"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>GPT Image</strong></td>
</tr>
</table>

### Voz y transcripción

<table>
<tr>
<td align="center" width="20%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>Whisper</strong></td>
<td align="center" width="20%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>OpenAI TTS</strong></td>
<td align="center" width="20%"><img src="https://github.com/MiniMax-AI.png?size=80" alt="MiniMax" width="40" height="40" /><br /><strong>MiniMax</strong></td>
<td align="center" width="20%"><img src="https://github.com/microsoft.png?size=80" alt="Microsoft" width="40" height="40" /><br /><strong>Edge TTS</strong></td>
<td align="center" width="20%"><img src="https://github.com/aliyun.png?size=80" alt="Alibaba Cloud" width="40" height="40" /><br /><strong>Aliyun Speech</strong></td>
</tr>
</table>

## Ejemplos

### Traducción de vídeos

Los siguientes ejemplos públicos se produjeron cuando OpenCreator todavía se llamaba KrillinAI. Demuestran el flujo de trabajo consolidado de alineación de subtítulos, traducción, doblaje y vídeo vertical que el espacio de Traducción de vídeos de OpenCreator incorpora a un flujo de Agent más amplio.

El proyecto generó el siguiente archivo de subtítulos a partir de un vídeo local de 46 minutos en una sola ejecución, sin ajustes manuales. El resultado publicado muestra una cobertura completa, sin líneas superpuestas, con una segmentación natural y una traducción de alta calidad.

![Ejemplo de alineación de subtítulos de OpenCreator](../images/examples/krillinai-subtitle-alignment.png)

<table width="100%">
<tr>
<td width="33%">

#### Traducción de subtítulos

https://github.com/user-attachments/assets/bba1ac0a-fe6b-4947-b58d-ba99306d0339

</td>
<td width="33%">

#### Doblaje

https://github.com/user-attachments/assets/0b32fad3-c3ad-4b6a-abf0-0865f0dd2385

</td>
<td width="33%">

#### Modo vertical

https://github.com/user-attachments/assets/c2c7b528-0ef8-4ba9-b8ac-f9f92f6d4e71

</td>
</tr>
</table>

> Estos ejemplos de vídeo y la imagen de alineación de subtítulos se produjeron cuando OpenCreator todavía utilizaba el nombre KrillinAI.

### Descarga de vídeos

Analiza un enlace de vídeo público, compara los formatos disponibles y descarga el vídeo o el audio directamente en el proyecto.

![Selección de formatos del descargador de vídeos de OpenCreator](../images/examples/video-downloader-formats-en.png)

### Animación de figuras de palitos (próximamente)

> Próximamente. Todavía no está integrada en la versión actual.

OpenCreator desarrolló esta colección de personajes originales en colaboración con el artista [Harbor Hsia](https://www.behance.net/xiaheyuan1), creador de [Stickman en Behance](https://www.behance.net/gallery/254715463/Stickman). El reparto predefinido se está preparando para un futuro flujo de trabajo de historias y animación con identidades de personaje coherentes.

![Personajes de figuras de palitos de OpenCreator desarrollados con artistas](../images/examples/stick-figure-characters.webp)

El flujo de trabajo previsto llevará una idea de personaje e historia por la generación del storyboard, la revisión de planos, la voz en off, la música y una salida de animación con control de versiones.

![Fotograma de ejemplo de animación de figuras de palitos de OpenCreator](../images/examples/stick-figure-animation-frame.jpg)

## Inicio rápido

### Requisitos previos

- Node.js 22 o posterior
- pnpm 9.15.0, fijado mediante el campo `packageManager` del repositorio
- Un ejecutable de Codex CLI disponible en la terminal
- Una sesión válida de Codex CLI para ejecutar tareas reales con modelos

Comprueba primero tu entorno local:

```bash
node --version
pnpm --version
codex --version
```

### Ejecutar Web desde el código fuente

```bash
git clone https://github.com/krillinai/OpenCreator.git
cd OpenCreator
corepack enable
pnpm install
pnpm web:dev
```

Abre `http://127.0.0.1:19861/`. El servidor de desarrollo inicia el daemon local cuando es necesario e inyecta un token temporal del Runtime mediante un proxy del mismo origen, por lo que no es necesario copiar manualmente ningún token de conexión.

En el primer inicio, el Runtime prepara un proyecto predeterminado. El cuadro de entrada queda disponible en cuanto se completa la conexión. Para trabajar únicamente con el daemon:

```bash
pnpm daemon:dev
```

El daemon solo escucha en una dirección de loopback e imprime una vez en stdout su dirección de conexión y el token temporal.

## Desktop

Desktop y el navegador utilizan el mismo frontend de React de `apps/web`. El comportamiento general de proyectos, conversaciones, tareas y ajustes utiliza el mismo Daemon/API. Electron solo añade rutas reales del sistema, controles de ventana, comportamiento de la bandeja y notificaciones nativas.

### Modo de desarrollo

```bash
pnpm desktop:dev
```

### Empaquetado local

| Comando | Resultado |
| --- | --- |
| `pnpm desktop:package` | Un directorio ejecutable para la plataforma actual, destinado a la verificación local |
| `pnpm desktop:dist` | Un instalador para la plataforma actual |
| `pnpm desktop:release` | El punto de entrada del empaquetado para una versión formal |
| `pnpm --filter @opencreator/desktop verify:package` | Verificación de un paquete Desktop existente |

El empaquetado de Desktop vuelve a compilar Web desde el espacio de trabajo actual, registra el commit, el estado dirty, la plataforma, la arquitectura y el hash de Web, y compara `apps/web/dist` con los recursos integrados en la aplicación. El empaquetado falla si no coinciden. Consulta la [guía operativa de versiones de Desktop](../operations/opencreator-desktop-release-runbook.md) para obtener información sobre la firma, la notarización, las compilaciones para Windows y los requisitos de publicación.

## Flujos de trabajo principales

### Conversaciones y Runs

1. Selecciona un proyecto o inicia una conversación nueva.
2. Introduce una tarea y elige el nivel de permisos, el Profile, el modelo y el esfuerzo de razonamiento.
3. Mientras haya un Run activo, añade tareas de seguimiento a la cola o interrúmpelo y continúa inmediatamente.
4. Usa la Timeline para consultar resúmenes de razonamiento, llamadas a herramientas, cambios en archivos, aprobaciones y resultados finales.
5. Usa el centro de tareas para hacer un seguimiento global de las tareas en ejecución, completadas, fallidas y bloqueadas por una aprobación.

### Skills y MCP

- Explora el marketplace de Skills, el historial de instalaciones y las Skills disponibles localmente en el centro de plugins.
- Selecciona una Skill en el cuadro de entrada mediante `/` o el menú de añadir para que la siguiente tarea siga su flujo de trabajo.
- La gestión de MCP utiliza los comandos y la configuración nativos de Codex en lugar de mantener un segundo motor de ejecución.
- OpenCreator utiliza el `$CODEX_HOME` activo de forma predeterminada, así que comprueba el impacto antes de modificar la configuración global de Skills o MCP.

### Programaciones e hilos de tareas dedicados

- Cada programación dispone de una conversación persistente y dedicada de OpenCreator.
- Los desencadenadores automáticos, las ejecuciones manuales y los seguimientos del usuario reutilizan esa conversación y se ejecutan de forma secuencial según la política `queue` o `skip`.
- Al eliminar una programación, su conversación dedicada se archiva, pero se conservan los Runs, los resultados y el historial subyacente de Codex.
- Rotar o recuperar un hilo subyacente de Codex no modifica la entrada de la tarea ni la ruta de la página de OpenCreator.

## Estructura del sistema OpenCreator

OpenCreator trata el espacio de trabajo visual y la conversación con el Agent como dos interfaces para una misma tarea creativa, en lugar de dos flujos de trabajo distintos. Cada flujo de creación se modela como una máquina de estados: la entrada de origen, la configuración, la generación, la revisión, la modificación y la exportación se convierten en estados y eventos explícitos. Las acciones del espacio de trabajo y los comandos de la conversación entran en la misma máquina de estados, mientras que el paso actual, la configuración, el progreso, las versiones y los resultados se proyectan de nuevo en ambas interfaces. De este modo, el espacio de trabajo y la conversación permanecen sincronizados sin introducir una segunda fuente de verdad.

El trabajo creativo es iterativo, por lo que las revisiones no sobrescriben el resultado actual. Cada corrección o regeneración crea una nueva versión a partir del estado existente del flujo de trabajo y conserva los ajustes y resultados de las versiones anteriores para revisarlos, compararlos y seguir perfeccionándolos.

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

| Componente de OpenCreator | Responsabilidad | Implementación |
| --- | --- | --- |
| Experiencia de creación | Dashboard, herramientas de creación, conversación con el Agent, configuración y archivos | `apps/web` · React 18 · Vite · TypeScript |
| Núcleo de colaboración | Sincroniza los pasos del espacio de trabajo, el contexto de conversación, el progreso, los resultados y las revisiones | Estado de flujo compartido · `CreatorCollaborationPanel` · historial de versiones |
| Runtime local | Gestiona proyectos, Runs, aprobaciones, programaciones, memoria y notificaciones | `apps/daemon` · Fastify · Runtime API · SSE |
| Componentes del Runtime | Registra las versiones incluida, activa y más reciente; comprueba periódicamente e instala solo las actualizaciones solicitadas | yt-dlp nightly · verificación de actualizaciones · recuperación de la versión funcional |
| Motor Codex | Proporciona el bucle Agent, las sesiones, el razonamiento, las herramientas, Skills y MCP | Codex CLI · app-server |
| Herramientas multimedia | Descarga, transcribe, transforma, genera y exporta contenido multimedia | yt-dlp · Whisper · FFmpeg · servicios de IA configurados |
| Datos locales | Guarda localmente los datos de proyectos, Runs, adjuntos, resultados y credenciales | SQLite · sistema de archivos · almacén de credenciales del sistema |
| Host Desktop | Carga la compilación Web compartida y añade capacidades del sistema operativo | `apps/desktop` · Electron · Preload Bridge |

Principios fundamentales:

- El espacio de trabajo y la conversación con el Agent son proyecciones sincronizadas del mismo estado del flujo de trabajo; ambos envían eventos a la misma máquina de estados en lugar de mantener estados de tarea paralelos.
- Las revisiones crean nuevas versiones en lugar de reemplazar los resultados existentes, lo que conserva el contexto y el resultado de cada iteración creativa.
- El frontend no inicia Codex directamente ni depende del formato de eventos JSONL sin procesar de Codex.
- El daemon se encarga del ciclo de vida de los procesos, la normalización de eventos, la persistencia, las aprobaciones, las programaciones y la bandeja de salida de notificaciones.
- Codex sigue siendo la fuente de verdad para la ejecución del bucle de Agent, Skills y MCP.
- Browser Bridge y Desktop Bridge no implementan copias independientes de la lógica general del producto.

## Estructura del repositorio

```text
OpenCreator/
├── apps/
│   ├── web/          # La única implementación del frontend de React
│   ├── daemon/       # Runtime local de Fastify y adaptador de Codex
│   ├── desktop/      # Electron Main, Preload, capacidades nativas y empaquetado
│   └── harness/      # Herramienta de verificación del Runtime por línea de comandos
├── packages/
│   ├── protocol/     # Contratos del Runtime compartidos por Web, Daemon y Desktop
│   └── skill-market/ # Modelos del marketplace de Skills y lógica compartida
├── docs/             # Documentos de diseño, referencias de API, guías operativas e informes de pruebas
├── scripts/          # Comprobaciones a nivel del repositorio
└── .runtime/         # Datos locales del Runtime, creados en el primer inicio
```

## Configuración

### Claves API de servicios de IA

Abre **Ajustes → Servicios de IA** para configurar los proveedores de modelos, transcripción, audio e imagen que utilizan los espacios de trabajo actuales. Es posible que aparezcan categorías de servicios adicionales como preparación para futuras herramientas de creación. Cada categoría solo muestra los campos necesarios para el proveedor seleccionado, incluidos Base URL, API Key, modelo, proxy o credenciales específicas del proveedor.

![Configuración de claves API de servicios de IA de OpenCreator](../images/product/opencreator-ai-services-en.png)

Las credenciales se guardan mediante el almacén de credenciales del sistema del Runtime local y nunca deben incluirse en el repositorio. Algunos proveedores locales o respaldados por el sistema, como Edge TTS, no requieren una API Key.

### Componentes de Runtime de terceros

Abre **Configuración → Componentes de terceros** para consultar la versión nightly de yt-dlp que está en uso, la versión incluida con OpenCreator, su origen y la última versión disponible. OpenCreator busca actualizaciones cada siete días, pero nunca las instala automáticamente. Las actualizaciones requieren una acción explícita del usuario y la versión funcional actual permanece disponible si falla la descarga, la verificación o la instalación.

![Configuración de componentes de terceros de OpenCreator](../images/product/opencreator-third-party-components-en.png)
### Variables de entorno del Runtime

La mayoría de los usuarios no necesitan variables de entorno. Utilízalas cuando necesites datos aislados, un ejecutable específico de Codex o un directorio personalizado para proyectos gestionados:

| Variable de entorno | Valor predeterminado | Finalidad |
| --- | --- | --- |
| `OPENCREATOR_DATA_DIR` | `.runtime` | Base de datos de OpenCreator, Runs, archivos adjuntos y espacios de trabajo gestionados |
| `OPENCREATOR_CODEX_BIN` | `codex` | Ruta al ejecutable de Codex CLI |
| `CODEX_HOME` | `~/.codex` | Fuente de verdad para sesiones, configuración, Skills, MCP y Profiles de Codex |
| `OPENCREATOR_DEFAULT_CWD` | Directorio de trabajo actual | Directorio de trabajo predeterminado del daemon |
| `OPENCREATOR_DEFAULT_PROJECT_ROOT` | Política predeterminada del Runtime | Raíz de proyectos gestionados; cuando se establece, OpenCreator utiliza su directorio secundario `OpenCreator/` |
| `OPENCREATOR_CODEX_THREAD_ROTATION_RUN_THRESHOLD` | `50` | Umbral de Runs terminados para rotar el hilo de Codex asociado a una programación de larga duración; usa `0` para desactivar la rotación preventiva |

Por ejemplo, para aislar tanto los datos del Runtime como el entorno de Codex:

```bash
OPENCREATOR_DATA_DIR=/path/to/opencreator-data \
CODEX_HOME=/path/to/codex-home \
pnpm web:dev
```

## Datos y seguridad

De forma predeterminada, los datos del Runtime se almacenan en `.runtime/`, dentro de la raíz del repositorio:

| Ruta | Contenido |
| --- | --- |
| `.runtime/app.sqlite` | Proyectos, hilos, Runs, eventos, programaciones, notificaciones, metadatos de archivos adjuntos, aprobaciones, memoria y resúmenes |
| `.runtime/runs/` | Registros con información confidencial oculta, diagnósticos y metadatos de cada Run |
| `.runtime/attachments/` | Archivos adjuntos controlados |
| `.runtime/workspaces/` | Espacios de trabajo de proyectos gestionados por el Runtime |

Las sesiones y la configuración de Codex permanecen en `$CODEX_HOME` y deben respaldarse por separado de `.runtime/`.

Los límites de seguridad incluyen:

- El daemon solo escucha en `127.0.0.1`; todas las API, excepto la comprobación de estado, requieren un token Bearer.
- La vista previa HTML desactiva scripts, navegación y ventanas emergentes de forma predeterminada, y solo permite recursos relativos controlados del mismo espacio de trabajo.
- La memoria confidencial requiere una segunda confirmación. OpenCreator nunca almacena automáticamente y de forma permanente las sugerencias no confirmadas.
- Los diagnósticos y los registros de Runs ocultan la información confidencial antes de devolverse o exportarse.
- Los paquetes Desktop activan la integridad de ASAR y el cifrado de cookies, y desactivan RunAsNode, `NODE_OPTIONS` y Node CLI Inspector.

Consulta la [guía del usuario y de solución de problemas](../opencreator-user-guide-and-troubleshooting.md) para conocer los procedimientos completos de copia de seguridad, restauración, limpieza y restablecimiento.

## Desarrollo

### Comandos habituales

| Comando | Finalidad |
| --- | --- |
| `pnpm web:dev` | Iniciar Web y abrir el daemon local cuando sea necesario |
| `pnpm daemon:dev` | Iniciar únicamente el daemon |
| `pnpm desktop:dev` | Compilar las dependencias e iniciar Electron en modo de desarrollo |
| `pnpm test` | Ejecutar pruebas unitarias y de integración del espacio de trabajo |
| `pnpm typecheck` | Ejecutar las comprobaciones de TypeScript en todo el repositorio |
| `pnpm build` | Compilar todos los workspaces |
| `pnpm e2e` | Ejecutar las pruebas E2E de Playwright para Web |
| `pnpm smoke:ci` | Ejecutar la prueba de humo del Runtime con un Codex simulado |
| `pnpm perf:check` | Comprobar la línea base de rendimiento registrada |

Antes de enviar un cambio, ejecuta como mínimo:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Los cambios en Desktop, Host Bridge, el proxy del Runtime o los flujos de trabajo compartidos del frontend también requieren pruebas de coherencia Web/Desktop, pruebas E2E de la aplicación empaquetada y verificación del hash de la compilación Web. Superar únicamente las pruebas unitarias de Web no demuestra que una versión de Desktop esté lista para publicarse.

La prueba de humo con Codex real está desactivada de forma predeterminada. Actívala explícitamente con:

```bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

## Documentación

- [Guía del usuario y solución de problemas](../opencreator-user-guide-and-troubleshooting.md)
- [Runtime API v1](../runtime-api-for-ui-v1.md)
- [Diseño del Runtime nativo de Codex](../2026-07-03-codex-native-agent-runtime-design.md)
- [Guía operativa de versiones de Desktop](../operations/opencreator-desktop-release-runbook.md)
- [Guía de versiones de Desktop para Windows](../operations/opencreator-desktop-windows-release.md)
- [Directrices de componentes visuales](../visual-component-guidelines.md)

## Convención de traducción

El archivo `README.md` de la raíz es el documento canónico en inglés. Las traducciones mantenidas se encuentran en `docs/<locale>/README.md`. Añade un idioma al selector solo después de traducir su documento completo y sincronizarlo con la estructura en inglés.

## Contribuir

1. Describe el problema, el caso de uso y el comportamiento esperado en [Issues](https://github.com/krillinai/OpenCreator/issues).
2. Crea una rama específica de función o corrección a partir de la rama de desarrollo más reciente.
3. Sigue la arquitectura existente: implementa una sola vez las capacidades generales del producto en Web y Daemon, y aísla las diferencias nativas detrás de capabilities explícitas.
4. Añade la cobertura unitaria, de integración o E2E adecuada para los cambios de comportamiento y enumera en el Pull Request tanto las verificaciones realizadas como las omitidas.
5. Nunca incluyas en un commit `.runtime/`, credenciales locales, sesiones de Codex, cachés de compilación ni otros datos del usuario.

## Colaboradores

Gracias a todas las personas que han participado mediante código, documentación, comentarios, informes de problemas, Skills, diseños e ideas.

<a href="https://github.com/krillinai/KrillinAI/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=krillinai/KrillinAI&amp;max=500&amp;columns=20" alt="OpenCreator Colaboradores" />
</a>

## Historial de Stars

OpenCreator se llamaba anteriormente KrillinAI. Este gráfico abarca todo el historial del repositorio antes y después del cambio de nombre.

[![Historial de Stars de OpenCreator](https://api.star-history.com/svg?repos=krillinai/KrillinAI&type=Date)](https://star-history.com/#krillinai/KrillinAI&Date)

## Proyectos relacionados

| Proyecto | Función |
| --- | --- |
| [OpenAI Codex](https://github.com/openai/codex) | Motor de ejecución del Agent que proporciona acceso a modelos, razonamiento, llamadas a herramientas, sesiones, Skills e integración con MCP. |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Inspecciona enlaces multimedia públicos compatibles, enumera los formatos disponibles y descarga vídeo o audio para los flujos de creación. |
| [FFmpeg](https://ffmpeg.org/) | FFmpeg y ffprobe se encargan de convertir y componer contenido multimedia, extraer fotogramas y validar resultados. |
| [Whisper](https://github.com/openai/whisper), [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [faster-whisper](https://github.com/SYSTRAN/faster-whisper) y [WhisperKit](https://github.com/argmaxinc/WhisperKit) | Opciones de transcripción en la nube y locales específicas de cada plataforma, seleccionadas según las capacidades disponibles del Runtime. |
| [React](https://react.dev/) | Base de la interfaz de usuario compartida entre Web y Desktop. |
| [Fastify](https://fastify.dev/) | Base HTTP y API del Runtime local. |
| [Electron](https://www.electronjs.org/) | Host Desktop para las capacidades nativas del sistema, el ciclo de vida de la aplicación y el empaquetado. |
| [SQLite](https://www.sqlite.org/) | Persistencia local de proyectos, conversaciones, Runs, programaciones, memoria y otros datos del espacio de trabajo. |
| [Model Context Protocol](https://modelcontextprotocol.io/) | Protocolo abierto para conectar herramientas y servicios externos al espacio de trabajo del Agent. |

---

<div align="center">

**OpenCreator · Crea en local, trabaja sin interrupciones.**

</div>
