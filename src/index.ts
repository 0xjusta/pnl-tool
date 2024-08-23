import { Connection } from "@solana/web3.js";
import { fetchSolPrices } from "./sol";
import { HELIUS_API_KEY } from "./constants";

declare global {
    var prices: { [key in number]: number };
}

(async () => {
    const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`);

    await Promise.all([
        fetchSolPrices(),
        
    ]);

})();