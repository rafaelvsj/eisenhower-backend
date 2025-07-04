const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');
const { validateEmail, validatePassword } = require('../utils/validation');
const { authLimiter } = require('../utils/rateLimiter');
const router = express.Router();

// Configuração Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Rate limiting específico para autenticação
router.use(authLimiter);

// Registro de usuário
router.post('/register', async (req, res) => {
    try {
        const { email, password, fullName } = req.body;

        // Validações
        if (!validateEmail(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        if (!validatePassword(password)) {
            return res.status(400).json({ 
                error: 'Password must be at least 8 characters with uppercase, lowercase, number and special character' 
            });
        }

        if (!fullName || fullName.trim().length < 2) {
            return res.status(400).json({ error: 'Full name is required (minimum 2 characters)' });
        }

        // Verificar se usuário já existe
        const { data: existingUser, error: checkError } = await supabase
            .from('profiles')
            .select('email')
            .eq('email', email.toLowerCase())
            .single();

        if (existingUser) {
            return res.status(409).json({ error: 'User already exists' });
        }

        // Criar usuário no Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email: email.toLowerCase(),
            password: password,
            options: {
                data: {
                    full_name: fullName.trim()
                }
            }
        });

        if (authError) {
            console.error('Auth error:', authError);
            return res.status(400).json({ error: authError.message });
        }

        // Criar perfil do usuário
        const { error: profileError } = await supabase
            .from('profiles')
            .insert([{
                id: authData.user.id,
                email: email.toLowerCase(),
                full_name: fullName.trim(),
                created_at: new Date().toISOString()
            }]);

        if (profileError) {
            console.error('Profile creation error:', profileError);
            return res.status(500).json({ error: 'Failed to create user profile' });
        }

        // Gerar JWT
        const token = jwt.sign(
            { 
                userId: authData.user.id, 
                email: email.toLowerCase(),
                fullName: fullName.trim()
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
        );

        // Log de auditoria
        console.log(`User registered: ${email} at ${new Date().toISOString()}`);

        res.status(201).json({
            message: 'User registered successfully',
            user: {
                id: authData.user.id,
                email: email.toLowerCase(),
                fullName: fullName.trim()
            },
            token
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validações básicas
        if (!validateEmail(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        if (!password || password.length < 6) {
            return res.status(400).json({ error: 'Password is required' });
        }

        // Autenticar com Supabase
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email: email.toLowerCase(),
            password: password
        });

        if (authError) {
            console.log(`Login attempt failed for ${email}: ${authError.message}`);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Buscar perfil do usuário
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', authData.user.id)
            .single();

        if (profileError) {
            console.error('Profile fetch error:', profileError);
            return res.status(500).json({ error: 'Failed to fetch user profile' });
        }

        // Gerar JWT
        const token = jwt.sign(
            { 
                userId: authData.user.id, 
                email: profile.email,
                fullName: profile.full_name
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
        );

        // Atualizar última atividade
        await supabase
            .from('profiles')
            .update({ last_login: new Date().toISOString() })
            .eq('id', authData.user.id);

        // Log de auditoria
        console.log(`User logged in: ${email} at ${new Date().toISOString()}`);

        res.json({
            message: 'Login successful',
            user: {
                id: authData.user.id,
                email: profile.email,
                fullName: profile.full_name
            },
            token
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Verificar token
router.get('/verify', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Verificar se usuário ainda existe
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', decoded.userId)
            .single();

        if (error || !profile) {
            return res.status(401).json({ error: 'User not found' });
        }

        res.json({
            valid: true,
            user: {
                id: profile.id,
                email: profile.email,
                fullName: profile.full_name
            }
        });

    } catch (error) {
        console.error('Token verification error:', error);
        res.status(401).json({ error: 'Invalid token' });
    }
});

// Logout
router.post('/logout', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            console.log(`User logged out: ${decoded.email} at ${new Date().toISOString()}`);
        }

        res.json({ message: 'Logout successful' });
    } catch (error) {
        console.error('Logout error:', error);
        res.json({ message: 'Logout successful' });
    }
});

// Atualizar perfil
router.put('/profile', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { fullName } = req.body;

        if (!fullName || fullName.trim().length < 2) {
            return res.status(400).json({ error: 'Full name is required (minimum 2 characters)' });
        }

        const { error } = await supabase
            .from('profiles')
            .update({ 
                full_name: fullName.trim(),
                updated_at: new Date().toISOString()
            })
            .eq('id', decoded.userId);

        if (error) {
            console.error('Profile update error:', error);
            return res.status(500).json({ error: 'Failed to update profile' });
        }

        res.json({ message: 'Profile updated successfully' });

    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
