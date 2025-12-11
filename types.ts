
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
  account?: string; // Source account name
  merchant?: string; // Normalized merchant name (AI)
  isAnomaly?: boolean; // Flagged by AI
  anomalyReason?: string; // Reason for flag
}

export interface ReconciliationOrder {
  id: string;
  date: string;
  description: string;
  amount: number;
  orderStatus?: string;
  paymentAccount?: string;
  category?: string; // e.g. Amazon Category
  itemDetails?: string;
  matchedTransactionId?: string;
}

export interface ReconciliationMatchSuggestion {
  type: 'EXACT' | 'BUNDLE' | 'SEMANTIC' | 'DISCREPANCY';
  transactionId: string;
  orderIds: string[];
  confidence: number;
  reason: string;
  discrepancyAmount?: number;
}

export interface DateRange {
  start: Date;
  end: Date;
  label: string;
}

export type PeriodFilter = 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'ALL';

// Rule Engine Types
export type RuleOperator = 'contains' | 'equals' | 'starts_with' | 'ends_with' | 'greater' | 'less';
export type RuleField = 'description' | 'amount' | 'account';
export type RuleLogic = 'AND' | 'OR';

export interface RuleCondition {
  id: string;
  field: RuleField;
  operator: RuleOperator;
  value: string;
}

export interface AutoCategoryRule {
  id: string;
  name: string;
  matchLogic: RuleLogic;
  conditions: RuleCondition[];
  targetCategoryId: string;
  targetSubcategoryId?: string;
  isActive: boolean;
}
