// src/rug-monitor.ts — FINAL WORKING RUG DETECTION (NOV 2025)
import { Helius, TransactionType, WebhookType } from "helius-sdk";
import { bot } from "./index.js";
import express from "express";
import { Connection, PublicKey } from "@solana/web3.js";

// ────── Init ──────
const helius = new Helius(process.env.HELIUS_API_KEY!);
const connection = new Connection(helius.endpoint);

const watching = new Map<string, number[]>();

const WEBHOOK_URL = (() => {
  const base = process.env.RAILWAY_STATIC_URL || `https://${process.env.RAILWAY_APP_NAME}.up.railway.app`;
  const clean = base.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${clean}/webhook`;
})();

console.log("WEBHOOK URL →", WEBHOOK_URL);

// ────── Watch Token (creates webhook) ──────
export async function watchToken(mint: string, userId: number) {
  console.log(`\n[WATCH] User ${userId} → ${mint}`);

  if (!watching.has(mint)) watching.set(mint, []);
  if (watching.get(mint)!.includes(userId)) return;
  watching.get(mint)!.push(userId);

  try {
    const webhook = await helius.createWebhook({
      webhookURL: WEBHOOK_URL,
      transactionTypes: [TransactionType.ANY],
      accountAddresses: [mint],
      webhookType: WebhookType.ENHANCED,
    });
    console.log("WEBHOOK CREATED → ID:", webhook.webhookID);
  } catch (e: any) {
    console.error("WEBHOOK FAILED →", e.message);
  }

  await bot.telegram.sendMessage(
    userId,
    `<b>PROTECTION ACTIVE</b>\n<code>${mint.slice(0,8)}...${mint.slice(-4)}</code>`,
    { parse_mode: "HTML" }
  );
}

// ────── Express App (must be declared first) ──────
const app = express();
app.use(express.json({ limit: "10mb" }));

// ────── Real Rug Detection (in webhook) ──────
app.post("/webhook", async (req, res) => {
  const txs: any[] = req.body || [];
  console.log("WEBHOOK HIT →", txs.length, "tx(s)");

  for (const tx of txs) {
    const sig = tx.signature;
    if (!sig) continue;

    let isRug = false;
    let reason = "";

    // 1. Massive dump (>40M tokens)
    if (tx.tokenTransfers?.some((t: any) => Number(t.tokenAmount || 0) > 40_000_000)) {
      isRug = true;
      reason = "MASSIVE DUMP";
    }

    // 2. Big SOL drain from LP (>1.5 SOL out)
    if (tx.nativeTransfers?.some((t: any) => t.amount < -1_500_000_000)) {
      isRug = true;
      reason = reason || "LP DRAIN";
    }

    // 3. Revoke / freeze / burn authority
    if (/revoke|freeze|burn|authority|disable/i.test(tx.description || "")) {
      isRug = true;
      reason = reason || "AUTHORITY REVOKED";
    }

    if (isRug) {
      console.log(`RUG DETECTED → ${reason} | https://solscan.io/tx/${sig}`);

      // Find mint(s) in this tx
      const mints = new Set<string>();
      tx.tokenTransfers?.forEach((t: any) => t.mint && mints.add(t.mint));
      if (mints.size === 0) {
        tx.accountKeys?.forEach((k: string) => k.length === 44 && mints.add(k));
      }

      for (const mint of mints) {
        const users = watching.get(mint) || [];
        for (const uid of users) {
          await bot.telegram.sendMessage(
            uid,
            `<b>RUG ALERT — SELL NOW!</b>\n\n` +
            `<b>Type:</b> ${reason}\n` +
            `<b>Tx:</b> https://solscan.io/tx/${sig}\n` +
            `<b>Chart:</b> https://dexscreener.com/solana/${mint}`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }
        watching.delete(mint);
      }
    }
  }

  res.send("OK");
});

app.get("/", (_, res) => res.send("RugChef alive"));

export default app;
