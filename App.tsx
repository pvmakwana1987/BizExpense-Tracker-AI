import React, { useState, useEffect, useRef } from 'react';
import Dashboard from './components/Dashboard';
import TransactionManager from './components/TransactionManager';
import CategoryManager from './components/CategoryManager';
import Insights from './components/Insights';
import ReconciliationManager from './components/ReconciliationManager';
import { ChartIcon, ListIcon, SettingsIcon, ChatIcon, ScaleIcon } from './components/Icons';
import { Category, Transaction, TransactionType, AutoCategoryRule } from './types';

// Default Data (Fallbacks)
const DEFAULT_CATEGORIES: Category[] = [
  { id: '1', name: 'Sales', type: TransactionType.INCOME, subcategories: [{ id: '1-1', name: 'Product' }, { id: '1-2', name: 'Service' }], color: '#10b981' },
  { id: '2', name: 'Rent', type: TransactionType.EXPENSE, subcategories: [], color: '#ef4444' },
  { id: '3', name: 'Utilities', type: TransactionType.EXPENSE, subcategories: [{ id: '3-1', name: 'Internet' }, { id: '3-2', name: 'Electricity' }], color: '#f59e0b' },
  { id: '4', name: 'Office Supplies', type: TransactionType.EXPENSE, subcategories: [], color: '#6366f1' },
  { id: '5', name: 'Payroll', type: TransactionType.EXPENSE, subcategories: [], color: '#8b5cf6' },
  { id: '6', name: 'Travel', type: TransactionType.EXPENSE, subcategories: [{ id: '6-1', name: 'Hotel' }, { id: '6-2', name: 'Flight' }, { id: '6-3', name: 'Meals' }], color: '#ec4899' },
  { id: '7', name: 'Credit Card Payment', type: TransactionType.TRANSFER, subcategories: [], color: '#94a3b8' },
  { id: '8', name: 'Savings Transfer', type: TransactionType.TRANSFER, subcategories: [], color: '#64748b' },
  { id: '9', name: 'Business Loan', type: TransactionType.LOAN, subcategories: [], color: '#0f172a' },
];

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'transactions' | 'settings' | 'insights' | 'reconciliation'>('dashboard');
  const [isLoading, setIsLoading] = useState(true);
  
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [rules, setRules] = useState<AutoCategoryRule[]>([]);

  // Refs to track first load and debounce timers
  const isLoadedRef = useRef(false);
  // Fix: Use ReturnType<typeof setTimeout> instead of NodeJS.Timeout to avoid namespace error in browser environment
  const saveTimeoutRef = useRef<{[key: string]: ReturnType<typeof setTimeout>}>({});

  // 1. Fetch Data on Mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/bootstrap');
        if (res.ok) {
          const data = await res.json();
          // If DB is empty (first run), use defaults for categories
          setCategories(data.categories.length > 0 ? data.categories : DEFAULT_CATEGORIES);
          setTransactions(data.transactions || []);
          setRules(data.rules || []);
        } else {
           // Fallback to defaults on error
           setCategories(DEFAULT_CATEGORIES);
        }
      } catch (e) {
        console.error("Failed to load data", e);
        setCategories(DEFAULT_CATEGORIES);
      } finally {
        setIsLoading(false);
        // Small delay to ensure initial state setting doesn't trigger auto-save immediately
        setTimeout(() => { isLoadedRef.current = true; }, 500);
      }
    };
    fetchData();
  }, []);

  // 2. Debounced Save Helper
  const scheduleSave = (type: string, data: any) => {
    if (!isLoadedRef.current) return;
    
    // Clear existing timer for this type
    if (saveTimeoutRef.current[type]) {
      clearTimeout(saveTimeoutRef.current[type]);
    }

    // Set new timer (1 second debounce)
    saveTimeoutRef.current[type] = setTimeout(async () => {
      try {
        await fetch(`/api/sync/${type}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        console.log(`Saved ${type}`);
      } catch (e) {
        console.error(`Failed to save ${type}`, e);
      }
    }, 1000);
  };

  // 3. Watchers for Auto-Save
  useEffect(() => { scheduleSave('categories', categories); }, [categories]);
  useEffect(() => { scheduleSave('transactions', transactions); }, [transactions]);
  useEffect(() => { scheduleSave('rules', rules); }, [rules]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
         <div className="flex flex-col items-center gap-4">
             <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin"></div>
             <p className="text-gray-500 font-medium">Loading your business data...</p>
         </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-gray-50">
      {/* Sidebar Navigation */}
      <aside className="w-full md:w-64 bg-primary text-white flex-shrink-0 flex flex-col sticky top-0 md:h-screen z-10">
        <div className="p-6 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center">
              <span className="font-bold text-white">B</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight">BizXpense AI</h1>
          </div>
          <p className="text-xs text-gray-400 mt-2">Business Expense Tracker</p>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <button onClick={() => setActiveTab('dashboard')} className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${activeTab === 'dashboard' ? 'bg-secondary text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}>
            <ChartIcon className="w-5 h-5" /> Dashboard
          </button>
          <button onClick={() => setActiveTab('transactions')} className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${activeTab === 'transactions' ? 'bg-secondary text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}>
            <ListIcon className="w-5 h-5" /> Transactions
          </button>
          <button onClick={() => setActiveTab('reconciliation')} className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${activeTab === 'reconciliation' ? 'bg-secondary text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}>
            <ScaleIcon className="w-5 h-5" /> Reconciliation
          </button>
          <button onClick={() => setActiveTab('insights')} className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${activeTab === 'insights' ? 'bg-secondary text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}>
            <ChatIcon className="w-5 h-5" /> AI Insights
          </button>
          <button onClick={() => setActiveTab('settings')} className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${activeTab === 'settings' ? 'bg-secondary text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}>
            <SettingsIcon className="w-5 h-5" /> Categories
          </button>
        </nav>

        <div className="p-4 border-t border-gray-800 text-xs text-gray-500">
          <p>&copy; 2024 BizXpense Inc.</p>
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
                setCategories={setCategories}
                rules={rules}
                setRules={setRules}
              />
            </div>
          )}

          {activeTab === 'reconciliation' && (
             <div className="animate-fade-in">
                <ReconciliationManager transactions={transactions} setTransactions={setTransactions} />
             </div>
          )}

          {activeTab === 'insights' && (
            <div className="animate-fade-in">
              <header className="mb-8">
                <h2 className="text-2xl font-bold text-gray-900">AI Financial Assistant</h2>
                <p className="text-gray-500">Ask questions about your finances, tax deductions, and trends.</p>
              </header>
              <Insights transactions={transactions} />
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