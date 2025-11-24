// src/index.ts — FINAL WITH WELCOME + PAYMENT INFO (NOV 2025)
import { Telegraf } from "telegraf";
import { watchToken } from "./rug-monitor.js";
import rugMonitor from "./rug-monitor.js";

const bot = new Telegraf(process.env.BOT_TOKEN!);
export { bot };
export const PAYMENT_WALLET = process.env.PAYMENT_WALLET!;

const userData = new Map<number, { trials: number; plan: "free" | "lifetime" }>();

rugMonitor.listen(3000, () => console.log("Server running"));

bot.start(async (ctx) => {
  await ctx.replyWithMarkdownV2(
    "*WELCOME TO RUGCHEF*\n\n" +
    "Send any pump\\.fun token address and I will protect you from:\n" +
    "• Massive dumps\n" +
    "• LP drains\n" +
    "• Freeze / authority revoke\n\n" +
    "*Free trial*: 2 tokens per user\n" +
    "*Lifetime access*: 0\\.45 SOL"
  );
});

bot.on("text", async (ctx) => {
  const userId = ctx.from!.id;
  const mint = ctx.message.text.trim();

  if (mint.length < 32 || mint.length > 44) return;

  let user = userData.get(userId) || { trials: 0, plan: "free" };

  // Lifetime users = unlimited
  if (user.plan === "lifetime" || user.trials < 2) {
    if (user.plan !== "lifetime") user.trials++;
    userData.set(userId, user);

    const short = mint.slice(0, 8) + "..." + mint.slice(-4);

    if (user.plan === "lifetime") {
      await ctx.replyWithMarkdownV2(`*LIFETIME PROTECTION ACTIVE*\n\`${short}\``);
    } else {
      await ctx.replyWithMarkdownV2(
        `*FREE TRIAL ${user.trials}/2*\nProtecting \`${short}\`\nSend one more for free \\• After that: 0\\.45 SOL lifetime`
      );
    }

    await watchToken(mint, userId);
  } else {
    // Trials used → show payment
    await ctx.replyWithMarkdownV2(
      "*FREE TRIALS USED \\(2/2\\)*\n\n" +
      "*Unlock lifetime protection*\n" +
      "Send exactly *0\\.45 SOL* to:\n\n" +
      `\`${PAYMENT_WALLET}\`\n\n` +
      "*Memo / Message*: \`${userId}\`\n\n" +
      "Payment detected automatically \\• Instant lifetime access"
    );
  }
});

bot.launch();
console.log("RUGCHEF LIVE — SEND A TOKEN");
