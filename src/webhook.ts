// src/webhook.ts
import express, { Request, Response } from "express";
import { Helius } from "helius-sdk";
import { Telegraf } from "telegraf";
import { userData, PAYMENT_WALLET } from "./index.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

const bot = new Telegraf(process.env.BOT_TOKEN!);
const helius = new Helius(process.env.HELIUS_API_KEY!);

app.post("/helius", async (req: Request, res: Response) => {
  const events = req.body as any[];

  for (const tx of events) {
    // Look for incoming SOL transfer to your payment wallet
    const transfer = (tx.nativeTransfers || []).find((t: any) =>
      t.toUserAccount === PAYMENT_WALLET && t.amount > 50_000_000 // >0.05 SOL
    );

    if (!transfer) continue;

    const amountSOL = transfer.amount / 1_000_000_000;
    const memo = tx.description || tx.memo || "";

    // Extract Telegram ID from memo (user wrote their ID)
    const match = memo.match(/(\d{7,12})/);
    if (!match) continue;

    const userId = Number(match[0]);
    if (isNaN(userId)) continue;

    let plan: "monthly" | "lifetime" = "monthly";
    let message = "MONTHLY ACTIVATED! ($20)\nUnlimited tokens for 30 days";

    if (amountSOL >= 0.44) {
      plan = "lifetime";
      message = "LIFETIME UNLOCKED! ($100)\nUnlimited protection forever";
      userData.set(userId, { trials: 0, plan: "lifetime" });
    } else if (amountSOL >= 0.09) {
      plan = "monthly";
      userData.set(userId, { trials: 0, plan: "monthly", expires: Date.now() + 30 * 24 * 60 * 60 * 1000 });
    } else {
      continue;
    }

    try {
      await bot.telegram.sendMessage(userId, `Payment received!\n\n${message}`);
      console.log(`Auto-upgraded user ${userId} to ${plan} (${amountSOL} SOL)`);
    } catch (err) {
      console.log("Failed to notify user (maybe blocked bot):", userId);
    }
  }

  res.status(200).send("OK");
});

app.get("/", (req: Request, res: Response) => {
  res.send("RugShield webhook is alive");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Auto-payment webhook running on port ${PORT}`);
});
