// src/payment-webhook.ts — FINAL FIXED VERSION (November 2025)
import express, { Request, Response } from "express";
import { Helius } from "helius-sdk";
import { bot } from "./index.js";
import { userData } from "./index.js";

const app = express();
app.use(express.json({ limit: "20mb" }));

const helius = new Helius(process.env.HELIUS_API_KEY!);
const PAYMENT_WALLET = process.env.PAYMENT_WALLET!;

// === MAIN PAYMENT WEBHOOK ===
app.post("/helius", async (req: Request, res: Response) => {
  const txs: any[] = req.body || [];

  console.log(`\n[PAYMENT WEBHOOK] ${txs.length} tx(s) received`);

  for (const tx of txs) {
    if (!tx.nativeTransfers || !tx.signature) continue;

    // Find incoming payment to your wallet
    const payment = tx.nativeTransfers.find((t: any) =>
      t.toUserAccount === PAYMENT_WALLET && 
      t.amount >= 90_000_000 // at least 0.09 SOL
    );

    if (!payment) continue;

    const amountSOL = payment.amount / 1_000_000_000;
    const signature = tx.signature;
    const description = (tx.description || "").toLowerCase();

    console.log(`→ Payment detected: ${amountSOL.toFixed(3)} SOL | Tx: ${signature}`);

    // Extract user ID from memo OR description
    let userId: number | null = null;
    const memoMatch = description.match(/\d{7,12}/);
    if (memoMatch) {
      userId = Number(memoMatch[0]);
      console.log(`   → User ID from memo: ${userId}`);
    } else {
      console.log(`   → No valid memo/user ID found in description`);
      continue;
    }

    // Prevent double-processing (optional: store processed sigs in DB later)
    if (global.processedPayments?.has(signature)) {
      console.log(`   → Already processed`);
      continue;
    }
    (global as any).processedPayments = (global as any).processedPayments || new Set();
    (global as any).processedPayments.add(signature);

    // === UPGRADE USER ===
    try {
      if (amountSOL >= 0.44) {
        // Lifetime
        userData.set(userId, {
          trials: 0,
          plan: "lifetime",
          tokens: [],
          expires: undefined
        });

        await bot.telegram.sendMessage(
          userId,
          `*LIFETIME ACCESS UNLOCKED*\n\n` +
          `You paid ${amountSOL.toFixed(3)} SOL\n` +
          `Thank you for supporting RugChef!\n\n` +
          `You now have unlimited token protection forever.\n` +
          `Tx: https://solscan.io/tx/${signature}`,
          { parse_mode: "Markdown" }
        );
        console.log(`   → LIFETIME granted to ${userId}`);
      } else {
        // Monthly (0.1 SOL or more, but less than 0.44)
        userData.set(userId, {
          trials: 0,
          plan: "monthly",
          tokens: [],
          expires: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
        });

        await bot.telegram.sendMessage(
          userId,
          `*MONTHLY ACCESS ACTIVATED*\n\n` +
          `You paid ${amountSOL.toFixed(3)} SOL\n` +
          `Valid for 30 days from now\n` +
          `Tx: https://solscan.io/tx/${signature}`,
          { parse_mode: "Markdown" }
        );
        console.log(`   → MONTHLY granted to ${userId} (expires in 30d)`);
      }
    } catch (err: any) {
      console.error(`Failed to message user ${userId}:`, err.message);
    }
  }

  res.send("OK");
});

// === START SERVER ===
const PORT = Number(process.env.PORT) || 3001; // Use different port than main bot!
app.listen(PORT, () => {
  console.log(`Payment webhook LIVE on port ${PORT}`);
  console.log(`Endpoint: ${process.env.RAILWAY_STATIC_URL}/helius`);
});

export default app;
