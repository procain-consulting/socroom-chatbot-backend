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
    const { message, conversation = [] } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Message is required."
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "Gemini API key is not configured."
      });
    }

    const socroomKnowledge = `
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
8. Keep answers under 120 words unless the user asks for detail.
`;

    const conversationText = conversation
      .map((item) => {
        const role = item.role === "assistant" ? "Assistant" : "Visitor";
        return `${role}: ${item.content}`;
      })
      .join("\n");

    const prompt = `
${socroomKnowledge}

Recent conversation:
${conversationText}

Visitor's latest question:
${message}

Answer as SOCroom's AI assistant:
`;

    const geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 500
          }
        })
      }
    );

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error("Gemini API error:", JSON.stringify(data, null, 2));

      const realError =
        data?.error?.message ||
        data?.error?.status ||
        "Unknown Gemini API error.";

      return res.status(500).json({
        error: "Gemini says: " + realError
      });
    }

    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
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
