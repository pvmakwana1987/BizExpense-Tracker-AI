import React, { useState, useRef, useMemo } from 'react';
import { Category, Transaction, TransactionType } from '../types';
import { UploadIcon, MagicWandIcon, TrashIcon, PlusCircleIcon, BankIcon, ChevronDownIcon } from './Icons';
import { autoCategorizeTransactions } from '../services/geminiService';
import { fetchSimpleFinTransactions } from '../services/simpleFinService';

interface TransactionManagerProps {
  transactions: Transaction[];
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
  categories: Category[];
}

type SortKey = 'date' | 'description' | 'amount' | 'category' | 'account';
type SortDirection = 'asc' | 'desc';

const TransactionManager: React.FC<TransactionManagerProps> = ({ transactions, setTransactions, categories }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const allCsvRowsRef = useRef<string[][]>([]);

  // CSV Parsing State
  const [csvPreview, setCsvPreview] = useState<string[][] | null>(null);
  const [columnMapping, setColumnMapping] = useState({ date: 0, description: 1, amount: 2 });
  const [importAccountName, setImportAccountName] = useState('My Bank Account');
  const [showMapper, setShowMapper] = useState(false);

  // Filter State
  const [filterText, setFilterText] = useState('');
  const [filterAccount, setFilterAccount] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterMinAmount, setFilterMinAmount] = useState('');
  const [filterMaxAmount, setFilterMaxAmount] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Sort State
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'date', direction: 'desc' });

  // Bulk Edit State
  const [bulkCategory, setBulkCategory] = useState<string>('');
  const [bulkSubcategory, setBulkSubcategory] = useState<string>('');

  // Modals
  const [showManualModal, setShowManualModal] = useState(false);
  const [showSimpleFinModal, setShowSimpleFinModal] = useState(false);

  // SimpleFin State
  const [simpleFinUrl, setSimpleFinUrl] = useState('');
  const [simpleFinLoading, setSimpleFinLoading] = useState(false);
  const [simpleFinError, setSimpleFinError] = useState('');

  // Manual Add State
  const [manualForm, setManualForm] = useState<Partial<Transaction>>({
    date: new Date().toISOString().split('T')[0],
    type: TransactionType.EXPENSE,
    amount: 0,
    description: '',
    comments: '',
    categoryId: '',
    subcategoryId: '',
    account: 'Manual Entry'
  });

  // Derived Data: Unique Accounts for Filter
  const uniqueAccounts = useMemo(() => {
    const accounts = new Set(transactions.map(t => t.account).filter(Boolean));
    return Array.from(accounts).sort();
  }, [transactions]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      parseCSV(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      parseCSV(e.target.files[0]);
    }
  };

  const parseCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      
      const rows = text.split('\n').map(row => {
        const result: string[] = [];
        let cell = '';
        let inQuotes = false;
        
        for (let i = 0; i < row.length; i++) {
          const char = row[i];
          if (char === '"') {
            if (inQuotes && row[i + 1] === '"') {
              cell += '"';
              i++; 
            } else {
              inQuotes = !inQuotes;
            }
          } else if (char === ',' && !inQuotes) {
            result.push(cell);
            cell = '';
          } else {
            cell += char;
          }
        }
        result.push(cell);
        
        return result.map(c => c.trim());
      }).filter(r => r.length > 1);

      setCsvPreview(rows.slice(0, 5));
      setShowMapper(true);
      allCsvRowsRef.current = rows;
    };
    reader.readAsText(file);
  };

  const handleImportConfirm = () => {
    const rows = allCsvRowsRef.current;
    const newTransactions: Transaction[] = rows.slice(1).map((row, index) => {
       const dateStr = row[columnMapping.date]?.replace(/"/g, '').trim();
       const descStr = row[columnMapping.description]?.replace(/"/g, '').trim();
       const amountStr = row[columnMapping.amount]?.replace(/"/g, '').replace('$', '').replace(',', '').trim();
       
       const amount = parseFloat(amountStr);
       const date = new Date(dateStr).toISOString();

       const type = amount < 0 ? TransactionType.EXPENSE : TransactionType.INCOME;
       const absAmount = Math.abs(amount);

       return {
         id: `txn-${Date.now()}-${index}`,
         date: isNaN(new Date(date).getTime()) ? new Date().toISOString() : date,
         description: descStr || "Unknown Transaction",
         amount: isNaN(absAmount) ? 0 : absAmount,
         type: type,
         categoryId: undefined,
         subcategoryId: undefined,
         account: importAccountName
       };
    }).filter(t => t.amount !== 0);

    setTransactions(prev => [...prev, ...newTransactions]);
    setShowMapper(false);
    setCsvPreview(null);
    allCsvRowsRef.current = [];
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAutoCategorize = async () => {
    setIsProcessing(true);
    const uncategorized = transactions.filter(t => !t.categoryId);
    const mappings = await autoCategorizeTransactions(uncategorized, categories);
    
    setTransactions(prev => prev.map(t => {
      const mapping = mappings.find(m => m.id === t.id);
      if (mapping) {
        const category = categories.find(c => c.id === mapping.categoryId);
        return { 
          ...t, 
          categoryId: mapping.categoryId, 
          subcategoryId: mapping.subcategoryId || undefined,
          type: category ? category.type : t.type 
        };
      }
      return t;
    }));
    setIsProcessing(false);
  };

  const handleDelete = (id: string) => {
    setTransactions(prev => prev.filter(t => t.id !== id));
    if (selectedIds.has(id)) {
      const newSelected = new Set(selectedIds);
      newSelected.delete(id);
      setSelectedIds(newSelected);
    }
  };

  // Filter & Sort Logic
  const filteredAndSortedTransactions = useMemo(() => {
    let result = transactions.filter(t => {
      const matchesText = t.description.toLowerCase().includes(filterText.toLowerCase()) || 
                          (t.comments && t.comments.toLowerCase().includes(filterText.toLowerCase()));
      const matchesAccount = filterAccount ? t.account === filterAccount : true;
      const matchesCategory = filterCategory ? t.categoryId === filterCategory : true;
      const matchesMin = filterMinAmount ? t.amount >= parseFloat(filterMinAmount) : true;
      const matchesMax = filterMaxAmount ? t.amount <= parseFloat(filterMaxAmount) : true;

      return matchesText && matchesAccount && matchesCategory && matchesMin && matchesMax;
    });

    result.sort((a, b) => {
      let valA: any = '';
      let valB: any = '';

      switch (sortConfig.key) {
        case 'date':
          valA = new Date(a.date).getTime();
          valB = new Date(b.date).getTime();
          break;
        case 'amount':
          valA = a.amount;
          valB = b.amount;
          break;
        case 'description':
          valA = a.description.toLowerCase();
          valB = b.description.toLowerCase();
          break;
        case 'account':
          valA = (a.account || '').toLowerCase();
          valB = (b.account || '').toLowerCase();
          break;
        case 'category':
          const catA = categories.find(c => c.id === a.categoryId)?.name || '';
          const catB = categories.find(c => c.id === b.categoryId)?.name || '';
          valA = catA.toLowerCase();
          valB = catB.toLowerCase();
          break;
      }

      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [transactions, filterText, filterAccount, filterCategory, filterMinAmount, filterMaxAmount, sortConfig, categories]);

  const handleSort = (key: SortKey) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const getSortIcon = (key: SortKey) => {
    if (sortConfig.key !== key) return <div className="w-3 h-3 inline-block ml-1 opacity-20">↕</div>;
    return <div className="w-3 h-3 inline-block ml-1">{sortConfig.direction === 'asc' ? '↑' : '↓'}</div>;
  };

  // Selection Logic
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const ids = new Set(filteredAndSortedTransactions.map(t => t.id));
      setSelectedIds(ids);
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectOne = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleBulkUpdate = () => {
    if (!bulkCategory) return;
    
    const category = categories.find(c => c.id === bulkCategory);
    if (!category) return;

    setTransactions(prev => prev.map(t => {
      if (selectedIds.has(t.id)) {
        return {
          ...t,
          categoryId: bulkCategory,
          subcategoryId: bulkSubcategory || undefined,
          type: category.type
        };
      }
      return t;
    }));
    
    setSelectedIds(new Set());
    setBulkCategory('');
    setBulkSubcategory('');
  };

  const handleCategoryChange = (transactionId: string, newCategoryId: string) => {
    const category = categories.find(c => c.id === newCategoryId);
    setTransactions(prev => prev.map(pt => {
        if (pt.id === transactionId) {
            return { 
                ...pt, 
                categoryId: newCategoryId, 
                subcategoryId: undefined,
                type: category ? category.type : pt.type
            };
        }
        return pt;
    }));
  };

  const handleCommentChange = (transactionId: string, newComment: string) => {
    setTransactions(prev => prev.map(pt => {
        if (pt.id === transactionId) {
            return { ...pt, comments: newComment };
        }
        return pt;
    }));
  };

  // SimpleFin Logic
  const handleSimpleFinSync = async () => {
    if (!simpleFinUrl) {
      setSimpleFinError("Please enter a valid Access URL.");
      return;
    }
    setSimpleFinLoading(true);
    setSimpleFinError('');
    try {
      const newTransactions = await fetchSimpleFinTransactions(simpleFinUrl);
      setTransactions(prev => [...prev, ...newTransactions]);
      setShowSimpleFinModal(false);
      setSimpleFinUrl('');
    } catch (err: any) {
      setSimpleFinError(err.message || "Failed to sync.");
    } finally {
      setSimpleFinLoading(false);
    }
  };

  // Manual Add Logic
  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const newTxn: Transaction = {
      id: `manual-${Date.now()}`,
      date: new Date(manualForm.date!).toISOString(),
      description: manualForm.description || 'Manual Transaction',
      amount: Number(manualForm.amount),
      type: manualForm.type || TransactionType.EXPENSE,
      categoryId: manualForm.categoryId || undefined,
      subcategoryId: manualForm.subcategoryId || undefined,
      comments: manualForm.comments || '',
      account: manualForm.account || 'Manual Entry'
    };
    setTransactions(prev => [newTxn, ...prev]);
    setShowManualModal(false);
    // Reset form
    setManualForm({
      date: new Date().toISOString().split('T')[0],
      type: TransactionType.EXPENSE,
      amount: 0,
      description: '',
      comments: '',
      categoryId: '',
      subcategoryId: '',
      account: 'Manual Entry'
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Action Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Upload Area */}
        <div 
          className={`col-span-1 md:col-span-1 border-2 border-dashed rounded-xl p-6 text-center transition-colors flex flex-col justify-center items-center ${isDragging ? 'border-accent bg-blue-50' : 'border-gray-300 hover:border-accent/50'}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <UploadIcon className="h-8 w-8 text-gray-400 mb-2" />
          <h3 className="text-sm font-medium text-gray-900">Upload CSV</h3>
          <p className="text-xs text-gray-500 mb-2">Drag & drop or click</p>
          <input 
            type="file" 
            accept=".csv" 
            ref={fileInputRef} 
            className="hidden" 
            onChange={handleFileChange} 
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1 bg-white border border-gray-300 rounded text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Browse
          </button>
        </div>

        {/* Sync & Manual Actions */}
        <div className="col-span-1 md:col-span-2 grid grid-cols-2 gap-4">
          <button 
            onClick={() => setShowSimpleFinModal(true)}
            className="flex flex-col items-center justify-center p-6 bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow group"
          >
            <BankIcon className="h-8 w-8 text-accent mb-2 group-hover:scale-110 transition-transform" />
            <span className="text-sm font-bold text-gray-900">Sync Bank</span>
            <span className="text-xs text-gray-500">Connect via SimpleFin</span>
          </button>
          
          <button 
            onClick={() => setShowManualModal(true)}
            className="flex flex-col items-center justify-center p-6 bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow group"
          >
            <PlusCircleIcon className="h-8 w-8 text-success mb-2 group-hover:scale-110 transition-transform" />
            <span className="text-sm font-bold text-gray-900">Add Manually</span>
            <span className="text-xs text-gray-500">Enter transaction details</span>
          </button>
        </div>
      </div>

      {/* CSV Mapper Modal (Inline) */}
      {showMapper && csvPreview && (
        <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200">
          <h3 className="text-lg font-bold mb-4">Map CSV Columns</h3>
          <div className="overflow-x-auto mb-4">
             <table className="min-w-full text-xs text-left text-gray-500">
               <thead className="bg-gray-50 text-gray-700 uppercase">
                 <tr>
                   {csvPreview[0].map((_, i) => (
                     <th key={i} className="px-2 py-1 border">Col {i}</th>
                   ))}
                 </tr>
               </thead>
               <tbody>
                 {csvPreview.slice(0, 3).map((row, i) => (
                   <tr key={i} className="border-b">
                     {row.map((cell, j) => (
                       <td key={j} className="px-2 py-1 border truncate max-w-[100px]">{cell}</td>
                     ))}
                   </tr>
                 ))}
               </tbody>
             </table>
          </div>
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Date Column</label>
              <select 
                className="mt-1 block w-full text-sm border-gray-300 rounded-md"
                value={columnMapping.date}
                onChange={(e) => setColumnMapping({...columnMapping, date: parseInt(e.target.value)})}
              >
                {csvPreview[0].map((_, i) => <option key={i} value={i}>Column {i}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Description Column</label>
              <select 
                className="mt-1 block w-full text-sm border-gray-300 rounded-md"
                value={columnMapping.description}
                onChange={(e) => setColumnMapping({...columnMapping, description: parseInt(e.target.value)})}
              >
                {csvPreview[0].map((_, i) => <option key={i} value={i}>Column {i}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Amount Column</label>
              <select 
                className="mt-1 block w-full text-sm border-gray-300 rounded-md"
                value={columnMapping.amount}
                onChange={(e) => setColumnMapping({...columnMapping, amount: parseInt(e.target.value)})}
              >
                {csvPreview[0].map((_, i) => <option key={i} value={i}>Column {i}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Account Name</label>
              <input 
                type="text"
                className="mt-1 block w-full text-sm border-gray-300 rounded-md"
                value={importAccountName}
                onChange={(e) => setImportAccountName(e.target.value)}
                placeholder="e.g. Chase Visa"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowMapper(false)} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded">Cancel</button>
            <button onClick={handleImportConfirm} className="px-4 py-2 text-sm bg-accent text-white rounded hover:bg-blue-600">Import Transactions</button>
          </div>
        </div>
      )}

      {/* Manual Add Modal */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in">
            <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
              <h3 className="font-bold text-gray-900">Add Transaction</h3>
              <button onClick={() => setShowManualModal(false)} className="text-gray-400 hover:text-gray-600">&times;</button>
            </div>
            <form onSubmit={handleManualAdd} className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700">Date</label>
                  <input type="date" required 
                    className="mt-1 block w-full text-sm border-gray-300 rounded-md"
                    value={manualForm.date}
                    onChange={e => setManualForm({...manualForm, date: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700">Amount</label>
                  <input type="number" step="0.01" required 
                    className="mt-1 block w-full text-sm border-gray-300 rounded-md"
                    value={manualForm.amount}
                    onChange={e => setManualForm({...manualForm, amount: parseFloat(e.target.value)})}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                   <label className="block text-xs font-medium text-gray-700">Description</label>
                   <input type="text" required placeholder="e.g. Office Supplies"
                     className="mt-1 block w-full text-sm border-gray-300 rounded-md"
                     value={manualForm.description}
                     onChange={e => setManualForm({...manualForm, description: e.target.value})}
                   />
                </div>
                <div>
                   <label className="block text-xs font-medium text-gray-700">Account</label>
                   <input type="text" required placeholder="e.g. Petty Cash"
                     className="mt-1 block w-full text-sm border-gray-300 rounded-md"
                     value={manualForm.account}
                     onChange={e => setManualForm({...manualForm, account: e.target.value})}
                   />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700">Type</label>
                  <select 
                    className="mt-1 block w-full text-sm border-gray-300 rounded-md"
                    value={manualForm.type}
                    onChange={e => setManualForm({...manualForm, type: e.target.value as TransactionType})}
                  >
                    <option value={TransactionType.EXPENSE}>Expense</option>
                    <option value={TransactionType.INCOME}>Income</option>
                    <option value={TransactionType.TRANSFER}>Transfer</option>
                    <option value={TransactionType.LOAN}>Loan</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700">Category</label>
                  <select 
                    className="mt-1 block w-full text-sm border-gray-300 rounded-md"
                    value={manualForm.categoryId || ''}
                    onChange={e => setManualForm({...manualForm, categoryId: e.target.value, subcategoryId: ''})}
                  >
                    <option value="">Select...</option>
                    {categories.filter(c => c.type === manualForm.type).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              {manualForm.categoryId && (
                <div>
                  <label className="block text-xs font-medium text-gray-700">Subcategory</label>
                  <select 
                     className="mt-1 block w-full text-sm border-gray-300 rounded-md"
                     value={manualForm.subcategoryId || ''}
                     onChange={e => setManualForm({...manualForm, subcategoryId: e.target.value})}
                  >
                    <option value="">None</option>
                    {categories.find(c => c.id === manualForm.categoryId)?.subcategories.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-700">Comments</label>
                <textarea 
                  rows={2}
                  className="mt-1 block w-full text-sm border-gray-300 rounded-md"
                  placeholder="Additional notes..."
                  value={manualForm.comments}
                  onChange={e => setManualForm({...manualForm, comments: e.target.value})}
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowManualModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm bg-primary text-white rounded hover:bg-slate-800">Add Transaction</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SimpleFin Modal */}
      {showSimpleFinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in">
            <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
               <div className="flex items-center gap-2">
                 <BankIcon className="w-5 h-5 text-accent" />
                 <h3 className="font-bold text-gray-900">Sync with SimpleFin</h3>
               </div>
               <button onClick={() => setShowSimpleFinModal(false)} className="text-gray-400 hover:text-gray-600">&times;</button>
            </div>
            <div className="p-6">
              <p className="text-sm text-gray-600 mb-4">
                Enter your SimpleFin Access URL to sync transactions.
                <br/>
                <a href="https://beta-bridge.simplefin.org/" target="_blank" rel="noreferrer" className="text-accent hover:underline text-xs">Get a SimpleFin token</a>
              </p>
              
              <div className="space-y-4">
                <div>
                   <label className="block text-xs font-medium text-gray-700">Access URL</label>
                   <input 
                     type="password" 
                     className="mt-1 block w-full text-sm border-gray-300 rounded-md"
                     placeholder="https://<user>:<pass>@bridge.simplefin.org/..."
                     value={simpleFinUrl}
                     onChange={e => setSimpleFinUrl(e.target.value)}
                   />
                </div>
                {simpleFinError && (
                  <div className="text-xs text-danger bg-red-50 p-2 rounded">{simpleFinError}</div>
                )}
                <button 
                  onClick={handleSimpleFinSync}
                  disabled={simpleFinLoading}
                  className="w-full py-2 bg-accent text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
                >
                  {simpleFinLoading ? 'Syncing...' : 'Sync Now'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="bg-primary text-white p-4 rounded-xl shadow-lg flex flex-wrap gap-4 items-center justify-between sticky top-4 z-20 animate-fade-in">
          <div className="flex items-center gap-4">
             <span className="font-semibold">{selectedIds.size} selected</span>
             <div className="flex gap-2">
               <select 
                 className="text-gray-900 text-sm rounded-md border-none px-3 py-1.5 focus:ring-2 focus:ring-accent"
                 value={bulkCategory}
                 onChange={(e) => {
                   setBulkCategory(e.target.value);
                   setBulkSubcategory('');
                 }}
               >
                 <option value="">Select Category...</option>
                 {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
               </select>
               <select 
                 className="text-gray-900 text-sm rounded-md border-none px-3 py-1.5 focus:ring-2 focus:ring-accent"
                 value={bulkSubcategory}
                 onChange={(e) => setBulkSubcategory(e.target.value)}
                 disabled={!bulkCategory}
               >
                 <option value="">Select Subcategory...</option>
                 {bulkCategory && categories.find(c => c.id === bulkCategory)?.subcategories.map(s => (
                   <option key={s.id} value={s.id}>{s.name}</option>
                 ))}
               </select>
             </div>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={handleBulkUpdate}
              className="px-4 py-1.5 bg-success hover:bg-emerald-600 rounded text-sm font-medium transition-colors"
            >
              Apply to All
            </button>
            <button 
              onClick={() => setSelectedIds(new Set())}
              className="px-4 py-1.5 bg-white/10 hover:bg-white/20 rounded text-sm font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Transaction List Container */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Header / Controls */}
        <div className="p-4 border-b border-gray-200 space-y-4">
           <div className="flex justify-between items-center flex-wrap gap-4">
             <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-gray-900">Transactions</h2>
                <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs font-medium">{transactions.length}</span>
             </div>
             
             <div className="flex gap-2">
                <button 
                  onClick={() => setShowFilters(!showFilters)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${showFilters ? 'bg-gray-100 border-gray-300' : 'bg-white border-gray-200 hover:bg-gray-50'}`}
                >
                  Filters {showFilters ? '▲' : '▼'}
                </button>
                <input 
                  type="text" 
                  placeholder="Search..." 
                  className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-accent focus:border-accent"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                />
                <button 
                  onClick={handleAutoCategorize}
                  disabled={isProcessing || transactions.length === 0}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium text-white transition-colors ${isProcessing ? 'bg-purple-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700'}`}
                >
                  {isProcessing ? 'Processing...' : <><MagicWandIcon className="w-4 h-4" /> Auto Categorize</>}
                </button>
             </div>
           </div>
           
           {/* Advanced Filters Panel */}
           {showFilters && (
             <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-2 animate-fade-in">
                <div>
                   <label className="block text-xs font-medium text-gray-500 mb-1">Account</label>
                   <select 
                     className="w-full text-sm border-gray-300 rounded-md"
                     value={filterAccount}
                     onChange={e => setFilterAccount(e.target.value)}
                   >
                     <option value="">All Accounts</option>
                     {uniqueAccounts.map(acc => <option key={acc} value={acc}>{acc}</option>)}
                   </select>
                </div>
                <div>
                   <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
                   <select 
                     className="w-full text-sm border-gray-300 rounded-md"
                     value={filterCategory}
                     onChange={e => setFilterCategory(e.target.value)}
                   >
                     <option value="">All Categories</option>
                     {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                   </select>
                </div>
                <div>
                   <label className="block text-xs font-medium text-gray-500 mb-1">Min Amount</label>
                   <input 
                     type="number" 
                     className="w-full text-sm border-gray-300 rounded-md"
                     value={filterMinAmount}
                     onChange={e => setFilterMinAmount(e.target.value)}
                     placeholder="0.00"
                   />
                </div>
                <div>
                   <label className="block text-xs font-medium text-gray-500 mb-1">Max Amount</label>
                   <input 
                     type="number" 
                     className="w-full text-sm border-gray-300 rounded-md"
                     value={filterMaxAmount}
                     onChange={e => setFilterMaxAmount(e.target.value)}
                     placeholder="0.00"
                   />
                </div>
             </div>
           )}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left w-10">
                  <input 
                    type="checkbox" 
                    className="rounded text-accent focus:ring-accent"
                    checked={filteredAndSortedTransactions.length > 0 && selectedIds.size === filteredAndSortedTransactions.length}
                    onChange={handleSelectAll}
                  />
                </th>
                <th 
                  scope="col" 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24 cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('date')}
                >
                  Date {getSortIcon('date')}
                </th>
                <th 
                  scope="col" 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32 cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('account')}
                >
                  Account {getSortIcon('account')}
                </th>
                <th 
                  scope="col" 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('description')}
                >
                  Description {getSortIcon('description')}
                </th>
                <th 
                  scope="col" 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32 cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('amount')}
                >
                  Amount {getSortIcon('amount')}
                </th>
                <th 
                  scope="col" 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48 cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('category')}
                >
                  Category {getSortIcon('category')}
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Comments</th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-12"></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredAndSortedTransactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-500 text-sm">
                    No transactions found matching your filters.
                  </td>
                </tr>
              ) : (
                filteredAndSortedTransactions.map((t) => (
                  <tr key={t.id} className={`hover:bg-gray-50 transition-colors ${selectedIds.has(t.id) ? 'bg-blue-50' : ''}`}>
                    <td className="px-4 py-4 whitespace-nowrap">
                       <input 
                         type="checkbox" 
                         className="rounded text-accent focus:ring-accent"
                         checked={selectedIds.has(t.id)}
                         onChange={() => handleSelectOne(t.id)}
                       />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                      {new Date(t.date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500 truncate max-w-[120px]" title={t.account}>
                      {t.account || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 max-w-xs truncate" title={t.description}>
                      {t.description}
                      <div className="text-xs text-gray-400 font-normal">{t.type}</div>
                    </td>
                    <td className={`px-6 py-4 whitespace-nowrap text-sm font-bold 
                      ${t.type === TransactionType.INCOME ? 'text-success' : 
                        t.type === TransactionType.EXPENSE ? 'text-gray-900' : 'text-gray-500'}`}>
                      {t.type === TransactionType.INCOME ? '+' : 
                       t.type === TransactionType.EXPENSE ? '-' : ''}${t.amount.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div className="flex flex-col gap-1">
                        <select 
                          className="block w-full text-xs border-gray-300 rounded shadow-sm focus:border-accent focus:ring focus:ring-accent focus:ring-opacity-50"
                          value={t.categoryId || ''}
                          onChange={(e) => handleCategoryChange(t.id, e.target.value)}
                        >
                          <option value="">Uncategorized</option>
                          {categories.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                        
                        {t.categoryId && (
                          <select 
                            className="block w-full text-xs border-gray-300 rounded shadow-sm focus:border-accent focus:ring focus:ring-accent focus:ring-opacity-50"
                            value={t.subcategoryId || ''}
                            onChange={(e) => {
                              const newSub = e.target.value;
                              setTransactions(prev => prev.map(pt => pt.id === t.id ? { ...pt, subcategoryId: newSub } : pt));
                            }}
                          >
                            <option value="">- Subcategory -</option>
                            {categories.find(c => c.id === t.categoryId)?.subcategories.map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <input
                        type="text"
                        placeholder="Add notes..."
                        className="w-full bg-transparent text-xs text-gray-600 border-b border-transparent focus:border-accent focus:bg-white focus:outline-none transition-colors placeholder-gray-300"
                        value={t.comments || ''}
                        onChange={(e) => handleCommentChange(t.id, e.target.value)}
                      />
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button onClick={() => handleDelete(t.id)} className="text-gray-400 hover:text-danger">
                        <TrashIcon className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TransactionManager;