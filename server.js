import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const app = express();
app.use(express.json({ limit: '50mb' }));

// --- Google Cloud & Firebase Setup ---

// Cloud Run automatically sets GOOGLE_CLOUD_PROJECT
const project = process.env.GOOGLE_CLOUD_PROJECT;
const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

// Initialize Firebase
// Ensure your Cloud Run Service Account has "Firebase Admin" or "Cloud Datastore User" roles.
let db;
try {
  initializeApp({
    credential: applicationDefault(),
    projectId: project
  });
  db = getFirestore();
  console.log("Firebase Firestore initialized.");
} catch (e) {
  console.error("Failed to initialize Firebase:", e);
  console.warn("Falling back to in-memory storage (Data will be lost on restart).");
}

// Initialize Vertex AI
let ai = null;
if (project) {
    try {
        ai = new GoogleGenAI({
            vertexAI: true,
            project: project,
            location: location
        });
        console.log(`Vertex AI initialized for project: ${project}`);
    } catch (e) {
        console.error("Failed to initialize Vertex AI client:", e);
    }
} else {
    console.error("FATAL: GOOGLE_CLOUD_PROJECT environment variable not set.");
}

// --- Helper: Batch Sync ---
// Efficiently updates a collection based on the new full state from the frontend
async function syncCollection(collectionName, newItems) {
  if (!db) return;
  
  const collectionRef = db.collection(collectionName);
  const snapshot = await collectionRef.get();
  
  // Track existing IDs to find deletions
  const existingIds = new Set();
  snapshot.forEach(doc => existingIds.add(doc.id));

  const batchSize = 450; // Firestore limit is 500
  let batches = [];
  let currentBatch = db.batch();
  let count = 0;

  // 1. Upsert (Add/Update)
  for (const item of newItems) {
    const docRef = collectionRef.doc(item.id);
    // Convert any Dates to strings if necessary, though JSON transport usually handles this.
    // Ensure undefined values are omitted or handled, as Firestore rejects undefined.
    const cleanItem = JSON.parse(JSON.stringify(item)); 
    
    currentBatch.set(docRef, cleanItem);
    existingIds.delete(item.id);
    
    count++;
    if (count >= batchSize) {
      batches.push(currentBatch);
      currentBatch = db.batch();
      count = 0;
    }
  }

  // 2. Delete removed items
  for (const id of existingIds) {
    const docRef = collectionRef.doc(id);
    currentBatch.delete(docRef);
    
    count++;
    if (count >= batchSize) {
      batches.push(currentBatch);
      currentBatch = db.batch();
      count = 0;
    }
  }

  if (count > 0) batches.push(currentBatch);

  // Commit all batches
  await Promise.all(batches.map(b => b.commit()));
}

// --- API Endpoints ---

// 1. Get All Data (Bootstrapping)
app.get('/api/bootstrap', async (req, res) => {
  if (!db) return res.json({ categories: [], transactions: [], rules: [] });
  
  try {
    const [cats, txns, rules] = await Promise.all([
      db.collection('categories').get(),
      db.collection('transactions').get(),
      db.collection('rules').get()
    ]);

    const getData = (snap) => snap.docs.map(d => d.data());

    res.json({
      categories: getData(cats),
      transactions: getData(txns),
      rules: getData(rules)
    });
  } catch (error) {
    console.error("Bootstrap Error:", error);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// 2. Sync Endpoints
app.post('/api/sync/:type', async (req, res) => {
  const { type } = req.params;
  const data = req.body; // Array of items
  
  if (!['categories', 'transactions', 'rules'].includes(type)) {
    return res.status(400).json({ error: "Invalid type" });
  }

  try {
    await syncCollection(type, data);
    res.json({ success: true });
  } catch (error) {
    console.error(`Sync error for ${type}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// 3. AI Proxy
app.post('/api/generate', async (req, res) => {
    if (!ai) return res.status(500).json({ error: "Vertex AI not initialized." });

    try {
        const { model, contents, config } = req.body;
        const response = await ai.models.generateContent({
            model: model || 'gemini-1.5-flash',
            contents,
            config
        });
        res.json(response);
    } catch (error) {
        console.error('Vertex AI Error:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

// --- Static Files ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
