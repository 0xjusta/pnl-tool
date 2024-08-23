import { Connection, GetVersionedTransactionConfig, Keypair, LAMPORTS_PER_SOL, ParsedAccountData, PublicKey } from "@solana/web3.js";
import { chunkArray, compareUintArray, fetchMintInfos, getDiscriminator, getTransactions, sleep } from "./utils";
import base58 = require("bs58");
import { IDL } from "./idl/pf";
import { base64 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { BorshCoder, BN } from "@coral-xyz/anchor";
import { PnlToken, PnlTokens } from "./types";
import { submitSheet } from "./sheet";
import { HELIUS_API_KEY, PUMPFUN_MINT_AUTHORITY, PUMPFUN_PROGRAM_ID } from "./constants";
const bs58 = base58.default;


// Create a WebSocket connection
const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`);

const EVENT_DISCRIMINATOR = [228, 69, 165, 46, 81, 203, 154, 29];

const limit = 1000;
const solPrice = 142.3363756720491;

const pfCoder = new BorshCoder(IDL);

async function fetchTokenTrades(token: PnlToken) {
    let { idx, creator, mint, lpAddress, openPrice, openBlock, athPrice, athBlock, mintAuthority, freezeAuthority } = token;
    const tradeTxs = await getTransactions(connection, mint, limit);

    for (const tx of tradeTxs) {
        const { meta, slot, transaction, blockTime } = tx;
        const instructions = transaction.message.instructions;
        const innerInstructions = meta.innerInstructions;

        var mergedIxs = [];
        for (var i = 0; i < instructions.length; i++) {
            mergedIxs.push(instructions[i]);

            const innerIxs = innerInstructions.filter(t => t.index == i);
            if (innerIxs.length > 0) {
                mergedIxs = mergedIxs.concat(innerIxs[0].instructions);
            }
        }

        for (const ix of mergedIxs) {
            const { programId, accounts, data } = ix;

            if (programId == PUMPFUN_PROGRAM_ID) {
                const args = bs58.decode(data.toString());
                const discriminator = args.subarray(0, 8);

                if (compareUintArray(discriminator, EVENT_DISCRIMINATOR)) {
                    const event = pfCoder.events.decode(base64.encode(Buffer.from(args.subarray(8))));
                    if (!event) {
                        continue;
                    }

                    const data = event.data;
                    if (event.name == "TradeEvent") {
                        const vSolReserve = (data.virtualSolReserves as BN) / LAMPORTS_PER_SOL;
                        const vTokenReserve = (data.virtualTokenReserves as BN) / 1_000_000;
                        const price = vSolReserve / vTokenReserve;
                        if (price > athPrice) {
                            athPrice = price;
                            athBlock = blockTime;
                        }
                    }
                }
            }
        }
    }

    const cell = idx + 1;
    await submitSheet(
        "Pumpfun",
        cell,
        [
            creator,
            "Pumpfun",
            mint,
            lpAddress,
            `${((athPrice - openPrice) / openPrice * 100).toFixed(0)} %`,
            `${((athBlock - openBlock) / 60).toFixed(1)} min`,
            new Date(openBlock * 1000).toLocaleString(),
            openPrice,
            athPrice,
            mintAuthority,
            freezeAuthority,
        ]
    );

    console.log(mint, athPrice);
}

(async () => {
    const now = Math.floor(Date.now() / 1000);
    const timeDelta = 60 * 60 * 1; // 1 day

    const mintTxs = await getTransactions(connection, PUMPFUN_MINT_AUTHORITY, limit, now - timeDelta);
    console.log(`Total ${mintTxs.length} tokens minted`);

    let tokens: PnlTokens = {};
    let idx = 1;
    for (const tx of mintTxs) {
        const { meta, slot, transaction, blockTime } = tx;
        const instructions = transaction.message.instructions;
        const innerInstructions = meta.innerInstructions;

        var mergedIxs = [];
        for (var i = 0; i < instructions.length; i++) {
            mergedIxs.push(instructions[i]);

            const innerIxs = innerInstructions.filter(t => t.index == i);
            if (innerIxs.length > 0) {
                mergedIxs = mergedIxs.concat(innerIxs[0].instructions);
            }
        }

        let mint, creator, price;

        for (const ix of mergedIxs) {
            const { programId, accounts, data } = ix;

            if (programId == PUMPFUN_PROGRAM_ID) {
                const args = bs58.decode(data.toString());
                const discriminator = args.subarray(0, 8);

                if (compareUintArray(discriminator, EVENT_DISCRIMINATOR)) {
                    const event = pfCoder.events.decode(base64.encode(Buffer.from(args.subarray(8))));
                    if (!event) {
                        continue;
                    }

                    const data = event.data;
                    if (event.name == "CreateEvent") {
                        // name = data.name;
                        // symbol = data.symbol;
                        // uri = data.uri;
                        mint = (data.mint as PublicKey).toBase58();
                        creator = (data.user as PublicKey).toBase58();
                    }
                    if (event.name == "TradeEvent") {
                        const vSolReserve = (data.virtualSolReserves as BN) / LAMPORTS_PER_SOL;
                        const vTokenReserve = (data.virtualTokenReserves as BN) / 1_000_000;
                        price = vSolReserve / vTokenReserve;
                    }
                }
            }
        }

        if (mint) {
            tokens[mint] = {
                idx,
                mint,
                lpAddress: "",
                creator,
                openPrice: price,
                openBlock: blockTime,
                athPrice: price,
                athBlock: blockTime,
                mintAuthority: "",
                freezeAuthority: "",
            };

            idx++;
        }
    }

    tokens = await fetchMintInfos(connection, tokens);

    const chunkTokens = chunkArray(Object.values(tokens), 20);
    for (const tokens of chunkTokens) {
        const tasks = tokens.map((token) => fetchTokenTrades(token));
        await Promise.all(tasks);

        await sleep(500);
    }

})();