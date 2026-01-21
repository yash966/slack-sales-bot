require('dotenv').config();
const { App } = require('@slack/bolt');
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');

// Create PostgreSQL connection pool
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Initialize Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  port: process.env.PORT || 3000
});

// Test database connection on startup
async function testDatabaseConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ Connected to PostgreSQL database successfully!');
    client.release();
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
}

// Query database function
async function queryDatabase(sql) {
  try {
    const result = await pool.query(sql);
    return result.rows;
  } catch (error) {
    console.error('Database query error:', error);
    throw new Error(`Database error: ${error.message}`);
  }
}

// Generate chart URL using QuickChart
function generateChartUrl(data, chartType, question) {
  const q = question.toLowerCase();
  
  // Determine what to chart based on data structure
  let labels = [];
  let values = [];
  let title = 'Data Visualization';
  let valueLabel = 'Value';
  
  // Extract labels and values from data
  const firstRow = data[0];
  const keys = Object.keys(firstRow);
  
  // Find label column (category, country, product_name, etc.)
  const labelKey = keys.find(k => 
    k.includes('category') || k.includes('country') || 
    k.includes('product') || k.includes('name')
  ) || keys[0];
  
  // Find value column (revenue, count, rating, etc.)
  const valueKey = keys.find(k => 
    k.includes('revenue') || k.includes('total') || 
    k.includes('count') || k.includes('rating') || k.includes('sales') ||
    k.includes('quantity')
  ) || keys[keys.length - 1];
  
  // Prepare data (limit to top 10 for readability)
  const chartData = data.slice(0, 10);
  labels = chartData.map(row => String(row[labelKey] || ''));
  values = chartData.map(row => {
    const val = row[valueKey];
    return typeof val === 'string' ? parseFloat(val) : Number(val) || 0;
  });
  
  // Set title and value label
  title = labelKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  valueLabel = valueKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  
  // Truncate long labels
  labels = labels.map(l => {
    const str = String(l);
    return str.length > 15 ? str.substring(0, 12) + '...' : str;
  });
  
  // Color schemes
  const barColors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40', '#FF6384', '#C9CBCF', '#7BC225', '#E83E8C'];
  
  let chartConfig;
  
  if (chartType === 'pie' || chartType === 'doughnut') {
    // Simpler pie chart configuration
    chartConfig = {
      type: 'pie',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: barColors
        }]
      },
      options: {
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 12,
              padding: 10,
              font: { size: 11 }
            }
          },
          title: {
            display: true,
            text: title,
            font: { size: 16, weight: 'bold' }
          },
          datalabels: {
            display: true,
            color: '#fff',
            font: { weight: 'bold', size: 12 },
            formatter: (value, context) => {
              const sum = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = ((value * 100) / sum).toFixed(1);
              return percentage > 5 ? percentage + '%' : '';
            }
          }
        }
      }
    };
  } else if (chartType === 'line') {
    chartConfig = {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: valueLabel,
          data: values,
          fill: false,
          borderColor: '#36A2EB',
          backgroundColor: '#36A2EB',
          tension: 0.1,
          pointRadius: 5,
          pointHoverRadius: 7
        }]
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: title,
            font: { size: 16, weight: 'bold' }
          },
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { font: { size: 11 } }
          },
          x: {
            ticks: { font: { size: 10 } }
          }
        }
      }
    };
  } else {
    // Bar chart (default)
    chartConfig = {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: valueLabel,
          data: values,
          backgroundColor: barColors
        }]
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: title,
            font: { size: 16, weight: 'bold' }
          },
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { font: { size: 11 } }
          },
          x: {
            ticks: { 
              font: { size: 10 },
              maxRotation: 45,
              minRotation: 45
            }
          }
        }
      }
    };
  }
  
  // Create URL with proper encoding
  const chartJson = JSON.stringify(chartConfig);
  const encoded = encodeURIComponent(chartJson);
  
  return `https://quickchart.io/chart?w=800&h=500&c=${encoded}`;
}

// Store successful queries for learning
const queryHistory = [];

