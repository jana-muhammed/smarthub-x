module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Please send a POST request."
    });
  }

  try {
    const message = req.body?.message;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Please enter a message."
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "API key is missing."
      });
    }

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          instructions:
            "You are SmartHub X, a helpful AI assistant. Answer clearly and honestly. Never invent prices, sources, or facts.",
          input: message
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "OpenAI request failed."
      });
    }

    return res.status(200).json({
      reply: data.output_text
    });

  } catch (error) {
    return res.status(500).json({
      error: "Something went wrong. Please try again."
    });
  }
};
