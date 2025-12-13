/**
 * 测试 Google Ads API 访问
 * 使用方法: node test-mcc-access.js <MCC_ID>
 * 例如: node test-mcc-access.js 968-646-8564
 */

const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');

async function testMccAccess(mccId) {
  try {
    console.log(`\n🔍 测试 MCC ID: ${mccId}\n`);

    // 格式化 MCC ID
    const formattedMccId = mccId.replace(/-/g, '');
    console.log(`📝 格式化后的 ID: ${formattedMccId}`);

    // 读取环境变量
    const envPath = '.env';
    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');
    
    let developerToken = null;
    let keyPath = null;
    
    for (const line of lines) {
      if (line.startsWith('GOOGLE_ADS_DEVELOPER_TOKEN=')) {
        developerToken = line.split('=')[1].trim().replace(/"/g, '');
      }
      if (line.startsWith('GOOGLE_SERVICE_ACCOUNT_KEY_PATH=')) {
        keyPath = line.split('=')[1].trim().replace(/"/g, '');
      }
    }

    if (!developerToken || !keyPath) {
      throw new Error('环境变量未正确配置');
    }

    console.log(`\n🔐 获取访问令牌...`);
    
    // 获取访问令牌
    const auth = new GoogleAuth({
      keyFile: keyPath,
      scopes: ['https://www.googleapis.com/auth/adwords'],
    });

    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();

    if (!tokenResponse.token) {
      throw new Error('无法获取访问令牌');
    }

    console.log(`✅ 访问令牌获取成功`);

    // 调用 Google Ads API
    const query = `
      SELECT
        customer_client.id,
        customer_client.descriptive_name,
        customer_client.status,
        customer_client.manager
      FROM customer_client
      WHERE customer_client.level <= 1
    `;

    const apiUrl = `https://googleads.googleapis.com/v22/customers/${formattedMccId}/googleAds:search`;
    
    console.log(`\n📡 调用 Google Ads API...`);
    console.log(`   URL: ${apiUrl}`);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenResponse.token}`,
        'developer-token': developerToken,
        'login-customer-id': formattedMccId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    console.log(`\n📥 响应状态: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const responseText = await response.text();
      console.error(`\n❌ API 调用失败`);
      console.error(`   状态码: ${response.status}`);
      console.error(`   响应内容（前 500 字符）:`);
      console.error(`   ${responseText.substring(0, 500)}`);
      
      // 根据状态码给出建议
      if (response.status === 404) {
        console.log(`\n💡 404 错误可能的原因:`);
        console.log(`   1. MCC ID 不存在或输入错误`);
        console.log(`   2. 服务账号没有访问这个 MCC 的权限`);
        console.log(`   3. 这个 MCC 已被删除`);
      } else if (response.status === 403) {
        console.log(`\n💡 403 错误说明:`);
        console.log(`   服务账号没有访问权限，请在 Google Ads 中添加:`);
        console.log(`   kyads-758@glassy-rush-474806-n7.iam.gserviceaccount.com`);
      } else if (response.status === 401) {
        console.log(`\n💡 401 错误说明:`);
        console.log(`   认证失败，请检查 Developer Token 是否正确`);
      }
      
      process.exit(1);
    }

    const data = await response.json();
    console.log(`\n✅ API 调用成功！`);
    console.log(`   返回结果数: ${data.results?.length || 0}`);

    if (data.results && data.results.length > 0) {
      console.log(`\n📋 账户列表:`);
      data.results.forEach((result, index) => {
        const client = result.customerClient;
        const type = client.manager ? 'MCC' : 'CID';
        console.log(`   ${index + 1}. [${type}] ${client.id} - ${client.descriptive_name || '未命名'}`);
      });
    }

    console.log(`\n🎉 测试成功！这个 MCC 可以正常访问。\n`);
  } catch (error) {
    console.error(`\n❌ 测试失败:`, error.message);
    console.error(error);
    process.exit(1);
  }
}

// 获取命令行参数
const mccId = process.argv[2];

if (!mccId) {
  console.error('❌ 请提供 MCC ID');
  console.log('使用方法: node test-mcc-access.js <MCC_ID>');
  console.log('例如: node test-mcc-access.js 968-646-8564');
  process.exit(1);
}

// 验证格式
if (!/^\d{3}-\d{3}-\d{4}$/.test(mccId)) {
  console.error('❌ MCC ID 格式错误');
  console.log('正确格式: xxx-xxx-xxxx（例如：968-646-8564）');
  process.exit(1);
}

testMccAccess(mccId);
