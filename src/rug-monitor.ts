// src/rug-monitor.ts — FINAL PRODUCTION VERSION (Dec 2025)
// Fixed TS error + maximum rug-catching power

import { Helius, TransactionType, WebhookType } from "helius-sdk";
import { bot } from "./index.js";
import express from "express";
import { Connection } from "@solana/web3.js";

// ────── Init ──────
const helius = new Helius(process.env.HELIUS_API_KEY!);
const connection = new Connection(helius.endpoint);
const watching = new Map<string, number[]>();

const WEBHOOK_URL = (() => {
  const base = process.env.RAILWAY_STATIC_URL || process.env.RENDER_EXTERNAL_URL || `https://${process.env.RAILWAY_APP_NAME}.up.railway.app`;
  const clean = base.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${clean}/webhook`;
})();
console.log("WEBHOOK URL →", WEBHOOK_URL);

// ────── Watch Token ──────
export async function watchToken(mint: string, userId: number) {
  console.log(`\n[WATCH] User ${userId} → ${mint}`);

  if (!watching.has(mint)) watching.set(mint, []);
  if (watching.get(mint)!.includes(userId)) {
    return await bot.telegram.sendMessage(userId, "You're already protecting this token.");
  }
  watching.get(mint)!.push(userId);

  if (watching.get(mint)!.length === 1) {
    try {
      const webhook = await helius.createWebhook({
        webhookURL: WEBHOOK_URL,
        transactionTypes: [TransactionType.ANY],
        accountAddresses: [mint],
        webhookType: WebhookType.ENHANCED,
      });
      console.log("WEBHOOK CREATED → ID:", webhook.webhookID);
    } catch (e: any) {
      if (!e.message.includes("already exists")) console.error("WEBHOOK ERROR →", e.message);
    }
  }

  await bot.telegram.sendMessage(
    userId,
    `PROTECTION ACTIVE\n\n<code>${mint}</code>`,
    { parse_mode: "HTML" }
  );
}

// ────── Express App ──────
const app = express();
app.use(express.json({ limit: "10mb" }));

app.post("/webhook", async (req, res) => {
  const txs: any[] = req.body || [];
  console.log(`WEBHOOK HIT → ${txs.length} tx(s)`);

  for (const tx of txs) {
    const sig = tx.signature;
    if (!sig) continue;

    let isRug = false;
    let reason = "";

    const mints = new Set<string>();
    tx.tokenTransfers?.forEach((t: any) => t.mint && mints.add(t.mint));
    tx.accountData?.forEach((a: any) => a.mint && mints.add(a.mint));
    if (mints.size === 0) {
      tx.accountKeys?.forEach((k: string) => k.length === 44 && mints.add(k));
    }
    if (mints.size === 0) continue;

    // 1. Massive dump
    if (tx.tokenTransfers?.some((t: any) => Number(t.tokenAmount || 0) > 40_000_000)) {
      isRug = true;
      reason = "MASSIVE DUMP (>40M)";
    }

    const totalSoldByDev = tx.tokenTransfers
      ?.filter((t: any) => 
        t.from && 
        t.from.length === 44 && 
        !t.from.includes("pump") && 
        !t.from.includes("raydium")
      )
      ?.reduce((sum: number, t: any) => sum + Number(t.tokenAmount || 0), 0) || 0;

    if (totalSoldByDev > 90_000_000) {
      isRug = true;
      reason = reason || `DEV DUMP ${(totalSoldByDev/1_000_000).toFixed(0)}M`;
    }

    // 2. LP drain
    if (tx.nativeTransfers?.some((t: any) => t.amount < -1_500_000_000)) {
      isRug = true;
      reason = reason || "LP DRAIN (>1.5 SOL)";
    }

    // 3. Authority revoked (most reliable)
    const authRevoked = tx.accountData?.some((acc: any) => {
      const isOurMint = mints.has(acc.mint || acc.account);
      if (!isOurMint) return false;
      return (
        acc.mintAuthority === null ||
        acc.freezeAuthority === null ||
        acc.freezeAuthority === "11111111111111111111111111111111"
      );
    });
    if (authRevoked) {
      isRug = true;
      reason = reason || "AUTHORITY REVOKED";
    }

    // 4. LP burn
    if (tx.tokenTransfers?.some((t: any) =>
      t.to === "Burn11111111111111111111111111111111111111111" &&
      Number(t.tokenAmount || 0) > 500_000_000
    )) {
      isRug = true;
      reason = reason || "LP BURNED";
    }

    // 5. Description fallback
    if (!isRug && /revoke|freeze|burn|authority|disable/i.test(tx.description || "")) {
      isRug = true;
      reason = reason || "SUSPICIOUS AUTHORITY CHANGE";
    }

    // ────── ALERT USERS ──────
    if (isRug) {
      console.log(`RUG → ${reason} | https://solscan.io/tx/${sig}`);

      for (const mint of mints) {
        const users = watching.get(mint) || [];
        for (const userId of users) {
          await bot.telegram.sendMessage(
            userId,
            `<b>RUG ALERT — SELL NOW!</b>\n\n` +
            `<b>Reason:</b> <code>${reason}</code>\n` +
            `<b>Token:</b> <code>${mint}</code>\n` +
            `<b>Tx:</b> https://solscan.io/tx/${sig}\n` +
            `<b>Chart:</b> https://dexscreener.com/solana/${mint}`,
            {
              parse_mode: "HTML",
              // Fixed option (Bot API 7.0+)
              link_preview_options: { is_disabled: true }
            }
          ).catch(() => {});
        }
        watching.delete(mint);
      }
    }
  }

  res.send("OK");
});

app.get("/", (_, res) => res.send("RugShield 2025 — Running & Catching"));

export default app;
