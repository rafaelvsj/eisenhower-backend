const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');
const { validateAIRequest } = require('../utils/validation');
const { aiLimiter } = require('../utils/rateLimiter');
const { getCache, setCache } = require('../utils/cache');
const circuitBreaker = require('../utils/circuitBreaker');
const router = express.Router();

// Configuração Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Configuração Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

// Rate limiting específico para IA
router.use(aiLimiter);

// Analisar tarefas com IA
router.post('/analyze', async (req, res) => {
    try {
        const userId = req.user.userId;
        const { tasks } = req.body;

        // Validar request
        const validation = validateAIRequest({ tasks });
        if (!validation.isValid) {
            return res.status(400).json({ error: validation.error });
        }

        // Verificar cache
        const cacheKey = `ai_analysis_${userId}_${JSON.stringify(tasks).slice(0, 100)}`;
        const cachedAnalysis = getCache(cacheKey);
        if (cachedAnalysis) {
            return res.json(cachedAnalysis);
        }

        // Preparar prompt para análise
        const prompt = `
Você é um especialista em produtividade e gestão de tempo. Analise as seguintes tarefas organizadas pela Matriz de Eisenhower:

QUADRANTE 1 (Urgente + Importante):
${tasks.quadrant1?.map(t => `- ${t.title}`).join('\n') || 'Nenhuma tarefa'}

QUADRANTE 2 (Importante + Não Urgente):
${tasks.quadrant2?.map(t => `- ${t.title}`).join('\n') || 'Nenhuma tarefa'}

QUADRANTE 3 (Urgente + Não Importante):
${tasks.quadrant3?.map(t => `- ${t.title}`).join('\n') || 'Nenhuma tarefa'}

QUADRANTE 4 (Não Urgente + Não Importante):
${tasks.quadrant4?.map(t => `- ${t.title}`).join('\n') || 'Nenhuma tarefa'}

Forneça uma análise estruturada em JSON com:
1. "priority_order": array com ordem de prioridade das tarefas
2. "recommendations": array com sugestões específicas para cada quadrante
3. "time_suggestions": array com sugestões de horários para cada tarefa
4. "insights": array com insights sobre o padrão de tarefas do usuário
5. "focus_areas": array com áreas que precisam de mais atenção

Retorne apenas o JSON válido, sem markdown ou formatação adicional.
`;

        // Fazer chamada para Gemini com circuit breaker
        const analysis = await circuitBreaker.execute(async () => {
            const result = await model.generateContent(prompt);
            const response = await result.response;
            return response.text();
        });

        // Processar resposta
        let parsedAnalysis;
        try {
            parsedAnalysis = JSON.parse(analysis);
        } catch (parseError) {
            console.error('Failed to parse AI response:', parseError);
            // Fallback para análise básica
            parsedAnalysis = {
                priority_order: ['Execute tarefas do Quadrante 1 primeiro', 'Planeje tarefas do Quadrante 2', 'Delegue tarefas do Quadrante 3', 'Elimine tarefas do Quadrante 4'],
                recommendations: ['Foque no que é urgente e importante', 'Dedique tempo para planejamento', 'Considere delegação', 'Evite atividades desnecessárias'],
                time_suggestions: ['Manhã: Quadrante 1', 'Tarde: Quadrante 2', 'Final do dia: Quadrante 3', 'Evite: Quadrante 4'],
                insights: ['Analise o equilíbrio entre quadrantes', 'Identifique padrões de urgência'],
                focus_areas: ['Gestão de tempo', 'Priorização', 'Delegação']
            };
        }

        // Salvar análise no banco
        const { error: saveError } = await supabase
            .from('task_analysis')
            .insert([{
                user_id: userId,
                analysis_data: parsedAnalysis,
                created_at: new Date().toISOString()
            }]);

        if (saveError) {
            console.error('Save analysis error:', saveError);
            // Não falhar a request se não conseguir salvar
        }

        // Armazenar em cache
        setCache(cacheKey, parsedAnalysis, 300000); // 5 minutos

        // Log de auditoria
        console.log(`AI analysis performed for user ${userId} at ${new Date().toISOString()}`);

        res.json(parsedAnalysis);

    } catch (error) {
        console.error('AI analysis error:', error);
        
        // Fallback em caso de erro
        const fallbackAnalysis = {
            priority_order: ['Execute tarefas urgentes e importantes primeiro', 'Planeje tarefas importantes', 'Delegue tarefas urgentes mas não importantes', 'Evite tarefas não urgentes e não importantes'],
            recommendations: ['Foque no Quadrante 1', 'Invista tempo no Quadrante 2', 'Delegue Quadrante 3', 'Elimine Quadrante 4'],
            time_suggestions: ['6h-9h: Quadrante 1', '9h-12h: Quadrante 2', '14h-17h: Quadrante 3', 'Evite: Quadrante 4'],
            insights: ['Mantenha equilíbrio entre quadrantes', 'Previna tarefas urgentes com planejamento'],
            focus_areas: ['Gestão de tempo', 'Priorização eficaz', 'Eliminação de distrações']
        };

        res.json(fallbackAnalysis);
    }
});

