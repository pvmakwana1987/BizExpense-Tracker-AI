import { Category, Transaction, TransactionType, ReconciliationOrder, ReconciliationMatchSuggestion } from "../types";

// Helper to call our backend proxy
// This abstracts the actual Google SDK call, ensuring we use the Server's Vertex AI credentials
const generateContentProxy = async (model: string, contents: any, config: any) => {
  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, contents, config })
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("AI Service Error:", error);
    return null;
  }
};

// Helper to extract text from raw JSON response (mimicking SDK's .text getter)
const extractText = (response: any): string | null => {
  return response?.candidates?.[0]?.content?.parts?.[0]?.text || null;
};

const SYSTEM_INSTRUCTION = `You are an expert accountant for a small business. 
Your task is to categorize financial transactions into a user-provided set of categories and subcategories.
Return a JSON array mapping each transaction ID to the most appropriate Category ID and Subcategory ID.
`;

export const autoCategorizeTransactions = async (
  transactions: Transaction[],
  categories: Category[]
): Promise<Array<{ id: string; categoryId: string; subcategoryId: string | null }>> => {
  
  const categoryStructure = categories.map(c => ({
    id: c.id,
    name: c.name,
    type: c.type,
    subcategories: c.subcategories.map(s => ({ id: s.id, name: s.name }))
  }));

  const transactionList = transactions.map(t => ({
    id: t.id,
    description: t.description,
    amount: t.amount,
    type: t.type
  }));

  const prompt = `
    Categories: ${JSON.stringify(categoryStructure)}
    Transactions to categorize: ${JSON.stringify(transactionList)}
  `;

  const response = await generateContentProxy("gemini-1.5-flash", prompt, {
    systemInstruction: SYSTEM_INSTRUCTION,
    responseMimeType: "application/json",
    // Schema passed as simple object for proxy
    responseSchema: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          categoryId: { type: "STRING" },
          subcategoryId: { type: "STRING", nullable: true },
        },
        required: ["id", "categoryId"],
      },
    },
  });

  const text = extractText(response);
  if (!text) return [];
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse JSON", e);
    return [];
  }
};

export const parseReceiptImage = async (base64Image: string): Promise<Partial<Transaction> | null> => {
  const response = await generateContentProxy("gemini-1.5-flash", {
    parts: [
      { inlineData: { mimeType: "image/jpeg", data: base64Image } },
      { text: "Extract the transaction date, merchant name, total amount, and a brief description from this receipt. Return JSON." }
    ]
  }, {
    responseMimeType: "application/json",
    responseSchema: {
      type: "OBJECT",
      properties: {
        date: { type: "STRING", description: "ISO 8601 Date YYYY-MM-DD" },
        merchant: { type: "STRING" },
        amount: { type: "NUMBER" },
        description: { type: "STRING" },
      },
      required: ["date", "merchant", "amount"],
    },
  });

  const text = extractText(response);
  if (text) {
    return JSON.parse(text);
  }
  return null;
};

export const parsePdfStatement = async (base64Pdf: string): Promise<Transaction[]> => {
  const response = await generateContentProxy("gemini-1.5-flash", {
    parts: [
      { inlineData: { mimeType: "application/pdf", data: base64Pdf } },
      { text: "Extract all financial transactions from this bank statement PDF. Return a JSON array. For each transaction, provide date (YYYY-MM-DD), description, amount (absolute number), and type (INCOME or EXPENSE). Ignore headers/footers/page numbers." }
    ]
  }, {
    responseMimeType: "application/json",
    responseSchema: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          date: { type: "STRING" },
          description: { type: "STRING" },
          amount: { type: "NUMBER" },
          type: { type: "STRING", enum: ["INCOME", "EXPENSE"] }
        },
        required: ["date", "description", "amount", "type"],
      },
    },
  });

  const text = extractText(response);
  if (text) {
    const raw = JSON.parse(text);
    return raw.map((r: any, idx: number) => ({
      id: `pdf-${Date.now()}-${idx}`,
      date: r.date,
      description: r.description,
      amount: r.amount,
      type: r.type as TransactionType,
      account: "PDF Import"
    }));
  }
  return [];
};

