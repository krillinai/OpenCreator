<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../images/OpenCreator_logo_vector_dark.svg" />
    <img src="../images/OpenCreator_logo_vector.svg" alt="OpenCreator" width="380" />
  </picture>
  <br />
  Der Open-Source-KI-Arbeitsbereich für Kreative
</h1>

<p>Von Skripten über Videos, Bilder, Stimmen, Avatare und Übersetzungen bis zur Bearbeitung bringen Agents den gesamten kreativen Prozess in einem Arbeitsbereich voran.</p>

<p><strong>OpenCreator hieß früher KrillinAI.</strong></p>

<a href="https://trendshift.io/repositories/13360" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13360" alt="OpenCreator (ehemals KrillinAI): Platz 1 der Repositories des Tages auf Trendshift" width="250" height="55" /></a>

[English](../../README.md) | [简体中文](../zh/README.md) | [日本語](../ja/README.md) | [한국어](../ko/README.md) | [Bahasa Indonesia](../id/README.md) | [Español](../es/README.md) | [Français](../fr/README.md) | **Deutsch** | [Português](../pt/README.md) | [Русский](../ru/README.md) | [العربية](../ar/README.md)

[![GitHub Stars](https://img.shields.io/github/stars/krillinai/OpenCreator?style=flat&logo=github&label=Stars&color=gold)](https://github.com/krillinai/OpenCreator/stargazers)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Bilibili](https://img.shields.io/badge/dynamic/json?label=Bilibili&query=%24.data.follower&suffix=%E7%B2%89%E4%B8%9D&url=https%3A%2F%2Fapi.bilibili.com%2Fx%2Frelation%2Fstat%3Fvmid%3D242124650&logo=bilibili&color=00A1D6&labelColor=FE7398&logoColor=FFFFFF)](https://space.bilibili.com/242124650)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/3GwBGsjs8)
[![QQ-Gruppe](https://img.shields.io/badge/QQ%20群-754069680-green?logo=tencent-qq)](https://qm.qq.com/q/W4YC0PLMeA)

[Projekt-Highlights](#projekt-highlights) · [Kreativwerkzeuge](#kreativwerkzeuge) · [Unterhaltung & Arbeitsbereich](#unterhaltung-und-arbeitsbereich-gemeinsam-voran) · [Unterstützte Modelle](#unterstützte-modelle) · [Beispiele](#beispiele) · [Schnellstart](#schnellstart) · [Desktop](#desktop) · [Systemstruktur](#opencreator-systemstruktur) · [Entwicklung](#entwicklung) · [Dokumentation](#dokumentation) · [Mitwirkende](#mitwirkende) · [Star-Verlauf](#star-verlauf)

</div>

![OpenCreator Agent-Arbeitsbereich](../images/opencreator-home-en.png)

## Projektüberblick

OpenCreator richtet sich an Einzelpersonen und Teams, die kreative Arbeit und Entwicklung lokal ausführen möchten. Anstatt eine eigene Agent-Schleife neu zu implementieren, nutzt OpenCreator Codex CLI als Ausführungs-Engine und ergänzt sie um eine stabile lokale Runtime, einen visuellen Arbeitsbereich und einen Desktop-Host.

Das Produkt vereint zwei miteinander verbundene Arbeitsabläufe:

- **KI-Content-Erstellung**: Nutze spezielle Kreativwerkzeuge für Videoübersetzung, Video-Downloads, Thumbnail-Generierung und Bildgenerierung.
- **Allgemeiner Agent-Arbeitsbereich**: Organisiere Unterhaltungen nach Projekten, lasse Runs im Hintergrund weiterarbeiten und verwalte Genehmigungen, Anhänge, Dateien, Skills, MCP, Zeitpläne, Benachrichtigungen, Speicher und Diagnosen an einem Ort.

Web ist die einzige Frontend-Implementierung. Desktop lädt denselben Web-Build und ergänzt ausschließlich Funktionen, die das Betriebssystem erfordern, etwa die Auswahl von Verzeichnissen, den Fensterlebenszyklus, das Verhalten im Infobereich und native Benachrichtigungen. Bei identischen Daten und derselben Größe des Inhaltsbereichs teilen beide Plattformen dieselbe allgemeine Benutzeroberfläche und dasselbe Runtime-Verhalten.

## Projekt-Highlights

- 🤖 **Codex-nativ**: Nutze die Agent-Schleife, Modelle, Schlussfolgerungen, Werkzeugaufrufe, Unterhaltungen, Skills und MCP von Codex, ohne eine zweite Ausführungs-Engine pflegen zu müssen.

- 🚀 **Sofort einsatzbereite Desktop-App**: Starte OpenCreator direkt über die Desktop-App mit integriertem Codex CLI. Der lokale Runtime startet bei Bedarf und bereitet automatisch ein Standardprojekt vor.

- 🔄 **Verwaltete Runtime-Komponenten**: Prüfe die mitgelieferte, aktive und neueste yt-dlp-Version, suche regelmäßig nach Updates und aktualisiere manuell. Falls ein Update fehlschlägt, bleibt die aktuell funktionierende Version verfügbar.

- 🎨 **Multimodale Erstellung**: Erstelle und verwalte Videos, Bilder, Audio, Untertitel und Dokumente in einem zusammenhängenden Arbeitsablauf.

- 🔗 **Arbeitsablauf mit zwei Modi**: Arbeite wahlweise im visuellen Arbeitsbereich oder über eine Agent-Unterhaltung, während eine gemeinsame Zustandsmaschine Schritte, Fortschritt und Ergebnisse synchron hält.

- 🕘 **Versionierung**: Jede Überarbeitung erstellt eine neue Version und bewahrt frühere Einstellungen und Ergebnisse zur Prüfung und zum Vergleich auf.

- 🧩 **Skills und MCP**: Durchsuche, installiere und nutze Skills und verwalte MCP über die Codex-native Konfiguration.

- 🧠 **Speicher**: Bewahre globalen, projektbezogenen und Thread-Speicher zusammen mit Zusammenfassungen und reproduzierbaren Run-Eingabe-Snapshots auf.

- 🔐 **Lokale Sicherheit**: Daten, Anhänge und Protokolle bleiben standardmäßig lokal und werden durch Genehmigungen und bereinigte Diagnosen geschützt.

## Kreativwerkzeuge

Die aktuelle Version enthält vier Kreativwerkzeuge. Verfügbare Modelle und Dienste hängen von deiner lokalen Codex-Umgebung und den Einstellungen der KI-Dienste ab.

Öffne das Dashboard, um Videos zu übersetzen, öffentliche Videos herunterzuladen, Thumbnails zu generieren oder Bilder zu erstellen.

![OpenCreator Kreativ-Dashboard](../images/product/opencreator-dashboard-en.png)

> Weitere Kreativwerkzeuge werden fortlaufend ergänzt.

<table width="100%">
<thead>
<tr>
<th width="18%">Werkzeug</th>
<th width="14%">Status</th>
<th width="68%">Funktionen</th>
</tr>
</thead>
<tbody>
<tr><td valign="top">Videoübersetzung</td><td valign="top">✅ Verfügbar</td><td>Importiere lokale oder öffentliche Videos; transkribiere sie mit lokalen oder cloudbasierten Whisper-Diensten; nutze den LLM-Kontext für Segmentierung und Ausrichtung von Untertiteln, Terminologie und Übersetzung; konfiguriere zweisprachige Untertitel, Synchronisation oder ein eigenes Sprachbeispiel, Untertitelstile sowie Quer- oder Hochformat und exportiere SRT, Audio oder Video</td></tr>
<tr><td valign="top">Video-Downloader</td><td valign="top">✅ Verfügbar</td><td>Analysiere unterstützte öffentliche Links von YouTube, Bilibili und anderen Quellen, prüfe verfügbare Qualitäts- und Formatoptionen und lade Video oder Audio für nachfolgende Arbeitsabläufe herunter</td></tr>
<tr><td valign="top">Thumbnail-Generierung</td><td valign="top">✅ Verfügbar</td><td>Kombiniere ein Thema, einen Videolink und optional ein Referenzbild, um mehrere Varianten von Content-Thumbnails zu generieren und zu vergleichen</td></tr>
<tr><td valign="top">Bildgenerierung</td><td valign="top">✅ Verfügbar</td><td>Generiere mit GPT Image Bilder aus einem Prompt und einem optionalen Referenzbild, lege Seitenverhältnis und Anzahl der Ergebnisse fest und zeige einzelne Bilder in der Vorschau an oder lade sie herunter</td></tr>
<tr><td valign="top">Strichmännchen-Animation</td><td valign="top">Demnächst</td><td>Entwickle Figuren, Storyboards, Voiceover und Animation in einem geführten Arbeitsablauf</td></tr>
<tr><td valign="top">Automatische Clips</td><td valign="top">In Entwicklung</td><td>Analysiere lange Videos, finde Höhepunkte und verwandle ausgewählte Momente in wiederverwendbare kurze Clips</td></tr>
<tr><td valign="top">Intelligente Synchronisation</td><td valign="top">In Entwicklung</td><td>Verwandle Skripte in Voiceover und wähle Stimme, Tempo und Emotion</td></tr>
<tr><td valign="top">Videogenerierung</td><td valign="top">In Entwicklung</td><td>Generiere Videos aus Prompts und Referenzbildern, zeige das Ergebnis in der Vorschau an und exportiere es</td></tr>
<tr><td valign="top">Digitaler Avatar</td><td valign="top">In Entwicklung</td><td>Kombiniere Skripte, Stimme und Avatar-Darstellung zu Talking-Head-Videos</td></tr>
</tbody>
</table>

## Unterhaltung und Arbeitsbereich, gemeinsam voran

Beschreibe Aufgaben in natürlicher Sprache und wechsle zu visuellen Werkzeugen, wenn du präzise Kontrolle benötigst.

![OpenCreator-Unterhaltung und visueller Arbeitsbereich arbeiten zusammen](../images/examples/opencreator-auto-clips-en.png)

### Präzise Steuerung im Arbeitsbereich

Passe Untertitel, Szenen, Audio und Generierungseinstellungen genau an.

### Flexible Bearbeitung im Dialog

Teile dem Agent mit, was geändert werden soll, und verfeinere das Ergebnis in natürlicher Sprache.

### Synchronisierter Status

Unterhaltung und Arbeitsbereich teilen den aktuellen Aufgabenstatus, sodass du nichts wiederholen musst.

### Unabhängige Versionen

Jede Überarbeitung erstellt eine separate Version, ohne frühere Ergebnisse oder Einstellungen zu überschreiben.

## Unterstützte Modelle

Die Verfügbarkeit von Sprachmodellen richtet sich nach dem Codex-Modellkatalog oder deinem OpenAI-kompatiblen Anbieter. Bild-, Sprach- und Transkriptionsmodelle verwenden die unter **Einstellungen → KI-Dienste** konfigurierten Dienste.

### Sprachmodelle

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

### Bild

<table>
<tr>
<td align="center"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>GPT Image</strong></td>
</tr>
</table>

### Sprache und Transkription

<table>
<tr>
<td align="center" width="20%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>Whisper</strong></td>
<td align="center" width="20%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>OpenAI TTS</strong></td>
<td align="center" width="20%"><img src="https://github.com/MiniMax-AI.png?size=80" alt="MiniMax" width="40" height="40" /><br /><strong>MiniMax</strong></td>
<td align="center" width="20%"><img src="https://github.com/microsoft.png?size=80" alt="Microsoft" width="40" height="40" /><br /><strong>Edge TTS</strong></td>
<td align="center" width="20%"><img src="https://github.com/aliyun.png?size=80" alt="Alibaba Cloud" width="40" height="40" /><br /><strong>Aliyun Speech</strong></td>
</tr>
</table>

## Beispiele

### Videoübersetzung

Die folgenden öffentlichen Beispiele entstanden, als OpenCreator noch KrillinAI hieß. Sie zeigen den bewährten Arbeitsablauf für Untertitelausrichtung, Übersetzung, Synchronisation und Hochformatvideos, den der Arbeitsbereich Videoübersetzung von OpenCreator in einen umfassenderen Agent-Arbeitsablauf integriert.

Das Projekt erzeugte die unten gezeigte Untertiteldatei in einem einzigen Durchlauf aus einem 46-minütigen lokalen Video, ohne manuelle Anpassung der Untertitel. Das veröffentlichte Ergebnis deckt das Video vollständig ab, enthält keine überlappenden Zeilen und bietet eine natürliche Segmentierung sowie eine hochwertige Übersetzung.

![Beispiel für OpenCreator Untertitelausrichtung](../images/examples/krillinai-subtitle-alignment.png)

<table width="100%">
<tr>
<td width="33%">

#### Untertitelübersetzung

https://github.com/user-attachments/assets/bba1ac0a-fe6b-4947-b58d-ba99306d0339

</td>
<td width="33%">

#### Synchronisation

https://github.com/user-attachments/assets/0b32fad3-c3ad-4b6a-abf0-0865f0dd2385

</td>
<td width="33%">

#### Hochformat

https://github.com/user-attachments/assets/c2c7b528-0ef8-4ba9-b8ac-f9f92f6d4e71

</td>
</tr>
</table>

> Diese Videobeispiele und das Bild zur Untertitelausrichtung entstanden, als OpenCreator noch den Namen KrillinAI verwendete.

### Video-Download

Analysiere einen öffentlichen Videolink, vergleiche die verfügbaren Formate und lade Video oder Audio direkt in das Projekt herunter.

![Formatauswahl im OpenCreator Video-Downloader](../images/examples/video-downloader-formats-en.png)

### Strichmännchen-Animation (demnächst)

> Demnächst verfügbar. In der aktuellen Version noch nicht integriert.

OpenCreator hat diese Sammlung eigener Figuren gemeinsam mit dem Künstler [Harbor Hsia](https://www.behance.net/xiaheyuan1), dem Schöpfer von [Stickman auf Behance](https://www.behance.net/gallery/254715463/Stickman), entwickelt. Die vordefinierten Figuren werden für einen künftigen Story- und Animationsablauf mit konsistenten Charakteridentitäten vorbereitet.

![Gemeinsam mit Künstlern entwickelte OpenCreator Strichmännchen](../images/examples/stick-figure-characters.webp)

Der geplante Arbeitsablauf führt eine Figuren- und Storyidee durch Storyboard-Generierung, Szenenprüfung, Voice-over, Musik und versionierte Animationsausgabe.

![Beispielbild einer OpenCreator Strichmännchen-Animation](../images/examples/stick-figure-animation-frame.jpg)

## Schnellstart

### Voraussetzungen

- Node.js 22 oder neuer
- pnpm 9.15.0, festgelegt über das Feld `packageManager` des Repositorys
- Eine im Terminal verfügbare ausführbare Codex CLI
- Eine gültige Codex CLI-Anmeldung für echte Modellaufgaben

Prüfe zuerst deine lokale Umgebung:

```bash
node --version
pnpm --version
codex --version
```

### Web aus dem Quellcode ausführen

```bash
git clone https://github.com/krillinai/OpenCreator.git
cd OpenCreator
corepack enable
pnpm install
pnpm web:dev
```

Öffne `http://127.0.0.1:19861/`. Der Entwicklungsserver startet den lokalen Daemon bei Bedarf und injiziert über einen Same-Origin-Proxy ein temporäres Runtime-Token, sodass kein Verbindungstoken manuell kopiert werden muss.

Beim ersten Start bereitet die Runtime ein Standardprojekt vor. Das Eingabefeld ist verfügbar, sobald die Verbindung hergestellt ist. So arbeitest du ausschließlich am Daemon:

```bash
pnpm daemon:dev
```

Der Daemon lauscht nur auf einer Loopback-Adresse und gibt seine Verbindungsadresse sowie das temporäre Token einmalig auf stdout aus.

## Desktop

Desktop und Browser verwenden dasselbe React-Frontend aus `apps/web`. Allgemeines Verhalten für Projekte, Unterhaltungen, Aufgaben und Einstellungen ruft dieselben Daemon/API auf. Electron ergänzt lediglich echte Systempfade, Fenstersteuerung, Verhalten im Infobereich und native Benachrichtigungen.

### Entwicklungsmodus

```bash
pnpm desktop:dev
```

### Lokale Paketierung

| Befehl | Ausgabe |
| --- | --- |
| `pnpm desktop:package` | Ein ausführbares Verzeichnis für die aktuelle Plattform zur lokalen Überprüfung |
| `pnpm desktop:dist` | Ein Installationsprogramm für die aktuelle Plattform |
| `pnpm desktop:release` | Der Paketierungs-Einstiegspunkt für eine offizielle Veröffentlichung |
| `pnpm --filter @opencreator/desktop verify:package` | Überprüfung eines vorhandenen Desktop-Pakets |

Die Desktop-Paketierung baut Web aus dem aktuellen Arbeitsbereich neu, zeichnet Commit, Dirty-Status, Plattform, Architektur und Web-Hash auf und vergleicht `apps/web/dist` mit den in die Anwendung eingebetteten Ressourcen. Bei Abweichungen schlägt die Paketierung fehl. Einzelheiten zu Signierung, Notarisierung, Windows-Builds und Veröffentlichungsanforderungen findest du im [Desktop-Release-Runbook](../operations/opencreator-desktop-release-runbook.md).

## Zentrale Arbeitsabläufe

### Unterhaltungen und Runs

1. Wähle ein Projekt aus oder starte eine neue Unterhaltung.
2. Gib eine Aufgabe ein und wähle Berechtigungsstufe, Profile, Modell und Denkaufwand.
3. Während ein Run aktiv ist, kannst du Folgeaufgaben einreihen oder ihn unterbrechen und sofort fortfahren.
4. Prüfe in der Timeline Zusammenfassungen der Schlussfolgerungen, Werkzeugaufrufe, Dateiänderungen, Genehmigungen und Endergebnisse.
5. Verfolge im Aufgabencenter laufende, abgeschlossene, fehlgeschlagene und durch Genehmigungen blockierte Aufgaben zentral.

### Skills und MCP

- Durchsuche im Plugin-Center den Skill-Marktplatz, den Installationsverlauf und lokal verfügbare Skills.
- Wähle im Eingabefeld mit `/` oder über das Hinzufügen-Menü einen Skill, damit die nächste Aufgabe dessen Arbeitsablauf befolgt.
- Die MCP-Verwaltung verwendet Codex-native Befehle und Konfigurationen, anstatt eine zweite Ausführungs-Engine zu pflegen.
- OpenCreator verwendet standardmäßig das aktive `$CODEX_HOME`. Prüfe daher die Auswirkungen, bevor du globale Skills oder die MCP-Konfiguration änderst.

### Zeitpläne und dedizierte Aufgaben-Threads

- Jeder Zeitplan besitzt eine dauerhafte, dedizierte OpenCreator-Unterhaltung.
- Automatische Auslöser, manuelle Ausführungen und Folgeaufgaben des Benutzers verwenden diese Unterhaltung erneut und laufen gemäß der Richtlinie `queue` oder `skip` nacheinander ab.
- Beim Löschen eines Zeitplans wird dessen dedizierte Unterhaltung archiviert, während vorhandene Runs, Ergebnisse und der zugrunde liegende Codex-Verlauf erhalten bleiben.
- Das Rotieren oder Wiederherstellen eines zugrunde liegenden Codex-Threads ändert weder den OpenCreator-Aufgabeneintrag noch die Seitenroute.

## OpenCreator-Systemstruktur

OpenCreator behandelt den visuellen Arbeitsbereich und die Agent-Unterhaltung als zwei Oberflächen für dieselbe kreative Aufgabe und nicht als getrennte Arbeitsabläufe. Jeder Kreativablauf wird als Zustandsmaschine modelliert: Quelleingabe, Konfiguration, Generierung, Prüfung, Überarbeitung und Export werden zu eindeutigen Zuständen und Ereignissen. Aktionen im Arbeitsbereich und Befehle in Unterhaltungen gelangen in dieselbe Zustandsmaschine. Der aktuelle Schritt, die Konfiguration, der Fortschritt, die Versionen und die Ergebnisse werden wiederum in beiden Oberflächen dargestellt. So bleiben Arbeitsbereich und Unterhaltung synchron, ohne eine zweite Informationsquelle einzuführen.

Kreative Arbeit ist iterativ, daher überschreiben Überarbeitungen das aktuelle Ergebnis nicht. Jede Korrektur oder Neugenerierung erstellt aus dem bestehenden Zustand des Arbeitsablaufs eine neue Version. Einstellungen und Ergebnisse früherer Versionen bleiben zur Prüfung, zum Vergleich und zur weiteren Bearbeitung erhalten.

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

| OpenCreator-Komponente | Aufgabe | Implementierung |
| --- | --- | --- |
| Kreativerlebnis | Dashboard, Kreativwerkzeuge, Agent-Unterhaltung, Einstellungen und Dateien | `apps/web` · React 18 · Vite · TypeScript |
| Kollaborationskern | Synchronisiert Arbeitsschritte, Unterhaltungskontext, Fortschritt, Ergebnisse und Überarbeitungen | Gemeinsamer Workflow-Status · `CreatorCollaborationPanel` · Versionsverlauf |
| Lokaler Runtime | Verwaltet Projekte, Runs, Genehmigungen, Zeitpläne, Speicher und Benachrichtigungen | `apps/daemon` · Fastify · Runtime API · SSE |
| Runtime-Komponenten | Verfolgt mitgelieferte, aktive und neueste Versionen, prüft regelmäßig und installiert nur angeforderte Updates | yt-dlp nightly · Update-Prüfung · Rückgriff auf funktionierende Version |
| Codex-Engine | Stellt Agent-Schleife, Sitzungen, Schlussfolgerungen, Werkzeuge, Skills und MCP bereit | Codex CLI · app-server |
| Medienwerkzeuge | Lädt kreative Medien herunter, transkribiert, transformiert, generiert und exportiert sie | yt-dlp · Whisper · FFmpeg · konfigurierte KI-Dienste |
| Lokale Daten | Speichert Projektdaten, Runs, Anhänge, Ausgaben und Zugangsdaten lokal | SQLite · Dateisystem · System-Zugangsdatenverwaltung |
| Desktop-Host | Lädt den gemeinsamen Web-Build und ergänzt Betriebssystemfunktionen | `apps/desktop` · Electron · Preload Bridge |

Grundprinzipien:

- Arbeitsbereich und Agent-Unterhaltung sind synchronisierte Ansichten desselben Arbeitsablaufzustands. Beide senden Ereignisse an dieselbe Zustandsmaschine, anstatt parallele Aufgabenzustände zu pflegen.
- Überarbeitungen erstellen neue Versionen, statt vorhandene Ergebnisse zu ersetzen. Kontext und Ausgabe jeder kreativen Iteration bleiben erhalten.
- Das Frontend startet Codex nicht direkt und hängt nicht von Codex' unbearbeitetem JSONL-Ereignisformat ab.
- Der Daemon verwaltet Prozesslebenszyklus, Ereignisnormalisierung, Persistenz, Genehmigungen, Zeitpläne und die Benachrichtigungs-Outbox.
- Codex bleibt die maßgebliche Ausführungsquelle für Agent-Schleife, Skills und MCP.
- Browser Bridge und Desktop Bridge implementieren keine getrennten Kopien der allgemeinen Produktlogik.

## Repository-Struktur

```text
OpenCreator/
├── apps/
│   ├── web/          # Die einzige React-Frontend-Implementierung
│   ├── daemon/       # Lokaler Fastify Runtime und Codex-Adapter
│   ├── desktop/      # Electron Main, Preload, native Funktionen und Paketierung
│   └── harness/      # Kommandozeilenwerkzeug zur Runtime-Überprüfung
├── packages/
│   ├── protocol/     # Von Web, Daemon und Desktop gemeinsam genutzte Runtime-Verträge
│   └── skill-market/ # Modelle des Skill-Marktplatzes und gemeinsame Logik
├── docs/             # Designdokumente, API-Referenzen, Runbooks und Testberichte
├── scripts/          # Repository-weite Prüfungen
└── .runtime/         # Lokale Runtime-Daten, beim ersten Start erstellt
```

## Konfiguration

### API-Schlüssel für KI-Dienste

Öffne **Einstellungen → KI-Dienste**, um die Modell-, Transkriptions-, Audio- und Bildanbieter der aktuellen Arbeitsbereiche zu konfigurieren. Zur Vorbereitung auf kommende Kreativwerkzeuge können zusätzliche Dienstkategorien erscheinen. Jede Kategorie zeigt nur die für den ausgewählten Anbieter erforderlichen Felder an, darunter Base URL, API Key, Modell, Proxy oder anbieterspezifische Zugangsdaten.

![OpenCreator Einstellungen für API-Schlüssel von KI-Diensten](../images/product/opencreator-ai-services-en.png)

Zugangsdaten werden über den System-Zugangsspeicher der lokalen Runtime gespeichert und dürfen niemals in das Repository committet werden. Einige lokale oder systemgestützte Anbieter wie Edge TTS benötigen keinen API Key.

### Runtime-Komponenten von Drittanbietern

Öffne **Einstellungen → Drittanbieter-Komponenten**, um die derzeit verwendete yt-dlp-nightly-Version, die mit OpenCreator gelieferte Version, ihre Quelle und die neueste verfügbare Version zu prüfen. OpenCreator sucht alle sieben Tage nach Updates, installiert sie jedoch nie automatisch. Updates erfordern eine ausdrückliche Benutzeraktion. Falls Download, Prüfung oder Installation fehlschlagen, bleibt die aktuell funktionierende Version verfügbar.

![Einstellungen für OpenCreator-Drittanbieter-Komponenten](../images/product/opencreator-third-party-components-en.png)
### Runtime-Umgebungsvariablen

Die meisten Benutzer benötigen keine Umgebungsvariablen. Verwende sie, wenn du isolierte Daten, eine bestimmte Codex-Programmdatei oder ein benutzerdefiniertes Verzeichnis für verwaltete Projekte benötigst:

| Umgebungsvariable | Standardwert | Zweck |
| --- | --- | --- |
| `OPENCREATOR_DATA_DIR` | `.runtime` | OpenCreator-Datenbank, Runs, Anhänge und verwaltete Arbeitsbereiche |
| `OPENCREATOR_CODEX_BIN` | `codex` | Pfad zur ausführbaren Codex CLI |
| `CODEX_HOME` | `~/.codex` | Maßgebliche Quelle für Codex-Sitzungen, Konfiguration, Skills, MCP und Profiles |
| `OPENCREATOR_DEFAULT_CWD` | Aktuelles Arbeitsverzeichnis | Standardarbeitsverzeichnis des Daemons |
| `OPENCREATOR_DEFAULT_PROJECT_ROOT` | Runtime-Standardrichtlinie | Stammverzeichnis verwalteter Projekte; wenn festgelegt, verwendet OpenCreator dessen Unterverzeichnis `OpenCreator/` |
| `OPENCREATOR_CODEX_THREAD_ROTATION_RUN_THRESHOLD` | `50` | Schwellenwert beendeter Runs zum Rotieren des Codex-Threads hinter einem lang laufenden Zeitplan; mit `0` wird die proaktive Rotation deaktiviert |

So isolierst du beispielsweise sowohl Runtime-Daten als auch die Codex-Umgebung:

```bash
OPENCREATOR_DATA_DIR=/path/to/opencreator-data \
CODEX_HOME=/path/to/codex-home \
pnpm web:dev
```

## Daten und Sicherheit

Runtime-Daten werden standardmäßig unter `.runtime/` im Stammverzeichnis des Repositorys gespeichert:

| Pfad | Inhalt |
| --- | --- |
| `.runtime/app.sqlite` | Projekte, Threads, Runs, Ereignisse, Zeitpläne, Benachrichtigungen, Metadaten von Anhängen, Genehmigungen, Speicher und Zusammenfassungen |
| `.runtime/runs/` | Bereinigte Protokolle, Diagnosen und Metadaten einzelner Runs |
| `.runtime/attachments/` | Kontrollierte Anhangsdateien |
| `.runtime/workspaces/` | Vom Runtime verwaltete Projektarbeitsbereiche |

Codex-Sitzungen und -Konfiguration verbleiben in `$CODEX_HOME` und müssen getrennt von `.runtime/` gesichert werden.

Zu den Sicherheitsgrenzen gehören:

- Der Daemon lauscht ausschließlich auf `127.0.0.1`; jede API mit Ausnahme der Zustandsprüfung erfordert ein Bearer-Token.
- Die HTML-Vorschau deaktiviert standardmäßig Skripte, Navigation und Pop-ups und erlaubt nur kontrollierte relative Ressourcen aus demselben Arbeitsbereich.
- Sensibler Speicher erfordert eine zweite Bestätigung. OpenCreator speichert unbestätigte Vorschläge niemals automatisch und dauerhaft.
- Diagnosen und Run-Protokolle werden vor der Rückgabe oder dem Export bereinigt.
- Desktop-Pakete aktivieren ASAR-Integrität und Cookie-Verschlüsselung und deaktivieren RunAsNode, `NODE_OPTIONS` und den Node CLI Inspector.

Vollständige Anleitungen zu Sicherung, Wiederherstellung, Bereinigung und Zurücksetzen findest du im [Benutzerhandbuch und Leitfaden zur Fehlerbehebung](../opencreator-user-guide-and-troubleshooting.md).

## Entwicklung

### Häufige Befehle

| Befehl | Zweck |
| --- | --- |
| `pnpm web:dev` | Web starten und den lokalen Daemon bei Bedarf ausführen |
| `pnpm daemon:dev` | Nur den Daemon starten |
| `pnpm desktop:dev` | Abhängigkeiten bauen und Electron im Entwicklungsmodus starten |
| `pnpm test` | Unit- und Integrationstests des Arbeitsbereichs ausführen |
| `pnpm typecheck` | TypeScript-Prüfungen im gesamten Repository ausführen |
| `pnpm build` | Alle Workspaces bauen |
| `pnpm e2e` | Playwright-E2E-Tests für Web ausführen |
| `pnpm smoke:ci` | Runtime-Smoke-Test mit einem simulierten Codex ausführen |
| `pnpm perf:check` | Aufgezeichneten Leistungsreferenzwert prüfen |

Führe vor dem Einreichen einer Änderung mindestens Folgendes aus:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Änderungen an Desktop, Host Bridge, Runtime-Proxy oder gemeinsam genutzten Frontend-Arbeitsabläufen erfordern außerdem Web/Desktop-Konsistenztests, E2E-Tests der paketierten Anwendung und eine Überprüfung des Web-Build-Hashs. Das Bestehen der Web-Unit-Tests allein belegt nicht, dass Desktop veröffentlichungsbereit ist.

Der Smoke-Test mit echtem Codex ist standardmäßig deaktiviert. Aktiviere ihn ausdrücklich mit:

```bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

## Dokumentation

- [Benutzerhandbuch und Fehlerbehebung](../opencreator-user-guide-and-troubleshooting.md)
- [Runtime API v1](../runtime-api-for-ui-v1.md)
- [Design der Codex-nativen Runtime](../2026-07-03-codex-native-agent-runtime-design.md)
- [Desktop-Release-Runbook](../operations/opencreator-desktop-release-runbook.md)
- [Leitfaden für Windows-Desktop-Releases](../operations/opencreator-desktop-windows-release.md)
- [Richtlinien für visuelle Komponenten](../visual-component-guidelines.md)

## Übersetzungskonvention

Die Datei `README.md` im Stammverzeichnis ist das maßgebliche englische Dokument. Gepflegte Übersetzungen befinden sich unter `docs/<locale>/README.md`. Füge eine Sprache erst dann zur Sprachauswahl hinzu, wenn das vollständige Dokument übersetzt und mit der englischen Struktur synchronisiert wurde.

## Mitwirken

1. Beschreibe Problem, Anwendungsfall und erwartetes Verhalten in den [Issues](https://github.com/krillinai/OpenCreator/issues).
2. Erstelle vom neuesten Entwicklungsbranch einen fokussierten Feature- oder Fix-Branch.
3. Folge der bestehenden Architektur: Implementiere allgemeine Produktfunktionen einmal in Web und Daemon und isoliere native Unterschiede hinter ausdrücklichen Capabilities.
4. Ergänze angemessene Unit-, Integrations- oder E2E-Abdeckung für Verhaltensänderungen und führe im Pull Request sowohl abgeschlossene als auch ausgelassene Prüfungen auf.
5. Committe niemals `.runtime/`, lokale Zugangsdaten, Codex-Sitzungen, Build-Caches oder andere Benutzerdaten.

## Mitwirkende

Vielen Dank an alle, die mit Code, Dokumentation, Feedback, Fehlerberichten, Skills, Designs und Ideen beigetragen haben.

<a href="https://github.com/krillinai/KrillinAI/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=krillinai/KrillinAI&amp;max=500&amp;columns=20" alt="OpenCreator Mitwirkende" />
</a>

## Star-Verlauf

OpenCreator hieß früher KrillinAI. Dieses Diagramm zeigt den vollständigen Verlauf des Repositorys vor und nach der Umbenennung.

[![OpenCreator Star-Verlauf](https://api.star-history.com/svg?repos=krillinai/KrillinAI&type=Date)](https://star-history.com/#krillinai/KrillinAI&Date)

## Verwandte Projekte

| Projekt | Aufgabe |
| --- | --- |
| [OpenAI Codex](https://github.com/openai/codex) | Agent-Ausführungs-Engine für Modellzugriff, Schlussfolgerungen, Werkzeugaufrufe, Sitzungen, Skills und MCP-Integration. |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Prüft unterstützte öffentliche Medienlinks, listet verfügbare Formate auf und lädt Video oder Audio für Kreativabläufe herunter. |
| [FFmpeg](https://ffmpeg.org/) | FFmpeg und ffprobe übernehmen Medienkonvertierung, Komposition, Frame-Extraktion und Ausgabeprüfung. |
| [Whisper](https://github.com/openai/whisper), [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [faster-whisper](https://github.com/SYSTRAN/faster-whisper) und [WhisperKit](https://github.com/argmaxinc/WhisperKit) | Cloud- und plattformspezifische lokale Sprachtranskriptionsoptionen, ausgewählt nach den verfügbaren Runtime-Funktionen. |
| [React](https://react.dev/) | Grundlage der gemeinsamen Benutzeroberfläche für Web und Desktop. |
| [Fastify](https://fastify.dev/) | HTTP- und API-Grundlage des lokalen Runtime. |
| [Electron](https://www.electronjs.org/) | Desktop-Host für native Systemfunktionen, Anwendungslebenszyklus und Paketierung. |
| [SQLite](https://www.sqlite.org/) | Lokale Speicherung für Projekte, Unterhaltungen, Runs, Zeitpläne, Speicher und weitere Arbeitsbereichsdaten. |
| [Model Context Protocol](https://modelcontextprotocol.io/) | Offenes Protokoll zum Verbinden externer Werkzeuge und Dienste mit dem Agent-Arbeitsbereich. |

---

<div align="center">

**OpenCreator · Lokal erstellen, kontinuierlich arbeiten.**

</div>
