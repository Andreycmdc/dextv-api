const express = require('express');
const { Telegraf } = require('telegraf');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
const bot = new Telegraf(BOT_TOKEN);

let moviesCollection;

// ============================================
// CONEXIÓN A MONGODB
// ============================================
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
// PROXY DE STREAMING MEJORADO (CON SOPORTE RANGE)
// ============================================
app.get('/api/stream/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const movie = await moviesCollection.findOne({
            _id: new ObjectId(id)
        });

        if (!movie) {
            return res.status(404).json({
                success: false,
                error: 'No encontrada'
            });
        }

        const file = await bot.telegram.getFile(
            movie.telegramFileId
        );

        const telegramUrl =
            `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

        const headers = {};

        if (req.headers.range) {
            headers.Range = req.headers.range;
        }

        const response = await fetch(telegramUrl, {
            headers
        });

        const contentType =
            response.headers.get('content-type') ||
            'video/mp4';

        const contentLength =
            response.headers.get('content-length');

        const contentRange =
            response.headers.get('content-range');

        const statusCode =
            req.headers.range ? 206 : 200;

        res.status(statusCode);

        res.setHeader('Content-Type', contentType);
        res.setHeader('Accept-Ranges', 'bytes');

        if (contentLength) {
            res.setHeader(
                'Content-Length',
                contentLength
            );
        }

        if (contentRange) {
            res.setHeader(
                'Content-Range',
                contentRange
            );
        }

        response.body.pipe(res);

    } catch (error) {
        console.error('Stream Error:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// CATÁLOGO
// ============================================
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

// ============================================
// PELÍCULA ESPECÍFICA
// ============================================
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

// ============================================
// BÚSQUEDA
// ============================================
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

// ============================================
// HEALTH CHECK (para Render)
// ============================================
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// ============================================
// RAÍZ
// ============================================
app.get('/', (req, res) => {
    res.json({ success: true, message: 'Dex TV API Online' });
});

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, async () => {
    await connectDB();
    console.log(`🚀 API corriendo en puerto ${PORT}`);
    console.log(`📡 Proxy streaming disponible en /api/stream/:id`);
});