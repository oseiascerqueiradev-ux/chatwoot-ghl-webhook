# Workflows GHL para Chatwoot

## 1. GHL -> Chatwoot Bridge

Status atual: criado em rascunho como `WhatsApp Reply to Chatwoot`.

Esse workflow recebe uma resposta do cliente no WhatsApp/GHL e envia a mensagem para:

```text
https://chatwoot-ghl-webhook.onrender.com/webhook/ghl
```

Mantenha em rascunho enquanto o GHL mostrar aviso de acao premium. Publique apenas quando for iniciar
o atendimento real e aceitar a cobranca por execucao.

## 2. Stop Isa

Status atual: publicado em 14/05/2026.

Workflow no GHL:

- Nome: `Stop Isa`
- Trigger: `Contact Tag`
- Condicao: tag adicionada `label:stop-isa`
- Action: `Update Conversation AI Bot and Status`
- Bot: `Isa` ou `Keep Same`
- Status: `Inactive`

Esse fluxo e disparado quando o atendente coloca a etiqueta `Stop Isa` no Chatwoot. O servidor recebe
o webhook do Chatwoot e adiciona a tag `label:stop-isa` no contato do GHL.

## 3. Start Isa

Status atual: publicado em 14/05/2026.

Workflow no GHL:

- Nome: `Start Isa`
- Trigger: `Contact Tag`
- Condicao: tag adicionada `label:start-isa`
- Action: `Update Conversation AI Bot and Status`
- Bot: `Isa` ou `Keep Same`
- Status: `Active`

Esse fluxo e disparado quando o atendente coloca a etiqueta `Start Isa` ou `Star Isa` no Chatwoot. O
servidor recebe o webhook do Chatwoot e adiciona a tag `label:start-isa` no contato do GHL.

## Observacao importante

Tentamos usar `Inbound Webhook`, mas o GHL exigiu `Mapping Reference` e nao disponibilizou a amostra
mesmo apos o envio do payload de teste. Por isso, a rota por tag e mais simples, mais rastreavel e
nao exige configurar `ISA_STOP_WEBHOOK_URL` ou `ISA_START_WEBHOOK_URL` no Render.
