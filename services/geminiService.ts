import { GoogleGenAI, Type } from "@google/genai";
import { Category, Transaction, TransactionType } from "../types";

const SYSTEM_INSTRUCTION = `You are an expert accountant for a small business. 
Your task is to categorize financial transactions into a user-provided set of categories and subcategories.
You will receive a list of transactions (description and amount) and a list of available categories.
Return a JSON array mapping each transaction ID to the most appropriate Category ID and Subcategory ID.

Rules:
1. If a transaction implies income (like "Deposit", "Refund", "Salary"), map it to an INCOME category if available.
2. If it implies spending, map to an EXPENSE category.
3. If it looks like a credit card payment, bank transfer, or internal movement of funds, map to a TRANSFER category.
4. If it looks like a loan disbursement or principal repayment, map to a LOAN category.
5. If you are unsure, leave the categoryId null.
`;

export const autoCategorizeTransactions = async (
  transactions: Transaction[],
  categories: Category[]
): Promise<Array<{ id: string; categoryId: string; subcategoryId: string | null }>> => {
  if (!process.env.API_KEY) {
    console.warn("No API Key found for Gemini.");
    return [];
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // Prepare data for prompt
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
    type: t.type // Hint to model if we already know flow
  }));

  // Batching to prevent context limit issues (simplified to one batch for demo, but good practice)
  // We'll limit to 50 for this demo purpose per call if needed, but here we send all.
  
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
    
    const mappings = JSON.parse(text) as Array<{ id: string; categoryId: string; subcategoryId: string | null }>;
    return mappings;
  } catch (error) {
    console.error("Gemini categorization failed:", error);
    return [];
  }
};