// Generate AI summary of results
async function generateResultSummary(data, question) {
  try {
    // Skip summary for single-value results
    if (data.length === 1 && Object.keys(data[0]).length === 1) {
      return null;
    }
    
    // Prepare data summary
    const dataPreview = data.slice(0, 5).map(row => 
      Object.entries(row)
        .map(([key, val]) => `${key}: ${val}`)
        .join(', ')
    ).join('\n');
    
    const prompt = `You are analyzing sales data results. Provide a brief, insightful summary in 2-3 sentences.

User asked: "${question}"

Data returned (first 5 rows):
${dataPreview}

Total rows: ${data.length}

Provide a clear, actionable summary that highlights:
1. Key finding or trend
2. Notable insight or comparison
3. Brief recommendation (if applicable)

Keep it concise, professional, and valuable. Max 3 sentences.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      temperature: 0.7,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    return message.content[0].text.trim();
  } catch (error) {
    console.error('Summary generation error:', error);
    return null;
  }
}

// Check if question is related to sales data
async function isQuestionRelevant(question) {
  // Keywords that suggest sales/data queries
  const salesKeywords = [
    'sales', 'revenue', 'product', 'category', 'country', 'rating', 'sold', 
    'top', 'best', 'worst', 'highest', 'lowest', 'average', 'total', 'count',
    'how many', 'show me', 'chart', 'graph', 'visualize', 'compare', 'breakdown',
    'electronics', 'clothing', 'furniture', 'beauty', 'sports', 'pet', 'baby',
    'usa', 'canada', 'uk', 'germany', 'france', 'australia', 'japan',
    'profitable', 'performance', 'metrics', 'analysis', 'data', 'report'
  ];
  
  const lowerQuestion = question.toLowerCase();
  
  // Check if question contains any sales-related keywords
  const hasRelevantKeyword = salesKeywords.some(keyword => 
    lowerQuestion.includes(keyword)
  );
  
  // Obvious off-topic patterns
  const offTopicPatterns = [
    /weather/i, /joke/i, /recipe/i, /movie/i, /song/i, /game/i,
    /tell me about/i, /who is/i, /what is the capital/i, /translate/i,
    /play/i, /music/i, /video/i, /news/i, /sports score/i,
    /what time/i, /set alarm/i, /remind me/i, /calculate/i,
    /meaning of life/i, /how old/i, /who won/i, /current president/i
  ];
  
  const isOffTopic = offTopicPatterns.some(pattern => pattern.test(lowerQuestion));
  
  if (isOffTopic) return false;
  if (hasRelevantKeyword) return true;
  
  // If unclear, assume it might be relevant (let AI decide)
  return true;
}

// AI-powered question processing using Claude with Few-Shot Learning
async function processQuestionWithAI(question) {
  try {
    // Get recent successful queries as examples
    const recentExamples = queryHistory.slice(-5).map(h => 
      `Q: "${h.question}"\nSQL: ${h.sql}\nResult: Success`
    ).join('\n\n');
    
    const prompt = `You are a SQL query generator for an Amazon sales database. Learn from these successful query examples and generate ACCURATE queries.

Database schema:
Table: sales_data
Columns:
- id (integer, primary key)
- sale_date (date) - format: YYYY-MM-DD
- product_name (varchar) - specific product names
- category (varchar) - EXACT values: 'Electronics', 'Home & Kitchen', 'Sports & Outdoors', 'Health & Personal Care', 'Beauty', 'Clothing', 'Bags & Luggage', 'Furniture', 'Pet Supplies', 'Baby Products', 'Books & Stationery', 'Toys & Games', 'Grocery', 'Automotive', 'Garden & Outdoor'
- country (varchar) - EXACT values: 'USA', 'Canada', 'UK', 'Germany', 'France', 'Australia', 'Japan', 'India', 'Brazil', 'Mexico', 'Spain', 'Italy', 'Netherlands', 'Sweden', 'Singapore'
- revenue (numeric) - dollar amount per sale transaction
- rating (numeric, 0-5) - product rating
- quantity_sold (integer) - number of items in each sale

${recentExamples ? `SUCCESSFUL EXAMPLES FROM THIS SESSION:\n${recentExamples}\n\n` : ''}

CRITICAL FILTERING RULES - MUST FOLLOW:
1. **CATEGORY FILTER IS MANDATORY** when user mentions ANY category name
   - "electronics" → WHERE category = 'Electronics'
   - "clothing" → WHERE category = 'Clothing'
   - "furniture" → WHERE category = 'Furniture'
   - NEVER return results without category filter when category is mentioned!

2. **COUNTRY FILTER IS MANDATORY** when user mentions ANY country
   - "USA" → WHERE country = 'USA'
   - "Canada" → WHERE country = 'Canada'
   - NEVER return results without country filter when country is mentioned!

3. **ALWAYS validate your WHERE clause** before returning
   - If user says "clothing products", your query MUST have: WHERE category = 'Clothing'
   - If user says "USA sales", your query MUST have: WHERE country = 'USA'

DETAILED QUERY PATTERNS:

1. BEST-SELLING / MOST SOLD (by quantity):
   SELECT product_name, SUM(quantity_sold) as total_quantity 
   FROM sales_data 
   WHERE category = 'CategoryName'  -- MANDATORY if category mentioned
   GROUP BY product_name 
   ORDER BY total_quantity DESC 
   LIMIT X

2. TOP REVENUE / MOST PROFITABLE:
   SELECT product_name, ROUND(SUM(revenue), 2) as total_revenue 
   FROM sales_data 
   WHERE category = 'CategoryName'  -- MANDATORY if category mentioned
   GROUP BY product_name 
   ORDER BY total_revenue DESC 
   LIMIT X

3. HIGHEST RATED:
   SELECT product_name, ROUND(AVG(rating), 2) as avg_rating, COUNT(*) as review_count
   FROM sales_data 
   WHERE category = 'CategoryName'  -- MANDATORY if category mentioned
   GROUP BY product_name 
   HAVING COUNT(*) >= 3
   ORDER BY avg_rating DESC 
   LIMIT X

4. CATEGORY ANALYSIS:
   SELECT category, COUNT(*) as sales_count, ROUND(SUM(revenue), 2) as total_revenue
   FROM sales_data 
   GROUP BY category 
   ORDER BY total_revenue DESC

5. COUNTRY ANALYSIS:
   SELECT country, COUNT(*) as sales_count, ROUND(SUM(revenue), 2) as total_revenue
   FROM sales_data 
   GROUP BY country 
   ORDER BY total_revenue DESC

6. TIME-BASED (recent, latest, last month):
   SELECT product_name, sale_date, revenue, rating
   FROM sales_data 
   ORDER BY sale_date DESC 
   LIMIT X

7. FILTERED QUERIES (multiple conditions):
   SELECT product_name, ROUND(SUM(revenue), 2) as total_revenue
   FROM sales_data 
   WHERE category = 'Electronics'  -- EXACT category name
     AND country = 'USA'           -- EXACT country name
     AND rating >= 4.5
   GROUP BY product_name 
   ORDER BY total_revenue DESC 
   LIMIT X

COMMON USER QUESTIONS & CORRECT RESPONSES:

Q: "top 5 best-selling products in electronics"
✓ CORRECT: SELECT product_name, SUM(quantity_sold) as total_quantity FROM sales_data WHERE category = 'Electronics' GROUP BY product_name ORDER BY total_quantity DESC LIMIT 5
✗ WRONG: SELECT without WHERE category = 'Electronics'

Q: "best selling clothing products"
✓ CORRECT: SELECT product_name, SUM(quantity_sold) as total_quantity FROM sales_data WHERE category = 'Clothing' GROUP BY product_name ORDER BY total_quantity DESC LIMIT 10
✗ WRONG: SELECT without WHERE category = 'Clothing'

Q: "top products in USA"
✓ CORRECT: SELECT product_name, SUM(revenue) as total_revenue FROM sales_data WHERE country = 'USA' GROUP BY product_name ORDER BY total_revenue DESC LIMIT 10
✗ WRONG: SELECT without WHERE country = 'USA'

CRITICAL RULES:
✓ Category/Country names are CASE-SENSITIVE - use exact values from schema
✓ "best-selling" = highest SUM(quantity_sold)
✓ "top revenue" = highest SUM(revenue)
✓ "highest rated" = highest AVG(rating) with HAVING COUNT(*) >= 3
✓ Always GROUP BY product_name when showing products
✓ Always use ROUND(decimal_column, 2) for money/ratings
✓ Default LIMIT is 10, adjust based on user request (top 5 = LIMIT 5)
✓ PostgreSQL syntax only

VALIDATION CHECKLIST BEFORE RETURNING:
□ User mentioned "electronics"? → Query has WHERE category = 'Electronics'
□ User mentioned "clothing"? → Query has WHERE category = 'Clothing'
□ User mentioned "USA"? → Query has WHERE country = 'USA'
□ User said "best-selling"? → Query uses SUM(quantity_sold)
□ User said "top revenue"? → Query uses SUM(revenue)

User question: "${question}"

Analyze and respond with JSON only:
{
  "sql": "Complete PostgreSQL SELECT query with MANDATORY WHERE clause if category/country mentioned",
  "chartType": "bar" | "pie" | "line" | null,
  "explanation": "What this query returns"
}

Chart types:
- "pie" → user says "pie chart"
- "line" → user says "line chart" or "trend"
- "bar" → user says "chart", "graph", "visualize", "bar"
- null → no visualization requested

Return ONLY the JSON object.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      temperature: 0.1, // Very low temperature for accuracy
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const responseText = message.content[0].text;
    
    // Parse JSON response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      console.log('AI Generated Query:', result.sql);
      console.log('Explanation:', result.explanation);
      
      // Store successful query for learning
      queryHistory.push({
        question: question,
        sql: result.sql,
        timestamp: new Date()
      });
      
      // Keep only last 20 queries
      if (queryHistory.length > 20) {
        queryHistory.shift();
      }
      
      return {
        sql: result.sql,
        chartType: result.chartType,
        explanation: result.explanation
      };
    }
    
    return null;
  } catch (error) {
    console.error('AI processing error:', error);
    return null;
  }
}

