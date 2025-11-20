import { Telegraf } from "telegraf";
import dotenv from "dotenv";
dotenv.config();
import { watchToken } from "./rug-monitor.js";
// ... inside your text handler, after they are allowed to protect:
watchToken(text, ctx.from!.id);

const bot = new Telegraf(process.env.BOT_TOKEN!);

// CHANGE THIS TO YOUR REAL SOL WALLET
export const PAYMENT_WALLET = process.env.PAYMENT_WALLET!;

// Store user data (shared with webhook)
export const userData = new Map<number, {
  trials: number;
  plan: "free" | "monthly" | "lifetime";
  expires?: number;
}>();

bot.start(async (ctx) => {
  const userId = ctx.from!.id;
  if (!userData.has(userId)) {
    userData.set(userId, { trials: 0, plan: "free" });
  }

  await ctx.reply(
    `*WELCOME TO RUGCHEF*\n\n` +
    `You get *2 free token protections* right now.\n\n` +
    `After that:\n` +
    `• Monthly → $20 or 0.1 SOL\n` +
    `• Lifetime → $100 or 0.45 SOL (best value)\n\n` +
    `*Payment wallet (SOL):*\n` +
    `\`${PAYMENT_WALLET}\`\n\n` +
    `*VERY IMPORTANT:*\n` +
    `When paying, write your Telegram ID in the memo\n` +
    `→ Get your ID from @userinfobot\n\n` +
    `Just send any token address (CA) below and I start watching!`,
    { parse_mode: "Markdown" }
  );
});

bot.on("text", (ctx) => {
  const userId = ctx.from!.id;
  const text = ctx.message?.text?.trim() || "";
  const data = userData.get(userId)!;

  // Check monthly expiry
  if (data.plan === "monthly" && data.expires! < Date.now()) {
    data.plan = "free";
    data.expires = undefined;
  }

  // Detect token CA
  if (text.length >= 32 && text.length <= 44) {
    if (data.plan === "monthly" || data.plan === "lifetime") {
      return ctx.reply(`Protected ${text}\nYou are ${data.plan.toUpperCase()} — unlimited tokens!`);
    }

    if (data.trials < 2) {
      data.trials += 1;
      userData.set(userId, data);
      ctx.reply(`Free protection #${data.trials}/2 activated!\nNow watching ${text}`);
    } else {
      ctx.replyWithMarkdownV2(`
You used your 2 free trials

*Pay to continue:*
• Monthly → 0.1 SOL  
• Lifetime → 0.45 SOL  

*Wallet:* \`${PAYMENT_WALLET}\`  
*Memo:* your Telegram ID (from @userinfobot)

Payment detected → auto-upgrade in <10 seconds
      `);
    }
  }
});

// Optional status
bot.command("plan", (ctx) => {
  const d = userData.get(ctx.from!.id)!;
  const status = d.plan === "free" ? `Free (${d.trials}/2 used)` :
                 d.plan === "monthly" ? `Monthly (expires ${new Date(d.expires!).toDateString()})` :
                 "LIFETIME";
  ctx.reply(`Your plan: ${status}`);
});

bot.launch();
console.log("RugShield Bot is LIVE!");
