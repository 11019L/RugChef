import { Helius, TransactionType, WebhookType } from "helius-sdk";
import { bot } from "./index.js";
import express from "express";
import { Connection, PublicKey } from "@solana/web3.js";

const helius = new Helius(process.env.HELIUS_API_KEY!);
const connection = new Connection(helius.endpoint);

const watching = new Map<string, number[]>();

const WEBHOOK_URL = `https://${process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_APP_NAME + ".up.railway.app"}/webhook`.replace(/\/+$/, "/webhook");

export async function watchToken(mint: string, userId: number) {
  if (watching.has(mint) && watching.get(mint)!.includes(userId)) return;

  const users = watching.get(mint) || [];
  users.push(userId);
  watching.set(mint, users);

  try {
    await helius.createWebhook({
      webhookURL: WEBHOOK_URL,
      transactionTypes: [TransactionType.ANY],
      accountAddresses: [mint],
      webhookType: WebhookType.ENHANCED,
    });
    console.log("Webhook created for", mint.slice(0,8));
  } catch (e) {
    console.log("Webhook failed (polling fallback active):", (e as any).message);
  }

  bot.telegram.sendMessage(userId, `RUG SHIELD ACTIVE\n\`${mint.slice(0,8)}...${mint.slice(-4)}\``, { parse_mode: "Markdown" });
}

const app = express();
app.use(express.json({ limit: "10mb" }));

app.post("/webhook", (req, res) => {
  console.log("Webhook hit:", req.body.length, "txs");
  // put your rug detection here later
  res.send("OK");
});

app.get("/", (_, res) => res.send("bot alive"));

setInterval(async () => {
  for (const [mint] of watching) {
    try {
      const largest = await connection.getTokenLargestAccounts(new PublicKey(mint));
      if ((largest.value[0]?.uiAmount || 0) < 300) {
        for (const userId of watching.get(mint)!) {
          bot.telegram.sendMessage(userId, "SLOW RUG — LP DRAINED");
        }
        watching.delete(mint);
      }
    } catch {}
  }
}, 30000);

export default app;
