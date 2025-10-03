#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('🚀 Preparing your DeFi Arbitrage Bot for Vercel Deployment...\n');

// Check required files
const requiredFiles = [
  'vercel.json',
  'package.json',
  '.env',
  'api/index.js',
  'api/health.js',
  'api/opportunities.js',
  'api/stats.js',
  'api/simulate.js',
  'api/prices.js'
];

console.log('📋 Checking required files...');
let allFilesExist = true;

for (const file of requiredFiles) {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    console.log(`✅ ${file}`);
  } else {
    console.log(`❌ ${file} - MISSING`);
    allFilesExist = false;
  }
}

if (!allFilesExist) {
  console.log('\n🚨 Some required files are missing. Please check the above list.');
  process.exit(1);
}

// Check environment variables
console.log('\n🔐 Checking environment variables...');
const requiredEnvVars = [
  'DATABASE_URL',
  'ETHEREUM_RPC',
  'NODE_ENV'
];

const envPath = path.join(__dirname, '.env');
let envContent = '';
try {
  envContent = fs.readFileSync(envPath, 'utf8');
} catch (error) {
  console.log('❌ Cannot read .env file');
  process.exit(1);
}

for (const envVar of requiredEnvVars) {
  if (envContent.includes(`${envVar}=`)) {
    console.log(`✅ ${envVar}`);
  } else {
    console.log(`⚠️  ${envVar} - NOT FOUND (you'll need to add this in Vercel dashboard)`);
  }
}

// Check package.json for Vercel compatibility
console.log('\n📦 Checking package.json...');
const packagePath = path.join(__dirname, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

if (packageJson.type === 'module') {
  console.log('✅ ES Modules configured');
} else {
  console.log('⚠️  Consider using ES Modules (type: "module")');
}

if (packageJson.scripts['vercel-build']) {
  console.log('✅ Vercel build script found');
} else {
  console.log('⚠️  No vercel-build script (using default)');
}

console.log('\n🎯 Deployment Checklist:');
console.log('1. ✅ Push your code to GitHub');
console.log('2. ✅ Go to vercel.com and connect your repository');
console.log('3. ✅ Add environment variables in Vercel dashboard:');
console.log('   - DATABASE_URL (your MongoDB connection string)');
console.log('   - NODE_ENV=production');
console.log('   - ETHEREUM_RPC=https://ethereum.publicnode.com');
console.log('   - MIN_PROFIT_USD=1');
console.log('4. ✅ Deploy and test your endpoints');

console.log('\n🌐 Your API endpoints will be:');
console.log('- https://your-project.vercel.app/api/health');
console.log('- https://your-project.vercel.app/api/opportunities');
console.log('- https://your-project.vercel.app/api/stats');
console.log('- https://your-project.vercel.app/api/simulate');
console.log('- https://your-project.vercel.app/api/prices');

console.log('\n🎉 Your project is ready for Vercel deployment!');
console.log('\n📖 Read VERCEL_DEPLOYMENT_GUIDE.md for detailed instructions.');
console.log('\n🚀 Quick deploy command: vercel --prod');

// Generate deployment commands
console.log('\n📋 Quick Commands:');
console.log('# Push to GitHub:');
console.log('git add .');
console.log('git commit -m "Deploy to Vercel"');
console.log('git push origin main');
console.log('');
console.log('# Deploy with Vercel CLI:');
console.log('npm install -g vercel');
console.log('vercel login');
console.log('vercel --prod');

// Create a deployment info file
const deploymentInfo = {
  timestamp: new Date().toISOString(),
  readyForDeployment: allFilesExist,
  endpoints: [
    '/api/health',
    '/api/opportunities', 
    '/api/stats',
    '/api/simulate',
    '/api/prices'
  ],
  environmentVariables: requiredEnvVars,
  deploymentPlatform: 'Vercel',
  status: 'Ready'
};

fs.writeFileSync(
  path.join(__dirname, 'deployment-info.json'),
  JSON.stringify(deploymentInfo, null, 2)
);

console.log('\n💾 Created deployment-info.json with deployment details.');
console.log('\n✨ Ready to deploy! Good luck! 🍀');