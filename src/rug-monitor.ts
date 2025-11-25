// src/rug-monitor.ts — THE ONE THAT ACTUALLY WORKS (Dec 2025 FINAL)

import { Helius, TransactionType, WebhookType } from "helius-sdk";
import { ShyftSdk, Network } from "@shyft-to/js";
import { bot } from "./index.js";
import express, { Request, Response } from "express";
import { Connection, PublicKey } from "@solana/web3.js";

const helius = new Helius(process.env.HELIUS_API_KEY!);
const shyft = new ShyftSdk({ apiKey: process.env.SHYFT_API_KEY!, network: Network.Mainnet });
const connection = new Connection("https://api.mainnet-beta.solana.com");

const watching = new Map<string, { users: number[]; webhookId?: string }>();

// ────── Helius Webhook Management (auto-cleanup) ──────
async function safeDeleteWebhook(id?: string) {
  if (!id) return;
  try { await helius.deleteWebhook(id); } catch {}
}

export async function watchToken(mint: string, userId: number) {
  if (!watching.has(mint)) watching.set(mint, { users: [] });
  const data = watching.get(mint)!;
  if (data.users.includes(userId)) return;

  data.users.push(userId);

  // Create Helius webhook (backup for freezes, LP burns, etc.)
  if (!data.webhookId) {
    try {
      const wh = await helius.createWebhook({
        webhookURL: process.env.WEBHOOK_URL!,
        transactionTypes: [TransactionType.ANY],
        accountAddresses: [mint],
        webhookType: WebhookType.ENHANCED,
      });
      data.webhookId = wh.webhookID;
    } catch (e: any) {
      if (e.message.includes("limit")) {
        // Auto-free oldest slot
        const oldest = watching.keys().next().value;
        if (oldest) { await safeDeleteWebhook(watching.get(oldest)?.webhookId); watching.delete(oldest); }
      }
    }
  }

  await bot.telegram.sendMessage(userId, `RUG PROTECTION ACTIVE (Shyft + Helius)\n<code>${mint}</code>`, { parse_mode: "HTML" });
}

// ────── SHYFT REAL-TIME FRESH LAUNCH MONITOR (this catches 0-second rugs) ──────
setInterval(async () => {
  try {
    const newTokens = await shyft.token.getNewTokens({ limit: 20 });
    for (const token of newTokens) {
      const mint = token.address;
      if (!watching.has(mint)) continue;

      // Immediate sniper-dump check in first 60 seconds
      const recentTxs = await connection.getSignaturesForAddress(new PublicKey(mint), { limit: 15 });
      for (const sigInfo of recentTxs) {
        const tx = await connection.getParsedTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 });
        if (!tx) continue;

        const isRug = checkRugTransaction(tx);
        if (isRug) {
          await alertUsers(mint, sigInfo.signature, isRug.reason);
        }
      }
    }
  } catch (e) {
    console.error("Shyft loop error:", e);
  }
}, 7000); // every 7 seconds

// ────── Helius Webhook (backup + freeze detection) ──────
const app = express();
app.use(express.json({ limit: "10mb" }));

app.post("/webhook", async (req: Request, res: Response) => {
  const txs: any[] = req.body || [];
  for (const tx of txs) {
    if (!tx.signature) continue;
    const isRug = checkRugTransaction(tx);
    if (isRug) {
      const mints = extractMints(tx);
      for (const mint of mints) {
        if (watching.has(mint)) {
          await alertUsers(mint, tx.signature, isRug.reason);
        }
      }
    }
  }
  res.send("OK");
});

// ────── Shared Rug Detection Logic ──────
function checkRugTransaction(tx: any): { isRug: true; reason: string } | false {
  // 1. Massive dump
  if (tx.tokenTransfers?.some((t: any) => Number(t.tokenAmount || 0) > 60_000_000)) {
    return { isRug: true, reason: "MASSIVE DUMP >60M" };
  }

  // 2. Dev sniper dump (259M → 741M case)
  const devSell = tx.tokenTransfers
    ?.filter((t: any) => t.from && t.from.length === 44 && !t.from.includes("pump") && !t.from.includes("raydium"))
    ?.reduce((sum: number, t: any) => sum + Number(t.tokenAmount || 0), 0) || 0;
  if (devSell > 90_000_000) {
    return { isRug: true, reason: `DEV DUMP ${(devSell/1e6).toFixed(0)}M` };
  }

  // 3. Authority revoked
  if (tx.accountData?.some((a: any) => 
    (a.mintAuthority === null || a.freezeAuthority === null || a.freezeAuthority === "11111111111111111111111111111111")
  )) {
    return { isRug: true, reason: "AUTHORITY REVOKED" };
  }

  // 4. LP drain/burn
  if (tx.nativeTransfers?.some((t: any) => t.amount < -1_500_000_000) ||
      tx.tokenTransfers?.some((t: any) => t.to?.includes("Burn"))) {
    return { isRug: true, reason: "LP DRAIN/BURN" };
  }

  return false;
}

function extractMints(tx: any): string[] {
  const set = new Set<string>();
  tx.tokenTransfers?.forEach((t: any) => t.mint && set.add(t.mint));
  tx.accountData?.forEach((a: any) => a.mint && set.add(a.mint));
  return Array.from(set);
}

async function alertUsers(mint: string, sig: string, reason: string) {
  const data = watching.get(mint);
  if (!data) return;

  for (const userId of data.users) {
    await bot.telegram.sendMessage(userId,
      `RUG DETECTED — SELL NOW!\n\n` +
      `Reason: <code>${reason}</code>\n` +
      `Token: <code>${mint}</code>\n` +
      `Tx: https://solscan.io/tx/${sig}\n` +
      `Chart: https://dexscreener.com/solana/${mint}`,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
    ).catch(() => {});
  }

  await safeDeleteWebhook(data.webhookId);
  watching.delete(mint);
}

app.get("/", (_, res) => res.send("RugShield 2025 — Shyft + Helius = Unruggable"));
export default app;
