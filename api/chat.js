export default async function handler(req, res) {
  const allowedOrigins = [
    "https://socroom.com",
    "https://www.socroom.com"
  ];

  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const {
      message,
      conversation = [],
      lead = {},
      conversationId = "",
      pageUrl = "",
      eventType = "chat_message"
    } = req.body || {};

    const groqApiKey = process.env.GROQ_API_KEY;
    const teamsWebhookUrl = process.env.TEAMS_WEBHOOK_URL;

    if (!groqApiKey) {
      return res.status(500).json({
        error: "Groq API key is not configured."
      });
    }

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Message is required."
      });
    }

    const systemPrompt = `
You are SOCroom's AI assistant.

SOCroom provides cybersecurity operations services, including:
- Managed SOC
- SOC as a Service
- SOC Staff Augmentation
- Cloud Security Monitoring
- 24/7 threat monitoring
- Incident detection and response
- SIEM monitoring
- EDR/XDR monitoring support
- Compliance readiness support
- Cloud monitoring for AWS, Azure, and GCP environments
- Support for businesses that do not have an internal SOC team
- Support for businesses that already have a SOC team but need extra analysts or coverage

Your job:
1. Answer only questions related to SOCroom, cybersecurity monitoring, SOC services, compliance, cloud security, incident response, and staffing.
2. Keep answers simple, professional, and helpful.
3. Do not pretend to know exact pricing.
4. If asked about pricing, say pricing depends on scope, tools, assets, coverage, and compliance requirements.
5. If the visitor seems like a lead, ask for name, company, email, phone number, and requirement.
6. Do not give hacking, malware, phishing, exploitation, or offensive cybersecurity instructions.
7. If asked something unrelated, politely redirect to SOCroom's services.
8. Keep answers under 120 words unless the visitor asks for detail.

Important:
The visitor has already provided their name and phone number before starting the chat. Do not ask for name and phone again unless they ask for a human callback and information is missing.
`;

    const safeConversation = conversation
      .slice(-8)
      .filter((item) => item && item.content)
      .map((item) => ({
        role: item.role === "assistant" ? "assistant" : "user",
        content: String(item.content).slice(0, 2000)
      }));

    const messages = [
      {
        role: "system",
        content: systemPrompt
      },
      ...safeConversation,
      {
        role: "user",
        content: message
      }
    ];

    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + groqApiKey
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: messages,
          temperature: 0.3,
          max_tokens: 500
        })
      }
    );

    const data = await groqResponse.json();

    if (!groqResponse.ok) {
      console.error("Groq API error:", JSON.stringify(data, null, 2));

      const realError =
        data?.error?.message ||
        data?.error?.type ||
        "Unknown Groq API error.";

      return res.status(500).json({
        error: "Groq says: " + realError
      });
    }

    const reply =
      data?.choices?.[0]?.message?.content ||
      "Sorry, I could not generate a response.";

    if (teamsWebhookUrl) {
      await sendTeamsNotification({
        webhookUrl: teamsWebhookUrl,
        eventType,
        conversationId,
        lead,
        pageUrl,
        visitorMessage: message,
        botReply: reply,
        conversation
      });
    }

    return res.status(200).json({
      reply
    });
  } catch (error) {
    console.error("Server error:", error);

    return res.status(500).json({
      error: "Server error. Please try again."
    });
  }
}

async function sendTeamsNotification({
  webhookUrl,
  eventType,
  conversationId,
  lead,
  pageUrl,
  visitorMessage,
  botReply,
  conversation
}) {
  const name = lead?.name || "Not provided";
  const phone = lead?.phone || "Not provided";
  const company = lead?.company || "Not provided";
  const email = lead?.email || "Not provided";

  const isLeadStart = eventType === "lead_start";

  const title = isLeadStart
    ? "New SOCroom Chat Lead"
    : "SOCroom Chat Update";

  const recentTranscript = [
    ...conversation.slice(-6).map((item) => {
      const speaker = item.role === "assistant" ? "Bot" : "Visitor";
      return `${speaker}: ${item.content}`;
    }),
    `Visitor: ${visitorMessage}`,
    `Bot: ${botReply}`
  ].join("\n\n");

  const payload = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              text: title,
              weight: "Bolder",
              size: "Medium",
              wrap: true
            },
            {
              type: "FactSet",
              facts: [
                {
                  title: "Conversation ID",
                  value: conversationId || "Not available"
                },
                {
                  title: "Name",
                  value: name
                },
                {
                  title: "Phone",
                  value: phone
                },
                {
                  title: "Company",
                  value: company
                },
                {
                  title: "Email",
                  value: email
                },
                {
                  title: "Page",
                  value: pageUrl || "Not available"
                }
              ]
            },
            {
              type: "TextBlock",
              text: "Latest visitor message",
              weight: "Bolder",
              wrap: true,
              spacing: "Medium"
            },
            {
              type: "TextBlock",
              text: visitorMessage || "Not available",
              wrap: true
            },
            {
              type: "TextBlock",
              text: "Bot reply",
              weight: "Bolder",
              wrap: true,
              spacing: "Medium"
            },
            {
              type: "TextBlock",
              text: botReply || "Not available",
              wrap: true
            },
            {
              type: "TextBlock",
              text: "Recent transcript",
              weight: "Bolder",
              wrap: true,
              spacing: "Medium"
            },
            {
              type: "TextBlock",
              text: recentTranscript || "No transcript available",
              wrap: true
            }
          ]
        }
      }
    ]
  };

  try {
    const teamsResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!teamsResponse.ok) {
      const teamsError = await teamsResponse.text();
      console.error("Teams webhook error:", teamsError);
    }
  } catch (error) {
    console.error("Teams notification failed:", error);
  }
}
