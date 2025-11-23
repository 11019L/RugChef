// src/rug-monitor.ts — THE ONE THAT ACTUALLY WORKS + LOGS EVERYTHING (NOV 2025)
import { Helius, TransactionType, WebhookType } from "helius-sdk";
import { bot } from "./index.js";
import express, { Request, Response } from "express";
import { Connection, PublicKey } from "@solana/web3.js";

process.env.UV_THREADPOOL_SIZE = "128";

const helius = new Helius(process.env.HELIUS_API_KEY!);
const connection = new Connection(helius.endpoint);
const watching = new Map<string, { users: number[]; createdAt: number; addresses: string[] }>();

console.log("RUG SHIELD STARTED — LOGGING ENABLED");
console.log("Helius endpoint:", helius.endpoint);

// ============== WATCH TOKEN ==============
export async function watchToken(tokenMint: string, userId: number) {
  console.log(`\n[WATCH REQUEST] User ${userId} wants to watch: ${tokenMint}`);

  if (!watching.has(tokenMint)) {
    watching.set(tokenMint, { users: [], createdAt: Date.now(), addresses: [] });
  }
  const entry = watching.get(tokenMint)!;

  if (entry.users.includes(userId)) {
    console.log(`→ Already watching for user ${userId}`);
    return;
  }
  entry.users.push(userId);
  console.log(`→ Now watching for ${entry.users.length} users`);

  const webhookUrl = `${process.env.RAILWAY_STATIC_URL}/rug-alert`;
  console.log(`→ Webhook URL: ${webhookUrl}`);

  // 1. Watch mint itself
  try {
    const webhook = await helius.createWebhook({
      webhookURL: webhookUrl,
      transactionTypes: [TransactionType.ANY],
      accountAddresses: [tokenMint],
      webhookType: WebhookType.ENHANCED,
    });
    console.log(`Webhook created for mint: ${tokenMint} → ID: ${webhook.id}`);
    entry.addresses.push(tokenMint);
  } catch (e: any) {
    console.error("Failed to create webhook for mint:", e.message);
  }

  // 2. DexScreener → LP + creator
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error("DexScreener down");
    const data: any = await res.json();

    const extra = new Set<string>();
    data.pairs?.forEach((p: any) => {
      if (p.pairAddress) extra.add(p.pairAddress);
      if (p.creatorAddress) extra.add(p.creatorAddress);
    });

    if (extra.size > 0) {
      console.log(`→ Found ${extra.size} extra addresses (LP/creator):`, Array.from(extra));
      try {
        const webhook = await helius.createWebhook({
          webhookURL: webhookUrl,
          transactionTypes: [TransactionType.ANY],
          accountAddresses: [tokenMint, ...Array.from(extra)],
          webhookType: WebhookType.ENHANCED,
        });
        console.log(`FULL PROTECTION webhook created → ID: ${webhook.id}`);
        entry.addresses.push(...Array.from(extra));
      } catch (e: any) {
        console.error("Failed to create full protection webhook:", e.message);
      }
    } else {
      console.log("→ No LP/creator found yet on DexScreener");
    }
  } catch (e) {
    console.log("→ DexScreener failed (normal for new tokens)");
  }

  await bot.telegram.sendMessage(
    userId,
    `*RUG SHIELD ACTIVE*\n` +
    `Token: \`${tokenMint.slice(0,8)}...${tokenMint.slice(-4)}\`\n` +
    `Watching ${entry.addresses.length} addresses\n` +
    `You will be alerted on any rug`,
    { parse_mode: "MarkdownV2" }
  );
}

// ============== WEBHOOK HANDLER ==============
const app = express();
app.use(express.json({ limit: "20mb" }));

