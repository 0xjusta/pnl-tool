import { Connection, GetVersionedTransactionConfig, LAMPORTS_PER_SOL, ParsedAccountData, PublicKey } from "@solana/web3.js";
import { sha256 } from "js-sha256";
import { PnlTokens } from "./types";

export async function sleep(time: number) {
    return new Promise(resolve => setTimeout(resolve, time));
}

export function compareUintArray(a, b) {

    if (a.length != b.length) {
        return false;
    }

    for (var i = 0; i < a.length; i++) {
        if (a[i] != b[i]) {
            return false;
        }
    }

    return true;
}

export function getMint(account, accountKeys, balanceChanges) {
    const idx = accountKeys.findIndex(t => t == account);

    for (const balance of balanceChanges) {
        if (balance.accountIndex == idx) {
            return balance.mint;
        }
    }

    // If no token changes, then can be WSOL
    return "So11111111111111111111111111111111111111112";
}

export function getDecimal(mint, balanceChanges) {
    for (const balance of balanceChanges) {
        if (balance.mint == mint) {
            return balance.uiTokenAmount.decimals;
        }
    }

    // If no token changes, then can be WSOL
    return 0;
}

export function getUiBalance(account, accountKeys, balances) {
    const idx = accountKeys.findIndex(t => t == account);

    for (const balance of balances) {
        if (balance.accountIndex == idx) {
            return balance.uiTokenAmount.uiAmount ?? 0;
        }
    }

    // If no token changes, then can be WSOL
    return 0;
}

export function getSolBalance(account, accountKeys, balances) {
    const idx = accountKeys.findIndex(t => t == account);
    return balances[idx] / LAMPORTS_PER_SOL;
}

export function getBalanceUpdate(account, accountKeys, preBalances, postBalances) {
    const idx = accountKeys.findIndex(t => t == account);

    var preBalance = 0;
    for (const balance of preBalances) {
        if (balance.accountIndex == idx) {
            preBalance = balance.uiTokenAmount.amount;
            break;
        }
    }

    var postBalance = 0;
    for (const balance of postBalances) {
        if (balance.accountIndex == idx) {
            postBalance = balance.uiTokenAmount.amount;
            break;
        }
    }

    return Math.abs(postBalance - preBalance);
}

export function getDiscriminator(method) {
    const discriminator = Buffer.from(sha256.digest("global:" + method)).slice(0, 8);
    return discriminator;
}

export function chunkArray<T>(array: T[], size: number): T[][] {
    if (size <= 0) {
        throw new Error('Chunk size must be greater than 0');
    }

    const result: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
}

export async function getTransactions(connection: Connection, address: string, limit: number, minBlock?: number) {

    let lastSignature = undefined;
    let transactions = [];

    while (true) {

        try {
            console.log(lastSignature);
            const ret = await connection.getSignaturesForAddress(new PublicKey(address), {
                limit,
                before: lastSignature
            }, 'finalized');
            if (ret.length == 0) {
                break;
            }

            lastSignature = ret[ret.length - 1].signature;
            const signatures = ret.filter(t =>
                !t.err && (!minBlock || (minBlock && ((t.blockTime ?? 0) >= minBlock)))
            ).map(t => t.signature);

            let _transactions = await connection.getParsedTransactions(signatures, {
                commitment: 'finalized',
                maxSupportedTransactionVersion: 0,
            } as GetVersionedTransactionConfig);
            console.log(_transactions.length);
            _transactions = _transactions.filter(t => !!t);
            if (_transactions.length > 0) {
                transactions = transactions.concat(_transactions);
            }

            if (minBlock) {
                const lastBlock = ret[ret.length - 1].blockTime ?? 0;
                if (lastBlock < minBlock) {
                    break;
                }
            }

            if (ret.length < limit) {
                break;
            }
        }
        catch (ex) {
            console.log(ex);
            await sleep(1000);
        }
    }

    return transactions.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
}

export async function fetchMintInfos(connection: Connection, tokens: PnlTokens) {
    const chunkMints = chunkArray(Object.values(tokens), 100);
    for (const subMints of chunkMints) {
        const mints = subMints.map(t => new PublicKey(t.mint));
        const { value } = await connection.getMultipleParsedAccounts(mints);
        for (let i = 0; i < mints.length; i++) {
            const mint = mints[i].toBase58();
            const info = (value[i].data as ParsedAccountData).parsed.info;
            const mintAuthority = info.mintAuthority;
            const freezeAuthority = info.freezeAuthority;
            tokens[mint].mintAuthority = mintAuthority ?? "N/A";
            tokens[mint].freezeAuthority = freezeAuthority ?? "N/A";
        }
    }

    return tokens;
}

export function getSolPrice(blockTime: number) {
    const times = Object.keys(globalThis.prices);
    const prevs = times.filter((t) => parseInt(t) < blockTime);
    if (prevs.length > 0) {
        return globalThis.prices[prevs[prevs.length - 1]];
    }

    return globalThis.prices[times[0]];
}