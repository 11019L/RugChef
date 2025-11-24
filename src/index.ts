import { Telegraf } from "telegraf";
import { watchToken } from "./rug-monitor.js";
import rugMonitor from "./rug-monitor.js";

const bot = new Telegraf(process.env.BOT_TOKEN!);
export { bot };
export const PAYMENT_WALLET = process.env.PAYMENT_WALLET!;

rugMonitor.listen(3000, () => console.log("Server running"));

bot.start(ctx => ctx.reply("Send me any pump.fun token address"));
bot.on("text", async ctx => {
  const mint = ctx.message.text.trim();
  if (mint.length < 32 || mint.length > 44) return;
  await watchToken(mint, ctx.from.id);
  await ctx.reply(`Protecting \`${mint.slice(0,8)}...${mint.slice(-4)}\``, { parse_mode: "Markdown" });
});

bot.launch();
console.log("Bot is live — send a CA");
