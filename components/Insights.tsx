import React, { useState, useRef, useEffect } from 'react';
import { Transaction } from '../types';
import { ChatIcon, SendIcon, SparklesIcon } from './Icons';
import { getFinancialInsights } from '../services/geminiService';

interface InsightsProps {
  transactions: Transaction[];
}

interface Message {
  role: 'user' | 'ai';
  text: string;
}

const Insights: React.FC<InsightsProps> = ({ transactions }) => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', text: "Hello! I'm your financial assistant. Ask me anything about your spending, income, or tax-deductible expenses." }
  ]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg = input;
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setInput('');
    setLoading(true);

    const answer = await getFinancialInsights(transactions, userMsg);
    setMessages(prev => [...prev, { role: 'ai', text: answer }]);
    setLoading(false);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-4 border-b bg-gray-50 flex items-center gap-2">
         <SparklesIcon className="w-5 h-5 text-purple-600" />
         <h2 className="font-bold text-gray-800">Financial Insights</h2>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((m, idx) => (
          <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
             <div className={`max-w-[80%] p-3 rounded-lg text-sm ${m.role === 'user' ? 'bg-accent text-white rounded-br-none' : 'bg-gray-100 text-gray-800 rounded-bl-none'}`}>
                {m.text}
             </div>
          </div>
        ))}
        {loading && <div className="text-xs text-gray-400 ml-4 animate-pulse">Thinking...</div>}
        <div ref={bottomRef}></div>
      </div>

      <form onSubmit={handleSend} className="p-4 border-t bg-white flex gap-2">
        <input 
          type="text" 
          className="flex-1 border border-gray-300 rounded-full px-4 py-2 text-sm focus:ring-accent focus:border-accent outline-none"
          placeholder="e.g. How much did I spend on Uber last month?"
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={loading}
        />
        <button type="submit" disabled={loading} className="bg-accent text-white p-2 rounded-full hover:bg-blue-600 disabled:opacity-50">
           <SendIcon className="w-5 h-5" />
        </button>
      </form>
    </div>
  );
};

export default Insights;