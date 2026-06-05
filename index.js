const express = require('express');
const { Telegraf } = require('telegraf');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const fetch = require('node-fetch'); // 👈 NUEVO: para hacer peticiones HTTP
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
const bot = new Telegraf(BOT_TOKEN);

let moviesCollection;

async function connectDB() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db('dextv');
    moviesCollection = db.collection('movies');
    console.log('✅ API conectada a MongoDB');
}

async function getStreamUrl(telegramFileId) {
    const file = await bot.telegram.getFile(telegramFileId);
    return `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
}

// ============================================
// NUEVO: PROXY DE STREAMING (EVITA DESCARGA)
// ============================================
app.get('/api/stream/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const movie = await moviesCollection.findOne({ _id: new ObjectId(id) });
        
        if (!movie) {
            return res.status(404).json({ success: false, error: 'No encontrada' });
        }
        
        // Obtener URL de Telegram
        const file = await bot.telegram.getFile(movie.telegramFileId);
        const telegramUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
        
        // Hacer fetch al video de Telegram
        const response = await fetch(telegramUrl);
        
        // Headers CORRECTOS para streaming (NO descarga)
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Disposition', 'inline'); // 👈 CLAVE: inline NO attachment
        res.setHeader('Cache-Control', 'no-cache');
        
        // Enviar el video como stream
        response.body.pipe(res);
        
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// ENDPOINTS ORIGINALES (sin cambios)
// ============================================

// Catálogo
app.get('/api/catalog', async (req, res) => {
    try {
        const movies = await moviesCollection
            .find({})
            .sort({ uploadedAt: -1 })
            .limit(50)
            .toArray();
        
        const catalog = [];
        for (const movie of movies) {
            const streamUrl = await getStreamUrl(movie.telegramFileId);
            catalog.push({
                id: movie._id,
                title: movie.title,
                uploadedBy: movie.uploadedBy?.username || 'Anónimo',
                views: movie.views || 0,
                streamUrl: streamUrl
            });
        }
        
        res.json({ success: true, data: catalog });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Película específica
app.get('/api/movie/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const movie = await moviesCollection.findOne({ _id: new ObjectId(id) });
        
        if (!movie) {
            return res.status(404).json({ success: false, error: 'No encontrada' });
        }
        
        await moviesCollection.updateOne({ _id: movie._id }, { $inc: { views: 1 } });
        const streamUrl = await getStreamUrl(movie.telegramFileId);
        
        res.json({
            success: true,
            data: {
                id: movie._id,
                title: movie.title,
                streamUrl: streamUrl,
                views: movie.views + 1,
                uploadedBy: movie.uploadedBy?.username
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Búsqueda
app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;
        const movies = await moviesCollection
            .find({ title: { $regex: q, $options: 'i' } })
            .limit(20)
            .toArray();
        
        res.json({
            success: true,
            data: movies.map(m => ({
                id: m._id,
                title: m.title,
                uploadedBy: m.uploadedBy?.username
            }))
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check (para Render)
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Raíz
app.get('/', (req, res) => {
    res.json({ success: true, message: 'Dex TV API Online' });
});

// Iniciar servidor
app.listen(PORT, async () => {
    await connectDB();
    console.log(`🚀 API corriendo en puerto ${PORT}`);
    console.log(`📡 Proxy streaming disponible en /api/stream/:id`);
});