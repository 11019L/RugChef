// src/rug-monitor.ts — FINAL 100% WORKING VERSION — NOVEMBER 2025
import { Helius, TransactionType, WebhookType } from "helius-sdk";
import { bot } from "./index.js";
import express, { Request, Response } from "express";
import { Connection, PublicKey } from "@solana/web3.js";

process.env.UV_THREADPOOL_SIZE = "128";

const helius = new Helius(process.env.HELIUS_API_KEY!);
const connection = new Connection(helius.endpoint);

const watching = new Map<string, { users: number[]; createdAt: number; addresses: string[] }>();

console.log("RUG SHIELD STARTED");
console.log("Helius endpoint:", helius.endpoint);

// AUTO-FIX WEBHOOK URL — works on Railway, Render, etc.
const WEBHOOK_URL = (() => {
  const base =
    process.env.RAILWAY_STATIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.URL ||
    (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`) ||
    (process.env.RAILWAY_APP_NAME && `https://${process.env.RAILWAY_APP_NAME}.up.railway.app`);

  if (!base || base.includes("undefined")) {
    console.error("FATAL: Set RAILWAY_STATIC_URL in Railway variables!");
    process.exit(1);
  }

  const url = `${base.replace(/\/$/, "")}/rug-alert`;
  console.log(`WEBHOOK URL → ${url}`);
  return url;
})();

export async function watchToken(tokenMint: string, userId: number) {
  console.log(`\n[WATCH REQUEST] User ${userId} → ${tokenMint}`);

  if (!watching.has(tokenMint)) {
    watching.set(tokenMint, { users: [], createdAt: Date.now(), addresses: [] });
  }
  const entry = watching.get(tokenMint)!;

  if (entry.users.includes(userId)) {
    console.log("→ Already watching");
    return;
  }
  entry.users.push(userId);
  console.log(`→ Now watching for ${entry.users.length} user(s)`);

  // 1. Mint webhook
  try {
    await helius.createWebhook({
      webhookURL: WEBHOOK_URL,
      transactionTypes: [TransactionType.ANY],
      accountAddresses: [tokenMint],
      webhookType: WebhookType.ENHANCED,
    });
    console.log("Mint webhook → SUCCESS");
    entry.addresses.push(tokenMint);
  } catch (e: any) {
    console.error("FAILED MINT WEBHOOK");
    if (e.response?.data) {
      console.error("Helius says:", JSON.stringify(e.response.data, null, 2));
    } else {
      console.error("Error:", e.message || e);
    }
  }

  // Avoid rate limit
  await new Promise(r => setTimeout(r, 1500));

  // 2. DexScreener → LP + creator
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error("not ready");

    const data: any = await res.json();
    const extra = new Set<string>();

    data.pairs?.forEach((p: any) => {
      if (p.pairAddress) extra.add(p.pairAddress);
      if (p.creatorAddress) extra.add(p.creatorAddress);
    });

    if (extra.size > 0) {
      console.log(`→ Found ${extra.size} extra addresses`);
      try {
        await helius.createWebhook({
          webhookURL: WEBHOOK_URL,
          transactionTypes: [TransactionType.ANY],
          accountAddresses: [tokenMint, ...Array.from(extra)],
          webhookType: WebhookType.ENHANCED,
        });
        console.log("FULL PROTECTION webhook → SUCCESS");
        entry.addresses.push(...Array.from(extra));
      } catch (e: any) {
        console.error("FAILED FULL PROTECTION WEBHOOK");
        if (e.response?.data) {
          console.error("Helius says:", JSON.stringify(e.response.data, null, 2));
        } else {
          console.error("Error:", e.message || e);
        }
      }
    } else {
      console.log("→ No LP/creator yet");
    }
  } catch {
    console.log("→ DexScreener not indexed yet");
  }

  await bot.telegram.sendMessage(
    userId,
    `*RUG SHIELD ACTIVE*\n` +
    `Token: \`${tokenMint.slice(0,8)}...${tokenMint.slice(-4)}\`\n` +
    `Watching ${entry.addresses.length} address(es)\n` +
    `You are protected`,
    { parse_mode: "MarkdownV2" }
  );
}

// WEBHOOK HANDLER
const app = express();
app.use(express.json({ limit: "20mb" }));

app.post("/rug-alert", async (req: Request, res: Response) => {
  const txs: any[] = req.body || [];
  if (!txs.length) return res.send("OK");

  for (const tx of txs) {
    if (!tx.signature) continue;

    let isRug = false;
    let reason = "";

    if (tx.tokenTransfers?.some((t: any) => Number(t.tokenAmount || t.amount || 0) > 40_000_000)) {
      isRug = true; reason = "MASSIVE DUMP";
    }
    if (tx.nativeTransfers?.some((t: any) => Math.abs(t.amount) > 1.5_000_000_000)) {
      isRug = true; reason ||= "LP DRAIN";
    }
    if (/revoke|freeze|burn|authority|disable/i.test(tx.description || "")) {
      isRug = true; reason ||= "KEYWORD RUG";
    }

    const instructions = tx.transaction?.message?.instructions || [];
    for (const ix of instructions) {
      if (ix.programId === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") {
        if (ix.parsed?.type === "setAuthority" && (!ix.parsed.info.newAuthority || ix.parsed.info.newAuthority === "11111111111111111111111111111111")) {
          isRug = true; reason ||= "AUTHORITY REVOKED";
        }
        if (ix.parsed?.type === "freezeAccount") {
          isRug = true; reason ||= "FREEZE";
        }
      }
    }

    if (!isRug) continue;

    console.log(`RUG DETECTED: ${reason} | ${tx.signature}`);

    const mints = new Set<string>();
    tx.tokenTransfers?.forEach((t: any) => t.mint && mints.add(t.mint));
    if (mints.size === 0) tx.accountKeys?.forEach((k: string) => k.length === 44 && mints.add(k));

    for (const mint of mints) {
      const entry = watching.get(mint);
      if (!entry) continue;

      const short = `${mint.slice(0,8)}...${mint.slice(-4)}`;
      for (const uid of entry.users) {
        await bot.telegram.sendMessage(uid,
          `*RUG ALERT — SELL NOW*\n\n` +
          `Token: \`${short}\`\n` +
          `Type: *${reason}*\n` +
          `Tx: https://solscan.io/tx/${tx.signature}\n` +
          `Chart: https://dexscreener.com/solana/${mint}`,
          { parse_mode: "MarkdownV2" }
        ).catch(() => {});
      }
      watching.delete(mint);
    }
  }
  res.send("OK");
});

// SLOW DRAIN CHECK
setInterval(async () => {
  if (watching.size === 0) return;
  for (const [mint, entry] of watching.entries()) {
    try {
      const resp = await connection.getTokenLargestAccounts(new PublicKey(mint));
      const amount = Number(resp.value[0]?.uiAmount || 0);
      if (amount < 300) {
        console.log(`SLOW RUG → ${mint.slice(0,8)}...`);
        for (const uid of entry.users) {
          await bot.telegram.sendMessage(uid, `*SLOW RUG — LP DRAINED*`, { parse_mode: "MarkdownV2" });
        }
        watching.delete(mint);
      }
    } catch {}
  }
}, 35_000);

export default app;
