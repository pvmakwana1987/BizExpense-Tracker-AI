import React, { useMemo, useState } from 'react';
import { Category, Transaction, TransactionType, PeriodFilter } from '../types';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

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
  const plTransactions = filteredTransactions.filter(t => 
    t.type === TransactionType.INCOME || t.type === TransactionType.EXPENSE
  );

  const totalIncome = plTransactions
    .filter(t => t.type === TransactionType.INCOME)
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpense = plTransactions
    .filter(t => t.type === TransactionType.EXPENSE)
    .reduce((sum, t) => sum + t.amount, 0);

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
    </div>
  );
};

export default Dashboard;