import { GoogleGenAI, Type } from "@google/genai";
import { Category, Transaction, TransactionType } from "../types";

const SYSTEM_INSTRUCTION = `You are an expert accountant for a small business. 
Your task is to categorize financial transactions into a user-provided set of categories and subcategories.
Return a JSON array mapping each transaction ID to the most appropriate Category ID and Subcategory ID.
`;

const getAI = () => {
  if (!process.env.API_KEY) {
    console.warn("No API Key found for Gemini.");
    return null;
  }
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

export const autoCategorizeTransactions = async (
  transactions: Transaction[],
  categories: Category[]
): Promise<Array<{ id: string; categoryId: string; subcategoryId: string | null }>> => {
  const ai = getAI();
  if (!ai) return [];

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

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              categoryId: { type: Type.STRING },
              subcategoryId: { type: Type.STRING, nullable: true },
            },
            required: ["id", "categoryId"],
          },
        },
      },
    });

    const text = response.text;
    if (!text) return [];
    return JSON.parse(text);
  } catch (error) {
    console.error("Gemini categorization failed:", error);
    return [];
  }
};

export const parseReceiptImage = async (base64Image: string): Promise<Partial<Transaction> | null> => {
  const ai = getAI();
  if (!ai) return null;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image } },
          { text: "Extract the transaction date, merchant name, total amount, and a brief description from this receipt. Return JSON." }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            date: { type: Type.STRING, description: "ISO 8601 Date YYYY-MM-DD" },
            merchant: { type: Type.STRING },
            amount: { type: Type.NUMBER },
            description: { type: Type.STRING },
          },
          required: ["date", "merchant", "amount"],
        },
      }
    });

    if (response.text) {
      return JSON.parse(response.text);
    }
    return null;
  } catch (error) {
    console.error("Receipt parsing failed:", error);
    return null;
  }
};

export const normalizeMerchants = async (transactions: Transaction[]): Promise<Array<{ id: string, merchant: string }>> => {
  const ai = getAI();
  if (!ai) return [];

  const inputs = transactions.filter(t => !t.merchant).map(t => ({ id: t.id, desc: t.description }));
  if (inputs.length === 0) return [];

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Normalize these transaction descriptions to clean merchant names (e.g., 'AMZN Mktp' -> 'Amazon'). Inputs: ${JSON.stringify(inputs)}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              merchant: { type: Type.STRING },
            },
            required: ["id", "merchant"],
          },
        },
      },
    });

    if (response.text) {
      return JSON.parse(response.text);
    }
    return [];
  } catch (error) {
    console.error("Merchant normalization failed:", error);
    return [];
  }
};

export const detectAnomalies = async (transactions: Transaction[]): Promise<Array<{ id: string, reason: string }>> => {
  const ai = getAI();
  if (!ai) return [];

  const simplified = transactions.map(t => ({ 
    id: t.id, 
    date: t.date, 
    amount: t.amount, 
    desc: t.description, 
    cat: t.categoryId 
  }));

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Analyze these transactions for anomalies. Look for duplicates, unusually high amounts for a category, or strange patterns. Return IDs and reasons. Data: ${JSON.stringify(simplified)}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              reason: { type: Type.STRING },
            },
            required: ["id", "reason"],
          },
        },
      },
    });

    if (response.text) {
      return JSON.parse(response.text);
    }
    return [];
  } catch (error) {
    console.error("Anomaly detection failed:", error);
    return [];
  }
};

export const getFinancialInsights = async (transactions: Transaction[], question: string): Promise<string> => {
    const ai = getAI();
    if (!ai) return "AI Service Unavailable";

    // Summarize data to fit context if too large, but for now passing raw
    // In production, you'd aggregate this before sending.
    const simplified = transactions.slice(0, 100).map(t => `${t.date}: ${t.description} ($${t.amount})`); 

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Context: User's recent financial transactions: ${JSON.stringify(simplified)}.
            
            User Question: ${question}
            
            Provide a helpful, concise financial insight or answer. Identify tax deductible items if relevant.`,
        });
        return response.text || "I couldn't generate an answer.";
    } catch (error) {
        console.error("Insights error", error);
        return "Sorry, I encountered an error analyzing your data.";
    }
}
