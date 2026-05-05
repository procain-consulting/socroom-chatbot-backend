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

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Message is required."
      });
    }

    /*
      LEAD START:
      Send only the lead notification to Teams.
      Do not call Groq AI here.
    */
    if (eventType === "lead_start") {
      if (teamsWebhookUrl) {
        await sendTeamsLeadNotification({
          webhookUrl: teamsWebhookUrl,
          conversationId,
          lead,
          pageUrl
        });
      }

      return res.status(200).json({
        reply: "Lead captured."
      });
    }

    /*
      NORMAL AI CHAT:
      Do not send these messages to Teams.
      These will later be stored in Supabase from the frontend.
    */
    if (!groqApiKey) {
      return res.status(500).json({
        error: "Groq API key is not configured."
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
5. Do not ask for name and phone again. The visitor already submitted those before starting chat.
6. Do not give hacking, malware, phishing, exploitation, or offensive cybersecurity instructions.
7. If asked something unrelated, politely redirect to SOCroom's services.
8. Keep answers under 120 words unless the visitor asks for detail.
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

async function sendTeamsLeadNotification({
  webhookUrl,
  conversationId,
  lead,
  pageUrl
}) {
  const name = lead?.name || "Not provided";
  const phone = lead?.phone || "Not provided";

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
              text: "New SOCroom Chat Lead",
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
                  title: "Page",
                  value: pageUrl || "Not available"
                },
                {
                  title: "Source",
                  value: "SOCroom Website Chatbot"
                }
              ]
            },
            {
              type: "TextBlock",
              text: "A new visitor has submitted their details and started a chatbot conversation.",
              wrap: true,
              spacing: "Medium"
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
