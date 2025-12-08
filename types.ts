export enum TransactionType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
  TRANSFER = 'TRANSFER',
  LOAN = 'LOAN',
}

export interface SubCategory {
  id: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
  type: TransactionType;
  subcategories: SubCategory[];
  color?: string;
}

export interface Transaction {
  id: string;
  date: string; // ISO Date string
  description: string;
  amount: number; // Positive for income, negative for expense typically, but handled via type
  type: TransactionType;
  categoryId?: string;
  subcategoryId?: string;
  originalText?: string;
  comments?: string; // User notes
  account?: string; // Source account name (e.g. Chase Checking)
}

export interface DateRange {
  start: Date;
  end: Date;
  label: string;
}

export type PeriodFilter = 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'ALL';