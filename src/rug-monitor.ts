// src/rug-monitor.ts — BULLETPROOF RUG DETECTION (NOV 2025)
import { Helius, TransactionType, WebhookType } from "helius-sdk";
import { bot } from "./index.js";
import express from "express";
import { Connection, PublicKey } from "@solana/web3.js";

const helius = new Helius(process.env.HELIUS_API_KEY!);
const connection = new Connection(helius.endpoint);

const watching = new Map<string, number[]>();

const WEBHOOK_URL = (() => {
  const base = process.env.RAILWAY_STATIC_URL || `https://${process.env.RAILWAY_APP_NAME}.up.railway.app`;
  const url = `https://${base.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/webhook`;
  console.log("WEBHOOK URL →", url);
  return url;
})();

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

// RUG DETECTION LOGIC (in webhook handler)
app.post("/webhook", (req, res) => {
  const txs = req.body || [];
  console.log("WEBHOOK HIT →", txs.length, "txs");

  for (const tx of txs) {
    const sig = tx.signature;
    if (!sig) continue;

    let isRug = false;
    let reason = "";

    // 1. Massive token dump (>40M tokens)
    if (tx.tokenTransfers?.some((t: any) => Number(t.tokenAmount || t.amount || 0) > 40_000_000)) {
      isRug = true;
      reason = "MASSIVE DUMP";
    }

    // 2. LP drain (>1.5 SOL out)
    if (tx.nativeTransfers?.some((t: any) => t.amount < -1_500_000_000)) {
      isRug = true;
      reason = reason || "LP DRAIN";
    }

    // 3. Revoke/freeze keywords in description
    if (/revoke|freeze|burn|authority|disable/i.test(tx.description || "")) {
      isRug = true;
      reason = reason || "AUTHORITY REVOKE";
    }

    // 4. Token program instructions (setAuthority to null)
    const instructions = tx.transaction?.message?.instructions || [];
    for (const ix of instructions) {
      if (ix.programId === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") {
        if (ix.parsed?.type === "setAuthority" && (!ix.parsed.info.newAuthority || ix.parsed.info.newAuthority === "11111111111111111111111111111111")) {
          isRug = true;
          reason = reason || "AUTHORITY REVOKED";
        }
        if (ix.parsed?.type === "freezeAccount") {
          isRug = true;
          reason = reason || "FREEZE";
        }
      }
    }

    if (isRug) {
      console.log(`RUG DETECTED: ${reason} | Tx: ${sig}`);

      // Find affected mint
      const mints = new Set<string>();
      tx.tokenTransfers?.forEach((t: any) => t.mint && mints.add(t.mint));
      if (mints.size === 0) tx.accountKeys?.forEach((k: string) => k.length === 44 && mints.add(k));

      for (const mint of mints) {
        const users = watching.get(mint) || [];
        for (const uid of users) {
          await bot.telegram.sendMessage(
            uid,
            `<b>RUG DETECTED — SELL NOW!</b>\n\n` +
            `<b>Type:</b> ${reason}\n` +
            `<b>Tx:</b> https://solscan.io/tx/${sig}\n` +
            `<b>Chart:</b> https://dexscreener.com/solana/${mint}`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }
        watching.delete(mint); // Stop monitoring after rug
      }
    }
  }

  res.send("OK");
});

const app = express();
app.use(express.json({ limit: "10mb" }));
app.post("/webhook", (req, res) => { /* above logic */ });
app.get("/", (_, res) => res.send("Alive"));

export default app;
