// src/payment-webhook.ts — FINAL, COMPILES CLEAN IN STRICT MODE
import express, { Request, Response } from "express";
import { Helius } from "helius-sdk";
import { bot } from "./index.js";
import { userData } from "./index.js";

// ────── Proper global type declaration (fixes TS18048) ──────
interface ProcessedPaymentsGlobal extends NodeJS.Global {
  processedPayments: Set<string>;
}
declare var global: ProcessedPaymentsGlobal;

// Initialize once
if (!global.processedPayments) {
  global.processedPayments = new Set<string>();
}

// ────── App setup ──────
const app = express();
app.use(express.json({ limit: "20mb" }));

const helius = new Helius(process.env.HELIUS_API_KEY!);
const PAYMENT_WALLET = process.env.PAYMENT_WALLET!;

app.post("/helius", async (req: Request, res: Response) => {
  const txs: any[] = req.body || [];
  console.log(`\n[PAYMENT WEBHOOK] ${txs.length} transaction(s) received`);

  for (const tx of txs) {
    if (!tx.signature || !tx.nativeTransfers) continue;

    const payment = tx.nativeTransfers.find((t: any) =>
      t.toUserAccount === PAYMENT_WALLET && t.amount >= 90_000_000
    );
    if (!payment) continue;

    const amountSOL = payment.amount / 1_000_000_000;
    const sig = tx.signature;
    const desc = (tx.description || "").toLowerCase();

    // ────── Prevent duplicate processing ──────
    if (global.processedPayments.has(sig)) {
      console.log(`→ Duplicate ignored: ${sig}`);
      continue;
    }
    global.processedPayments.add(sig);

    // ────── Extract user ID from memo ──────
    const match = desc.match(/\d{7,12}/);
    if (!match) {
      console.log(`→ No valid Telegram ID in memo`);
      continue;
    }
    const userId = Number(match[0]);
    console.log(`→ Payment detected: ${amountSOL.toFixed(4)} SOL → User ${userId}`);

    try {
      if (amountSOL >= 0.44) {
        // Lifetime
        userData.set(userId, { trials: 0, plan: "lifetime", tokens: [], expires: undefined });
        await bot.telegram.sendMessage(
          userId,
          `*LIFETIME ACCESS UNLOCKED*\n\n` +
          `Amount: ${amountSOL.toFixed(4)} SOL\n` +
          `Thank you for the support!\n` +
          `https://solscan.io/tx/${sig}`,
          { parse_mode: "Markdown" }
        );
      } else {
        // Monthly
        userData.set(userId, { trials: 0, plan: "monthly", tokens: [], expires: Date.now() + 30 * 24 * 60 * 60 * 1000 });
        await bot.telegram.sendMessage(
          userId,
          `*MONTHLY ACCESS ACTIVATED*\n\n` +
          `Amount: ${amountSOL.toFixed(4)} SOL\n` +
          `Valid for 30 days\n` +
          `https://solscan.io/tx/${sig}`,
          { parse_mode: "Markdown" }
        );
      }
      console.log(`→ Successfully upgraded user ${userId}`);
    } catch (err: any) {
      console.error(`→ Failed to message user ${userId}:`, err.message);
    }
  }

  res.send("OK");
});

// ────── Start server ──────
const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`Payment webhook LIVE on port ${PORT}`);
  console.log(`Endpoint: ${process.env.RAILWAY_STATIC_URL}/helius`);
});

export default app;
