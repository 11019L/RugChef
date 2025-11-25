// src/rug-monitor.ts — ULTIMATE RUG DETECTOR NOV 2025
import { Helius, TransactionType, WebhookType } from "helius-sdk";
import { bot } from "./index.js";
import express from "express";
import { Connection } from "@solana/web3.js";

// ────── Init ──────
const helius = new Helius(process.env.HELIUS_API_KEY!);
const connection = new Connection(helius.endpoint);

const watching = new Map<string, number[]>(); // mint → [userId]

// Dynamic webhook URL for Railway / Render / etc.
const WEBHOOK_URL = (() => {
  const base = process.env.RAILWAY_STATIC_URL || process.env.RENDER_EXTERNAL_URL || `https://${process.env.RAILWAY_APP_NAME}.up.railway.app`;
  const clean = base.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${clean}/webhook`;
})();
console.log("WEBHOOK URL →", WEBHOOK_URL);

// ────── Watch Token (create webhook + track users) ──────
export async function watchToken(mint: string, userId: number) {
  console.log(`\n[WATCH] User ${userId} → ${mint}`);
  
  if (!watching.has(mint)) watching.set(mint, []);
  if (watching.get(mint)!.includes(userId)) {
    return await bot.telegram.sendMessage(userId, "You're already protecting this token.");
  }
  
  watching.get(mint)!.push(userId);

  // Create webhook only once per mint
  if (watching.get(mint)!.length === 1) {
    try {
      const webhook = await helius.createWebhook({
        webhookURL: WEBHOOK_URL,
        transactionTypes: [TransactionType.ANY],
        accountAddresses: [mint],
        webhookType: WebhookType.ENHANCED,
      });
      console.log("WEBHOOK CREATED → ID:", webhook.webhookID, "for", mint.slice(0,8) + "...");
    } catch (e: any) {
      if (!e.message.includes("already exists")) {
        console.error("WEBHOOK CREATION FAILED →", e.message);
      }
    }
  }

  await bot.telegram.sendMessage(
    userId,
    `PROTECTION ACTIVE\n\n<code>${mint}</code>`,
    { parse_mode: "HTML" }
  );
}

// ────── Express App ──────
const app = express();
app.use(express.json({ limit: "10mb" }));

// ────── RUG DETECTION ENGINE (Enhanced 2025) ──────
app.post("/webhook", async (req, res) => {
  const txs: any[] = req.body || [];
  console.log(`WEBHOOK HIT → ${txs.length} tx(s)`);

  for (const tx of txs) {
    const sig = tx.signature;
    if (!sig) continue;

    let isRug = false;
    let reason = "";

    // Extract all potential mints from this transaction
    const mints = new Set<string>();
    tx.tokenTransfers?.forEach((t: any) => t.mint && mints.add(t.mint));
    tx.accountData?.forEach((a: any) => a.mint && mints.add(a.mint));
    if (mints.size === 0) {
      tx.accountKeys?.forEach((k: string) => k.length === 44 && mints.add(k));
    }

    if (mints.size === 0) continue;

    // ────── 1. Massive token dump (>40M tokens) ──────
    if (tx.tokenTransfers?.some((t: any) => Number(t.tokenAmount || 0) > 40_000_000)) {
      isRug = true;
      reason = "MASSIVE DUMP (>40M tokens)";
    }

    // ────── 2. Big SOL drain from LP (>1.5 SOL out) ──────
    if (tx.nativeTransfers?.some((t: any) => t.amount < -1_500_000_000)) { // -1.5 SOL (in lamports)
      isRug = true;
      reason = reason || "LP DRAINED (>1.5 SOL out)";
    }

    // ────── 3. Mint/Freeze Authority Revoked (MOST RELIABLE) ──────
    const authorityRevoked = tx.accountData?.some((acc: any) => {
      const isOurMint = mints.has(acc.mint || acc.account);
      if (!isOurMint) return false;
      
      const mintAuthNull = acc.mintAuthority === null;
      const freezeAuthNull = acc.freezeAuthority === null;
      const freezeAuthBurn = acc.freezeAuthority === "11111111111111111111111111111111";

      return mintAuthNull || freezeAuthNull || freezeAuthBurn;
    });

    if (authorityRevoked) {
      isRug = true;
      reason = reason || "MINT/FREEZE AUTHORITY REVOKED";
    }

    // ────── 4. LP Tokens Burned (>50% of pair) ──────
    if (tx.tokenTransfers?.some((t: any) => 
      t.to === "Burn11111111111111111111111111111111111111111" && 
      Number(t.tokenAmount || 0) > 500_000_000 // adjust based on common LP size
    )) {
      isRug = true;
      reason = reason || "LP TOKENS BURNED";
    }

    // ────── 5. Description keywords (backup) ──────
    if (!isRug && /revoke|freeze|burn|authority|disable|set to zero/i.test(tx.description || "")) {
      isRug = true;
      reason = reason || "SUSPICIOUS AUTHORITY CHANGE";
    }

    // ────── RUG CONFIRMED → ALERT ALL WATCHERS ──────
    if (isRug) {
      console.log(`RUG DETECTED → ${reason} | https://solscan.io/tx/${sig}`);

      for (const mint of mints) {
        const users = watching.get(mint) || [];
        for (const userId of users) {
          await bot.telegram.sendMessage(
            userId,
            `<b>🚨 RUG ALERT — SELL IMMEDIATELY!</b>\n\n` +
            `<b>Reason:</b> <code>${reason}</code>\n` +
            `<b>Token:</b> <code>${mint}</code>\n` +
            `<b>Tx:</b> https://solscan.io/tx/${sig}\n` +
            `<b>Chart:</b> https://dexscreener.com/solana/${mint}`,
            { parse_mode: "HTML", disable_web_page_preview: true }
          ).catch(() => console.log(`Failed to alert user ${userId}`));
        }
        // Clean up — no need to watch dead token
        watching.delete(mint);
      }
    }
  }

  res.send("OK");
});

// Health check
app.get("/", (_, res) => res.send("RugChef v2025 — Fully Armed & Operational"));

export default app;
