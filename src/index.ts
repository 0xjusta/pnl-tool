import { Connection } from "@solana/web3.js";
import { HELIUS_API_KEY } from "./constants";
import { fetchRaydiumTrades } from "./lp";
// import { PrismaClient } from "@prisma/client";
import { Prices } from "./types";
import { sleep } from "./utils";
import { fetchPupmfunTrades } from "./pf";
import { getLogger } from "./logger";

declare global {
    var prices: Prices;
};

(async () => {

    /*
    const prisma = new PrismaClient();

    globalThis.prices = {};
    const prevPrices = await prisma.prices.findMany();
    for (const item of prevPrices) {
        globalThis.prices[item.blockTime] = item.price;
    }
    */

    while (true) {
        const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`);

        const logger = getLogger();
        logger.info(`App started...`);

        await Promise.all([
            fetchRaydiumTrades(connection),
            fetchPupmfunTrades(connection),
            sleep(60 * 60 * 12 * 1000)
        ]);
    }

})();