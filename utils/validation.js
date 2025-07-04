const Joi = require('joi');
const DOMPurify = require('isomorphic-dompurify');

// Schema para validação de tarefas
const taskSchema = Joi.object({
    title: Joi.string().min(1).max(500).required(),
    quadrant: Joi.number().integer().min(1).max(4).required(),
    description: Joi.string().max(2000).allow('').optional(),
    priority: Joi.string().valid('baixa', 'media', 'alta').optional(),
    status: Joi.string().valid('pendente', 'em_progresso', 'concluida').optional()
});

// Schema para validação de usuário
const userSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(6).max(100).required(),
    full_name: Joi.string().min(2).max(100).optional()
});

// Schema para login
const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(1).required()
});

// Schema para requests de IA
const aiRequestSchema = Joi.object({
    tasks: Joi.array().items(taskSchema).min(1).max(50).required(),
    context: Joi.string().max(1000).optional()
});

// Função para validar tarefas
function validateTask(task) {
    return taskSchema.validate(task);
}

// Função para validar usuário
function validateUser(user) {
    return userSchema.validate(user);
}

// Função para validar login
function validateLogin(credentials) {
    return loginSchema.validate(credentials);
}

// Função para validar request de IA
function validateAIRequest(request) {
    return aiRequestSchema.validate(request);
}

// Função para sanitizar HTML
function sanitizeHtml(html) {
    if (typeof html !== 'string') return '';
    return DOMPurify.sanitize(html);
}

// Função para sanitizar dados do usuário
function sanitizeUserData(data) {
    const sanitized = {};
    
    Object.keys(data).forEach(key => {
        if (typeof data[key] === 'string') {
            sanitized[key] = sanitizeHtml(data[key]);
        } else {
            sanitized[key] = data[key];
        }
    });
    
    return sanitized;
}

module.exports = {
    validateTask,
    validateUser,
    validateLogin,
    validateAIRequest,
    sanitizeHtml,
    sanitizeUserData,
    taskSchema,
    userSchema,
    loginSchema,
    aiRequestSchema
};
