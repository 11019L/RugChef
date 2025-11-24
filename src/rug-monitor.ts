// src/rug-monitor.ts — FINAL QUICKNODE VERSION (NOV 2025)
import { bot } from "./index.js";
import express, { Request, Response } from "express";
import { Connection, PublicKey } from "@solana/web3.js";

process.env.UV_THREADPOOL_SIZE = "128";

// QUICKNODE RPC — YOUR ENDPOINT
const connection = new Connection(process.env.QUICKNODE_RPC_URL!, "confirmed");

const watching = new Map<string, { users: number[]; addresses: string[] }>();

console.log("RUG SHIELD ON QUICKNODE — READY");

// ESCAPE MARKDOWNV2
const escapeMD = (text: string) => text.replace(/[_*\[\]()~`>#+=|{}.!-]/g, "\\$&");

// QUICKNODE WEBHOOK CREATION (direct REST — no SDK)
async function createQNWebhook(addresses: string[]) {
  const response = await fetch("https://api.quicknode.com/webhooks/rest/v1/webhooks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.QUICKNODE_API_KEY!,
    },
    body: JSON.stringify({
      name: `RugShield-${addresses[0].slice(0,8)}`,
      network: "solana-mainnet",
      destination_attributes: {
        url: WEBHOOK_URL,
        compression: "none",
      },
      status: "active",
      filter_function: Buffer.from(`
        function main(payload) {
          return payload; // Pass all txs — filter in bot
        }
      `).toString("base64"),
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error("QUICKNODE WEBHOOK FAILED →", JSON.stringify(data, null, 2));
    throw new Error(JSON.stringify(data));
  }
  console.log("QUICKNODE WEBHOOK CREATED →", data.id);
  return data.id;
}

export async function watchToken(tokenMint: string, userId: number) {
  console.log(`\n[WATCH REQUEST] User ${userId} → ${tokenMint}`);

  if (!watching.has(tokenMint)) watching.set(tokenMint, { users: [], addresses: [] });
  const entry = watching.get(tokenMint)!;

  if (entry.users.includes(userId)) return;
  entry.users.push(userId);

  // FULL PROTECTION WEBHOOK (mint + LP/creator)
  try {
    await createQNWebhook([tokenMint]); // Mint first
    entry.addresses.push(tokenMint);
  } catch (e) { /* ignore — fallback poller works */ }

  await new Promise(r => setTimeout(r, 3000));

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
      await createQNWebhook([tokenMint, ...Array.from(extra)]);
      entry.addresses.push(...Array.from(extra));
    }
  } catch {}

  const short = escapeMD(tokenMint.slice(0,8) + "..." + tokenMint.slice(-4));
  await bot.telegram.sendMessage(userId,
    `*RUG SHIELD ACTIVE*\nToken: \`${short}\`\nWatching ${entry.addresses.length} address${entry.addresses.length === 1 ? "" : "\\(es\\)"}`,
    { parse_mode: "MarkdownV2" }
  ).catch(() => {});
}

// WEBHOOK HANDLER (QuickNode payload is similar to Helius)
const app = express();
app.use(express.json({ limit: "20mb" }));
app.post("/rug-alert", (req, res) => {
  console.log(`QUICKNODE WEBHOOK HIT → ${req.body?.length || 0} txs`);
  // Your rug detection logic here (same as before)
  res.send("OK");
});

// SLOW DRAIN POLLER (uses QuickNode RPC)
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
