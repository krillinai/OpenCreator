# YouTube Shorts Stick Figure com Imagens Codex Native — Plano de Implementação

> **Para agentes de implementação:** use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para executar este plano tarefa por tarefa. Marque cada etapa concluída com checkbox.

**Objetivo:** ampliar o workflow existente `stickman-video` para gerar um Short original de 30 segundos em inglês americano, 9:16, com imagens geradas pelo Codex autenticado da assinatura, sem endpoint pago de imagem ou vídeo.

**Arquitetura:** manter um único template com os formatos `16:9` e `9:16`, centralizar dimensões e presets no pacote de protocolo, transportar referências visuais como `localImage` pelo app-server do Codex nativo, renderizar imagens estáticas com movimento determinístico no Remotion e produzir uma entrega local validada. O preset Shorts será um patch explícito no CreatorCollaborationPanel e o preset paisagem continuará sendo o padrão compatível.

**Stack:** TypeScript, Zod, Vitest, React/Remotion 4.0.473, Chromium empacotado, FFmpeg/FFprobe locais, Edge TTS e Codex app-server autenticado.

## Evidência e limites conhecidos

- O design aprovado está em `docs/superpowers/specs/2026-09-20-youtube-shorts-stickman-codex-native-design.md`.
- O app-server já aceita `imagePaths` e converte cada caminho em item `localImage` no `turn/start`; o adaptador de imagem ainda não usa essa capacidade.
- O baseline da branch foi executado com pnpm 9.15.0. O daemon compilou e 110 arquivos de teste passaram, mas o conjunto completo terminou com 63 arquivos falhando, principalmente porque `better-sqlite3` não possui binding para Node 26 (`node-v147`), além de falhas de `ffprobe` ausente e um timeout de probe. A validação desta mudança deverá separar testes focados verdes dessas falhas ambientais e registrar qualquer bloqueio restante sem declarar a suíte inteira verde.
- Não haverá upload, publicação, Seedance/Kling/Veo, fallback silencioso para API de imagem nem alteração da franquia do Codex.

## Tarefa 1 — Criar o contrato compartilhado de formato e preset

**Arquivos:**

- Criar `packages/protocol/src/stickman.ts`.
- Alterar `packages/protocol/src/index.ts` para exportá-lo.
- Criar `packages/protocol/test/stickman.test.ts`.
- Alterar `packages/stickman-remotion/package.json` para depender de `@opencreator/protocol`.

1. Escrever primeiro os testes para:
   - aceitar somente `16:9` e `9:16`;
   - retornar `1280x720` para `16:9` e `720x1280` para `9:16`;
   - retornar `1536x1024` para geração paisagem e `1024x1536` para geração vertical;
   - aplicar o preset `youtube-shorts` como `9:16`, 30 segundos, `en-US` e `edge-tts`, mantendo `landscape` como configuração compatível.
2. Executar `npm exec --yes pnpm@9.15.0 -- --filter @opencreator/protocol test`; confirmar falha por módulo/exports inexistentes.
3. Implementar `StickmanRatio`, `StickmanOutputPreset`, `StickmanCanvas`, `stickmanCanvasForRatio`, `stickmanImageSizeForRatio` e `stickmanOutputPresetDefaults` sem duplicar números de dimensão em consumidores.
4. Exportar o contrato e executar novamente o teste focado, seguido de `npm exec --yes pnpm@9.15.0 -- --filter @opencreator/protocol typecheck`.

## Tarefa 2 — Atualizar entradas, contratos e invalidação do pipeline

**Arquivos:**

- Alterar `apps/daemon/src/creator/templates/stickman-video.ts`.
- Alterar `apps/daemon/src/creator/stickman/contracts.ts`.
- Alterar `apps/daemon/src/creator/stickman/content-executor.ts`.
- Alterar `apps/daemon/src/creator/stickman/action-handler.ts`.
- Criar `apps/daemon/test/unit/creator-stickman-format.test.ts`.
- Atualizar `apps/daemon/test/unit/creator-stickman-workflow.test.ts` e `apps/daemon/test/unit/creator-stickman-results.test.ts` quando os contratos de output mudarem.

