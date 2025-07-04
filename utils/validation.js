const Joi = require('joi');

// Validação de email
const validateEmail = (email) => {
    const emailRegex = /^[^s@]+@[^s@]+.[^s@]+$/;
    return emailRegex.test(email);
};

// Validação de senha
const validatePassword = (password) => {
    // Pelo menos 8 caracteres, 1 maiúscula, 1 minúscula, 1 número, 1 especial
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*d)(?=.*[@$!%*?&])[A-Za-zd@$!%*?&]{8,}$/;
    return passwordRegex.test(password);
};

// Schema para validação de tarefas
const taskSchema = Joi.object({
    title: Joi.string().trim().min(1).max(200).required(),
    description: Joi.string().trim().max(1000).allow('', null),
    quadrant: Joi.number().integer().min(1).max(4).required(),
    priority: Joi.string().valid('low', 'medium', 'high').default('medium'),
    dueDate: Joi.date().iso().allow(null),
    status: Joi.string().valid('pending', 'in_progress', 'completed').default('pending')
});

// Schema para validação de usuário
const userSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(8).required(),
    fullName: Joi.string().trim().min(2).max(100).required()
});

// Schema para validação de login
const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required()
});

// Schema para validação de request de IA
const aiRequestSchema = Joi.object({
    tasks: Joi.object({
        quadrant1: Joi.array().items(Joi.object({
            title: Joi.string().required(),
            description: Joi.string().allow('', null)
        })).default([]),
        quadrant2: Joi.array().items(Joi.object({
            title: Joi.string().required(),
            description: Joi.string().allow('', null)
        })).default([]),
        quadrant3: Joi.array().items(Joi.object({
            title: Joi.string().required(),
            description: Joi.string().allow('', null)
        })).default([]),
        quadrant4: Joi.array().items(Joi.object({
            title: Joi.string().required(),
            description: Joi.string().allow('', null)
        })).default([])
    }).required()
});

// Validação de tarefa
const validateTask = (task) => {
    const { error, value } = taskSchema.validate(task);
    if (error) {
        return {
            isValid: false,
            error: error.details[0].message
        };
    }
    return {
        isValid: true,
        data: value
    };
};

// Validação de usuário
const validateUser = (user) => {
    const { error, value } = userSchema.validate(user);
    if (error) {
        return {
            isValid: false,
            error: error.details[0].message
        };
    }
    return {
        isValid: true,
        data: value
    };
};

// Validação de login
const validateLogin = (credentials) => {
    const { error, value } = loginSchema.validate(credentials);
    if (error) {
        return {
            isValid: false,
            error: error.details[0].message
        };
    }
    return {
        isValid: true,
        data: value
    };
};

// Validação de request de IA
const validateAIRequest = (request) => {
    const { error, value } = aiRequestSchema.validate(request);
    if (error) {
        return {
            isValid: false,
            error: error.details[0].message
        };
    }
    return {
        isValid: true,
        data: value
    };
};

// Sanitização de HTML
const sanitizeHtml = (input) => {
    if (!input || typeof input !== 'string') return input;
    
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(///g, '&#x2F;');
};

// Validação de entrada customizada
const validateInput = (input, rules) => {
    const errors = [];
    
    for (const rule of rules) {
        switch (rule.type) {
            case 'required':
                if (!input || (typeof input === 'string' && input.trim() === '')) {
                    errors.push(rule.message || 'Field is required');
                }
                break;
                
            case 'minLength':
                if (input && input.length < rule.value) {
                    errors.push(rule.message || `Minimum length is ${rule.value}`);
                }
                break;
                
            case 'maxLength':
                if (input && input.length > rule.value) {
                    errors.push(rule.message || `Maximum length is ${rule.value}`);
                }
                break;
                
            case 'email':
                if (input && !validateEmail(input)) {
                    errors.push(rule.message || 'Invalid email format');
                }
                break;
                
            case 'number':
                if (input && isNaN(Number(input))) {
                    errors.push(rule.message || 'Must be a number');
                }
                break;
                
            case 'range':
                const num = Number(input);
                if (input && (!isNaN(num) && (num < rule.min || num > rule.max))) {
                    errors.push(rule.message || `Must be between ${rule.min} and ${rule.max}`);
                }
                break;
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors: errors
    };
};

// Validação de parâmetros de URL
const validateUrlParams = (params, schema) => {
    const errors = [];
    
    for (const [key, rules] of Object.entries(schema)) {
        const value = params[key];
        const validation = validateInput(value, rules);
        
        if (!validation.isValid) {
            errors.push(`${key}: ${validation.errors.join(', ')}`);
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors: errors
    };
};

// Validação de dados de formulário
const validateFormData = (data, schema) => {
    const errors = {};
    const cleanData = {};
    
    for (const [field, rules] of Object.entries(schema)) {
        const value = data[field];
        const validation = validateInput(value, rules);
        
        if (!validation.isValid) {
            errors[field] = validation.errors;
        } else {
            // Sanitizar dados limpos
            cleanData[field] = typeof value === 'string' ? sanitizeHtml(value.trim()) : value;
        }
    }
    
    return {
        isValid: Object.keys(errors).length === 0,
        errors: errors,
        data: cleanData
    };
};

// Middleware de validação
const validationMiddleware = (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.body);
        
        if (error) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.details.map(detail => ({
                    field: detail.path.join('.'),
                    message: detail.message
                }))
            });
        }
        
        req.body = value;
        next();
    };
};

module.exports = {
    validateEmail,
    validatePassword,
    validateTask,
    validateUser,
    validateLogin,
    validateAIRequest,
    sanitizeHtml,
    validateInput,
    validateUrlParams,
    validateFormData,
    validationMiddleware,
    taskSchema,
    userSchema,
    loginSchema,
    aiRequestSchema
};