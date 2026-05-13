import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import Sentiment from "sentiment";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;
  const sentiment = new Sentiment();

  app.use(express.json());

  // API Routes
  app.post("/api/analyze-sentiment", (req, res) => {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    const result = sentiment.analyze(text);
    
    // Safety Intercept: Crisis detection
    const crisisKeywords = [
      "suicide", "kill myself", "harm myself", "end my life", "want to die", 
      "dont want to live", "don't want to live", "killing myself", "harming myself",
      "self harm", "self-harm", "overdose", "take my own life", "better off dead",
      "jump off", "hanging myself", "cut my wrists", "cutting my wrists"
    ];
    const isCrisis = crisisKeywords.some(keyword => text.toLowerCase().includes(keyword));

    res.json({
      score: result.score,
      comparative: result.comparative,
      tokens: result.tokens,
      isCrisis
    });
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
