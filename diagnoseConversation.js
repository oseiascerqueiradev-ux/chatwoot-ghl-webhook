import dotenv from "dotenv";
import { getConversationDetails, getConversationMessages } from "./chatwootService.js";
import { findContactByPhoneOrEmail, findOpenOpportunitiesByContactId } from "./ghlService.js";

dotenv.config();

function usage() {
  console.log("Uso: node diagnoseConversation.js <conversationId> [accountId]");
}

function extractSender(details) {
  const sender = details?.meta?.sender || details?.contact || {};
  return {
    name: sender.name || null,
    phone: sender.phone_number || sender.phone || null,
    email: sender.email || null,
  };
}

async function main() {
  const conversationId = process.argv[2];
  const accountId = process.argv[3] || process.env.CHATWOOT_ACCOUNT_ID;

  if (!conversationId) {
    usage();
    process.exit(1);
  }

  const [details, messages] = await Promise.all([
    getConversationDetails(accountId, conversationId),
    getConversationMessages(accountId, conversationId),
  ]);

  const sender = extractSender(details);
  const ghlContact = await findContactByPhoneOrEmail(sender);
  const opportunities = ghlContact?.id
    ? await findOpenOpportunitiesByContactId(ghlContact.id)
    : [];

  const summary = {
    chatwoot: {
      accountId,
      conversationId: details?.id || conversationId,
      status: details?.status || null,
      channel: details?.meta?.channel || details?.channel || null,
      inboxId: details?.inbox_id || null,
      assigneeName: details?.meta?.assignee?.name || null,
      labels: details?.labels || [],
      sender,
      messageCount: messages.length,
      lastMessage: messages.length
        ? {
            createdAt: messages[messages.length - 1]?.created_at || null,
            content: messages[messages.length - 1]?.content || null,
            senderType:
              messages[messages.length - 1]?.sender?.type ||
              messages[messages.length - 1]?.sender_type ||
              null,
          }
        : null,
    },
    ghl: {
      contact: ghlContact
        ? {
            id: ghlContact.id,
            firstName: ghlContact.firstName || null,
            lastName: ghlContact.lastName || null,
            name: ghlContact.name || null,
            email: ghlContact.email || null,
            phone: ghlContact.phone || null,
            tags: ghlContact.tags || [],
          }
        : null,
      openOpportunities: opportunities.map((opportunity) => ({
        id: opportunity.id,
        name: opportunity.name,
        pipelineId: opportunity.pipelineId,
        pipelineStageId: opportunity.pipelineStageId,
        status: opportunity.status,
        updatedAt: opportunity.updatedAt,
      })),
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message,
      },
      null,
      2
    )
  );
  process.exit(1);
});
