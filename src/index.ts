// src/index.ts — FINAL WORKING VERSION (NOVEMBER 2025)
import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import { watchToken } from "./rug-monitor.js";
import rugMonitor from "./rug-monitor.js";
import { Helius } from "helius-sdk";

dotenv.config();

// FORCE LOGS TO SHOW ON RAILWAY
const originalLog = console.log;
console.log = (...args: any[]) => {
  originalLog(...args);
  process.stdout.write("\n");
};

// AUTO-FIX WEBHOOK URL — shared with rug-monitor.ts
export const WEBHOOK_URL = (() => {
  const base =
    process.env.RAILWAY_STATIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    `https://${process.env.RAILWAY_APP_NAME}.up.railway.app`;

  if (!base || base.includes("undefined")) {
    console.error("FATAL: Set RAILWAY_STATIC_URL in Railway variables!");
    console.error("Go to Settings → Variables → Add: RAILWAY_STATIC_URL = https://your-bot.up.railway.app");
    process.exit(1);
  }

  const url = `${base.replace(/\/$/, "")}/rug-alert`;
  console.log(`WEBHOOK URL → ${url}`);
  return url;
})();

const bot = new Telegraf(process.env.BOT_TOKEN!);
export { bot };
export const PAYMENT_WALLET = process.env.PAYMENT_WALLET!;

export const userData = new Map<number, {
  trials: number;
  plan: "free" | "monthly" | "lifetime";
  expires?: number;
  tokens: string[];
}>();

const helius = new Helius(process.env.HELIUS_API_KEY!);

// === START SERVER FIRST ===
const PORT = Number(process.env.PORT) || 3000;
rugMonitor.listen(PORT, () => {
  console.log(`RUG MONITOR SERVER LIVE ON PORT ${PORT}`);
  console.log(`WEBHOOK ENDPOINT: ${WEBHOOK_URL}`);
});

// === BOT COMMANDS ===
bot.start(async (ctx) => {
  const id = ctx.from!.id;
  if (!userData.has(id)) {
    userData.set(id, { trials: 0, plan: "free", tokens: [] });
  }
  await ctx.reply(
    `*RUGCHEF — NEVER GET RUGGED AGAIN*\n\n` +
    `• 2 free tokens\n` +
    `• Monthly → 0.1 SOL\n` +
    `• Lifetime → 0.45 SOL\n\n` +
    `Just send any token CA`,
    { parse_mode: "Markdown" }
  );
});

// === MAIN MESSAGE HANDLER — THIS IS WHERE THE MAGIC HAPPENS ===
bot.on("text", async (ctx) => {
  const userId = ctx.from!.id;
  const text = ctx.message?.text?.trim();

  if (!text || text.length < 32 || text.length > 44) return;

  let user = userData.get(userId) || { trials: 0, plan: "free", tokens: [] };

  if (user.plan === "monthly" && user.expires && user.expires < Date.now()) {
    user.plan = "free";
  }

  const isPremium = user.plan === "lifetime" || user.plan === "monthly";

  // Quick mint webhook (backup)
  try {
    await helius.createWebhook({
      webhookURL: WEBHOOK_URL,
      transactionTypes: [TransactionType.ANY],
      accountAddresses: [text],
      webhookType: WebhookType.ENHANCED,
    });
  } catch {}

  if (isPremium || user.trials < 2) {
    if (!isPremium) user.trials++;
    if (!user.tokens.includes(text)) user.tokens.push(text);
    userData.set(userId, user);

    const short = `${text.slice(0,8)}...${text.slice(-4)}`;

    await ctx.reply(
      isPremium
        ? `UNLIMITED PROTECTION ACTIVE\nToken: \`${short}\``
        : `FREE TRIAL \\#${user.trials}/2\nNow protecting \`${short}\``,
      { parse_mode: "MarkdownV2" }
    );

    // THIS IS THE FINAL FIX — await the real protection
    console.log(`STARTING FULL PROTECTION FOR ${text} (user ${userId})`);
    await watchToken(text, userId);  // ← NOW AWAITED → logs will show

  } else {
    await ctx.reply(
      `*FREE TRIALS USED*\n\n` +
      `Upgrade to lifetime:\n` +
      `• 0.45 SOL\n` +
      `Wallet: \`${PAYMENT_WALLET}\`\n` +
      `Memo: \`${userId}\``,
      { parse_mode: "Markdown" }
    );
  }
});

// === LAUNCH BOT ===
bot.launch();
console.log("TELEGRAM BOT LIVE");
console.log("RUGCHEF 100% ACTIVE — SEND A TOKEN CA TO TEST");
