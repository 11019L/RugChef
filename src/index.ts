// src/index.ts — FINAL VERSION THAT ACTUALLY WORKS (LOGS + FULL PROTECTION)
import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import { watchToken } from "./rug-monitor.js";
import rugMonitor from "./rug-monitor.js";
import { Helius, TransactionType, WebhookType } from "helius-sdk";

dotenv.config();

// FORCE LOGS TO APPEAR ON RAILWAY (this is the #1 fix)
process.env.FORCE_COLOR = "1";
const originalLog = console.log;
console.log = (...args: any[]) => {
  originalLog(new Date().toISOString(), ...args);
  process.stdout.write("\n");
};

// WEBHOOK URL — auto-fix for Railway/Render
export const WEBHOOK_URL = (() => {
  const base =
    process.env.RAILWAY_STATIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    `https://${process.env.RAILWAY_APP_NAME}.up.railway.app`;

  if (!base || base.includes("undefined")) {
    console.error("FATAL: Add RAILWAY_STATIC_URL in Railway variables!");
    process.exit(1);
  }
  const url = `${base.replace(/\/$/, "")}/rug-alert`;
  console.log("WEBHOOK URL →", url);
  return url;
})();

const bot = new Telegraf(process.env.BOT_TOKEN!);
export { bot };
export const PAYMENT_WALLET = process.env.PAYMENT_WALLET!;

export const userData = new Map<number, any>();

const helius = new Helius(process.env.HELIUS_API_KEY!);

// START SERVER FIRST
rugMonitor.listen(Number(process.env.PORT) || 3000, () => {
  console.log("SERVER LIVE — READY FOR WEBHOOKS");
});

// BOT LOGIC
bot.start((ctx) => ctx.reply("*RUGCHEF ACTIVE*\nSend any token CA", { parse_mode: "Markdown" }));

bot.on("text", async (ctx) => {
  const userId = ctx.from!.id;
  const text = ctx.message?.text?.trim();

  if (!text || text.length < 32 || text.length > 44) return;

  let user = userData.get(userId) || { trials: 0, plan: "free", tokens: [] };
  if (user.plan === "monthly" && user.expires && user.expires < Date.now()) user.plan = "free";

  const isPremium = user.plan === "lifetime" || user.plan === "monthly";

  // Quick backup webhook
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
        ? `UNLIMITED → \`${short}\``
        : `FREE TRIAL \\#${user.trials}/2 → \`${short}\``,
      { parse_mode: "MarkdownV2" }
    );

    console.log(`USER ${userId} ADDED ${text} — TRIAL ${user.trials}/2`);
    console.log("CALLING watchToken() NOW...");

    // THIS IS THE LINE THAT MAKES EVERYTHING WORK
    await watchToken(text, userId);   // ← awaited = logs + full protection

  } else {
    await ctx.reply(`*FREE TRIALS USED*\n\nSend 0.45 SOL → lifetime\nWallet: \`${PAYMENT_WALLET}\`\nMemo: \`${userId}\``, { parse_mode: "Markdown" });
  }
});

bot.launch();
console.log("BOT LIVE — SEND A CA TO TEST");
