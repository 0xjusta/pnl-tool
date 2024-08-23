const WebSocket = require('ws');
const dotenv = require('dotenv');
const { default: bs58 } = require('bs58');
const { getMint, compareUintArray, getDiscriminator } = require('../src/utils');
const { PublicKey, Connection } = require('@solana/web3.js');
const { Axios, default: axios } = require('axios');

// Load env
dotenv.config();

// Create a WebSocket connection
const apiKey = process.env.HELIUS_KEY ?? "";
const apiUrl = `https://mainnet.helius-rpc.com?api-key=${apiKey}`;

const RAYDIUM_V4_PROGRAM_ID = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
const RAYDIUM_ROUTING_PROGRAM_ID = "routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS";
const PUMPFUN_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

const JUPITER_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const JUPITER_ROUTE_DISCRIMINATOR = getDiscriminator("route");
const JUPITER_SHARED_ROUTE_DISCRIMINATOR = getDiscriminator("shared_accounts_route");
const JUPITER_EVENT_DISCRIMINATOR = [228, 69, 165, 46, 81, 203, 154, 29];

const txHash = "5gHfTLkez6Uas86ez3hYkYp6sz81eNXnZ16bSVSPVoYNKLxBcTZRKc6syt8qX7ra2iJT5DmeJZzrb5XXteUB2KA7";


