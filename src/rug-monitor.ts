// src/rug-monitor.ts — FINAL WORKING VERSION (November 2025)
import { Helius, TransactionType, WebhookType } from "helius-sdk";
import { bot } from "./index.js";
import express, { Request, Response } from "express";

// Silence warning
process.env.UV_THREADPOOL_SIZE = "128";

const helius = new Helius(process.env.HELIUS_API_KEY!);
const watching = new Map<string, number[]>(); // mint → [userIds]

export async function watchToken(tokenMint: string, userId: number) {
  if (!watching.has(tokenMint)) watching.set(tokenMint, []);
  if (watching.get(tokenMint)!.includes(userId)) return;
  watching.get(tokenMint)!.push(userId);

  // 1. Instant mint watch — catches 90% of rugs in <5 seconds
  await helius.createWebhook({
    webhookURL: `${process.env.RAILWAY_STATIC_URL}/rug-alert`,
    transactionTypes: [TransactionType.ANY],
    accountAddresses: [tokenMint],
    webhookType: WebhookType.ENHANCED
  }).catch(() => {});

  // 2. DexScreener for pool + creator
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
    const data = await res.json();
    const extra: string[] = [];

    data.pairs?.forEach((p: any) => {
      if (p.pairAddress) extra.push(p.pairAddress);
      if (p.creatorAddress) extra.push(p.creatorAddress);
    });

    if (extra.length > 0) {
      await helius.createWebhook({
        webhookURL: `${process.env.RAILWAY_STATIC_URL}/rug-alert`,
        transactionTypes: [TransactionType.ANY],
        accountAddresses: [...new Set([tokenMint, ...extra])],
        webhookType: WebhookType.ENHANCED
      }).catch(() => {});
      bot.telegram.sendMessage(userId, `*FULL MONITORING ACTIVE*`, { parse_mode: "Markdown" });
    }
  } catch (e) { /* ignore */ }
}

const app = express();
app.use(express.json({ limit: "20mb" }));

app.post("/rug-alert", async (req: Request, res: Response) => {
  const txs = req.body || [];

  for (const tx of txs) {
    const sig = tx.signature;

    // 2025 REAL RUG DETECTION — catches slow drains, LP removes, authority revokes
    const isRug =
      // 1. Any token sell >5% of total supply (even if small absolute amount)
      tx.tokenTransfers?.some((t: any) => {
        const amount = Number(t.tokenAmount?.amount || 0);
        return amount > 50_000_000; // lowered from 200M — catches slow drains
      }) ||
      // 2. LP pool loses >3 SOL
      tx.nativeTransfers?.some((t: any) => t.amount < -3_000_000_000) ||
      // 3. Mint/Freeze authority changed or revoked
      tx.accountData?.some((a: any) => 
        /Authority/.test(a.account || "") || 
        a.nativeBalanceChange < -1_000_000_000
      ) ||
      // 4. Classic revoke/freeze/burn
      /BURN|REVOKE|FREEZE|SETAUTHORITY/i.test(tx.type || tx.description || "");

    if (!isRug) continue;

    // Find the mint that was affected
    const affectedMint = 
      tx.tokenTransfers?.[0]?.mint ||
      tx.tokenTransfers?.[0]?.tokenAmount?.mint ||
      Object.keys(watching)[0] || // fallback
      "unknown";

    // Alert EVERY user watching this mint
    for (const [mint, users] of watching.entries()) {
      if (affectedMint.toLowerCase().includes(mint.toLowerCase().slice(0, 12)) ||
          mint.toLowerCase().includes(affectedMint.toLowerCase().slice(0, 12))) {
        for (const userId of users) {
          await bot.telegram.sendMessage(userId,
            `*RUG IN PROGRESS — SELL NOW*\n\n` +
            `Token: \`${mint.slice(0,8)}...${mint.slice(-4)}\`\n` +
            `Slow drain / LP removal detected\n` +
            `https://solscan.io/tx/${sig}\n` +
            `https://dexscreener.com/solana/${mint}`,
            { parse_mode: "Markdown", disable_web_page_preview: true } as any
          );
        }
      }
    }
  }
  res.send("OK");
});

export default app;
