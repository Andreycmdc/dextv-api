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

async function connectDB() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db('dextv');
    moviesCollection = db.collection('movies');
    console.log('✅ API conectada a MongoDB');
}

// ============================================
// PROXY DE STREAMING OPTIMIZADO
// ============================================
app.get('/api/stream/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const movie = await moviesCollection.findOne({ _id: new ObjectId(id) });
        
        if (!movie) {
            return res.status(404).json({ error: 'No encontrada' });
        }

        // Obtener URL de Telegram
        const file = await bot.telegram.getFile(movie.telegramFileId);
        const telegramUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
        
        // Hacer la petición a Telegram
        const response = await fetch(telegramUrl);
        
        // Validar respuesta de Telegram
        if (!response.ok) {
            return res.status(502).json({ error: 'Error al obtener el video de Telegram' });
        }
        
        // Detectar el tipo de contenido real
        let contentType = response.headers.get('content-type') || 'video/mp4';
        // Forzar MP4 para MOV (corrige el problema #4)
        if (contentType.includes('video/quicktime') || telegramUrl.includes('.mov')) {
            contentType = 'video/mp4';
        }
        
        // Obtener tamaño del video
        const totalSize = parseInt(response.headers.get('content-length'), 10);
        
        // Manejar range requests (soporte para seek - corrige problema #3)
        const range = req.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
            const chunkSize = (end - start) + 1;
            
            // Crear una solicitud de rango a Telegram
            const rangeResponse = await fetch(telegramUrl, {
                headers: { Range: `bytes=${start}-${end}` }
            });
            
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${totalSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': contentType,
                'Content-Disposition': 'inline'
            });
            
            // Pipe directo sin buffer (corrige problema #1 y #2)
            rangeResponse.body.pipe(res);
        } else {
            // Sin range, enviar video completo
            res.writeHead(200, {
                'Content-Length': totalSize,
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes',
                'Content-Disposition': 'inline'
            });
            
            // Pipe directo - STREAMING REAL (corrige problema #1, #2, #7)
            response.body.pipe(res);
        }
        
    } catch (error) {
        console.error('Stream Error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// ============================================
// CATÁLOGO (sin streamUrl)
// ============================================
app.get('/api/catalog', async (req, res) => {
    try {
        const movies = await moviesCollection
            .find({})
            .sort({ uploadedAt: -1 })
            .limit(50)
            .toArray();
        
        const catalog = movies.map(movie => ({
            id: movie._id,
            title: movie.title,
            uploadedBy: movie.uploadedBy?.username || 'Anónimo',
            views: movie.views || 0,
            duration: movie.duration
        }));
        
        res.json({ success: true, data: catalog });
    } catch (error) {
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
        
        // Incrementar vistas en segundo plano (no bloquear)
        moviesCollection.updateOne({ _id: movie._id }, { $inc: { views: 1 } }).catch(e => console.log(e));
        
        res.json({
            success: true,
            data: {
                id: movie._id,
                title: movie.title,
                views: movie.views + 1,
                uploadedBy: movie.uploadedBy?.username,
                duration: movie.duration
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

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.get('/', (req, res) => {
    res.json({ success: true, message: 'Dex TV API Online - Streaming Optimizado' });
});

app.listen(PORT, async () => {
    await connectDB();
    console.log(`🚀 API corriendo en puerto ${PORT}`);
    console.log(`📡 Streaming optimizado en /api/stream/:id`);
});