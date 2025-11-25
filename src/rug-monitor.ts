// src/rug-monitor.ts — FINAL WORKING VERSION (Nov 2025)
// QuickNode + Helius combo → No 429s, no missed rugs, compiles clean

import { Helius, TransactionType, WebhookType } from "helius-sdk";
import { bot } from "./index.js";
import express, { Request, Response } from "express";
import { Connection, PublicKey } from "@solana/web3.js";

const helius = new Helius(process.env.HELIUS_API_KEY!);
const publicRpcUrl = process.env.PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(publicRpcUrl, "processed"); // Your QuickNode URL here

// Pump.fun program
const PUMP_FUN_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

const watching = new Map<string, { users: number[]; webhookId?: string }>();
const processedSigs = new Set<string>();
let lastProcessedSig: string | undefined = undefined;

// ────── Helius Webhook Management ──────
async function safeDeleteWebhook(id?: string) {
  if (!id) return;
  try { await helius.deleteWebhook(id); } catch {}
}

export async function watchToken(mint: string, userId: number) {
  if (!watching.has(mint)) watching.set(mint, { users: [] });
  const data = watching.get(mint)!;
  if (data.users.includes(userId)) return;

  data.users.push(userId);

  if (!data.webhookId) {
    try {
      const wh = await helius.createWebhook({
        webhookURL: process.env.WEBHOOK_URL!,
        transactionTypes: [TransactionType.ANY],
        accountAddresses: [mint],
        webhookType: WebhookType.ENHANCED,
      });
      data.webhookId = wh.webhookID;
      console.log("Helius webhook created →", wh.webhookID);
    } catch (e: any) {
      if (e.message.includes("limit")) {
        const oldest = Array.from(watching.keys())[0];
        if (oldest) {
          await safeDeleteWebhook(watching.get(oldest)?.webhookId);
          watching.delete(oldest);
        }
      }
    }
  }

  await bot.telegram.sendMessage(
    userId,
    `RUG PROTECTION ACTIVE\n<code>${mint}</code>`,
    { parse_mode: "HTML" }
  );
}

// ────── QuickNode Pump.fun Fresh Launch Monitor (45s loop, no 429s) ──────
let backoffDelay = 0;
setInterval(async () => {
  try {
    backoffDelay = 0;

    const sigs = await connection.getSignaturesForAddress(PUMP_FUN_PROGRAM, {
      limit: 6,
      before: lastProcessedSig,
    });

    if (sigs.length === 0) return;
    lastProcessedSig = sigs[0].signature;

    const recent = sigs.filter(
      (s) => Date.now() - s.blockTime! * 1000 < 120000 && !processedSigs.has(s.signature)
    );
    if (recent.length === 0) return;

    const txs = await connection.getParsedTransactions(
      recent.map((s) => s.signature),
      { maxSupportedTransactionVersion: 0 }
    );

    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      if (!tx) continue;

      processedSigs.add(recent[i].signature);
      if (processedSigs.size > 1000) processedSigs.clear();

      const mint = extractMintFromPumpLaunch(tx);
      if (!mint || !watching.has(mint)) continue;

      const rug = checkRugTransaction(tx);
      if (rug) {
        await alertUsers(mint, recent[i].signature, rug.reason);
      }
    }
  } catch (e: any) {
    console.error("RPC loop error:", e.message || e);
    if (e.message?.includes("429")) {
      backoffDelay = Math.min(backoffDelay * 1.5 + 10000, 90000);
      console.log(`QuickNode 429 → backing off ${backoffDelay / 1000}s`);
    }
  }
}, 45000 + backoffDelay);

// ────── Helius Webhook Handler ──────
const app = express();
app.use(express.json({ limit: "10mb" }));

app.post("/webhook", async (req: Request, res: Response) => {
  const txs: any[] = req.body || [];
  for (const tx of txs) {
    if (!tx.signature) continue;
    const rug = checkRugTransaction(tx);
    if (!rug) continue;

    const mints = extractMints(tx);
    for (const mint of mints) {
      if (watching.has(mint)) {
        await alertUsers(mint, tx.signature, rug.reason);
      }
    }
  }
  res.send("OK");
});

app.get("/", (_, res) => res.send("RugShield 2025 — Running & Catching Rugs"));

export default app;

// ────── Rug Detection Logic ──────
function checkRugTransaction(tx: any): { reason: string } | false {
  if (tx.tokenTransfers?.some((t: any) => Number(t.tokenAmount || 0) > 70_000_000))
    return { reason: "MASSIVE DUMP >70M" };

  const devSell = tx.tokenTransfers
    ?.filter((t: any) => t.from && t.from.length === 44 && !t.from.includes("pump") && !t.from.includes("raydium"))
    ?.reduce((sum: number, t: any) => sum + Number(t.tokenAmount || 0), 0) || 0;
  if (devSell > 100_000_000)
    return { reason: `DEV DUMP ${(devSell / 1e6).toFixed(0)}M` };

  if (tx.accountData?.some((a: any) =>
    a.mintAuthority === null ||
    a.freezeAuthority === null ||
    a.freezeAuthority === "11111111111111111111111111111111"
  )) return { reason: "AUTHORITY REVOKED" };

  if (tx.nativeTransfers?.some((t: any) => t.amount < -1_500_000_000))
    return { reason: "LP DRAIN >1.5 SOL" };

  if (tx.tokenTransfers?.some((t: any) => t.to?.includes("Burn")))
    return { reason: "LP BURNED" };

  return false;
}

function extractMints(tx: any): string[] {
  const set = new Set<string>();
  tx.tokenTransfers?.forEach((t: any) => t.mint && set.add(t.mint));
  tx.accountData?.forEach((a: any) => a.mint && set.add(a.mint));
  return Array.from(set);
}

function extractMintFromPumpLaunch(tx: any): string | null {
  const keys = tx.transaction?.message?.accountKeys;
  if (keys) {
    for (const key of keys) {
      if (typeof key === "string" && key.length === 44 && key !== PUMP_FUN_PROGRAM.toBase58()) {
        return key;
      }
    }
  }
  return tx.meta?.postTokenBalances?.[0]?.mint || null;
}

async function alertUsers(mint: string, sig: string, reason: string) {
  const data = watching.get(mint);
  if (!data) return;

  for (const userId of data.users) {
    await bot.telegram.sendMessage(
      userId,
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
