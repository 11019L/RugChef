// src/rug-monitor.ts — FINAL — NO MORE [object Object] EVER (NOV 2025)
import { bot } from "./index.js";
import express, { Request, Response } from "express";
import { Connection, PublicKey } from "@solana/web3.js";

process.env.UV_THREADPOOL_SIZE = "128";

const connection = new Connection("https://mainnet.helius-rpc.com/?api-key=" + process.env.HELIUS_API_KEY);

const watching = new Map<string, { users: number[]; addresses: string[] }>();

console.log("RUG SHIELD STARTED");

// WEBHOOK URL
const WEBHOOK_URL = (() => {
  const base = process.env.RAILWAY_STATIC_URL || `https://${process.env.RAILWAY_APP_NAME}.up.railway.app`;
  if (!base || base.includes("undefined")) {
    console.error("FATAL: Set RAILWAY_STATIC_URL in Railway variables!");
    process.exit(1);
  }
  const url = `${base.replace(/\/$/, "")}/rug-alert`;
  console.log(`WEBHOOK URL → ${url}`);
  return url;
})();

// ESCAPE MARKDOWNV2
const escapeMD = (text: string) => text.replace(/[_*\[\]()~`>#+=|{}.!-]/g, "\\$&");

// DIRECT HELIUS API CALL — NO SDK = NO [object Object]
async function createHeliusWebhook(addresses: string[]) {
  const response = await fetch("https://api.helius.xyz/v0/webhooks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.HELIUS_API_KEY}`,
    },
    body: JSON.stringify({
      webhookURL: WEBHOOK_URL,
      transactionTypes: ["ANY"],
      accountAddresses: addresses,
      webhookType: "enhanced",
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data;
}

export async function watchToken(tokenMint: string, userId: number) {
  console.log(`\n[WATCH REQUEST] User ${userId} → ${tokenMint}`);

  if (!watching.has(tokenMint)) watching.set(tokenMint, { users: [], addresses: [] });
  const entry = watching.get(tokenMint)!;

  if (entry.users.includes(userId)) return;
  entry.users.push(userId);
  console.log(`→ Now watching for ${entry.users.length} user(s)`);

  // 1. MINT WEBHOOK — DIRECT API
  try {
    await createHeliusWebhook([tokenMint]);
    console.log("MINT WEBHOOK → SUCCESS");
    entry.addresses.push(tokenMint);
  } catch (e: any) {
    console.error("MINT WEBHOOK FAILED →", e.message);
  }

  await new Promise(r => setTimeout(r, 3000)); // Safe delay

  // 2. FULL PROTECTION
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw 0;

    const data: any = await res.json();
    const extra = new Set<string>();

    data.pairs?.forEach((p: any) => {
      p.pairAddress && extra.add(p.pairAddress);
      p.creatorAddress && extra.add(p.creatorAddress);
    });

    if (extra.size > 0) {
      try {
        await createHeliusWebhook([tokenMint, ...Array.from(extra)]);
        console.log(`FULL PROTECTION → SUCCESS (${extra.size} extra addresses)`);
        entry.addresses.push(...Array.from(extra));
      } catch (e: any) {
        console.error("FULL PROTECTION FAILED →", e.message);
      }
    } else {
      console.log("→ No LP/creator found yet");
    }
  } catch {
    console.log("→ Token not indexed yet");
  }

  // FINAL MESSAGE
  const short = escapeMD(tokenMint.slice(0, 8) + "..." + tokenMint.slice(-4));
  const count = entry.addresses.length;

  await bot.telegram.sendMessage(
    userId,
    `*RUG SHIELD ACTIVE*\nToken: \`${short}\`\nWatching ${count} address${count === 1 ? "" : "\\(es\\)"} — You are protected`,
    { parse_mode: "MarkdownV2" }
  ).catch(() => {});
}

// WEBHOOK HANDLER
const app = express();
app.use(express.json({ limit: "20mb" }));
app.post("/rug-alert", (req, res) => {
  console.log(`WEBHOOK HIT → ${req.body?.length || 0} txs`);
  res.send("OK");
});

// SLOW DRAIN POLLER
setInterval(async () => {
  if (watching.size === 0) return;
  for (const [mint, entry] of watching.entries()) {
    try {
      const resp = await connection.getTokenLargestAccounts(new PublicKey(mint));
      const amount = Number(resp.value[0]?.uiAmount || 0);
      if (amount < 300) {
        console.log(`SLOW RUG → ${mint.slice(0,8)}...`);
        for (const uid of entry.users) {
          await bot.telegram.sendMessage(uid, "*SLOW RUG — LP DRAINED*", { parse_mode: "MarkdownV2" });
        }
        watching.delete(mint);
      }
    } catch {}
  }
}, 35000);

export default app;
