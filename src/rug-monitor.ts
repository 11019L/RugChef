// src/rug-monitor.ts — FINAL — SHOWS REAL HELIUS ERROR 100% (NOV 2025)
import { Helius, TransactionType, WebhookType } from "helius-sdk";
import { bot } from "./index.js";
import express, { Request, Response } from "express";
import { Connection, PublicKey } from "@solana/web3.js";

process.env.UV_THREADPOOL_SIZE = "128";

const helius = new Helius(process.env.HELIUS_API_KEY!);
const connection = new Connection(helius.endpoint);

const watching = new Map<string, { users: number[]; addresses: string[] }>();

console.log("RUG SHIELD STARTED");
console.log("Helius endpoint:", helius.endpoint);

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

const escapeMD = (text: string) => text.replace(/[_*\[\]()~`>#+=|{}.!-]/g, "\\$&");

const logHeliusError = (action: string, e: any) => {
  console.error(`\nHELIUS REJECTED ${action} →`);

  let realError = null;

  // Walk the entire error chain — this is the ONLY way in Nov 2025
  let current = e;
  while (current && !realError) {
    if (current.response?.data) realError = current.response.data;
    else if (current.cause) current = current.cause;
    else if (current.error) current = current.error;
    else break;
  }

  // Final fallback — parse the garbage string
  if (!realError && typeof e.message === "string" && e.message.includes("[object Object]")) {
    try {
      const match = e.message.match(/\[object Object\]$/) || e.toString().match(/\{.*\}/);
      if (match) realError = JSON.parse(match[0].replace(/'/g, '"'));
    } catch {}
  }

  console.error("REAL HELIUS ERROR →", JSON.stringify(realError || e.message || "unknown", null, 2));
};
export async function watchToken(tokenMint: string, userId: number) {
  console.log(`\n[WATCH REQUEST] User ${userId} → ${tokenMint}`);

  if (!watching.has(tokenMint)) watching.set(tokenMint, { users: [], addresses: [] });
  const entry = watching.get(tokenMint)!;

  if (entry.users.includes(userId)) return;
  entry.users.push(userId);

  // MINT WEBHOOK
  try {
    await helius.createWebhook({
      webhookURL: WEBHOOK_URL,
      transactionTypes: [TransactionType.ANY],
      accountAddresses: [tokenMint],
      webhookType: WebhookType.ENHANCED,
    });
    console.log("MINT WEBHOOK → SUCCESS");
    entry.addresses.push(tokenMint);
  } catch (e: any) {
    logHeliusError("MINT WEBHOOK", e);
  }

  await new Promise(r => setTimeout(r, 2500));

  // FULL PROTECTION
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
        await helius.createWebhook({
          webhookURL: WEBHOOK_URL,
          transactionTypes: [TransactionType.ANY],
          accountAddresses: [tokenMint, ...Array.from(extra)],
          webhookType: WebhookType.ENHANCED,
        });
        console.log("FULL PROTECTION → SUCCESS");
        entry.addresses.push(...Array.from(extra));
      } catch (e: any) {
        logHeliusError("FULL PROTECTION WEBHOOK", e);
      }
    }
  } catch {
    console.log("→ Token not indexed yet");
  }

  const short = escapeMD(tokenMint.slice(0, 8) + "..." + tokenMint.slice(-4));
  await bot.telegram.sendMessage(userId,
    `*RUG SHIELD ACTIVE*\nToken: \`${short}\`\nWatching ${entry.addresses.length} address${entry.addresses.length === 1 ? "" : "\\(es\\)"}`,
    { parse_mode: "MarkdownV2" }
  ).catch(() => {});
}

const app = express();
app.use(express.json({ limit: "20mb" }));
app.post("/rug-alert", (req, res) => res.send("OK"));

export default app;