1. Escrever testes para:
   - o schema do template aceitar `ratio: '16:9' | '9:16'` e `outputPreset`;
   - uma criação com `outputPreset: 'youtube-shorts'` persistir o conjunto vertical/inglês/Edge TTS;
   - mudar ratio/preset invalidar `style_contract`, `image_prompt_pack`, `shot_image`, `visual_validation`, timeline, render e delivery, enquanto mudanças fora do perfil visual não invalidam imagens sem necessidade;
   - o style contract, visual validation, timeline, media validation e delivery manifest carregarem ratio e dimensões esperadas;
   - o timeline rejeitar cues de legenda fora de ordem, com sobreposição ou diferentes dos frames dos segmentos.
2. Rodar os testes focados e confirmar falhas antes de editar os contratos.
3. Ampliar o input do template com `ratio` enum e `outputPreset`, mantendo `landscape`/`16:9` como default para jobs antigos. O perfil Shorts deve ser aplicado por `stickmanOutputPresetDefaults` quando selecionado explicitamente.
4. Substituir literais universais `1280`/`720` por `stickmanCanvasForRatio(ratio)` em todos os schemas. Adicionar ao timeline uma lista de cues `{ segmentId, startFrame, endFrame, text }`, mantendo o mesmo texto e timing usados no SRT.
5. Fazer o style-assets/content executor ler o ratio do job e registrar o contrato visual correspondente. Fazer a action handler tratar troca de ratio/preset como alteração do perfil visual e marcar os artefatos dependentes como stale.
6. Rodar `creator-stickman-format`, `creator-stickman-workflow`, `creator-stickman-results`, `creator-stickman-timeline` e `creator-stickman-validation`; depois rodar typecheck do daemon.

## Tarefa 3 — Ligar referências visuais reais ao Codex nativo

**Arquivos:**

- Alterar `apps/daemon/src/image-generation/codex-native.ts`.
- Alterar `apps/daemon/src/image-generation/provider.ts`.
- Alterar `apps/daemon/src/creator/stickman/image-prompt.ts`.
- Alterar `apps/daemon/src/creator/stickman/image-executor.ts`.
- Alterar `apps/daemon/test/unit/codex-native-image.test.ts`.
- Alterar `apps/daemon/test/unit/image-generation-codex-native.test.ts`.
- Alterar `apps/daemon/test/unit/creator-stickman-images.test.ts`.

1. Escrever testes para:
   - `generateCodexNativeImage` enviar `imagePaths` como itens `localImage` no turno do app-server;
   - caminhos de referência inexistentes, fora do workspace ou acima do limite de referências falharem sem iniciar geração;
   - `imageGenerationCapabilities('codex-native')` aceitar as referências locais permitidas;
   - a geração Codex nativa não chamar `fetch`, não usar endpoint de imagem e não fazer fallback remoto;
   - o executor Stickman anexar, na ordem documentada, personagem, estilo e shot anterior quando aplicável;
   - ratio vertical escolher `1024x1536`, normalizar a imagem para `720x1280` e rejeitar um candidato final com dimensão/aspect ratio incorreto.
2. Rodar os testes e confirmar a falha pela ausência de `imagePaths`, capability e dimensionamento dinâmico.
3. Adicionar `imagePaths?: string[]` a `CodexNativeImageInput`, validar cada caminho absoluto dentro de `cwd`, validar que é arquivo de imagem local e passá-lo ao `host.run`. Manter a importação do resultado limitada ao artifact local permitido em `CODEX_HOME/generated_images` ou workspace.
4. Estender `generateImageContents` com os caminhos nativos separados dos buffers remotos. Para `codex-native`, passar as referências ao app-server; para OpenAI/Gemini preservar o caminho existente de referência por request.
5. No executor Stickman, materializar cópias das referências validadas dentro do workdir do stage para que o Codex receba apenas caminhos locais sob o boundary permitido. Manter hash, lineage e `referenceImages` no ledger; registrar `provider: 'codex-native'`, `model: 'codex-native'` e uma marca explícita de que a geração foi nativa.
6. Tornar o prompt dependente de ratio e incluir área segura vertical. Manter as instruções `Reference Image 1/2/3` coerentes com a ordem dos anexos e preservar a exigência de não gerar texto dentro das imagens.
7. Derivar `size`, resize, inspeção e metadados do canvas compartilhado. Não alterar o número máximo de uma imagem por request nativo.
8. Rodar os testes nativos, `creator-stickman-images` e o typecheck do daemon. A evidência deve mostrar que não existe chamada remota quando o provider é `codex-native`.

## Tarefa 4 — Transportar captions e ratio para o timeline Remotion

**Arquivos:**

