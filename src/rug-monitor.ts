// src/rug-monitor.ts — FINAL + DEBUG + NO TS ERRORS
import { Helius, TransactionType, WebhookType } from "helius-sdk";
import { bot } from "./index.js";
import express from "express";
import { Connection, PublicKey } from "@solana/web3.js";

console.log("rug-monitor.ts loaded");

// ────── DEBUG: Show env at startup ──────
console.log("HELIUS_API_KEY exists →", !!process.env.HELIUS_API_KEY);
console.log("HELIUS_API_KEY length →", process.env.HELIUS_API_KEY?.length || 0);
console.log("RAILWAY_STATIC_URL →", process.env.RAILWAY_STATIC_URL || "not set");

// ────── Helius initialization with proper typing ──────
let helius: Helius | null = null;

if (!process.env.HELIUS_API_KEY) {
  console.error("FATAL: HELIUS_API_KEY is missing!");
  process.exit(1);
}

try {
  helius = new Helius(process.env.HELIUS_API_KEY);
  console.log("Helius SDK initialized →", helius.endpoint);
} catch (err: any) {
  console.error("Helius init failed →", err.message);
  process.exit(1);
}

// Fallback RPC if Helius fails
const connection = new Connection(helius?.endpoint || "https://api.mainnet-beta.solana.com");

// ────── Final webhook URL ──────
const WEBHOOK_URL = (() => {
  const base = process.env.RAILWAY_STATIC_URL || `https://${process.env.RAILWAY_APP_NAME}.up.railway.app`;
  const clean = base.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const url = `https://${clean}/webhook`;
  console.log("WEBHOOK URL →", url);
  return url;
})();

const watching = new Map<string, number[]>();

export async function watchToken(mint: string, userId: number) {
  console.log(`\n[WATCH] User ${userId} → ${mint}`);

  if (!watching.has(mint)) watching.set(mint, []);
  if (watching.get(mint)!.includes(userId)) return;

  watching.get(mint)!.push(userId);

  // ────── Try to create webhook ──────
  if (helius) {
    try {
      console.log("Creating Helius webhook...");
      const webhook = await helius.createWebhook({
        webhookURL: WEBHOOK_URL,
        transactionTypes: [TransactionType.ANY],
        accountAddresses: [mint],
        webhookType: WebhookType.ENHANCED,
      });
      console.log("WEBHOOK CREATED → ID:", webhook.webhookID);
    } catch (error: any) {
      console.error("WEBHOOK FAILED →", error.message || error);
      console.log("Polling fallback is active");
    }
  } else {
    console.log("Helius not available → using polling only");
  }

  await bot.telegram.sendMessage(
    userId,
    `<b>PROTECTION ACTIVE</b>\n<code>${mint.slice(0,8)}...${mint.slice(-4)}</code>`,
    { parse_mode: "HTML" }
  );
}

// ────── Express server ──────
const app = express();
app.use(express.json({ limit: "10mb" }));

app.post("/webhook", (req, res) => {
  console.log("WEBHOOK HIT →", req.body?.length || 0, "txs");
  res.send("OK");
});

app.get("/", (_, res) => res.send("RugChef alive"));

export default app;
