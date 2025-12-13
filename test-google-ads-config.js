/**
 * Google Ads 配置测试脚本
 * 运行命令: node test-google-ads-config.js
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 检查 Google Ads 配置...\n');

// 1. 读取 .env 文件
const envPath = path.join(__dirname, '.env');
let developerToken = null;
let keyPath = null;

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const lines = envContent.split('\n');
  
  for (const line of lines) {
    if (line.startsWith('GOOGLE_ADS_DEVELOPER_TOKEN=')) {
      developerToken = line.split('=')[1].trim().replace(/"/g, '');
    }
    if (line.startsWith('GOOGLE_SERVICE_ACCOUNT_KEY_PATH=')) {
      keyPath = line.split('=')[1].trim().replace(/"/g, '');
    }
  }
}

console.log('1️⃣ 环境变量检查:');
console.log(`   GOOGLE_ADS_DEVELOPER_TOKEN: ${developerToken ? '✅ 已设置' : '❌ 未设置'}`);
console.log(`   GOOGLE_SERVICE_ACCOUNT_KEY_PATH: ${keyPath ? '✅ 已设置' : '❌ 未设置'}`);

if (developerToken && developerToken.includes('your-developer-token')) {
  console.log('   ⚠️  开发者令牌似乎还是默认值，请替换为实际的令牌');
}

console.log('');

// 2. 检查服务账号密钥文件
if (keyPath) {
  const fullPath = path.resolve(keyPath);
  console.log('2️⃣ 服务账号密钥文件检查:');
  console.log(`   文件路径: ${fullPath}`);
  
  if (fs.existsSync(fullPath)) {
    console.log(`   文件存在: ✅`);
    
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const keyData = JSON.parse(content);
      
      console.log(`   JSON 格式: ✅`);
      console.log(`   类型: ${keyData.type || '❌ 缺失'}`);
      console.log(`   项目ID: ${keyData.project_id || '❌ 缺失'}`);
      console.log(`   客户端邮箱: ${keyData.client_email || '❌ 缺失'}`);
      console.log(`   私钥: ${keyData.private_key ? '✅ 存在' : '❌ 缺失'}`);
      
      if (keyData.type !== 'service_account') {
        console.log('   ⚠️  type 应该为 "service_account"');
      }
    } catch (error) {
      console.log(`   JSON 解析失败: ❌`);
      console.log(`   错误: ${error.message}`);
    }
  } else {
    console.log(`   文件存在: ❌`);
    console.log(`   ⚠️  请确认文件路径是否正确`);
  }
} else {
  console.log('2️⃣ 服务账号密钥文件检查: ❌ 未配置路径');
}

console.log('');

// 3. 提供下一步建议
console.log('📝 下一步:');
if (!developerToken || developerToken.includes('your-developer-token')) {
  console.log('   1. 在 .env 文件中设置正确的 GOOGLE_ADS_DEVELOPER_TOKEN');
}
if (!keyPath || !fs.existsSync(path.resolve(keyPath))) {
  console.log('   2. 确保服务账号密钥文件存在于正确的路径');
}
console.log('   3. 在 Google Ads MCC 中添加服务账号并授权');
console.log('   4. 重启开发服务器（npm run dev）');

console.log('');
console.log('📖 详细说明请查看: MCC_DEPLOYMENT_GUIDE.md');
