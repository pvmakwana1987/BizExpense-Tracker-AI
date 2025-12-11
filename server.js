import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const app = express();
app.use(express.json({ limit: '50mb' }));

// Initialize Vertex AI
// Cloud Run will automatically provide credentials via the service account
const ai = new GoogleGenAI({
    vertexAI: true,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1'
});

// Proxy endpoint for AI calls
app.post('/api/generate', async (req, res) => {
    try {
        const { model, contents, config } = req.body;
        
        // Call Vertex AI
        const response = await ai.models.generateContent({
            model: model || 'gemini-1.5-flash',
            contents,
            config
        });

        res.json(response);
    } catch (error) {
        console.error('Vertex AI Error:', error);
        res.status(500).json({ 
            error: error.message || 'Internal Server Error',
            details: error 
        });
    }
});

// Serve static files from the React build
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, 'dist')));

// Handle React routing, return all requests to React app
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Vertex AI Project: ${process.env.GOOGLE_CLOUD_PROJECT || 'Not Set (Local)'}`);
});