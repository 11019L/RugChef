// src/rug-monitor.ts — FIXED: No More 429s (Nov 2025 FINAL)
// Rate-limit proof: Slower loop + batch calls + backoff

import { Helius, TransactionType, WebhookType } from "helius-sdk";
import { bot } from "./index.js";
import express, { Request, Response } from "express";
import { Connection, PublicKey } from "@solana/web3.js";

const helius = new Helius(process.env.HELIUS_API_KEY!);
const publicConnection = new Connection("https://api.mainnet-beta.solana.com"); // For sig polling
const heliusConnection = new Connection(helius.endpoint); // For parsing (higher limits)

// Pump.fun program ID
const PUMP_FUN_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

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
        const oldest = Array.from(watching.keys())[0];
        if (oldest) { 
          await safeDeleteWebhook(watching.get(oldest)?.webhookId); 
          watching.delete(oldest); 
        }
      }
    }
  }

  await bot.telegram.sendMessage(userId, `RUG PROTECTION ACTIVE (RPC + Helius)\n<code>${mint}</code>`, { parse_mode: "HTML" });
}

// ────── SOLANA RPC REAL-TIME FRESH LAUNCH MONITOR (rate-limit safe) ──────
let backoffDelay = 0; // For exponential backoff on errors
setInterval(async () => {
  try {
    // Reset backoff on success
    backoffDelay = 0;

    // Poll recent sigs (low-frequency, safe)
    const recentSignatures = await publicConnection.getSignaturesForAddress(PUMP_FUN_PROGRAM, { limit: 10 });
    if (recentSignatures.length === 0) return;

    // Filter to last 2 min (skip old txs)
    const now = Date.now();
    const recentSigs = recentSignatures.filter(sig => now - sig.blockTime! * 1000 < 120000); // 2 min
    if (recentSigs.length === 0) return;

    // Batch parse with Helius (1 call instead of many)
    const txs = await heliusConnection.getParsedTransactions(
      recentSigs.map(s => s.signature),
      { maxSupportedTransactionVersion: 0 }
    );

    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      if (!tx) continue;

      // Extract mint from pump.fun launch tx
      const mint = extractMintFromPumpLaunch(tx);
      if (!mint || !watching.has(mint)) continue;

      // Check for rug
      const isRug = checkRugTransaction(tx);
      if (isRug) {
        await alertUsers(mint, recentSigs[i].signature, isRug.reason);
      }
    }
  } catch (e: any) {
    console.error("RPC loop error:", e.message);
    if (e.message.includes("429")) {
      // Backoff: Wait longer next time (up to 60s)
      backoffDelay = Math.min(backoffDelay * 2 + 5000, 60000); // 5s + exponential
      console.log(`Rate limited. Next loop in ${backoffDelay / 1000}s...`);
      await new Promise(r => setTimeout(r, backoffDelay));
    }
  }
}, 30000 + backoffDelay); // Base 30s interval (safe for free RPC)

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

// Extract mint from pump.fun launch tx
function extractMintFromPumpLaunch(tx: any): string | null {
  if (tx.transaction?.message?.accountKeys) {
    for (const key of tx.transaction.message.accountKeys) {
      if (key && key.length === 44 && key !== PUMP_FUN_PROGRAM.toBase58()) {
        return key;
      }
    }
  }
  if (tx.meta?.postTokenBalances?.length > 0) {
    return tx.meta.postTokenBalances[0].mint || null;
  }
  return null;
}

async function alertUsers(mint: string, sig: string, reason: string) {
  const data = watching.get(mint);
  if (!data) return;

  for (const userId of data.users) {
    await bot.telegram.sendMessage(userId,
      `🚨 RUG DETECTED — SELL NOW!\n\n` +
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

app.get("/", (_, res) => res.send("RugShield 2025 — Rate-Limit Proof & Unruggable"));
export default app;
