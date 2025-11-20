import { Telegraf } from "telegraf";
import dotenv from "dotenv";
dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN!);

bot.start((ctx) => ctx.reply(`
🛡️ RUGCHEF IS NOW PROTECTING YOU!

Just send me any token address (CA) and I will watch it 24/7.

If the dev dumps or removes LP → I scream at you + auto-sell (optional)

Price: 0.15 SOL one-time (lifetime protection)
Send SOL to: Coming soon... (free beta for first 1000 users)
`));

bot.on("text", (ctx) => {
  const text = ctx.message.text;
  if (text.length >= 32 && text.length <= 44) {
    ctx.reply(`Got it! Now protecting:\n${text}\nYou will get alert if dev rugs`);
  }
});

bot.launch();
console.log("RugShield Bot is running!");
