import { Connection } from "@solana/web3.js";
import { chunkArray, fetchMintInfos, getDecimal, getMint, getSolPrice, getTransactions, getUiBalance, sleep } from "./utils";
import base58 = require("bs58");
import { PnlToken, PnlTokens, Prices } from "./types";
import { clearSheet, submitSheet } from "./sheet";
import { RAYDIUM_V4_PROGRAM_ID, RAYDIUM_V4_TEMP_LP, WSOL_MINT } from "./constants";
import { sign } from "crypto";
const bs58 = base58.default;

const limit = 1000;
async function fetchTokenTrades(token: PnlToken) {
    let { idx, creator, mint, lpAddress, openPrice, openBlock, athPrice, athBlock, openSignature, athSignature, mintAuthority, freezeAuthority } = token;
    const tradeTxs = await getTransactions(lpAddress, limit);

    for (const tx of tradeTxs) {
        const { timestamp, slot, signature, instructions, tokenTransfers, nativeTransfers, accountData } = tx;

        var mergedIxs = [];
        for (const ix of instructions) {
            mergedIxs.push({
                programId: ix.programId,
                accounts: ix.accounts,
                data: ix.data,
            });

            for (const innerIx of ix.innerInstructions) {
                mergedIxs.push({
                    programId: innerIx.programId,
                    accounts: innerIx.accounts,
                    data: innerIx.data,
                });
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
                    const vaultA = accounts.length == 17 ? accounts[4] : accounts[5];
                    const vaultB = accounts.length == 17 ? accounts[5] : accounts[6];

                    const tokenTransferA = tokenTransfers.filter(t => (t.toTokenAccount == vaultA || t.fromTokenAccount == vaultA))[0];
                    const tokenTransferB = tokenTransfers.filter(t => (t.toTokenAccount == vaultB || t.fromTokenAccount == vaultB))[0];

                    const amountA = tokenTransferA.tokenAmount;
                    const amountB = tokenTransferB.tokenAmount;

                    const solPrice = getSolPrice(timestamp);
                    let price = solPrice * (tokenTransferA.mint == WSOL_MINT ? amountA : amountB) / (tokenTransferB.mint == WSOL_MINT ? amountA : amountB);
                    if (price > athPrice) {
                        athPrice = price;
                        athBlock = timestamp;
                        athSignature = signature;
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
            openSignature,
            athSignature,
            mintAuthority,
            freezeAuthority,
        ]
    );

    console.log(mint, athPrice);
}

export async function fetchRaydiumTrades(connection: Connection) {

    await clearSheet('Raydium');

    const now = Math.floor(Date.now() / 1000);
    const timeDelta = 60 * 60 * 1; // 1 day

    const txs = await getTransactions(RAYDIUM_V4_TEMP_LP, 1000, now - timeDelta);
    const createPoolTxs = txs.filter(t => t.type == "CREATE_POOL" && t.source == "RAYDIUM");

    let tokens: PnlTokens = {};
    let idx = 1;
    for (const tx of createPoolTxs) {
        const { timestamp, slot, signature, instructions, tokenTransfers, nativeTransfers, accountData } = tx;

        let mint, lpAddress, creator, price, openTime;

        for (const ix of instructions) {
            const { programId, accounts, data } = ix;

            if (programId == RAYDIUM_V4_PROGRAM_ID) {
                const args = bs58.decode(data.toString());
                if (args[0] == 1) {
                    // https://github.com/raydium-io/raydium-amm/blob/ec2ef3d3f92c69644fba9640a2556f34233dc30e/program/src/instruction.rs#L836
                    lpAddress = accounts[4];
                    creator = accounts[17];

                    const mintA = accounts[8];
                    const mintB = accounts[9];
                    mint = mintB == WSOL_MINT ? mintA : mintB;

                    const vaultA = accounts[10];
                    const vaultB = accounts[11];

                    // Parse initPoolArgs
                    // https://github.com/raydium-io/raydium-amm/blob/ec2ef3d3f92c69644fba9640a2556f34233dc30e/program/src/instruction.rs#L383
                    const nonce = Buffer.from(args.subarray(1, 2)).readUint8();
                    const _openTime = Number(Buffer.from(args.subarray(2, 10)).readBigUInt64LE());
                    openTime = _openTime > 0 ? _openTime : timestamp;

                    const amountA = tokenTransfers.filter(t => t.toTokenAccount == vaultA)[0].tokenAmount;
                    const amountB = tokenTransfers.filter(t => t.toTokenAccount == vaultB)[0].tokenAmount;

                    const solPrice = getSolPrice(timestamp);
                    price = solPrice * (mintA == WSOL_MINT ? amountA : amountB) / (mintA == WSOL_MINT ? amountB : amountA);
                    console.log(price);
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
                openSignature: signature,
                athSignature: signature,
                mintAuthority: "",
                freezeAuthority: "",
            };

            idx++;
        }
    }

    console.log(`${Object.values(tokens).length} LPs created`);

    tokens = await fetchMintInfos(connection, tokens);
    for (const token of Object.values(tokens)) {
        await fetchTokenTrades(token);
        await sleep(500);
    }
}
