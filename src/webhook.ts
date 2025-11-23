import express, { Request, Response } from "express";
import { Helius } from "helius-sdk";
import { bot } from "./index.js";
import { userData } from "./index.js";

declare global {
  var processedPayments: Set<string> | undefined;
}
global.processedPayments ??= new Set<string>();

const app = express();
app.use(express.json({ limit: "20mb" }));

const helius = new Helius(process.env.HELIUS_API_KEY!);
const PAYMENT_WALLET = process.env.PAYMENT_WALLET!;

app.post("/helius", async (req: Request, res: Response) => {
  const txs: any[] = req.body || [];
  console.log(`\n[PAYMENT WEBHOOK] ${txs.length} tx(s)`);

  for (const tx of txs) {
    if (!tx.nativeTransfers || !tx.signature) continue;

    const payment = tx.nativeTransfers.find((t: any) =>
      t.toUserAccount === PAYMENT_WALLET && t.amount >= 90_000_000
    );
    if (!payment) continue;

    const amountSOL = payment.amount / 1_000_000_000;
    const signature = tx.signature;
    const description = (tx.description || "").toLowerCase();

    if (global.processedPayments.has(signature)) {
      console.log(`→ Duplicate payment ignored: ${signature}`);
      continue;
    }
    global.processedPayments.add(signature);

    const memoMatch = description.match(/\d{7,12}/);
    if (!memoMatch) {
      console.log(`→ No user ID in memo`);
      continue;
    }

    const userId = Number(memoMatch[0]);
    console.log(`→ Payment ${amountSOL.toFixed(3)} SOL from user ${userId}`);

    try {
      if (amountSOL >= 0.44) {
        userData.set(userId, { trials: 0, plan: "lifetime", tokens: [], expires: undefined });
        await bot.telegram.sendMessage(userId,
          `*LIFETIME UNLOCKED*\nPaid ${amountSOL.toFixed(3)} SOL\nhttps://solscan.io/tx/${signature}`,
          { parse_mode: "Markdown" }
        );
      } else {
        userData.set(userId, { trials: 0, plan: "monthly", tokens: [], expires: Date.now() + 30*24*60*60*1000 });
        await bot.telegram.sendMessage(userId,
          `*MONTHLY ACTIVATED*\nPaid ${amountSOL.toFixed(3)} SOL (30 days)\nhttps://solscan.io/tx/${signature}`,
          { parse_mode: "Markdown" }
        );
      }
      console.log(`   → Upgraded user ${userId}`);
    } catch (e) {
      console.error(`Failed to message ${userId}`);
    }
  }

  res.send("OK");
});

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`Payment webhook LIVE on port ${PORT}`);
});
