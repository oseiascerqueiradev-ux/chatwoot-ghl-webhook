# chatwoot-ghl-webhook

Webhook handler em Node.js que sincroniza conversas do **Chatwoot** para o **GoHighLevel (GHL)**.

> Importante: este projeto esta pronto para o modelo em que o **Chatwoot e o canal oficial de atendimento** e o **GHL e o CRM**. Se o WhatsApp/IA continuar conectado diretamente no GHL, a integracao precisa de uma etapa adicional: receber eventos do GHL e espelhar as mensagens no Chatwoot via API, sem tentar migrar o mesmo numero do WhatsApp para outro parceiro Meta.

## Fluxo

```text
Cliente fala com a equipe no Chatwoot (inclusive WhatsApp direto)
  -> Chatwoot dispara webhook (conversation_created / message_created / conversation_status_changed)
    -> Este servidor valida a assinatura do webhook
      -> Busca detalhes da conversa e mensagens via API do Chatwoot
        -> Faz upsert do contato no GHL (cria ou atualiza)
          -> Adiciona nota com historico da conversa e anexos
```

## Modelo operacional recomendado

- **Chatwoot como canal principal**: WhatsApp e atendimento humano ficam centralizados no Chatwoot
- **GHL como CRM principal**: contatos, pipelines, automacoes e IA continuam centralizados no GoHighLevel
- **Sync unidirecional para CRM**: este servidor consome os webhooks do Chatwoot e atualiza o GHL
- **Midia preservada no historico**: a nota no GHL inclui contexto de anexos presentes na conversa do Chatwoot

Se o WhatsApp oficial ainda estiver no GHL, nao desconecte o parceiro atual apenas para testar. O caminho seguro e tratar o GHL como origem das mensagens e construir um espelho para o Chatwoot.

---

## Requisitos

- Node.js 18+
- Instancia do Chatwoot (cloud ou self-hosted)
- Conta GHL com Private Integration Token (preferencial) ou API Key legada

---

## Setup

### 1. Instale as dependencias

```bash
npm install
```

### 2. Configure as variaveis de ambiente

```bash
cp .env.example .env
```

Edite o `.env` com suas credenciais:

| Variavel | Onde encontrar |
|---|---|
| `CHATWOOT_BASE_URL` | URL da sua instancia Chatwoot |
| `CHATWOOT_API_TOKEN` | Settings -> Profile -> Access Token |
| `CHATWOOT_ACCOUNT_ID` | Na URL: `/app/accounts/123` |
| `CHATWOOT_WEBHOOK_SECRET` | Settings -> Integrations -> Webhooks |
| `GHL_PRIVATE_INTEGRATION_TOKEN` | GHL -> Settings -> Private Integrations |
| `GHL_API_KEY` | Legado. Use apenas se ainda nao migrou |
| `GHL_LOCATION_ID` | GHL -> Settings -> Business Info |

O nome recomendado para autenticacao no GHL agora e `GHL_PRIVATE_INTEGRATION_TOKEN`.
`GHL_API_KEY` continua funcionando como fallback para nao quebrar setups antigos.

Para sincronizar contatos e notas do Chatwoot no GHL via API, o Private Integration Token
deve incluir pelo menos os escopos de:

- `View/Edit Contacts`
- `View/Edit Contact Notes`
- `View/Edit Opportunities`, se `ENABLE_GHL_OPPORTUNITY_SYNC=true`

### 3. Inicie o servidor

```bash
# Desenvolvimento (com auto-restart)
npm run dev

# Producao
npm start
```

Se faltar alguma variavel obrigatoria, o servidor aborta na inicializacao com a lista do que precisa ser configurado.

---

## Configurar o webhook no Chatwoot

1. Acesse **Settings -> Integrations -> Webhooks**
2. Clique em **Add new webhook**
3. URL: `https://seu-dominio.com/webhook/chatwoot`
4. Marque **Conversation created**, **Message created** e **Conversation status changed**
5. Copie o **Webhook Secret** e coloque em `CHATWOOT_WEBHOOK_SECRET`

