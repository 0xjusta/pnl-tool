export type TransactionType = {
    type: string;
    source: string;
    signature: string;
    slot: number;
    timestamp: number;
};

export type PnlToken = {
    idx: number;
    mint: string;
    lpAddress: string;
    creator: string;
    openPrice: number;
    openBlock: number;
    athPrice: number;
    athBlock: number;
    mintAuthority: string;
    freezeAuthority: string;
}

export type PnlTokens = { [key in string]: PnlToken };