// Obter sugestões de priorização
router.post('/prioritize', async (req, res) => {
    try {
        const userId = req.user.userId;
        const { task } = req.body;

        if (!task || !task.title) {
            return res.status(400).json({ error: 'Task title is required' });
        }

        // Verificar cache
        const cacheKey = `ai_prioritize_${userId}_${task.title.slice(0, 50)}`;
        const cachedPriority = getCache(cacheKey);
        if (cachedPriority) {
            return res.json(cachedPriority);
        }

        const prompt = `
Analise esta tarefa e sugira o quadrante ideal da Matriz de Eisenhower:

TAREFA: "${task.title}"
DESCRIÇÃO: "${task.description || 'Sem descrição'}"

Responda em JSON com:
{
  "suggested_quadrant": número do quadrante (1-4),
  "reasoning": "explicação da sugestão",
  "urgency_level": "low/medium/high",
  "importance_level": "low/medium/high",
  "estimated_time": "estimativa de tempo em minutos",
  "best_time_to_do": "melhor horário para executar"
}

Retorne apenas o JSON válido.
`;

        const suggestion = await circuitBreaker.execute(async () => {
            const result = await model.generateContent(prompt);
            const response = await result.response;
            return response.text();
        });

        let parsedSuggestion;
        try {
            parsedSuggestion = JSON.parse(suggestion);
        } catch (parseError) {
            console.error('Failed to parse AI suggestion:', parseError);
            parsedSuggestion = {
                suggested_quadrant: 2,
                reasoning: 'Requer análise manual para classificação precisa',
                urgency_level: 'medium',
                importance_level: 'medium',
                estimated_time: 30,
                best_time_to_do: 'Durante horário de maior produtividade'
            };
        }

        // Armazenar em cache
        setCache(cacheKey, parsedSuggestion, 180000); // 3 minutos

        res.json(parsedSuggestion);

    } catch (error) {
        console.error('AI prioritization error:', error);
        res.status(500).json({ error: 'Failed to get prioritization suggestion' });
    }
});

// Chat com IA sobre produtividade
router.post('/chat', async (req, res) => {
    try {
        const userId = req.user.userId;
        const { message, context } = req.body;

        if (!message || message.trim().length < 3) {
            return res.status(400).json({ error: 'Message is required (minimum 3 characters)' });
        }

        // Verificar cache
        const cacheKey = `ai_chat_${userId}_${message.slice(0, 50)}`;
        const cachedResponse = getCache(cacheKey);
        if (cachedResponse) {
            return res.json(cachedResponse);
        }

        const prompt = `
Você é um assistente de produtividade especializado na Matriz de Eisenhower. 
Responda à pergunta do usuário de forma útil e prática.

CONTEXTO DO USUÁRIO:
${context ? JSON.stringify(context) : 'Sem contexto específico'}

PERGUNTA: "${message}"

Responda de forma:
- Concisa e prática
- Focada em produtividade
- Relacionada à Matriz de Eisenhower quando relevante
- Em português brasileiro
- Máximo 300 palavras

Responda apenas com o texto da resposta, sem formatação adicional.
`;

        const response = await circuitBreaker.execute(async () => {
            const result = await model.generateContent(prompt);
            const response = await result.response;
            return response.text();
        });

        const chatResponse = {
            message: response.trim(),
            timestamp: new Date().toISOString()
        };

        // Armazenar em cache
        setCache(cacheKey, chatResponse, 120000); // 2 minutos

        // Log de auditoria
        console.log(`AI chat interaction for user ${userId} at ${new Date().toISOString()}`);

        res.json(chatResponse);

    } catch (error) {
        console.error('AI chat error:', error);
        res.status(500).json({ error: 'Failed to get AI response' });
    }
});

// Obter histórico de análises
router.get('/history', async (req, res) => {
    try {
        const userId = req.user.userId;
        const limit = parseInt(req.query.limit) || 10;

        const { data: history, error } = await supabase
            .from('task_analysis')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('Fetch AI history error:', error);
            return res.status(500).json({ error: 'Failed to fetch AI history' });
        }

        res.json(history);

    } catch (error) {
        console.error('Get AI history error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;