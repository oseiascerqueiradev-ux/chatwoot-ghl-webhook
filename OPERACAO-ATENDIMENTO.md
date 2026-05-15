# Operacao de atendimento Chatwoot + GHL

Este guia e para operar enquanto o WhatsApp oficial e a Isa continuam no GHL e o Chatwoot sera usado
pela equipe para acompanhar/intervir nas conversas.

## Estado atual

- Render online: `https://chatwoot-ghl-webhook.onrender.com`
- Chatwoot API inbox: `GHL WhatsApp Bridge`
- Workflow `Stop Isa`: publicado no GHL
- Workflow `Start Isa`: publicado no GHL
- Workflow `WhatsApp Reply to Chatwoot`: manter pronto, mas publicar apenas depois do plano pago
- Webhook Chatwoot -> Render: cadastrado
- Assinatura Chatwoot: modo `warn` ate alinhar o secret entre Chatwoot e Render

## Como o atendente deve usar

1. Quando assumir uma conversa no Chatwoot, aplique a etiqueta `Stop Isa`.
2. Responda o cliente normalmente pelo Chatwoot.
3. Quando quiser devolver o atendimento para a IA, aplique `Start Isa`.
4. Se a IA responder junto com o humano, confirme se `Stop Isa` foi aplicado na conversa correta.
5. Se o cliente mandar imagem ou audio e aparecer apenas como link, abra o link para visualizar/ouvir.

## O que cada etiqueta faz

- `Stop Isa`: o servidor adiciona a tag `label:stop-isa` no contato do GHL. O workflow do GHL coloca o
  Conversation AI Bot como `Inactive`.
- `Start Isa`: o servidor adiciona a tag `label:start-isa` no contato do GHL. O workflow do GHL coloca
  o Conversation AI Bot como `Active`.

## Checklist antes de iniciar atendimento real

- Publicar o workflow `WhatsApp Reply to Chatwoot` depois que o plano pago estiver ativo.
- Fazer um teste com um numero controlado antes de atender clientes reais.
- Confirmar que mensagem do cliente aparece no Chatwoot.
- Confirmar que resposta do atendente no Chatwoot volta para o WhatsApp/GHL.
- Confirmar que `Stop Isa` pausa a IA.
- Confirmar que `Start Isa` reativa a IA.
- Confirmar comportamento de imagem/audio no Chatwoot.

## Limitacao atual de midia

Enquanto o GHL envia anexos como URL no webhook, o servidor cria a mensagem no Chatwoot como texto
com link do anexo. Isso preserva o acesso ao arquivo, mas pode nao aparecer como uma bolha nativa de
WhatsApp com preview de imagem ou botao de play.

Para chegar no visual ideal, precisamos validar o payload real de midia do GHL e, se houver URL publica
do arquivo, adaptar o envio para o formato de anexo aceito pela API do Chatwoot.

## Comandos uteis

Verificar saude do Render:

```bash
curl https://chatwoot-ghl-webhook.onrender.com/health
```

Rodar revisao de prontidao sem criar contatos ou mensagens:

```bash
npm run verify:readiness
```

Validar sintaxe dos arquivos principais:

```bash
node --check server.js
node --check webhookHandler.js
node --check ghlWebhookHandler.js
node --check ghlService.js
node --check chatwootService.js
node --check isaService.js
```

## Depois que estiver estavel

Alinhe o `CHATWOOT_WEBHOOK_SECRET` entre Chatwoot e Render e altere:

```env
CHATWOOT_SIGNATURE_MODE=enforce
```

Isso faz o servidor rejeitar webhooks com assinatura invalida.
