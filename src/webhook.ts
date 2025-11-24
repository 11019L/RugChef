// src/payment-webhook.ts — FINAL FIXED VERSION (NOV 2025)
import express, { Request, Response } from "express";
import { Helius } from "helius-sdk";
import { bot } from "./index.js";
import { userData } from "./index.js";

const processedPayments = new Set<string>();
const app = express();
app.use(express.json({ limit: "20mb" }));

const helius = new Helius(process.env.HELIUS_API_KEY!);
const PAYMENT_WALLET = process.env.PAYMENT_WALLET!;

app.post("/helius", async (req: Request, res: Response) => {
  const txs: any[] = req.body || [];
  console.log(`\n[PAYMENT WEBHOOK] ${txs.length} transaction(s)`);

  for (const tx of txs) {
    if (!tx.signature || !tx.nativeTransfers) continue;

    const payment = tx.nativeTransfers.find(
      (t: any) => t.toUserAccount === PAYMENT_WALLET && t.amount >= 90_000_000 // 0.09+ SOL
    );
    if (!payment) continue;

    const amountSOL = payment.amount / 1_000_000_000;
    const sig = tx.signature;
    const desc = (tx.description || "").toLowerCase();

    // Prevent double processing
    if (processedPayments.has(sig)) {
      console.log(`→ Already processed: ${sig}`);
      continue;
    }
    processedPayments.add(sig);

    // Extract Telegram user ID from memo/description
    const match = desc.match(/\d{7,12}/);
    if (!match) {
      console.log(`→ No Telegram ID in memo`);
      continue;
    }

    const userId = Number(match[0]);
    console.log(`→ Payment ${amountSOL.toFixed(4)} SOL → User ${userId}`);

    try {
      if (amountSOL >= 0.44) {
        // LIFETIME PLAN
        userData.set(userId, {
          trials: 0,
          plan: "lifetime",
          expires: undefined,
        });

        await bot.telegram.sendMessage(
          userId,
          `*LIFETIME ACCESS UNLOCKED*\n\n` +
            `Amount: ${amountSOL.toFixed(4)} SOL\n` +
            `Tx: https://solscan.io/tx/${sig}\n\n` +
            `You now have unlimited protection forever!`,
          { parse_mode: "Markdown" }
        );
      } else {
        // MONTHLY PLAN (any payment under 0.44 SOL = monthly)
        userData.set(userId, {
          trials: 0,
          plan: "monthly",
          expires: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
        });

        await bot.telegram.sendMessage(
          userId,
          `*MONTHLY ACCESS ACTIVATED*\n\n` +
            `Amount: ${amountSOL.toFixed(4)} SOL\n` +
            `Valid for 30 days\n` +
            `Tx: https://solscan.io/tx/${sig}`,
          { parse_mode: "Markdown" }
        );
      }

      console.log(`→ SUCCESS: Upgraded user ${userId}`);
    } catch (err: any) {
      console.error(`→ Failed to message user ${userId}:`, err.message);
    }
  }

  res.send("OK");
});

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`Payment webhook LIVE on port ${PORT}`);
});

export default app;
