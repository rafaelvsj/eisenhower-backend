const { createClient } = require('@supabase/supabase-js');

// Configuração do cliente Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase configuration');
    process.exit(1);
}

// Criar cliente Supabase com configurações otimizadas
const supabase = createClient(supabaseUrl, supabaseKey, {
    db: {
        schema: 'public'
    },
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
    },
    realtime: {
        params: {
            eventsPerSecond: 10
        }
    },
    global: {
        headers: {
            'X-Client-Info': 'eisenhower-matrix-backend'
        }
    }
});

// Testar conexão
const testConnection = async () => {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('count')
            .limit(1);

        if (error) {
            console.error('Database connection failed:', error);
            return false;
        }

        console.log('✅ Database connection successful');
        return true;
    } catch (error) {
        console.error('Database connection test failed:', error);
        return false;
    }
};

// Função para executar migrations
const runMigrations = async () => {
    try {
        // Verificar se as tabelas existem
        const { data: tables, error } = await supabase
            .from('information_schema.tables')
            .select('table_name')
            .eq('table_schema', 'public');

        if (error) {
            console.error('Failed to check tables:', error);
            return false;
        }

        const requiredTables = ['profiles', 'tasks', 'task_analysis'];
        const existingTables = tables.map(t => t.table_name);
        const missingTables = requiredTables.filter(t => !existingTables.includes(t));

        if (missingTables.length > 0) {
            console.warn(`Missing tables: ${missingTables.join(', ')}`);
            console.warn('Please run the schema.sql file in your Supabase dashboard');
            return false;
        }

        console.log('✅ All required tables present');
        return true;
    } catch (error) {
        console.error('Migration check failed:', error);
        return false;
    }
};

// Função para verificar políticas RLS
const checkRLS = async () => {
    try {
        const { data, error } = await supabase
            .from('pg_policies')
            .select('tablename, policyname')
            .in('tablename', ['profiles', 'tasks', 'task_analysis']);

        if (error) {
            console.error('Failed to check RLS policies:', error);
            return false;
        }

        const requiredPolicies = [
            'profiles_select_policy',
            'profiles_update_policy',
            'tasks_select_policy',
            'tasks_insert_policy',
            'tasks_update_policy',
            'tasks_delete_policy'
        ];

        const existingPolicies = data.map(p => p.policyname);
        const missingPolicies = requiredPolicies.filter(p => !existingPolicies.includes(p));

        if (missingPolicies.length > 0) {
            console.warn(`Missing RLS policies: ${missingPolicies.join(', ')}`);
            console.warn('Please ensure RLS policies are properly configured');
        } else {
            console.log('✅ RLS policies configured');
        }

        return true;
    } catch (error) {
        console.error('RLS check failed:', error);
        return false;
    }
};

// Função para verificar funções customizadas
const checkCustomFunctions = async () => {
    try {
        const { data, error } = await supabase
            .from('pg_proc')
            .select('proname')
            .like('proname', '%task%');

        if (error) {
            console.error('Failed to check custom functions:', error);
            return false;
        }

        const requiredFunctions = ['get_next_task_number'];
        const existingFunctions = data.map(f => f.proname);
        const missingFunctions = requiredFunctions.filter(f => !existingFunctions.includes(f));

        if (missingFunctions.length > 0) {
            console.warn(`Missing custom functions: ${missingFunctions.join(', ')}`);
            console.warn('Please ensure custom functions are created');
        } else {
            console.log('✅ Custom functions available');
        }

        return true;
    } catch (error) {
        console.error('Custom functions check failed:', error);
        return false;
    }
};

// Inicializar verificações do banco
const initializeDatabase = async () => {
    console.log('🔍 Initializing database checks...');
    
    const connectionOk = await testConnection();
    if (!connectionOk) {
        console.error('❌ Database connection failed');
        process.exit(1);
    }

    const migrationsOk = await runMigrations();
    if (!migrationsOk) {
        console.error('❌ Database migrations incomplete');
        process.exit(1);
    }

    await checkRLS();
    await checkCustomFunctions();

    console.log('✅ Database initialization complete');
};

// Função helper para transações
const executeTransaction = async (queries) => {
    try {
        const results = [];
        for (const query of queries) {
            const result = await query();
            results.push(result);
        }
        return { data: results, error: null };
    } catch (error) {
        console.error('Transaction failed:', error);
        return { data: null, error };
    }
};

// Função helper para retry em caso de erro
const retryOperation = async (operation, maxRetries = 3) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await operation();
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
};

module.exports = {
    supabase,
    testConnection,
    runMigrations,
    checkRLS,
    checkCustomFunctions,
    initializeDatabase,
    executeTransaction,
    retryOperation
};
