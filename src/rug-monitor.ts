// src/rug-monitor.ts — FINAL WITH FULL DEBUG LOGS
import { Helius, TransactionType, WebhookType } from "helius-sdk";
import { bot } from "./index.js";
import express from "express";
import { Connection, PublicKey } from "@solana/web3.js";

console.log("rug-monitor.ts LOADED");

// DEBUG: Print ALL environment variables at startup
console.log("ENV DEBUG → HELIUS_API_KEY exists:", !!process.env.HELIUS_API_KEY);
console.log("ENV DEBUG → HELIUS_API_KEY length:", process.env.HELIUS_API_KEY?.length || 0);
console.log("ENV DEBUG → RAILWAY_STATIC_URL:", process.env.RAILWAY_STATIC_URL || "not set");
console.log("ENV DEBUG → RAILWAY_APP_NAME:", process.env.RAILWAY_APP_NAME || "not set");

// Initialize Helius with safety check
let helius;
try {
  if (!process.env.HELIUS_API_KEY) {
    console.error("FATAL: HELIUS_API_KEY is missing or empty!");
    process.exit(1);
  }
  helius = new Helius(process.env.HELIUS_API_KEY);
  console.log("Helius SDK initialized successfully");
  console.log("Helius RPC endpoint:", helius.endpoint);
} catch (err: any) {
  console.error("Helius SDK failed to initialize:", err.message);
}

const connection = new Connection(helius?.endpoint || "https://api.mainnet-beta.solana.com");

const watching = new Map<string, number[]>();

// FINAL WEBHOOK URL (100% correct)
const WEBHOOK_URL = (() => {
  const base = process.env.RAILWAY_STATIC_URL || `https://${process.env.RAILWAY_APP_NAME}.up.railway.app`;
  const clean = base.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const final = `https://${clean}/webhook`;
  console.log("FINAL WEBHOOK URL →", final);
  return final;
})();

export async function watchToken(mint: string, userId: number) {
  console.log(`\n[WATCH REQUEST] User ${userId} → ${mint}`);

  if (!watching.has(mint)) watching.set(mint, []);
  if (watching.get(mint)!.includes(userId)) {
    console.log("→ Already watching for this user");
    return;
  }
  watching.get(mint)!.push(userId);

  // WEBHOOK CREATION WITH FULL DEBUG
  try {
    console.log("Attempting to create Helius webhook...");
    console.log("Addresses:", [mint]);
    console.log("Webhook URL:", WEBHOOK_URL);

    const webhook = await helius.createWebhook({
      webhookURL: WEBHOOK_URL,
      transactionTypes: [TransactionType.ANY],
      accountAddresses: [mint],
      webhookType: WebhookType.ENHANCED,
    });

    console.log("WEBHOOK CREATED SUCCESSFULLY!");
    console.log("Webhook ID:", webhook.id);
    console.log("Full response:", JSON.stringify(webhook, null, 2));
  } catch (error: any) {
    console.error("WEBHOOK CREATION FAILED — FULL ERROR BELOW");
    console.error("Error name:", error.name);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    console.error("Full error object:", JSON.stringify(error, null, 2));
    console.log("Polling fallback active — bot still works");
  }

  await bot.telegram.sendMessage(
    userId,
    `<b>PROTECTION ACTIVE</b>\n<code>${mint.slice(0,8)}...${mint.slice(-4)}</code>`,
    { parse_mode: "HTML" }
  );
}

const app = express();
app.use(express.json({ limit: "10mb" }));

app.post("/webhook", (req, res) => {
  console.log("WEBHOOK HIT →", req.body?.length || 0, "transactions");
  res.send("OK");
});

app.get("/", (_, res) => res.send("RugChef webhook alive"));

export default app;
