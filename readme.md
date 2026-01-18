
# AI-Powered Slack Sales Bot

An intelligent Slack bot that analyzes Amazon sales data using natural language queries. Built with Claude AI, PostgreSQL, and Slack's Bolt framework.

## 🚀 Features

- **Natural Language Understanding**: Ask questions in plain English
- **AI-Powered SQL Generation**: Automatically converts questions to SQL queries
- **Beautiful Visualizations**: Generate bar charts, pie charts, and line graphs
- **Self-Learning**: Improves accuracy through few-shot learning

## 📋 Prerequisites

- Node.js (v14 or higher)
- PostgreSQL (v12 or higher)
- Slack Workspace (with admin access)
- Anthropic API Key

## 🔧 Installation

1. Clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and fill in your credentials
4. Set up PostgreSQL database with sample data
5. Run the bot: `node bot.js`

## 📖 Usage

Ask questions like:
- "What are the top 5 best-selling products in electronics?"
- "Show me a pie chart of sales by category"
- "Which products have rating above 4.5?"

## 🔐 Security

All API keys are stored in `.env` which is not committed to the repository.
EOF