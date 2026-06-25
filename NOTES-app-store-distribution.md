# LEAP Fitness — Notas de distribuição como app nativa

Notas de referência para quando decidirmos levar a PWA para as lojas. A app atual é
uma **PWA Next.js** instalável; nada disto exige reescrever a app — o site continua a ser
a mesma base.

_Última atualização: 2026-06-24._

---

## Contexto: porquê o aviso "App insegura bloqueada"

A app é instalada como **WebAPK** (gerado pelo Chrome no telemóvel do cliente). O
`targetSdkVersion` desse WebAPK é definido pelo dispositivo, não pelo nosso código —
por isso, em telemóveis desatualizados, o Google Play Protect mostra o aviso. **Não é
um bug nosso** e não há nada no repositório que o contorne. As únicas formas de o eliminar
para toda a gente passam por distribuir um pacote assinado e moderno (TWA / app nativa).

Tiers de solução:
1. **PWA pura (atual)** — avisos dependentes do dispositivo. Guia para o cliente em `GUIA-INSTALACAO-CLIENTE.md`.
2. **TWA sideloaded** (APK no nosso site + `assetlinks.json`) — remove o aviso da versão; exige "fontes desconhecidas".
3. **Loja (Play / App Store)** — experiência limpa para todos.

---

## Google Play (Android) — esforço BAIXO

A PWA já faz ~90% do trabalho. Ferramentas: **Bubblewrap** (CLI) ou **PWABuilder** geram
um **TWA** (shell assinado que carrega o nosso site ao vivo) numa tarde.

**Necessário:**
- Conta Google Play Developer — **€25, pagamento único.**
- Chave de assinatura + `assetlinks.json` no domínio (verificação de propriedade).
- Listagem na loja: ícone, screenshots, descrição, **política de privacidade** (tem de estar alojada), questionário de classificação etária, formulário de segurança de dados.

**Maior obstáculo:** contas **pessoais** criadas depois de 13 Nov 2023 têm de correr um
**teste fechado com 12+ testers durante 14 dias seguidos** antes de poderem publicar em
produção.
→ **Contas de organização (empresa) estão isentas.** Recomendação: registar a conta como o
**negócio do cliente** para saltar esta etapa.

**Timeline realista:** ~1 dia de setup + janela de teste de 14 dias (ou quase imediato se
for conta de organização a passar a revisão, normalmente 1–7 dias).

---

## Apple App Store (iOS) — esforço MÉDIO/ALTO

iOS **não tem equivalente ao TWA**. É preciso construir um wrapper nativo **WKWebView**
(PWABuilder ou Capacitor fazem o scaffold). Os problemas são estruturais, não de esforço:

- **$99/ano, recorrente** (vs. €25 único do Android).
- Precisa de um **Mac com Xcode** para compilar, assinar e submeter (ou serviço CI pago).
- **Risco real de rejeição.** A Guideline 4.2 ("minimum functionality") rejeita apps que
  são "só um site reempacotado". Para passar, é preciso comportamento **nativo** genuíno —
  o que os revisores mais valorizam são **notificações push nativas** (o Safari iOS não
  suporta web push). Provavelmente teremos de adicionar funcionalidades nativas antes da
  aprovação.

**Timeline:** revisão ~1–3 dias, mas contar com iterações por rejeição.

---

## Comparação rápida

| | Google Play | Apple App Store |
|---|---|---|
| Esforço técnico | Baixo (TWA embrulha o site atual) | Médio (webview nativo + funcionalidades nativas) |
| Custo | €25 uma vez | $99 / ano |
| Ferramentas | Qualquer computador | Mac + Xcode |
| Obstáculo principal | Teste 14 dias / 12 testers (isento se conta de organização) | Provável rejeição 4.2 sem push nativo |
| Revisão | ~1–7 dias | ~1–3 dias, esperar rejeições |

---

## Recomendação

- **Android primeiro.** Projeto pequeno, sobretudo administrativo. Registar como conta de
  **organização (negócio do cliente)** para saltar o teste de 14 dias. Maior parte do valor,
  menor custo.
- **iOS depois**, tratado como **desenvolvimento real** (não um wrap-and-ship): orçamentar
  o Mac/Xcode, o custo anual e o trabalho de adicionar funcionalidades nativas para passar a
  revisão da Apple.

## Pré-requisitos a preparar (independente da loja)
- Política de privacidade alojada (ex: `/privacidade`).
- Ícone 512×512 e screenshots por tamanho de dispositivo.
- Definir quem é o titular da conta (idealmente o negócio do cliente, não pessoal).

## Fontes
- Google Play — requisitos de teste para novas contas pessoais: https://support.google.com/googleplay/android-developer/answer/14151465
- Apple — Guideline 4.2 (minimum functionality): https://developer.apple.com/forums/thread/806726
- App Store review guidelines para wrappers webview: https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper
