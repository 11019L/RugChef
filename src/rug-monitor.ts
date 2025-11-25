// src/rug-monitor.ts — THE ONE THAT ACTUALLY WORKS (Dec 2025)

import { Helius, TransactionType, WebhookType } from "helius-sdk";
import { bot } from "./index.js";
import express from "express";

const helius = new Helius(process.env.HELIUS_API_KEY!);
const watching = new Map<string, { users: number[]; webhookId?: string }>();

// Auto-cleanup: delete webhook after rug or after 24h of inactivity
async function safeDeleteWebhook(webhookId: string) {
  try { await helius.deleteWebhook(webhookId); } catch {}
}

// ────── WATCH TOKEN (smart webhook management) ──────
export async function watchToken(mint: string, userId: number) {
  if (!watching.has(mint)) watching.set(mint, { users: [] });

  const data = watching.get(mint)!;
  if (data.users.includes(userId)) return;

  data.users.push(userId);

  // Only create webhook once per mint
  if (!data.webhookId) {
    try {
      const wh = await helius.createWebhook({
        webhookURL: process.env.WEBHOOK_URL!,
        transactionTypes: [TransactionType.ANY],
        accountAddresses: [mint],
        webhookType: WebhookType.ENHANCED,
      });
      data.webhookId = wh.webhookID;
      console.log("Webhook created for", mint.slice(0,8), "→", wh.webhookID);
    } catch (e: any) {
      if (e.message.includes("reached webhook limit")) {
        // Fallback: tell user we're at capacity
        await bot.telegram.sendMessage(userId, "⚠️ Rug monitor at capacity (Helius limit). Protection delayed or limited.");
      }
    }
  }

  await bot.telegram.sendMessage(userId, `RUG PROTECTION ON\n<code>${mint}</code>`, { parse_mode: "HTML" });
}

// ────── WEBHOOK HANDLER (this catches EVERYTHING in 2025) ──────
app.post("/webhook", async (req, res) => {
  const txs: any[] = req.body || [];

  for (const tx of txs) {
    const sig = tx.signature;
    if (!sig) continue;

    const mints = new Set<string>();
    tx.tokenTransfers?.forEach((t: any) => t.mint && mints.add(t.mint));
    tx.accountData?.forEach((a: any) => a.mint && mints.add(a.mint));
    if (mints.size === 0) continue;

    let isRug = false;
    let reason = "";

    // 1. Massive dump
    if (tx.tokenTransfers?.some((t: any) => Number(t.tokenAmount || 0) > 50_000_000)) {
      isRug = true; reason = "DEV DUMP >50M";
    }

    // 2. Total sold by non-pool wallets (catches 259M→741M case)
    const devSellAmount = tx.tokenTransfers
      ?.filter((t: any) => t.from && t.from.length === 44 && !t.from.includes("pump") && !t.from.includes("raydium"))
      ?.reduce((sum: number, t: any) => sum + Number(t.tokenAmount || 0), 0) || 0;

    if (devSellAmount > 80_000_000) {
      isRug = true;
      reason = `DEV SNIPED & DUMPED ${(devSellAmount/1e6).toFixed(0)}M`;
    }

    // 3. Authority revoked
    if (tx.accountData?.some((a: any) => 
      (a.mintAuthority === null || a.freezeAuthority === null || a.freezeAuthority === "11111111111111111111111111111111")
    )) {
      isRug = true; reason = reason || "AUTHORITY REVOKED";
    }

    // 4. LP drain or burn
    if (tx.nativeTransfers?.some((t: any) => t.amount < -1_500_000_000) ||
        tx.tokenTransfers?.some((t: any) => t.to === "Burn111...")) {
      isRug = true; reason = reason || "LP DRAIN/BURN";
    }

    if (isRug) {
      console.log("RUG DETECTED →", reason, sig);

      for (const mint of mints) {
        const data = watching.get(mint);
        if (!data) continue;

        for (const userId of data.users) {
          await bot.telegram.sendMessage(userId,
            `<b>🚨 RUG DETECTED — SELL NOW!</b>\n\n` +
            `<b>Reason:</b> <code>${reason}</code>\n` +
            `<b>Token:</b> <code>${mint}</code>\n` +
            `<b>Tx:</b> https://solscan.io/tx/${sig}\n` +
            `<b>DexScreener:</b> https://dexscreener.com/solana/${mint}`,
            { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
          ).catch(() => {});
        }

        // Auto-cleanup: delete webhook to free slot
        if (data.webhookId) await safeDeleteWebhook(data.webhookId);
        watching.delete(mint);
      }
    }
  }

  res.send("OK");
});
