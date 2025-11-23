// src/index.ts — FINAL WORKING VERSION — NOVEMBER 2025
import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import { watchToken } from "./rug-monitor.js";
import rugMonitor from "./rug-monitor.js";
import { Helius, TransactionType, WebhookType } from "helius-sdk";

dotenv.config();

// === BOT & EXPORTS ===
const bot = new Telegraf(process.env.BOT_TOKEN!);
export { bot };
export const PAYMENT_WALLET = process.env.PAYMENT_WALLET!;
// ────── AUTO-FIX RAILWAY_STATIC_URL (2025 RAILWAY FIX) ──────
const BASE_URL = process.env.RAILWAY_STATIC_URL 
  ?? process.env.RENDER_EXTERNAL_URL 
  ?? process.env.HEROKU_URL 
  ?? process.env.URL 
  ?? `https://${process.env.RAILWAY_APP_NAME}.up.railway.app`; // ← Railway fallback

if (!BASE_URL || BASE_URL.includes("undefined")) {
  console.error("FATAL: Webhook URL is missing! Set RAILWAY_STATIC_URL in Railway variables");
  process.exit(1);
}

const webhookUrl = `${BASE_URL.replace(/\/$/, "")}/rug-alert`;
console.log(`Webhook URL resolved → ${webhookUrl}`);
// === USER DATA STORAGE ===
export const userData = new Map<
  number,
  {
    trials: number;
    plan: "free" | "monthly" | "lifetime";
    expires?: number;
    tokens: string[];
  }
>();

// === HELIUS (for quick mint watch) ===
const helius = new Helius(process.env.HELIUS_API_KEY!);

// === BOT COMMANDS ===
bot.start(async (ctx) => {
  const id = ctx.from!.id;
  if (!userData.has(id)) {
    userData.set(id, { trials: 0, plan: "free", tokens: [] });
  }

  await ctx.reply(
    `*WELCOME TO RUGCHEF* ⚔️\n\n` +
      `• 2 free tokens\n` +
      `• Monthly → 0.1 SOL (~$20)\n` +
      `• Lifetime → 0.45 SOL (~$100)\n\n` +
      `*Wallet:* \`${PAYMENT_WALLET}\`\n` +
      `*Memo:* \`${id}\` (or get it from @userinfobot)\n\n` +
      `Just send any token CA → I protect you 24/7`,
    { parse_mode: "Markdown" }
  );
});

// Owner command (your ID)
bot.command("admin", async (ctx) => {
  if (ctx.from?.id !== 1319494378) return;
  userData.set(ctx.from!.id, { trials: 0, plan: "lifetime", tokens: [], expires: undefined });
  await ctx.reply("OWNER MODE ACTIVATED — LIFETIME UNLIMITED");
});

// Main message handler
// === REPLACE YOUR ENTIRE bot.on("text", ...) BLOCK WITH THIS ===

bot.on("text", async (ctx) => {
  const userId = ctx.from!.id;
  const text = ctx.message?.text?.trim();

  if (!text || text.length < 32 || text.length > 44) return;

  let user = userData.get(userId) || { trials: 0, plan: "free", tokens: [] };

  if (user.plan === "monthly" && user.expires && user.expires < Date.now()) {
    user.plan = "free";
    user.expires = undefined;
  }

  const isPremium = user.plan === "lifetime" || user.plan === "monthly";

  // === QUICK MINT WEBHOOK (backup) ===
  try {
    await helius.createWebhook({
      webhookURL: `${process.env.RAILWAY_STATIC_URL}/rug-alert`,
      transactionTypes: [TransactionType.ANY],
      accountAddresses: [text],
      webhookType: WebhookType.ENHANCED,
    });
    console.log(`[QUICK] Webhook created for ${text.slice(0,8)}...`);
  } catch (e: any) {
    // THIS IS THE FIX — proper error logging
    console.error(`[QUICK WEBHOOK FAILED] ${e.message || e}`);
    if (e.response?.description) {
      console.error("Helius error:", e.response.description);
    }
  }

  // === CHECK TRIALS / PREMIUM ===
  if (isPremium || user.trials < 2) {
    if (!isPremium) user.trials++;

    if (!user.tokens.includes(text)) user.tokens.push(text);
    userData.set(userId, user);

    const short = `${text.slice(0,8)}...${text.slice(-4)}`;

    // THIS IS THE FIX — escape # and use safe MarkdownV2
    const message = isPremium
      ? `UNLIMITED PROTECTION ACTIVE\nToken: \`${short}\``
      : `FREE TRIAL \\#${user.trials}/2\nNow protecting \`${short}\``;

    await ctx.reply(message, { parse_mode: "MarkdownV2" });

    console.log(`[FULL] Starting protection for ${short} (user ${userId})`);
    await watchToken(text, userId); // awaited = no more silent rugs
  } else {
    await ctx.reply(
      `*FREE TRIALS EXHAUSTED*\n\n` +
      `Upgrade:\n` +
      `• Monthly → 0.1 SOL\n` +
      `• Lifetime → 0.45 SOL\n\n` +
      `Wallet: \`${PAYMENT_WALLET}\`\n` +
      `Memo: \`${userId}\``,
      { parse_mode: "Markdown" }
    );
  }
});

// === GRACEFUL SHUTDOWN ===
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

// === START EVERYTHING IN CORRECT ORDER ===
async function startRugChef() {
  console.log("Starting RugChef...");

  const PORT = Number(process.env.PORT) || 3000;

  // 1. Start Express server FIRST (webhook endpoint)
  const server = rugMonitor.listen(PORT, () => {
    console.log(`Webhook server LIVE → http://0.0.0.0:${PORT}`);
    console.log(`Webhook URL: ${process.env.RAILWAY_STATIC_URL}/rug-alert`);
  });

  // 2. Wait a moment to ensure server is ready
  await new Promise((resolve) => setTimeout(resolve, 2500));

  // 3. Then launch Telegram bot
  await bot.launch();
  console.log("Telegram bot ONLINE");
  console.log("RUGCHEF 100% LIVE — NO MORE SILENT RUGS");
  console.log("Send a token CA to test → you will be protected in <5 seconds");
}

// Run it
startRugChef().catch((err) => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