(async () => {
    try {
        const connection = new Connection(apiUrl);
        const data = await connection.getParsedTransaction(txHash, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
        });

        const { meta, slot, transaction, blockTime: timestamp } = data;
        const instructions = transaction.message.instructions;
        const accountKeys = transaction.message.accountKeys.map(t => t.pubkey);
        const innerInstructions = meta.innerInstructions;
        const postTokenBalances = meta.postTokenBalances;

        var signer = "";
        var mintArr = [];

        // Merge main and inner instructions into one array
        var mergedIxs = [];
        for (var i = 0; i < instructions.length; i++) {
            mergedIxs.push(instructions[i]);

            const innerIxs = innerInstructions.filter(t => t.index == i);
            if (innerIxs.length > 0) {
                mergedIxs = mergedIxs.concat(innerIxs[0].instructions);
            }
        }

        var signer = "";
        var swapArr = [];

        // Merge main and inner instructions into one array
        var mergedIxs = [];
        for (var i = 0; i < instructions.length; i++) {
            mergedIxs.push(instructions[i]);

            const innerIxs = innerInstructions.filter(t => t.index == i);
            if (innerIxs.length > 0) {
                mergedIxs = mergedIxs.concat(innerIxs[0].instructions);
            }
        }

        // Loop main/inner instructions for Jupiter/RayV4
        for (var i = 0; i < mergedIxs.length; i++) {
            const { programId, data, accounts } = mergedIxs[i];

            // Parse Jupiter
            if (programId == JUPITER_PROGRAM_ID) {
                const args = bs58.decode(data.toString());
                const discriminator = args.subarray(0, 8);

                // From Route ix, extract signer only
                if (compareUintArray(discriminator, JUPITER_ROUTE_DISCRIMINATOR)) {
                    signer = accounts[1];
                    continue;
                }
                if (compareUintArray(discriminator, JUPITER_SHARED_ROUTE_DISCRIMINATOR)) {
                    signer = accounts[2];
                    continue;
                }

                if (!compareUintArray(discriminator, JUPITER_EVENT_DISCRIMINATOR)) {
                    continue;
                }

                // SWAP event log takes 128 bytes
                if (args.length != 128) {
                    continue;
                }

                const inputs = args.subarray(8);
                const dataView = new DataView(inputs.buffer);
                const amm = new PublicKey(inputs.subarray(8, 40)).toBase58();
                const inputMint = new PublicKey(inputs.subarray(40, 72)).toBase58();
                const inputAmount = dataView.getBigUint64(80, true);
                const outputMint = new PublicKey(inputs.subarray(80, 112)).toBase58();
                const outputAmount = dataView.getBigUint64(120, true);
                console.log('Jupiter');

                swapArr.push({
                    blockId: slot,
                    blockTime: timestamp,
                    transactionId: txHash,
                    srcMint: inputMint,
                    srcAmount: inputAmount,
                    srcOwnerAccount: signer,
                    dstMint: outputMint,
                    dstAmount: outputAmount,
                    srcProgram: programId,
                });
            }

            // Parse Raydium V4
            if (programId == RAYDIUM_V4_PROGRAM_ID) {
                const args = bs58.decode(data.toString());
                if (args[0] != 9 // BaseIn Ix
                    && args[0] != 11 // BaseOut Ix
                ) {
                    continue;
                }

                // Consider optional account
                const srcMint = getMint(accounts[accounts.length - 3], accountKeys, postTokenBalances);
                const dstMint = getMint(accounts[accounts.length - 2], accountKeys, postTokenBalances);
                const srcOwnerAccount = accounts[accounts.length - 1];

                // Next two instructions are token in/out
                const inIx = mergedIxs[i + 1];
                const outIx = mergedIxs[i + 2];
                const srcAmount = BigInt(inIx.parsed.info.amount ?? inIx.parsed.info.tokenAmount.amount);
                const dstAmount = BigInt(outIx.parsed.info.amount ?? outIx.parsed.info.tokenAmount.amount);
                console.log('Raydium V4');

                swapArr.push({
                    blockId: slot,
                    blockTime: timestamp,
                    transactionId: txHash,
                    srcMint,
                    srcAmount,
                    srcOwnerAccount,
                    dstMint,
                    dstAmount,
                    srcProgram: RAYDIUM_V4_PROGRAM_ID,
                })
            }
        }

        // Loop main instructions for RayRouter
        for (var i = 0; i < instructions.length; i++) {
            const { programId, data, accounts } = instructions[i];
            if (programId != RAYDIUM_ROUTING_PROGRAM_ID) {
                continue;
            }

            const args = bs58.decode(data.toString());
            if (args[0] != 0) {
                continue;
            }

            const srcOwnerAccount = accounts[4];
            const srcAta = accounts[5];
            const dstAta = accounts[6];
            const srcMint = getMint(srcAta, accountKeys, postTokenBalances);
            const dstMint = getMint(dstAta, accountKeys, postTokenBalances);

            var srcAmount = 0n;
            var dstAmount = 0n;

            // Loop all inner ixs to get token transfers & calculate balance updates
            const innerIxs = innerInstructions.filter(t => t.index == i);
            if (innerIxs.length > 0) {
                const transferIxs = innerIxs[0].instructions.filter(t =>
                    t.programId == "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" &&
                    (
                        t.parsed.type == "transfer" ||
                        t.parsed.type == "transferChecked"
                    )
                );
                for (const ix of transferIxs) {
                    var { amount, tokenAmount, source, destination } = ix.parsed.info;
                    if (!amount) {
                        amount = tokenAmount.amount;
                    }

                    if (source == srcAta) {
                        srcAmount += BigInt(amount);
                    }
                    else if (source == dstAta) {
                        dstAmount += BigInt(amount);
                    }

                    if (destination == srcAta) {
                        srcAmount += BigInt(amount);
                    }
                    else if (destination == dstAta) {
                        dstAmount += BigInt(amount);
                    }
                }
            }
            console.log('Raydium Routing:', signature);

            swapArr.push({
                blockId: slot,
                blockTime: timestamp,
                transactionId: signature,
                srcMint,
                srcAmount,
                srcOwnerAccount,
                dstMint,
                dstAmount,
                srcProgram: RAYDIUM_ROUTING_PROGRAM_ID,
            })
        }

        if (swapArr.length > 0) {
            console.log(swapArr);
        }

        // eslint-disable-next-line no-empty
    } catch (e) {
        console.log(e);
    }

})();
