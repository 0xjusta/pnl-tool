import { Connection } from "@solana/web3.js";
import { chunkArray, fetchMintInfos, getTransactions, sleep } from "./utils";
import { PnlToken, PnlTokens } from "./types";
import { clearSheet, submitSheet } from "./sheet";
import { BIRDEYE_KEY, RAYDIUM_V4_PROGRAM_ID, RAYDIUM_V4_TEMP_LP, WSOL_MINT } from "./constants";
import axios from "axios";
import { getLogger } from "./logger";
import base58 from "bs58";

const gainLimit = 500;
const logger = getLogger();

let cell = 2;

async function fetchTokenTrades(token: PnlToken) {
    let { creator, mint, lpAddress, mintAuthority, freezeAuthority } = token;

    let openPrice, athPrice, openBlock, athBlock;

    const to = Math.floor(new Date().getTime() / 1000);
    const from = to - 60 * 60 * 24;

    const url = `https://public-api.birdeye.so/defi/ohlcv?address=${mint}&time_from=${from}&time_to=${to}&type=1m`;
    const { data: ret } = await axios.get(url, {
        headers: {
            'X-API-KEY': BIRDEYE_KEY
        }
    });
    if (ret.success) {
        const items = ret.data.items;
        if (items.length > 0) {
            openPrice = items[0].o;
            openBlock = items[0].unixTime;
            athPrice = openPrice;
            athBlock = openBlock;

            for (const item of items) {
                const { o, h, l, c, unixTime } = item;
                if (h > athPrice) {
                    athPrice = h;
                    athBlock = unixTime;
                }
            }
        }
    }

    const gainPercentage = Math.floor((athPrice - openPrice) / openPrice * 100);
    if (gainPercentage >= gainLimit) {
        logger.info(`RayV4 gain found: ${mint} - ${gainPercentage} %`);
        await submitSheet(
            "Raydium",
            [
                creator,
                "RaydiumV4",
                mint,
                lpAddress,
                gainPercentage,
                `${Math.floor((athBlock - openBlock) / 60)} min`,
                new Date(openBlock * 1000).toLocaleString(),
                openPrice,
                athPrice,
                mintAuthority,
                freezeAuthority,
            ]
        );
        cell++;
    }
}

export async function fetchRaydiumTrades(connection: Connection) {

    // await clearSheet('Raydium');

    const now = Math.floor(Date.now() / 1000);
    const timeDelta = 60 * 60 * 24; // 1 day

    const txs = await getTransactions(RAYDIUM_V4_TEMP_LP, now - timeDelta);
    const createPoolTxs = txs.filter(t => t.type == "CREATE_POOL" && t.source == "RAYDIUM");

    let tokens: PnlTokens = {};
    for (const tx of createPoolTxs) {
        const { instructions } = tx;

        let mint, lpAddress, creator;

        for (const ix of instructions) {
            const { programId, accounts, data } = ix;

            if (programId == RAYDIUM_V4_PROGRAM_ID) {
                const args = base58.decode(data.toString());
                if (args[0] == 1) {
                    // https://github.com/raydium-io/raydium-amm/blob/ec2ef3d3f92c69644fba9640a2556f34233dc30e/program/src/instruction.rs#L836
                    lpAddress = accounts[4];
                    creator = accounts[17];

                    const mintA = accounts[8];
                    const mintB = accounts[9];
                    if (mintA == WSOL_MINT || mintB == WSOL_MINT) {
                        mint = mintB == WSOL_MINT ? mintA : mintB;
                    }
                }
            }
        }

        if (mint) {
            tokens[mint] = {
                mint,
                lpAddress,
                creator,
                openPrice: 0,
                openBlock: 0,
                athPrice: 0,
                athBlock: 0,
                mintAuthority: "",
                freezeAuthority: "",
            };
        }
    }

    logger.info(`RayV4: ${tokens.length} tokens fetched`);

    tokens = await fetchMintInfos(connection, tokens);
    for (const mint in tokens) {
        await fetchTokenTrades(tokens[mint]);
    }
}
