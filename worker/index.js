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

// Utility: sets required CORS headers for the frontend to access the API
function setCorsHeaders(response) {
  // Allow all origins for development and deployment flexibility
  response.headers.set("Access-Control-Allow-Origin", "*");
  // Allow credentials (like cookies or session IDs)
  response.headers.set("Access-Control-Allow-Credentials", "true");
  // Allow the content types your app uses
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  // Allow the methods your app uses
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  // Set max age for preflight response cache
  response.headers.set("Access-Control-Max-Age", "86400");
  return response;
}

// Durable Object class remains unchanged
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

    // Ensure the DO itself also sets CORS headers if ever accessed directly (good practice)
    return setCorsHeaders(new Response("Not found", { status: 404 }));
  }
}

// Utility: obtain or create a Durable Object stub for a session id
function getSessionStub(env, sessionId) {
  const id = env.SESSION_DO.idFromName(sessionId);
  return env.SESSION_DO.get(id);
}

// Main fetch handler
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Handle CORS Preflight (OPTIONS request)
    if (request.method === "OPTIONS") {
        // Must return 204 or 200 with CORS headers
        return setCorsHeaders(new Response(null, { status: 204 }));
    }

    let response;

    // health check
    if (request.method === "GET" && url.pathname === "/") {
        response = new Response("cf_ai_supportbot: Worker up");
    }

    // POST /api/chat -> { sessionId, message }
    if (request.method === "POST" && url.pathname === "/api/chat") {
      try {
        const body = await request.json();
        const { sessionId, message } = body;
        if (!sessionId || !message) {
          response = new Response(JSON.stringify({ error: "Missing sessionId or message" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        } else {
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

          // Build messages for model
          const modelMessages = [systemPrompt, ...history.map(m => ({ role: m.role, content: m.content }))];

          // Call Workers AI binding
          const modelId = env.AI_MODEL || "@cf/meta/llama-3-8b-instruct";

          const aiResponse = await env.AI.run(
            modelId,
            { messages: modelMessages, max_output_tokens: 512, temperature: 0.2 },
            { gateway: env.AI_GATEWAY ? { id: env.AI_GATEWAY } : undefined }
          );

          // Extract assistant text
          let assistantText = "";
          try {
            if (aiResponse && Array.isArray(aiResponse.output) && aiResponse.output.length) {
              assistantText = aiResponse.output.map(o => o.content || o.text || "").join("\n");
            } else if (aiResponse && aiResponse.choices && aiResponse.choices.length) {
              assistantText = aiResponse.choices.map(c => c.message?.content || c.text || "").join("\n");
            } else if (typeof aiResponse === "string") {
              assistantText = aiResponse;
            } else if (aiResponse?.content) {
              assistantText = aiResponse.content;
            } else {
              assistantText = "Sorry — error parsing model response.";
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

          response = new Response(
            JSON.stringify({
              reply: assistantText,
              meta: { modelId },
            }),
            { headers: { "Content-Type": "application/json" } }
          );
        }
      } catch (err) {
        response = new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Default 404 response
    if (!response) {
        response = new Response("Not found", { status: 404 });
    }

    // 2. Add CORS headers to the final response (POST, GET, or 404)
    return setCorsHeaders(response);
  },
};