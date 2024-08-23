import { google } from 'googleapis';
import { sleep } from './utils';

const auth = new google.auth.GoogleAuth({
    keyFile: "./credential.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const sheet = google.sheets("v4")
const spreadsheetId = "1YuQtQV_3EdN6_Mc3DACtJZV3PaR8C7XwhQlUpGfQ708";


function numberToChar(num: number): string | undefined {
    if (num < 1 || num > 26) {
        // Handle out of range numbers (assuming you want only A-Z)
        return undefined;
    }
    // Convert number to corresponding character ('A' is ASCII 65)
    return String.fromCharCode(64 + num);
}

export const submitSheet = async (table: string, cell: number, data: (string | number)[]) => {

    const lastChar = numberToChar(data.length);

    for (let i = 0; i < 10; i++) {
        try {
            const ret = await sheet.spreadsheets.values.append({
                spreadsheetId,
                auth: auth,
                range: `${table}!A${cell}:${lastChar}${cell}`,
                valueInputOption: "RAW",
                requestBody: {
                    values: [
                        data
                    ]
                }
            });
            return ret;
        }
        catch {
            await sleep(1000);
        }
    }

}

export const clearSheet = async (table: string) => {
    const ret = await sheet.spreadsheets.values.clear({
        spreadsheetId,
        auth: auth,
        range: `${table}!A2:Z`,
    });
    return ret;
}