- Alterar `apps/daemon/src/creator/stickman/timeline-executor.ts`.
- Alterar `apps/daemon/src/creator/stickman/narration-subtitle.ts` somente se necessário para compartilhar o mesmo arredondamento de frames/cues.
- Alterar `packages/stickman-remotion/src/timeline.ts`.
- Alterar `packages/stickman-remotion/src/timeline.test.ts`.
- Alterar `apps/daemon/test/unit/creator-stickman-timeline.test.ts`.

1. Escrever testes para uma timeline 16:9 e uma 9:16, verificando canvas, continuidade de shots, total de frames e cues alinhados ao SRT.
2. Rodar os testes e confirmar falha nos literais de dimensão e na ausência de captions.
3. Fazer o executor ler ratio do job, obter o canvas compartilhado e incluir no manifesto `ratio`, `width`, `height` e `captions`. Cada cue deve usar o segmento de script correspondente e os mesmos `startSeconds/endSeconds` do timing FFprobe.
4. Atualizar o tipo/validador do pacote Remotion para aceitar ambos os formatos, validar `stickmanCanvasForRatio(ratio)` e rejeitar gaps/overlaps em shots e captions.
5. Garantir que SRT e captions queimadas usem exatamente a mesma fonte temporal; não fazer uma segunda estimativa de duração no renderizador.
6. Rodar os testes de timeline e o typecheck de `@opencreator/stickman-remotion`.

## Tarefa 5 — Renderizar dois formatos com movimento e legenda queimada

**Arquivos:**

- Criar `packages/stickman-remotion/src/motion.ts`.
- Alterar `packages/stickman-remotion/src/StickmanLandscape.tsx`.
- Criar `packages/stickman-remotion/src/StickmanPortrait.tsx` ou extrair um componente compartilhado equivalente, mantendo os dois ids de composição.
- Alterar `packages/stickman-remotion/src/Root.tsx`.
- Alterar `apps/daemon/src/creator/stickman/remotion-worker.ts`.
- Alterar `apps/daemon/src/creator/stickman/remotion-executor.ts`.
- Alterar `apps/daemon/test/unit/creator-stickman-remotion.test.ts`.
- Alterar `apps/daemon/test/integration/creator-stickman-remotion-smoke.test.ts` para cobrir fixture vertical quando o runtime estiver disponível.

1. Escrever testes para:
   - a função de movimento retornar o mesmo transform para o mesmo shot/progresso e limitar escala/deslocamento;
   - as duas composições existirem com dimensões 1280x720 e 720x1280;
   - o worker selecionar `StickmanLandscape` ou `StickmanPortrait` pelo ratio;
   - uma timeline com captions produzir request de render com o ratio correto.
2. Rodar os testes e confirmar falha por composição única e ausência de camada de caption.
3. Implementar movimento puro e determinístico (`static`, `push-in`, `zoom-out`, `pan-left`, `pan-right`) com deslocamento suave e sem aleatoriedade.
4. Renderizar uma imagem por shot com `object-fit: cover`/posicionamento seguro, respeitando o canvas. Adicionar caixa preta translúcida no terço inferior, texto branco em peso alto, quebra controlada e margem inferior adequada ao formato vertical.
5. Registrar as composições `StickmanLandscape` e `StickmanPortrait`, com `calculateMetadata` usando `ratio`, `fps` e `totalFrames` da timeline. O worker deve selecionar a composição correta sem hardcode de 16:9.
6. O executor deve continuar validando vídeo, áudio e duração por FFprobe, mas comparar dimensões com o canvas do manifesto. Usar um nome intermediário compatível com paisagem e `short-clean.mp4` para o render vertical; a entrega final será sempre `short.mp4` no pacote.
7. Rodar os testes unitários e o smoke Remotion empacotado quando `OPENCREATOR_STICKMAN_RUNTIME_ROOT`, `OPENCREATOR_FFMPEG_PATH` e `OPENCREATOR_FFPROBE_PATH` estiverem disponíveis.

## Tarefa 6 — Tornar media validation e delivery publicáveis

**Arquivos:**

- Alterar `apps/daemon/src/creator/stickman/media-validation-executor.ts`.
- Criar `apps/daemon/src/creator/stickman/publish-copy.ts`.
- Alterar `apps/daemon/src/creator/stickman/delivery-executor.ts`.
- Alterar `apps/daemon/src/creator/templates/stickman-video.ts`.
- Alterar `apps/daemon/test/unit/creator-stickman-media-validation.test.ts`.
- Alterar `apps/daemon/test/unit/creator-stickman-delivery.test.ts`.
- Criar `apps/daemon/test/unit/creator-stickman-publish-copy.test.ts`.

