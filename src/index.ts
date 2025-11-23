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

// START SERVER FIRST
rugMonitor.listen(Number(process.env.PORT) || 3000, () => {
  console.log("SERVER LIVE — READY FOR HELIUS");
});

// ESCAPE ALL SPECIAL MARKDOWNV2 CHARACTERS
const escapeMD = (text: string) =>
  text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");

bot.start((ctx) =>
  ctx.reply("*RUGCHEF ACTIVE*\nSend any token CA", { parse_mode: "Markdown" })
);

bot.on("text", async (ctx) => {
  const userId = ctx.from!.id;
  const text = ctx.message?.text?.trim();

  if (!text || text.length < 32 || text.length > 44) return;

  let user = userData.get(userId) || { trials: 0, plan: "free", tokens: [] };
  if (user.plan === "monthly" && user.expires && user.expires < Date.now()) user.plan = "free";
  const isPremium = user.plan === "lifetime" || user.plan === "monthly";

  // Quick mint webhook (backup)
  try {
    await helius.createWebhook({
      webhookURL: WEBHOOK_URL,
      transactionTypes: [TransactionType.ANY],
      accountAddresses: [text],
      webhookType: WebhookType.ENHANCED,
    });
    console.log("Quick mint webhook OK");
  } catch (e: any) {
    console.error("Quick webhook failed →", e.response?.data || e.message || e);
  }

  if (isPremium || user.trials < 2) {
    if (!isPremium) user.trials++;
    if (!user.tokens.includes(text)) user.tokens.push(text);
    userData.set(userId, user);

    const short = escapeMD(text.slice(0, 8) + "..." + text.slice(-4));

    await ctx.reply(
      isPremium
        ? `UNLIMITED → \`${short}\``
        : `FREE TRIAL \\#${user.trials}\\/2 → \`${short}\``,
      { parse_mode: "MarkdownV2" }
    );

    console.log(`PROTECTING ${text} — USER ${userId} — TRIAL ${user.trials}/2`);
    await watchToken(text, userId); // ← FULL PROTECTION
  } else {
    await ctx.reply(
      `*FREE TRIALS USED*\n\nSend 0.45 SOL → lifetime\nWallet: \`${PAYMENT_WALLET}\`\nMemo: \`${userId}\``,
      { parse_mode: "Markdown" }
    );
  }
});

bot.launch();
console.log("RUGCHEF 100% LIVE — SEND A CA");
