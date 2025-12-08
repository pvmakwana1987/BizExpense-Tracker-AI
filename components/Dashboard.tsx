import React, { useMemo, useState } from 'react';
import { Category, Transaction, TransactionType, PeriodFilter } from '../types';
import { 
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, 
  Tooltip, CartesianGrid, Legend, Sankey, Rectangle, Layer 
} from 'recharts';

interface DashboardProps {
  transactions: Transaction[];
  categories: Category[];
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6'];

const Dashboard: React.FC<DashboardProps> = ({ transactions, categories }) => {
  const [filter, setFilter] = useState<PeriodFilter>('MONTH');

  const filteredTransactions = useMemo(() => {
    const now = new Date();
    return transactions.filter(t => {
      const tDate = new Date(t.date);
      if (filter === 'ALL') return true;
      if (filter === 'WEEK') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return tDate >= weekAgo;
      }
      if (filter === 'MONTH') {
        return tDate.getMonth() === now.getMonth() && tDate.getFullYear() === now.getFullYear();
      }
      if (filter === 'QUARTER') {
         const currentQuarter = Math.floor(now.getMonth() / 3);
         const tQuarter = Math.floor(tDate.getMonth() / 3);
         return tQuarter === currentQuarter && tDate.getFullYear() === now.getFullYear();
      }
      if (filter === 'YEAR') {
        return tDate.getFullYear() === now.getFullYear();
      }
      return true;
    });
  }, [transactions, filter]);

  // Only consider INCOME and EXPENSE for P&L
  const plTransactions = useMemo(() => filteredTransactions.filter(t => 
    t.type === TransactionType.INCOME || t.type === TransactionType.EXPENSE
  ), [filteredTransactions]);

  const totalIncome = useMemo(() => plTransactions
    .filter(t => t.type === TransactionType.INCOME)
    .reduce((sum, t) => sum + t.amount, 0), [plTransactions]);

  const totalExpense = useMemo(() => plTransactions
    .filter(t => t.type === TransactionType.EXPENSE)
    .reduce((sum, t) => sum + t.amount, 0), [plTransactions]);

  const netProfit = totalIncome - totalExpense;

  // Prepare data for Pie Chart (Expense by Category)
  const expenseByCategory = useMemo(() => {
    const data: {[key: string]: number} = {};
    plTransactions
      .filter(t => t.type === TransactionType.EXPENSE)
      .forEach(t => {
        const catName = categories.find(c => c.id === t.categoryId)?.name || 'Uncategorized';
        data[catName] = (data[catName] || 0) + t.amount;
      });
    return Object.entries(data).map(([name, value]) => ({ name, value }));
  }, [plTransactions, categories]);

  // Prepare data for Bar Chart (Income vs Expense Over Time)
  const timeSeriesData = useMemo(() => {
    const data: {[key: string]: { name: string, Income: number, Expense: number }} = {};
    
    plTransactions.forEach(t => {
      const d = new Date(t.date);
      let key = '';
      if (filter === 'YEAR' || filter === 'ALL') {
        key = d.toLocaleString('default', { month: 'short', year: '2-digit' });
      } else {
        key = d.toLocaleDateString('default', { day: 'numeric', month: 'short' });
      }

      if (!data[key]) data[key] = { name: key, Income: 0, Expense: 0 };
      
      if (t.type === TransactionType.INCOME) data[key].Income += t.amount;
      else if (t.type === TransactionType.EXPENSE) data[key].Expense += t.amount;
    });

    return Object.values(data).sort((a,b) => {
        return new Date(a.name).getTime() - new Date(b.name).getTime();
    }); 
  }, [plTransactions, filter]);