1. Escrever testes para:
   - media validation aceitar exatamente o canvas do ratio e rejeitar dimensões trocadas;
   - o pacote gerar exatamente `short.mp4`, `subtitles.srt`, `thumbnail.png` e `publish-copy.md` dentro de `delivery/`, além de `delivery-manifest.json` no workdir do artifact;
   - hashes, MIME, bytes, source artifact ids, ratio, dimensões, duração e providers entrarem no manifest;
   - a thumbnail ser extraída por FFmpeg, normalizada para 720x1280 no Shorts, decodificável e não vazia;
   - publish copy ser determinístico, derivado do script aprovado e conter título, descrição, hashtags e CTA;
   - ausência de FFmpeg/arquivo obrigatório marcar erro explícito e nunca `publishable`;
   - `publishable` só ocorrer com validações de visual, áudio, timing, render final, amostragem de frames, thumbnail e publish copy válidas.
2. Rodar os testes e confirmar falhas pela lista antiga de dois arquivos e dimensões fixas.
3. Derivar validação de media/frame do canvas compartilhado e manter três amostras decodificadas com brilho/contraste verificáveis.
4. Implementar `publish-copy.ts` sem nova chamada de LLM: título sanitizado do script aprovado, descrição formada pelas narrações aprovadas, hashtags estáveis e CTA curto. Isso mantém custo zero de API adicional e rastreabilidade.
5. Alterar o delivery executor para:
   - copiar o vídeo para `short.mp4` e SRT para `subtitles.srt`;
   - extrair um frame central do vídeo com FFmpeg, redimensionar via Sharp sem deformar e gravar `thumbnail.png`;
   - gravar `publish-copy.md` e validá-lo como texto não vazio;
   - validar o conjunto exato, hashes e lineage;
   - incluir os quatro arquivos físicos no array do manifest e emitir artifacts `thumbnail` e `publish_copy` além de `delivery_manifest`.
6. Alterar o stage `package-validation` para receber `script_manifest`, exigir os novos artifacts e anunciar os outputs no template. Manter o manifest fora da lista autorreferencial de arquivos, mas como quinto arquivo obrigatório do pacote entregue.
7. Rodar `creator-stickman-media-validation`, `creator-stickman-delivery`, `creator-stickman-publish-copy`, `creator-stickman-results` e typecheck do daemon.

## Tarefa 7 — Integrar preset Shorts e arquivos no CreatorCollaborationPanel

**Arquivos:**

- Alterar `apps/web/src/features/dashboard/StickmanVideoWorkspace.tsx`.
- Alterar `apps/web/src/features/dashboard/StickmanVideoWorkspace.test.tsx`.
- Alterar `apps/web/src/features/dashboard/DashboardPage.test.tsx` somente nos snapshots/fixtures afetados.
- Alterar `apps/web/e2e/support/fake-stickman-daemon.ts`.
- Alterar `apps/web/e2e/stickman-web-desktop-parity.spec.ts` se o contrato fake exigir novos arquivos.

1. Escrever testes para:
   - o seletor de formato aplicar `youtube-shorts`, ratio 9:16, 30 segundos, `en-US` e Edge TTS;
   - paisagem continuar selecionável e não perder o ratio atual quando o usuário altera apenas outra configuração;
   - provider `codex-native` ser tratado como configurado sem API key e liberar o botão de início;
   - a mensagem de configuração explicar “Codex pela assinatura” e não pedir chave de imagem;
   - a entrega exibir e permitir abrir/baixar vídeo, SRT, thumbnail e publish copy.
2. Rodar o teste web focado e confirmar a falha do ratio fixo `16:9`, do bloqueio do Codex e da lista de dois outputs.
3. Adicionar o controle de formato dentro do workspace existente, sem criar Agent Panel novo. Ao selecionar Shorts, aplicar o patch completo do preset; em atualizações normais, preservar `state.ratio` em vez de sobrescrevê-lo.
4. Alterar a leitura de configuração para considerar `codex-native` configurado quando o Runtime reportar esse provider, sem verificar API key. Manter OpenAI/Gemini com a regra atual.
5. Atualizar tipos de manifest, `deliveryKinds`, rótulos/ícones e fixtures fake para os novos artifacts e nomes exatos. A preview de vídeo deve continuar apontando para o artifact `clean_video` do snapshot.
6. Rodar `npm exec --yes pnpm@9.15.0 -- --filter @opencreator/web test -- StickmanVideoWorkspace.test.tsx` e o E2E de paridade quando o ambiente Playwright estiver disponível.

