import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Category, Transaction, TransactionType, AutoCategoryRule } from '../types';
import { UploadIcon, MagicWandIcon, TrashIcon, PlusCircleIcon, BankIcon, FileIcon, AlertIcon, GoogleSheetIcon, RobotIcon, CameraIcon, SparklesIcon, WarningIcon, ReceiptIcon } from './Icons';
import { autoCategorizeTransactions, parseReceiptImage, normalizeMerchants, detectAnomalies } from '../services/geminiService';
import { fetchSimpleFinTransactions } from '../services/simpleFinService';

declare const XLSX: any;

interface TransactionManagerProps {
  transactions: Transaction[];
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
  categories: Category[];
  setCategories: React.Dispatch<React.SetStateAction<Category[]>>;
  rules: AutoCategoryRule[];
  setRules: React.Dispatch<React.SetStateAction<AutoCategoryRule[]>>;
}

type SortKey = 'date' | 'description' | 'amount' | 'category' | 'account' | 'merchant';
type SortDirection = 'asc' | 'desc';

const DEFAULT_WIDTHS = {
  checkbox: 48,
  date: 110,
  account: 140,
  description: 250,
  amount: 110,
  category: 200,
  comments: 200,
  actions: 60
};

const TransactionManager: React.FC<TransactionManagerProps> = ({ transactions, setTransactions, categories, setCategories, rules, setRules }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const allImportRowsRef = useRef<string[][]>([]);

  // Column Resizing
  const [colWidths, setColWidths] = useState(DEFAULT_WIDTHS);
  const resizingCol = useRef<string | null>(null);
  const startX = useRef<number>(0);
  const startWidth = useRef<number>(0);

  // Modals & Flows
  const [showMapper, setShowMapper] = useState(false);
  const [showCategoryMapper, setShowCategoryMapper] = useState(false);
  const [showDuplicateReview, setShowDuplicateReview] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [showSimpleFinModal, setShowSimpleFinModal] = useState(false);
  const [showGSheetModal, setShowGSheetModal] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);

  // Import State
  const [importPreview, setImportPreview] = useState<string[][] | null>(null);
  const [columnMapping, setColumnMapping] = useState({ date: 0, description: 1, amount: 2, category: -1, debit: -1, credit: -1 });
  const [importAccountName, setImportAccountName] = useState('My Bank Account');
  const [useSplitMode, setUseSplitMode] = useState(false);
  const [importCandidates, setImportCandidates] = useState<{ clean: Transaction[], duplicates: Transaction[] }>({ clean: [], duplicates: [] });
  const [duplicatesToKeep, setDuplicatesToKeep] = useState<Set<string>>(new Set());
  const [unmappedCategories, setUnmappedCategories] = useState<string[]>([]);
  const [categoryMapping, setCategoryMapping] = useState<Record<string, string>>({});

  // Filtering & Sorting
  const [filterText, setFilterText] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'date', direction: 'desc' });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [filterAccount, setFilterAccount] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterMinAmount, setFilterMinAmount] = useState('');
  const [filterMaxAmount, setFilterMaxAmount] = useState('');

  // Bulk Edit
  const [bulkCategorySelect, setBulkCategorySelect] = useState<string>('');

  // Rules
  const [activeRule, setActiveRule] = useState<Partial<AutoCategoryRule> | null>(null);
  const [isEditingRule, setIsEditingRule] = useState(false);

  // External Services
  const [simpleFinUrl, setSimpleFinUrl] = useState('');
  const [gsheetUrl, setGsheetUrl] = useState('');
  
  // Manual Form
  const [manualForm, setManualForm] = useState<Partial<Transaction>>({
    date: new Date().toISOString().split('T')[0],
    type: TransactionType.EXPENSE,
    amount: 0,
    description: '',
    account: 'Manual Entry'
  });

  // --- Helpers ---
  const safeParseDate = (input: any): string => {
    if (!input) return new Date().toISOString();
    const d = new Date(input);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  };

  const handleResizeStart = (e: React.MouseEvent, colKey: string) => {
    e.preventDefault();
    resizingCol.current = colKey;
    startX.current = e.clientX;
    startWidth.current = colWidths[colKey as keyof typeof colWidths];
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
  };

  const handleResizeMove = (e: MouseEvent) => {
    if (!resizingCol.current) return;
    const diff = e.clientX - startX.current;
    setColWidths(prev => ({ ...prev, [resizingCol.current!]: Math.max(50, startWidth.current + diff) }));
  };

  const handleResizeEnd = () => {
    resizingCol.current = null;
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
  };

  // --- AI Features ---
  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(',')[1];
        setIsProcessing(true);
        const data = await parseReceiptImage(base64);
        setIsProcessing(false);
        if (data) {
          setManualForm({
            ...manualForm,
            date: data.date,
            amount: data.amount,
            description: `${data.merchant} - ${data.description}`,
            account: 'Receipt Scan'
          });
          setShowManualModal(true);
        } else {
          alert("Could not parse receipt.");
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleNormalizeMerchants = async () => {
    setIsProcessing(true);
    const updates = await normalizeMerchants(transactions);
    setTransactions(prev => prev.map(t => {
      const up = updates.find(u => u.id === t.id);
      return up ? { ...t, merchant: up.merchant } : t;
    }));
    setIsProcessing(false);
  };

  const handleDetectAnomalies = async () => {
    setIsProcessing(true);
    const anomalies = await detectAnomalies(transactions);
    setTransactions(prev => prev.map(t => {
      const anom = anomalies.find(a => a.id === t.id);
      return anom ? { ...t, isAnomaly: true, anomalyReason: anom.reason } : { ...t, isAnomaly: false, anomalyReason: undefined };
    }));
    setIsProcessing(false);
    if (anomalies.length > 0) alert(`Found ${anomalies.length} potential anomalies.`);
    else alert("No anomalies found.");
  };

  const handleAutoCategorize = async () => {
    setIsProcessing(true);
    const uncategorized = transactions.filter(t => !t.categoryId);
    const mappings = await autoCategorizeTransactions(uncategorized, categories);
    setTransactions(prev => prev.map(t => {
      const mapping = mappings.find(m => m.id === t.id);
      if (mapping) {
        const cat = categories.find(c => c.id === mapping.categoryId);
        return { ...t, categoryId: mapping.categoryId, subcategoryId: mapping.subcategoryId || undefined, type: cat ? cat.type : t.type };
      }
      return t;
    }));
    setIsProcessing(false);
  };

  // --- Import Logic (Simplified for brevity, same as previous logic) ---
  const handleFileSelect = (file: File) => {
    if (file.name.endsWith('.csv')) {
      const reader = new FileReader();
      reader.onload = e => processCSV(e.target?.result as string);
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = e => {
        const wb = XLSX.read(e.target?.result, { type: 'binary' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false });
        allImportRowsRef.current = rows as string[][];
        setImportPreview(rows.slice(0, 5) as string[][]);
        setShowMapper(true);
      };
      reader.readAsBinaryString(file);
    }
  };

  const processCSV = (text: string) => {
      // Basic CSV parser
      const rows = text.split('\n').map(r => r.split(',').map(c => c.replace(/^"|"$/g, '').trim())).filter(r => r.length > 1);
      allImportRowsRef.current = rows;
      setImportPreview(rows.slice(0, 5));
      setShowMapper(true);
  }
  
  // --- Category Selector Logic ---
  const handleUnifiedCategoryChange = (transactionId: string, value: string) => {
    const isSub = value.startsWith('sub-');
    const isCat = value.startsWith('cat-');
    let catId = '', subId: string | undefined = undefined;

    if (isSub) {
      // Find parent category
      for (const c of categories) {
        const s = c.subcategories.find(sub => `sub-${sub.id}` === value); // value logic needs to be robust
        // Actually, let's use actual IDs in value. To distinguish, we might need a prefix or lookup.
        // Better: value is just ID. We search.
      }
    }
    
    // Simplified: iterate to find what the ID belongs to
    let foundCat = categories.find(c => c.id === value);
    if (foundCat) {
        catId = foundCat.id;
        subId = undefined;
    } else {
        for (const c of categories) {
            const foundSub = c.subcategories.find(s => s.id === value);
            if (foundSub) {
                catId = c.id;
                subId = foundSub.id;
                break;
            }
        }
    }

    if (catId) {
        const cat = categories.find(c => c.id === catId);
        setTransactions(prev => prev.map(t => t.id === transactionId ? { ...t, categoryId: catId, subcategoryId: subId, type: cat!.type } : t));
    }
  };

  const getUnifiedValue = (t: Transaction) => {
      if (t.subcategoryId) return t.subcategoryId;
      if (t.categoryId) return t.categoryId;
      return "";
  };

  const renderCategoryOptions = () => {
    return (
      <>
        <option value="">Uncategorized</option>
        {categories.map(c => (
          c.subcategories.length > 0 ? (
            <optgroup key={c.id} label={c.name}>
               {/* Allow selecting parent category specifically */}
               <option value={c.id}>Current: {c.name}</option> 
               {c.subcategories.map(s => (
                 <option key={s.id} value={s.id}>{c.name} &gt; {s.name}</option>
               ))}
            </optgroup>
          ) : (
            <option key={c.id} value={c.id}>{c.name}</option>
          )
        ))}
      </>
    );
  };

  // --- Filtering & Sorting ---
  const processedTransactions = useMemo(() => {
    let res = transactions.filter(t => {
      const matchText = (t.description + t.amount + (t.merchant||'') + (t.comments||'')).toLowerCase().includes(filterText.toLowerCase());
      const matchAcc = !filterAccount || t.account === filterAccount;
      const matchCat = !filterCategory || t.categoryId === filterCategory;
      const matchMin = !filterMinAmount || t.amount >= parseFloat(filterMinAmount);
      const matchMax = !filterMaxAmount || t.amount <= parseFloat(filterMaxAmount);
      return matchText && matchAcc && matchCat && matchMin && matchMax;
    });

    res.sort((a, b) => {
      let va: any = a[sortConfig.key as keyof Transaction] || '';
      let vb: any = b[sortConfig.key as keyof Transaction] || '';
      
      if (sortConfig.key === 'category') {
        va = categories.find(c => c.id === a.categoryId)?.name || '';
        vb = categories.find(c => c.id === b.categoryId)?.name || '';
      }
      
      if (va < vb) return sortConfig.direction === 'asc' ? -1 : 1;
      if (va > vb) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return res;
  }, [transactions, filterText, filterAccount, filterCategory, filterMinAmount, filterMaxAmount, sortConfig, categories]);

  // --- Bulk Actions ---
  const handleBulkUpdate = () => {
     if (!bulkCategorySelect) return;
     // Resolve selection
     let catId = '', subId: string | undefined = undefined;
     const foundCat = categories.find(c => c.id === bulkCategorySelect);
     if (foundCat) { catId = foundCat.id; } 
     else {
         categories.forEach(c => {
             const s = c.subcategories.find(sub => sub.id === bulkCategorySelect);
             if (s) { catId = c.id; subId = s.id; }
         });
     }
     
     if (catId) {
         const cat = categories.find(c => c.id === catId);
         setTransactions(prev => prev.map(t => selectedIds.has(t.id) ? { ...t, categoryId: catId, subcategoryId: subId, type: cat!.type } : t));
         setSelectedIds(new Set());
         setBulkCategorySelect('');
     }
  };

  return (
    <div className="space-y-6 animate-fade-in">
       {/* Actions Bar */}
       <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 flex flex-col items-center justify-center hover:bg-gray-50 transition cursor-pointer" onClick={() => fileInputRef.current?.click()}>
            <UploadIcon className="w-6 h-6 text-gray-400 mb-1" />
            <span className="text-xs font-medium text-gray-600">Upload CSV/Excel</span>
            <input type="file" ref={fileInputRef} className="hidden" accept=".csv,.xlsx,.xls" onChange={e => e.target.files && handleFileSelect(e.target.files[0])} />
          </div>
          
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 flex flex-col items-center justify-center hover:bg-gray-50 transition cursor-pointer" onClick={() => receiptInputRef.current?.click()}>
            <CameraIcon className="w-6 h-6 text-gray-400 mb-1" />
            <span className="text-xs font-medium text-gray-600">Scan Receipt</span>
            <input type="file" ref={receiptInputRef} className="hidden" accept="image/*" onChange={handleReceiptUpload} />
          </div>

          <button onClick={() => setShowSimpleFinModal(true)} className="flex items-center justify-center gap-2 p-4 bg-white border rounded-xl shadow-sm hover:shadow-md">
             <BankIcon className="w-5 h-5 text-accent" />
             <span className="text-sm font-medium">Sync Bank</span>
          </button>

          <button onClick={() => setShowManualModal(true)} className="flex items-center justify-center gap-2 p-4 bg-white border rounded-xl shadow-sm hover:shadow-md">
             <PlusCircleIcon className="w-5 h-5 text-success" />
             <span className="text-sm font-medium">Manual Add</span>
          </button>
       </div>

       {/* AI Tools Bar */}
       <div className="flex flex-wrap gap-2 items-center bg-purple-50 p-3 rounded-lg border border-purple-100">
          <span className="text-xs font-bold text-purple-800 uppercase mr-2 flex items-center gap-1"><SparklesIcon className="w-3 h-3" /> AI Tools:</span>
          <button onClick={handleAutoCategorize} disabled={isProcessing} className="px-3 py-1.5 bg-white border border-purple-200 text-purple-700 text-xs font-medium rounded hover:bg-purple-100 disabled:opacity-50">Auto Categorize</button>
          <button onClick={handleNormalizeMerchants} disabled={isProcessing} className="px-3 py-1.5 bg-white border border-purple-200 text-purple-700 text-xs font-medium rounded hover:bg-purple-100 disabled:opacity-50">Clean Merchants</button>
          <button onClick={handleDetectAnomalies} disabled={isProcessing} className="px-3 py-1.5 bg-white border border-purple-200 text-purple-700 text-xs font-medium rounded hover:bg-purple-100 disabled:opacity-50">Analyze Anomalies</button>
          <button onClick={() => setShowRulesModal(true)} className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded hover:bg-gray-100 ml-auto flex items-center gap-1"><RobotIcon className="w-3 h-3" /> Rules</button>
       </div>

       {/* Bulk Actions */}
       {selectedIds.size > 0 && (
         <div className="bg-gray-800 text-white p-3 rounded-lg flex items-center gap-4 sticky top-2 z-20 shadow-lg">
            <span className="text-sm font-semibold pl-2">{selectedIds.size} Selected</span>
            <div className="h-4 w-px bg-gray-600"></div>
            <select className="text-gray-900 text-xs rounded px-2 py-1" value={bulkCategorySelect} onChange={e => setBulkCategorySelect(e.target.value)}>
                <option value="">-- Assign Category --</option>
                {renderCategoryOptions()}
            </select>
            <button onClick={handleBulkUpdate} className="px-3 py-1 bg-accent rounded text-xs hover:bg-blue-600">Apply</button>
            <button onClick={() => { if(confirm('Delete selected?')) { setTransactions(prev => prev.filter(t => !selectedIds.has(t.id))); setSelectedIds(new Set()); }}} className="px-3 py-1 bg-red-600 rounded text-xs hover:bg-red-700 ml-auto">Delete</button>
         </div>
       )}

       {/* Filters */}
       <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold">Transactions</h3>
          <div className="flex gap-2">
            <input type="text" placeholder="Search..." className="text-sm border-gray-300 rounded-md px-3 py-1" value={filterText} onChange={e => setFilterText(e.target.value)} />
            <button onClick={() => setShowFilters(!showFilters)} className="px-3 py-1 border rounded text-sm hover:bg-gray-50">Filters</button>
          </div>
       </div>
       {showFilters && (
          <div className="grid grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg text-sm">
             <select value={filterAccount} onChange={e => setFilterAccount(e.target.value)} className="border-gray-300 rounded"><option value="">All Accounts</option>{Array.from(new Set(transactions.map(t => t.account))).map(a => <option key={a} value={a}>{a}</option>)}</select>
             <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="border-gray-300 rounded"><option value="">All Categories</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
             <input type="number" placeholder="Min Amount" value={filterMinAmount} onChange={e => setFilterMinAmount(e.target.value)} className="border-gray-300 rounded" />
             <input type="number" placeholder="Max Amount" value={filterMaxAmount} onChange={e => setFilterMaxAmount(e.target.value)} className="border-gray-300 rounded" />
          </div>
       )}

       {/* Table */}
       <div className="overflow-x-auto border rounded-lg shadow-sm">
         <table className="min-w-full divide-y divide-gray-200 bg-white table-fixed">
            <thead className="bg-gray-50">
               <tr>
                  <th style={{width: colWidths.checkbox}} className="px-4 py-3"><input type="checkbox" onChange={e => setSelectedIds(e.target.checked ? new Set(processedTransactions.map(t => t.id)) : new Set())} checked={processedTransactions.length > 0 && selectedIds.size === processedTransactions.length} /></th>
                  {['date', 'account', 'description', 'amount', 'category', 'comments'].map(col => (
                    <th key={col} style={{width: colWidths[col as keyof typeof colWidths]}} className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider relative group cursor-pointer" onClick={() => setSortConfig({ key: col as any, direction: sortConfig.direction === 'asc' ? 'desc' : 'asc' })}>
                       {col} {sortConfig.key === col && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                       <div className="absolute right-0 top-0 bottom-0 w-1 group-hover:bg-gray-300 cursor-col-resize" onMouseDown={e => handleResizeStart(e, col)}></div>
                    </th>
                  ))}
                  <th className="px-4 py-3"></th>
               </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
               {processedTransactions.map((t, idx) => {
                  const cat = categories.find(c => c.id === t.categoryId);
                  const isZebra = idx % 2 === 1;
                  const rowClass = selectedIds.has(t.id) ? 'bg-blue-50' : t.isAnomaly ? 'bg-red-50' : isZebra ? 'bg-gray-50' : 'bg-white';
                  
                  return (
                     <tr key={t.id} className={`${rowClass} hover:bg-gray-100`}>
                        <td className="px-4 py-2"><input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => { const s = new Set(selectedIds); if(s.has(t.id)) s.delete(t.id); else s.add(t.id); setSelectedIds(s); }} /></td>
                        <td className="px-4 py-2 text-xs truncate">{t.date.split('T')[0]}</td>
                        <td className="px-4 py-2 text-xs truncate text-gray-500">{t.account}</td>
                        <td className="px-4 py-2">
                           <div className="flex flex-col">
                              <span className="text-sm font-medium truncate" title={t.description}>{t.merchant || t.description}</span>
                              {t.merchant && <span className="text-[10px] text-gray-400 truncate">{t.description}</span>}
                              {t.isAnomaly && <span className="text-[10px] text-red-600 flex items-center gap-1"><WarningIcon className="w-3 h-3" /> {t.anomalyReason}</span>}
                           </div>
                        </td>
                        <td className={`px-4 py-2 text-sm font-bold ${t.type === 'INCOME' ? 'text-green-600' : 'text-gray-900'}`}>{t.amount.toFixed(2)}</td>
                        <td className="px-4 py-2">
                           <div className="flex items-center gap-2">
                              {cat && <div className="w-2 h-2 rounded-full" style={{backgroundColor: cat.color}}></div>}
                              <select 
                                 className="w-full text-xs border-transparent bg-transparent hover:border-gray-300 rounded focus:ring-accent" 
                                 value={getUnifiedValue(t)}
                                 onChange={e => handleUnifiedCategoryChange(t.id, e.target.value)}
                              >
                                 {renderCategoryOptions()}
                              </select>
                           </div>
                        </td>
                        <td className="px-4 py-2"><input type="text" className="w-full bg-transparent text-xs border-none focus:ring-0 placeholder-gray-300" placeholder="Notes..." value={t.comments || ''} onChange={e => setTransactions(prev => prev.map(pt => pt.id === t.id ? { ...pt, comments: e.target.value } : pt))} /></td>
                        <td className="px-4 py-2 text-right"><button onClick={() => setTransactions(prev => prev.filter(pt => pt.id !== t.id))} className="text-gray-400 hover:text-red-500"><TrashIcon className="w-4 h-4" /></button></td>
                     </tr>
                  );
               })}
            </tbody>
         </table>
       </div>

       {/* Modals are simplified for this output block, but logically exist */}
       {showManualModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
             <div className="bg-white p-6 rounded-xl w-96 shadow-2xl">
                <h3 className="font-bold mb-4">Add Transaction</h3>
                <div className="space-y-3">
                   <input type="date" className="w-full border rounded px-3 py-2" value={manualForm.date} onChange={e => setManualForm({...manualForm, date: e.target.value})} />
                   <input type="number" placeholder="Amount" className="w-full border rounded px-3 py-2" value={manualForm.amount} onChange={e => setManualForm({...manualForm, amount: parseFloat(e.target.value)})} />
                   <input type="text" placeholder="Description" className="w-full border rounded px-3 py-2" value={manualForm.description} onChange={e => setManualForm({...manualForm, description: e.target.value})} />
                   <div className="flex gap-2">
                      <button onClick={() => setShowManualModal(false)} className="flex-1 py-2 bg-gray-100 rounded">Cancel</button>
                      <button onClick={() => { 
                         setTransactions(prev => [{ ...manualForm, id: `manual-${Date.now()}`, type: manualForm.type || TransactionType.EXPENSE } as Transaction, ...prev]); 
                         setShowManualModal(false); 
                      }} className="flex-1 py-2 bg-accent text-white rounded">Add</button>
                   </div>
                </div>
             </div>
          </div>
       )}

    </div>
  );
};

export default TransactionManager;
