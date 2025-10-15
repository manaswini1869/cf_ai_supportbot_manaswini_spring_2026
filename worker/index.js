function setCorsHeaders(response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Max-Age", "86400");
  return response;
}

export class SessionMemory {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

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

    return setCorsHeaders(new Response("Not found", { status: 404 }));
  }
}

function getSessionStub(env, sessionId) {
  const id = env.SESSION_DO.idFromName(sessionId);
  return env.SESSION_DO.get(id);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return setCorsHeaders(new Response(null, { status: 204 }));
    }

    let response;

    if (request.method === "GET" && url.pathname === "/") {
      response = new Response("cf_ai_supportbot: Worker up");
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      try {
        const body = await request.json();
        const { sessionId, message } = body;
        if (!sessionId || !message) {
          response = new Response(
            JSON.stringify({ error: "Missing sessionId or message" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          );
        } else {
          const session = getSessionStub(env, sessionId);

          await session.fetch("https://session/append", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: "user", content: message }),
          });

          const historyResp = await session.fetch("https://session/history");
          const historyJson = await historyResp.json();
          const history = historyJson.history || [];

          const systemPrompt = {
            role: "system",
            content:
              "You are Cloudflare SupportBot — an expert assistant for Cloudflare developers. Answer concisely, include step-by-step troubleshooting where helpful, provide commands and small code snippets when relevant, and ask follow-up diagnostic questions when needed. If the user asks to perform destructive or account-specific actions, refuse and suggest safe commands the user can run themselves.",
          };

          const modelMessages = [
            systemPrompt,
            ...history.map((m) => ({ role: m.role, content: m.content })),
          ];

          const modelId = env.AI_MODEL || "@cf/meta/llama-3-8b-instruct";

          const aiResponse = await env.AI.run(
            modelId,
            {
              messages: modelMessages,
              max_output_tokens: 512,
              temperature: 0.2,
            },
            { gateway: env.AI_GATEWAY ? { id: env.AI_GATEWAY } : undefined }
          );

          // console.log("chatbot response", aiResponse);

          let assistantText = "";
          try {
            // === ADD THIS CHECK FIRST to handle the format you are seeing: { response: "..." } ===
            if (
              aiResponse?.response &&
              typeof aiResponse.response === "string"
            ) {
              assistantText = aiResponse.response;
            }
            // ===================================================================================
            else if (
              aiResponse &&
              Array.isArray(aiResponse.output) &&
              aiResponse.output.length
            ) {
              // Workers AI standard output
              assistantText = aiResponse.output
                .map((o) => o.content || o.text || "")
                .join("\n");
            } else if (
              aiResponse &&
              aiResponse.choices &&
              aiResponse.choices.length
            ) {
              // OpenAI-style choices
              assistantText = aiResponse.choices
                .map((c) => c.message?.content || c.text || "")
                .join("\n");
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
    if (!response) {
      response = new Response("Not found", { status: 404 });
    }

    return setCorsHeaders(response);
  },
};
