// src/index.ts — FINAL QUICKNODE VERSION (NOV 2025)
import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import { watchToken } from "./rug-monitor.js";
import rugMonitor from "./rug-monitor.js";

dotenv.config();

console.log = (...args: any[]) => {
  process.stdout.write(`${new Date().toISOString()} ${args.join(" ")}\n`);
};

const bot = new Telegraf(process.env.BOT_TOKEN!);
export { bot };
export const PAYMENT_WALLET = process.env.PAYMENT_WALLET!;

export const userData = new Map<number, any>();

// QUICKNODE RPC & API KEY VALIDATION
if (!process.env.QUICKNODE_RPC_URL || !process.env.QUICKNODE_API_KEY) {
  console.error("FATAL: QUICKNODE_RPC_URL and QUICKNODE_API_KEY required in Railway variables!");
  process.exit(1);
}
console.log("QUICKNODE READY — RPC:", process.env.QUICKNODE_RPC_URL.slice(0, 50) + "...");

// ESCAPE MARKDOWNV2
const escapeMD = (text: string) => text.replace(/[_*\[\]()~`>#+=|{}.!-]/g, "\\$&");

// QUICKNODE WEBHOOK CREATION (direct REST API)
async function createQNWebhook(addresses: string[]) {
  const response = await fetch("https://api.quicknode.com/webhooks/rest/v1/webhooks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.QUICKNODE_API_KEY!,
    },
    body: JSON.stringify({
      name: `RugShield-${addresses[0].slice(0,8)}`,
      network: "solana-mainnet",
      destination_attributes: {
        url: WEBHOOK_URL,
        compression: "none",
      },
      status: "active",
      // Basic filter for transactions (rug events)
      filter_function: Buffer.from(`
        function main(payload) {
          return payload; // Pass all txs — filter in bot
        }
      `).toString("base64"),
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error("QUICKNODE WEBHOOK FAILED →", JSON.stringify(data, null, 2));
    throw new Error(JSON.stringify(data));
  }
  console.log("QUICKNODE WEBHOOK CREATED →", data.id);
  return data.id;
}

// START SERVER
rugMonitor.listen(Number(process.env.PORT) || 3000, () => {
  console.log("SERVER LIVE — READY FOR QUICKNODE WEBHOOKS");
});

bot.start((ctx) => ctx.reply("*RUGCHEF ACTIVE*\nSend any token CA", { parse_mode: "Markdown" }));

bot.on("text", async (ctx) => {
  const userId = ctx.from!.id;
  const text = ctx.message?.text?.trim();

  if (!text || text.length < 32 || text.length > 44) return;

  let user = userData.get(userId) || { trials: 0, plan: "free", tokens: [] };
  if (user.plan === "monthly" && user.expires && user.expires < Date.now()) user.plan = "free";
  const isPremium = user.plan === "lifetime" || user.plan === "monthly";

  // QUICKNODE MINT WEBHOOK (no Helius)
  try {
    await createQNWebhook([text]);
    console.log("QUICKNODE MINT WEBHOOK → SUCCESS");
  } catch (e: any) {
    console.error("QUICKNODE MINT FAILED →", e.message);
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
    await watchToken(text, userId); // Full protection
  } else {
    await ctx.reply(
      `*FREE TRIALS USED*\n\nSend 0.45 SOL → lifetime\nWallet: \`${PAYMENT_WALLET}\`\nMemo: \`${userId}\``,
      { parse_mode: "Markdown" }
    );
  }
});

bot.launch();
console.log("RUGCHEF 100% LIVE ON QUICKNODE — SEND A CA");
