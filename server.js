import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const app = express();
app.use(express.json({ limit: '50mb' }));

// Initialize Vertex AI
// Cloud Run automatically injects GOOGLE_CLOUD_PROJECT
const project = process.env.GOOGLE_CLOUD_PROJECT;
const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

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
        process.exit(1);
    }
} else {
    console.error("FATAL: GOOGLE_CLOUD_PROJECT environment variable not set. Cannot initialize Vertex AI.");
    // In production, we might want to exit, but for debugging we log error.
}

// Proxy endpoint for AI calls
app.post('/api/generate', async (req, res) => {
    if (!ai) {
        return res.status(500).json({ 
            error: "Vertex AI not initialized. Check server logs." 
        });
    }

    try {
        const { model, contents, config } = req.body;
        
        // Call Vertex AI
        // Note: SDK structure is ai.models.generateContent
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
});