import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import { watchToken } from "./rug-monitor.js";
import { Helius, TransactionType, WebhookType } from "helius-sdk";
dotenv.config();
import { PublicKey } from "@solana/web3.js";

const bot = new Telegraf(process.env.BOT_TOKEN!);
export { bot };
export const PAYMENT_WALLET = process.env.PAYMENT_WALLET!;

// User storage
export const userData = new Map<number, {
  trials: number;
  plan: "free" | "monthly" | "lifetime";
  expires?: number;
  tokens: string[];
}>();

// Helius instance (used for instant mint watching)
const helius = new Helius(process.env.HELIUS_API_KEY!);

bot.start(async (ctx) => {
  const id = ctx.from!.id;
  if (!userData.has(id)) {
    userData.set(id, { trials: 0, plan: "free", tokens: [] });
  }

  await ctx.reply(
    `*WELCOME TO RUGCHEF*\n\n` +
    `• 2 free tokens\n` +
    `• Monthly → 0.1 SOL ($20)\n` +
    `• Lifetime → 0.45 SOL ($100)\n\n` +
    `*Wallet:* \`${PAYMENT_WALLET}\`\n` +
    `*Memo:* your Telegram ID (from @userinfobot)\n\n` +
    `Send any token CA → I watch dev + LP 24/7`,
    { parse_mode: "Markdown" }
  );
});

bot.on("text", async (ctx) => {
  const id = ctx.from!.id;
  const text = ctx.message?.text?.trim() || "";
  if (text.length < 32 || text.length > 44) return;

  const data = userData.get(id)!;

  // Monthly expiry
  if (data.plan === "monthly" && data.expires && data.expires < Date.now()) {
    data.plan = "free";
  }

  const isPremium = data.plan === "monthly" || data.plan === "lifetime";

  // === INSTANT RUG PROTECTION: Watch the token mint itself IMMEDIATELY ===
  try {
    await helius.createWebhook({
      webhookURL: `${process.env.RAILWAY_STATIC_URL}/rug-alert`,
      transactionTypes: [TransactionType.ANY],
      accountAddresses: [text], // ← This catches dev dumps in <5 seconds
      webhookType: WebhookType.ENHANCED
    });
  } catch (e) { /* ignore duplicate */ }

  if (isPremium) {
    data.tokens.push(text);
    await ctx.reply(`Protected ${text}\nUnlimited plan — FULL monitoring active`);
  } else if (data.trials < 2) {
    data.trials++;
    data.tokens.push(text);
    await ctx.reply(`Free #${data.trials}/2\nNow protecting ${text}\nDev dump → instant alert`);
  } else {
    await ctx.reply(
      `You used 2 free trials\n\n` +
      `Pay to continue:\n` +
      `• 0.1 SOL → Monthly\n` +
      `• 0.45 SOL → Lifetime\n\n` +
      `Wallet: \`${PAYMENT_WALLET}\`\n` +
      `Memo: ${id}`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  // Background: auto-upgrade to full LP/dev monitoring when RugCheck indexes
  watchToken(text, id);
});

bot.launch();
console.log("RugChef bot launched");


// OWNER ONLY — unlimited testing mode
bot.command("admin", async (ctx) => {
  const ownerId = 1319494378; // ← CHANGE THIS TO YOUR REAL TELEGRAM ID (get from @userinfobot)
  if (ctx.from?.id !== ownerId) return;

  const arg = ctx.message?.text?.split(" ")[1];
  if (arg === "unlimited") {
    userData.set(ownerId, { trials: 0, plan: "lifetime", tokens: [], expires: undefined });
    await ctx.reply("Owner unlocked — LIFETIME PREMIUM ACTIVE (unlimited tokens for testing)");
  }
});

// Single Express server (shared port)
import rugMonitor from "./rug-monitor.js";
const PORT = Number(process.env.PORT) || 3000;
rugMonitor.listen(PORT, () => {
  console.log(`RugChef FULLY LIVE on port ${PORT} — Ready to save wallets`);
});
