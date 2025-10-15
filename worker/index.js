/**
 * worker/index.js
 *
 * Minimal Cloudflare Worker that:
 * - accepts POST /api/chat with { sessionId, message }
 * - forwards conversation + memory to Workers AI via env.AI.run(...)
 * - uses a Durable Object (SessionMemory) to persist conversation history
 *
 * Bindings required:
 * - env.AI           -> Workers AI binding
 * - env.SESSION_DO   -> Durable Object namespace binding
 */

export class SessionMemory {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  // fetch used for simple interactions with the DO (persist / retrieve)
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/append") {
      const j = await request.json();
      // j = { role: 'user'|'assistant'|'system', content: '...' }
      let history = (await this.state.storage.get("history")) || [];
      history.push(j);
      await this.state.storage.put("history", history);
      return new Response(JSON.stringify({ ok: true }));
    }

    if (request.method === "GET" && url.pathname === "/history") {
      const history = (await this.state.storage.get("history")) || [];
      return new Response(JSON.stringify({ history }));
    }

    if (request.method === "POST" && url.pathname === "/clear") {
      await this.state.storage.put("history", []);
      return new Response(JSON.stringify({ ok: true }));
    }

    return new Response("Not found", { status: 404 });
  }
}

// Utility: obtain or create a Durable Object stub for a session id
function getSessionStub(env, sessionId) {
  // SESSION_DO is binding name in wrangler.toml
  const id = env.SESSION_DO.idFromName(sessionId);
  return env.SESSION_DO.get(id);
}

// Main fetch handler
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // health check
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("cf_ai_supportbot: Worker up");
    }

    // POST /api/chat -> { sessionId, message }
    if (request.method === "POST" && url.pathname === "/api/chat") {
      try {
        const body = await request.json();
        const { sessionId, message } = body;
        if (!sessionId || !message) {
          return new Response(JSON.stringify({ error: "Missing sessionId or message" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Acquire DO stub
        const session = getSessionStub(env, sessionId);

        // Append user message to history
        await session.fetch("https://session/append", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "user", content: message }),
        });

        // Retrieve history
        const historyResp = await session.fetch("https://session/history");
        const historyJson = await historyResp.json();
        const history = historyJson.history || [];

        // Build a system prompt + messages for LLM
        const systemPrompt = {
          role: "system",
          content:
            "You are Cloudflare SupportBot — an expert assistant for Cloudflare developers. Answer concisely, include step-by-step troubleshooting where helpful, provide commands and small code snippets when relevant, and ask follow-up diagnostic questions when needed. If the user asks to perform destructive or account-specific actions, refuse and suggest safe commands the user can run themselves.",
        };

        // Build messages for model (OpenAI-compatible chat style)
        const modelMessages = [systemPrompt, ...history.map(m => ({ role: m.role, content: m.content }))];

        // Call Workers AI binding. Replace the model id below with the model you configured.
        // Example uses env.AI.run(modelId, { prompt OR messages }, options)
        // Docs: use the AI binding configured in wrangler / dashboard.
        const modelId = env.AI_MODEL || "@cf/meta/llama-3-8b-instruct";

        // Use env.AI.run — this is a common pattern; adjust to your environment's API if needed.
        const aiResponse = await env.AI.run(
          modelId,
          {
            // For chat-capable models use 'messages' field; for older instruct models you might send a single prompt.
            messages: modelMessages,
            // Max tokens / other generation params (tune as needed)
            max_output_tokens: 512,
            temperature: 0.2,
          },
          {
            // optional ai gateway options
            gateway: env.AI_GATEWAY ? { id: env.AI_GATEWAY } : undefined,
          }
        );

        // aiResponse shape varies by binding; try to extract text safely.
        // Typical shape: { output: [{ content_type: 'output_text', content: '...'}], ... }
        // Or a `choices` array like OpenAI. We'll attempt multiple strategies.
        let assistantText = "";
        try {
          if (aiResponse && Array.isArray(aiResponse.output) && aiResponse.output.length) {
            // Workers AI: output array of objects with `content` or `text`
            assistantText = aiResponse.output.map(o => o.content || o.text || "").join("\n");
          } else if (aiResponse && aiResponse.choices && aiResponse.choices.length) {
            assistantText = aiResponse.choices.map(c => c.message?.content || c.text || "").join("\n");
          } else if (typeof aiResponse === "string") {
            assistantText = aiResponse;
          } else if (aiResponse?.content) {
            assistantText = aiResponse.content;
          } else {
            assistantText = JSON.stringify(aiResponse).slice(0, 1000);
          }
        } catch (err) {
          assistantText = "Sorry — error parsing model response.";
        }

        // Save assistant reply to history
        await session.fetch("https://session/append", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "assistant", content: assistantText }),
        });

        return new Response(
          JSON.stringify({
            reply: assistantText,
            meta: { modelId },
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response("Not found", { status: 404 });
  },
};
