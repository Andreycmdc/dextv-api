const express = require('express');
const { Telegraf } = require('telegraf');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
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

// Catálogo completo
app.get('/api/catalog', async (req, res) => {
    try {
        const movies = await moviesCollection
            .find({})
            .sort({ uploadedAt: -1 })
            .limit(50)
            .toArray();
        
        const catalog = await Promise.all(movies.map(async (movie) => {
            const streamUrl = await getStreamUrl(movie.telegramFileId);
            return {
                id: movie._id,
                title: movie.title,
                uploadedBy: movie.uploadedBy?.username || 'Anónimo',
                views: movie.views || 0,
                uploadedAt: movie.uploadedAt,
                duration: movie.duration,
                streamUrl: streamUrl
            };
        }));
        
        res.json({ success: true, data: catalog });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Una película específica
app.get('/api/movie/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const movie = await moviesCollection.findOne({ _id: new ObjectId(id) });
        
        if (!movie) {
            return res.status(404).json({ success: false, error: 'No encontrada' });
        }
        
        // Incrementar vistas
        await moviesCollection.updateOne(
            { _id: movie._id },
            { $inc: { views: 1 } }
        );
        
        const streamUrl = await getStreamUrl(movie.telegramFileId);
        
        res.json({
            success: true,
            data: {
                id: movie._id,
                title: movie.title,
                streamUrl: streamUrl,
                views: (movie.views || 0) + 1,
                uploadedBy: movie.uploadedBy?.username,
                uploadedAt: movie.uploadedAt,
                duration: movie.duration
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Buscar películas
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

app.listen(PORT, async () => {
    await connectDB();
    console.log(`🚀 API corriendo en http://localhost:${PORT}`);
    console.log(`📡 Probar: http://localhost:${PORT}/api/catalog`);
});
