const NodeCache = require('node-cache');

// Cache principal para dados gerais
const mainCache = new NodeCache({
    stdTTL: 300, // 5 minutos
    checkperiod: 120, // Verificar a cada 2 minutos
    maxKeys: 1000
});

// Cache para sessões
const sessionCache = new NodeCache({
    stdTTL: 3600, // 1 hora
    checkperiod: 600, // Verificar a cada 10 minutos
    maxKeys: 500
});

// Cache para IA
const aiCache = new NodeCache({
    stdTTL: 600, // 10 minutos
    checkperiod: 120,
    maxKeys: 200
});

// Cache para rate limiting
const rateLimitCache = new NodeCache({
    stdTTL: 900, // 15 minutos
    checkperiod: 300,
    maxKeys: 10000
});

class CacheManager {
    constructor() {
        this.caches = {
            main: mainCache,
            session: sessionCache,
            ai: aiCache,
            rateLimit: rateLimitCache
        };
        
        this.setupEventListeners();
        this.startMonitoring();
    }
    
    setupEventListeners() {
        Object.keys(this.caches).forEach(cacheName => {
            const cache = this.caches[cacheName];
            
            cache.on('hit', (key, value) => {
                console.log(`Cache hit: ${cacheName}:${key}`);
            });
            
            cache.on('miss', (key) => {
                console.log(`Cache miss: ${cacheName}:${key}`);
            });
            
            cache.on('expired', (key, value) => {
                console.log(`Cache expired: ${cacheName}:${key}`);
            });
        });
    }
    
    startMonitoring() {
        // Monitoramento a cada 30 minutos
        setInterval(() => {
            this.cleanup();
            this.logStatistics();
        }, 30 * 60 * 1000);
    }
    
    cleanup() {
        try {
            Object.keys(this.caches).forEach(cacheName => {
                const cache = this.caches[cacheName];
                const keysBefore = cache.keys().length;
                
                // NodeCache limpa automaticamente itens expirados
                // Forçar verificação
                cache.keys().forEach(key => {
                    cache.get(key); // Isso força a verificação de expiração
                });
                
                const keysAfter = cache.keys().length;
                const cleaned = keysBefore - keysAfter;
                
                if (cleaned > 0) {
                    console.log(`Cache ${cacheName}: Limpou ${cleaned} chaves`);
                }
            });
        } catch (error) {
            console.error('Erro na limpeza do cache:', error);
        }
    }
    
    logStatistics() {
        Object.keys(this.caches).forEach(cacheName => {
            const cache = this.caches[cacheName];
            const stats = cache.getStats();
            
            console.log(`Cache ${cacheName} Stats:`, {
                keys: stats.keys,
                hits: stats.hits,
                misses: stats.misses,
                hitRatio: stats.hits / (stats.hits + stats.misses) || 0
            });
        });
    }
    
    // Métodos de interface
    get(cacheType, key) {
        if (!this.caches[cacheType]) {
            console.error(`Cache type ${cacheType} não encontrado`);
            return null;
        }
        return this.caches[cacheType].get(key);
    }
    
    set(cacheType, key, value, ttl = null) {
        if (!this.caches[cacheType]) {
            console.error(`Cache type ${cacheType} não encontrado`);
            return false;
        }
        
        if (ttl) {
            return this.caches[cacheType].set(key, value, ttl);
        }
        return this.caches[cacheType].set(key, value);
    }
    
    del(cacheType, key) {
        if (!this.caches[cacheType]) {
            console.error(`Cache type ${cacheType} não encontrado`);
            return false;
        }
        return this.caches[cacheType].del(key);
    }
    
    flush(cacheType) {
        if (!this.caches[cacheType]) {
            console.error(`Cache type ${cacheType} não encontrado`);
            return false;
        }
        this.caches[cacheType].flushAll();
        return true;
    }
    
    flushAll() {
        Object.keys(this.caches).forEach(cacheName => {
            this.caches[cacheName].flushAll();
        });
        console.log('Todos os caches foram limpos');
    }
}

// Instância global
const cacheManager = new CacheManager();

// Funções de conveniência
function getCache(key, cacheType = 'main') {
    return cacheManager.get(cacheType, key);
}

function setCache(key, value, ttl = null, cacheType = 'main') {
    return cacheManager.set(cacheType, key, value, ttl);
}

function delCache(key, cacheType = 'main') {
    return cacheManager.del(cacheType, key);
}

module.exports = {
    cacheManager,
    getCache,
    setCache,
    delCache,
    mainCache,
    sessionCache,
    aiCache,
    rateLimitCache
};
