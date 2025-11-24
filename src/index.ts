// src/index.ts — FINAL WITH $20 MONTHLY + 0.45 SOL LIFETIME (NOV 2025)
import { Telegraf } from "telegraf";
import { watchToken } from "./rug-monitor.js";
import rugMonitor from "./rug-monitor.js";

const bot = new Telegraf(process.env.BOT_TOKEN!);
export { bot };
export const PAYMENT_WALLET = process.env.PAYMENT_WALLET!;

// ONE AND ONLY USER DATA
export const userData = new Map<
  number,
  { trials: number; plan: "free" | "monthly" | "lifetime"; expires?: number }
>();

rugMonitor.listen(3000, () => console.log("Server running on port 3000"));

bot.start(async (ctx) => {
  await ctx.replyWithMarkdownV2(
    "*WELCOME TO RUGCHEF*\\.\n\n" +
    "Protects you from\\:\n" +
    "• Massive dumps\n" +
    "• LP drains\n" +
    "• Freeze and authority revoke\n\n" +
    "*Pricing*\n" +
    "• Free trial — 2 tokens\n" +
    "• Monthly — *\\$20 USD*\n" +
    "• Lifetime — *0\\.45 SOL* \\(one\\-time\\)\n\n" +
    "Just send any pump\\.fun token address to begin"
  );
});

bot.on("text", async (ctx) => {
  const userId = ctx.from!.id;
  const mint = ctx.message.text.trim();

  if (mint.length < 32 || mint.length > 44) return;

  let user = userData.get(userId) || { trials: 0, plan: "free" };

  // Check monthly expiry
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
      await ctx.replyWithMarkdownV2(`*LIFETIME ACTIVE*\nProtecting \`${short}\``);
    } else if (user.plan === "monthly") {
      await ctx.replyWithMarkdownV2(`*MONTHLY ACTIVE*\nProtecting \`${short}\``);
    } else {
      await ctx.replyWithMarkdownV2(
        `*FREE TRIAL ${user.trials}/2*\n` +
          `Protecting \`${short}\`\n` +
          "One more free • Then choose Monthly ($20) or Lifetime (0.45 SOL)"
      );
    }

    await watchToken(mint, userId);
  } else {
    await ctx.replyWithMarkdownV2(
      "*FREE TRIALS USED (2/2)*\n\n" +
        "*Choose your plan:*\n\n" +
        "*Monthly* — $20 USD / 30 days\n" +
        "*Lifetime* — 0.45 SOL (one-time)\n\n" +
        "Send exactly *0.45 SOL* for lifetime to:\n\n" +
        `\`${PAYMENT_WALLET}\`\n\n` +
        `*Memo*: \`${userId}\`\n\n` +
        "Payment detected instantly • Lifetime activated forever"
    );
  }
});

bot.launch();
console.log("RUGCHEF LIVE — $20 MONTHLY + 0.45 SOL LIFETIME READY");
