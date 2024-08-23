import { Connection } from "@solana/web3.js";
import { chunkArray, fetchMintInfos, getDecimal, getMint, getTransactions, getUiBalance, sleep } from "./utils";
import base58 = require("bs58");
import { BN } from "@coral-xyz/anchor";
import { PnlToken, PnlTokens } from "./types";
import { clearSheet, submitSheet } from "./sheet";
import { HELIUS_API_KEY, RAYDIUM_V4_PROGRAM_ID, RAYDIUM_V4_TEMP_LP, WSOL_MINT } from "./constants";
const bs58 = base58.default;

const limit = 1000;
async function fetchTokenTrades(connection: Connection, token: PnlToken) {
    let { idx, creator, mint, lpAddress, openPrice, openBlock, athPrice, athBlock, mintAuthority, freezeAuthority } = token;
    const tradeTxs = await getTransactions(connection, lpAddress, limit);

    for (const tx of tradeTxs) {
        const { meta, slot, transaction, blockTime } = tx;
        const instructions = transaction.message.instructions;
        const innerInstructions = meta.innerInstructions;
        const postTokenBalances = meta.postTokenBalances;
        const signature = transaction.signatures[0]
        const accountKeys = transaction.message.accountKeys.map(t => t.pubkey.toBase58());

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

            if (programId == RAYDIUM_V4_PROGRAM_ID) {
                const args = bs58.decode(data.toString());

                if (args[0] == 9 // SwapBaseIn Ix
                    || args[0] == 11 // SwapBaseOut Ix
                ) {
                    // 2nd account is pool address
                    const poolAddress = accounts[1];
                    if (lpAddress != poolAddress) {
                        continue;
                    }

                    // Consider optional account
                    const poolVaultA = accounts.length == 17 ? accounts[4] : accounts[5];
                    const poolVaultB = accounts.length == 17 ? accounts[5] : accounts[6];

                    const mintA = getMint(poolVaultA, accountKeys, postTokenBalances);
                    const balanceA = getUiBalance(poolVaultA, accountKeys, postTokenBalances);

                    const mintB = getMint(poolVaultB, accountKeys, postTokenBalances);
                    const balanceB = getUiBalance(poolVaultB, accountKeys, postTokenBalances);

                    const price = (mintA == WSOL_MINT ? balanceA : balanceB) / (mintB == WSOL_MINT ? balanceA : balanceB)
                    if (price > athPrice) {
                        athPrice = price;
                        athBlock = blockTime;
                    }
                }
            }
        }
    }

    const cell = idx + 1;
    await submitSheet(
        "Raydium",
        cell,
        [
            creator,
            "RaydiumV4",
            mint,
            lpAddress,
            `${((athPrice - openPrice) / openPrice * 100).toFixed(0)} %`,
            `${((athBlock - openBlock) / 60).toFixed(1)} min`,
            new Date(openBlock * 1000).toLocaleString(),
            openPrice,
            athPrice,
            openPrice,
            athPrice,
            mintAuthority,
            freezeAuthority,
        ]
    );

    console.log(mint, athPrice);
}

async function fetchLpTrades(connection: Connection) {

    await clearSheet('Raydium');

    const now = Math.floor(Date.now() / 1000);
    const timeDelta = 60 * 60 * 24; // 1 day

    const initalizeTxs = await getTransactions(connection, RAYDIUM_V4_TEMP_LP, 1000, now - timeDelta);

    let tokens: PnlTokens = {};
    let idx = 1;
    for (const tx of initalizeTxs) {
        const { meta, slot, transaction, blockTime } = tx;
        const instructions = transaction.message.instructions;
        const innerInstructions = meta.innerInstructions;
        const postTokenBalances = meta.postTokenBalances;

        var mergedIxs = [];
        for (var i = 0; i < instructions.length; i++) {
            mergedIxs.push(instructions[i]);

            const innerIxs = innerInstructions.filter(t => t.index == i);
            if (innerIxs.length > 0) {
                mergedIxs = mergedIxs.concat(innerIxs[0].instructions);
            }
        }

        let mint, lpAddress, creator, price, openTime;

        for (const ix of mergedIxs) {
            const { programId, accounts, data } = ix;

            if (programId == RAYDIUM_V4_PROGRAM_ID) {
                const args = bs58.decode(data.toString());
                if (args[0] == 1) {
                    // https://github.com/raydium-io/raydium-amm/blob/ec2ef3d3f92c69644fba9640a2556f34233dc30e/program/src/instruction.rs#L836
                    lpAddress = accounts[4].toBase58();
                    const mintTokenA = accounts[8].toBase58();
                    const mintTokenB = accounts[9].toBase58();
                    creator = accounts[17].toBase58();
                    mint = mintTokenA == WSOL_MINT ? mintTokenB : mintTokenA;

                    const decimalA = getDecimal(mintTokenA, postTokenBalances);
                    const decimalB = getDecimal(mintTokenB, postTokenBalances);

                    // Parse initPoolArgs
                    // https://github.com/raydium-io/raydium-amm/blob/ec2ef3d3f92c69644fba9640a2556f34233dc30e/program/src/instruction.rs#L383
                    const nonce = Buffer.from(args.subarray(1, 2)).readUint8();
                    const _openTime = Number(Buffer.from(args.subarray(2, 10)).readBigUInt64LE());
                    openTime = _openTime > 0 ? _openTime : blockTime;
                    const amountB = new BN(Buffer.from(args.subarray(10, 18)).readBigUInt64LE()) / (10 ** decimalB);
                    const amountA = new BN(Buffer.from(args.subarray(18, 26)).readBigUInt64LE()) / (10 ** decimalA);
                    price = (mintTokenA == WSOL_MINT ? amountA : amountB) / (mintTokenA == WSOL_MINT ? amountB : amountA);
                }
            }
        }

        if (mint) {
            tokens[mint] = {
                idx,
                mint,
                lpAddress,
                creator,
                openPrice: price,
                openBlock: openTime,
                athPrice: price,
                athBlock: openTime,
                mintAuthority: "",
                freezeAuthority: "",
            };

            idx++;
        }
    }

    console.log(`${Object.values(tokens).length} LPs created`);

    tokens = await fetchMintInfos(connection, tokens);
    for (const token of Object.values(tokens)) {
        await fetchTokenTrades(connection, token);
        await sleep(500);
    }
}
