import { Connection } from "@solana/web3.js";
import { HELIUS_API_KEY } from "./constants";
import { fetchRaydiumTrades } from "./lp";
import { PrismaClient } from "@prisma/client";
import { Prices } from "./types";
import { getSolPrice } from "./utils";

declare global {
    var prices: Prices
};

(async () => {
    const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`);

    const prisma = new PrismaClient();

    globalThis.prices = {};
    const prevPrices = await prisma.prices.findMany();
    for (const item of prevPrices) {
        globalThis.prices[item.blockTime] = item.price;
    }

    await Promise.all([
        fetchRaydiumTrades(connection),
    ]);

})();