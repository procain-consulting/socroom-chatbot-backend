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

    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
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
5. If the visitor seems like a lead, ask for name, company, email, phone number, and requirement.
6. Do not give hacking, malware, phishing, exploitation, or offensive cybersecurity instructions.
7. If asked anything unrelated such as about yourself even, politely redirect to SOCroom's services. For no reason talk about anything that's unrelated to Socroom
8. Keep answers under 40 words if the user asks for more detail, you tell them to connect with sales team.

Lead capture style:
When appropriate, say:
"Based on this, it may be worth doing a quick SOC readiness assessment. Please share your name, company, email, phone number, and what you’re looking for, and the SOCroom team can get in touch."
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
          "Authorization": "Bearer " + apiKey
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
