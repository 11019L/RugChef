// src/index.ts — FINAL VERSION THAT ACTUALLY WORKS (NOV 2025)
import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import { watchToken } from "./rug-monitor.js";
import rugMonitor from "./rug-monitor.js";
import { Helius, TransactionType, WebhookType } from "helius-sdk";

dotenv.config();

// FORCE LOGS + TIMESTAMPS
console.log = (...args: any[]) => {
  process.stdout.write(`${new Date().toISOString()} ${args.join(" ")}\n`);
};

// WEBHOOK URL
export const WEBHOOK_URL = (() => {
  const base = process.env.RAILWAY_STATIC_URL || `https://${process.env.RAILWAY_APP_NAME}.up.railway.app`;
  if (!base || base.includes("undefined")) {
    console.error("FATAL: Set RAILWAY_STATIC_URL in Railway variables!");
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

// START SERVER
rugMonitor.listen(Number(process.env.PORT) || 3000, () => {
  console.log("SERVER LIVE");
});

// ESCAPE FUNCTION FOR MARKDOWNV2
const escape = (text: string) => text
  .replace(/[_*[\]()`~>#+=|{}.!-]/g, "\\$&");

bot.start((ctx) => ctx.reply("*RUGCHEF ACTIVE*\nSend any token CA", { parse_mode: "Markdown" }));

bot.on("text", async (ctx) => {
  const userId = ctx.from!.id;
  const text = ctx.message?.text?.trim();

  if (!text || text.length < 32 || text.length > 44) return;

  let user = userData.get(userId) || { trials: 0, plan: "free", tokens: [] };
  if (user.plan === "monthly" && user.expires && user.expires < Date.now()) user.plan = "free";
  const isPremium = user.plan === "lifetime" || user.plan === "monthly";

  // QUICK MINT WEBHOOK
  try {
    await helius.createWebhook({
      webhookURL: WEBHOOK_URL,
      transactionTypes: [TransactionType.ANY],
      accountAddresses: [text],
      webhookType: WebhookType.ENHANCED,
    });
    console.log("Quick mint webhook created");
  } catch (e: any) {
    console.error("MINT WEBHOOK FAILED:");
    if (e.response?.data) {
      console.error("Helius says:", JSON.stringify(e.response.data, null, 2));
    } else {
      console.error("Error:", e.message || e);
    }
  }

  if (isPremium || user.trials < 2) {
    if (!isPremium) user.trials++;
    if (!user.tokens.includes(text)) user.tokens.push(text);
    userData.set(userId, user);

    const short = escape(text.slice(0,8) + "..." + text.slice(-4));

    await ctx.reply(
      isPremium
        ? `UNLIMITED → \`${short}\``
        : `FREE TRIAL \\#${user.trials}\\/2 → \`${short}\``,
      { parse_mode: "MarkdownV2" }
    );

    console.log(`PROTECTING ${text} — TRIAL ${user.trials}/2`);
    await watchToken(text, userId); // ← full protection + logs

  } else {
    await ctx.reply(
      `*FREE TRIALS USED*\n\n` +
      `Send 0.45 SOL → lifetime\n` +
      `Wallet: \`${PAYMENT_WALLET}\`\n` +
      `Memo: \`${userId}\``,
      { parse_mode: "Markdown" }
    );
  }
});

bot.launch();
console.log("RUGCHEF 100% LIVE — SEND A CA");