export const suggestReconciliationMatches = async (
    transactions: Transaction[], 
    orders: ReconciliationOrder[]
): Promise<ReconciliationMatchSuggestion[]> => {
  
  const unmatchedTxns = transactions.filter(t => !t.comments?.includes("Matched Order")).map(t => ({
      id: t.id, date: t.date, desc: t.description, amount: t.amount
  })).slice(0, 50);
  
  const unmatchedOrders = orders.filter(o => !o.matchedTransactionId).map(o => ({
      id: o.id, date: o.date, desc: o.description, amount: o.amount
  })).slice(0, 50);

  if (unmatchedTxns.length === 0 || unmatchedOrders.length === 0) return [];

  const response = await generateContentProxy("gemini-1.5-flash", `
    Analyze these bank transactions and orders to find matches for reconciliation.
    Look for:
    1. Exact matches (same date, same amount).
    2. Bundles (multiple orders summing up to one transaction amount, usually same date).
    3. Semantic matches (descriptions match conceptually e.g. "Amazon" vs "AMZN", even if amounts are slightly off).
    4. Discrepancies (Matches where amount differs slightly due to tax/shipping).
    
    Transactions: ${JSON.stringify(unmatchedTxns)}
    Orders: ${JSON.stringify(unmatchedOrders)}
  `, {
    responseMimeType: "application/json",
    responseSchema: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          type: { type: "STRING", enum: ['EXACT', 'BUNDLE', 'SEMANTIC', 'DISCREPANCY'] },
          transactionId: { type: "STRING" },
          orderIds: { type: "ARRAY", items: { type: "STRING" } },
          confidence: { type: "NUMBER" },
          reason: { type: "STRING" },
          discrepancyAmount: { type: "NUMBER", nullable: true }
        },
        required: ["type", "transactionId", "orderIds", "confidence", "reason"],
      },
    },
  });

  const text = extractText(response);
  if (text) {
    return JSON.parse(text);
  }
  return [];
};

export const normalizeMerchants = async (transactions: Transaction[]): Promise<Array<{ id: string, merchant: string }>> => {
  const inputs = transactions.filter(t => !t.merchant).map(t => ({ id: t.id, desc: t.description }));
  if (inputs.length === 0) return [];

  const response = await generateContentProxy("gemini-1.5-flash", 
    `Normalize these transaction descriptions to clean merchant names (e.g., 'AMZN Mktp' -> 'Amazon'). Inputs: ${JSON.stringify(inputs)}`, 
    {
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            id: { type: "STRING" },
            merchant: { type: "STRING" },
          },
          required: ["id", "merchant"],
        },
      },
    }
  );

  const text = extractText(response);
  if (text) {
    return JSON.parse(text);
  }
  return [];
};

export const detectAnomalies = async (transactions: Transaction[]): Promise<Array<{ id: string, reason: string }>> => {
  const simplified = transactions.map(t => ({ 
    id: t.id, 
    date: t.date, 
    amount: t.amount, 
    desc: t.description, 
    cat: t.categoryId 
  }));

  const response = await generateContentProxy("gemini-1.5-flash", 
    `Analyze these transactions for anomalies. Look for duplicates, unusually high amounts for a category, or strange patterns. Return IDs and reasons. Data: ${JSON.stringify(simplified)}`,
    {
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            id: { type: "STRING" },
            reason: { type: "STRING" },
          },
          required: ["id", "reason"],
        },
      },
    }
  );

  const text = extractText(response);
  if (text) {
    return JSON.parse(text);
  }
  return [];
};

export const getFinancialInsights = async (transactions: Transaction[], question: string): Promise<string> => {
    const simplified = transactions.slice(0, 100).map(t => `${t.date}: ${t.description} ($${t.amount})`); 

    const response = await generateContentProxy("gemini-1.5-flash", 
        `Context: User's recent financial transactions: ${JSON.stringify(simplified)}.
        
        User Question: ${question}
        
        Provide a helpful, concise financial insight or answer. Identify tax deductible items if relevant.`,
        {}
    );

    return extractText(response) || "I couldn't generate an answer.";
}