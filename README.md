
# Cloudflare AI Support Bot

An **AI-powered support assistant** built with the **Cloudflare Developer Platform**, combining **Workers AI**, **Durable Objects**, and a **serverless frontend** for real-time customer support.

This project showcases how to build a scalable AI chat experience entirely on Cloudflare — no external backend required.

---

## Features

- **Serverless Chat Backend:** Handles chat requests via a Cloudflare Worker.
- **Workers AI Integration:** Uses `@cf/meta/llama-3-8b-instruct` for intelligent, context-aware responses.
- **Persistent Chat History:** Implements a Durable Object (`SessionMemory`) to maintain conversation state across sessions.
- **Full-Stack Deployment:** The same Worker serves your API logic and static frontend assets using **Workers Sites**.
- **Local Development:** Run everything locally using `wrangler dev --site .` — no external servers needed.

---

## Prerequisites

Before getting started, ensure you have the following:

- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- **Workers AI** access enabled on your Cloudflare account
- [Node.js](https://nodejs.org/en/) v18 or higher
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install/) (installed globally or via `npx`)

---

## Setup and Local Development

### 1. Install Dependencies

Clone your project and install all required dependencies:

```bash
npm install
````

---

### 2. Verify `package.json` Scripts

Ensure your `package.json` includes the correct development and deployment scripts:

```json
"scripts": {
  "start": "npx wrangler dev --site .",
  "deploy": "npx wrangler deploy --site ."
}
```

These scripts ensure that Wrangler correctly serves static assets and deploys your Worker.

---

### 3. Run Local Development Server

Start the development environment:

```bash
npm run start
```

Wrangler will provide a local development URL, typically:

```
http://127.0.0.1:8787
```

Open that in your browser to interact with your Support Bot.
The `--site .` flag ensures your **frontend assets** and **Worker API** are both available locally.

---

## Deployment to Cloudflare

### 1. Authenticate Wrangler

If this is your first time deploying, log in to Cloudflare via Wrangler:

```bash
npx wrangler login
```

---

### 2. Deploy Your Application

Deploy to Cloudflare’s global network with one command:

```bash
npm run deploy
```

Wrangler will build and upload your Worker and static assets, then return your live URL, e.g.:

```
https://supportbot.<your-cloudflare-username>.workers.dev
```

---

## Project Structure

| File/Folder         | Description                                                                |
| :------------------ | :------------------------------------------------------------------------- |
| `worker/index.js`   | Core **Worker** logic — AI chat handling + Durable Object state management |
| `index.html`        | Main **HTML frontend** for the chat interface                              |
| `app.js`            | **Frontend logic** for chat input and message rendering                    |
| `styles.css`        | Basic **CSS styling** for the chat UI                                      |
| `wrangler.toml`     | **Cloudflare config** — Workers AI, Durable Object, and D1 bindings        |
| `package.json`      | Node dependencies and build/deploy scripts                                 |


---

## Architecture Overview

The Support Bot runs entirely on Cloudflare:

```
┌───────────────────────┐
│     Chat Frontend     │
│ (HTML / JS / CSS via  │
│   Workers Sites)       │
└─────────┬─────────────┘
          │
          ▼
┌───────────────────────┐
│   Cloudflare Worker   │
│  - Handles chat input │
│  - Calls Workers AI   │
│  - Manages CORS/API   │
└─────────┬─────────────┘
          │
          ▼
┌───────────────────────┐
│ Durable Object (DO)   │
│  - SessionMemory DO   │
│  - Persists history   │
└───────────────────────┘
```

## License

This project is licensed under the **MIT License**.
Feel free to fork and extend it for your own use.

---

### Example Deployment URL

```
https://supportbot.goginenim18069.workers.dev
```

---

**Author:** [Manaswini Gogineni](https://www.linkedin.com/in/manaswini-gogineni/)
Built for the **Cloudflare AI Application Assignment**

### Local Working Video
[Watch the Demo](./CF_running_app.mp4)

Or use the embedded player:

<video width="720" controls>
  <source src="./CF_running_app.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>