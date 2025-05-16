import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_HOST = process.env.API_HOST || 'http://localhost:4000';
const API_PREFIX = '/api';
const CLIENT_CONSTANTS_DIR = '/home/astro/Desktop/modakerati/client/constants';
const API_ENDPOINTS_FILE = 'api_endpoints.js';

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Promise wrapper for readline question
function question(query) {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

function generateEndpoint(path) {
    // Remove file extension and convert to camelCase
    const endpoint = path
        .replace(/\.ts$/, '')
        .replace(/\[([^\]]+)\]/g, ':$1') // Convert [param] to :param
        .split('/')
        .filter(Boolean)
        .join('/');

    return `${API_HOST}${API_PREFIX}/${endpoint}`;
}

function generateConstantName(path) {
    // Convert path to UPPER_SNAKE_CASE and replace hyphens with underscores
    return path
        .replace(/\.ts$/, '')
        .replace(/\[([^\]]+)\]/g, '$1') // Remove brackets from params
        .split('/')
        .filter(Boolean)
        .map(part => part.toUpperCase().replace(/-/g, '_'))
        .join('_');
}

function getHttpMethods(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const methods = [];

        // Check for exported HTTP methods
        if (content.includes('export const get =') || content.includes('export default { get:')) methods.push('get');
        if (content.includes('export const post =') || content.includes('export default { post:')) methods.push('post');
        if (content.includes('export const put =') || content.includes('export default { put:')) methods.push('put');
        if (content.includes('export const patch =') || content.includes('export default { patch:')) methods.push('patch');
        if (content.includes('export const delete =') || content.includes('export default { delete:')) methods.push('delete');

        return methods;
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
        return [];
    }
}

function scanRoutes(dir, basePath = '') {
    const endpoints = {};
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
            // Handle index.ts in directories
            const indexPath = path.join(fullPath, 'index.ts');
            if (fs.existsSync(indexPath)) {
                const relativePath = path.join(basePath, file);
                const baseEndpoint = generateEndpoint(relativePath);
                const constantName = generateConstantName(relativePath);
                endpoints[constantName] = baseEndpoint;
            }

            // Recursively scan subdirectories
            const subEndpoints = scanRoutes(fullPath, path.join(basePath, file));
            Object.assign(endpoints, subEndpoints);
        } else if (file.endsWith('.ts')) {
            // Skip index.ts files as they're handled in directory scanning
            if (file === 'index.ts') continue;

            // Generate endpoint for file
            const relativePath = path.join(basePath, file);
            const baseEndpoint = generateEndpoint(relativePath);
            const constantName = generateConstantName(relativePath);
            endpoints[constantName] = baseEndpoint;
        }
    }

    return endpoints;
}

async function createBackup() {
  const sourcePath = path.join(CLIENT_CONSTANTS_DIR, API_ENDPOINTS_FILE);
  
  // Check if source file exists
  if (!fs.existsSync(sourcePath)) {
    console.log('No existing API endpoints file to backup.');
    return;
  }

  // Ask for user confirmation
  const answer = await question('Do you want to create a backup of the current API endpoints file? (yes/no): ');
  
  if (answer.toLowerCase() !== 'yes') {
    console.log('Backup skipped.');
    return;
  }

  const backupDir = path.join(CLIENT_CONSTANTS_DIR, 'backups');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `api_endpoints_${timestamp}.js`);

  try {
    // Create backup directory if it doesn't exist
    fs.mkdirSync(backupDir, { recursive: true });

    // Read the current file
    const content = fs.readFileSync(sourcePath, 'utf-8');

    // Write to backup file
    fs.writeFileSync(backupPath, content);

    // Keep only the last 5 backups
    const backups = fs.readdirSync(backupDir)
      .filter(file => file.startsWith('api_endpoints_'))
      .sort()
      .reverse();

    if (backups.length > 5) {
      backups.slice(5).forEach(file => {
        fs.unlinkSync(path.join(backupDir, file));
      });
    }

    console.log(`Backup created at: ${backupPath}`);
  } catch (error) {
    console.error('Error creating backup:', error);
  }
}

async function generateApiEndpointsFile() {
  const routesDir = path.join(__dirname, '../routes');
  const endpoints = scanRoutes(routesDir);
  
  // Create backup before generating new file
  await createBackup();
  
  // Generate the content of the API_ENDPOINTS file
  const content = `// This file is auto-generated. Do not edit manually.
// Generated on: ${new Date().toISOString()}

export const API_ENDPOINTS = {
${Object.entries(endpoints)
  .map(([key, value]) => `  ${key}: '${value}'`)
  .join(',\n')}
};
`;

  // Write to client's constants directory
  const outputPath = path.join(CLIENT_CONSTANTS_DIR, API_ENDPOINTS_FILE);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content);

  console.log('API_ENDPOINTS.js generated successfully in client constants directory!');
  console.log('Generated endpoints:', endpoints);

  // Close readline interface
  rl.close();
}

// Run the generator
generateApiEndpointsFile(); 