// Process natural language questions and convert to SQL
function processQuestion(question) {
  const q = question.toLowerCase().trim();
  
  // Check for chart requests
  const isChartRequest = q.includes('chart') || q.includes('graph') || 
                        q.includes('visualiz') || q.includes('pie') || q.includes('line');
  
  // Determine chart type
  let chartType = null;
  if (isChartRequest) {
    if (q.includes('pie')) chartType = 'pie';
    else if (q.includes('line')) chartType = 'line';
    else chartType = 'bar';
  }
  
  // Sales by category
  if ((q.includes('sales') || q.includes('revenue')) && q.includes('category')) {
    return { 
      sql: 'SELECT category, COUNT(*) as sales_count, ROUND(SUM(revenue), 2) as total_revenue FROM sales_data GROUP BY category ORDER BY total_revenue DESC',
      chartType: chartType
    };
  }
  
  // Sales by country
  if ((q.includes('sales') || q.includes('revenue')) && q.includes('country')) {
    return { 
      sql: 'SELECT country, COUNT(*) as sales_count, ROUND(SUM(revenue), 2) as total_revenue FROM sales_data GROUP BY country ORDER BY total_revenue DESC',
      chartType: chartType
    };
  }
  
  // Total sales/revenue queries
  if (q.includes('total sales') || q.includes('total revenue')) {
    if (q.includes('by category') || q.includes('per category')) {
      return { 
        sql: 'SELECT category, COUNT(*) as sales_count, ROUND(SUM(revenue), 2) as total_revenue FROM sales_data GROUP BY category ORDER BY total_revenue DESC',
        chartType: chartType
      };
    }
    if (q.includes('by country') || q.includes('per country')) {
      return { 
        sql: 'SELECT country, COUNT(*) as sales_count, ROUND(SUM(revenue), 2) as total_revenue FROM sales_data GROUP BY country ORDER BY total_revenue DESC',
        chartType: chartType
      };
    }
    return { sql: 'SELECT ROUND(SUM(revenue), 2) as total_revenue, COUNT(*) as total_sales FROM sales_data' };
  }
  
  // Count queries
  if (q.includes('how many') || q.includes('count')) {
    if (q.includes('product') || q.includes('sale')) {
      return { sql: 'SELECT COUNT(*) as total_sales FROM sales_data' };
    }
    if (q.includes('categor')) {
      return { sql: 'SELECT COUNT(DISTINCT category) as category_count FROM sales_data' };
    }
    if (q.includes('countr')) {
      return { sql: 'SELECT COUNT(DISTINCT country) as country_count FROM sales_data' };
    }
  }
  
  // Top/Best queries
  if (q.includes('top') || q.includes('best')) {
    if (q.includes('product')) {
      return { 
        sql: 'SELECT product_name, COUNT(*) as times_sold, ROUND(SUM(revenue), 2) as total_revenue FROM sales_data GROUP BY product_name ORDER BY total_revenue DESC LIMIT 10',
        chartType: chartType
      };
    }
    if (q.includes('categor')) {
      return { 
        sql: 'SELECT category, COUNT(*) as sales_count, ROUND(SUM(revenue), 2) as total_revenue FROM sales_data GROUP BY category ORDER BY total_revenue DESC LIMIT 5',
        chartType: chartType
      };
    }
    if (q.includes('countr')) {
      return { 
        sql: 'SELECT country, ROUND(SUM(revenue), 2) as total_revenue FROM sales_data GROUP BY country ORDER BY total_revenue DESC LIMIT 10',
        chartType: chartType
      };
    }
  }
  
  // Average queries
  if (q.includes('average') || q.includes('avg')) {
    if (q.includes('rating')) {
      return { sql: 'SELECT ROUND(AVG(rating), 2) as average_rating FROM sales_data' };
    }
    if (q.includes('revenue') || q.includes('sale')) {
      return { sql: 'SELECT ROUND(AVG(revenue), 2) as average_revenue FROM sales_data' };
    }
  }
  
  // Rating queries
  if (q.includes('rating') || q.includes('rated')) {
    if (q.includes('highest') || q.includes('best')) {
      return { sql: 'SELECT product_name, category, ROUND(AVG(rating), 2) as avg_rating FROM sales_data GROUP BY product_name, category HAVING COUNT(*) >= 3 ORDER BY avg_rating DESC LIMIT 10' };
    }
    return { 
      sql: 'SELECT category, ROUND(AVG(rating), 2) as avg_rating FROM sales_data GROUP BY category ORDER BY avg_rating DESC',
      chartType: chartType
    };
  }
  
  // Recent/Latest queries
  if (q.includes('recent') || q.includes('latest') || q.includes('last')) {
    return { sql: 'SELECT sale_date, product_name, category, country, revenue, rating FROM sales_data ORDER BY sale_date DESC LIMIT 10' };
  }
  
  // Category-specific queries
  if (q.includes('electronics')) {
    return { sql: "SELECT product_name, ROUND(SUM(revenue), 2) as total_revenue, ROUND(AVG(rating), 2) as avg_rating FROM sales_data WHERE category = 'Electronics' GROUP BY product_name ORDER BY total_revenue DESC LIMIT 10" };
  }
  
  // Country-specific queries
  const countries = ['usa', 'canada', 'uk', 'germany', 'france', 'australia'];
  for (let country of countries) {
    if (q.includes(country)) {
      const countryName = country.toUpperCase() === 'UK' ? 'UK' : country.charAt(0).toUpperCase() + country.slice(1);
      return { sql: `SELECT product_name, category, ROUND(SUM(revenue), 2) as total_revenue FROM sales_data WHERE country = '${countryName}' GROUP BY product_name, category ORDER BY total_revenue DESC LIMIT 10` };
    }
  }
  
  return null;
}

