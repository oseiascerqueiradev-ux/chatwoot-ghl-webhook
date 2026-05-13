# Checklist de deploy: Chatwoot + GHL

## Estado atual

- Chatwoot API Inbox criado: `GHL WhatsApp Bridge`
- `CHATWOOT_GHL_INBOX_ID`: `109302`
- Conta Chatwoot: `160070`
- Location GHL: `C8d1LN8IL9XdN9kDkaF9`

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
CHATWOOT_GHL_INBOX_ID=109302
GHL_TO_CHATWOOT_WEBHOOK_SECRET=
ENABLE_CHATWOOT_TO_GHL_REPLY_SYNC=true
GHL_OUTBOUND_MESSAGE_TYPE=WhatsApp
GHL_PRIVATE_INTEGRATION_TOKEN=
GHL_LOCATION_ID=C8d1LN8IL9XdN9kDkaF9
ENABLE_GHL_OPPORTUNITY_SYNC=true
GHL_OPPORTUNITY_PIPELINE_ID=
GHL_OPPORTUNITY_STAGE_ID=
GHL_OPPORTUNITY_STAGE_ID_OPEN=
GHL_OPPORTUNITY_STAGE_ID_PENDING=
GHL_OPPORTUNITY_STAGE_ID_RESOLVED=
ISA_STOP_WEBHOOK_URL=
ISA_START_WEBHOOK_URL=
ISA_STOP_LABELS=Stop Isa,stop-isa,stop_isa
ISA_START_LABELS=Star Isa,Start Isa,star-isa,start-isa,star_isa,start_isa
```

Depois do deploy, abra:

```text
https://SEU-SERVICO.onrender.com/health
```

Confirme:

- `ok: true`
- `chatwootGhlInboxId: "109302"`
- `hasGhlToChatwootWebhookSecret: true`
- `enableChatwootToGhlReplySync: true`

## 3. Workflow GHL -> Chatwoot

Crie um workflow no GHL para enviar as mensagens novas do WhatsApp/GHL para o Chatwoot.

Trigger recomendado:

- `Customer Replied` / cliente respondeu
- Canal: WhatsApp, se o filtro estiver disponivel

Action:

- `Webhook`
- Method: `POST`
- URL: `https://SEU-SERVICO.onrender.com/webhook/ghl`
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

## 4. Workflow Stop Isa

Trigger:

- `Inbound Webhook`

Action:

- `Update Conversation AI Bot and Status`
- Bot: `Isa` ou `Keep Same`
- Status: `Inactive`

Depois de salvar o workflow, copie a URL do Inbound Webhook e configure:

```env
ISA_STOP_WEBHOOK_URL=
```

## 5. Workflow Start Isa

Trigger:

- `Inbound Webhook`

Action:

- `Update Conversation AI Bot and Status`
- Bot: `Isa` ou `Keep Same`
- Status: `Active`

Depois de salvar o workflow, copie a URL do Inbound Webhook e configure:

```env
ISA_START_WEBHOOK_URL=
```

## 6. Webhook do Chatwoot

No Chatwoot, configure webhook para:

```text
https://SEU-SERVICO.onrender.com/webhook/chatwoot
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
5. Servidor chama `ISA_STOP_WEBHOOK_URL`.
6. Atendente responde no Chatwoot.
7. Servidor envia a resposta para o GHL/WhatsApp.
8. Atendente coloca etiqueta `Start Isa` ou `Star Isa`.
9. Servidor chama `ISA_START_WEBHOOK_URL`.
