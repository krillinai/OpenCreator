<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../images/OpenCreator_logo_vector_dark.svg" />
    <img src="../images/OpenCreator_logo_vector.svg" alt="OpenCreator" width="380" />
  </picture>
  <br />
  クリエイターのためのオープンソース AI ワークスペース
</h1>

<p>脚本から動画、画像、音声、アバター、翻訳、編集まで、Agent がひとつのワークスペースで制作プロセス全体を前進させます。</p>

<p><strong>OpenCreator の旧称は KrillinAI です。</strong></p>

<a href="https://trendshift.io/repositories/13360" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13360" alt="OpenCreator（旧称 KrillinAI）：Trendshift Repository of the Day 第1位" width="250" height="55" /></a>

[English](../../README.md) | [简体中文](../zh/README.md) | **日本語** | [한국어](../ko/README.md) | [Bahasa Indonesia](../id/README.md) | [Español](../es/README.md) | [Français](../fr/README.md) | [Deutsch](../de/README.md) | [Português](../pt/README.md) | [Русский](../ru/README.md) | [العربية](../ar/README.md)

[![GitHub Stars](https://img.shields.io/github/stars/krillinai/OpenCreator?style=flat&logo=github&label=Stars&color=gold)](https://github.com/krillinai/OpenCreator/stargazers)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Bilibili](https://img.shields.io/badge/dynamic/json?label=Bilibili&query=%24.data.follower&suffix=%E7%B2%89%E4%B8%9D&url=https%3A%2F%2Fapi.bilibili.com%2Fx%2Frelation%2Fstat%3Fvmid%3D242124650&logo=bilibili&color=00A1D6&labelColor=FE7398&logoColor=FFFFFF)](https://space.bilibili.com/242124650)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/3GwBGsjs8)
[![QQ グループ](https://img.shields.io/badge/QQ%20群-754069680-green?logo=tencent-qq)](https://qm.qq.com/q/W4YC0PLMeA)

[主な特徴](#主な特徴) · [制作ツール](#制作ツール) · [会話とワークスペース](#会話とワークスペースを連携して進める) · [対応モデル](#対応モデル) · [活用例](#活用例) · [クイックスタート](#クイックスタート) · [Desktop](#desktop) · [システム構成](#opencreator-システム構成) · [開発](#開発) · [ドキュメント](#ドキュメント) · [コントリビューター](#コントリビューター) · [Star 履歴](#star-履歴)

</div>

![OpenCreator Agent ワークスペース](../images/opencreator-home-en.png)

## プロジェクト概要

OpenCreator は、制作や開発の作業をローカル環境で継続的に進めたい個人やチーム向けに設計されています。独自の Agent ループを再実装するのではなく、Codex CLI を実行エンジンとして利用し、その上に安定したローカル Runtime、ビジュアルワークスペース、Desktop ホストを提供します。

本製品は、相互に連携する2つのワークフローを統合しています。

- **AI コンテンツ制作**：動画翻訳、動画ダウンロード、サムネイル生成、画像生成の専用制作ツールを利用できます。
- **汎用 Agent ワークスペース**：会話をプロジェクト単位で整理し、Run をバックグラウンドで継続しながら、承認、添付ファイル、ファイル、Skills、MCP、スケジュール、通知、メモリ、診断を一元管理できます。

Web が唯一のフロントエンド実装です。Desktop は同じ Web ビルドを読み込み、ディレクトリ選択、ウィンドウのライフサイクル、トレイ、ネイティブ通知など、OS が必要な機能だけを追加します。同じデータとコンテンツビューポートを使用する場合、両プラットフォームで共通の UI と Runtime の動作が一致します。

## 主な特徴

- 🤖 **Codex ネイティブ**：別の実行エンジンを保守することなく、Codex の Agent ループ、モデル、推論、ツール呼び出し、会話、Skills、MCP をそのまま活用できます。

- 🚀 **すぐに使える Desktop アプリ**：Codex CLI を同梱した Desktop アプリから OpenCreator を直接起動できます。ローカル Runtime は必要に応じて起動し、デフォルトプロジェクトを自動的に準備します。

- 🔄 **管理された Runtime コンポーネント**：同梱中、使用中、最新版の yt-dlp を確認し、定期的な更新チェックと手動更新を行えます。更新に失敗した場合も、現在動作しているバージョンを保持します。

- 🎨 **マルチモーダル制作**：動画、画像、音声、字幕、ドキュメントを1つの連携したワークフローで制作・管理できます。

- 🔗 **2つの操作モード**：ビジュアルワークスペースと Agent 会話のどちらからでも作業でき、共通のステートマシンが手順、進捗、結果を同期します。

- 🕘 **バージョン管理**：修正のたびに新しいバージョンを作成し、以前の設定と出力を比較・確認できる状態で保持します。

- 🧩 **Skills と MCP**：Skills を閲覧、インストール、実行し、Codex ネイティブ設定を通じて MCP を管理できます。

- 🧠 **メモリ**：グローバル、プロジェクト、スレッド単位のメモリを保持し、要約と再現可能な Run 入力スナップショットを保存します。

- 🔐 **ローカルセキュリティ**：データ、添付ファイル、ログはデフォルトでローカルに保持され、承認と秘匿化された診断情報を利用できます。

## 制作ツール

現行リリースには、4つの制作ツールが含まれています。利用可能なモデルとサービスは、ローカルの Codex 環境および AI サービス設定によって異なります。

Dashboard から、動画翻訳、公開動画のダウンロード、サムネイル生成、画像生成を開始できます。

![OpenCreator 制作 Dashboard](../images/product/opencreator-dashboard-en.png)

> 制作ツールは今後も順次追加されます。

<table width="100%">
<thead>
<tr>
<th width="18%">制作ツール</th>
<th width="14%">状態</th>
<th width="68%">機能</th>
</tr>
</thead>
<tbody>
<tr><td valign="top">動画翻訳</td><td valign="top">✅ 利用可能</td><td>ローカルまたは公開動画を読み込み、クラウドまたはローカルの Whisper サービスで文字起こしを実行します。LLM のコンテキストを活用して字幕の分割、位置合わせ、用語処理、翻訳を行い、二言語字幕、吹き替えまたはカスタム音声サンプル、字幕スタイル、横向き・縦向きの構成を設定し、SRT、音声、動画として書き出せます</td></tr>
<tr><td valign="top">動画ダウンロード</td><td valign="top">✅ 利用可能</td><td>YouTube、Bilibili など、対応する公開リンクを解析し、利用可能な画質と形式を確認して、後続の制作に使用する動画または音声をダウンロードできます</td></tr>
<tr><td valign="top">サムネイル生成</td><td valign="top">✅ 利用可能</td><td>テーマ、動画リンク、任意の参照画像を組み合わせ、複数のコンテンツ用サムネイル案を生成して比較できます</td></tr>
<tr><td valign="top">画像生成</td><td valign="top">✅ 利用可能</td><td>プロンプトと任意の参照画像から GPT Image で画像を生成し、アスペクト比と生成枚数を設定して、各画像をプレビュー・ダウンロードできます</td></tr>
<tr><td valign="top">スティックフィギュアアニメーション</td><td valign="top">近日公開</td><td>ガイド付きワークフローでキャラクター、絵コンテ、ナレーション、アニメーションを制作します</td></tr>
<tr><td valign="top">自動クリップ</td><td valign="top">開発中</td><td>長尺動画を分析して見どころを特定し、選択した場面を再利用可能な短いクリップに仕上げます</td></tr>
<tr><td valign="top">スマート吹き替え</td><td valign="top">開発中</td><td>音声、テンポ、感情表現を選び、脚本からナレーションを生成します</td></tr>
<tr><td valign="top">動画生成</td><td valign="top">開発中</td><td>プロンプトと参照画像から動画を生成し、プレビューして書き出します</td></tr>
<tr><td valign="top">デジタルアバター</td><td valign="top">開発中</td><td>脚本、音声、アバター表現を組み合わせ、トーキングヘッド動画を制作します</td></tr>
</tbody>
</table>

## 会話とワークスペースを連携して進める

タスクを自然な言葉で伝え、細かな調整が必要になったらビジュアルツールへ移れます。

![OpenCreator の会話とビジュアルワークスペースの連携](../images/examples/opencreator-auto-clips-en.png)

### 細かなワークスペース操作

字幕、ショット、音声、生成設定を正確に調整できます。

### 柔軟な会話による編集

変更内容を Agent に伝え、自然な言葉で結果を継続的に改善できます。

### 同期された状態

会話とワークスペースが現在のタスク状態を共有するため、同じ説明を繰り返す必要はありません。

### 独立したバージョン

修正のたびに以前の結果や設定を上書きせず、独立したバージョンを作成します。

## 対応モデル

言語モデルは Codex のモデルカタログ、または設定した OpenAI 互換プロバイダーから利用できます。画像、音声、文字起こしモデルには **設定 → AI サービス** で構成したサービスを使用します。

### 言語モデル

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

### 画像

<table>
<tr>
<td align="center"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>GPT Image</strong></td>
</tr>
</table>

### 音声と文字起こし

<table>
<tr>
<td align="center" width="20%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>Whisper</strong></td>
<td align="center" width="20%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>OpenAI TTS</strong></td>
<td align="center" width="20%"><img src="https://github.com/MiniMax-AI.png?size=80" alt="MiniMax" width="40" height="40" /><br /><strong>MiniMax</strong></td>
<td align="center" width="20%"><img src="https://github.com/microsoft.png?size=80" alt="Microsoft" width="40" height="40" /><br /><strong>Edge TTS</strong></td>
<td align="center" width="20%"><img src="https://github.com/aliyun.png?size=80" alt="Alibaba Cloud" width="40" height="40" /><br /><strong>Aliyun Speech</strong></td>
</tr>
</table>

## 活用例

### 動画翻訳

以下の公開例は、OpenCreator がまだ KrillinAI という名称だった時期に制作されたものです。字幕の位置合わせ、翻訳、吹き替え、縦向き動画のワークフローを、現在の OpenCreator の動画翻訳ワークスペースがより広範な Agent ワークフローへ統合していることを示しています。

このプロジェクトでは、46分のローカル動画から、字幕を手作業で調整することなく1回の実行で以下の字幕ファイルを生成しました。公開結果では、字幕の欠落や重複がなく、自然な文分割と高品質な翻訳を実現しています。

![OpenCreator 字幕位置合わせの例](../images/examples/krillinai-subtitle-alignment.png)

<table width="100%">
<tr>
<td width="33%">

#### 字幕翻訳

https://github.com/user-attachments/assets/bba1ac0a-fe6b-4947-b58d-ba99306d0339

</td>
<td width="33%">

#### 吹き替え

https://github.com/user-attachments/assets/0b32fad3-c3ad-4b6a-abf0-0865f0dd2385

</td>
<td width="33%">

#### 縦向きモード

https://github.com/user-attachments/assets/c2c7b528-0ef8-4ba9-b8ac-f9f92f6d4e71

</td>
</tr>
</table>

> これらの動画例と字幕位置合わせ画像は、OpenCreator が KrillinAI という名称を使用していた時期に制作されました。

### 動画ダウンロード

公開動画のリンクを解析し、利用可能な形式を比較して、動画または音声をプロジェクトへ直接ダウンロードできます。

![OpenCreator 動画ダウンロードの形式選択](../images/examples/video-downloader-formats-en.png)

### スティックフィギュアアニメーション（近日公開）

> 近日公開予定です。現行バージョンにはまだ搭載されていません。

OpenCreator は、[Stickman on Behance](https://www.behance.net/gallery/254715463/Stickman) の作者であるアーティスト [Harbor Hsia](https://www.behance.net/xiaheyuan1) と共同で、このオリジナルキャラクターコレクションを開発しました。統一されたキャラクター表現を持つ、将来のストーリー・アニメーション制作ワークフローに向けて準備を進めています。

![アーティストと共同開発した OpenCreator のスティックフィギュアキャラクター](../images/examples/stick-figure-characters.webp)

計画中のワークフローでは、キャラクターとストーリーのアイデアから、絵コンテ生成、ショット確認、ナレーション、音楽、バージョン管理されたアニメーション出力までを案内します。

![OpenCreator スティックフィギュアアニメーションのサンプルフレーム](../images/examples/stick-figure-animation-frame.jpg)

## クイックスタート

### 必要環境

- Node.js 22 以降
- リポジトリの `packageManager` フィールドで固定されている pnpm 9.15.0
- ターミナルから実行可能な Codex CLI
- 実際のモデルタスクを実行するための有効な Codex CLI ログイン

まずローカル環境を確認します。

```bash
node --version
pnpm --version
codex --version
```

### ソースから Web を起動

```bash
git clone https://github.com/krillinai/OpenCreator.git
cd OpenCreator
corepack enable
pnpm install
pnpm web:dev
```

`http://127.0.0.1:19861/` を開きます。開発サーバーは必要に応じてローカル daemon を起動し、同一オリジンのプロキシを通じて一時的な Runtime トークンを注入するため、接続トークンを手動でコピーする必要はありません。

初回起動時に Runtime がデフォルトプロジェクトを準備します。接続が完了すると、すぐに入力欄を使用できます。daemon のみを操作する場合は、次を実行します。

```bash
pnpm daemon:dev
```

daemon はローカルのループバックアドレスだけをリッスンし、接続アドレスと一時トークンを標準出力へ一度だけ表示します。

## Desktop

Desktop とブラウザ版は、`apps/web` にある同じ React フロントエンドを使用します。プロジェクト、会話、タスク、設定などの共通機能は、同じ Daemon/API を呼び出します。Electron は実際のシステムパス、ウィンドウ操作、トレイ、ネイティブ通知だけを追加します。

### 開発モード

```bash
pnpm desktop:dev
```

### ローカルパッケージング

| コマンド | 出力 |
| --- | --- |
| `pnpm desktop:package` | 現在のプラットフォーム向けの実行可能ディレクトリ。ローカル検証用 |
| `pnpm desktop:dist` | 現在のプラットフォーム向けインストーラー |
| `pnpm desktop:release` | 正式リリース用パッケージングのエントリーポイント |
| `pnpm --filter @opencreator/desktop verify:package` | 既存の Desktop パッケージを検証 |

Desktop のパッケージングでは、現在のワークスペースから Web を再ビルドし、コミット、dirty 状態、プラットフォーム、アーキテクチャ、Web ハッシュを記録したうえで、`apps/web/dist` とアプリケーション内のリソースを比較します。一致しない場合、パッケージングは失敗します。署名、公証、Windows ビルド、リリース要件については、[Desktop リリース運用ガイド](../operations/opencreator-desktop-release-runbook.md)を参照してください。

## コアワークフロー

### 会話と Run

1. プロジェクトを選択するか、新しい会話を開始します。
2. タスクを入力し、権限レベル、Profile、モデル、推論強度を選択します。
3. Run の実行中は、後続タスクをキューに追加するか、現在の処理を中断してすぐに続行できます。
4. Timeline で推論の要約、ツール呼び出し、ファイル変更、承認、最終結果を確認します。
5. タスクセンターで、実行中、完了、失敗、承認待ちのタスクを一元的に追跡します。

### Skills と MCP

- プラグインセンターで Skill マーケットプレイス、インストール履歴、ローカルで利用可能な Skills を閲覧できます。
- 入力欄で `/` または追加メニューから Skill を選択すると、次のタスクがそのワークフローに従います。
- MCP の管理は、別の実行エンジンを保守するのではなく、Codex ネイティブのコマンドと設定を利用します。
- OpenCreator はデフォルトで現在の `$CODEX_HOME` を使用するため、グローバルな Skills や MCP の設定を変更する前に影響範囲を確認してください。

### スケジュールと専用タスクスレッド

- 各スケジュールは、永続的な専用 OpenCreator 会話を持ちます。
- 自動トリガー、手動実行、ユーザーのフォローアップは同じ会話を再利用し、`queue` または `skip` ポリシーに従って直列実行されます。
- スケジュールを削除すると専用会話はアーカイブされますが、既存の Runs、結果、基盤となる Codex 履歴は保持されます。
- 基盤となる Codex スレッドのローテーションや復旧が行われても、OpenCreator のタスクエントリーやページルートは変わりません。

## OpenCreator システム構成

OpenCreator は、ビジュアルワークスペースと Agent 会話を別々のワークフローではなく、同じ制作タスクに対する2つのインターフェースとして扱います。各制作ワークフローはステートマシンとしてモデル化され、素材入力、設定、生成、確認、修正、書き出しが明確な状態とイベントになります。ワークスペースの操作と会話コマンドは同じステートマシンへ入り、現在の手順、設定、進捗、バージョン、結果が両方のインターフェースへ反映されます。これにより、別の情報源を増やすことなくワークスペースと会話を同期できます。

制作は反復的な作業であるため、修正によって現在の結果が上書きされることはありません。修正または再生成のたびに既存のワークフロー状態から新しいバージョンを作成し、以前の設定と出力を確認、比較、継続的に改善できる状態で保持します。

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

| OpenCreator コンポーネント | 役割 | 実装 |
| --- | --- | --- |
| 制作体験 | Dashboard、制作ツール、Agent 会話、設定、ファイルを提供 | `apps/web` · React 18 · Vite · TypeScript |
| コラボレーションコア | ワークスペースの手順、会話コンテキスト、進捗、結果、修正履歴を同期 | 共通ワークフロー状態 · `CreatorCollaborationPanel` · バージョン履歴 |
| ローカル Runtime | プロジェクト、Runs、承認、スケジュール、メモリ、通知を管理 | `apps/daemon` · Fastify · Runtime API · SSE |
| Runtime コンポーネント | 同梱中、使用中、最新版を追跡し、定期確認とユーザー指定の更新のみを実行 | yt-dlp nightly · 更新検証 · 動作中バージョンへのフォールバック |
| Codex エンジン | Agent ループ、セッション、推論、ツール、Skills、MCP を提供 | Codex CLI · app-server |
| メディアツールチェーン | クリエイティブメディアをダウンロード、文字起こし、変換、生成、書き出し | yt-dlp · Whisper · FFmpeg · 設定済み AI サービス |
| ローカルデータ | プロジェクトデータ、Runs、添付ファイル、出力、認証情報をローカルに保存 | SQLite · ファイルシステム · システム認証情報ストレージ |
| Desktop ホスト | 共通 Web ビルドを読み込み、OS 固有機能を追加 | `apps/desktop` · Electron · Preload Bridge |

基本原則：

- ワークスペースと Agent 会話は、同じワークフロー状態を同期して表示します。両方が同じステートマシンへイベントを送り、別々のタスク状態を持ちません。
- 修正時は既存の結果を置き換えずに新しいバージョンを作成し、各制作イテレーションのコンテキストと出力を保持します。
- フロントエンドは Codex を直接起動せず、Codex の生の JSONL イベント形式にも依存しません。
- daemon がプロセスのライフサイクル、イベントの正規化、永続化、承認、スケジュール、通知 outbox を管理します。
- Agent ループ、Skills、MCP の実行において、Codex が引き続き唯一の信頼できる情報源です。
- Browser Bridge と Desktop Bridge が汎用製品ロジックを別々に実装することはありません。

## リポジトリ構成

```text
OpenCreator/
├── apps/
│   ├── web/          # 唯一の React フロントエンド実装
│   ├── daemon/       # ローカル Fastify Runtime と Codex アダプター
│   ├── desktop/      # Electron Main、Preload、ネイティブ機能、パッケージング
│   └── harness/      # Runtime コマンドライン検証ツール
├── packages/
│   ├── protocol/     # Web、Daemon、Desktop で共有する Runtime 契約
│   └── skill-market/ # Skill マーケットプレイスのモデルと共通ロジック
├── docs/             # 設計、API リファレンス、運用ガイド、テストレポート
├── scripts/          # リポジトリレベルのチェック
└── .runtime/         # 初回起動時に作成されるローカル Runtime データ
```

## 設定

### AI サービスの API キー

**Settings → AI Services** を開き、現在のワークスペースで使用するモデル、文字起こし、音声、画像プロバイダーを設定します。今後追加予定の制作ツールに備えて、追加のサービスカテゴリが表示される場合があります。各カテゴリには、選択したプロバイダーに必要な Base URL、API Key、モデル、プロキシ、プロバイダー固有の認証情報だけが表示されます。

![OpenCreator AI Services API Key 設定](../images/product/opencreator-ai-services-en.png)

認証情報はローカル Runtime のシステム認証情報ストレージに保存され、リポジトリへコミットしてはいけません。Edge TTS など、一部のローカルまたはシステムベースのプロバイダーでは API Key は不要です。

### サードパーティ Runtime コンポーネント

**設定 → サードパーティコンポーネント** を開くと、現在使用中の yt-dlp nightly バージョン、OpenCreator に同梱されたバージョン、その取得元、利用可能な最新版を確認できます。OpenCreator は7日ごとに更新を確認しますが、自動インストールは行いません。更新には明示的なユーザー操作が必要で、ダウンロード、検証、インストールに失敗した場合も現在動作しているバージョンを継続して使用できます。

![OpenCreator のサードパーティコンポーネント設定](../images/product/opencreator-third-party-components-en.png)
### Runtime 環境変数

ほとんどのユーザーは環境変数を設定する必要はありません。データを分離したい場合、特定の Codex 実行ファイルを使用したい場合、または管理対象プロジェクトのディレクトリを変更したい場合に使用します。

| 環境変数 | デフォルト | 用途 |
| --- | --- | --- |
| `OPENCREATOR_DATA_DIR` | `.runtime` | OpenCreator のデータベース、Runs、添付ファイル、管理対象ワークスペース |
| `OPENCREATOR_CODEX_BIN` | `codex` | Codex CLI 実行ファイルのパス |
| `CODEX_HOME` | `~/.codex` | Codex セッション、設定、Skills、MCP、Profiles の信頼できる情報源 |
| `OPENCREATOR_DEFAULT_CWD` | 現在の作業ディレクトリ | daemon のデフォルト作業ディレクトリ |
| `OPENCREATOR_DEFAULT_PROJECT_ROOT` | Runtime のデフォルトポリシー | 管理対象プロジェクトのルート。設定した場合、OpenCreator はその配下の `OpenCreator/` ディレクトリを使用します |
| `OPENCREATOR_CODEX_THREAD_ROTATION_RUN_THRESHOLD` | `50` | 長時間実行スケジュールの背後にある Codex スレッドをローテーションする終端 Run 数のしきい値。`0` で予防的ローテーションを無効化します |

Runtime データと Codex 環境の両方を分離する例：

```bash
OPENCREATOR_DATA_DIR=/path/to/opencreator-data \
CODEX_HOME=/path/to/codex-home \
pnpm web:dev
```

## データとセキュリティ

Runtime データは、デフォルトでリポジトリルートの `.runtime/` に保存されます。

| パス | 内容 |
| --- | --- |
| `.runtime/app.sqlite` | プロジェクト、スレッド、Runs、イベント、スケジュール、通知、添付ファイルのメタデータ、承認、メモリ、要約 |
| `.runtime/runs/` | 各 Run の秘匿化されたログ、診断、メタデータ |
| `.runtime/attachments/` | 管理された添付ファイル |
| `.runtime/workspaces/` | Runtime が管理するプロジェクトワークスペース |

Codex のセッションと設定は引き続き `$CODEX_HOME` に保存されるため、`.runtime/` とは別にバックアップする必要があります。

セキュリティ境界：

- daemon は `127.0.0.1` だけをリッスンし、ヘルスチェックを除くすべての API で Bearer トークンを要求します。
- HTML プレビューでは、スクリプト、ナビゲーション、ポップアップをデフォルトで無効化し、管理された同一ワークスペース内の相対リソースだけを許可します。
- 機密メモリには2回目の確認が必要です。OpenCreator が未確認の提案を自動的かつ永続的に保存することはありません。
- 診断情報と Run ログは、返却またはエクスポートされる前に秘匿化されます。
- Desktop パッケージは ASAR の整合性と Cookie 暗号化を有効にし、RunAsNode、`NODE_OPTIONS`、Node CLI Inspector を無効化します。

バックアップ、復元、クリーンアップ、リセットの詳細は、[ユーザーガイドとトラブルシューティング](../opencreator-user-guide-and-troubleshooting.md)を参照してください。

## 開発

### よく使うコマンド

| コマンド | 用途 |
| --- | --- |
| `pnpm web:dev` | Web を起動し、必要に応じてローカル daemon を起動 |
| `pnpm daemon:dev` | daemon のみを起動 |
| `pnpm desktop:dev` | 依存関係をビルドして Electron を開発モードで起動 |
| `pnpm test` | ワークスペースのユニットテストと統合テストを実行 |
| `pnpm typecheck` | リポジトリ全体の TypeScript チェックを実行 |
| `pnpm build` | すべての workspace をビルド |
| `pnpm e2e` | Web の Playwright E2E テストを実行 |
| `pnpm smoke:ci` | fake Codex Runtime スモークテストを実行 |
| `pnpm perf:check` | 記録済みのパフォーマンス基準を確認 |

変更を提出する前に、少なくとも次を実行してください。

```bash
pnpm test
pnpm typecheck
pnpm build
```

Desktop、Host Bridge、Runtime プロキシ、または共通フロントエンドワークフローを変更した場合は、Web/Desktop 整合性テスト、パッケージ済みアプリの E2E、Web ビルドハッシュの検証も必要です。Web のユニットテストに合格しただけでは、Desktop をリリースできることの証明にはなりません。

実際の Codex スモークテストはデフォルトで無効です。明示的に有効化するには、次を実行します。

```bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

## ドキュメント

- [ユーザーガイドとトラブルシューティング](../opencreator-user-guide-and-troubleshooting.md)
- [Runtime API v1](../runtime-api-for-ui-v1.md)
- [Codex ネイティブ Runtime 設計](../2026-07-03-codex-native-agent-runtime-design.md)
- [Desktop リリース運用ガイド](../operations/opencreator-desktop-release-runbook.md)
- [Windows Desktop リリースガイド](../operations/opencreator-desktop-windows-release.md)
- [ビジュアルコンポーネントガイドライン](../visual-component-guidelines.md)

## 翻訳方針

ルートの `README.md` を正本となる英語ドキュメントとします。保守対象の翻訳は `docs/<locale>/README.md` に配置します。英語版と同じ構成ですべての内容を翻訳・同期した後にのみ、言語切り替えへ追加してください。

## コントリビューション

1. [Issues](https://github.com/krillinai/OpenCreator/issues) に問題、ユースケース、期待する動作を記載してください。
2. 最新の開発ブランチから、目的を絞った機能追加または修正ブランチを作成してください。
3. 既存のアーキテクチャに従い、汎用製品機能は Web と Daemon に一度だけ実装し、ネイティブ固有の差異は明示的な capability の背後へ分離してください。
4. 動作変更に応じたユニット、統合、E2E テストを追加し、Pull Request に実施済みと未実施の検証を明記してください。
5. `.runtime/`、ローカル認証情報、Codex セッション、ビルドキャッシュ、その他のユーザーデータをコミットしないでください。

## コントリビューター

本プロジェクトにコード、ドキュメント、フィードバック、Issue、Skills、デザイン、アイデアで参加してくださったすべての方に感謝します。

<a href="https://github.com/krillinai/KrillinAI/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=krillinai/KrillinAI&amp;max=500&amp;columns=20" alt="OpenCreator コントリビューター" />
</a>

## Star 履歴

OpenCreator の旧称は KrillinAI です。このグラフには、名称変更前後を含むリポジトリ全体の履歴が表示されます。

[![OpenCreator Star 履歴](https://api.star-history.com/svg?repos=krillinai/KrillinAI&type=Date)](https://star-history.com/#krillinai/KrillinAI&Date)

## 関連プロジェクト

| プロジェクト | 役割 |
| --- | --- |
| [OpenAI Codex](https://github.com/openai/codex) | モデルアクセス、推論、ツール呼び出し、セッション、Skills、MCP 連携を支える Agent 実行エンジンです。 |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | 対応する公開メディアリンクを解析し、利用可能な形式を一覧表示して、制作ワークフロー用の動画や音声をダウンロードします。 |
| [FFmpeg](https://ffmpeg.org/) | FFmpeg と ffprobe がメディア変換、合成、フレーム抽出、出力検証を処理します。 |
| [Whisper](https://github.com/openai/whisper)、[whisper.cpp](https://github.com/ggml-org/whisper.cpp)、[faster-whisper](https://github.com/SYSTRAN/faster-whisper)、[WhisperKit](https://github.com/argmaxinc/WhisperKit) | Runtime で利用可能な機能に応じて選択する、クラウドおよび各プラットフォーム向けのローカル音声文字起こし手段です。 |
| [React](https://react.dev/) | Web と Desktop で共有するユーザーインターフェースの基盤です。 |
| [Fastify](https://fastify.dev/) | ローカル Runtime の HTTP と API の基盤です。 |
| [Electron](https://www.electronjs.org/) | ネイティブなシステム機能、アプリのライフサイクル、パッケージングを担う Desktop ホストです。 |
| [SQLite](https://www.sqlite.org/) | プロジェクト、会話、Runs、スケジュール、メモリなどのワークスペースデータをローカルに保存します。 |
| [Model Context Protocol](https://modelcontextprotocol.io/) | 外部ツールやサービスを Agent ワークスペースへ接続するためのオープンプロトコルです。 |

---

<div align="center">

**OpenCreator · ローカルで制作し、継続的に取り組む。**

</div>
