# Checklist de deploy: Chatwoot + GHL

## Estado atual

- Chatwoot API Inbox criado: `GHL WhatsApp Bridge`
- `CHATWOOT_GHL_INBOX_ID`: `109302`
- Conta Chatwoot: `160070`
- Location GHL: `C8d1LN8IL9XdN9kDkaF9`
- Render URL: `https://chatwoot-ghl-webhook.onrender.com`

## 1. Publicar o projeto no Render

O projeto precisa estar em um repositorio GitHub/GitLab/Bitbucket para o Render criar o Web Service.
Depois de conectar o repositorio:

- Service type: `Web Service`
- Name: `chatwoot-ghl-webhook`
- Runtime: `Node`
- Build command: `npm ci`
- Start command: `npm start`
- Health check path: `/health`

## 2. Variaveis obrigatorias no Render

Copie do `.env` local, sem compartilhar publicamente:

```env
CHATWOOT_BASE_URL=https://app.chatwoot.com
CHATWOOT_API_TOKEN=
CHATWOOT_ACCOUNT_ID=160070
CHATWOOT_WEBHOOK_SECRET=
CHATWOOT_SIGNATURE_MODE=warn
CHATWOOT_GHL_INBOX_ID=109302
GHL_TO_CHATWOOT_WEBHOOK_SECRET=
ENABLE_CHATWOOT_TO_GHL_REPLY_SYNC=true
GHL_OUTBOUND_MESSAGE_TYPE=WhatsApp
CHATWOOT_ATTACHMENT_MAX_BYTES=26214400
CHATWOOT_ATTACHMENT_DOWNLOAD_TIMEOUT_MS=15000
GHL_PRIVATE_INTEGRATION_TOKEN=
GHL_LOCATION_ID=C8d1LN8IL9XdN9kDkaF9
ENABLE_GHL_OPPORTUNITY_SYNC=true
GHL_OPPORTUNITY_PIPELINE_ID=
GHL_OPPORTUNITY_STAGE_ID=
GHL_OPPORTUNITY_STAGE_ID_OPEN=
GHL_OPPORTUNITY_STAGE_ID_PENDING=
GHL_OPPORTUNITY_STAGE_ID_RESOLVED=
ISA_STOP_LABELS=Stop Isa,stop-isa,stop_isa
ISA_START_LABELS=Star Isa,Start Isa,star-isa,start-isa,star_isa,start_isa
```

Depois do deploy, abra:

```text
https://chatwoot-ghl-webhook.onrender.com/health
```

Confirme:

- `ok: true`
- `chatwootGhlInboxId: "109302"`
- `hasGhlToChatwootWebhookSecret: true`
- `enableChatwootToGhlReplySync: true`
- `chatwootSignatureMode: "warn"` enquanto o segredo do webhook nao estiver alinhado; use
  `"enforce"` depois que Render e Chatwoot estiverem com o mesmo `CHATWOOT_WEBHOOK_SECRET`.

## 3. Workflow GHL -> Chatwoot

Crie um workflow no GHL para enviar as mensagens novas do WhatsApp/GHL para o Chatwoot.

Trigger recomendado:

- `Customer Replied` / cliente respondeu
- Canal: WhatsApp, se o filtro estiver disponivel

Action:

- `Webhook`
- Method: `POST`
- URL: `https://chatwoot-ghl-webhook.onrender.com/webhook/ghl`
- Header: `Content-Type: application/json`
- Header: `x-ghl-webhook-secret: mesmo valor de GHL_TO_CHATWOOT_WEBHOOK_SECRET`

Payload base:

```json
{
  "event": "message.received",
  "contactId": "{{contact.id}}",
  "conversationId": "{{conversation.id}}",
  "messageId": "{{message.id}}",
  "fullName": "{{contact.name}}",
  "phone": "{{contact.phone}}",
  "email": "{{contact.email}}",
  "direction": "incoming",
  "message": "{{message.body}}"
}
```

Se o GHL nao oferecer `{{conversation.id}}`, envie apenas `contactId`; o servidor reutiliza a conversa
aberta do contato no inbox API.

Para midias, envie URLs acessiveis pelo Render em `attachments`, `media`, `mediaUrl`, `attachmentUrl`
ou `fileUrl`. O servidor tentara criar anexos reais no Chatwoot; se nao conseguir baixar o arquivo,
mantem o link no corpo da mensagem.

## 4. Workflow Stop Isa

O caminho recomendado agora e por tag, porque o Chatwoot envia a etiqueta para o servidor e o
servidor grava a tag correspondente no contato do GHL.

Status atual: publicado em 14/05/2026.

Trigger:

- `Contact Tag`
- Condicao: tag adicionada `label:stop-isa`

Action:

- `Update Conversation AI Bot and Status`
- Bot: `Isa` ou `Keep Same`
- Status: `Inactive`

Esse fluxo ja esta publicado. Se precisar interromper a automacao temporariamente, volte o status do
workflow para `Draft`.

## 5. Workflow Start Isa

Status atual: publicado em 14/05/2026.

Trigger:

- `Contact Tag`
- Condicao: tag adicionada `label:start-isa`

Action:

- `Update Conversation AI Bot and Status`
- Bot: `Isa` ou `Keep Same`
- Status: `Active`

Esse fluxo ja esta publicado. Se precisar interromper a automacao temporariamente, volte o status do
workflow para `Draft`.

Observacao: o codigo tambem aceita `ISA_STOP_WEBHOOK_URL` e `ISA_START_WEBHOOK_URL` se decidirmos
voltar para Inbound Webhook depois, mas nao e mais obrigatorio para essa versao.

## 6. Webhook do Chatwoot

No Chatwoot, configure webhook para:

```text
https://chatwoot-ghl-webhook.onrender.com/webhook/chatwoot
```

Eventos:

- `conversation_created`
- `message_created`
- `conversation_status_changed`
- `conversation_updated`

Secret:

- Mesmo valor de `CHATWOOT_WEBHOOK_SECRET`

## 7. Teste final

1. Cliente manda mensagem no WhatsApp/GHL.
2. GHL chama `/webhook/ghl`.
3. Conversa aparece no Chatwoot no inbox `GHL WhatsApp Bridge`.
4. Atendente coloca etiqueta `Stop Isa`.
5. Servidor adiciona a tag `label:stop-isa` no contato do GHL.
6. Atendente responde no Chatwoot.
7. Servidor envia a resposta para o GHL/WhatsApp.
8. Atendente coloca etiqueta `Start Isa` ou `Star Isa`.
9. Servidor adiciona a tag `label:start-isa` no contato do GHL.

## 8. Revisao sem conexao real

Enquanto o plano pago/conexao final nao estiver ativo, rode:

```bash
npm run verify:readiness
```

Esse comando apenas consulta configuracoes e nao cria contatos, conversas ou mensagens.

Para a rotina dos atendentes, use o guia [OPERACAO-ATENDIMENTO.md](./OPERACAO-ATENDIMENTO.md).
