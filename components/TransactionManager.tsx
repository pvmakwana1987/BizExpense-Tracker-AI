import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Category, Transaction, TransactionType, AutoCategoryRule, RuleCondition, RuleOperator, RuleField, RuleLogic } from '../types';
import { UploadIcon, MagicWandIcon, TrashIcon, PlusCircleIcon, BankIcon, FileIcon, AlertIcon, GoogleSheetIcon, RobotIcon, CameraIcon, SparklesIcon, WarningIcon, ReceiptIcon, LinkIcon, CheckIcon, PlusIcon, PdfIcon } from './Icons';
import { autoCategorizeTransactions, parseReceiptImage, normalizeMerchants, detectAnomalies, parsePdfStatement } from '../services/geminiService';
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
  const [columnMapping, setColumnMapping] = useState({ date: 0, description: 1, amount: 2, category: -1, account: -1, debit: -1, credit: -1 });
  const [importAccountName, setImportAccountName] = useState('My Bank Account');
  const [useSplitMode, setUseSplitMode] = useState(false);
  const [importCandidates, setImportCandidates] = useState<{ clean: Transaction[], duplicates: Transaction[] }>({ clean: [], duplicates: [] });
  const [duplicatesToKeep, setDuplicatesToKeep] = useState<Set<string>>(new Set());
  const [unmappedCategories, setUnmappedCategories] = useState<string[]>([]);
  const [categoryMapping, setCategoryMapping] = useState<Record<string, string>>({});
  
  // Enhanced Review Tab State
  const [reviewTab, setReviewTab] = useState<'clean' | 'duplicates'>('clean');

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

  const resetImportState = () => {
    setShowMapper(false);
    setShowCategoryMapper(false);
    setShowDuplicateReview(false);
    setShowGSheetModal(false);
    setImportPreview(null);
    allImportRowsRef.current = [];
    setImportCandidates({ clean: [], duplicates: [] });
    setDuplicatesToKeep(new Set());
    setUnmappedCategories([]);
    setReviewTab('clean');
    if (fileInputRef.current) fileInputRef.current.value = '';
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

  // --- Import Logic ---
  const handleFileSelect = (file: File) => {
    resetImportState();
    
    // PDF Handling
    if (file.type === 'application/pdf') {
        const reader = new FileReader();
        reader.onloadend = async () => {
            const result = reader.result as string;
            // Robust base64 extraction
            const base64 = result.includes(',') ? result.split(',')[1] : result;
            
            setIsProcessing(true);
            try {
                const pdfTxns = await parsePdfStatement(base64);
                if (pdfTxns.length === 0) {
                    alert("AI parsed 0 transactions. Ensure the PDF is a readable bank statement.");
                } else {
                    // Directly move to duplicate check as PDF is already structured
                    performDuplicateCheck(pdfTxns, {}, categories);
                }
            } catch (err) {
                console.error("PDF Error", err);
                alert("Failed to parse PDF statement. It might be password protected or scanned image.");
            }
            setIsProcessing(false);
        };
        reader.readAsDataURL(file);
        return;
    }

    if (file.name.endsWith('.csv')) {
      const reader = new FileReader();
      reader.onload = e => processCSV(e.target?.result as string);
      reader.onerror = () => alert("Error reading file");
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const data = e.target?.result;
          const wb = XLSX.read(data, { type: 'array' });
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false, dateNF: 'yyyy-mm-dd' });
          allImportRowsRef.current = rows as string[][];
          setImportPreview(rows.slice(0, 6) as string[][]);
          setShowMapper(true);
        } catch (err) {
          console.error(err);
          alert("Failed to parse Excel file. Please ensure it is a valid .xlsx or .xls file.");
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const processCSV = (text: string) => {
      const rows = text.split('\n').map(r => r.split(',').map(c => c.replace(/^"|"$/g, '').trim())).filter(r => r.length > 1);
      allImportRowsRef.current = rows;
      setImportPreview(rows.slice(0, 6));
      setShowMapper(true);
  }

  const fetchGoogleSheet = async () => {
    if (!gsheetUrl) return;
    // Extract ID from URL
    const match = gsheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) { alert("Invalid Google Sheet URL"); return; }
    const sheetId = match[1];
    const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    
    setIsProcessing(true);
    try {
      const res = await fetch(exportUrl);
      if (!res.ok) throw new Error("Failed to fetch");
      const text = await res.text();
      processCSV(text);
      setShowGSheetModal(false);
    } catch (e) {
      alert("Failed to download sheet. Ensure it is published to web or visible to anyone with link.");
    }
    setIsProcessing(false);
  };

  const syncSimpleFin = async () => {
    if (!simpleFinUrl) return;
    setIsProcessing(true);
    try {
      const newTxns = await fetchSimpleFinTransactions(simpleFinUrl);
      // Move directly to duplicate check
      performDuplicateCheck(newTxns, {}, categories);
      setShowSimpleFinModal(false);
    } catch (e) {
      alert("Failed to sync SimpleFin. Check your Bridge URL.");
      console.error(e);
    }
    setIsProcessing(false);
  };

  // --- Transaction Processing ---
  const handleProcessImport = () => {
    const rows = allImportRowsRef.current.slice(1); // Skip header usually
    const newTxns: Transaction[] = [];
    const foundCategories = new Set<string>();

    rows.forEach((row, idx) => {
      if (row.length < 2) return;
      
      let date = safeParseDate(row[columnMapping.date]);
      let desc = row[columnMapping.description] || "Imported Transaction";
      let amount = 0;
      let type = TransactionType.EXPENSE;

      if (useSplitMode) {
        const debit = parseFloat(row[columnMapping.debit]?.replace(/[^0-9.-]/g, '') || '0');
        const credit = parseFloat(row[columnMapping.credit]?.replace(/[^0-9.-]/g, '') || '0');
        if (credit > 0) { amount = credit; type = TransactionType.INCOME; }
        else { amount = Math.abs(debit); type = TransactionType.EXPENSE; }
      } else {
        amount = parseFloat(row[columnMapping.amount]?.replace(/[^0-9.-]/g, '') || '0');
        // If negative, it's expense. If positive, income. Normalize to positive amount + type
        if (amount < 0) { amount = Math.abs(amount); type = TransactionType.EXPENSE; }
        else { type = TransactionType.INCOME; }
      }

      // Account
      const acc = columnMapping.account > -1 ? row[columnMapping.account] : importAccountName;

      // Category extraction
      if (columnMapping.category > -1) {
        const catName = row[columnMapping.category]?.trim();
        if (catName) foundCategories.add(catName);
      }

      newTxns.push({
        id: `imp-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 5)}`,
        date,
        description: desc,
        amount,
        type,
        account: acc,
        originalText: desc
      });
    });

    // Check Categories
    const unknownCats = Array.from(foundCategories).filter(c => !categories.some(cat => cat.name.toLowerCase() === c.toLowerCase() || cat.subcategories.some(s => s.name.toLowerCase() === c.toLowerCase())));
    
    setImportCandidates({ clean: newTxns, duplicates: [] }); // Temp store

    if (unknownCats.length > 0) {
      setUnmappedCategories(unknownCats);
      setShowMapper(false);
      setShowCategoryMapper(true);
    } else {
      // Proceed to Duplicate Check
      performDuplicateCheck(newTxns, {}, categories);
    }
  };

  const handleCategoryMapConfirm = () => {
    // Create new categories for ones marked as "CREATE_NEW" or map them
    const newCats = [...categories];
    
    unmappedCategories.forEach(uc => {
       const mapped = categoryMapping[uc];
       if (!mapped || mapped === 'NEW') {
         // Create new
         newCats.push({
           id: `cat-auto-${Date.now()}-${uc.replace(/\s/g, '')}`,
           name: uc,
           type: TransactionType.EXPENSE, // Default, user can change later
           subcategories: [],
           color: '#94a3b8'
         });
       }
    });

    setCategories(newCats);
    setShowCategoryMapper(false);
    
    // Now perform duplicate check with mapped categories applied
    performDuplicateCheck(importCandidates.clean, categoryMapping, newCats);
  };

  const performDuplicateCheck = (txns: Transaction[], catMap: Record<string, string>, updatedCategories: Category[]) => {
    const clean: Transaction[] = [];
    const dups: Transaction[] = [];

    txns.forEach(t => {
      // Basic check: same date, amount, description
      const isDup = transactions.some(exist => 
        exist.date.split('T')[0] === t.date.split('T')[0] && 
        Math.abs(exist.amount - t.amount) < 0.01 && 
        exist.description === t.description
      );

      if (isDup) dups.push(t);
      else clean.push(t);
    });

    setImportCandidates({ clean, duplicates: dups });
    if (showMapper) setShowMapper(false);
    setReviewTab(clean.length > 0 ? 'clean' : 'duplicates');
    setShowDuplicateReview(true);
  };

  const finalizeImport = () => {
    const finalDups = importCandidates.duplicates.filter(d => duplicatesToKeep.has(d.id));
    const toAdd = [...importCandidates.clean, ...finalDups];
    setTransactions(prev => [...toAdd, ...prev]);
    resetImportState();
  };
  
  // --- Category Selector Logic ---
  const handleUnifiedCategoryChange = (transactionId: string, value: string) => {
    if (!value) {
       // Revert to uncategorized
       setTransactions(prev => prev.map(t => t.id === transactionId ? { ...t, categoryId: undefined, subcategoryId: undefined } : t));
       return;
    }

    let catId = '', subId: string | undefined = undefined;

    // Direct Category ID check
    let foundCat = categories.find(c => c.id === value);
    if (foundCat) {
        catId = foundCat.id;
    } else {
        // Check subcategories
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
               <option value={c.id}>{c.name} (All)</option> 
               {c.subcategories.map(s => (
                 <option key={s.id} value={s.id}>{s.name}</option>
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

  const handleBulkDelete = () => {
    if (confirm(`Are you sure you want to delete ${selectedIds.size} transactions?`)) {
      setTransactions(prev => prev.filter(t => !selectedIds.has(t.id)));
      setSelectedIds(new Set());
    }
  };

  // --- Rules Engine ---
  const applyRules = () => {
    if (rules.length === 0) return;
    let count = 0;
    setTransactions(prev => prev.map(t => {
      if (t.categoryId) return t; // Skip already categorized
      
      for (const rule of rules.filter(r => r.isActive)) {
        // Check conditions
        const matches = rule.conditions.map(c => {
          let val = '';
          if (c.field === 'description') val = t.description.toLowerCase();
          if (c.field === 'account') val = (t.account || '').toLowerCase();
          if (c.field === 'amount') val = t.amount.toString();

          const target = c.value.toLowerCase();
          
          if (c.field === 'amount') {
             const numVal = parseFloat(val);
             const numTarget = parseFloat(target);
             if (c.operator === 'equals') return Math.abs(numVal - numTarget) < 0.01;
             if (c.operator === 'greater') return numVal > numTarget;
             if (c.operator === 'less') return numVal < numTarget;
          } else {
             if (c.operator === 'contains') return val.includes(target);
             if (c.operator === 'equals') return val === target;
             if (c.operator === 'starts_with') return val.startsWith(target);
             if (c.operator === 'ends_with') return val.endsWith(target);
          }
          return false;
        });

        const isMatch = rule.matchLogic === 'AND' ? matches.every(Boolean) : matches.some(Boolean);
        
        if (isMatch) {
           count++;
           const cat = categories.find(c => c.id === rule.targetCategoryId);
           return { ...t, categoryId: rule.targetCategoryId, subcategoryId: rule.targetSubcategoryId, type: cat?.type || t.type };
        }
      }
      return t;
    }));
    alert(`Rules applied. ${count} transactions updated.`);
  };

  const saveRule = () => {
    if (!activeRule || !activeRule.name) return;
    const newRule = { 
       ...activeRule, 
       id: activeRule.id || `rule-${Date.now()}`, 
       isActive: true,
       conditions: activeRule.conditions || [],
       targetCategoryId: activeRule.targetCategoryId || categories[0].id
    } as AutoCategoryRule;
    
    setRules(prev => {
       const existing = prev.findIndex(r => r.id === newRule.id);
       if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = newRule;
          return updated;
       }
       return [...prev, newRule];
    });
    setActiveRule(null);
  };

  return (
    <div className="space-y-6 animate-fade-in">
       {/* Actions Bar */}
       <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 flex flex-col items-center justify-center hover:bg-gray-50 transition cursor-pointer" onClick={() => fileInputRef.current?.click()}>
            <UploadIcon className="w-6 h-6 text-gray-400 mb-1" />
            <span className="text-xs font-medium text-gray-600 text-center">Upload CSV/Excel<br/>or PDF Statement</span>
            <input type="file" ref={fileInputRef} className="hidden" accept=".csv,.xlsx,.xls,.pdf" onChange={e => e.target.files && handleFileSelect(e.target.files[0])} />
          </div>
          
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 flex flex-col items-center justify-center hover:bg-gray-50 transition cursor-pointer" onClick={() => setShowGSheetModal(true)}>
            <GoogleSheetIcon className="w-6 h-6 text-gray-400 mb-1" />
            <span className="text-xs font-medium text-gray-600">Google Sheet</span>
          </div>

          <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 flex flex-col items-center justify-center hover:bg-gray-50 transition cursor-pointer" onClick={() => receiptInputRef.current?.click()}>
            <CameraIcon className="w-6 h-6 text-gray-400 mb-1" />
            <span className="text-xs font-medium text-gray-600">Scan Receipt</span>
            <input type="file" ref={receiptInputRef} className="hidden" accept="image/*" onChange={handleReceiptUpload} />
          </div>

          <button onClick={() => setShowSimpleFinModal(true)} className="flex flex-col items-center justify-center gap-1 p-4 bg-white border rounded-xl shadow-sm hover:shadow-md transition">
             <BankIcon className="w-6 h-6 text-accent" />
             <span className="text-xs font-medium text-gray-600">Sync Bank</span>
          </button>

          <button onClick={() => setShowManualModal(true)} className="flex flex-col items-center justify-center gap-1 p-4 bg-white border rounded-xl shadow-sm hover:shadow-md transition">
             <PlusCircleIcon className="w-6 h-6 text-success" />
             <span className="text-xs font-medium text-gray-600">Manual Add</span>
          </button>
       </div>

       {/* AI Tools Bar */}
       <div className="flex flex-wrap gap-2 items-center bg-purple-50 p-3 rounded-lg border border-purple-100">
          <span className="text-xs font-bold text-purple-800 uppercase mr-2 flex items-center gap-1"><SparklesIcon className="w-3 h-3" /> AI Tools:</span>
          <button onClick={handleAutoCategorize} disabled={isProcessing} className="px-3 py-1.5 bg-white border border-purple-200 text-purple-700 text-xs font-medium rounded hover:bg-purple-100 disabled:opacity-50">Auto Categorize</button>
          <button onClick={handleNormalizeMerchants} disabled={isProcessing} className="px-3 py-1.5 bg-white border border-purple-200 text-purple-700 text-xs font-medium rounded hover:bg-purple-100 disabled:opacity-50">Clean Merchants</button>
          <button onClick={handleDetectAnomalies} disabled={isProcessing} className="px-3 py-1.5 bg-white border border-purple-200 text-purple-700 text-xs font-medium rounded hover:bg-purple-100 disabled:opacity-50">Analyze Anomalies</button>
          <div className="ml-auto flex items-center gap-2">
             <button onClick={applyRules} className="px-3 py-1.5 bg-white border border-blue-200 text-blue-700 text-xs font-medium rounded hover:bg-blue-50">Run Rules</button>
             <button onClick={() => setShowRulesModal(true)} className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded hover:bg-gray-100 flex items-center gap-1"><RobotIcon className="w-3 h-3" /> Manage Rules</button>
          </div>
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
            <button onClick={handleBulkDelete} className="px-3 py-1 bg-red-600 rounded text-xs hover:bg-red-700 ml-auto">Delete</button>
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
                        <td className="px-4 py-2 text-right"><button onClick={() => setTransactions(prev => prev.filter(pt => pt.id !== t.id))} className="text-gray-400 hover:text-red-500 p-1 rounded hover:bg-gray-100"><TrashIcon className="w-4 h-4" /></button></td>
                     </tr>
                  );
               })}
            </tbody>
         </table>
       </div>

       {/* --- MODALS --- */}

       {/* Manual Add Modal */}
       {showManualModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
             <div className="bg-white p-6 rounded-xl w-96 shadow-2xl">
                <h3 className="font-bold mb-4">Add Transaction</h3>
                <div className="space-y-3">
                   <input type="date" className="w-full border rounded px-3 py-2" value={manualForm.date} onChange={e => setManualForm({...manualForm, date: e.target.value})} />
                   <input type="number" placeholder="Amount" className="w-full border rounded px-3 py-2" value={manualForm.amount} onChange={e => setManualForm({...manualForm, amount: parseFloat(e.target.value)})} />
                   <input type="text" placeholder="Description" className="w-full border rounded px-3 py-2" value={manualForm.description} onChange={e => setManualForm({...manualForm, description: e.target.value})} />
                   <input type="text" placeholder="Account Name" className="w-full border rounded px-3 py-2" value={manualForm.account} onChange={e => setManualForm({...manualForm, account: e.target.value})} />
                   
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

       {/* Import Mapper Modal */}
       {showMapper && importPreview && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
             <div className="bg-white p-6 rounded-xl w-[700px] shadow-2xl max-h-[90vh] overflow-y-auto">
                <h3 className="font-bold mb-4 text-lg">Map Import Columns</h3>
                <div className="text-sm text-gray-500 mb-4">Preview of first 5 rows. Use the inputs below to match columns.</div>
                
                {/* Visual Legend */}
                <div className="flex gap-4 text-xs mb-2">
                   <div className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-100 border border-blue-400 rounded"></span> Date</div>
                   <div className="flex items-center gap-1"><span className="w-3 h-3 bg-yellow-100 border border-yellow-400 rounded"></span> Description</div>
                   <div className="flex items-center gap-1"><span className="w-3 h-3 bg-green-100 border border-green-400 rounded"></span> Amount</div>
                </div>

                <div className="overflow-x-auto mb-6 border rounded bg-gray-50 p-2">
                   <table className="text-xs w-full">
                     <tbody>
                       {importPreview.map((row, i) => (
                         <tr key={i}>
                            <td className="font-bold pr-2 text-gray-400">{i+1}.</td>
                            {row.map((cell, j) => {
                               let bgClass = "";
                               if (j === columnMapping.date) bgClass = "bg-blue-100 border-blue-200";
                               else if (j === columnMapping.description) bgClass = "bg-yellow-100 border-yellow-200";
                               else if (!useSplitMode && j === columnMapping.amount) bgClass = "bg-green-100 border-green-200";
                               else if (useSplitMode && j === columnMapping.debit) bgClass = "bg-red-50 border-red-200";
                               else if (useSplitMode && j === columnMapping.credit) bgClass = "bg-green-50 border-green-200";
                               
                               return <td key={j} className={`border px-1 max-w-[100px] truncate ${bgClass}`}>{cell}</td>
                            })}
                         </tr>
                       ))}
                     </tbody>
                   </table>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-2">
                     <input type="checkbox" id="splitMode" checked={useSplitMode} onChange={e => setUseSplitMode(e.target.checked)} />
                     <label htmlFor="splitMode" className="text-sm font-medium">Split Debit/Credit Columns?</label>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-2 border-l-4 border-blue-400 bg-gray-50 rounded">
                       <label className="text-xs font-bold text-blue-800">Date Column Index (0-based)</label>
                       <input type="number" className="w-full border rounded p-1 border-blue-300 focus:ring-blue-200" value={columnMapping.date} onChange={e => setColumnMapping({...columnMapping, date: parseInt(e.target.value)})} />
                    </div>
                    <div className="p-2 border-l-4 border-yellow-400 bg-gray-50 rounded">
                       <label className="text-xs font-bold text-yellow-800">Description Column</label>
                       <input type="number" className="w-full border rounded p-1 border-yellow-300 focus:ring-yellow-200" value={columnMapping.description} onChange={e => setColumnMapping({...columnMapping, description: parseInt(e.target.value)})} />
                    </div>
                    {!useSplitMode ? (
                      <div className="p-2 border-l-4 border-green-400 bg-gray-50 rounded">
                         <label className="text-xs font-bold text-green-800">Amount Column</label>
                         <input type="number" className="w-full border rounded p-1 border-green-300 focus:ring-green-200" value={columnMapping.amount} onChange={e => setColumnMapping({...columnMapping, amount: parseInt(e.target.value)})} />
                      </div>
                    ) : (
                      <>
                        <div className="p-2 border-l-4 border-red-400 bg-gray-50 rounded">
                           <label className="text-xs font-bold text-red-800">Debit (Expense) Column</label>
                           <input type="number" className="w-full border rounded p-1" value={columnMapping.debit} onChange={e => setColumnMapping({...columnMapping, debit: parseInt(e.target.value)})} />
                        </div>
                        <div className="p-2 border-l-4 border-green-400 bg-gray-50 rounded">
                           <label className="text-xs font-bold text-green-800">Credit (Income) Column</label>
                           <input type="number" className="w-full border rounded p-1" value={columnMapping.credit} onChange={e => setColumnMapping({...columnMapping, credit: parseInt(e.target.value)})} />
                        </div>
                      </>
                    )}
                    <div className="p-2 border-l-4 border-gray-400 bg-gray-50 rounded">
                       <label className="text-xs font-bold text-gray-800">Category (Optional)</label>
                       <input type="number" className="w-full border rounded p-1" value={columnMapping.category} onChange={e => setColumnMapping({...columnMapping, category: parseInt(e.target.value)})} />
                    </div>
                    <div className="p-2 border-l-4 border-gray-400 bg-gray-50 rounded">
                       <label className="text-xs font-bold text-gray-800">Account (Optional)</label>
                       <input type="number" className="w-full border rounded p-1" value={columnMapping.account} onChange={e => setColumnMapping({...columnMapping, account: parseInt(e.target.value)})} />
                    </div>
                  </div>
                  
                  <div className="p-2 bg-gray-50 rounded">
                     <label className="text-xs font-bold">Default Account Name</label>
                     <input type="text" className="w-full border rounded p-1" value={importAccountName} onChange={e => setImportAccountName(e.target.value)} />
                  </div>
                </div>

                <div className="flex gap-2 mt-6">
                   <button onClick={resetImportState} className="flex-1 py-2 bg-gray-100 rounded hover:bg-gray-200">Cancel</button>
                   <button onClick={handleProcessImport} className="flex-1 py-2 bg-accent text-white rounded hover:bg-blue-600">Next</button>
                </div>
             </div>
          </div>
       )}

       {/* Review & Import Modal */}
       {showDuplicateReview && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
             <div className="bg-white p-6 rounded-xl w-[700px] shadow-2xl max-h-[80vh] flex flex-col">
                <div className="flex items-center gap-2 mb-4 border-b pb-4">
                   <CheckIcon className="w-6 h-6 text-green-500" />
                   <h3 className="font-bold text-lg">Review & Import</h3>
                </div>

                {/* Tabs */}
                <div className="flex gap-2 mb-4 border-b">
                   <button 
                     className={`px-4 py-2 text-sm font-medium border-b-2 ${reviewTab === 'clean' ? 'border-accent text-accent' : 'border-transparent text-gray-500'}`}
                     onClick={() => setReviewTab('clean')}
                   >
                     New Transactions ({importCandidates.clean.length})
                   </button>
                   <button 
                     className={`px-4 py-2 text-sm font-medium border-b-2 ${reviewTab === 'duplicates' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500'}`}
                     onClick={() => setReviewTab('duplicates')}
                   >
                     Potential Duplicates ({importCandidates.duplicates.length})
                   </button>
                </div>
                
                <div className="flex-1 overflow-y-auto min-h-[300px] mb-4">
                    {reviewTab === 'duplicates' && (
                       <div className="space-y-2">
                          {importCandidates.duplicates.length === 0 && <p className="text-center text-gray-400 py-8">No duplicates found.</p>}
                          {importCandidates.duplicates.map(d => (
                              <div key={d.id} className="flex items-center gap-3 p-2 border rounded bg-orange-50">
                                <input type="checkbox" checked={duplicatesToKeep.has(d.id)} onChange={e => {
                                    const newSet = new Set(duplicatesToKeep);
                                    if (e.target.checked) newSet.add(d.id); else newSet.delete(d.id);
                                    setDuplicatesToKeep(newSet);
                                }} />
                                <div className="flex-1 text-xs">
                                    <div className="font-bold">{d.date.split('T')[0]} - ${d.amount}</div>
                                    <div className="truncate">{d.description}</div>
                                </div>
                                <div className="text-xs text-orange-600 font-bold">Duplicate</div>
                              </div>
                          ))}
                       </div>
                    )}

                    {reviewTab === 'clean' && (
                       <div className="space-y-2">
                          {importCandidates.clean.length === 0 && <p className="text-center text-gray-400 py-8">No new transactions.</p>}
                          {importCandidates.clean.map((t, idx) => (
                             <div key={t.id} className="flex items-center justify-between p-2 border rounded bg-gray-50 hover:bg-white text-xs">
                                <div className="flex gap-3 overflow-hidden">
                                   <div className="text-gray-500 w-6 font-bold">{idx + 1}.</div>
                                   <div className="w-20">{t.date.split('T')[0]}</div>
                                   <div className="font-medium truncate flex-1">{t.description}</div>
                                   <div className="font-bold">${t.amount.toFixed(2)}</div>
                                </div>
                                <button 
                                  onClick={() => setImportCandidates(prev => ({ ...prev, clean: prev.clean.filter(c => c.id !== t.id) }))} 
                                  className="text-gray-400 hover:text-red-500"
                                >
                                  <TrashIcon className="w-4 h-4" />
                                </button>
                             </div>
                          ))}
                       </div>
                    )}
                </div>

                <div className="flex gap-2 pt-4 border-t">
                   <button onClick={resetImportState} className="flex-1 py-2 bg-gray-100 rounded hover:bg-gray-200">Cancel</button>
                   <button onClick={finalizeImport} className="flex-1 py-2 bg-success text-white rounded hover:bg-green-600 shadow">
                      Import {importCandidates.clean.length + duplicatesToKeep.size} Transactions
                   </button>
                </div>
             </div>
          </div>
       )}

       {/* Unknown Categories Modal */}
       {showCategoryMapper && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-xl w-[500px] shadow-2xl">
               <h3 className="font-bold mb-4">Map Unknown Categories</h3>
               <p className="text-sm text-gray-500 mb-4">We found categories in your file that don't exist in your system. Map them to existing ones or create new ones.</p>
               <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                  {unmappedCategories.map(cat => (
                     <div key={cat} className="flex items-center justify-between p-2 border rounded">
                        <span className="font-bold text-sm">{cat}</span>
                        <select 
                           className="text-sm border rounded p-1 w-48" 
                           value={categoryMapping[cat] || 'NEW'} 
                           onChange={e => setCategoryMapping(prev => ({...prev, [cat]: e.target.value}))}
                        >
                           <option value="NEW">Create New Category</option>
                           {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                     </div>
                  ))}
               </div>
               <div className="flex gap-2 mt-4">
                  <button onClick={resetImportState} className="flex-1 py-2 bg-gray-100 rounded">Cancel Import</button>
                  <button onClick={handleCategoryMapConfirm} className="flex-1 py-2 bg-accent text-white rounded">Continue</button>
               </div>
            </div>
          </div>
       )}

       {/* Google Sheet Modal */}
       {showGSheetModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
             <div className="bg-white p-6 rounded-xl w-96 shadow-2xl">
                <h3 className="font-bold mb-4 flex items-center gap-2"><GoogleSheetIcon className="w-5 h-5 text-green-600" /> Import Google Sheet</h3>
                <p className="text-xs text-gray-500 mb-4">Ensure your sheet is "Published to the web" (File {'>'} Share {'>'} Publish to web) and select CSV format, or use a public link.</p>
                <input type="text" placeholder="Paste Google Sheet URL" className="w-full border rounded px-3 py-2 mb-4" value={gsheetUrl} onChange={e => setGsheetUrl(e.target.value)} />
                <div className="flex gap-2">
                   <button onClick={() => setShowGSheetModal(false)} className="flex-1 py-2 bg-gray-100 rounded">Cancel</button>
                   <button onClick={fetchGoogleSheet} className="flex-1 py-2 bg-green-600 text-white rounded">Fetch Data</button>
                </div>
             </div>
          </div>
       )}

       {/* SimpleFin Modal */}
       {showSimpleFinModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
             <div className="bg-white p-6 rounded-xl w-96 shadow-2xl">
                <h3 className="font-bold mb-4 flex items-center gap-2"><BankIcon className="w-5 h-5 text-accent" /> Sync with SimpleFin</h3>
                <p className="text-xs text-gray-500 mb-4">Enter your SimpleFin Bridge URL. This URL contains your credentials securely.</p>
                <input type="password" placeholder="https://user:pass@bridge.simplefin.org/..." className="w-full border rounded px-3 py-2 mb-4" value={simpleFinUrl} onChange={e => setSimpleFinUrl(e.target.value)} />
                <div className="flex gap-2">
                   <button onClick={() => setShowSimpleFinModal(false)} className="flex-1 py-2 bg-gray-100 rounded">Cancel</button>
                   <button onClick={syncSimpleFin} className="flex-1 py-2 bg-accent text-white rounded">Sync</button>
                </div>
             </div>
          </div>
       )}

        {/* Rules Manager Modal */}
        {showRulesModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
             <div className="bg-white p-6 rounded-xl w-[800px] h-[80vh] shadow-2xl flex flex-col">
                <div className="flex justify-between items-center mb-4 border-b pb-2">
                   <h3 className="font-bold text-lg flex items-center gap-2"><RobotIcon className="w-5 h-5" /> Auto-Categorization Rules</h3>
                   <button onClick={() => setShowRulesModal(false)} className="text-gray-400 hover:text-gray-600">&times;</button>
                </div>
                
                <div className="flex-1 overflow-y-auto flex gap-4">
                   {/* Rule List */}
                   <div className="w-1/3 border-r pr-4 space-y-2">
                      <button onClick={() => setActiveRule({ name: 'New Rule', matchLogic: 'AND', conditions: [], isActive: true })} className="w-full py-2 border-2 border-dashed rounded text-sm text-gray-500 hover:bg-gray-50 mb-2">+ Create Rule</button>
                      {rules.map(r => (
                         <div key={r.id} onClick={() => setActiveRule(r)} className={`p-3 rounded border cursor-pointer text-sm ${activeRule?.id === r.id ? 'bg-blue-50 border-blue-300' : 'hover:bg-gray-50'}`}>
                            <div className="font-bold truncate">{r.name}</div>
                            <div className="text-xs text-gray-400">{r.conditions.length} conditions</div>
                         </div>
                      ))}
                   </div>
                   
                   {/* Rule Editor */}
                   <div className="flex-1 pl-2">
                      {activeRule ? (
                         <div className="space-y-4">
                            <div>
                               <label className="text-xs font-bold block mb-1">Rule Name</label>
                               <input type="text" className="w-full border rounded px-2 py-1" value={activeRule.name || ''} onChange={e => setActiveRule({...activeRule, name: e.target.value})} />
                            </div>
                            
                            <div>
                               <label className="text-xs font-bold block mb-1">Match Logic</label>
                               <div className="flex gap-4 text-sm">
                                  <label className="flex items-center gap-1"><input type="radio" name="logic" checked={activeRule.matchLogic === 'AND'} onChange={() => setActiveRule({...activeRule, matchLogic: 'AND'})} /> All conditions (AND)</label>
                                  <label className="flex items-center gap-1"><input type="radio" name="logic" checked={activeRule.matchLogic === 'OR'} onChange={() => setActiveRule({...activeRule, matchLogic: 'OR'})} /> Any condition (OR)</label>
                                </div>
                            </div>

                            <div className="bg-gray-50 p-3 rounded border">
                               <label className="text-xs font-bold block mb-2">Conditions</label>
                               {activeRule.conditions?.map((c, i) => (
                                  <div key={i} className="flex gap-2 mb-2 items-center">
                                     <select className="text-xs border rounded p-1" value={c.field} onChange={e => {
                                        const newConds = [...(activeRule.conditions||[])];
                                        newConds[i] = { ...c, field: e.target.value as any };
                                        setActiveRule({...activeRule, conditions: newConds});
                                     }}>
                                        <option value="description">Description</option>
                                        <option value="amount">Amount</option>
                                        <option value="account">Account</option>
                                     </select>
                                     <select className="text-xs border rounded p-1" value={c.operator} onChange={e => {
                                        const newConds = [...(activeRule.conditions||[])];
                                        newConds[i] = { ...c, operator: e.target.value as any };
                                        setActiveRule({...activeRule, conditions: newConds});
                                     }}>
                                        <option value="contains">Contains</option>
                                        <option value="equals">Equals</option>
                                        <option value="starts_with">Starts With</option>
                                        <option value="greater">Greater Than</option>
                                        <option value="less">Less Than</option>
                                     </select>
                                     <input type="text" className="text-xs border rounded p-1 flex-1" value={c.value} onChange={e => {
                                        const newConds = [...(activeRule.conditions||[])];
                                        newConds[i] = { ...c, value: e.target.value };
                                        setActiveRule({...activeRule, conditions: newConds});
                                     }} />
                                     <button onClick={() => {
                                        const newConds = activeRule.conditions?.filter((_, idx) => idx !== i);
                                        setActiveRule({...activeRule, conditions: newConds});
                                     }} className="text-red-500 hover:text-red-700">&times;</button>
                                  </div>
                               ))}
                               <button onClick={() => setActiveRule({...activeRule, conditions: [...(activeRule.conditions||[]), { id: Date.now().toString(), field: 'description', operator: 'contains', value: '' }]})} className="text-xs text-blue-600 hover:underline">+ Add Condition</button>
                            </div>

                            <div>
                               <label className="text-xs font-bold block mb-1">Assign To Category</label>
                               <select className="w-full border rounded px-2 py-1 text-sm" value={activeRule.targetCategoryId} onChange={e => setActiveRule({...activeRule, targetCategoryId: e.target.value})}>
                                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                               </select>
                            </div>

                            <div className="pt-4 border-t flex justify-end gap-2">
                               <button onClick={() => {
                                  if (activeRule.id && rules.find(r => r.id === activeRule.id)) {
                                     setRules(prev => prev.filter(r => r.id !== activeRule.id));
                                     setActiveRule(null);
                                  } else {
                                     setActiveRule(null);
                                  }
                               }} className="text-red-500 text-sm px-3 py-1">Delete Rule</button>
                               <button onClick={saveRule} className="bg-primary text-white text-sm px-4 py-1 rounded">Save Rule</button>
                            </div>
                         </div>
                      ) : (
                         <div className="h-full flex items-center justify-center text-gray-400">Select or create a rule</div>
                      )}
                   </div>
                </div>
             </div>
          </div>
       )}

    </div>
  );
};

export default TransactionManager;