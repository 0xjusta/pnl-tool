import axios from "axios";
import { sleep } from "./utils";
import { PrismaClient } from "@prisma/client";

async function getLatestPrice() {
    const { data } = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112`);
    const pairs = data.pairs;
    return parseFloat(pairs[0].priceUsd) ?? 0;
}

(async () => {
    const prisma = new PrismaClient();

    let lastPrice = 0;

    while (true) {

        try {
            const blockTime = Math.floor(Date.now() / 1000);
            const price = await getLatestPrice();
            if (price && price > 0 && price != lastPrice) {
                lastPrice = price;

                await prisma.prices.create({
                    data: {
                        price,
                        blockTime
                    }
                });
            }
        }
        catch (ex) {
            console.log(ex);
        }

        await sleep(1000 * 10);
    }

})();