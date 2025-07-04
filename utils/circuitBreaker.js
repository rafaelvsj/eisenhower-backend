const axios = require('axios');

// Estados do Circuit Breaker
const CIRCUIT_STATES = {
    CLOSED: 'CLOSED',       // Funcionando normalmente
    OPEN: 'OPEN',           // Falhas detectadas, bloqueando chamadas
    HALF_OPEN: 'HALF_OPEN'  // Testando se o serviço voltou
};

class CircuitBreaker {
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 10;
        this.resetTimeout = options.resetTimeout || 60000; // 1 minuto
        this.timeout = options.timeout || 30000; // 30 segundos
        this.monitoringPeriod = options.monitoringPeriod || 60000; // 1 minuto
        
        this.state = CIRCUIT_STATES.CLOSED;
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.successCount = 0;
        this.requestCount = 0;
        
        this.stats = {
            totalRequests: 0,
            totalFailures: 0,
            totalSuccesses: 0,
            totalTimeouts: 0,
            circuitOpens: 0,
            circuitCloses: 0
        };
    }

    // Executar operação com circuit breaker
    async execute(operation, fallback = null) {
        this.stats.totalRequests++;
        this.requestCount++;

        // Se o circuito está aberto, verificar se deve tentar novamente
        if (this.state === CIRCUIT_STATES.OPEN) {
            if (Date.now() - this.lastFailureTime < this.resetTimeout) {
                throw new Error('Circuit breaker is OPEN');
            } else {
                this.state = CIRCUIT_STATES.HALF_OPEN;
                this.successCount = 0;
                console.log('Circuit breaker moved to HALF_OPEN state');
            }
        }

        try {
            // Executar operação com timeout
            const result = await Promise.race([
                operation(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Operation timeout')), this.timeout)
                )
            ]);

            // Operação bem-sucedida
            this.onSuccess();
            return result;

        } catch (error) {
            // Operação falhou
            this.onFailure(error);
            
            // Executar fallback se disponível
            if (fallback && typeof fallback === 'function') {
                try {
                    return await fallback();
                } catch (fallbackError) {
                    throw error; // Retornar erro original
                }
            }
            
            throw error;
        }
    }

    // Lidar com sucesso
    onSuccess() {
        this.stats.totalSuccesses++;
        this.failureCount = 0;
        this.successCount++;

        if (this.state === CIRCUIT_STATES.HALF_OPEN) {
            // Se tivemos sucessos suficientes, fechar o circuito
            if (this.successCount >= 3) {
                this.state = CIRCUIT_STATES.CLOSED;
                this.stats.circuitCloses++;
                console.log('Circuit breaker moved to CLOSED state');
            }
        }
    }

    // Lidar com falha
    onFailure(error) {
        this.stats.totalFailures++;
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (error.message.includes('timeout')) {
            this.stats.totalTimeouts++;
        }

        // Verificar se deve abrir o circuito
        if (this.failureCount >= this.failureThreshold) {
            this.state = CIRCUIT_STATES.OPEN;
            this.stats.circuitOpens++;
            console.log(`Circuit breaker opened due to ${this.failureCount} failures`);
        }

        console.error('Circuit breaker failure:', error.message);
    }

    // Obter estado atual
    getState() {
        return {
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            lastFailureTime: this.lastFailureTime,
            stats: this.stats
        };
    }

    // Resetar circuit breaker
    reset() {
        this.state = CIRCUIT_STATES.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = null;
        console.log('Circuit breaker reset to CLOSED state');
    }

    // Forçar abertura do circuito
    forceOpen() {
        this.state = CIRCUIT_STATES.OPEN;
        this.lastFailureTime = Date.now();
        console.log('Circuit breaker forced to OPEN state');
    }

    // Forçar fechamento do circuito
    forceClose() {
        this.state = CIRCUIT_STATES.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        console.log('Circuit breaker forced to CLOSED state');
    }
}

// Circuit Breaker para API do Gemini
const geminiCircuitBreaker = new CircuitBreaker({
    failureThreshold: 5,
    resetTimeout: 60000, // 1 minuto
    timeout: 25000, // 25 segundos
    monitoringPeriod: 60000
});

// Circuit Breaker para Supabase
const supabaseCircuitBreaker = new CircuitBreaker({
    failureThreshold: 10,
    resetTimeout: 30000, // 30 segundos
    timeout: 15000, // 15 segundos
    monitoringPeriod: 60000
});

// Circuit Breaker genérico para outras APIs
const genericCircuitBreaker = new CircuitBreaker({
    failureThreshold: 8,
    resetTimeout: 45000, // 45 segundos
    timeout: 20000, // 20 segundos
    monitoringPeriod: 60000
});

// Função utilitária para requisições HTTP com circuit breaker
const httpRequest = async (url, options = {}, circuitBreaker = genericCircuitBreaker) => {
    const operation = async () => {
        const response = await axios({
            url,
            timeout: options.timeout || 15000,
            ...options
        });
        return response.data;
    };

    const fallback = () => {
        throw new Error('Service temporarily unavailable');
    };

    return circuitBreaker.execute(operation, fallback);
};

// Middleware para monitoramento do circuit breaker
const circuitBreakerMiddleware = (circuitBreaker) => {
    return (req, res, next) => {
        const state = circuitBreaker.getState();
        
        // Adicionar informações do circuit breaker nos headers
        res.set('X-Circuit-State', state.state);
        res.set('X-Circuit-Failures', state.failureCount.toString());
        
        // Se o circuito está aberto, retornar erro
        if (state.state === CIRCUIT_STATES.OPEN) {
            return res.status(503).json({
                error: 'Service temporarily unavailable',
                message: 'Circuit breaker is open due to repeated failures',
                retryAfter: Math.ceil((circuitBreaker.resetTimeout - (Date.now() - state.lastFailureTime)) / 1000)
            });
        }
        
        next();
    };
};

// Monitoramento e métricas
const startMonitoring = () => {
    setInterval(() => {
        const circuitBreakers = {
            gemini: geminiCircuitBreaker.getState(),
            supabase: supabaseCircuitBreaker.getState(),
            generic: genericCircuitBreaker.getState()
        };

        console.log('Circuit Breaker Status:', JSON.stringify(circuitBreakers, null, 2));
        
        // Alertar se algum circuito está aberto
        Object.entries(circuitBreakers).forEach(([name, state]) => {
            if (state.state === CIRCUIT_STATES.OPEN) {
                console.warn(`🚨 Circuit breaker '${name}' is OPEN!`);
            }
        });
    }, 60000); // A cada minuto
};

// Health check dos circuit breakers
const healthCheck = () => {
    return {
        gemini: geminiCircuitBreaker.getState(),
        supabase: supabaseCircuitBreaker.getState(),
        generic: genericCircuitBreaker.getState()
    };
};

// Inicializar monitoramento
startMonitoring();

module.exports = {
    CircuitBreaker,
    geminiCircuitBreaker,
    supabaseCircuitBreaker,
    genericCircuitBreaker,
    httpRequest,
    circuitBreakerMiddleware,
    healthCheck,
    CIRCUIT_STATES
};
