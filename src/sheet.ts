import { google } from 'googleapis';
import { sleep } from './utils';
import { SPREADSHEET_ID } from './constants';

const auth = new google.auth.GoogleAuth({
    keyFile: "./credential.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const sheet = google.sheets("v4")


function numberToChar(num: number): string | undefined {
    if (num < 1 || num > 26) {
        // Handle out of range numbers (assuming you want only A-Z)
        return undefined;
    }
    // Convert number to corresponding character ('A' is ASCII 65)
    return String.fromCharCode(64 + num);
}

export const submitSheet = async (table: string, data: (string | number)[]) => {

    const lastChar = numberToChar(data.length);

    for (let i = 0; i < 10; i++) {
        try {
            const ret = await sheet.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                auth: auth,
                range: `${table}!A:${lastChar}`,
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
        spreadsheetId: SPREADSHEET_ID,
        auth: auth,
        range: `${table}!A2:Z`,
    });
    return ret;
}
