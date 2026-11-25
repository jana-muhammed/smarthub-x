module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      code: "METHOD_NOT_ALLOWED",
      error: "Please send a POST request."
    });
  }

  const sendError = (status, code, message) =>
    res.status(status).json({ code, error: message });

  try {
    const { message, mode = "compare", context = "" } = req.body || {};

    if (!message || typeof message !== "string" || !message.trim()) {
      return sendError(400, "INVALID_MESSAGE", "Please enter a message.");
    }

    if (message.length > 12000 || String(context).length > 16000) {
      return sendError(
        413,
        "MESSAGE_TOO_LONG",
        "This request is too long. Please shorten it and try again."
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return sendError(
        500,
        "MISSING_API_KEY",
        "Gemini API key is missing from the server configuration."
      );
    }

    const safeMode = ["compare", "followup", "faq"].includes(mode)
      ? mode
      : "compare";

    const systemText = safeMode === "faq"
      ? "You are SmartHub X website support. Answer ONLY using the website information included in the user's message. If the website does not state an answer, say you do not have that information. Do not use outside knowledge, and do not invent policies, prices, features, or promises. Be concise and helpful. Reply in the user's language."
      : "You are SmartHub X, a careful AI research and comparison assistant. Give a useful, structured, balanced answer. Never invent current prices, product specifications, availability, ratings, citations, URLs, or sources. Do not claim you searched the live web. If reliable evidence is not present, clearly identify what needs verification. Do not create numeric scores unless comparable evidence is supplied. Give a recommendation only with clear reasons and trade-offs. Reply in the user's language.";

    const fullMessage = safeMode === "followup"
      ? `Previous comparison context:\n${String(context || "No previous context supplied.")}\n\nFollow-up question:\n${message}`
      : safeMode === "faq"
        ? `Website information:\nSmartHub X is a task-focused decision platform intended to organize research, compare options, explain trade-offs, and help users make decisions. AI output may be inaccurate. Current prices and specifications require verification. Free AI access can have temporary usage limits. No payment is required to retry after a free limit is reached.\n\nUser question:\n${message}`
        : message;

    // Keep the existing Gemini model.
    const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";

    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const payload = {
      systemInstruction: {
        parts: [{ text: systemText }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: fullMessage }]
        }
      ],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 1800
      }
    };

    let lastStatus = 502;
    let lastCode = "AI_TEMPORARILY_UNAVAILABLE";
    let lastMessage = "Gemini is temporarily unavailable. Please try again.";

    // Retry temporary server errors once.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        8000
      );

      let response;
      let data = {};

      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        try {
          data = await response.json();
        } catch (_) {
          data = {};
        }

      } catch (error) {
        clearTimeout(timeout);

        lastStatus = 504;
        lastCode = "AI_TIMEOUT";

        lastMessage = error && error.name === "AbortError"
          ? "Gemini took too long to respond. Please try again."
          : "SmartHub X could not connect to Gemini. Please check the connection and try again.";

        if (attempt === 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }

        return sendError(lastStatus, lastCode, lastMessage);

      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const status = response.status;
        const googleMessage =
          data.error?.message || "Gemini request failed.";

        if (status === 429) {
          return sendError(
            429,
            "FREE_LIMIT_REACHED",
            "The available free Gemini usage limit has been reached for now. Please try again later. No payment is required."
          );
        }

        if (status === 401 || status === 403) {
          return sendError(
            status,
            "API_KEY_OR_ACCESS_ERROR",
            "Gemini rejected the API key or the key does not have access to this model. Check the server key and model access."
          );
        }

        if ([500, 502, 503, 504].includes(status)) {
          lastStatus = status;
          lastCode = "AI_TEMPORARILY_UNAVAILABLE";

          lastMessage =
            "Gemini is temporarily busy. SmartHub X will try again; please retry in a moment if it continues.";

          if (attempt === 0) {
            await new Promise(resolve => setTimeout(resolve, 700));
            continue;
          }

          return sendError(lastStatus, lastCode, lastMessage);
        }

        console.error("Gemini API error:", status, googleMessage);

        return sendError(
          502,
          "GEMINI_REQUEST_FAILED",
          "Gemini could not complete this request. Please try again."
        );
      }

      const reply = data.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

      if (!reply) {
        const blockReason = data.promptFeedback?.blockReason;

        console.error(
          "Gemini returned no text. Block reason:",
          blockReason || "none"
        );

        return sendError(
          502,
          "EMPTY_AI_RESPONSE",
          "Gemini did not return a text answer. Please try a different question."
        );
      }

      // Search grounding is intentionally not enabled.
      return res.status(200).json({
        reply,
        sources: [],
        sourceStatus: "not_grounded",
        model
      });
    }

    return sendError(lastStatus, lastCode, lastMessage);

  } catch (error) {
    console.error("SmartHub X API error:", error);

    return sendError(
      500,
      "AI_SERVER_ERROR",
      "SmartHub X could not complete the request. Please try again."
    );
  }
};
