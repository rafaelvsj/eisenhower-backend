const NodeCache = require('node-cache');

// Cache principal com TTL de 5 minutos
const mainCache = new NodeCache({
    stdTTL: 300, // 5 minutos
    checkperiod: 60, // verificar itens expirados a cada minuto
    useClones: false, // performance
    deleteOnExpire: true,
    maxKeys: 1000 // máximo 1000 itens em cache
});

// Cache para sessões com TTL de 1 hora
const sessionCache = new NodeCache({
    stdTTL: 3600, // 1 hora
    checkperiod: 300, // verificar a cada 5 minutos
    useClones: false,
    deleteOnExpire: true,
    maxKeys: 500
});

// Cache para dados de IA com TTL de 10 minutos
const aiCache = new NodeCache({
    stdTTL: 600, // 10 minutos
    checkperiod: 60,
    useClones: false,
    deleteOnExpire: true,
    maxKeys: 200
});

// Cache para rate limiting com TTL de 15 minutos
const rateLimitCache = new NodeCache({
    stdTTL: 900, // 15 minutos
    checkperiod: 60,
    useClones: false,
    deleteOnExpire: true,
    maxKeys: 5000
});

// Interface unificada para cache
class CacheManager {
    constructor() {
        this.caches = {
            main: mainCache,
            session: sessionCache,
            ai: aiCache,
            rateLimit: rateLimitCache
        };
        
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0
        };
        
        this.setupEventListeners();
    }

    // Configurar listeners para estatísticas
    setupEventListeners() {
        Object.values(this.caches).forEach(cache => {
            cache.on('hit', () => this.stats.hits++);
            cache.on('miss', () => this.stats.misses++);
            cache.on('set', () => this.stats.sets++);
            cache.on('del', () => this.stats.deletes++);
        });
    }

    // Obter valor do cache
    get(key, cacheType = 'main') {
        try {
            const cache = this.caches[cacheType];
            if (!cache) {
                console.error(`Cache type '${cacheType}' not found`);
                return undefined;
            }
            
            return cache.get(key);
        } catch (error) {
            console.error('Cache get error:', error);
            return undefined;
        }
    }

    // Definir valor no cache
    set(key, value, ttl = null, cacheType = 'main') {
        try {
            const cache = this.caches[cacheType];
            if (!cache) {
                console.error(`Cache type '${cacheType}' not found`);
                return false;
            }
            
            return cache.set(key, value, ttl);
        } catch (error) {
            console.error('Cache set error:', error);
            return false;
        }
    }

    // Deletar valor do cache
    delete(key, cacheType = 'main') {
        try {
            const cache = this.caches[cacheType];
            if (!cache) {
                console.error(`Cache type '${cacheType}' not found`);
                return false;
            }
            
            return cache.del(key);
        } catch (error) {
            console.error('Cache delete error:', error);
            return false;
        }
    }

    // Verificar se chave existe
    has(key, cacheType = 'main') {
        try {
            const cache = this.caches[cacheType];
            if (!cache) return false;
            
            return cache.has(key);
        } catch (error) {
            console.error('Cache has error:', error);
            return false;
        }
    }

    // Limpar cache específico
    clear(cacheType = 'main') {
        try {
            const cache = this.caches[cacheType];
            if (!cache) {
                console.error(`Cache type '${cacheType}' not found`);
                return false;
            }
            
            cache.flushAll();
            return true;
        } catch (error) {
            console.error('Cache clear error:', error);
            return false;
        }
    }

    // Limpar todos os caches
    clearAll() {
        try {
            Object.values(this.caches).forEach(cache => {
                cache.flushAll();
            });
            return true;
        } catch (error) {
            console.error('Cache clear all error:', error);
            return false;
        }
    }

    // Obter estatísticas
    getStats() {
        const cacheStats = {};
        
        Object.entries(this.caches).forEach(([name, cache]) => {
            cacheStats[name] = {
                keys: cache.keys().length,
                hits: cache.getStats().hits,
                misses: cache.getStats().misses,
                sets: cache.getStats().sets,
                deletes: cache.getStats().deletes
            };
        });
        
        return {
            global: this.stats,
            caches: cacheStats
        };
    }

    // Obter informações de memória
    getMemoryInfo() {
        const info = {};
        
        Object.entries(this.caches).forEach(([name, cache]) => {
            info[name] = {
                keys: cache.keys().length,
                size: JSON.stringify(cache.data).length
            };
        });
        
        return info;
    }

    // Limpar itens expirados manualmente
    prune() {
        Object.values(this.caches).forEach(cache => {
            cache.prune();
        });
    }
}

// Instância global do cache manager
const cacheManager = new CacheManager();

// Funções de conveniência
const getCache = (key, cacheType = 'main') => {
    return cacheManager.get(key, cacheType);
};

const setCache = (key, value, ttl = null, cacheType = 'main') => {
    return cacheManager.set(key, value, ttl, cacheType);
};

const deleteCache = (key, cacheType = 'main') => {
    return cacheManager.delete(key, cacheType);
};

const hasCache = (key, cacheType = 'main') => {
    return cacheManager.has(key, cacheType);
};

const clearCache = (cacheType = 'main') => {
    return cacheManager.clear(cacheType);
};

// Middleware para cache de responses
const cacheMiddleware = (ttl = 300, cacheType = 'main') => {
    return (req, res, next) => {
        // Só fazer cache de GET requests
        if (req.method !== 'GET') {
            return next();
        }

        const key = `response_${req.originalUrl}_${req.user?.userId || 'anonymous'}`;
        const cached = getCache(key, cacheType);

        if (cached) {
            return res.json(cached);
        }

        // Interceptar res.json para cachear resposta
        const originalJson = res.json;
        res.json = function(data) {
            if (res.statusCode === 200) {
                setCache(key, data, ttl, cacheType);
            }
            return originalJson.call(this, data);
        };

        next();
    };
};

// Middleware para invalidar cache
const invalidateCacheMiddleware = (pattern, cacheType = 'main') => {
    return (req, res, next) => {
        const originalJson = res.json;
        res.json = function(data) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                // Invalidar cache baseado no padrão
                const cache = cacheManager.caches[cacheType];
                if (cache) {
                    const keys = cache.keys();
                    const keysToDelete = keys.filter(key => key.includes(pattern));
                    keysToDelete.forEach(key => cache.del(key));
                }
            }
            return originalJson.call(this, data);
        };

        next();
    };
};

// Warmup do cache com dados frequentes
const warmupCache = async () => {
    console.log('🔥 Warming up cache...');
    
    // Aqui você pode pre-carregar dados frequentemente acessados
    // Por exemplo, configurações globais, dados de usuários ativos, etc.
    
    console.log('✅ Cache warmed up');
};

// Limpeza automática do cache
setInterval(() => {
    cacheManager.prune();
    
    // Log de estatísticas a cada 30 minutos
    const stats = cacheManager.getStats();
    console.log('Cache stats:', stats);
}, 30 * 60 * 1000);

module.exports = {
    cacheManager,
    getCache,
    setCache,
    deleteCache,
    hasCache,
    clearCache,
    cacheMiddleware,
    invalidateCacheMiddleware,
    warmupCache,
    mainCache,
    sessionCache,
    aiCache,
    rateLimitCache
};