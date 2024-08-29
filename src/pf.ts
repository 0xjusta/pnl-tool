import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { chunkArray, compareUintArray, getDiscriminator, getTransactions, sleep } from "./utils";
import base58 from "bs58";
import { PnlToken, PnlTokens } from "./types";
import { clearSheet, submitSheet } from "./sheet";
import { PUMPFUN_MINT_AUTHORITY, PUMPFUN_PROGRAM_ID, RAYDIUM_V4_PROGRAM_ID, RAYDIUM_V4_TEMP_LP, WSOL_MINT } from "./constants";
import axios from "axios";
import { IDL } from "./idl/pf";
import { BorshCoder, BN } from "@coral-xyz/anchor";
import { base64 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { getLogger } from "./logger";

const pfCoder = new BorshCoder(IDL);
const EVENT_DISCRIMINATOR = [228, 69, 165, 46, 81, 203, 154, 29];
const gainLimit = 500;
const logger = getLogger();

let cell = 2;

async function fetchTokenTrades(token: PnlToken) {
    let { creator, mint, lpAddress, openPrice, athPrice, openBlock, athBlock, mintAuthority, freezeAuthority } = token;

    let offset = 0;
    const limit = 1000;
    for (let i = 0; i < 10; i++) {
        try {
            const url = `https://frontend-api.pump.fun/candlesticks/${mint}?offset=${offset}&limit=${limit}&timeframe=60`;
            const { data: items } = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36'
                }
            });
            if (items && items.length > 0) {
                for (const item of items) {
                    const { open, high, timestamp } = item;
                    if (high > athPrice) {
                        athPrice = high;
                        athBlock = timestamp;
                    }
                    if (openBlock == 0 || openBlock > timestamp) {
                        openPrice = open;
                        openBlock = timestamp;
                    }
                }

                offset += items.length;
            }

            if (items.length < limit) {
                break;
            }
        }
        catch (ex) {
            logger.error(`PF error: ${mint}`);
            await sleep(1000);
        }
    }

    const gainPercentage = Math.floor((athPrice - openPrice) / openPrice * 100);
    if (gainPercentage >= gainLimit) {
        logger.info(`Pf gain found: ${mint} - ${gainPercentage} %`);
        await submitSheet(
            "Pumpfun",
            [
                creator,
                "Pumpfun",
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

export async function fetchPupmfunTrades(connection: Connection) {

    // await clearSheet('Pumpfun');

    const now = Math.floor(Date.now() / 1000);
    const timeDelta = 60 * 60 * 24; // 1 day

    const txs = await getTransactions(PUMPFUN_MINT_AUTHORITY, now - timeDelta);

    let tokens: PnlTokens = {};
    let idx = 1;
    for (const tx of txs) {
        const { signature, instructions, timestamp } = tx;

        let mint, lpAddress, creator, price;

        for (const ix of instructions) {
            const { programId, innerInstructions } = ix;
            if (programId == PUMPFUN_PROGRAM_ID) {
                for (const innerIx of innerInstructions) {
                    const { programId, data } = innerIx;
                    if (programId != PUMPFUN_PROGRAM_ID) {
                        continue;
                    }

                    const args = base58.decode(data.toString());
                    const discriminator = args.subarray(0, 8);
                    if (!compareUintArray(discriminator, EVENT_DISCRIMINATOR)) {
                        continue;
                    }

                    const event = pfCoder.events.decode(base64.encode(Buffer.from(args.subarray(8))));
                    if (!event) {
                        continue;
                    }

                    {
                        const data = event.data;
                        if (event.name == "CreateEvent") {
                            mint = (data.mint as PublicKey).toBase58();
                            creator = (data.user as PublicKey).toBase58();
                            lpAddress = (data.bondingCurve as PublicKey).toBase58();
                        }
                        if (event.name == "TradeEvent") {
                            const vSolReserve = (data.virtualSolReserves as BN) / LAMPORTS_PER_SOL;
                            const vTokenReserve = (data.virtualTokenReserves as BN) / 1_000_000;
                            price = vSolReserve / vTokenReserve;
                        }
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
                mintAuthority: "N/A",
                freezeAuthority: "N/A",
            };

            idx++;
        }
    }

    logger.info(`Pf: ${tokens.length} tokens fetched`);

    // tokens = await fetchMintInfos(connection, tokens);
    for (const mint in tokens) {
        await fetchTokenTrades(tokens[mint]);
    }
}
