import { Transaction, TransactionType } from "../types";

// Helper to parse the SimpleFin Access URL which comes in format: https://<user>:<password>@bridge.simplefin.org/simplefin/accounts
export const parseSimpleFinUrl = (accessUrl: string) => {
  try {
    // Some browsers might strip user:pass from new URL(), so we might need manual parsing if new URL() fails or strips it.
    // However, the input is a string, so we can parse manually or use URL object if supported.
    const pattern = /https:\/\/([^:]+):([^@]+)@(.+)/;
    const match = accessUrl.match(pattern);
    
    if (match) {
      const username = match[1];
      const password = match[2];
      const domain = match[3];
      return {
        url: `https://${domain}`,
        auth: btoa(`${decodeURIComponent(username)}:${decodeURIComponent(password)}`) // Basic Auth
      };
    }
    return null;
  } catch (e) {
    return null;
  }
};

export const fetchSimpleFinTransactions = async (accessUrl: string): Promise<Transaction[]> => {
  const credentials = parseSimpleFinUrl(accessUrl);
  if (!credentials) {
    throw new Error("Invalid SimpleFin Access URL format.");
  }

  // Note: calling external APIs directly from browser might trigger CORS if the API doesn't support it.
  // SimpleFin generally supports CORS for localhost development, but production usage might require a proxy.
  // We will attempt a direct fetch.
  try {
    const response = await fetch(credentials.url, {
      headers: {
        'Authorization': `Basic ${credentials.auth}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch from SimpleFin: ${response.statusText}`);
    }

    const data = await response.json();
    const transactions: Transaction[] = [];

    // SimpleFin structure: { accounts: [ { org, id, name, currency, balance, transactions: [...] } ] }
    if (data.accounts) {
      data.accounts.forEach((account: any) => {
        const accountName = `${account.org?.name || 'Bank'} - ${account.name}`;
        if (account.transactions) {
          account.transactions.forEach((t: any) => {
            // t.amount is string "100.00" or "-100.00". 
            // In SimpleFin: negative is expense/outflow, positive is income/inflow.
            const rawAmount = parseFloat(t.amount);
            const type = rawAmount < 0 ? TransactionType.EXPENSE : TransactionType.INCOME;
            
            transactions.push({
              id: `sf-${t.id}`, // Unique ID from SimpleFin
              date: new Date(t.posted * 1000).toISOString(), // posted is unix timestamp
              description: t.description || "Bank Transaction",
              amount: Math.abs(rawAmount),
              type: type,
              originalText: t.memo || "",
              comments: "",
              account: accountName
            });
          });
        }
      });
    }

    return transactions;

  } catch (error) {
    console.error("SimpleFin Sync Error:", error);
    throw error;
  }
};