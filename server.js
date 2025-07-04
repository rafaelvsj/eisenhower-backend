const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const taskRoutes = require('./routes/tasks');
const aiRoutes = require('./routes/ai');
const { authenticateToken } = require('./middleware/auth.js');
const { generalLimiter } = require('./utils/rateLimiter');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware de segurança
app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

// CORS configurado restritivamente
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting global
app.use(generalLimiter);

// Logging
app.use(morgan('combined'));

// Body parser com limite
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Timeout para todas as requisições
app.use((req, res, next) => {
    req.setTimeout(30000, () => {
        res.status(408).json({ error: 'Request timeout' });
    });
    next();
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Rotas públicas
app.use('/api/auth', authRoutes);

// Rotas protegidas
app.use('/api/tasks', authenticateToken, taskRoutes);
app.use('/api/ai', authenticateToken, aiRoutes);

// Middleware de tratamento de erros
app.use((err, req, res, next) => {
    console.error('Error:', err);
    
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Invalid JSON format' });
    }
    
    if (err.name === 'ValidationError') {
        return res.status(400).json({ error: err.message });
    }
    
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: 'Invalid token' });
    }
    
    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
});

// Rota 404
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Received SIGINT. Graceful shutdown...');
    server.close(() => {
        console.log('Process terminated');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Graceful shutdown...');
    server.close(() => {
        console.log('Process terminated');
        process.exit(0);
    });
});

// Inicialização do servidor
const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔒 Security: Helmet enabled`);
    console.log(`⚡ Rate limiting: Active`);
    console.log(`🎯 Health check: /health`);
});

module.exports = app;
