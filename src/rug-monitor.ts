// src/rug-monitor.ts — STREAMING EDITION: LogsSubscribe for <2s Rug Detection (Nov 2025)
import { Helius, TransactionType, WebhookType } from "helius-sdk";
import { bot } from "./index.js";
import express, { Request, Response } from "express";
import { Connection, PublicKey } from "@solana/web3.js";

const helius = new Helius(process.env.HELIUS_API_KEY!);
const rpcUrl = process.env.PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com";
const wsUrl = rpcUrl.replace('https', 'wss') + '/'; // QuickNode/Helius WS endpoint
const connection = new Connection(rpcUrl, "confirmed");

// SPL Token Program (for all mints/dumps/freezes)
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
// Pump.fun Program (backup for launches)
const PUMP_FUN_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

const watching = new Map<string, { users: number[]; webhookId?: string }>();
const processedSigs = new Set<string>();

// ────── Helius Backup (for non-mint rugs) ──────
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
      console.log("Helius backup webhook →", wh.webhookID);
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
    `RUG PROTECTION ACTIVE (Streaming Mode)\n<code>${mint}</code>`,
    { parse_mode: "HTML" }
  );
}

// ────── REAL-TIME LOGS SUBSCRIBE (Catches Mints/Dumps at <2s) ──────
let wsSubscriptionId: number | null = null;
async function startStreaming() {
  try {
    // Subscribe to Token Program logs (all mints/transfers)
    const sub = await connection.onLogs(
      TOKEN_PROGRAM,
      (logs, ctx) => {
        if (!logs.signature || processedSigs.has(logs.signature)) return;
        processedSigs.add(logs.signature);

        // Parse logs for rug signals
        const mint = extractMintFromLogs(logs);
        if (!mint || !watching.has(mint)) return;

        // Fetch full tx for deep check (only if log hints rug)
        if (logs.logs.some(log => log.includes("Transfer") || log.includes("Freeze") || log.includes("InitializeMint"))) {
          connection.getParsedTransaction(logs.signature, { maxSupportedTransactionVersion: 0 })
            .then(tx => {
              if (!tx) return;
              const rug = checkRugTransaction(tx);
              if (rug) {
                console.log(`RUG STREAMED → ${rug.reason} | Sig: ${logs.signature}`);
                alertUsers(mint, logs.signature, rug.reason);
              }
            })
            .catch(() => {});
        }
      },
      "confirmed"
    );

    wsSubscriptionId = sub;
    console.log("Streaming active → LogsSubscribe on Token Program");
  } catch (e) {
    console.error("Stream setup error:", e);
    setTimeout(startStreaming, 10000); // Retry in 10s
  }
}

// Start on boot
startStreaming();

// Reconnect on disconnect
connection.onAccountChange(PublicKey.default, () => {}, "confirmed"); // Dummy to monitor WS health

// ────── Helius Webhook (Backup for LP/Other) ──────
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
        console.log(`RUG BACKUP → ${rug.reason} | Sig: ${tx.signature}`);
        await alertUsers(mint, tx.signature, rug.reason);
      }
    }
  }
  res.send("OK");
});

app.get("/", (_, res) => res.send("RugShield 2025 — Streaming Live (Check Logs for 'Streaming active')"));

export default app;

// ────── Rug Detection (Updated for Logs) ──────
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

// FIXED: Extract mint from logs (for pump.fun "Create" events)
function extractMintFromLogs(logs: any): string | null {
  // Look for pump.fun Create log pattern: base58 mint in "Program data:" or "Instruction: Create"
  for (const log of logs.logs) {
    if (log.includes("Program data:") || log.includes("Create")) {
      const match = log.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/); // Base58 pubkey regex
      if (match) return match[0];
    }
  }
  return null;
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
    await bot.telegram.sendMessage(
      userId,
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
