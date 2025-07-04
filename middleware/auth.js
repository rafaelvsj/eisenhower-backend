const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

// Configuração Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Middleware de autenticação
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Access token required' });
        }

        // Verificar JWT
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Verificar se usuário ainda existe no banco
        const { data: user, error } = await supabase
            .from('profiles')
            .select('id, email, full_name')
            .eq('id', decoded.userId)
            .single();

        if (error || !user) {
            console.error('User not found in database:', error);
            return res.status(401).json({ error: 'User not found' });
        }

        // Adicionar informações do usuário ao request
        req.user = {
            userId: decoded.userId,
            email: decoded.email || user.email,
            fullName: decoded.fullName || user.full_name,
            id: user.id
        };

        next();

    } catch (error) {
        console.error('Authentication error:', error);
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        
        // Erro de conexão com Supabase
        if (error.message && error.message.includes('fetch')) {
            return res.status(503).json({ error: 'Database connection failed' });
        }
        
        return res.status(500).json({ error: 'Authentication failed' });
    }
};

// Middleware para verificar admin
const requireAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (req.user.email !== 'admin@admin.com') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// Middleware para logging de atividades
const logActivity = (req, res, next) => {
    const startTime = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - startTime;
        const userInfo = req.user?.email || 'Anonymous';
        const timestamp = new Date().toISOString();
        
        console.log(`[${timestamp}] ${req.method} ${req.originalUrl} - ${res.statusCode} - ${duration}ms - User: ${userInfo}`);
        
        // Log de auditoria para operações sensíveis
        if (req.method !== 'GET' && req.user) {
            console.log(`[AUDIT] ${timestamp} - ${userInfo} performed ${req.method} on ${req.originalUrl}`);
        }
    });
    
    next();
};

// Middleware opcional para rate limiting por usuário
const userRateLimit = (req, res, next) => {
    // Implementar se necessário
    next();
};

module.exports = {
    authenticateToken,
    requireAdmin,
    logActivity,
    userRateLimit
};
