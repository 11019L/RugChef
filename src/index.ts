import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import { watchToken } from "./rug-monitor.js";
dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN!);
export { bot }; // ← FIXED: Export for rug-monitor
export const PAYMENT_WALLET = process.env.PAYMENT_WALLET!;

// User storage
export const userData = new Map<number, {
  trials: number;
  plan: "free" | "monthly" | "lifetime";
  expires?: number;
  tokens: string[];
}>();

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

bot.on("text", async (ctx) => { // ← FIXED: Proper scope for 'text' and 'ctx'
  const id = ctx.from!.id;
  const text = ctx.message?.text?.trim() || ""; // ← FIXED: 'text' defined here
  const data = userData.get(id)!;

  if (text.length < 32 || text.length > 44) return;

  // Monthly expiry
  if (data.plan === "monthly" && data.expires! < Date.now()) {
    data.plan = "free";
  }

  if (data.plan === "monthly" || data.plan === "lifetime") {
    data.tokens.push(text);
    await ctx.reply(`Protected ${text}\nUnlimited plan — full monitoring active`);
    watchToken(text, id); // ← Start monitoring
    return;
  }

  if (data.trials < 2) {
    data.trials++;
    data.tokens.push(text);
    await ctx.reply(`Free #${data.trials}/2\nNow protecting ${text}`);
    watchToken(text, id); // ← Start monitoring
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
  }
});

bot.launch();
console.log("RugShield FULLY LIVE");

import rugMonitor from "./rug-monitor.js";

const PORT = process.env.PORT || 3000;
rugMonitor.listen(PORT, "0.0.0.0", () => {
  console.log(`Rug monitor + main bot running on port ${PORT}`);
});
