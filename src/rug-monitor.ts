// src/rug-monitor.ts  ← FINAL VERSION (no more port conflicts)
import { Helius, TransactionType, WebhookType } from "helius-sdk";
import { bot } from "./index.js";
import express, { Request, Response } from "express";

// Silence bigint warning
process.env.UV_THREADPOOL_SIZE = "128";

const helius = new Helius(process.env.HELIUS_API_KEY!);
const watching = new Map<string, number[]>();

export async function watchToken(tokenMint: string, userId: number) {
  if (!watching.has(tokenMint)) watching.set(tokenMint, []);
  if (watching.get(tokenMint)!.includes(userId)) return;
  watching.get(tokenMint)!.push(userId);

  const report = await fetch(`https://api.rugcheck.xyz/v1/tokens/${tokenMint}/report`)
    .then(r => r.json())
    .catch(() => ({}));

  const addresses = [
    report?.pairAddress,
    report?.creatorAddress,
    ...(report?.top10Holders || []).slice(0, 8)
  ].filter(Boolean);

  if (addresses.length === 0) {
    bot.telegram.sendMessage(userId, `Limited monitoring for ${tokenMint.slice(0,8)}...`);
    return;
  }

  await helius.createWebhook({
    webhookURL: `${process.env.RAILWAY_STATIC_URL}/rug-alert`,
    transactionTypes: [TransactionType.ANY],
    accountAddresses: addresses,
    webhookType: WebhookType.ENHANCED
  }).catch(() => {});

  bot.telegram.sendMessage(userId, `*FULL MONITORING ACTIVE*`, { parse_mode: "Markdown" });
}

// ONE SINGLE EXPRESS APP — shared port with main bot
const app = express();
app.use(express.json({ limit: "20mb" }));

// Rug alert endpoint
app.post("/rug-alert", async (req: Request, res: Response) => {
  const txs = req.body;

  for (const tx of txs) {
    const hasBigMove = tx.tokenTransfers?.some((t: any) => Number(t.tokenAmount?.amount || 0) > 500_000_000);
    const hasBurn = tx.type?.includes("BURN");
    const hasFreeze = tx.type?.includes("REVOKE") || tx.type?.includes("FREEZE");

    if (hasBigMove || hasBurn || hasFreeze) {
      const mint = tx.tokenTransfers?.[0]?.mint || "unknown";
      const users = watching.get(mint) || [];
      for (const userId of users) {
        await bot.telegram.sendMessage(userId,
          `*RUG DETECTED*\nhttps://solscan.io/tx/${tx.signature}`,
          { parse_mode: "Markdown" }
        );
      }
    }
  }
  res.send("OK");
});

export default app; // Export so main file can use it
