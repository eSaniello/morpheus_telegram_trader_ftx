const FTXRest = require('ftx-api-rest');
const TelegramBot = require('node-telegram-bot-api');
const CONFIG = require('./config/config');
const HELPER = require('./services/helper.service');
const FTX = require('./services/ftx.service');
const express = require("express")
const dotenv = require('dotenv');
dotenv.config();

const app = express()
// To parse the incoming requests with JSON payloads
app.use(express.urlencoded({ extended: true }))
// handle content type text/plain and text/json
app.use(express.text())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.json()) // To parse the incoming requests with JSON payloads


const token = `${process.env.TELEGRAM_API_SECRET}`;
// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, { polling: true });
bot.on("polling_error", (msg) => console.log(msg));
bot.on('message', async (msg) => {
    // get ID from the one who chats
    const chatId = msg.chat.id;
    let text = msg.text ? msg.text : '';

    // make the connection with the user credentials
    const API_CONNECTION = new FTXRest({
        key: `${process.env.FTX_API_KEY}`,
        secret: `${process.env.FTX_API_SECRET}`
    });

    if (HELPER.checkText(text, 'info')) {
        bot.sendMessage(chatId, `Hello ${msg.from.first_name} 👋,
What can I 😎 do for you?

/info - Info about the bot
/balance - Get account balance
/open - Get open orders
/buy - Create a buy / long order with a percentage size of account and stoploss [eg. /buy btc 2 52000]
/sell - Create a sell / short order with a percentage size of account and stoploss [eg. /sell 2 btc 55000]
/close - Close all open orders [for specific pair /close eth]
/alert - Forward TV alerts to this chat/chatroom`);
    }

    if (HELPER.checkText(text, 'buy') || HELPER.checkText(text, 'sell') || HELPER.checkText(text, 'long') || HELPER.checkText(text, 'short')) {
        text = text.replace('long', 'buy');
        text = text.replace('short', 'sell');

        let order = text.split(' ');
        // only exec when there's a pair given
        if (order[1]) {
            // create the order
            let side = order[0].replace('/', '').replace(CONFIG.BOTNAME, '');
            let pair = HELPER.convertString(order[1]);

            let accountInfo = await FTX.getBalance(API_CONNECTION);
            let entry = await FTX.getPrice(API_CONNECTION, pair);
            let risk = order[2];
            let sl = order[3];
            let account_size = accountInfo.collateral;
            let pos_size = 0;
            if (side == 'buy')
                pos_size = (account_size * (risk * 0.01)) / (entry - sl); //buy
            else if (side == 'sell')
                pos_size = (account_size * (risk * 0.01)) / (sl - entry); //sell

            if (pos_size != 0) {
                API_CONNECTION.request({
                    method: 'POST',
                    path: '/orders',
                    data: {
                        market: pair,
                        size: pos_size,
                        side: side,
                        type: 'market',
                        price: null
                    }
                }).then(async () => {
                    API_CONNECTION.request({
                        method: 'POST',
                        path: '/conditional_orders',
                        data: {
                            market: pair,
                            side: side == 'buy' ? 'sell' : 'buy',
                            type: 'stop',
                            size: pos_size,
                            triggerPrice: sl,
                            orderPrice: sl,
                            retryUntilFilled: true
                        }
                    }).then(async () => {
                        bot.sendMessage(chatId, `✅ ${side.toUpperCase()} $${(pos_size).toFixed(5)} ${pair} @ $${entry} with SL @ $${sl}`);
                        bot.sendAnimation(chatId, './assets/degen_mode.mp4');
                    }).catch(res => bot.sendMessage(chatId, `❌ ${res}`));
                }).catch(res => bot.sendMessage(chatId, `❌ ${res}`));
            } else {
                bot.sendMessage(chatId, `❌ Error calculating position size ser`);
            }
        } else {
            bot.sendMessage(chatId, 'Niffo niffoooo, I need more info 😒');
        }
    }

    if (HELPER.checkText(text, 'balance')) {
        let accountInfo = await FTX.getBalance(API_CONNECTION);
        bot.sendMessage(chatId, `
::Balance::
Collateral: $${(accountInfo.collateral).toFixed(2)}
Account Value: $${(accountInfo.totalAccountValue).toFixed(2)}
Margin Fraction: ${(accountInfo.marginFraction * 100).toFixed(2)}%
TotalPositionSize: $${(accountInfo.totalPositionSize).toFixed(2)}
Leverage: ${accountInfo.leverage}`);
    }

    if (HELPER.checkText(text, 'open')) {
        let orders = await FTX.openOrders(API_CONNECTION);
        if (orders.length > 0) {
            bot.sendMessage(chatId, `::Open Orders::`);
            orders.forEach(async order => {
                let price = await FTX.getPrice(API_CONNECTION, order.future);
                bot.sendMessage(chatId, `
${order.side.toUpperCase()} ${order.future}
Funding Rate: ${await FTX.fundingRate(API_CONNECTION, order.future)}

AvgPrice: $${order.recentAverageOpenPrice.toFixed(2)}
Size: ${order.size}
Liq Price: $${order.estimatedLiquidationPrice.toFixed(2)}

PnL Today: $${order.realizedPnl.toFixed(2)}
MarkPrice: $${price}
Profit: ${HELPER.calculateProfit(order.recentAverageOpenPrice, price, order.side)}%
                    `);
            });
        } else {
            bot.sendMessage(chatId, 'No open orders');
        }
    }

    if (HELPER.checkText(text, 'close')) {
        let args = text.split(' ');
        let orders = await FTX.openOrders(API_CONNECTION);
        if (orders.length > 0) {
            bot.sendMessage(chatId, `::Closing Orders::`);
            if (args[1]) {
                orders = orders.filter(position => position.future.toLowerCase().includes(args[1].toLowerCase()))
                console.log(orders);
                if (orders.length === 0) bot.sendMessage(chatId, `❌ Can't find ${args[1]}`);
            }

            orders.forEach(async order => {
                let price = await FTX.getPrice(API_CONNECTION, order.future);
                bot.sendMessage(chatId, `
Closing ${order.side.toUpperCase()} ${order.future}
Funding Rate: ${await FTX.fundingRate(API_CONNECTION, order.future)}

AvgPrice: $${order.recentAverageOpenPrice.toFixed(2)}
Size: ${order.size}
Liq Price: $${order.estimatedLiquidationPrice.toFixed(2)}

PnL Today: $${order.realizedPnl.toFixed(2)}
MarkPrice: $${price}
Profit: ${HELPER.calculateProfit(order.recentAverageOpenPrice, price, order.side)}%
                    `);
            });
        } else {
            bot.sendMessage(chatId, `No open orders`);
        }

        // only exec when there's a pair given
        if (args[1]) {
            FTX.closeOrders(API_CONNECTION, args[1]);
        } else {
            FTX.closeOrders(API_CONNECTION);
        }
    }

    if (HELPER.checkText(text, 'alert')) {
        bot.sendMessage(chatId, `So, you want Tradingview alerts right? 👀 He's what you need to do:
- Set the condition of your indicator
- Options = Once per bar close
- Webhook URL = http://server_url/hook
- Give it any alert name
- Message should be = {"chatId":${chatId},"type":"BUY or SELL or CLOSE","exchange":"{{exchange}}","ticker":"{{ticker}}","timeframe":"{{interval}}","reason":"Catch the knife!"}`)
    }
});

// default route
app.get("/", (req, res) => {
    res.status(200).send('Mie no ab monie niffo').end();
})

app.post("/hook", async (req, res) => {
    console.log('Webhook received', req.body);
    if (req.body.chatId) {
        const order = req.body;
        bot.sendMessage(order.chatId, `✅ Webhook received:
${order.type} signal for ${order.ticker} on ${order.exchange}\nTimeframe: ${order.timeframe || "Not specified"}\nReason: ${order.reason || "Not specified"}`);
    }
    res.status(200).end()
})

/**
 * Made possible by forwarding port 80 from node to the server
 * https://www.digitalocean.com/community/tutorials/how-to-use-pm2-to-setup-a-node-js-production-environment-on-an-ubuntu-vps
 */
const PORT = 80;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`))