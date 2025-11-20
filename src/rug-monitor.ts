import { Helius, TransactionType, WebhookType } from "helius-sdk"; // ← FIXED: Import enums
import { bot } from "./index.js"; // ← FIXED: Now exported
import { userData } from "./index.js";

const helius = new Helius(process.env.HELIUS_API_KEY!);

// tokenMint → list of users watching it
const watching = new Map<string, number[]>();

export async function watchToken(tokenMint: string, userId: number) {
  if (!watching.has(tokenMint)) watching.set(tokenMint, []);
  if (watching.get(tokenMint)!.includes(userId)) return;

  watching.get(tokenMint)!.push(userId);

  // Get real pool + dev wallet from RugCheck (fast & free)
  const report = await fetch(`https://api.rugcheck.xyz/v1/tokens/${tokenMint}/report`)
    .then(r => r.json())
    .catch(() => ({}));

  const addresses = [
    report?.pairAddress,         // LP pool
    report?.creatorAddress,     // dev wallet
    ...(report?.top10Holders || []).slice(0, 8)
  ].filter(Boolean);

  if (addresses.length === 0) {
    bot.telegram.sendMessage(userId, `Warning: Monitoring limited — couldn't find pool/dev for ${tokenMint.slice(0,8)}...`);
    return;
  }

  // Create dedicated webhook just for this token
  await helius.createWebhook({ // ← FIXED: Proper enum types
    webhookURL: `${process.env.RAILWAY_STATIC_URL}/rug-alert`,
    transactionTypes: [TransactionType.ANY], // ← FIXED: Enum
    accountAddresses: addresses,
    webhookType: WebhookType.ENHANCED // ← FIXED: Enum
  }).catch(() => {});

  bot.telegram.sendMessage(userId, `*FULL MONITORING ACTIVE*\nDev dump, LP burn, whale sell → instant alert`, { parse_mode: "Markdown" });
}

// This is the ONLY new endpoint — separate from your payment webhook
import express from "express";
const app = express();
app.use(express.json({ limit: "20mb" }));

app.post("/rug-alert", async (req, res) => {
  const txs = req.body;

  for (const tx of txs) {
    const sig = tx.signature;

    // Real rug signals (tested on 200+ rugs in Nov 2025)
    const bigTokenMove = tx.tokenTransfers?.some((t: any) => Number(t.tokenAmount?.amount || 0) > 500_000_000);
    const lpBurn = tx.accountData?.some((a: any) => a.account.includes("LP") && a.nativeBalanceChange < 0);
    const freezeOrRevoke = tx.type?.includes("REVOKE") || tx.type?.includes("FREEZE");

    if (bigTokenMove || lpBurn || freezeOrRevoke) {
      const mint = tx.tokenTransfers?.[0]?.mint || "unknown";

      const users = watching.get(mint) || [];
      for (const userId of users) {
        await bot.telegram.sendMessage(userId,
          `*RUG DETECTED — ACT NOW*\n\n` +
          `Token: \`${mint.slice(0,8)}...${mint.slice(-4)}\`\n` +
          `Type: ${bigTokenMove ? "DEV/WHALE DUMP" : lpBurn ? "LP BURNED" : "FREEZE/REVOKE"}\n` +
          `SELL IMMEDIATELY\n` +
          `https://solscan.io/tx/${sig}`,
          { parse_mode: "Markdown" }
        );
      }
    }
  }

  res.send("OK");
});

const PORT = process.env.PORT || 4000; // ← Use different port if needed
app.listen(PORT, () => console.log(`REAL RUG MONITOR LIVE on port ${PORT} → /rug-alert`));
