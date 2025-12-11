
import React, { useState, useRef } from 'react';
import { Transaction, ReconciliationOrder, ReconciliationMatchSuggestion } from '../types';
import { UploadIcon, CheckIcon, LinkIcon, FileIcon, CheckCircleIcon, XCircleIcon, BrainIcon } from './Icons';
import { suggestReconciliationMatches } from '../services/geminiService';

declare const XLSX: any;

interface ReconciliationManagerProps {
  transactions: Transaction[];
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
}

const DEFAULT_ORDER_COLS = ['date', 'description', 'amount', 'orderStatus', 'category', 'matched'];

const ReconciliationManager: React.FC<ReconciliationManagerProps> = ({ transactions, setTransactions }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [orders, setOrders] = useState<ReconciliationOrder[]>([]);
  const [columnMapping, setColumnMapping] = useState({ 
      date: 0, description: 1, amount: 2, 
      orderStatus: -1, paymentAccount: -1, category: -1, itemDetails: -1 
  });
  const [showMapper, setShowMapper] = useState(false);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [allRows, setAllRows] = useState<string[][]>([]);

  // Manual Linking State
  const [linkingOrderId, setLinkingOrderId] = useState<string | null>(null);

  // AI Matching State
  const [isMatching, setIsMatching] = useState(false);
  const [matches, setMatches] = useState<ReconciliationMatchSuggestion[]>([]);
  const [showMatchModal, setShowMatchModal] = useState(false);

  // Table Configuration
  const [colWidths, setColWidths] = useState<Record<string, number>>({
      date: 100, description: 200, amount: 90, orderStatus: 110, 
      paymentAccount: 120, category: 120, itemDetails: 150, matched: 80
  });
  const [columnOrder, setColumnOrder] = useState<string[]>(['date', 'description', 'amount', 'orderStatus', 'category', 'matched']);
  const resizingCol = useRef<string | null>(null);
  const startX = useRef<number>(0);
  const startWidth = useRef<number>(0);
  const draggingHeader = useRef<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
            const bstr = evt.target?.result;
            const wb = XLSX.read(bstr, { type: 'array' });
            const wsname = wb.SheetNames[0];
            const ws = wb.Sheets[wsname];
            const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false, dateNF: 'yyyy-mm-dd' }) as string[][];
            setAllRows(data);
            setPreviewRows(data.slice(0, 5));
            setShowMapper(true);
        } catch (err) {
            alert("Failed to parse file. Ensure valid CSV or Excel.");
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const processOrders = () => {
    const newOrders: ReconciliationOrder[] = [];
    allRows.slice(1).forEach((row, idx) => {
        if (row.length < 2) return;
        const date = row[columnMapping.date];
        const desc = row[columnMapping.description];
        const amtStr = row[columnMapping.amount]?.toString().replace(/[^0-9.-]/g, '') || "0";
        const amount = Math.abs(parseFloat(amtStr));

        if (date && amount > 0) {
            newOrders.push({
                id: `ord-${idx}-${Date.now()}`,
                date,
                description: desc,
                amount,
                orderStatus: columnMapping.orderStatus > -1 ? row[columnMapping.orderStatus] : '',
                paymentAccount: columnMapping.paymentAccount > -1 ? row[columnMapping.paymentAccount] : '',
                category: columnMapping.category > -1 ? row[columnMapping.category] : '',
                itemDetails: columnMapping.itemDetails > -1 ? row[columnMapping.itemDetails] : '',
            });
        }
    });
    setOrders(newOrders);
    setShowMapper(false);
  };

  const linkTransaction = (orderId: string, transactionId: string) => {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      setTransactions(prev => prev.map(t => {
          if (t.id === transactionId) {
              const currentNotes = t.comments || '';
              const newNote = `Matched Order: ${order.description} (${order.date})`;
              // Only append if not already there
              const finalNotes = currentNotes.includes(order.description) ? currentNotes : (currentNotes ? `${currentNotes} | ${newNote}` : newNote);
              
              return { 
                  ...t, 
                  comments: finalNotes,
                  merchant: t.merchant || order.description.substring(0, 30)
              };
          }
          return t;
      }));

      // Mark order as matched locally
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, matchedTransactionId: transactionId } : o));
      setLinkingOrderId(null);
  };

  const runSmartMatch = async () => {
      setIsMatching(true);
      const suggestions = await suggestReconciliationMatches(transactions, orders);
      setMatches(suggestions);
      setIsMatching(false);
      if (suggestions.length > 0) setShowMatchModal(true);
      else alert("No AI matches found at this time.");
  };

  const acceptMatch = (m: ReconciliationMatchSuggestion) => {
      const orderDescriptions = orders.filter(o => m.orderIds.includes(o.id)).map(o => o.description).join(", ");
      
      setTransactions(prev => prev.map(t => {
          if (t.id === m.transactionId) {
             const currentNotes = t.comments || '';
             const matchTypeLabel = m.type === 'BUNDLE' ? 'Bundled Orders' : 'Matched Order';
             const newNote = `[AI ${matchTypeLabel}]: ${orderDescriptions}`;
             const finalNotes = currentNotes ? `${currentNotes} | ${newNote}` : newNote;
             
             return { ...t, comments: finalNotes };
          }
          return t;
      }));

      setOrders(prev => prev.map(o => {
          if (m.orderIds.includes(o.id)) {
              return { ...o, matchedTransactionId: m.transactionId };
          }
          return o;
      }));

      // Remove from list
      setMatches(prev => prev.filter(match => match !== m));
  };

  // --- Table Interaction Handlers ---
  const handleResizeStart = (e: React.MouseEvent, colKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    resizingCol.current = colKey;
    startX.current = e.clientX;
    startWidth.current = colWidths[colKey] || 100;
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
  };

  const handleResizeMove = (e: MouseEvent) => {
    if (!resizingCol.current) return;
    const diff = e.clientX - startX.current;
    setColWidths(prev => ({ ...prev, [resizingCol.current!]: Math.max(40, startWidth.current + diff) }));
  };

  const handleResizeEnd = () => {
    resizingCol.current = null;
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
  };

  const handleDragStart = (e: React.DragEvent, col: string) => {
     draggingHeader.current = col;
     e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, targetCol: string) => {
      e.preventDefault();
      if (!draggingHeader.current || draggingHeader.current === targetCol) return;
      
      const newOrder = [...columnOrder];
      const draggedIdx = newOrder.indexOf(draggingHeader.current);
      const targetIdx = newOrder.indexOf(targetCol);
      
      newOrder.splice(draggedIdx, 1);
      newOrder.splice(targetIdx, 0, draggingHeader.current);
      setColumnOrder(newOrder);
  };

  return (
    <div className="space-y-6 animate-fade-in h-[calc(100vh-140px)] flex flex-col">
        <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold">Reconciliation</h2>
            <div className="flex gap-2">
                 <button onClick={runSmartMatch} disabled={isMatching} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 text-sm shadow disabled:opacity-50">
                    <BrainIcon className="w-4 h-4" /> {isMatching ? 'Analyzing...' : 'AI Smart Match'}
                 </button>
                 <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded hover:bg-slate-800 text-sm">
                    <UploadIcon className="w-4 h-4" /> Upload Order Data
                </button>
            </div>
            <input type="file" ref={fileInputRef} className="hidden" accept=".csv,.xlsx,.xls" onChange={handleFileSelect} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 overflow-hidden">
            {/* Left: Orders Table */}
            <div className="bg-white border rounded-xl shadow-sm flex flex-col overflow-hidden relative">
                <div className="p-4 bg-gray-50 border-b font-bold flex justify-between items-center">
                    <span>Imported Orders ({orders.length})</span>
                    {linkingOrderId && <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded animate-pulse">Select a transaction on the right to link</span>}
                </div>
                
                <div className="flex-1 overflow-auto">
                    <table className="min-w-full divide-y divide-gray-200 table-fixed">
                        <thead className="bg-gray-100 sticky top-0 z-10">
                            <tr>
                                {columnOrder.map(col => (
                                    <th 
                                        key={col} 
                                        style={{width: colWidths[col]}}
                                        className="px-2 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider relative group select-none border-r"
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, col)}
                                        onDragOver={(e) => handleDragOver(e, col)}
                                    >
                                        {col}
                                        <div 
                                            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400"
                                            onMouseDown={(e) => handleResizeStart(e, col)}
                                        ></div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {orders.length === 0 && <tr><td colSpan={columnOrder.length} className="p-8 text-center text-gray-400">No orders loaded.</td></tr>}
                            {orders.map((order, idx) => {
                                const isMatched = !!order.matchedTransactionId;
                                const isLinking = linkingOrderId === order.id;
                                
                                return (
                                    <tr 
                                        key={order.id} 
                                        className={`
                                            ${idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'} 
                                            ${isMatched ? 'bg-green-50' : ''} 
                                            ${isLinking ? 'ring-2 ring-inset ring-blue-500 bg-blue-50' : ''}
                                            hover:bg-gray-100 text-xs
                                        `}
                                    >
                                        {columnOrder.map(col => (
                                            <td key={col} className="px-2 py-2 truncate border-r border-transparent">
                                                {col === 'matched' ? (
                                                    isMatched ? (
                                                        <span className="flex items-center gap-1 text-green-700 font-bold bg-green-100 px-2 py-0.5 rounded-full w-fit">
                                                            <CheckCircleIcon className="w-3 h-3" /> Linked
                                                        </span>
                                                    ) : (
                                                        <button 
                                                            onClick={() => setLinkingOrderId(isLinking ? null : order.id)}
                                                            className={`flex items-center gap-1 px-2 py-0.5 rounded border shadow-sm transition ${isLinking ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-600 hover:bg-blue-50'}`}
                                                        >
                                                            <LinkIcon className="w-3 h-3" /> {isLinking ? 'Cancel' : 'Link'}
                                                        </button>
                                                    )
                                                ) : col === 'amount' ? (
                                                    `$${order.amount.toFixed(2)}`
                                                ) : (
                                                    (order as any)[col]
                                                )}
                                            </td>
                                        ))}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Right: Transactions Table */}
            <div className={`bg-white border rounded-xl shadow-sm flex flex-col overflow-hidden transition-all ${linkingOrderId ? 'ring-2 ring-blue-400 shadow-blue-200' : ''}`}>
                <div className="p-4 bg-gray-50 border-b font-bold flex justify-between">
                    <span>Bank Transactions</span>
                    {linkingOrderId && <span className="text-xs text-blue-600 font-medium">Click a row below to link</span>}
                </div>
                <div className="flex-1 overflow-y-auto p-0">
                     <table className="min-w-full text-xs text-left divide-y divide-gray-200">
                         <thead className="bg-gray-100 sticky top-0 z-10 text-gray-500">
                             <tr>
                                 <th className="px-4 py-3 font-medium">Date</th>
                                 <th className="px-4 py-3 font-medium">Description</th>
                                 <th className="px-4 py-3 font-medium">Amount</th>
                                 {linkingOrderId && <th className="px-4 py-3 font-medium text-right">Action</th>}
                             </tr>
                         </thead>
                         <tbody className="divide-y divide-gray-200 bg-white">
                             {transactions.map((t, idx) => {
                                 const isZebra = idx % 2 === 1;
                                 return (
                                     <tr 
                                        key={t.id} 
                                        className={`${isZebra ? 'bg-gray-50' : 'bg-white'} hover:bg-blue-50 cursor-pointer group`}
                                        onClick={() => linkingOrderId && linkTransaction(linkingOrderId, t.id)}
                                     >
                                         <td className="px-4 py-2 whitespace-nowrap text-gray-600">{t.date.split('T')[0]}</td>
                                         <td className="px-4 py-2 truncate max-w-[200px]" title={t.description}>{t.description}</td>
                                         <td className={`px-4 py-2 font-bold ${t.type === 'INCOME' ? 'text-green-600' : 'text-gray-900'}`}>${t.amount.toFixed(2)}</td>
                                         {linkingOrderId && (
                                             <td className="px-4 py-2 text-right">
                                                 <button className="text-blue-600 opacity-0 group-hover:opacity-100 font-bold hover:underline">Link This</button>
                                             </td>
                                         )}
                                     </tr>
                                 )
                             })}
                         </tbody>
                     </table>
                </div>
            </div>
        </div>

        {/* Mapper Modal */}
        {showMapper && (
             <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="bg-white p-6 rounded-xl w-[900px] shadow-2xl max-h-[90vh] overflow-y-auto">
                    <h3 className="font-bold mb-4">Map Order Columns</h3>
                    <div className="text-sm text-gray-500 mb-4">Match the columns from your uploaded file to the system fields.</div>
                    
                    {/* Preview Table */}
                    <div className="overflow-x-auto mb-6 bg-gray-50 p-2 rounded border">
                        <table className="text-xs w-full">
                            <tbody>
                                {previewRows.map((row, i) => (
                                    <tr key={i}>
                                        <td className="pr-2 text-gray-400 font-bold">{i+1}.</td>
                                        {row.map((cell, j) => {
                                            let borderClass = "border-gray-200";
                                            let bgClass = "";
                                            if (j === columnMapping.date) { borderClass = "border-blue-400"; bgClass = "bg-blue-50"; }
                                            if (j === columnMapping.description) { borderClass = "border-yellow-400"; bgClass = "bg-yellow-50"; }
                                            if (j === columnMapping.amount) { borderClass = "border-green-400"; bgClass = "bg-green-50"; }
                                            if (j === columnMapping.orderStatus) { borderClass = "border-purple-400"; bgClass = "bg-purple-50"; }
                                            if (j === columnMapping.category) { borderClass = "border-pink-400"; bgClass = "bg-pink-50"; }
                                            
                                            return (
                                                <td key={j} className={`border px-1 max-w-[120px] truncate ${borderClass} ${bgClass} border-2`}>
                                                    {cell}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Mapping Inputs */}
                    <div className="grid grid-cols-4 gap-4 mb-6">
                         <div className="p-2 rounded bg-blue-50 border border-blue-200">
                             <label className="text-xs font-bold block mb-1 text-blue-800">Date (Required)</label>
                             <input type="number" className="w-full border rounded p-1" value={columnMapping.date} onChange={e => setColumnMapping({...columnMapping, date: parseInt(e.target.value)})} />
                         </div>
                         <div className="p-2 rounded bg-yellow-50 border border-yellow-200">
                             <label className="text-xs font-bold block mb-1 text-yellow-800">Desc / Order ID</label>
                             <input type="number" className="w-full border rounded p-1" value={columnMapping.description} onChange={e => setColumnMapping({...columnMapping, description: parseInt(e.target.value)})} />
                         </div>
                         <div className="p-2 rounded bg-green-50 border border-green-200">
                             <label className="text-xs font-bold block mb-1 text-green-800">Total Amount</label>
                             <input type="number" className="w-full border rounded p-1" value={columnMapping.amount} onChange={e => setColumnMapping({...columnMapping, amount: parseInt(e.target.value)})} />
                         </div>
                         <div className="p-2 rounded bg-purple-50 border border-purple-200">
                             <label className="text-xs font-bold block mb-1 text-purple-800">Order Status</label>
                             <input type="number" className="w-full border rounded p-1" value={columnMapping.orderStatus} onChange={e => setColumnMapping({...columnMapping, orderStatus: parseInt(e.target.value)})} />
                         </div>
                         <div className="p-2 rounded bg-gray-50 border border-gray-200">
                             <label className="text-xs font-bold block mb-1 text-gray-800">Payment Account</label>
                             <input type="number" className="w-full border rounded p-1" value={columnMapping.paymentAccount} onChange={e => setColumnMapping({...columnMapping, paymentAccount: parseInt(e.target.value)})} />
                         </div>
                         <div className="p-2 rounded bg-pink-50 border border-pink-200">
                             <label className="text-xs font-bold block mb-1 text-pink-800">Category (Amazon)</label>
                             <input type="number" className="w-full border rounded p-1" value={columnMapping.category} onChange={e => setColumnMapping({...columnMapping, category: parseInt(e.target.value)})} />
                         </div>
                         <div className="p-2 rounded bg-gray-50 border border-gray-200">
                             <label className="text-xs font-bold block mb-1 text-gray-800">Item Details</label>
                             <input type="number" className="w-full border rounded p-1" value={columnMapping.itemDetails} onChange={e => setColumnMapping({...columnMapping, itemDetails: parseInt(e.target.value)})} />
                         </div>
                    </div>

                    <div className="flex gap-2">
                        <button onClick={() => setShowMapper(false)} className="flex-1 py-2 bg-gray-100 rounded hover:bg-gray-200">Cancel</button>
                        <button onClick={processOrders} className="flex-1 py-2 bg-primary text-white rounded hover:bg-slate-800">Process Import</button>
                    </div>
                </div>
             </div>
        )}

        {/* Smart Match Review Modal */}
        {showMatchModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="bg-white p-6 rounded-xl w-[700px] shadow-2xl max-h-[85vh] overflow-y-auto">
                    <h3 className="font-bold mb-4 flex items-center gap-2"><BrainIcon className="w-5 h-5 text-purple-600" /> AI Suggested Matches</h3>
                    <div className="space-y-4">
                        {matches.length === 0 && <p className="text-gray-500">All suggestions handled!</p>}
                        {matches.map((m, i) => {
                            const txn = transactions.find(t => t.id === m.transactionId);
                            const matchedOrders = orders.filter(o => m.orderIds.includes(o.id));
                            if (!txn) return null;

                            return (
                                <div key={i} className="border rounded-lg p-4 bg-gray-50 relative">
                                    <div className="absolute top-2 right-2 text-xs font-bold px-2 py-1 bg-white border rounded">
                                        {(m.confidence * 100).toFixed(0)}% Match
                                    </div>
                                    <div className="mb-2">
                                        <span className={`text-xs font-bold px-2 py-0.5 rounded text-white ${m.type === 'BUNDLE' ? 'bg-indigo-500' : 'bg-green-500'}`}>{m.type}</span>
                                    </div>
                                    
                                    <div className="flex gap-4 items-start mb-3">
                                        <div className="flex-1">
                                            <div className="text-xs text-gray-500 uppercase font-bold">Bank Transaction</div>
                                            <div className="font-medium text-sm">{txn.description}</div>
                                            <div className="text-sm font-bold">${txn.amount.toFixed(2)}</div>
                                            <div className="text-xs text-gray-400">{txn.date.split('T')[0]}</div>
                                        </div>
                                        <div className="flex items-center justify-center pt-4">
                                            <LinkIcon className="w-5 h-5 text-gray-300" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="text-xs text-gray-500 uppercase font-bold">Order(s)</div>
                                            {matchedOrders.map(o => (
                                                <div key={o.id} className="mb-1 pb-1 border-b last:border-0 border-gray-200">
                                                    <div className="font-medium text-sm">{o.description}</div>
                                                    <div className="text-sm font-bold">${o.amount.toFixed(2)}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    
                                    <p className="text-xs text-gray-600 italic mb-3">AI Reason: {m.reason}</p>

                                    <div className="flex gap-2">
                                        <button onClick={() => acceptMatch(m)} className="flex-1 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700">Accept Match</button>
                                        <button onClick={() => setMatches(prev => prev.filter(pm => pm !== m))} className="px-4 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-100">Ignore</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="mt-4 text-right">
                        <button onClick={() => setShowMatchModal(false)} className="px-4 py-2 bg-gray-200 rounded text-sm hover:bg-gray-300">Close</button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
};

export default ReconciliationManager;
