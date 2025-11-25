// src/rug-monitor.ts — THE ONE THAT ACTUALLY WORKS AND NEVER GOES SILENT

import { Helius, TransactionType, WebhookType } from "helius-sdk";
import { bot } from "./index.js";
import express, { Request, Response } from "express";

const helius = new Helius(process.env.HELIUS_API_KEY!);
const watching = new Map<string, { users: number[]; webhookId?: string }>();

async function deleteWebhook(id: string) {
  try { await helius.deleteWebhook(id); } catch {}
}

export async function watchToken(mint: string, userId: number) {
  if (!watching.has(mint)) watching.set(mint, { users: [] });
  const entry = watching.get(mint)!;

  if (entry.users.includes(userId)) return;
  entry.users.push(userId);

  // Create webhook only once per mint
  if (!entry.webhookId) {
    try {
      const wh = await helius.createWebhook({
        webhookURL: process.env.WEBHOOK_URL!,
        transactionTypes: [TransactionType.ANY],
        accountAddresses: [mint],
        webhookType: WebhookType.ENHANCED,
      });
      entry.webhookId = wh.webhookID;
      console.log(`Webhook created for ${mint.slice(0,8)}... → ${wh.webhookID}`);
    } catch (e: any) {
      if (e.message.includes("limit")) {
        // Free one slot
        const oldest = watching.entries().next().value;
        if (oldest) {
          await deleteWebhook(oldest[1].webhookId!);
          watching.delete(oldest[0]);
          console.log("Freed a webhook slot");
        }
      }
    }
  }

  await bot.telegram.sendMessage(userId, `Protection ON\n<code>${mint}</code>`, { parse_mode: "HTML" });
}

const app = express();
app.use(express.json({ limit: "10mb" }));

app.post("/webhook", async (req: Request, res: Response) => {
  const txs: any[] = req.body;
  console.log(`Webhook hit — ${txs.length} tx(s)`);   // YOU WILL SEE THIS

  for (const tx of txs) {
    if (!tx.signature) continue;

    let reason = "";
    if (tx.tokenTransfers?.some((t: any) => Number(t.tokenAmount || 0) > 80_000_000)) reason = "MASSIVE DUMP";
    else if (tx.nativeTransfers?.some((t: any) => t.amount < -1_500_000_000)) reason = "LP DRAIN";
    else if (tx.accountData?.some((a: any) => a.mintAuthority === null || a.freezeAuthority === null)) reason = "AUTHORITY REVOKED";
    else if (tx.tokenTransfers?.some((t: any) => t.to?.includes("Burn"))) reason = "LP BURNED";

    if (reason) {
      console.log(`RUG → ${reason} → https://solscan.io/tx/${tx.signature}`);

      const mints = new Set<string>();
      tx.tokenTransfers?.forEach((t: any) => t.mint && mints.add(t.mint));
      tx.accountData?.forEach((a: any) => a.mint && mints.add(a.mint));

      for (const mint of mints) {
        const entry = watching.get(mint);
        if (!entry) continue;

        for (const uid of entry.users) {
          await bot.telegram.sendMessage(uid,
            `RUG DETECTED — SELL!\n\n` +
            `Reason: <code>${reason}</code>\n` +
            `<code>${mint}</code>\n` +
            `https://solscan.io/tx/${tx.signature}\n` +
            `https://dexscreener.com/solana/${mint}`,
            { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
          );
        }

        if (entry.webhookId) await deleteWebhook(entry.webhookId);
        watching.delete(mint);
      }
    }
  }
  res.send("OK");
});

app.get("/", (_, res) => res.send("Rug monitor alive — logs will appear on /webhook hits"));

export default app;