// Format results for Slack display
function formatResults(data, query) {
  if (!data || data.length === 0) {
    return '📊 No results found for this query.';
  }
  
  const q = query.toLowerCase();
  
  // Single value result - make it big and bold
  if (data.length === 1 && Object.keys(data[0]).length === 1) {
    const key = Object.keys(data[0])[0];
    const value = data[0][key];
    const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    
    // Add relevant emoji based on the metric
    let emoji = '📊';
    if (key.includes('revenue') || key.includes('sales')) emoji = '💰';
    if (key.includes('rating')) emoji = '⭐';
    if (key.includes('count')) emoji = '🔢';
    
    return {
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `${emoji} ${formattedKey}`,
            emoji: true
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${formatNumber(value)}*`
          }
        }
      ]
    };
  }
  
  // Multiple rows - format with Slack blocks for better UI
  const headers = Object.keys(data[0]);
  const displayData = data.slice(0, 10); // Show top 10
  
  // Determine the type of data for appropriate emoji
  let emoji = '📊';
  let title = 'Query Results';
  
  if (q.includes('product')) {
    emoji = '🛍️';
    title = 'Top Products';
  } else if (q.includes('category') || q.includes('categor')) {
    emoji = '📦';
    title = 'Sales by Category';
  } else if (q.includes('country') || q.includes('countr')) {
    emoji = '🌍';
    title = 'Sales by Country';
  } else if (q.includes('rating')) {
    emoji = '⭐';
    title = 'Rating Analysis';
  } else if (q.includes('recent') || q.includes('latest')) {
    emoji = '🕐';
    title = 'Recent Sales';
  }
  
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${emoji} ${title}`,
        emoji: true
      }
    },
    {
      type: "divider"
    }
  ];
  
  // Add each row as a section
  displayData.forEach((row, index) => {
    let text = '';
    
    // Format each field in the row
    Object.keys(row).forEach(key => {
      const value = row[key];
      const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      const formattedValue = formatValue(value, key);
      text += `*${formattedKey}:* ${formattedValue}\n`;
    });
    
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: text.trim()
      }
    });
    
    // Add divider between rows (but not after last row)
    if (index < displayData.length - 1) {
      blocks.push({ type: "divider" });
    }
  });
  
  // Add footer if there are more results
  if (data.length > 10) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `_Showing top 10 of ${data.length} results_`
        }
      ]
    });
  }
  
  return { blocks };
}

