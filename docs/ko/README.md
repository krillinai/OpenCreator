<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../images/OpenCreator_logo_vector_dark.svg" />
    <img src="../images/OpenCreator_logo_vector.svg" alt="OpenCreator" width="380" />
  </picture>
  <br />
  크리에이터를 위한 오픈소스 AI 워크스페이스
</h1>

<p>스크립트부터 동영상, 이미지, 음성, 아바타, 번역, 편집까지 Agent가 하나의 워크스페이스에서 전체 창작 과정을 진행합니다.</p>

<p><strong>OpenCreator의 이전 이름은 KrillinAI였습니다.</strong></p>

<a href="https://trendshift.io/repositories/13360" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13360" alt="OpenCreator(구 KrillinAI): Trendshift 오늘의 리포지토리 1위" width="250" height="55" /></a>

[English](../../README.md) | [简体中文](../zh/README.md) | [日本語](../ja/README.md) | **한국어** | [Bahasa Indonesia](../id/README.md) | [Español](../es/README.md) | [Français](../fr/README.md) | [Deutsch](../de/README.md) | [Português](../pt/README.md) | [Русский](../ru/README.md) | [العربية](../ar/README.md)

[![GitHub Stars](https://img.shields.io/github/stars/krillinai/OpenCreator?style=flat&logo=github&label=Stars&color=gold)](https://github.com/krillinai/OpenCreator/stargazers)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Bilibili](https://img.shields.io/badge/dynamic/json?label=Bilibili&query=%24.data.follower&suffix=%E7%B2%89%E4%B8%9D&url=https%3A%2F%2Fapi.bilibili.com%2Fx%2Frelation%2Fstat%3Fvmid%3D242124650&logo=bilibili&color=00A1D6&labelColor=FE7398&logoColor=FFFFFF)](https://space.bilibili.com/242124650)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/3GwBGsjs8)
[![QQ 그룹](https://img.shields.io/badge/QQ%20群-754069680-green?logo=tencent-qq)](https://qm.qq.com/q/W4YC0PLMeA)

[주요 특징](#주요-특징) · [제작 도구](#제작-도구) · [대화와 워크스페이스](#대화와-워크스페이스를-함께-진행) · [지원 모델](#지원-모델) · [활용 사례](#활용-사례) · [빠른 시작](#빠른-시작) · [Desktop](#desktop) · [시스템 구조](#opencreator-시스템-구조) · [개발](#개발) · [문서](#문서) · [기여자](#기여자) · [Star 기록](#star-기록)

</div>

![OpenCreator Agent 워크스페이스](../images/opencreator-home-en.png)

## 프로젝트 소개

OpenCreator는 창작 및 개발 작업을 로컬에서 계속 실행하고자 하는 개인과 팀을 위해 만들어졌습니다. Agent 루프를 다시 구현하는 대신 Codex CLI를 실행 엔진으로 사용하고, 그 위에 안정적인 로컬 Runtime, 시각적 워크스페이스, Desktop 호스트를 제공합니다.

이 제품은 서로 연결된 두 가지 워크플로를 통합합니다.

- **AI 콘텐츠 제작**: 동영상 번역, 동영상 다운로드, 썸네일 생성, 이미지 생성을 위한 전용 제작 도구를 사용할 수 있습니다.
- **범용 Agent 워크스페이스**: 대화를 프로젝트별로 정리하고, Run을 백그라운드에서 계속 실행하면서 승인, 첨부 파일, 파일, Skills, MCP, 일정, 알림, 메모리, 진단을 한곳에서 관리할 수 있습니다.

Web은 유일한 프런트엔드 구현입니다. Desktop은 동일한 Web 빌드를 불러오며 디렉터리 선택, 창 수명 주기, 트레이 동작, 네이티브 알림처럼 운영체제가 필요한 기능만 추가합니다. 동일한 데이터와 콘텐츠 뷰포트에서는 두 플랫폼이 같은 범용 UI와 Runtime 동작을 공유합니다.

## 주요 특징

- 🤖 **Codex 네이티브**: 별도의 실행 엔진을 유지하지 않고 Codex의 Agent 루프, 모델, 추론, 도구 호출, 대화, Skills, MCP를 그대로 활용합니다.

- 🚀 **바로 사용할 수 있는 Desktop 앱**: Codex CLI가 포함된 Desktop 앱에서 OpenCreator를 직접 실행할 수 있습니다. 로컬 Runtime은 필요할 때 시작되고 기본 프로젝트를 자동으로 준비합니다.

- 🔄 **관리형 Runtime 구성 요소**: 번들, 사용 중, 최신 yt-dlp 버전을 확인하고 주기적으로 업데이트를 검사한 뒤 수동으로 업데이트할 수 있습니다. 업데이트가 실패해도 현재 작동 중인 버전은 유지됩니다.

- 🎨 **멀티모달 제작**: 동영상, 이미지, 오디오, 자막, 문서를 하나의 연결된 워크플로에서 제작하고 관리합니다.

- 🔗 **듀얼 모드 워크플로**: 시각적 워크스페이스와 Agent 대화 중 어느 쪽에서도 작업할 수 있으며, 하나의 공유 상태 머신이 단계, 진행 상황, 결과를 동기화합니다.

- 🕘 **버전 관리**: 수정할 때마다 새 버전을 생성하고 이전 설정과 결과를 검토하고 비교할 수 있도록 보존합니다.

- 🧩 **Skills와 MCP**: Skills를 탐색, 설치, 실행하고 Codex 네이티브 설정을 통해 MCP를 관리합니다.

- 🧠 **메모리**: 전역, 프로젝트, 스레드 단위의 메모리를 유지하며 요약과 재현 가능한 Run 입력 스냅샷을 저장합니다.

- 🔐 **로컬 보안**: 데이터, 첨부 파일, 로그를 기본적으로 로컬에 보관하고 승인 절차와 민감 정보가 제거된 진단 정보를 제공합니다.

## 제작 도구

현재 릴리스에는 네 가지 제작 도구가 포함되어 있습니다. 사용할 수 있는 모델과 서비스는 로컬 Codex 환경 및 AI 서비스 설정에 따라 달라집니다.

Dashboard에서 동영상을 번역하고, 공개 동영상을 다운로드하고, 썸네일을 생성하거나 이미지를 만들 수 있습니다.

![OpenCreator 제작 Dashboard](../images/product/opencreator-dashboard-en.png)

> 제작 도구는 계속 추가될 예정입니다.

<table width="100%">
<thead>
<tr>
<th width="18%">제작 도구</th>
<th width="14%">상태</th>
<th width="68%">기능</th>
</tr>
</thead>
<tbody>
<tr><td valign="top">동영상 번역</td><td valign="top">✅ 사용 가능</td><td>로컬 또는 공개 동영상을 불러오고 클라우드나 로컬 Whisper 서비스로 음성을 텍스트로 변환합니다. LLM 컨텍스트를 활용해 자막 분할, 정렬, 용어 처리, 번역을 수행하고, 이중 언어 자막, 더빙 또는 사용자 지정 음성 샘플, 자막 스타일, 가로·세로 구성을 설정한 뒤 SRT, 오디오 또는 동영상으로 내보낼 수 있습니다</td></tr>
<tr><td valign="top">동영상 다운로드</td><td valign="top">✅ 사용 가능</td><td>YouTube, Bilibili 등 지원되는 공개 링크를 분석하고 이용 가능한 화질과 형식을 확인한 뒤 후속 작업에 사용할 동영상 또는 오디오를 다운로드할 수 있습니다</td></tr>
<tr><td valign="top">썸네일 생성</td><td valign="top">✅ 사용 가능</td><td>주제, 동영상 링크, 선택적 참조 이미지를 조합해 여러 콘텐츠 썸네일 시안을 생성하고 비교할 수 있습니다</td></tr>
<tr><td valign="top">이미지 생성</td><td valign="top">✅ 사용 가능</td><td>프롬프트와 선택적 참조 이미지로 GPT Image를 사용해 이미지를 생성하고, 화면 비율과 출력 수를 설정한 뒤 각 이미지를 미리 보고 다운로드할 수 있습니다</td></tr>
<tr><td valign="top">스틱 피겨 애니메이션</td><td valign="top">출시 예정</td><td>안내형 워크플로에서 캐릭터, 스토리보드, 음성 해설, 애니메이션을 제작합니다</td></tr>
<tr><td valign="top">자동 클립</td><td valign="top">개발 중</td><td>긴 동영상을 분석하고 주요 장면을 찾아 선택한 순간을 재사용 가능한 짧은 클립으로 만듭니다</td></tr>
<tr><td valign="top">스마트 더빙</td><td valign="top">개발 중</td><td>음성, 속도, 감정 표현을 선택해 스크립트를 음성 해설로 변환합니다</td></tr>
<tr><td valign="top">동영상 생성</td><td valign="top">개발 중</td><td>프롬프트와 참조 이미지로 동영상을 생성한 뒤 미리 보고 내보냅니다</td></tr>
<tr><td valign="top">디지털 아바타</td><td valign="top">개발 중</td><td>스크립트, 음성, 아바타 표현을 결합해 말하는 인물 동영상을 제작합니다</td></tr>
</tbody>
</table>

## 대화와 워크스페이스를 함께 진행

작업을 자연어로 설명하고 정밀한 제어가 필요할 때 시각적 도구로 전환하세요.

![OpenCreator 대화와 시각적 워크스페이스의 연동](../images/examples/opencreator-auto-clips-en.png)

### 세밀한 워크스페이스 제어

자막, 장면, 오디오, 생성 설정을 정확하게 조정합니다.

### 유연한 대화형 편집

Agent에게 변경할 내용을 알려 주고 자연어로 결과를 계속 다듬습니다.

### 동기화된 상태

대화와 워크스페이스가 현재 작업 상태를 공유하므로 같은 내용을 반복할 필요가 없습니다.

### 독립적인 버전

각 수정은 이전 결과나 설정을 덮어쓰지 않고 별도의 버전을 만듭니다.

## 지원 모델

언어 모델은 Codex 모델 카탈로그 또는 설정한 OpenAI 호환 공급자를 따릅니다. 이미지, 음성, 텍스트 변환 모델은 **설정 → AI 서비스**에서 구성한 서비스를 사용합니다.

### 언어 모델

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

### 이미지

<table>
<tr>
<td align="center"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>GPT Image</strong></td>
</tr>
</table>

### 음성 및 텍스트 변환

<table>
<tr>
<td align="center" width="20%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>Whisper</strong></td>
<td align="center" width="20%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>OpenAI TTS</strong></td>
<td align="center" width="20%"><img src="https://github.com/MiniMax-AI.png?size=80" alt="MiniMax" width="40" height="40" /><br /><strong>MiniMax</strong></td>
<td align="center" width="20%"><img src="https://github.com/microsoft.png?size=80" alt="Microsoft" width="40" height="40" /><br /><strong>Edge TTS</strong></td>
<td align="center" width="20%"><img src="https://github.com/aliyun.png?size=80" alt="Alibaba Cloud" width="40" height="40" /><br /><strong>Aliyun Speech</strong></td>
</tr>
</table>

## 활용 사례

### 동영상 번역

아래 공개 사례는 OpenCreator가 KrillinAI라는 이름을 사용하던 시기에 제작되었습니다. 이 사례들은 OpenCreator의 동영상 번역 워크스페이스가 더 넓은 Agent 워크플로에 제공하는 검증된 자막 정렬, 번역, 더빙, 세로형 동영상 워크플로를 보여 줍니다.

이 프로젝트는 46분 분량의 로컬 동영상에서 수동 자막 조정 없이 한 번의 실행으로 아래 자막 파일을 생성했습니다. 공개된 결과는 모든 구간을 빠짐없이 다루고, 자막이 서로 겹치지 않으며, 자연스럽게 분할되고, 높은 번역 품질을 보여 줍니다.

![OpenCreator 자막 정렬 사례](../images/examples/krillinai-subtitle-alignment.png)

<table width="100%">
<tr>
<td width="33%">

#### 자막 번역

https://github.com/user-attachments/assets/bba1ac0a-fe6b-4947-b58d-ba99306d0339

</td>
<td width="33%">

#### 더빙

https://github.com/user-attachments/assets/0b32fad3-c3ad-4b6a-abf0-0865f0dd2385

</td>
<td width="33%">

#### 세로 모드

https://github.com/user-attachments/assets/c2c7b528-0ef8-4ba9-b8ac-f9f92f6d4e71

</td>
</tr>
</table>

> 이 동영상 사례와 자막 정렬 이미지는 OpenCreator가 KrillinAI라는 이름을 사용하던 시기에 제작되었습니다.

### 비디오 다운로드

공개 동영상 링크를 분석하고 사용 가능한 형식을 비교한 뒤 비디오 또는 오디오를 프로젝트로 직접 다운로드합니다.

![OpenCreator 비디오 다운로더 형식 선택](../images/examples/video-downloader-formats-en.png)

### 스틱 피겨 애니메이션(출시 예정)

> 출시 예정입니다. 현재 릴리스에는 아직 통합되지 않았습니다.

OpenCreator는 [Behance의 Stickman](https://www.behance.net/gallery/254715463/Stickman)을 제작한 아티스트 [Harbor Hsia](https://www.behance.net/xiaheyuan1)와 협업하여 이 오리지널 캐릭터 컬렉션을 개발했습니다. 일관된 캐릭터 정체성을 유지하는 향후 스토리 및 애니메이션 워크플로를 위해 프리셋 캐릭터를 준비하고 있습니다.

![아티스트와 함께 개발한 OpenCreator 스틱 피겨 캐릭터](../images/examples/stick-figure-characters.webp)

계획된 워크플로는 캐릭터와 스토리 아이디어를 스토리보드 생성, 장면 검토, 보이스오버, 음악, 버전별 애니메이션 출력까지 안내합니다.

![OpenCreator 스틱 피겨 애니메이션 예시 프레임](../images/examples/stick-figure-animation-frame.jpg)

## 빠른 시작

### 사전 요구 사항

- Node.js 22 이상
- 리포지토리의 `packageManager` 필드에 고정된 pnpm 9.15.0
- 터미널에서 실행할 수 있는 Codex CLI
- 실제 모델 작업을 위한 유효한 Codex CLI 로그인

먼저 로컬 환경을 확인하세요.

```bash
node --version
pnpm --version
codex --version
```

### 소스에서 Web 실행

```bash
git clone https://github.com/krillinai/OpenCreator.git
cd OpenCreator
corepack enable
pnpm install
pnpm web:dev
```

`http://127.0.0.1:19861/`을 여세요. 개발 서버는 필요할 때 로컬 daemon을 시작하고 동일 출처 프록시를 통해 임시 Runtime 토큰을 주입하므로 연결 토큰을 수동으로 복사할 필요가 없습니다.

처음 실행하면 Runtime이 기본 프로젝트를 준비합니다. 연결이 완료되는 즉시 입력창을 사용할 수 있습니다. daemon만 실행하려면 다음 명령을 사용하세요.

```bash
pnpm daemon:dev
```

daemon은 루프백 주소만 수신하며 연결 주소와 임시 토큰을 stdout에 한 번 출력합니다.

## Desktop

Desktop과 브라우저는 `apps/web`의 동일한 React 프런트엔드를 사용합니다. 일반적인 프로젝트, 대화, 작업, 설정 동작은 동일한 Daemon/API를 호출합니다. Electron은 실제 시스템 경로, 창 제어, 트레이 동작, 네이티브 알림만 추가합니다.

### 개발 모드

```bash
pnpm desktop:dev
```

### 로컬 패키징

| 명령 | 출력 |
| --- | --- |
| `pnpm desktop:package` | 로컬 검증을 위한 현재 플랫폼의 실행 가능한 디렉터리 |
| `pnpm desktop:dist` | 현재 플랫폼용 설치 프로그램 |
| `pnpm desktop:release` | 정식 릴리스 패키징 진입점 |
| `pnpm --filter @opencreator/desktop verify:package` | 기존 Desktop 패키지 검증 |

Desktop 패키징은 현재 작업 공간에서 Web을 다시 빌드하고 commit, dirty 상태, 플랫폼, 아키텍처, Web 해시를 기록한 다음 `apps/web/dist`와 애플리케이션에 포함된 리소스를 비교합니다. 서로 다르면 패키징이 실패합니다. 서명, 공증, Windows 빌드, 릴리스 요구 사항은 [Desktop 릴리스 운영 가이드](../operations/opencreator-desktop-release-runbook.md)를 참고하세요.

## 핵심 워크플로

### 대화와 Run

1. 프로젝트를 선택하거나 새 대화를 시작합니다.
2. 작업을 입력하고 권한 수준, Profile, 모델, 추론 강도를 선택합니다.
3. Run이 활성화된 동안 후속 작업을 대기열에 추가하거나 실행을 중단하고 바로 계속합니다.
4. Timeline에서 추론 요약, 도구 호출, 파일 변경, 승인, 최종 결과를 확인합니다.
5. 작업 센터에서 실행 중, 완료, 실패, 승인 대기 상태의 작업을 전체적으로 추적합니다.

### Skills와 MCP

- 플러그인 센터에서 Skill 마켓플레이스, 설치 기록, 로컬에서 사용할 수 있는 Skills를 살펴볼 수 있습니다.
- 입력창에서 `/` 또는 추가 메뉴를 통해 Skill을 선택하면 다음 작업이 해당 워크플로를 따릅니다.
- MCP 관리는 별도의 실행 엔진을 유지하는 대신 Codex 네이티브 명령과 설정을 사용합니다.
- OpenCreator는 기본적으로 현재 `$CODEX_HOME`을 사용하므로 전역 Skills 또는 MCP 설정을 변경하기 전에 영향을 확인하세요.

### 일정과 전용 작업 스레드

- 각 일정에는 영구적인 전용 OpenCreator 대화가 있습니다.
- 자동 트리거, 수동 실행, 사용자 후속 작업은 동일한 대화를 재사용하며 `queue` 또는 `skip` 정책에 따라 순차 실행됩니다.
- 일정을 삭제하면 전용 대화는 보관 처리되지만 기존 Runs, 결과, 기반 Codex 기록은 유지됩니다.
- 기반 Codex 스레드를 교체하거나 복구해도 OpenCreator 작업 항목과 페이지 경로는 변경되지 않습니다.

## OpenCreator 시스템 구조

OpenCreator는 시각적 워크스페이스와 Agent 대화를 서로 다른 두 워크플로가 아니라 동일한 창작 작업을 위한 두 개의 인터페이스로 취급합니다. 각 제작 워크플로는 상태 머신으로 모델링됩니다. 소스 입력, 설정, 생성, 검토, 수정, 내보내기가 명시적인 상태와 이벤트가 됩니다. 워크스페이스 동작과 대화 명령은 동일한 상태 머신에 입력되며 현재 단계, 설정, 진행 상황, 버전, 결과는 두 인터페이스에 다시 반영됩니다. 이를 통해 두 번째 정보 출처를 만들지 않고 워크스페이스와 대화를 동기화합니다.

창작 작업은 반복적이므로 수정 시 현재 결과를 덮어쓰지 않습니다. 각 수정이나 재생성은 기존 워크플로 상태에서 새 버전을 만들고 이전 버전의 설정과 결과를 유지하여 검토, 비교, 추가 개선에 활용할 수 있게 합니다.

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

| OpenCreator 구성 요소 | 역할 | 구현 |
| --- | --- | --- |
| 제작 경험 | Dashboard, 제작 도구, Agent 대화, 설정, 파일 제공 | `apps/web` · React 18 · Vite · TypeScript |
| 협업 코어 | 워크스페이스 단계, 대화 컨텍스트, 진행 상황, 결과, 수정 버전을 동기화 | 공유 워크플로 상태 · `CreatorCollaborationPanel` · 버전 기록 |
| 로컬 Runtime | 프로젝트, Runs, 승인, 일정, 메모리, 알림 관리 | `apps/daemon` · Fastify · Runtime API · SSE |
| Runtime 구성 요소 | 번들, 활성, 최신 버전을 추적하고 주기적으로 확인하며 사용자가 요청한 업데이트만 설치 | yt-dlp nightly · 업데이트 검증 · 작동 버전 폴백 |
| Codex 엔진 | Agent 루프, 세션, 추론, 도구, Skills, MCP 제공 | Codex CLI · app-server |
| 미디어 도구 모음 | 창작 미디어를 다운로드, 텍스트 변환, 변환, 생성, 내보내기 | yt-dlp · Whisper · FFmpeg · 구성된 AI 서비스 |
| 로컬 데이터 | 프로젝트 데이터, Runs, 첨부 파일, 출력, 자격 증명을 로컬에 저장 | SQLite · 파일 시스템 · 시스템 자격 증명 저장소 |
| Desktop 호스트 | 공유 Web 빌드를 불러오고 운영체제 기능 추가 | `apps/desktop` · Electron · Preload Bridge |

핵심 원칙:

- 워크스페이스와 Agent 대화는 하나의 워크플로 상태를 동기화해 보여 줍니다. 두 인터페이스 모두 동일한 상태 머신에 이벤트를 보내며 별도의 작업 상태를 유지하지 않습니다.
- 수정 시 기존 결과를 교체하지 않고 새 버전을 생성하여 각 창작 반복 과정의 컨텍스트와 결과를 보존합니다.
- 프런트엔드는 Codex를 직접 실행하지 않으며 Codex의 원시 JSONL 이벤트 형식에도 의존하지 않습니다.
- daemon은 프로세스 수명 주기, 이벤트 정규화, 영속성, 승인, 일정, 알림 outbox를 관리합니다.
- Agent 루프, Skills, MCP 실행에서는 Codex가 계속해서 유일한 정보 출처입니다.
- Browser Bridge와 Desktop Bridge는 범용 제품 로직을 별도로 구현하지 않습니다.

## 리포지토리 구성

```text
OpenCreator/
├── apps/
│   ├── web/          # 유일한 React 프런트엔드 구현
│   ├── daemon/       # 로컬 Fastify Runtime 및 Codex 어댑터
│   ├── desktop/      # Electron Main, Preload, 네이티브 기능 및 패키징
│   └── harness/      # Runtime 명령줄 검증 도구
├── packages/
│   ├── protocol/     # Web, Daemon, Desktop이 공유하는 Runtime 계약
│   └── skill-market/ # Skill 마켓플레이스 모델 및 공유 로직
├── docs/             # 설계 문서, API 참조, 운영 가이드 및 테스트 보고서
├── scripts/          # 리포지토리 수준 검사
└── .runtime/         # 처음 실행할 때 생성되는 로컬 Runtime 데이터
```

## 설정

### AI 서비스 API 키

**설정 → AI 서비스**에서 현재 워크스페이스가 사용하는 모델, 음성 인식, 오디오, 이미지 제공자를 설정하세요. 향후 제작 도구를 준비하는 과정에서 서비스 범주가 추가로 표시될 수 있습니다. 각 범주에는 선택한 제공자에 필요한 Base URL, API Key, 모델, 프록시 또는 제공자별 자격 증명 필드만 표시됩니다.

![OpenCreator AI 서비스 API Key 설정](../images/product/opencreator-ai-services-en.png)

자격 증명은 로컬 Runtime의 시스템 자격 증명 저장소를 통해 저장되며 리포지토리에 commit해서는 안 됩니다. Edge TTS와 같은 일부 로컬 또는 시스템 기반 제공자는 API Key가 필요하지 않습니다.

### 타사 Runtime 구성 요소

**설정 → 타사 구성 요소**에서 현재 사용 중인 yt-dlp nightly 버전, OpenCreator에 포함된 버전, 출처, 사용 가능한 최신 릴리스를 확인할 수 있습니다. OpenCreator는 7일마다 업데이트를 확인하지만 자동으로 설치하지 않습니다. 업데이트는 사용자가 명시적으로 실행해야 하며 다운로드, 검증 또는 설치가 실패해도 현재 작동 중인 버전을 계속 사용할 수 있습니다.

![OpenCreator 타사 구성 요소 설정](../images/product/opencreator-third-party-components-en.png)
### Runtime 환경 변수

대부분의 사용자는 환경 변수가 필요하지 않습니다. 격리된 데이터, 특정 Codex 실행 파일 또는 사용자 지정 관리 프로젝트 디렉터리가 필요한 경우 다음 변수를 사용하세요.

| 환경 변수 | 기본값 | 용도 |
| --- | --- | --- |
| `OPENCREATOR_DATA_DIR` | `.runtime` | OpenCreator 데이터베이스, Runs, 첨부 파일, 관리 대상 워크스페이스 |
| `OPENCREATOR_CODEX_BIN` | `codex` | Codex CLI 실행 파일 경로 |
| `CODEX_HOME` | `~/.codex` | Codex 세션, 설정, Skills, MCP, Profiles의 정보 출처 |
| `OPENCREATOR_DEFAULT_CWD` | 현재 작업 디렉터리 | daemon의 기본 작업 디렉터리 |
| `OPENCREATOR_DEFAULT_PROJECT_ROOT` | Runtime 기본 정책 | 관리 대상 프로젝트 루트. 설정하면 OpenCreator는 그 아래의 `OpenCreator/` 디렉터리를 사용합니다 |
| `OPENCREATOR_CODEX_THREAD_ROTATION_RUN_THRESHOLD` | `50` | 장기 실행 일정의 기반 Codex 스레드를 교체하기 위한 종료 Run 수 임계값. 사전 교체를 비활성화하려면 `0`을 사용합니다 |

Runtime 데이터와 Codex 환경을 모두 격리하는 예시는 다음과 같습니다.

```bash
OPENCREATOR_DATA_DIR=/path/to/opencreator-data \
CODEX_HOME=/path/to/codex-home \
pnpm web:dev
```

## 데이터와 보안

Runtime 데이터는 기본적으로 리포지토리 루트의 `.runtime/` 아래에 저장됩니다.

| 경로 | 내용 |
| --- | --- |
| `.runtime/app.sqlite` | 프로젝트, 스레드, Runs, 이벤트, 일정, 알림, 첨부 파일 메타데이터, 승인, 메모리, 요약 |
| `.runtime/runs/` | 개별 Run의 민감 정보가 제거된 로그, 진단, 메타데이터 |
| `.runtime/attachments/` | 제어된 첨부 파일 |
| `.runtime/workspaces/` | Runtime이 관리하는 프로젝트 워크스페이스 |

Codex 세션과 설정은 `$CODEX_HOME`에 유지되며 `.runtime/`과 별도로 백업해야 합니다.

보안 경계는 다음과 같습니다.

- daemon은 `127.0.0.1`만 수신하며 상태 확인을 제외한 모든 API에 Bearer 토큰을 요구합니다.
- HTML 미리보기는 기본적으로 스크립트, 탐색, 팝업을 비활성화하고 제어된 동일 워크스페이스의 상대 리소스만 허용합니다.
- 민감한 메모리는 두 번째 확인이 필요합니다. OpenCreator는 확인되지 않은 제안을 자동으로 영구 저장하지 않습니다.
- 진단 정보와 Run 로그는 반환하거나 내보내기 전에 민감 정보가 제거됩니다.
- Desktop 패키지는 ASAR 무결성과 쿠키 암호화를 활성화하고 RunAsNode, `NODE_OPTIONS`, Node CLI Inspector를 비활성화합니다.

전체 백업, 복원, 정리, 초기화 절차는 [사용자 가이드 및 문제 해결](../opencreator-user-guide-and-troubleshooting.md)을 참고하세요.

## 개발

### 자주 사용하는 명령

| 명령 | 용도 |
| --- | --- |
| `pnpm web:dev` | Web을 실행하고 필요할 때 로컬 daemon 시작 |
| `pnpm daemon:dev` | daemon만 실행 |
| `pnpm desktop:dev` | 의존성을 빌드하고 Electron을 개발 모드로 실행 |
| `pnpm test` | 워크스페이스 단위 테스트와 통합 테스트 실행 |
| `pnpm typecheck` | 리포지토리 전체의 TypeScript 검사 실행 |
| `pnpm build` | 모든 workspace 빌드 |
| `pnpm e2e` | Web Playwright E2E 테스트 실행 |
| `pnpm smoke:ci` | fake Codex Runtime 스모크 테스트 실행 |
| `pnpm perf:check` | 기록된 성능 기준 확인 |

변경 사항을 제출하기 전에 최소한 다음 명령을 실행하세요.

```bash
pnpm test
pnpm typecheck
pnpm build
```

Desktop, Host Bridge, Runtime 프록시 또는 공유 프런트엔드 워크플로를 변경한 경우 Web/Desktop 일관성 테스트, 패키징된 애플리케이션 E2E, Web 빌드 해시 검증도 필요합니다. Web 단위 테스트 통과만으로 Desktop 릴리스 준비가 완료되었다고 볼 수 없습니다.

실제 Codex 스모크 테스트는 기본적으로 비활성화되어 있습니다. 다음과 같이 명시적으로 활성화하세요.

```bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

## 문서

- [사용자 가이드 및 문제 해결](../opencreator-user-guide-and-troubleshooting.md)
- [Runtime API v1](../runtime-api-for-ui-v1.md)
- [Codex 네이티브 Runtime 설계](../2026-07-03-codex-native-agent-runtime-design.md)
- [Desktop 릴리스 운영 가이드](../operations/opencreator-desktop-release-runbook.md)
- [Windows Desktop 릴리스 가이드](../operations/opencreator-desktop-windows-release.md)
- [시각적 컴포넌트 가이드라인](../visual-component-guidelines.md)

## 번역 원칙

루트의 `README.md`가 기준 영문 문서입니다. 유지 관리되는 번역은 `docs/<locale>/README.md`에 저장합니다. 전체 문서의 번역을 완료하고 영문 구조와 동기화한 뒤에만 언어 선택기에 해당 언어를 추가합니다.

## 기여하기

1. [Issues](https://github.com/krillinai/OpenCreator/issues)에 문제, 사용 사례, 기대 동작을 설명합니다.
2. 최신 개발 브랜치에서 목적이 명확한 기능 또는 수정 브랜치를 만듭니다.
3. 기존 아키텍처를 따릅니다. 범용 제품 기능은 Web과 Daemon에 한 번만 구현하고 네이티브 차이는 명시적인 capability 뒤에 격리합니다.
4. 동작 변경에 적합한 단위, 통합 또는 E2E 테스트를 추가하고 Pull Request에 완료한 검증과 생략한 검증을 모두 기재합니다.
5. `.runtime/`, 로컬 자격 증명, Codex 세션, 빌드 캐시 또는 기타 사용자 데이터를 commit하지 마세요.

## 기여자

코드, 문서, 피드백, 이슈 보고, Skills, 디자인, 아이디어로 함께한 모든 분께 감사드립니다.

<a href="https://github.com/krillinai/KrillinAI/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=krillinai/KrillinAI&amp;max=500&amp;columns=20" alt="OpenCreator 기여자" />
</a>

## Star 기록

OpenCreator의 이전 이름은 KrillinAI였습니다. 이 차트는 이름 변경 전후를 포함한 리포지토리의 전체 기록을 보여 줍니다.

[![OpenCreator Star History](https://api.star-history.com/svg?repos=krillinai/KrillinAI&type=Date)](https://star-history.com/#krillinai/KrillinAI&Date)

## 관련 프로젝트

| 프로젝트 | 역할 |
| --- | --- |
| [OpenAI Codex](https://github.com/openai/codex) | 모델 접근, 추론, 도구 호출, 세션, Skills, MCP 연동을 담당하는 Agent 실행 엔진입니다. |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | 지원되는 공개 미디어 링크를 확인하고 형식을 나열하며 제작 워크플로용 동영상이나 오디오를 다운로드합니다. |
| [FFmpeg](https://ffmpeg.org/) | FFmpeg와 ffprobe가 미디어 변환, 합성, 프레임 추출, 출력 검증을 처리합니다. |
| [Whisper](https://github.com/openai/whisper), [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [WhisperKit](https://github.com/argmaxinc/WhisperKit) | 사용 가능한 Runtime 기능에 따라 선택되는 클라우드 및 플랫폼별 로컬 음성 텍스트 변환 옵션입니다. |
| [React](https://react.dev/) | Web과 Desktop이 공유하는 사용자 인터페이스 기반입니다. |
| [Fastify](https://fastify.dev/) | 로컬 Runtime의 HTTP 및 API 기반입니다. |
| [Electron](https://www.electronjs.org/) | 네이티브 시스템 기능, 앱 수명 주기, 패키징을 담당하는 Desktop 호스트입니다. |
| [SQLite](https://www.sqlite.org/) | 프로젝트, 대화, Runs, 일정, 메모리 및 기타 워크스페이스 데이터를 로컬에 저장합니다. |
| [Model Context Protocol](https://modelcontextprotocol.io/) | 외부 도구와 서비스를 Agent 워크스페이스에 연결하는 공개 프로토콜입니다. |

---

<div align="center">

**OpenCreator · 로컬에서 만들고, 끊김 없이 작업하세요.**

</div>