app.post("/rug-alert", async (req: Request, res: Response) => {
  console.log(`\nWEBHOOK HIT — ${req.body?.length || 0} txs at ${new Date().toISOString()}`);

  const txs: any[] = req.body || [];
  if (txs.length === 0) {
    console.log("→ Empty payload");
    return res.send("OK");
  }

  for (const tx of txs) {
    const sig = tx.signature;
    if (!sig) continue;

    console.log(`\n→ Processing tx: ${sig}`);
    console.log(`   Type: ${tx.type} | Description: ${tx.description?.slice(0, 80)}`);
    console.log(`   Native transfers: ${tx.nativeTransfers?.length} | Token transfers: ${tx.tokenTransfers?.length}`);

    let isRug = false;
    let rugReason = "";

    // Big dump
    if (tx.tokenTransfers?.some((t: any) => Number(t.tokenAmount || t.amount || 0) > 40_000_000)) {
      isRug = true;
      rugReason = "MASSIVE DUMP";
    }

    // LP drain
    if (tx.nativeTransfers?.some((t: any) => Math.abs(t.amount) > 1.5_000_000_000)) {
      isRug = true;
      rugReason = rugReason || "LP DRAIN";
    }

    // Authority revoke / freeze
    const instructions = tx.transaction?.message?.instructions || [];
    for (const ix of instructions) {
      if (ix.programId?.includes?.("Token") || ix.programId === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") {
        if (ix.parsed?.type === "setAuthority") {
          const newAuth = ix.parsed.info.newAuthority;
          if (!newAuth || newAuth === "11111111111111111111111111111111") {
            isRug = true;
            rugReason = rugReason || "AUTHORITY REVOKED";
          }
        }
        if (ix.parsed?.type === "freezeAccount") {
          isRug = true;
          rugReason = rugReason || "FREEZE";
        }
      }
    }

    // Keywords in description
    const desc = (tx.description || "").toLowerCase();
    if (/revoke|freeze|burn|authority|disable/i.test(desc)) {
      isRug = true;
      rugReason = rugReason || "KEYWORD RUG";
    }

    if (!isRug) {
      console.log(`   Not a rug`);
      continue;
    }

    console.log(`   RUG DETECTED: ${rugReason}`);

    // Find affected mints
    const mints = new Set<string>();
    tx.tokenTransfers?.forEach((t: any) => t.mint && mints.add(t.mint));
    if (mints.size === 0) {
      tx.accountKeys?.forEach((k: string) => k.length === 44 && mints.add(k));
    }

    for (const mint of mints) {
      const entry = watching.get(mint);
      if (!entry || entry.users.length === 0) continue;

      console.log(`   ALERTING ${entry.users.length} users for mint ${mint.slice(0,8)}...`);

      const short = `${mint.slice(0,8)}...${mint.slice(-4)}`;
      for (const userId of entry.users) {
        await bot.telegram.sendMessage(
          userId,
          `*RUG ALERT — SELL NOW*\n\n` +
          `Token: \`${short}\`\n` +
          `Type: *${rugReason}*\n` +
          `Tx: https://solscan.io/tx/${sig}\n` +
          `Chart: https://dexscreener.com/solana/${mint}`,
          { parse_mode: "MarkdownV2" }
        ).catch(e => console.log(`Failed to send to ${userId}:`, e.message));
      }

      watching.delete(mint);
      console.log(`   Unwatched ${mint} after alert`);
    }
  }

  res.send("OK");
});

// ============== SLOW DRAIN POLLER ==============
setInterval(async () => {
  if (watching.size === 0) return;

  console.log(`\n[SLOW DRAIN CHECK] Watching ${watching.size} tokens`);
  for (const [mint, entry] of watching.entries()) {
    try {
      const resp = await connection.getTokenLargestAccounts(new PublicKey(mint));
      const largest = resp.value[0];
      const amount = Number(largest?.uiAmount || 0);

      if (amount < 300) {
        console.log(`SLOW RUG: ${mint.slice(0,8)}... has only ${amount} tokens left`);
        for (const userId of entry.users) {
          await bot.telegram.sendMessage(userId, `*SLOW RUG — LP DRAINED*\nToken nearly empty!`, { parse_mode: "MarkdownV2" });
        }
        watching.delete(mint);
      }
    } catch (e) {}
  }
}, 35_000);

export default app;
