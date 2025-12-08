import React, { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import TransactionManager from './components/TransactionManager';
import CategoryManager from './components/CategoryManager';
import { ChartIcon, ListIcon, SettingsIcon } from './components/Icons';
import { Category, Transaction, TransactionType } from './types';

// Default Data
const DEFAULT_CATEGORIES: Category[] = [
  { id: '1', name: 'Sales', type: TransactionType.INCOME, subcategories: [{ id: '1-1', name: 'Product' }, { id: '1-2', name: 'Service' }] },
  { id: '2', name: 'Rent', type: TransactionType.EXPENSE, subcategories: [] },
  { id: '3', name: 'Utilities', type: TransactionType.EXPENSE, subcategories: [{ id: '3-1', name: 'Internet' }, { id: '3-2', name: 'Electricity' }] },
  { id: '4', name: 'Office Supplies', type: TransactionType.EXPENSE, subcategories: [] },
  { id: '5', name: 'Payroll', type: TransactionType.EXPENSE, subcategories: [] },
  { id: '6', name: 'Travel', type: TransactionType.EXPENSE, subcategories: [{ id: '6-1', name: 'Hotel' }, { id: '6-2', name: 'Flight' }, { id: '6-3', name: 'Meals' }] },
  { id: '7', name: 'Credit Card Payment', type: TransactionType.TRANSFER, subcategories: [] },
  { id: '8', name: 'Savings Transfer', type: TransactionType.TRANSFER, subcategories: [] },
  { id: '9', name: 'Business Loan', type: TransactionType.LOAN, subcategories: [] },
];

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'transactions' | 'settings'>('dashboard');
  
  // Persist State
  const [categories, setCategories] = useState<Category[]>(() => {
    const saved = localStorage.getItem('biztrack_categories');
    return saved ? JSON.parse(saved) : DEFAULT_CATEGORIES;
  });

  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem('biztrack_transactions');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('biztrack_categories', JSON.stringify(categories));
  }, [categories]);

  useEffect(() => {
    localStorage.setItem('biztrack_transactions', JSON.stringify(transactions));
  }, [transactions]);

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-gray-50">
      {/* Sidebar Navigation */}
      <aside className="w-full md:w-64 bg-primary text-white flex-shrink-0 flex flex-col sticky top-0 md:h-screen z-10">
        <div className="p-6 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center">
              <span className="font-bold text-white">B</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight">BizTrack AI</h1>
          </div>
          <p className="text-xs text-gray-400 mt-2">Business Expense Tracker</p>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'dashboard' ? 'bg-secondary text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'
            }`}
          >
            <ChartIcon className="w-5 h-5" />
            Dashboard
          </button>
          <button
            onClick={() => setActiveTab('transactions')}
            className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'transactions' ? 'bg-secondary text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'
            }`}
          >
            <ListIcon className="w-5 h-5" />
            Transactions
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'settings' ? 'bg-secondary text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'
            }`}
          >
            <SettingsIcon className="w-5 h-5" />
            Categories
          </button>
        </nav>

        <div className="p-4 border-t border-gray-800 text-xs text-gray-500">
          <p>&copy; 2024 BizTrack Inc.</p>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto h-screen p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          {activeTab === 'dashboard' && (
            <div className="animate-fade-in">
              <header className="mb-8">
                <h2 className="text-2xl font-bold text-gray-900">Financial Overview</h2>
                <p className="text-gray-500">Track your income, expenses, and profitability.</p>
              </header>
              <Dashboard transactions={transactions} categories={categories} />
            </div>
          )}

          {activeTab === 'transactions' && (
            <div className="animate-fade-in">
              <header className="mb-8">
                <h2 className="text-2xl font-bold text-gray-900">Transaction Management</h2>
                <p className="text-gray-500">Import statements, sync banks, categorize items, and view history.</p>
              </header>
              <TransactionManager 
                transactions={transactions} 
                setTransactions={setTransactions} 
                categories={categories} 
              />
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="animate-fade-in">
              <header className="mb-8">
                <h2 className="text-2xl font-bold text-gray-900">Categories & Settings</h2>
                <p className="text-gray-500">Configure your business spending buckets.</p>
              </header>
              <CategoryManager 
                categories={categories} 
                setCategories={setCategories} 
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;