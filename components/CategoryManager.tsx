import React, { useState } from 'react';
import { Category, SubCategory, TransactionType } from '../types';
import { PlusIcon, TrashIcon, CheckIcon } from './Icons';

interface CategoryManagerProps {
  categories: Category[];
  setCategories: React.Dispatch<React.SetStateAction<Category[]>>;
}

const COLORS = [
  '#ef4444', // Red
  '#f97316', // Orange
  '#f59e0b', // Amber
  '#84cc16', // Lime
  '#10b981', // Emerald
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#d946ef', // Fuchsia
  '#f43f5e', // Rose
  '#64748b', // Slate
];

const CategoryManager: React.FC<CategoryManagerProps> = ({ categories, setCategories }) => {
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<TransactionType>(TransactionType.EXPENSE);
  const [newCatColor, setNewCatColor] = useState<string>(COLORS[6]); // Default blue
  const [newSubName, setNewSubName] = useState<{[key: string]: string}>({});

  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    const newCategory: Category = {
      id: `cat-${Date.now()}`,
      name: newCatName,
      type: newCatType,
      subcategories: [],
      color: newCatColor
    };
    setCategories([...categories, newCategory]);
    setNewCatName('');
    // Pick a random next color for variety
    setNewCatColor(COLORS[Math.floor(Math.random() * COLORS.length)]);
  };

  const handleDeleteCategory = (id: string) => {
    setCategories(categories.filter(c => c.id !== id));
  };

  const handleAddSubcategory = (categoryId: string) => {
    const name = newSubName[categoryId];
    if (!name?.trim()) return;

    setCategories(categories.map(c => {
      if (c.id === categoryId) {
        return {
          ...c,
          subcategories: [...c.subcategories, { id: `sub-${Date.now()}`, name }]
        };
      }
      return c;
    }));
    setNewSubName({ ...newSubName, [categoryId]: '' });
  };

  const handleDeleteSubcategory = (categoryId: string, subId: string) => {
    setCategories(categories.map(c => {
      if (c.id === categoryId) {
        return {
          ...c,
          subcategories: c.subcategories.filter(s => s.id !== subId)
        };
      }
      return c;
    }));
  };

  const renderCategoryGroup = (type: TransactionType, title: string) => {
    const groupCategories = categories.filter(c => c.type === type);
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-gray-900 border-b pb-2 flex items-center justify-between">
          <span>{title}</span>
          <span className="text-xs font-normal text-gray-500 bg-gray-100 px-2 py-1 rounded">{groupCategories.length}</span>
        </h3>
        {groupCategories.length === 0 && <p className="text-sm text-gray-400 italic">No categories.</p>}
        {groupCategories.map(category => (
           <CategoryCard 
             key={category.id} 
             category={category} 
             onDeleteCat={handleDeleteCategory}
             onAddSub={handleAddSubcategory}
             onDeleteSub={handleDeleteSubcategory}
             subNameValue={newSubName[category.id] || ''}
             setSubNameValue={(val: string) => setNewSubName({ ...newSubName, [category.id]: val })}
           />
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Create Category */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
        <h3 className="text-lg font-bold mb-4">Add New Category</h3>
        <form onSubmit={handleAddCategory} className="space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700">Category Name</label>
              <input 
                type="text" 
                value={newCatName} 
                onChange={e => setNewCatName(e.target.value)}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-accent focus:border-accent sm:text-sm"
                placeholder="e.g. Office Supplies"
              />
            </div>
            <div className="w-full md:w-48">
              <label className="block text-sm font-medium text-gray-700">Type</label>
              <select 
                value={newCatType}
                onChange={e => setNewCatType(e.target.value as TransactionType)}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-accent focus:border-accent sm:text-sm"
              >
                <option value={TransactionType.EXPENSE}>Expense</option>
                <option value={TransactionType.INCOME}>Income</option>
                <option value={TransactionType.TRANSFER}>Transfer</option>
                <option value={TransactionType.LOAN}>Loan/Debt</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Category Color</label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setNewCatColor(c)}
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${newCatColor === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c }}
                  title={c}
                >
                  {newCatColor === c && <CheckIcon className="w-4 h-4 text-white drop-shadow-md" />}
                </button>
              ))}
            </div>
          </div>

          <button type="submit" className="w-full md:w-auto bg-primary text-white px-6 py-2 rounded-md hover:bg-slate-800 transition-colors flex items-center justify-center gap-2">
            <PlusIcon className="w-4 h-4" /> Add Category
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {renderCategoryGroup(TransactionType.EXPENSE, "Expense Categories")}
        {renderCategoryGroup(TransactionType.INCOME, "Income Categories")}
        {renderCategoryGroup(TransactionType.TRANSFER, "Transfer Categories")}
        {renderCategoryGroup(TransactionType.LOAN, "Loan Categories")}
      </div>
    </div>
  );
};

const CategoryCard = ({ category, onDeleteCat, onAddSub, onDeleteSub, subNameValue, setSubNameValue }: any) => {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
      {/* Color Stripe */}
      <div 
        className="absolute left-0 top-0 bottom-0 w-1.5" 
        style={{ backgroundColor: category.color || '#cbd5e1' }}
      ></div>

      <div className="flex justify-between items-center mb-3 pl-3">
        <h4 className="font-semibold text-gray-800 flex items-center gap-2">
           {category.name}
        </h4>
        <button onClick={() => onDeleteCat(category.id)} className="text-gray-400 hover:text-danger">
          <TrashIcon className="w-4 h-4" />
        </button>
      </div>
      
      <div className="space-y-2 mb-3 pl-3">
        {category.subcategories.length === 0 && <p className="text-xs text-gray-400 italic">No subcategories</p>}
        {category.subcategories.map((sub: any) => (
          <div key={sub.id} className="flex justify-between items-center text-sm bg-gray-50 px-2 py-1 rounded">
            <span>{sub.name}</span>
            <button onClick={() => onDeleteSub(category.id, sub.id)} className="text-gray-400 hover:text-danger">
              <span className="text-xs">&times;</span>
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2 pl-3">
        <input 
          type="text" 
          placeholder="Add subcategory..." 
          className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 focus:ring-accent focus:border-accent"
          value={subNameValue}
          onChange={e => setSubNameValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onAddSub(category.id)}
        />
        <button onClick={() => onAddSub(category.id)} className="bg-gray-100 hover:bg-gray-200 text-gray-600 rounded px-2 py-1">
          <PlusIcon className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

export default CategoryManager;