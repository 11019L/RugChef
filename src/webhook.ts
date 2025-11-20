import express from "express";
import { Helius } from "helius-sdk";
import { Telegraf } from "telegraf";
import { userData } from "./index.js"; // Import your user storage from main bot

const app = express();
app.use(express.json());

const bot = new Telegraf(process.env.BOT_TOKEN!);
const helius = new Helius(process.env.HELIUS_API_KEY!); // Add your free Helius key to Railway vars

// Your payment wallet (same as before)
const PAYMENT_WALLET = "YourSolWalletHere123456789xxxxxxxxxxxxxxxxxx";

// Webhook endpoint – Helius pings this on new txs to your wallet
app.post("/webhook", async (req, res) => {
  const events = req.body; // Helius sends parsed tx data

  for (const event of events) {
    if (event.type === "TRANSFER" && event.nativeTransfers?.length > 0) { // SOL transfer detected
      const transfer = event.nativeTransfers[0];
      if (transfer.toUserAccount === PAYMENT_WALLET) { // Incoming to you
        const amountSOL = transfer.amount / 1e9; // Convert lamports to SOL
        const memo = event.tokenTransfers?.find(t => t.mint === "MemoSq4gqABAXKb96qnH8TysNcHtKV5D8qJ9v8kY3A1")?.tokenAmount?.asString || ""; // Extract memo (SOL memo program)

        // Parse user ID from memo (e.g., "123456789" or "@john_degen")
        let userId: number;
        if (memo.startsWith("@")) {
          // Quick lookup – in real bot, store @username when they start
          userId = parseInt(memo.slice(1)); // Assume they send number after @, or add username-to-ID map
        } else {
          userId = parseInt(memo);
        }

        if (!isNaN(userId)) {
          let plan: "monthly" | "lifetime";
          if (amountSOL >= 0.45) {
            plan = "lifetime";
            userData.set(userId, { trials: 0, plan: "lifetime" });
          } else if (amountSOL >= 0.1) {
            plan = "monthly";
            userData.set(userId, { trials: 0, plan: "monthly", expires: Date.now() + 30*24*60*60*1000 });
          } else {
            continue; // Too small, ignore
          }

          // Auto-upgrade & notify
          const message = plan === "lifetime" 
            ? "🎉 LIFETIME UNLOCKED! ($100) Unlimited protection forever – no more trials!" 
            : "✅ MONTHLY PLAN ACTIVATED! ($20) Unlimited tokens for 30 days";
          await bot.telegram.sendMessage(userId, message);
          console.log(`Auto-upgraded user ${userId} to ${plan} for ${amountSOL} SOL`);
        }
      }
    }
  }

  res.status(200).send("OK");
});

app.listen(3000, () => console.log("Auto-upgrade webhook live on port 3000"));
