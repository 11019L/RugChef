// src/index.ts — FINAL WITH WALLET IN WELCOME (HTML VERSION)
import { Telegraf } from "telegraf";
import { watchToken } from "./rug-monitor.js";
import rugMonitor from "./rug-monitor.js";

const bot = new Telegraf(process.env.BOT_TOKEN!);
export { bot };
export const PAYMENT_WALLET = process.env.PAYMENT_WALLET!;

export const userData = new Map<
  number,
  { trials: number; plan: "free" | "monthly" | "lifetime"; expires?: number }
>();

rugMonitor.listen(3000, () => console.log("Server running"));

bot.start(async (ctx) => {
  await ctx.reply(
    `<b>WELCOME TO RUGCHEF</b>\n\n` +
    `Real-time protection from:\n` +
    `• Massive dumps\n` +
    `• LP drains\n` +
    `• Freeze / authority revoke\n\n` +
    `<b>Pricing:</b>\n` +
    `• Free trial — 2 tokens\n` +
    `• Monthly — <b>$20 USD</b>\n` +
    `• Lifetime — <b>0.45 SOL</b> (one-time)\n\n` +
    `<b>Payment wallet:</b>\n` +
    `<code>${PAYMENT_WALLET}</code>\n\n` +
    `Send any pump.fun token to begin`,
    { parse_mode: "HTML" }
  );
});

bot.on("text", async (ctx) => {
  const userId = ctx.from!.id;
  const mint = ctx.message.text.trim();

  if (mint.length < 32 || mint.length > 44) return;

  let user = userData.get(userId) || { trials: 0, plan: "free" };

  if (user.plan === "monthly" && user.expires && user.expires < Date.now()) {
    user.plan = "free";
    user.trials = 0;
  }

  const isPaid = user.plan === "lifetime" || user.plan === "monthly";

  if (isPaid || user.trials < 2) {
    if (!isPaid) user.trials++;
    userData.set(userId, user);

    const short = mint.slice(0, 8) + "..." + mint.slice(-4);

    if (user.plan === "lifetime") {
      await ctx.reply(`<b>LIFETIME ACTIVE</b>\nProtecting <code>${short}</code>`, { parse_mode: "HTML" });
    } else if (user.plan === "monthly") {
      await ctx.reply(`<b>MONTHLY ACTIVE</b>\nProtecting <code>${short}</code>`, { parse_mode: "HTML" });
    } else {
      await ctx.reply(
        `<b>FREE TRIAL ${user.trials}/2</b>\n` +
        `Protecting <code>${short}</code>\n` +
        `One more free • Then send 0.45 SOL to\n<code>${PAYMENT_WALLET}</code>`,
        { parse_mode: "HTML" }
      );
    }

    await watchToken(mint, userId);
  } else {
    await ctx.reply(
      `<b>FREE TRIALS USED (2/2)</b>\n\n` +
      `<b>Unlock lifetime protection</b>\n` +
      `Send exactly <b>0.45 SOL</b> to:\n\n` +
      `<code>${PAYMENT_WALLET}</code>\n\n` +
      `<b>Memo / Message:</b> <code>${userId}</code>\n\n` +
      `Payment detected instantly • Lifetime activated forever`,
      { parse_mode: "HTML" }
    );
  }
});

bot.launch();
console.log("RUGCHEF LIVE — WALLET SHOWN FROM /start");
