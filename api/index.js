module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ code: "METHOD_NOT_ALLOWED", error: "Please send a POST request." });
  }

  try {
    const { message, mode = "compare", context = "" } = req.body || {};

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ code: "INVALID_MESSAGE", error: "Please enter a message." });
    }
    if (message.length > 12000 || String(context).length > 16000) {
      return res.status(413).json({ code: "MESSAGE_TOO_LONG", error: "This request is too long. Please shorten it and try again." });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ code: "MISSING_API_KEY", error: "Gemini API key is missing." });
    }

    const safeMode = ["compare", "followup", "faq"].includes(mode) ? mode : "compare";
    const systemText = safeMode === "faq"
      ? "You are SmartHub X website support. Answer ONLY using the website information included in the user's message. If the website does not state an answer, say you do not have that information. Do not use outside knowledge, do not invent policies, prices, features, or promises. Be concise and helpful."
      : "You are SmartHub X, a careful AI research and comparison assistant. Be clear, balanced, and honest. Never invent current prices, product specifications, availability, ratings, citations, URLs, or sources. Do not claim you searched the live web. If reliable evidence is not present, explicitly state what must be verified. Do not create numeric scores unless comparable evidence is actually supplied; otherwise explain that a reliable score cannot be calculated. Provide a recommendation only with clear reasons and trade-offs. Reply in the user's language.";

    const fullMessage = safeMode === "followup"
      ? `Previous comparison context:\n${String(context || "No previous context supplied.")}\n\nFollow-up question:\n${message}`
      : safeMode === "faq"
        ? `Website information:\nSmartHub X is a task-focused decision platform intended to organize research, compare options, explain trade-offs, and help users make decisions. AI output may be inaccurate. Current prices and specifications require verification. Free AI access can have temporary usage limits. No payment is required to retry after a free limit is reached.\n\nUser question:\n${message}`
        : message;

    const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemText }] },
        contents: [{ role: "user", parts: [{ text: fullMessage }] }],
        generationConfig: { temperature: 0.35, maxOutputTokens: 1800 }
      })
    });

    let data = {};
    try { data = await response.json(); } catch (_) {}

    if (!response.ok) {
      const status = response.status;
      const googleMessage = data.error?.message || "Gemini request failed.";
      let code = "GEMINI_REQUEST_FAILED";
      if (status === 429) code = "FREE_LIMIT_REACHED";
      else if (status === 503 || status === 502) code = "AI_TEMPORARILY_UNAVAILABLE";
      else if (status === 401 || status === 403) code = "API_KEY_OR_ACCESS_ERROR";
      return res.status(status >= 400 && status < 600 ? status : 500).json({ code, error: googleMessage });
    }

    const reply = data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!reply) {
      return res.status(502).json({ code: "EMPTY_AI_RESPONSE", error: "The AI did not return an answer. Please try again." });
    }

    // No Google Search grounding is enabled here. Never fabricate citations.
    return res.status(200).json({ reply, sources: [], sourceStatus: "not_grounded" });
  } catch (error) {
    return res.status(500).json({ code: "AI_TEMPORARILY_UNAVAILABLE", error: "Something went wrong. Please try again." });
  }
};
