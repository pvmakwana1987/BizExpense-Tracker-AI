import React, { useState, useRef } from 'react';
import { Transaction, ReconciliationOrder } from '../types';
import { UploadIcon, CheckIcon, LinkIcon, FileIcon } from './Icons';

declare const XLSX: any;

interface ReconciliationManagerProps {
  transactions: Transaction[];
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
}

const ReconciliationManager: React.FC<ReconciliationManagerProps> = ({ transactions, setTransactions }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [orders, setOrders] = useState<ReconciliationOrder[]>([]);
  const [columnMapping, setColumnMapping] = useState({ date: 0, description: 1, amount: 2 });
  const [showMapper, setShowMapper] = useState(false);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [allRows, setAllRows] = useState<string[][]>([]);

  // Filtering
  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (evt) => {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'array' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false, dateNF: 'yyyy-mm-dd' }) as string[][];
        setAllRows(data);
        setPreviewRows(data.slice(0, 5));
        setShowMapper(true);
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
                amount
            });
        }
    });
    setOrders(newOrders);
    setShowMapper(false);
  };

  const getSuggestedMatches = (order: ReconciliationOrder) => {
    // Find transactions with same amount within +/- 5 days
    const orderDate = new Date(order.date);
    const minDate = new Date(orderDate); minDate.setDate(minDate.getDate() - 5);
    const maxDate = new Date(orderDate); maxDate.setDate(maxDate.getDate() + 5);

    return transactions.filter(t => {
        if (t.amount !== order.amount) return false;
        const tDate = new Date(t.date);
        return tDate >= minDate && tDate <= maxDate;
    });
  };

  const linkTransaction = (orderId: string, transactionId: string) => {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      setTransactions(prev => prev.map(t => {
          if (t.id === transactionId) {
              const currentNotes = t.comments || '';
              const newNote = `Matched Order: ${order.description} (${order.date})`;
              return { 
                  ...t, 
                  comments: currentNotes ? `${currentNotes} | ${newNote}` : newNote,
                  merchant: t.merchant || order.description.substring(0, 30) // Optional: update merchant if empty
              };
          }
          return t;
      }));

      // Mark order as matched locally (remove from list or strikethrough)
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, matchedTransactionId: transactionId } : o));
  };

  const activeOrders = orders.filter(o => !o.matchedTransactionId);

  return (
    <div className="space-y-6 animate-fade-in">
        <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold">Reconciliation</h2>
            <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded hover:bg-slate-800">
                <UploadIcon className="w-4 h-4" /> Upload Order CSV
            </button>
            <input type="file" ref={fileInputRef} className="hidden" accept=".csv,.xlsx" onChange={handleFileSelect} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-[calc(100vh-200px)]">
            {/* Left: Orders */}
            <div className="bg-white border rounded-xl shadow-sm flex flex-col overflow-hidden">
                <div className="p-4 bg-gray-50 border-b font-bold flex justify-between">
                    <span>Unmatched Orders ({activeOrders.length})</span>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {activeOrders.length === 0 && <div className="text-center text-gray-400 mt-10">No orders uploaded or all matched.</div>}
                    {activeOrders.map(order => {
                        const matches = getSuggestedMatches(order);
                        return (
                            <div key={order.id} className="border p-3 rounded hover:bg-gray-50 transition">
                                <div className="flex justify-between items-start mb-2">
                                    <div>
                                        <div className="font-bold text-sm">{order.date}</div>
                                        <div className="text-xs text-gray-600 line-clamp-2">{order.description}</div>
                                    </div>
                                    <div className="font-bold text-blue-600">${order.amount.toFixed(2)}</div>
                                </div>
                                
                                {matches.length > 0 ? (
                                    <div className="mt-2 space-y-1">
                                        <div className="text-[10px] uppercase font-bold text-green-600">Suggested Bank Matches:</div>
                                        {matches.map(m => (
                                            <button 
                                                key={m.id} 
                                                onClick={() => linkTransaction(order.id, m.id)}
                                                className="w-full text-left text-xs bg-green-50 border border-green-200 p-2 rounded flex justify-between items-center hover:bg-green-100"
                                            >
                                                <span>{m.date.split('T')[0]} - {m.description}</span>
                                                <LinkIcon className="w-3 h-3 text-green-700" />
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-[10px] text-gray-400 italic">No matching transaction found (+/- 5 days)</div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Right: Transactions */}
            <div className="bg-white border rounded-xl shadow-sm flex flex-col overflow-hidden">
                <div className="p-4 bg-gray-50 border-b font-bold">
                    <span>Bank Transactions</span>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                     <table className="w-full text-xs text-left">
                         <thead className="text-gray-500 border-b">
                             <tr>
                                 <th className="pb-2">Date</th>
                                 <th className="pb-2">Desc</th>
                                 <th className="pb-2">Amount</th>
                                 <th className="pb-2">Notes</th>
                             </tr>
                         </thead>
                         <tbody className="divide-y">
                             {transactions.slice(0, 100).map(t => (
                                 <tr key={t.id} className="group hover:bg-gray-50">
                                     <td className="py-2 text-gray-600">{t.date.split('T')[0]}</td>
                                     <td className="py-2 font-medium truncate max-w-[150px]" title={t.description}>{t.description}</td>
                                     <td className="py-2 font-bold">${t.amount.toFixed(2)}</td>
                                     <td className="py-2 text-gray-500 truncate max-w-[150px]">{t.comments}</td>
                                 </tr>
                             ))}
                         </tbody>
                     </table>
                </div>
            </div>
        </div>

        {/* Mapper Modal */}
        {showMapper && (
             <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="bg-white p-6 rounded-xl w-[600px] shadow-2xl">
                    <h3 className="font-bold mb-4">Map Order CSV</h3>
                    <div className="text-sm text-gray-500 mb-4">Select columns for Date, Description, and Total Amount.</div>
                    
                    <div className="overflow-x-auto mb-4 bg-gray-50 p-2 rounded border">
                        <table className="text-xs w-full">
                            <tbody>
                                {previewRows.map((row, i) => (
                                    <tr key={i}>
                                        <td className="pr-2 text-gray-400 font-bold">{i+1}.</td>
                                        {row.map((cell, j) => (
                                            <td key={j} className={`border px-1 max-w-[100px] truncate ${j === columnMapping.date ? 'bg-blue-100' : j === columnMapping.description ? 'bg-yellow-100' : j === columnMapping.amount ? 'bg-green-100' : ''}`}>
                                                {cell}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="grid grid-cols-3 gap-4 mb-4">
                         <div>
                             <label className="text-xs font-bold block mb-1">Date Col</label>
                             <input type="number" className="w-full border rounded p-1 border-blue-300" value={columnMapping.date} onChange={e => setColumnMapping({...columnMapping, date: parseInt(e.target.value)})} />
                         </div>
                         <div>
                             <label className="text-xs font-bold block mb-1">Desc Col</label>
                             <input type="number" className="w-full border rounded p-1 border-yellow-300" value={columnMapping.description} onChange={e => setColumnMapping({...columnMapping, description: parseInt(e.target.value)})} />
                         </div>
                         <div>
                             <label className="text-xs font-bold block mb-1">Amount Col</label>
                             <input type="number" className="w-full border rounded p-1 border-green-300" value={columnMapping.amount} onChange={e => setColumnMapping({...columnMapping, amount: parseInt(e.target.value)})} />
                         </div>
                    </div>

                    <div className="flex gap-2">
                        <button onClick={() => setShowMapper(false)} className="flex-1 py-2 bg-gray-100 rounded">Cancel</button>
                        <button onClick={processOrders} className="flex-1 py-2 bg-primary text-white rounded">Process Orders</button>
                    </div>
                </div>
             </div>
        )}
    </div>
  );
};

export default ReconciliationManager;