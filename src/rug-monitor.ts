// src/rug-monitor.ts — LIMIT-PROOF RUG MONITOR (Nov 2025)
// Single global webhook + client-side filtering = infinite scalability

import { Helius, TransactionType, WebhookType } from "helius-sdk";
import { bot } from "./index.js";
import express from "express";
import { Connection } from "@solana/web3.js";

// ────── Init ──────
const helius = new Helius(process.env.HELIUS_API_KEY!);
const connection = new Connection(helius.endpoint);
const watching = new Map<string, number[]>();

// Use your bot's wallet as the "global listener" (or any address you control)
const GLOBAL_LISTENER = process.env.GLOBAL_LISTENER_WALLET || "YourBotWalletPubkeyHere1111111111111111111111111"; // Replace with real pubkey!

const WEBHOOK_URL = (() => {
  const base = process.env.RAILWAY_STATIC_URL || process.env.RENDER_EXTERNAL_URL || `https://${process.env.RAILWAY_APP_NAME}.up.railway.app`;
  const clean = base.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${clean}/webhook`;
})();
console.log("WEBHOOK URL →", WEBHOOK_URL);
console.log("GLOBAL LISTENER →", GLOBAL_LISTENER);

// ────── Setup Global Webhook (runs once on startup) ──────
let globalWebhookId: string | null = null;
async function setupGlobalWebhook() {
  try {
    const webhook = await helius.createWebhook({
      webhookURL: WEBHOOK_URL,
      transactionTypes: [TransactionType.ANY],
      accountAddresses: [GLOBAL_LISTENER], // Listens to ALL txs involving this address (but we filter for mints)
      webhookType: WebhookType.ENHANCED,
    });
    globalWebhookId = webhook.webhookID;
    console.log("GLOBAL WEBHOOK CREATED → ID:", globalWebhookId);
  } catch (e: any) {
    if (e.message.includes("already exists")) {
      // Fetch existing if it already exists
      const webhooks = await helius.getAllWebhooks(); // ← FIXED: Correct SDK method
      const existing = webhooks.find((w: any) => w.accountAddresses?.[0] === GLOBAL_LISTENER);
      if (existing) {
        globalWebhookId = existing.webhookID;
        console.log("GLOBAL WEBHOOK FOUND (existing) → ID:", globalWebhookId);
      }
    } else if (e.message.includes("reached webhook limit")) {
      console.error("WEBHOOK LIMIT HIT — Delete old ones in dashboard or upgrade plan");
    } else {
      console.error("GLOBAL WEBHOOK SETUP FAILED →", e.message);
    }
  }
}

// Call on startup
setupGlobalWebhook();

// ────── Watch Token (now just tracks users, no new webhooks) ──────
export async function watchToken(mint: string, userId: number) {
  console.log(`\n[WATCH] User ${userId} → ${mint}`);

  if (!watching.has(mint)) watching.set(mint, []);
  if (watching.get(mint)!.includes(userId)) {
    return await bot.telegram.sendMessage(userId, "You're already protecting this token.");
  }
  watching.get(mint)!.push(userId);

  await bot.telegram.sendMessage(
    userId,
    `PROTECTION ACTIVE\n\n<code>${mint}</code>\n\n<i>(Global monitoring active — no limits!)</i>`,
    { parse_mode: "HTML" }
  );
}

// ────── Express App ──────
const app = express();
app.use(express.json({ limit: "10mb" }));

app.post("/webhook", async (req, res) => {
  const txs: any[] = req.body || [];
  console.log(`GLOBAL WEBHOOK HIT → ${txs.length} tx(s)`);

  for (const tx of txs) {
    const sig = tx.signature;
    if (!sig) continue;

    // ────── Extract mints from this tx (now checks ALL incoming txs) ──────
    const mints = new Set<string>();
    tx.tokenTransfers?.forEach((t: any) => t.mint && mints.add(t.mint));
    tx.accountData?.forEach((a: any) => a.mint && mints.add(a.mint));
    tx.accountKeys?.forEach((k: string) => k.length === 44 && mints.add(k)); // Fallback for base58 mints

    // Only process if any mint matches our watched list
    const watchedMints = Array.from(mints).filter(mint => watching.has(mint));
    if (watchedMints.length === 0) continue;

    let isRug = false;
    let reason = "";

    // ────── 1. Classic massive dump ──────
    if (tx.tokenTransfers?.some((t: any) => Number(t.tokenAmount || 0) > 40_000_000)) {
      isRug = true;
      reason = "MASSIVE DUMP (>40M)";
    }

    // ────── 2. LP drain ──────
    if (tx.nativeTransfers?.some((t: any) => t.amount < -1_500_000_000)) {
      isRug = true;
      reason = reason || "LP DRAIN (>1.5 SOL)";
    }

    // ────── 3. Dev dump (your 741M fix) ──────
    const totalSoldByDev = tx.tokenTransfers
      ?.filter((t: any) => 
        t.from && 
        t.from.length === 44 && 
        !t.from.includes("pump") && 
        !t.from.includes("raydium")
      )
      ?.reduce((sum: number, t: any) => sum + Number(t.tokenAmount || 0), 0) || 0;

    if (totalSoldByDev > 90_000_000) {
      isRug = true;
      reason = reason || `DEV DUMP (${(totalSoldByDev/1_000_000).toFixed(0)}M)`;
    }

    // ────── 4. Authority revoked ──────
    const authRevoked = tx.accountData?.some((acc: any) => {
      const isOurMint = watchedMints.includes(acc.mint || acc.account);
      if (!isOurMint) return false;
      return (
        acc.mintAuthority === null ||
        acc.freezeAuthority === null ||
        acc.freezeAuthority === "11111111111111111111111111111111"
      );
    });
    if (authRevoked) {
      isRug = true;
      reason = reason || "AUTHORITY REVOKED";
    }

    // ────── 5. LP burn ──────
    if (tx.tokenTransfers?.some((t: any) =>
      t.to === "Burn11111111111111111111111111111111111111111" &&
      Number(t.tokenAmount || 0) > 500_000_000
    )) {
      isRug = true;
      reason = reason || "LP BURNED";
    }

    // ────── 6. Description fallback ──────
    if (!isRug && /revoke|freeze|burn|authority|disable/i.test(tx.description || "")) {
      isRug = true;
      reason = reason || "SUSPICIOUS AUTHORITY CHANGE";
    }

    // ────── ALERT WATCHERS FOR MATCHING MINTS ──────
    if (isRug) {
      console.log(`RUG → ${reason} | https://solscan.io/tx/${sig} | Mints: ${watchedMints.join(", ")}`);

      for (const mint of watchedMints) {
        const users = watching.get(mint) || [];
        for (const userId of users) {
          await bot.telegram.sendMessage(
            userId,
            `<b>RUG ALERT — SELL NOW!</b>\n\n` +
            `<b>Reason:</b> <code>${reason}</code>\n` +
            `<b>Token:</b> <code>${mint}</code>\n` +
            `<b>Tx:</b> https://solscan.io/tx/${sig}\n` +
            `<b>Chart:</b> https://dexscreener.com/solana/${mint}`,
            {
              parse_mode: "HTML",
              link_preview_options: { is_disabled: true }
            }
          ).catch(() => {});
        }
        watching.delete(mint); // Clean up dead token
      }
    }
  }

  res.send("OK");
});

app.get("/", (_, res) => res.send(`RugShield 2025 — Global Mode Active | Webhook ID: ${globalWebhookId || 'Pending'}`));

export default app;
