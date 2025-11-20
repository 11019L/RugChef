import express, { Request, Response } from "express";
import { Helius, TransactionType } from "helius-sdk";
import { bot } from "./index.js";
import { userData, PAYMENT_WALLET } from "./index.js";

const app = express();
app.use(express.json({ limit: "20mb" }));

const helius = new Helius(process.env.HELIUS_API_KEY!);

app.post("/helius", async (req: Request, res: Response) => {
  const txs = req.body;

  for (const tx of txs) {
    const payment = tx.nativeTransfers?.find((t: any) => 
      t.toUserAccount === PAYMENT_WALLET && t.amount >= 90_000_000
    );

    if (payment) {
      const amount = payment.amount / 1e9;
      const memo = tx.description || "";
      const match = memo.match(/\d{7,12}/);
      if (match) {
        const userId = Number(match[0]);
        if (amount >= 0.44) {
          userData.set(userId, { trials: 0, plan: "lifetime", tokens: [] });
          bot.telegram.sendMessage(userId, "LIFETIME UNLOCKED! ($100)");
        } else {
          userData.set(userId, { trials: 0, plan: "monthly", expires: Date.now() + 30*24*60*60*1000, tokens: [] });
          bot.telegram.sendMessage(userId, "MONTHLY ACTIVATED! ($20)");
        }
      }
    }
  }
  res.send("OK");
});

app.listen(3000, () => console.log("Payment webhook live"));
