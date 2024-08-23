export type TransactionType = {
    type: string;
    source: string;
    signature: string;
    slot: number;
    timestamp: number;
};

export type PnlToken = {
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

export type PnlTokens = PnlToken[];

export type Prices = { [key in string]: number };