  // Prepare data for Sankey Diagram
  const sankeyData = useMemo(() => {
    const incomeMap = new Map<string, number>();
    const expenseMap = new Map<string, number>();

    plTransactions.forEach(t => {
      const catName = categories.find(c => c.id === t.categoryId)?.name || 'Uncategorized';
      if (t.type === TransactionType.INCOME) {
        incomeMap.set(catName, (incomeMap.get(catName) || 0) + t.amount);
      } else if (t.type === TransactionType.EXPENSE) {
        expenseMap.set(catName, (expenseMap.get(catName) || 0) + t.amount);
      }
    });

    const totalInc = Array.from(incomeMap.values()).reduce((a, b) => a + b, 0);
    const totalExp = Array.from(expenseMap.values()).reduce((a, b) => a + b, 0);

    if (totalInc === 0 && totalExp === 0) return { nodes: [], links: [] };

    const nodes: { name: string; color: string }[] = [];
    const links: { source: number; target: number; value: number }[] = [];

    const addNode = (name: string, color: string) => {
      const idx = nodes.findIndex(n => n.name === name);
      if (idx >= 0) return idx;
      nodes.push({ name, color });
      return nodes.length - 1;
    };

    const centerNodeIdx = addNode("Total Funds", "#64748b");

    // Income Links (Left -> Center)
    incomeMap.forEach((amount, name) => {
      const idx = addNode(name, "#10b981"); // Success color
      links.push({ source: idx, target: centerNodeIdx, value: amount });
    });

    // Deficit Handling (If Expense > Income, add a 'Deficit' node on left)
    if (totalExp > totalInc) {
      const deficit = totalExp - totalInc;
      const idx = addNode("Deficit (Loss)", "#ef4444"); // Danger color
      links.push({ source: idx, target: centerNodeIdx, value: deficit });
    }

    // Expense Links (Center -> Right)
    expenseMap.forEach((amount, name) => {
      const idx = addNode(name, "#f59e0b"); // Amber color for expenses
      links.push({ source: centerNodeIdx, target: idx, value: amount });
    });

    // Profit Handling (If Income > Expense, add 'Profit' node on right)
    if (totalInc > totalExp) {
      const profit = totalInc - totalExp;
      const idx = addNode("Net Profit", "#3b82f6"); // Blue color
      links.push({ source: centerNodeIdx, target: idx, value: profit });
    }

    return { nodes, links };
  }, [plTransactions, categories]);

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <p className="text-sm font-medium text-gray-500">Total Income</p>
          <p className="text-2xl font-bold text-success mt-1">+${totalIncome.toLocaleString()}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <p className="text-sm font-medium text-gray-500">Total Expenses</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">-${totalExpense.toLocaleString()}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <p className="text-sm font-medium text-gray-500">Net Profit</p>
          <p className={`text-2xl font-bold mt-1 ${netProfit >= 0 ? 'text-success' : 'text-danger'}`}>
            {netProfit >= 0 ? '+' : ''}${netProfit.toLocaleString()}
          </p>
          <p className="text-xs text-gray-400 mt-1">Excludes Transfers & Loans</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex justify-end bg-white p-2 rounded-lg shadow-sm border border-gray-200 inline-flex w-full md:w-auto">
        {(['WEEK', 'MONTH', 'QUARTER', 'YEAR', 'ALL'] as PeriodFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              filter === f ? 'bg-accent text-white shadow' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            {f.charAt(0) + f.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Expense Breakdown */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 h-96 flex flex-col">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Expense Breakdown</h3>
          <div className="flex-1 w-full">
            {expenseByCategory.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={expenseByCategory}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    fill="#8884d8"
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {expenseByCategory.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => `$${value.toLocaleString()}`} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400">No expense data for this period</div>
            )}
          </div>
        </div>

        {/* Cash Flow */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 h-96 flex flex-col">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Income vs Expense</h3>
          <div className="flex-1 w-full">
            {timeSeriesData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timeSeriesData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#6b7280'}} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#6b7280'}} tickFormatter={(value) => `$${value}`} />
                  <Tooltip formatter={(value: number) => `$${value.toLocaleString()}`} cursor={{fill: '#f3f4f6'}} />
                  <Legend />
                  <Bar dataKey="Income" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Expense" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400">No data for this period</div>
            )}
          </div>
        </div>
      </div>

      {/* Sankey Diagram */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 h-[500px] flex flex-col">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Cash Flow Visualization (Sankey)</h3>
        <div className="flex-1 w-full overflow-hidden">
           {sankeyData.nodes.length > 0 ? (
             <ResponsiveContainer width="100%" height="100%">
               <Sankey
                 data={sankeyData}
                 node={
                   <SankeyNode 
                     containerWidth={0} // We don't have container width easily in custom node, will use relative logic
                   />
                 }
                 nodePadding={50}
                 margin={{ left: 10, right: 10, top: 10, bottom: 10 }}
                 link={{ stroke: '#cbd5e1' }}
               >
                 <Tooltip />
               </Sankey>
             </ResponsiveContainer>
           ) : (
             <div className="h-full flex items-center justify-center text-gray-400">Not enough data to generate flow</div>
           )}
        </div>
      </div>
    </div>
  );
};

// Custom Node Component for Sankey
const SankeyNode = ({ x, y, width, height, index, payload }: any) => {
  if (!payload || !payload.value) return null;

  // Simple heuristic for text positioning based on node name type or just alternating
  // Standard Sankey: Source (Left) -> Middle -> Target (Right)
  // We can try to guess side based on X, but keeping it simple: Text inside if large, outside if small
  
  const isLeft = x < 100;
  const isRight = x > 300; // Arbitrary breakpoint for responsive container, but visual logic:
  // Better: Text on right for left nodes, text on left for right nodes.

  return (
    <Layer key={`CustomNode${index}`}>
      <Rectangle x={x} y={y} width={width} height={height} fill={payload.color || "#8884d8"} fillOpacity={0.9} />
      <text
        textAnchor={isLeft ? 'start' : 'end'}
        x={isLeft ? x + width + 6 : x - 6}
        y={y + height / 2}
        fontSize="12"
        fontWeight="bold"
        fill="#1e293b" 
        dy={-6}
      >
        {payload.name}
      </text>
      <text
        textAnchor={isLeft ? 'start' : 'end'}
        x={isLeft ? x + width + 6 : x - 6}
        y={y + height / 2}
        fontSize="11"
        fill="#64748b" 
        dy={8}
      >
        {`$${payload.value.toLocaleString()}`}
      </text>
    </Layer>
  );
};

export default Dashboard;