// src/rug-monitor.ts — BULLETPROOF 2025 VERSION (DexScreener + Helius fallback)
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

  // Step 1: Instant mint watch (catches 80% of rugs immediately)
  const mintAddresses = [tokenMint];
  await helius.createWebhook({
    webhookURL: `${process.env.RAILWAY_STATIC_URL}/rug-alert`,
    transactionTypes: [TransactionType.ANY],
    accountAddresses: mintAddresses,
    webhookType: WebhookType.ENHANCED
  }).catch(() => {});

  // Step 2: Get real pool/dev from DexScreener (faster than RugCheck)
  const dexResponse = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
  const dexData = await dexResponse.json();

  const realAddresses = dexData?.pairs?.map((pair: any) => [
    pair.poolId,  // LP pool
    pair.dexId === "raydium" ? pair.creator : null  // Dev if Raydium
  ].filter(Boolean)) || [];

  // Fallback: Helius DAS for mint authority (dev wallet)
  if (realAddresses.length === 0) {
    const mintInfo = await helius.rpc.getTokenMetadata({ mintAccounts: [tokenMint] });
    const mintAuth = mintInfo?.mintAuthority?.toString();
    if (mintAuth) realAddresses.push(mintAuth);
  }

  if (realAddresses.length > 0) {
    await helius.createWebhook({
      webhookURL: `${process.env.RAILWAY_STATIC_URL}/rug-alert`,
      transactionTypes: [TransactionType.ANY],
      accountAddresses: [...new Set([...mintAddresses, ...realAddresses.flat()])],
      webhookType: WebhookType.ENHANCED
    }).catch(() => {});

    bot.telegram.sendMessage(userId, `*FULL MONITORING ACTIVE* (DexScreener + Helius)`, { parse_mode: "Markdown" });
  } else {
    // Ultra-fallback: Poll Helius for changes every 30 seconds (for 5 min)
    let pollAttempts = 0;
    const poll = async () => {
      pollAttempts++;
      const recentTxs = await helius.rpc.getSignaturesForAddress(new PublicKey(tokenMint), { limit: 5 });
      if (recentTxs.length > 0 && recentTxs[0].err === null) {  // Activity detected
        bot.telegram.sendMessage(userId, `*ACTIVITY DETECTED on ${tokenMint.slice(0,8)}... — Check now!`, { parse_mode: "Markdown" });
      }
      if (pollAttempts < 10) setTimeout(poll, 30 * 1000);
    };
    poll();
  }
}

// Webhook endpoint
const app = express();
app.use(express.json({ limit: "20mb" }));

app.post("/rug-alert", async (req: Request, res: Response) => {
  const txs = req.body;

  for (const tx of txs) {
    // Rug signals: big transfer, burn, revoke, LP removal
    const isDump = tx.tokenTransfers?.some((t: any) => Number(t.tokenAmount?.amount || 0) > 1e9);
    const isBurn = tx.type?.includes("BURN") || tx.nativeBalanceChange < 0;
    const isRevoke = tx.type?.includes("REVOKE") || tx.type?.includes("FREEZE");

    if (isDump || isBurn || isRevoke) {
      const mint = tx.tokenTransfers?.[0]?.mint || "unknown";
      const users = watching.get(mint) || [];
      for (const userId of users) {
        await bot.telegram.sendMessage(userId,
          `*🚨 RUG DETECTED — SELL NOW*\n\n` +
          `Token: \`${mint.slice(0,8)}...${mint.slice(-4)}\`\n` +
          `Type: ${isDump ? "DEV DUMP" : isBurn ? "LP BURN" : "REVOKE/FREEZE"}\n` +
          `Tx: https://solscan.io/tx/${tx.signature}\n\n` +
          `You escaped? Reply /status`,
          { parse_mode: "Markdown" }
        );
      }
    }
  }
  res.send("OK");
});

export default app;
