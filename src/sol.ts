import axios from "axios";
import { sleep } from "./utils";
import { PrismaClient } from "@prisma/client";

async function getLatestPrice() {
    const { data } = await axios.get(`https://api.raydium.io/v2/main/price`);
    return data['So11111111111111111111111111111111111111112'] ?? 0;
}

export function getPrice(blockTime: number) {
    const times = Object.values(globalThis.prices);
    
}

export async function fetchSolPrices() {

    const prisma = new PrismaClient();

    while (true) {

        try {
            const blockTime = Math.floor(Date.now() / 1000);
            const price = await getLatestPrice();
            if (price && price > 0) {
                globalThis.prices[blockTime] = price;

                await prisma.prices.create({
                    data: {
                        price,
                        blockTime
                    }
                });
            }
        }
        catch {

        }

        await sleep(1000 * 10);
    }

};