> Para testar localmente, use o [ngrok](https://ngrok.com):
>
> ```bash
> ngrok http 3000
> ```

---

## Campos customizados no GHL

Crie estes campos em **GHL -> Settings -> Custom Fields** para rastreabilidade:

| Nome | Chave (key) | Tipo |
|---|---|---|
| Chatwoot Conversation ID | `chatwoot_conversation_id` | Text |
| Chatwoot Canal | `chatwoot_canal` | Text |
| Chatwoot Labels | `chatwoot_labels` | Text |
| Chatwoot Status | `chatwoot_status` | Text |
| Chatwoot Inbox ID | `chatwoot_inbox_id` | Text |
| Chatwoot Responsavel | `chatwoot_responsavel` | Text |
| Chatwoot Ultima Mensagem Em | `chatwoot_ultima_mensagem_em` | Text |
| Chatwoot Ultima Direcao | `chatwoot_ultima_direcao` | Text |

O comportamento atual do sync no CRM ficou assim:

- `conversation_created`: cria/atualiza o contato e registra uma nota com o historico completo da conversa
- `message_created`: atualiza os campos de contexto do Chatwoot e adiciona uma nota incremental com a ultima mensagem publica
- `conversation_updated`: atualiza contexto/tags e pode disparar automacoes por etiqueta, sem criar nota repetida no GHL
- anexos continuam aparecendo descritos no corpo da nota para manter contexto no GHL
- o contato tambem recebe tags automaticas, como `origem:chatwoot`, `canal:<canal>`, `status:<status>`, `inbox:<id>` e `label:<nome>`

## Controle da IA Isa por etiquetas

Para evitar conflito entre atendimento humano no Chatwoot e a IA do GHL, o projeto reconhece duas
etiquetas de controle na conversa:

- `Stop Isa`: adiciona a tag `label:stop-isa` no contato do GHL
- `Star Isa` ou `Start Isa`: adiciona a tag `label:start-isa` no contato do GHL

No GHL, os workflows publicados escutam essas tags e usam a acao nativa **Update Conversation AI Bot
and Status**:

- tag `label:stop-isa`: atualizar a Isa para `Inactive`
- tag `label:start-isa`: atualizar a Isa para `Active`

Opcionalmente, personalize os nomes aceitos das etiquetas:

```env
ISA_STOP_LABELS=Stop Isa,stop-isa,stop_isa
ISA_START_LABELS=Star Isa,Start Isa,star-isa,start-isa,star_isa,start_isa
```

O codigo ainda aceita `ISA_STOP_WEBHOOK_URL` e `ISA_START_WEBHOOK_URL` como alternativa futura, mas
isso nao e necessario no fluxo atual por tags.

## Oportunidade opcional no GHL

Se quiser que uma nova conversa do Chatwoot tambem abra uma oportunidade no GHL, habilite:

```env
ENABLE_GHL_OPPORTUNITY_SYNC=true
GHL_OPPORTUNITY_PIPELINE_ID=seu_pipeline_id
GHL_OPPORTUNITY_STAGE_ID=seu_stage_id
GHL_OPPORTUNITY_STAGE_ID_OPEN=
GHL_OPPORTUNITY_STAGE_ID_PENDING=
GHL_OPPORTUNITY_STAGE_ID_RESOLVED=
```

Por seguranca, essa funcionalidade fica desligada por padrao. Quando ligada, o projeto tenta
garantir uma oportunidade aberta para a conversa sempre que receber eventos relevantes do
Chatwoot. Isso evita perder a oportunidade caso o primeiro webhook seja perdido ou processado fora
de ordem.

Se o contato ja tiver uma oportunidade aberta no mesmo pipeline, o projeto reutiliza a existente
em vez de criar duplicata.

Se encontrar mais de uma oportunidade aberta no mesmo pipeline para o mesmo contato, o projeto
mantem a mais recente e tenta encerrar as duplicadas antigas como `lost`.

Quando os mapeamentos de stage estiverem preenchidos, a oportunidade tambem pode ser atualizada
com base no status do Chatwoot (`open`, `pending`, `resolved`).

Mapeamento atualmente recomendado para o pipeline `Prospecção`:

- `open` -> `Entrada`
- `pending` -> `Qualificação`
- `resolved` -> `Atendimento realizado`

---

## Deploy em producao

### Railway / Render / Fly.io

1. Faca push do projeto para um repositorio Git
2. Conecte na plataforma escolhida
3. Configure as variaveis de ambiente no painel
4. O start command e: `npm start`

Em plataformas gerenciadas, as variaveis devem ser configuradas no painel da propria plataforma. Nao use `.env` em producao.

### Render

Este projeto ja inclui um [render.yaml](/C:/Users/bocat/OneDrive/Área%20de%20Trabalho/Projeto%20woot/render.yaml:1) com:

- `buildCommand`: `npm ci`
- `startCommand`: `npm start`
- `healthCheckPath`: `/health`

Basta subir o repositorio e deixar o Render ler esse arquivo.

### Docker / Railway / VPS

O projeto tambem inclui um [Dockerfile](/C:/Users/bocat/OneDrive/Área%20de%20Trabalho/Projeto%20woot/Dockerfile:1) para empacotamento simples:

```bash
docker build -t chatwoot-ghl-webhook .
docker run --rm -p 3000:3000 --env-file .env chatwoot-ghl-webhook
```

Se preferir subir com Compose, use o [docker-compose.yml](/C:/Users/bocat/OneDrive/Área%20de%20Trabalho/Projeto%20woot/docker-compose.yml:1):

```bash
cp .env.example .env
# edite o .env com suas credenciais reais
docker compose up --build -d
```

Para parar:

```bash
docker compose down
```

Para acompanhar os logs:

```bash
docker compose logs -f
```

Para conferir o estado do container:

```bash
docker compose ps
```

O container agora possui healthcheck baseado em `/health`, entao voce consegue ver rapidamente se ele ficou saudavel.

### VPS com PM2

```bash
npm install -g pm2
pm2 start server.js --name chatwoot-ghl --node-args="--env-file=.env"
pm2 save
pm2 startup
```

---

## Estrutura do projeto

```text
.
|-- .gitignore
|-- .dockerignore
|-- Dockerfile
|-- docker-compose.yml
|-- render.yaml
|-- config.js
|-- server.js
|-- webhookHandler.js
|-- chatwootService.js
|-- ghlService.js
|-- signature.js
|-- logger.js
`-- .env.example
```

## Teste rapido

Com o servidor rodando, voce pode verificar:

```bash
curl http://localhost:3000/health
```

Para enviar o payload de exemplo com assinatura automatica:

```bash
npm run test:webhook
```

Por padrao ele envia para `http://localhost:3000/webhook/chatwoot` usando `sample-chatwoot-conversation-created.json`.

Se quiser apontar para outra URL, defina `TEST_WEBHOOK_URL` no ambiente antes de rodar.

Para revisar a prontidao sem criar contatos ou mensagens:

```bash
npm run verify:readiness
```

## Diagnostico rapido

Para inspecionar uma conversa do Chatwoot e ver o contato/oportunidades correspondentes no GHL:

```bash
npm run diagnose:conversation -- 26
```

O diagnostico retorna:

- status e metadados da conversa no Chatwoot
- remetente principal
- ultima mensagem encontrada
- contato correspondente no GHL
- oportunidades abertas do contato

## Deduplicacao de webhook

O processamento do webhook agora guarda uma memoria curta por `deliveryId`, evento, conversa, status
e mensagem para reduzir retrabalho em retries proximos do Chatwoot.

Para `message_created`, o projeto prioriza a mensagem exata do webhook em vez de simplesmente usar
a ultima mensagem visivel da conversa. Isso evita criar nota errada quando chegam mensagens muito
proximas uma da outra.

## Primeira subida real com Docker

1. Copie `.env.example` para `.env`
2. Preencha `CHATWOOT_BASE_URL`, `CHATWOOT_API_TOKEN`, `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_WEBHOOK_SECRET`, `GHL_PRIVATE_INTEGRATION_TOKEN` e `GHL_LOCATION_ID`
3. Rode `docker compose up --build -d`
4. Verifique `docker compose ps`
5. Teste `http://localhost:3000/health`
6. Exponha a porta com ngrok ou publique em um dominio
7. Cadastre a URL `/webhook/chatwoot` no Chatwoot

## Observacao sobre o endpoint do GHL

O endpoint `/webhook/ghl` agora recebe eventos do GHL e espelha mensagens em um inbox de API do
Chatwoot. Esse e o caminho recomendado quando o WhatsApp oficial e a Isa continuam no GHL, mas o time
quer acompanhar/intervir pelo Chatwoot.

### Ponte GHL -> Chatwoot

Crie um inbox do tipo **API** no Chatwoot e configure:

```env
CHATWOOT_GHL_INBOX_ID=ID_DO_INBOX_API
GHL_TO_CHATWOOT_WEBHOOK_SECRET=um_segredo_forte
ENABLE_CHATWOOT_TO_GHL_REPLY_SYNC=true
GHL_OUTBOUND_MESSAGE_TYPE=WhatsApp
```

No GHL, crie um workflow para mensagens novas/recebidas e envie um webhook para:

```text
https://seu-dominio.com/webhook/ghl
```

Inclua no header:

```text
x-ghl-webhook-secret: mesmo_valor_de_GHL_TO_CHATWOOT_WEBHOOK_SECRET
```

Payload minimo recomendado:

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

O servidor tenta reaproveitar o contato/conversa no Chatwoot usando `contactId`, telefone, email e
`conversationId`. Se vierem anexos como URLs, o servidor tenta baixar a midia e criar a mensagem no
Chatwoot com anexo real. Assim imagens aparecem com preview e audios aparecem com player quando a URL
do arquivo estiver acessivel pelo Render. Se o download ou upload do anexo falhar, o servidor cai para
o modo seguro e adiciona os links no corpo da mensagem.

Limites opcionais para midia:

```env
CHATWOOT_ATTACHMENT_MAX_BYTES=26214400
CHATWOOT_ATTACHMENT_DOWNLOAD_TIMEOUT_MS=15000
```

Quando `ENABLE_CHATWOOT_TO_GHL_REPLY_SYNC=true`, respostas enviadas por atendentes dentro desse inbox
API do Chatwoot sao reenviadas para o GHL usando os IDs salvos na conversa (`ghl_contact_id` e
`ghl_conversation_id`). Assim o Chatwoot deixa de ser apenas uma tela de leitura e passa a funcionar
como ponto de atendimento.

Para testar localmente com o payload de exemplo:

```bash
npm run test:ghl-webhook
```
