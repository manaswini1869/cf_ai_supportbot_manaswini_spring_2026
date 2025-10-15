const API_BASE = "http://localhost:8787";
const chatEl = document.getElementById("chat");
const form = document.getElementById("form");
const input = document.getElementById("input");

let sessionId = localStorage.getItem("cf_ai_session");
if (!sessionId) {
  sessionId = "sess_" + cryptoRandomId();
  localStorage.setItem("cf_ai_session", sessionId);
}

function showMessage(role, text) {
  const div = document.createElement("div");
  div.className = "message " + (role === "user" ? "user" : role === "assistant" ? "assistant" : "system");
  div.innerHTML = `<div><strong>${role}</strong></div><div>${escapeHtml(text).replace(/\n/g, "<br/>")}</div>`;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  showMessage("user", text);
  showMessage("system", "Thinking...");
  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message: text }),
    });
    const j = await res.json();
    // remove last system "Thinking..." message
    const systemMsgs = Array.from(chatEl.querySelectorAll(".system"));
    if (systemMsgs.length) systemMsgs[systemMsgs.length-1].remove();
    if (j.error) {
      showMessage("assistant", `Error: ${j.error}`);
    } else {
      showMessage("assistant", j.reply || "(no reply)");
    }
  } catch (err) {
    showMessage("assistant", `Network error: ${err.message}`);
  }
});

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
}
function cryptoRandomId() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
}
