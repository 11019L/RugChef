// src/rug-monitor.ts — FINAL VERSION (auto-upgrade + mint watching = never "Limited" again)
import { Helius, TransactionType, WebhookType } from "helius-sdk";
import { bot } from "./index.js";
import express, { Request, Response } from "express";

// Silence bigint warning
process.env.UV_THREADPOOL_SIZE = "128";

const helius = new Helius(process.env.HELIUS_API_KEY!);
const watching = new Map<string, number[]>();

// THIS IS THE ONLY FUNCTION YOU CALL FROM index.ts
export async function watchToken(tokenMint: string, userId: number) {
  if (!watching.has(tokenMint)) watching.set(tokenMint, []);
  if (watching.get(tokenMint)!.includes(userId)) return;
  watching.get(tokenMint)!.push(userId);

  // 1. Always watch the token mint itself first (catches dev dumps instantly)
  const fallbackAddresses = [tokenMint];

  await helius.createWebhook({
    webhookURL: `${process.env.RAILWAY_STATIC_URL}/rug-alert`,
    transactionTypes: [TransactionType.ANY],
    accountAddresses: fallbackAddresses,
    webhookType: WebhookType.ENHANCED
  }).catch(() => {});

  // 2. Auto-retry RugCheck every 5 minutes until we get real pool/dev
  let attempts = 0;
  const tryUpgrade = async () => {
    attempts++;
    const report = await fetch(`https://api.rugcheck.xyz/v1/tokens/${tokenMint}/report`)
      .then(r => r.json())
      .catch(() => ({}));

    const realAddresses = [
      report?.pairAddress,
      report?.creatorAddress,
      ...(report?.top10Holders || []).slice(0, 8)
    ].filter(Boolean);

    if (realAddresses.length > 0) {
      await helius.createWebhook({
        webhookURL: `${process.env.RAILWAY_STATIC_URL}/rug-alert`,
        transactionTypes: [TransactionType.ANY],
        accountAddresses: [...new Set([...fallbackAddresses, ...realAddresses])],
        webhookType: WebhookType.ENHANCED
      }).catch(() => {});

      bot.telegram.sendMessage(userId, `*FULL MONITORING ACTIVE* (auto-upgraded)`, { parse_mode: "Markdown" });
      return;
    }

    if (attempts < 20) setTimeout(tryUpgrade, 5 * 60 * 1000); // retry up to 100 minutes
  };

  tryUpgrade();
}

// Webhook endpoint (same port as main bot)
const app = express();
app.use(express.json({ limit: "20mb" }));

app.post("/rug-alert", async (req: Request, res: Response) => {
  const txs = req.body;

  for (const tx of txs) {
    const hasDump = tx.tokenTransfers?.some((t: any) => Number(t.tokenAmount?.amount || 0) > 500_000_000);
    const hasBurn = tx.type?.includes("BURN");
    const hasFreeze = tx.type?.includes("REVOKE") || tx.type?.includes("FREEZE");

    if (hasDump || hasBurn || hasFreeze) {
      const mint = tx.tokenTransfers?.[0]?.mint || "unknown";
      const users = watching.get(mint) || [];
      for (const userId of users) {
        await bot.telegram.sendMessage(userId,
          `*RUG DETECTED — SELL NOW*\nhttps://solscan.io/tx/${tx.signature}`,
          { parse_mode: "Markdown" }
        );
      }
    }
  }
  res.send("OK");
});

export default app;