// Helper function to format numbers
function formatNumber(value) {
  if (typeof value === 'number') {
    // If it's a large number (revenue), format with commas
    if (value > 1000) {
      return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return value.toFixed(2);
  }
  return value;
}

// Helper function to format values based on field type
function formatValue(value, key) {
  if (value === null) return '_N/A_';
  
  // Revenue/money fields
  if (key.includes('revenue') || key.includes('price')) {
    return `${formatNumber(value)}`;
  }
  
  // Rating fields
  if (key.includes('rating')) {
    const stars = '⭐'.repeat(Math.round(Number(value)));
    return `${stars} ${Number(value).toFixed(2)}`;
  }
  
  // Count/quantity fields
  if (key.includes('count') || key.includes('quantity') || key.includes('sold')) {
    return `${formatNumber(value)} ${key.includes('count') ? 'items' : 'units'}`;
  }
  
  // Date fields
  if (key.includes('date') && value instanceof Date) {
    return value.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  
  // Regular numbers
  if (typeof value === 'number') {
    return formatNumber(value);
  }
  
  // Default: return as string
  return String(value);
}

// Handle app mentions (@bot)
app.event('app_mention', async ({ event, client, say }) => {
  try {
    // Remove bot mention from message
    const question = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
    
    if (!question) {
      await say({
        text: '👋 Hi! Ask me about the Amazon sales data! Try:\n• "What are the total sales?"\n• "Show me top products"\n• "Sales by category"\n• "Average rating"'
      });
      return;
    }
    
    // Check if it's a greeting or casual conversation
    const greetings = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening', 'how are you', "what's up", 'sup', 'howdy'];
    const isGreeting = greetings.some(g => question.toLowerCase().includes(g) && question.split(' ').length <= 5);
    
    if (isGreeting) {
      await say({
        text: '👋 Hello! I\'m your Sales Assistant. I can help you analyze Amazon sales data!\n\nTry asking me:\n• "What are the total sales?"\n• "Show me top products"\n• "Pie chart of sales by category"\n• "Which products have rating above 4.5?"\n• "Compare sales between USA and Canada"'
      });
      return;
    }
    
    // Check if question is relevant to sales data
    const isRelevant = await isQuestionRelevant(question);
    
    if (!isRelevant) {
      await say({
        text: "🤔 I'm specialized in analyzing Amazon sales data. I can't help with that question, but I'd love to help you with:\n\n📊 Sales Analysis:\n• Total sales and revenue\n• Top products and categories\n• Sales by country\n• Product ratings\n\n📈 Visualizations:\n• Charts and graphs\n• Sales comparisons\n• Performance metrics\n\nTry asking something like: \"What are the top selling products in electronics?\""
      });
      return;
    }
    
    // Show thinking indicator
    await client.chat.postMessage({
      channel: event.channel,
      text: '🤔 Analyzing your question...'
    });
    
    // Try AI processing first
    let queryResult = await processQuestionWithAI(question);
    
    // Fallback to rule-based if AI fails
    if (!queryResult) {
      queryResult = processQuestion(question);
    }
    
    if (!queryResult) {
      await say({
        text: "🤷 I'm not sure how to answer that. Try asking:\n• Total sales or revenue\n• Top products/categories\n• Sales by country\n• Average ratings\n• Recent sales\n\n💡 *Tip:* Add 'chart', 'graph', 'pie chart', or 'line chart' to visualize data!"
      });
      return;
    }
    
    const sqlQuery = queryResult.sql || queryResult;
    const chartType = queryResult.chartType;
    
    // Execute query
    const results = await queryDatabase(sqlQuery);
    
    // Generate chart if requested
    if (chartType && results.length > 1) {
      const chartUrl = generateChartUrl(results, chartType, question);
      
      await say({
        blocks: [
          {
            type: "image",
            title: {
              type: "plain_text",
              text: "📊 Data Visualization"
            },
            image_url: chartUrl,
            alt_text: "Chart visualization"
          }
        ],
        text: "Chart generated"
      });
    }
    
    const formattedResults = formatResults(results, question);
    
    // Send formatted response
    if (formattedResults.blocks) {
      await say({
        blocks: formattedResults.blocks,
        text: 'Query results'
      });
    } else {
      await say({
        text: formattedResults
      });
    }
    
    // Generate and send AI summary
    const summary = await generateResultSummary(results, question);
    if (summary) {
      await say({
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `💡 *Key Insights:*\n${summary}`
            }
          }
        ],
        text: `Key Insights: ${summary}`
      });
    }
    
  } catch (error) {
    console.error('Error processing mention:', error);
    await say({
      text: `❌ Oops! Something went wrong: ${error.message}`
    });
  }
});