## Tarefa 8 — Testar integração completa e corrigir regressões

**Arquivos de teste e documentação:**

- Atualizar `apps/daemon/test/integration/creator-stickman-real-pipeline.test.ts` para aceitar uma configuração Shorts explícita sem remover a cobertura paisagem existente, ou adicionar `apps/daemon/test/integration/creator-stickman-shorts-real-pipeline.test.ts` se a separação deixar o teste mais claro.
- Atualizar `apps/daemon/test/integration/codex-native-real-smoke.test.ts` apenas para compartilhar a preparação de referência local, sem tornar o smoke real obrigatório em CI.
- Atualizar `docs/superpowers/specs/2026-09-20-youtube-shorts-stickman-codex-native-design.md` somente se o comportamento implementado precisar de uma decisão já aprovada mais precisa.

1. Rodar a bateria focada completa com pnpm 9:
   `npm exec --yes pnpm@9.15.0 -- --filter @opencreator/protocol test`
   `npm exec --yes pnpm@9.15.0 -- --filter @opencreator/stickman-remotion test`
   `npm exec --yes pnpm@9.15.0 -- --filter @opencreator/daemon test -- test/unit/creator-stickman-format.test.ts test/unit/creator-stickman-images.test.ts test/unit/creator-stickman-timeline.test.ts test/unit/creator-stickman-remotion.test.ts test/unit/creator-stickman-media-validation.test.ts test/unit/creator-stickman-delivery.test.ts test/unit/creator-stickman-publish-copy.test.ts test/unit/image-generation-codex-native.test.ts test/unit/codex-native-image.test.ts`
   `npm exec --yes pnpm@9.15.0 -- --filter @opencreator/web test -- StickmanVideoWorkspace.test.tsx`
2. Rodar `npm exec --yes pnpm@9.15.0 -- --filter @opencreator/protocol typecheck`, `npm exec --yes pnpm@9.15.0 -- --filter @opencreator/stickman-remotion typecheck`, `npm exec --yes pnpm@9.15.0 -- --filter @opencreator/daemon typecheck` e o typecheck web.
3. Com runtime local disponível, executar um único smoke real de 3–6 shots, tema original, Shorts, Edge TTS e provider `codex-native`. Usar a franquia da assinatura; não configurar nem chamar API paga de imagem/vídeo.
4. Validar o resultado por FFprobe e amostragem de frames. Confirmar `delivery/short.mp4` em 720x1280, áudio, legenda queimada, `delivery/subtitles.srt`, `delivery/thumbnail.png`, `delivery/publish-copy.md` e `delivery-manifest.json` com `publishable` quando OCR/FFmpeg estiverem disponíveis.
5. Abrir o MP4 e a thumbnail localmente, registrar o caminho absoluto dos artifacts e guardar a evidência do provider `codex-native`/modelo `codex-native` sem endpoint remoto.
6. Rodar o build relevante e, por último, a suíte daemon completa. Separar regressões introduzidas nesta mudança dos bloqueios já observados de Node 26/better-sqlite3, FFprobe ausente e timeout de probe.

## Tarefa 9 — Revisão, verificação e integração da branch

1. Executar `git diff --check`, revisar contratos e confirmar que nenhum `1280x720` universal permaneceu em timeline, render, media validation, delivery ou UI.
2. Usar a skill de code review para revisar a diff da branch, com atenção a: envio de referências locais ao Codex, ausência de fallback pago, escapes de path, hash/lineage, nomes de entrega e compatibilidade 16:9.
3. Executar a skill de verificação antes de afirmar conclusão: testes focados verdes, typechecks verdes e smoke real ou bloqueio documentado com evidência.
4. Fazer commit atômico com mensagem `feat: add Codex-native YouTube Shorts pipeline` depois que a verificação passar.
5. Manter a branch `feat/youtube-shorts-codex-native` pronta para a decisão posterior de merge/push; não publicar no YouTube nem fazer upload automático.

## Critério final de aceite

O trabalho só será considerado concluído quando o mesmo workflow `stickman-video` conseguir produzir, por entrada original e preset Shorts, um vídeo local 720x1280 com áudio, captions queimadas e SRT alinhado, thumbnail, publish copy e manifest coerente, usando o provider `codex-native` através da sessão autenticada do Codex e nenhuma API paga de imagem ou vídeo. O fluxo paisagem 1280x720 deve continuar coberto pelos testes de regressão.
