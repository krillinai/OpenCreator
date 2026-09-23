# YouTube Shorts Stick Figure com Imagens Codex Native

**Data:** 2026-09-20

**Status:** design aprovado para revisão escrita
**Escopo:** pipeline local do OpenCreator para Shorts explicativos originais de 30 segundos

## Objetivo

Permitir que o pipeline existente `stickman-video` produza um Short vertical pronto para revisão e publicação manual no YouTube, usando imagens geradas pelo provider local `codex-native` através da sessão autenticada do Codex, sem API paga de imagem ou vídeo.

O primeiro perfil de produção será:

- conteúdo original baseado em tema ou roteiro;
- narração e legendas em inglês dos EUA;
- duração alvo de 30 segundos;
- composição vertical 9:16;
- estética stick figure explicativa;
- legendas em caixa preta translúcida no terço inferior;
- movimento local lento de pan/zoom nas imagens;
- entrega local, sem upload automático para o YouTube.

## Não objetivos

- Gerar movimento AI por cena usando Seedance, Kling ou Veo.
- Fazer upload, agendamento ou publicação automática no YouTube.
- Substituir o `CreatorCollaborationPanel` por uma interface específica.
- Remover o suporte paisagem já existente.
- Alterar a cobrança ou franquia da assinatura do Codex.

## Decisões de design

### Um template, dois formatos

O template `stickman-video` continuará sendo a unidade de workflow e passará a aceitar `16:9` e `9:16`. O preset de Shorts selecionará `9:16`, 30 segundos e o perfil visual vertical. Jobs paisagem existentes continuarão usando `1280x720`.

As dimensões serão derivadas do formato em um único contrato compartilhado:

| Formato | Dimensão | Uso |
|---|---:|---|
| `16:9` | `1280x720` | compatibilidade com o fluxo paisagem atual |
| `9:16` | `720x1280` | YouTube Shorts |

Timeline, composição Remotion, renderizador, media validation e delivery devem consumir as dimensões do manifesto; nenhum desses módulos deve manter `1280x720` como uma regra universal.

### Geração visual sem API paga

Cada shot continua sendo uma unidade independente de imagem. O executor usa `codex-native`, captura o artefato PNG/JPEG/WebP gerado na pasta local da sessão Codex, valida assinatura, tamanho, hash e limite do workspace e registra o Artifact normalmente.

Não haverá fallback silencioso para providers remotos. Se `codex-native` não estiver configurado, a sessão local não estiver autenticada ou o artefato não puder ser importado, o StageRun falha com erro explícito de configuração/artefato.

O prompt vertical incluirá composição 9:16, área segura central e preservação do personagem. O tratamento de imagem deve preencher o canvas vertical sem deformar o personagem nem cortar cabeça, mãos ou elementos necessários do shot.

### Movimento e legendas

O vídeo será montado localmente com Remotion a partir de imagens, áudio e timing. Cada shot terá movimento determinístico e suave, limitado a escala e deslocamento pequenos para evitar tremor e preservar a leitura.

O estilo de legenda aprovado é:

- caixa preta com transparência;
- texto branco, peso alto e quebra controlada;
- posição no terço inferior dentro da área segura;
- sem cobrir rosto ou elemento narrativo principal;
- o mesmo cue temporal no SRT e na camada queimada do MP4.

O `narration.srt` continuará sendo entregue separadamente, mas o `clean_video` também deverá conter a legenda visível para uso imediato em Shorts sem áudio.

### Entrega

O estágio final deve produzir um conjunto exato de arquivos:

| Arquivo | Conteúdo |
|---|---|
| `short.mp4` | vídeo H.264 vertical, com vídeo e áudio, duração compatível com o timing |
| `subtitles.srt` | legendas válidas e alinhadas à narração |
| `thumbnail.png` | frame/imagem aprovada em composição vertical, sem artefato de texto ilegível |
| `publish-copy.md` | título, descrição, hashtags e CTA gerados a partir do roteiro aprovado |
| `delivery-manifest.json` | hashes, MIME, dimensões, duração, providers, status e bloqueios |

O pacote será marcado como `publishable` somente quando todos os arquivos existirem, tiverem hashes coerentes e as validações de mídia, imagem, áudio e texto passarem. A publicação permanece uma ação manual do usuário.

## Fluxo de dados

```text
tema/roteiro original
  -> source-brief
  -> content-plan
  -> script
  -> aprovação do roteiro
  -> narration (Edge TTS)
  -> audio-timing (FFprobe)
  -> storyboard
  -> style-assets + prompt-pack
  -> images (codex-native, um shot por vez)
  -> visual-validation
  -> timeline (dimensões do ratio + cues)
  -> render-clean (Remotion vertical ou paisagem)
  -> media-validation
  -> thumbnail + publish-copy
  -> package-validation
```

O workflow continuará usando as mesmas revisões, `scopeKey`, `inputFingerprint`, artifacts e gates de aprovação. Alterar um shot invalida somente os dependentes desse shot e da composição final.

## Configuração de custos

- Imagens: `codex-native`, incluídas na franquia da assinatura quando a sessão Codex autenticada estiver disponível.
- Voz: `edge-tts`, sem chave de API de voz.
- Movimento/render: Remotion, Chromium e FFmpeg locais.
- Vídeo AI: fora deste perfil; nenhum provider remoto será chamado.
- Texto/roteiro: reutiliza o provider de texto já configurado no OpenCreator; a decisão sobre provider de texto não faz parte desta alteração de mídia.

O sistema não deve transformar ausência de configuração local em chamada remota com cobrança.

## Tratamento de erros

1. Falha de autenticação ou indisponibilidade do Codex: erro de configuração do provider de imagem.
2. Artefato fora da pasta permitida, MIME inválido ou arquivo corrompido: erro de importação e nenhum Artifact é registrado como concluído.
3. Edge TTS ausente ou falho: StageRun de narração falha sem trocar para TTS pago.
4. Remotion/Chromium/FFmpeg ausente: render e delivery falham com dependência explícita.
5. Dimensões, duração, áudio ou legenda inconsistentes: `media-validation` bloqueia o pacote.
6. Qualquer arquivo obrigatório ausente: `delivery-manifest` permanece `technical-draft` e o job não é apresentado como publicável.

## Verificação e aceite

### Testes automatizados

- contratos de ratio, dimensões e manifesto;
- cálculo de movimento determinístico por shot;
- parsing e alinhamento de cues de legenda;
- render input vertical e paisagem;
- validação de MP4 com vídeo, áudio, duração e dimensão corretos;
- delivery exato de MP4, SRT, thumbnail, publish copy e manifesto;
- regressão do provider `codex-native` sem endpoint de imagem pago;
- testes Web do preset Shorts e configuração dos serviços.

### Smoke real controlado

Após os testes automatizados, executar um único Short curto com tema original, 3–6 shots, Edge TTS e sessão real autenticada do Codex. O resultado deverá ser aberto localmente e validado por FFprobe e amostragem de frames. Esse smoke usa a franquia da assinatura, mas não usa API paga de imagem, voz ou vídeo.

### Critério de aceite do MVP

O MVP estará tecnicamente pronto quando o smoke real produzir um `short.mp4` 720×1280 com áudio, legenda queimada legível, SRT correspondente, thumbnail, publish copy e delivery manifest `publishable`, sem provider remoto de imagem ou vídeo.

## Fora do aceite desta etapa

Não será considerado bloqueio do MVP a ausência de upload automático, analytics, agendamento, A/B de thumbnail ou geração de movimento AI. Esses itens exigem escopo e permissões próprios.