// Handle direct messages
app.message(async ({ message, say }) => {
  // Ignore bot messages and threaded messages
  if (message.subtype || message.bot_id || message.thread_ts) return;
  
  try {
    const question = message.text.trim();
    
    if (!question) return;
    
    // Check if it's a greeting or casual conversation
    const greetings = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening', 'how are you', "what's up", 'sup', 'howdy'];
    const isGreeting = greetings.some(g => question.toLowerCase().includes(g) && question.split(' ').length <= 5);
    
    if (isGreeting) {
      await say('👋 Hello! I\'m your Sales Assistant. I can help you analyze Amazon sales data!\n\nTry asking:\n• "What are the total sales?"\n• "Show me top products"\n• "Pie chart of sales by category"\n• "Which products have rating above 4.5?"');
      return;
    }
    
    // Check if question is relevant to sales data
    const isRelevant = await isQuestionRelevant(question);
    
    if (!isRelevant) {
      await say("🤔 I'm specialized in analyzing Amazon sales data. I can't help with that question, but I'd love to help you with:\n\n📊 Sales Analysis:\n• Total sales and revenue\n• Top products and categories\n• Sales by country\n• Product ratings\n\n📈 Visualizations:\n• Charts and graphs\n• Sales comparisons\n\nTry asking: \"What are the top selling products in electronics?\"");
      return;
    }
    
    await say('🤔 Let me check that...');
    
    // Try AI processing first
    let queryResult = await processQuestionWithAI(question);
    
    // Fallback to rule-based if AI fails
    if (!queryResult) {
      queryResult = processQuestion(question);
    }
    
    if (!queryResult) {
      await say("I'm not sure how to answer that. Try:\n• Total sales\n• Top products\n• Sales by country/category\n• Average ratings\n\n💡 *Tip:* Add 'chart' to visualize!");
      return;
    }
    
    const sqlQuery = queryResult.sql || queryResult;
    const chartType = queryResult.chartType;
    
    const results = await queryDatabase(sqlQuery);
    
    // Generate chart if requested
    if (chartType && results.length > 1) {
      const chartUrl = generateChartUrl(results, chartType, question);
      
      await say({
        blocks: [
          {
            type: "image",
            title: {
              type: "plain_text",
              text: "📊 Data Visualization"
            },
            image_url: chartUrl,
            alt_text: "Chart visualization"
          }
        ],
        text: "Chart generated"
      });
    }
    
    const formattedResults = formatResults(results, question);
    
    // Send formatted response
    if (formattedResults.blocks) {
      await say({
        blocks: formattedResults.blocks,
        text: 'Query results'
      });
    } else {
      await say(formattedResults);
    }
    
    // Generate and send AI summary
    const summary = await generateResultSummary(results, question);
    if (summary) {
      await say({
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `💡 *Key Insights:*\n${summary}`
            }
          }
        ],
        text: `Key Insights: ${summary}`
      });
    }
    
  } catch (error) {
    console.error('Error processing message:', error);
    await say(`❌ Error: ${error.message}`);
  }
});

// Slash command for health check
app.command('/salesbot-health', async ({ ack, respond }) => {
  await ack();
  
  try {
    await pool.query('SELECT 1');
    await respond('✅ Bot is healthy! Database connection active.');
  } catch (error) {
    await respond(`❌ Database connection failed: ${error.message}`);
  }
});

// Start the app
(async () => {
  await testDatabaseConnection();
  await app.start();
  console.log('⚡️ Slack bot is running!');
  console.log('💬 You can now message your bot in Slack!');
})();