const rateLimit = require('express-rate-limit');

// Rate limiter geral
const generalLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutos
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // 100 requests por janela
    message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: 15 * 60 // 15 minutos
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Usar IP + User-Agent para identificação mais precisa
        return req.ip + req.get('User-Agent');
    },
    handler: (req, res) => {
        console.log(`Rate limit exceeded for IP: ${req.ip} at ${new Date().toISOString()}`);
        res.status(429).json({
            error: 'Too many requests',
            retryAfter: Math.ceil(15 * 60), // segundos
            message: 'Please wait before making more requests'
        });
    }
});

// Rate limiter para autenticação (mais restritivo)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 10, // 10 tentativas de login por IP
    message: {
        error: 'Too many authentication attempts, please try again later.',
        retryAfter: 15 * 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return req.ip;
    },
    handler: (req, res) => {
        console.log(`Auth rate limit exceeded for IP: ${req.ip} at ${new Date().toISOString()}`);
        res.status(429).json({
            error: 'Too many authentication attempts',
            retryAfter: Math.ceil(15 * 60),
            message: 'Please wait before attempting to login again'
        });
    }
});

// Rate limiter para tarefas
const taskLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 30, // 30 operações de tarefa por minuto
    message: {
        error: 'Too many task operations, please slow down.',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return req.user?.userId || req.ip;
    },
    handler: (req, res) => {
        console.log(`Task rate limit exceeded for user: ${req.user?.userId || req.ip} at ${new Date().toISOString()}`);
        res.status(429).json({
            error: 'Too many task operations',
            retryAfter: Math.ceil(60),
            message: 'Please slow down your task operations'
        });
    }
});

// Rate limiter para IA (muito restritivo)
const aiLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutos
    max: 5, // 5 chamadas de IA por usuário a cada 5 minutos
    message: {
        error: 'AI rate limit exceeded, please wait before making more AI requests.',
        retryAfter: 5 * 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return `ai_${req.user?.userId || req.ip}`;
    },
    handler: (req, res) => {
        console.log(`AI rate limit exceeded for user: ${req.user?.userId || req.ip} at ${new Date().toISOString()}`);
        res.status(429).json({
            error: 'AI rate limit exceeded',
            retryAfter: Math.ceil(5 * 60),
            message: 'Please wait before making more AI requests to prevent abuse'
        });
    }
});

// Rate limiter para uploads
const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 10, // 10 uploads por hora
    message: {
        error: 'Upload rate limit exceeded.',
        retryAfter: 60 * 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return `upload_${req.user?.userId || req.ip}`;
    }
});

// Rate limiter personalizado com diferentes limites por usuário
const createCustomLimiter = (options = {}) => {
    const {
        windowMs = 15 * 60 * 1000,
        max = 100,
        message = 'Rate limit exceeded',
        keyGenerator = (req) => req.ip,
        skipSuccessfulRequests = false,
        skipFailedRequests = false
    } = options;

    return rateLimit({
        windowMs,
        max,
        message: { error: message },
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator,
        skipSuccessfulRequests,
        skipFailedRequests,
        handler: (req, res) => {
            console.log(`Custom rate limit exceeded for key: ${keyGenerator(req)} at ${new Date().toISOString()}`);
            res.status(429).json({
                error: message,
                retryAfter: Math.ceil(windowMs / 1000)
            });
        }
    });
};

// Rate limiter baseado em pontos (mais sofisticado)
class PointsBasedLimiter {
    constructor() {
        this.points = new Map();
        this.windowMs = 15 * 60 * 1000; // 15 minutos
        this.maxPoints = 100;
        
        // Limpeza automática a cada 5 minutos
        setInterval(() => {
            this.cleanup();
        }, 5 * 60 * 1000);
    }

    // Definir custos por operação
    getCost(operation) {
        const costs = {
            'GET': 1,
            'POST': 2,
            'PUT': 2,
            'DELETE': 3,
            'AI': 10,
            'AUTH': 5,
            'UPLOAD': 15
        };
        return costs[operation] || 1;
    }

    // Verificar se pode executar operação
    canExecute(key, operation) {
        const now = Date.now();
        const cost = this.getCost(operation);
        
        if (!this.points.has(key)) {
            this.points.set(key, {
                points: 0,
                resetTime: now + this.windowMs
            });
        }

        const userPoints = this.points.get(key);
        
        // Reset se janela expirou
        if (now > userPoints.resetTime) {
            userPoints.points = 0;
            userPoints.resetTime = now + this.windowMs;
        }

        // Verificar se pode executar
        if (userPoints.points + cost > this.maxPoints) {
            return false;
        }

        // Consumir pontos
        userPoints.points += cost;
        return true;
    }

    // Limpeza de entradas antigas
    cleanup() {
        const now = Date.now();
        for (const [key, data] of this.points.entries()) {
            if (now > data.resetTime) {
                this.points.delete(key);
            }
        }
    }

    // Middleware
    middleware(operation) {
        return (req, res, next) => {
            const key = req.user?.userId || req.ip;
            
            if (!this.canExecute(key, operation)) {
                return res.status(429).json({
                    error: 'Rate limit exceeded',
                    message: 'Too many operations, please slow down'
                });
            }
            
            next();
        };
    }
}

const pointsLimiter = new PointsBasedLimiter();

module.exports = {
    generalLimiter,
    authLimiter,
    taskLimiter,
    aiLimiter,
    uploadLimiter,
    createCustomLimiter,
    pointsLimiter
};